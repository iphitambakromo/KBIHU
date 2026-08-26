import React, { useEffect, useRef, useState } from 'react';
import { normMac } from '../../lib/mac.js';
import { ekstrakMacSiar, mfrHexDari, namaDefaultTag } from '../../lib/ble.js';

/* 🛡️ KAWAL — mengawal rombongan lewat gelang BLE.
   Tiap jamaah yang dipilih dipantau: sinyal tag-nya di bawah ambang (radius) selama 5 dtk
   → getar + bunyi, dan SEMAKIN LAMA di luar radius SEMAKIN KENCANG getarnya.
   Saat semua dalam radius → titik GPS "titik terakhir semua bersama" dicatat (bekas jalan). */

/* Pola getar eskalasi sesuai durasi di luar radius (detik) */
const getarKeluar = (detik) => detik < 15 ? [300, 200, 300]
  : detik < 30 ? [500, 250, 500, 250, 500]
  : [800, 300, 800, 300, 800, 300, 800];
const getarKembali = [120, 60, 120];

/* Bip sederhana (WebAudio): n nada */
const bip = (n, frek = 880) => {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    bip.ac = bip.ac || new AC();
    for (let i = 0; i < n; i++) {
      const o = bip.ac.createOscillator(), g = bip.ac.createGain();
      o.type = 'sine'; o.frequency.value = frek; g.gain.value = 0.22;
      o.connect(g); g.connect(bip.ac.destination);
      const t0 = bip.ac.currentTime + i * 0.3;
      o.start(t0); o.stop(t0 + 0.18);
    }
  } catch (e) {}
};

const URUT = { OUT: 0, LOST: 1, TUNGGU: 2, OFF: 3, IN: 4 };
const relDtk = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + ' dtk lalu' : Math.floor(s / 60) + ' mnt ' + (s % 60) + ' dtk lalu'; };

export default function KawalPage() {
  const [jmList, setJmList] = useState(null);   // jamaah ber-gelang (sudah di-scope peran oleh worker)
  const [pilih, setPilih] = useState(new Set());
  const [ambang, setAmbang] = useState(() => { try { const a = parseInt(localStorage.getItem('iphi_kawal_ambang'), 10); if (a >= -90 && a <= -50) return a; } catch (e) {} return -75; }); // ambang radius (dBm)
  const [bunyi, setBunyi] = useState(true);     // getar + bunyi
  const [aktif, setAktif] = useState(false);
  const [st, setSt] = useState({});             // jamaahId -> {mode, outDetik, tanpa, rssi}
  const [titik, setTitik] = useState(null);     // titik terakhir semua bersama
  const [pesan, setPesan] = useState('');

  const scanRef = useRef(null), tickRef = useRef(null), wlRef = useRef(null);
  const tagRef = useRef({});                    // kode tag -> {rssi, t, nm, mfrHex}
  const stRef = useRef({});                     // state mesin (mutasi antar tick)
  const jmRef = useRef([]), pilihRef = useRef(new Set()), ambRef = useRef(-75), bunyiRef = useRef(true);
  const gpsRef = useRef(null), macPetaRef = useRef({});
  const titikLastRef = useRef(0);

  useEffect(() => { ambRef.current = ambang; pilihRef.current = pilih; bunyiRef.current = bunyi; }, [ambang, pilih, bunyi]);
  useEffect(() => { try { localStorage.setItem('iphi_kawal_ambang', String(ambang)); } catch (e) {} }, [ambang]);

  /* Muat data jamaah (scope peran otomatis) + daftar MAC global */
  useEffect(() => {
    (async () => {
      try {
        const [rs, rm] = await Promise.all([
          fetch('/api/state', { headers: { authorization: 'Bearer ' + (localStorage.getItem('iphi_tok') || '') } }).then(x => x.json()),
          fetch('/api/pub/mac').then(x => x.json()),
        ]);
        const daftar = (rs.jamaah || []).filter(m => m.punya_gelang);
        jmRef.current = daftar; setJmList(daftar);
        const semua = new Set(daftar.map(m => m.id));
        pilihRef.current = semua; setPilih(semua);
        const peta = {}; (rm.daftar || []).forEach(x => { peta[x.mac_tag] = x; }); macPetaRef.current = peta;
      } catch (e) { setPesan('⚠️ Gagal memuat data jamaah'); }
    })();
    try { const t = localStorage.getItem('iphi_kawal_titik'); if (t) setTitik(JSON.parse(t)); } catch (e) {}
  }, []);

  /* GPS ringan — posisinya dipakai utk "titik semua bersama" */
  useEffect(() => {
    if (!navigator.geolocation) return;
    try { navigator.geolocation.watchPosition(p => { gpsRef.current = { lat: p.coords.latitude, lng: p.coords.longitude }; }, () => {}, { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 }); } catch (e) {}
  }, []);

  /* Tag cocok dengan jamaah? (daftar kode per-HP / nama-MAC / MAC payload) */
  const cocokTag = (m, t) => {
    if (!t) return false;
    const kodes = String(m.beacon_id || '').split(',').map(s => s.trim()).filter(Boolean);
    if (t.id && kodes.includes(t.id)) return true;
    if (m.mac_tag) {
      const macNama = normMac(t.nm || '');
      if (!namaDefaultTag(t.nm) && macNama === m.mac_tag) return true;
      if (ekstrakMacSiar(t.mfrHex || '', macPetaRef.current, false) === m.mac_tag) return true;
    }
    return false;
  };

  const getar = (pola) => { if (bunyiRef.current) { try { navigator.vibrate?.(pola); } catch (e) {} } };

  /* Mesin keadaan per jamaah, jalan tiap 1 dtk */
  const tick = () => {
    const kini = Date.now(), th = ambRef.current;
    const baru = {}, stLama = stRef.current;
    let nIN = 0, nEff = 0;
    for (const m of jmRef.current) {
      if (!pilihRef.current.has(m.id)) continue;
      const identitas = String(m.beacon_id || '').trim() || m.mac_tag;
      if (!identitas) { baru[m.id] = { mode: 'OFF', outDetik: 0, tanpa: 0, rssi: null }; continue; }
      nEff++;
      // tag terbaik yang cocok utk jamaah ini
      let t = null;
      for (const id of Object.keys(tagRef.current)) {
        const e = tagRef.current[id];
        if (cocokTag(m, { ...e, id })) { if (!t || e.rssi > t.rssi) t = e; }
      }
      const s = { ...(stLama[m.id] || { mode: 'TUNGGU', outDetik: 0, tanpa: 0, lastBuzz: 0, rssi: null }) };
      const ada = t && (kini - t.t) < 4000;
      if (ada) {
        s.tanpa = 0; s.rssi = t.rssi;
        if (s.mode === 'IN') { if (t.rssi < th) { s.mode = 'TUNGGU'; s.outDetik = 1; } }
        else if (s.mode === 'TUNGGU') {
          if (t.rssi >= th + 5) { s.mode = 'IN'; s.outDetik = 0; getar(getarKembali); if (bunyiRef.current) bip(1, 660); }
          else { s.outDetik += 1; if (s.outDetik >= 5) { s.mode = 'OUT'; s.lastBuzz = kini; getar(getarKeluar(s.outDetik)); if (bunyiRef.current) bip(1, 880); } }
        }
        else if (s.mode === 'OUT') {
          if (t.rssi >= th + 5) { s.mode = 'IN'; s.outDetik = 0; getar(getarKembali); if (bunyiRef.current) bip(1, 660); }
          else {
            s.outDetik += 1;
            // getar ulang tiap 8 dtk — polanya makin kencang seiring durasi
            if (kini - (s.lastBuzz || 0) >= 8000) { s.lastBuzz = kini; getar(getarKeluar(s.outDetik)); if (bunyiRef.current) bip(Math.min(3, 1 + Math.floor(s.outDetik / 15)), 880); }
          }
        }
        else if (s.mode === 'LOST') {
          if (t.rssi >= th) { s.mode = 'IN'; s.outDetik = 0; getar(getarKembali); if (bunyiRef.current) bip(2, 660); }
          else { s.mode = 'TUNGGU'; s.outDetik = 1; }
        }
        if (s.mode === 'IN') nIN++;
      } else {
        s.tanpa = (s.tanpa || 0) + 1;
        if (s.mode === 'IN' && s.tanpa >= 30) s.mode = 'LOST';
        if ((s.mode === 'TUNGGU' || s.mode === 'OUT') && s.tanpa >= 30) s.mode = 'LOST';
        if (s.mode === 'OUT' && s.tanpa < 30) {
          s.outDetik += 1;
          if (kini - (s.lastBuzz || 0) >= 8000) { s.lastBuzz = kini; getar(getarKeluar(s.outDetik)); if (bunyiRef.current) bip(3, 880); }
        }
      }
      baru[m.id] = s;
    }
    stRef.current = baru; setSt(baru);
    // titik "semua bersama": semua yg dipilih (punya identitas) dalam radius + GPS ada
    if (nEff > 0 && nIN === nEff && gpsRef.current && kini - titikLastRef.current > 5000) {
      titikLastRef.current = kini;
      const t = { lat: +gpsRef.current.lat.toFixed(6), lng: +gpsRef.current.lng.toFixed(6), t: kini };
      setTitik(t);
      try { localStorage.setItem('iphi_kawal_titik', JSON.stringify(t)); } catch (e) {}
    }
  };

  const onAd = (ev) => {
    const id = ev.device.id || ev.device.name;
    const kini = Date.now();
    const e = tagRef.current[id] || { rssi: -100, t: 0, tMax: 0, nm: '', mfrHex: '' };
    const r = ev.rssi || -100;
    // maksimum rolling 4 dtk: nilai maksimum berlaku selama 4 dtk sejak dicatat, lalu meluruh
    const rssi = (kini - (e.tMax || 0)) > 4000 ? r : Math.max(e.rssi, r);
    const mh = mfrHexDari(ev);
    tagRef.current[id] = { rssi, t: kini, tMax: r >= rssi ? kini : (e.tMax || kini), nm: ev.device.name || e.nm, mfrHex: mh.length > e.mfrHex.length ? mh : e.mfrHex };
  };

  const mulai = async () => {
    if (!navigator.bluetooth?.requestLEScan) { setPesan('⚠️ Browser ini tak bisa memindai — buka di Chrome Android'); return; }
    try { scanRef.current = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true }); }
    catch (e) { setPesan('⚠️ Gagal memindai — pastikan Bluetooth aktif & pakai Chrome Android'); return; }
    try { wlRef.current = await navigator.wakeLock?.request('screen'); } catch (e) {}
    try { navigator.bluetooth.addEventListener('advertisementreceived', onAd); } catch (e) {}
    setPesan(''); setAktif(true);
    tickRef.current = setInterval(tick, 1000);
  };
  const henti = () => {
    try { scanRef.current?.stop(); } catch (e) {}
    try { wlRef.current?.release(); } catch (e) {}
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null; scanRef.current = null; wlRef.current = null;
    setAktif(false);
  };
  useEffect(() => () => { try { scanRef.current?.stop(); } catch (e) {} if (tickRef.current) clearInterval(tickRef.current); }, []);

  const toggle = (id) => setPilih(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reguDaftar = jmList ? [...new Set(jmList.map(m => m.regu || '(tanpa regu)'))] : [];
  const toggleRegu = (r) => {
    const ids = jmList.filter(m => (m.regu || '(tanpa regu)') === r).map(m => m.id);
    const semua = ids.length > 0 && ids.every(i => pilih.has(i));
    setPilih(p => { const n = new Set(p); ids.forEach(i => { if (semua) n.delete(i); else n.add(i); }); return n; });
  };

  const nEff = jmList ? jmList.filter(m => pilih.has(m.id) && (String(m.beacon_id || '').trim() || m.mac_tag)).length : 0;
  const nIN = jmList ? jmList.filter(m => pilih.has(m.id) && st[m.id] && st[m.id].mode === 'IN').length : 0;
  const baris = jmList ? jmList.filter(m => pilih.has(m.id)).map(m => ({ m, s: st[m.id] || { mode: 'TUNGGU', outDetik: 0, tanpa: 0, rssi: null } }))
    .sort((a, b) => (URUT[a.s.mode] ?? 9) - (URUT[b.s.mode] ?? 9)) : [];

  const teksStatus = (s) => s.mode === 'IN' ? 'dalam radius'
    : s.mode === 'TUNGGU' ? `di tepi ambang… ${s.outDetik || 0} dtk`
    : s.mode === 'OUT' ? `DI LUAR RADIUS ${s.outDetik || 0} dtk — getar makin kencang`
    : s.mode === 'LOST' ? `tanpa sinyal ${s.tanpa || 0} dtk`
    : 'belum disandingkan di HP mana pun (⌚ di dashboard)';

  return (
    <div className="p-3 space-y-3 max-w-[640px] mx-auto">
      <div className="kartu p-4 space-y-3">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-hijau">🛡️ Kawal — mengawal rombongan</h2>
        <p className="text-slate-500 text-[12px] leading-snug">
          Sinyal di bawah ambang = <b>di luar radius</b>. Jarak kira-kira (area terbuka): -55 ≈5 m · -65 ≈10 m · -75 ≈20 m · -85 ≈30–40 m.
          Setel ambangnya sampai pas untuk barisan jalanmu.
        </p>
        <div>
          <label className="text-[12px] font-bold text-slate-600 flex justify-between">
            <span>Radius ambang</span><span className="font-mono">{ambang} dBm</span>
          </label>
          <input type="range" min="-90" max="-50" step="1" value={ambang} onChange={e => setAmbang(Number(e.target.value))} className="w-full accent-emerald-700" />
          <div className="flex gap-2 mt-1.5">
            <button className="btn flex-1 !min-h-[40px] !text-[12.5px]" onClick={() => setAmbang(a => Math.max(-90, a - 5))} aria-label="Radius lebih jauh">−5 · radius jauh</button>
            <button className="btn flex-1 !min-h-[40px] !text-[12.5px]" onClick={() => setAmbang(a => Math.min(-50, a + 5))} aria-label="Radius lebih dekat">+5 · radius dekat</button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px] font-bold text-slate-700">
          <input type="checkbox" checked={bunyi} onChange={e => setBunyi(e.target.checked)} className="accent-emerald-700" />
          Getar + bunyi peringatan
        </label>
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">Yang dikawal</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {reguDaftar.map(r => <button key={r} className="btn !min-h-[30px] !px-2.5 !text-[11px]" onClick={() => toggleRegu(r)}>{r}</button>)}
          </div>
          <div className="space-y-1 max-h-[150px] overflow-y-auto pr-1">
            {(jmList || []).map(m => (
              <label key={m.id} className="flex items-center gap-2 text-[13px] text-slate-700">
                <input type="checkbox" checked={pilih.has(m.id)} onChange={() => toggle(m.id)} className="accent-emerald-700" />
                <span className="flex-1 truncate">{m.nama}</span>
                <small className="text-slate-400">{m.regu || ''}</small>
              </label>
            ))}
            {!jmList && <p className="text-slate-400 text-[12px]">Memuat…</p>}
          </div>
        </div>
        <button className={`w-full btn ${aktif ? 'btn-merah' : 'btn-utama'} !min-h-[52px] !text-[16px]`} onClick={aktif ? henti : mulai}>
          {aktif ? '⏹ Berhenti mengawal' : '▶️ Mulai mengawal'}
        </button>
        {pesan && <p className="text-amber-700 text-[12px] font-bold">{pesan}</p>}
      </div>

      <div className="kartu p-4 space-y-2">
        <div className="flex items-end justify-between">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Status barisan</p>
          <p className="text-[22px] font-extrabold leading-none text-hijau">{aktif ? nIN + ' / ' + nEff : '— / —'}
            <span className="text-[11px] font-bold text-slate-400 block text-right">dalam radius</span></p>
        </div>
        {baris.map(({ m, s }) => (
          <div key={m.id} className={`rounded-xl border px-3 py-2.5 flex items-center gap-2
            ${s.mode === 'OUT' ? 'bg-red-50 border-red-300'
              : s.mode === 'LOST' ? 'bg-slate-100 border-slate-300'
              : s.mode === 'OFF' ? 'bg-slate-50 border-slate-200 opacity-75'
              : s.mode === 'TUNGGU' ? 'bg-amber-50 border-amber-300'
              : 'bg-emerald-50 border-emerald-200'}`}>
            <span className="text-lg">{s.mode === 'IN' ? '✅' : s.mode === 'OUT' ? '⚠️' : s.mode === 'LOST' ? '❓' : s.mode === 'OFF' ? '📡' : '🟡'}</span>
            <div className="flex-1 min-w-0">
              <b className="text-[13.5px] block truncate">{m.nama}</b>
              <span className={`text-[11px] ${s.mode === 'OUT' ? 'text-red-700 font-bold' : 'text-slate-500'}`}>{m.regu ? m.regu + ' · ' : ''}{teksStatus(s)}</span>
            </div>
            <span className="text-[12px] font-mono text-slate-600">{s.rssi != null ? s.rssi + ' dBm' : '—'}</span>
          </div>
        ))}
      </div>

      <div className="kartu p-4">
        <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">📍 Titik terakhir semua bersama</h3>
        {titik
          ? <p className="text-[13px] text-slate-700"><b>{relDtk(titik.t)}</b> · {titik.lat.toFixed(5)}, {titik.lng.toFixed(5)} ·{' '}
            <a className="text-hijau font-bold underline" href={`https://www.google.com/maps?q=${titik.lat},${titik.lng}`} target="_blank" rel="noreferrer">lihat di peta</a></p>
          : <p className="text-slate-400 text-[13px]">Belum tercatat — otomatis terekam saat semua dalam radius (butuh GPS).</p>}
      </div>
    </div>
  );
}
