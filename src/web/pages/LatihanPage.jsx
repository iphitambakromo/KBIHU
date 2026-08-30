import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

/* Latihan Mandiri — tautan pribadi jamaah (tanpa login).
   Peta besar di GPS sendiri + odometer anti-zigzag + checkpoint otomatis tiap 500 m
   + wake lock + outbox offline + motivasi milestone + istirahat otomatis. */

const jarakM = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const RITUAL_NAMA = i => ['Hotel→Haram', 'Tawaf', "Sa'i", '→Mina', '→Arafah', '→Muzdalifah', '→Mina (Jumrah)', '→Haram (Ifadah)', "Tawaf Wada'"][i] || ('#' + (i + 1));

export default function LatihanPage({ token }) {
  const [d, setD] = useState(null);          // profil + target + riwayat
  const [aktif, setAktif] = useState(null);  // {ritual, judul, target}
  const [meter, setMeter] = useState(0);
  const [gpsInfo, setGpsInfo] = useState('');
  const [pesan, setPesan] = useState('');
  const petaEl = useRef(null), map = useRef(null), rute = useRef(null), tanda = useRef(null);
  const ruteMentah = useRef([]);
  const lt = useRef({ akhir: null, t0: 0, aktifAwal: 0, lastGerak: 0, cpTerkirim: 0, milestone: {} });
  const watchRef = useRef(null); const wakeRef = useRef(null); const simRef = useRef(null);
  const posRef = useRef(null);
  const outbox = () => JSON.parse(localStorage.getItem('iphi_outbox') || '[]');
  const outboxSimpan = q => localStorage.setItem('iphi_outbox', JSON.stringify(q));

  /* ---------- muat profil & kirim ulang outbox ---------- */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/pub/latihan/' + encodeURIComponent(token));
        const dd = await r.json();
        setD(dd);
      } catch (e) { setD({ ok: false, error: 'periksa koneksi' }); }
    })();
    const kirimOutbox = async () => {
      const q = outbox(); if (!q.length) return;
      const sisa = [];
      for (const item of q) {
        try {
          const r = await fetch('/api/pub/latihan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) });
          if (!r.ok) sisa.push(item);
        } catch (e) { sisa.push(item); }
      }
      outboxSimpan(sisa);
    };
    kirimOutbox();
    window.addEventListener('online', kirimOutbox);
    return () => window.removeEventListener('online', kirimOutbox);
  }, [token]);

  /* ---------- peta ---------- */
  useEffect(() => {
    if (!d?.ok || !petaEl.current || map.current) return;
    map.current = L.map(petaEl.current, { zoomControl: true }).setView([-6.9932, 110.4203], 16);
    L.tileLayer(localStorage.getItem('iphi_peta') === 'satelit'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map.current);
    rute.current = L.polyline([], { color: '#0B5D3B', weight: 5, opacity: .75 }).addTo(map.current);
    tanda.current = L.circleMarker([-6.9932, 110.4203], { radius: 9, color: '#fff', weight: 3, fillColor: '#0B5D3B', fillOpacity: 1 }).addTo(map.current);
    setTimeout(() => map.current && map.current.invalidateSize(), 200);
    navigator.geolocation?.getCurrentPosition(p => {
      const c = p.coords;
      map.current?.setView([c.latitude, c.longitude], 17);
      tanda.current?.setLatLng([c.latitude, c.longitude]);
    }, () => {}, { enableHighAccuracy: true, timeout: 10000 });
  }, [d]);

  const perbaruiRute = (lat, lng) => {
    ruteMentah.current.push([lat, lng]);
    if (ruteMentah.current.length > 3000) ruteMentah.current.shift();
    const n = ruteMentah.current.length, halus = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      let sx = 0, sy = 0, c = 0;
      for (let k = a; k <= b; k++) { sx += ruteMentah.current[k][0]; sy += ruteMentah.current[k][1]; c++; }
      halus.push([sx / c, sy / c]);
    }
    rute.current?.setLatLngs(halus);
  };

  /* ---------- kirim (checkpoint & akhir) dgn outbox ---------- */
  const kirim = async (payload) => {
    try {
      const r = await fetch('/api/pub/latihan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw 0;
    } catch (e) { outboxSimpan([...outbox(), payload]); setPesan('📴 Offline — hasil disimpan di HP, terkirim otomatis saat online'); }
  };

  /* ---------- odometer ---------- */
  const mulai = (i) => {
    const t = (d.target || [])[i]; if (!t) return;
    setAktif({ ritual: i, judul: t.nama, target: t.target_m });
    setMeter(0); setPesan('');
    ruteMentah.current = []; rute.current?.setLatLngs([]);
    lt.current = { akhir: null, t0: Date.now(), aktifAwal: 0, lastGerak: Date.now(), cpTerkirim: 0, milestone: {} };
    setGpsInfo('📡 Mencari sinyal GPS… izinkan lokasi, tunggu di ruang terbuka.');
    petaEl.current?.scrollIntoView({ behavior: 'smooth' });
    // wake lock: layar tetap menyala selama latihan (HP boleh di saku terbalik)
    navigator.wakeLock?.request('screen').then(w => { wakeRef.current = w; }).catch(() => {});
    
    // Cek native GPS dulu
    const isNative = typeof window !== 'undefined' && typeof window.Android !== 'undefined';
    
    if (isNative && window._nativeLat && window._nativeLng && window._nativeLat !== 0) {
      // Gunakan native GPS
      const c = { latitude: window._nativeLat, longitude: window._nativeLng, accuracy: window._nativeAcc || 20 };
      posRef.current = { lat: c.latitude, lng: c.longitude };
      tanda.current?.setLatLng([c.latitude, c.longitude]);
      if (map.current) map.current.panTo([c.latitude, c.longitude]);
      setGpsInfo(`✅ GPS aktif (±${Math.round(c.accuracy)} m) — jalan dulu, angka bertambah sendiri`);
      
      // Update dari native GPS callback
      window._latihanGpsUpdate = (lat, lng, acc) => {
        posRef.current = { lat, lng };
        tanda.current?.setLatLng([lat, lng]);
        if (map.current) map.current.panTo([lat, lng]);
        // Proses GPS seperti biasa
        const L0 = lt.current;
        if (!L0.akhir) { L0.akhir = { lat, lng, ts: Date.now() }; perbaruiRute(lat, lng); return; }
        const dJ = jarakM(L0.akhir, { lat, lng });
        const dt = (Date.now() - L0.akhir.ts) / 1000;
        const v = dt > 0 ? dJ / dt : 9;
        const minM = Math.max(6, acc * 0.7);
        if (dJ >= minM && v > 0.2 && v < 3.2) {
          L0.akhir = { lat, lng, ts: Date.now() };
          L0.lastGerak = Date.now();
          perbaruiRute(lat, lng);
        }
      };
    } else {
      // Fallback ke browser geolocation
      watchRef.current = navigator.geolocation.watchPosition(p => {
      const c = p.coords, ak = c.accuracy || 30;
      posRef.current = { lat: c.latitude, lng: c.longitude };
      tanda.current?.setLatLng([c.latitude, c.longitude]);
      if (!map.current) return;
      const pNext = map.current.getCenter();
      if (jarakM({ lat: pNext.lat, lng: pNext.lng }, { lat: c.latitude, lng: c.longitude }) > 3) map.current.panTo([c.latitude, c.longitude]);
      if (ak > 45) { setGpsInfo(`📡 Sinyal lemah (±${Math.round(ak)} m) — jalan ke tempat lebih terbuka…`); return; }
      const L0 = lt.current;
      if (!L0.akhir) { L0.akhir = { lat: c.latitude, lng: c.longitude, ts: p.timestamp }; perbaruiRute(c.latitude, c.longitude); setGpsInfo(`✅ GPS aktif (±${Math.round(ak)} m) — jalan dulu, angka bertambah sendiri`); return; }
      const dJ = jarakM(L0.akhir, { lat: c.latitude, lng: c.longitude });
      const dt = (p.timestamp - L0.akhir.ts) / 1000;
      const v = dt > 0 ? dJ / dt : 9;
      const minM = Math.max(6, ak * 0.7);
      if (dJ >= minM && v > 0.2 && v < 3.2) {
        L0.akhir = { lat: c.latitude, lng: c.longitude, ts: p.timestamp };
        L0.lastGerak = Date.now();
        perbaruiRute(c.latitude, c.longitude);
        setMeter(m => {
          const nm = m + dJ;
          const pct = nm / t.target_m;
          for (const batas of [0.25, 0.5, 0.75, 1]) {
            if (pct >= batas && !L0.milestone[batas]) {
              L0.milestone[batas] = 1;
              const mCapai = Math.round(nm);
              setPesan(batas === 1 ? '🎉 TARGET TERCAPAI! MasyaAllah, fisik Anda siap!' :
                batas === 0.75 ? `💪 ${Math.round(t.target_m * 0.75).toLocaleString('id-ID')} m dilewati — sedikit lagi, istiqamah!` :
                batas === 0.5 ? `🌳 Separuh jalan — ${Math.round(t.target_m * 0.5).toLocaleString('id-ID')} m! Teruskan, semangat!` : `👍 ${mCapai.toLocaleString('id-ID')} m — pemanasan bagus!`);
            }
          }
          // checkpoint tiap 500 m — aman walau baterai mati / HP di saku lama
          if (nm - L0.cpTerkirim >= 500) {
            L0.cpTerkirim = nm;
            kirim({ token, ritual: i, jarakM: 500, durasiS: 0, aktifS: 0, selesai: false, cp: true });
          }
          return nm;
        });
      } else if (Date.now() - L0.lastGerak > 120000) {
        setGpsInfo('💤 Istirahat terdeteksi — santai dulu, lanjut lagi kapan saja. (Waktu istirahat tidak dihitung waktu aktif)');
      }
    }, err => {
      setGpsInfo(err.code === 1 ? '🔒 Akses lokasi DITOLAK — ketuk ikon gembok di address bar → Izinkan → muat ulang.' :
        err.code === 3 ? '⏱ GPS lama merespons — mulai lagi di ruang terbuka.' : '⚠️ GPS gagal: ' + err.message);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    }
  };

  const aktifS = () => {
    const L0 = lt.current;
    return Math.round((L0.aktifAwal + Math.max(0, Date.now() - L0.t0 - (Date.now() - L0.lastGerak > 120000 ? Date.now() - L0.lastGerak - 120000 : 0))) / 1000);
  };

  const selesai = async (klaim) => {
    if (!aktif) return;
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    try { wakeRef.current?.release(); } catch (e) {}
    clearInterval(simRef.current);
    const capai = klaim || meter >= aktif.target;
    await kirim({ token, ritual: aktif.ritual, jarakM: Math.round(meter), durasiS: Math.round((Date.now() - lt.current.t0) / 1000), aktifS: aktifS(), selesai: capai });
    setPesan(capai ? `🎉 Tersimpan: ${Math.round(meter).toLocaleString('id-ID')} m — ${aktif.judul} TERCAPAI!` :
      `✅ Tersimpan ${Math.round(meter).toLocaleString('id-ID')} m dari ${aktif.target.toLocaleString('id-ID')} m — pelan-pelan, rutin saja.`);
    setAktif(null); setMeter(0);
    const r = await fetch('/api/pub/latihan/' + encodeURIComponent(token)).then(x => x.json());
    if (r.ok) setD(r);
  };

  const resetSendiri = async () => {
    if (!confirm('Bersihkan SEMUA histori latihan Anda dan mulai dari awal?')) return;
    const r = await fetch('/api/pub/latihan/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }).then(x => x.json());
    if (r.ok) { setD(prev => ({ ...prev, progres: { per: {}, meter: 0, sesi: 0 }, riwayat: [] })); setPesan(`🔄 Histori dibersihkan (${r.terhapus} catatan) — selamat mulai dari awal!`); }
  };

  if (!d) return <div className="min-h-full grid place-items-center text-slate-500 font-bold">Memuat…</div>;
  if (!d.ok) return (
    <div className="min-h-full grid place-items-center p-6">
      <div className="kartu p-8 text-center max-w-sm"><div className="text-4xl">🔒</div>
        <p className="font-extrabold mt-2">Tautan latihan tidak valid</p>
        <p className="text-slate-500 text-sm mt-1">Minta pembimbing mengirim ulang tautan pribadi Anda.</p></div>
    </div>);

  const pr = d.progres || { per: {}, meter: 0, sesi: 0 };
  const pct = aktif ? Math.min(100, Math.round(meter / aktif.target * 100)) : 0;
  const totalPct = Math.min(100, Math.round(pr.meter / (d.totalTarget || 1) * 100));

  return (
    <div className="min-h-full bg-[#EEF3F0] pb-10">
      {/* header profil */}
      <div className="bg-gradient-to-r from-hijau to-hijau2 text-white p-4 text-center">
        <h1 className="font-extrabold text-[17px]">🥾 Latihan Mandiri — IPHI</h1>
        <p className="text-white/85 text-[13px] mt-1">Salam kenal, <b>{d.jamaah.nama}</b> — Regu {d.jamaah.regu || '-'}<br />
          <small className="text-white/75">Rutin berlatih dari rumah agar kaki siap menempuh jarak ibadah yang sebenarnya</small></p>
        <div className="mt-2 bg-white/15 border border-white/25 rounded-full px-4 py-1.5 text-[13px] font-extrabold inline-block">
          Total: {pr.meter.toLocaleString('id-ID')} m {d.totalTarget > pr.meter ? `· sisa ${(d.totalTarget - pr.meter).toLocaleString('id-ID')} m menuju siap` : '· 🎉 SEMUA TARGET SIAP!'}
        </div>
      </div>

      {/* peta + odometer */}
      <div className="p-3 max-w-2xl mx-auto">
        <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
          <div ref={petaEl} className="h-[52vh] min-h-[320px]" />
          <div className="absolute inset-x-0 bottom-0 z-[1000] bg-gradient-to-t from-black/85 to-transparent text-white p-4 pt-8 pointer-events-none">
            {aktif ? <>
              <p className="text-[13px] font-extrabold text-center">{aktif.judul}</p>
              <p className="text-[42px] font-black text-center leading-none my-1">
                {Math.round(meter).toLocaleString('id-ID')} <small className="text-base opacity-80">/ {aktif.target.toLocaleString('id-ID')} m</small>
              </p>
              {/* TALI UKUR: pita 0 → target; tick tiap 250 m, angka tiap 500 m, bendera = posisi sekarang */}
              {(() => {
                const T = aktif.target;
                const tick = []; for (let t = 0; t <= T; t += 250) tick.push(t);
                const lab = tick.filter(t => t % 500 === 0 || t === T);
                const pos = Math.max(2, Math.min(98, Math.round(meter / T * 100)));
                return (
                  <div className="relative h-11 mt-1 mx-1">
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-4 bg-white/15 rounded border border-white/30 overflow-hidden">
                      <div className="h-full bg-emerald-400/90 transition-all duration-500" style={{ width: Math.min(100, meter / T * 100) + '%' }} />
                      {tick.map(tl => (
                        <div key={tl} className={tl % 500 === 0 ? 'absolute top-0 h-2 w-px bg-white/80' : 'absolute top-0 h-1.5 w-px bg-white/45'}
                             style={{ left: (tl / T * 100) + '%' }} />
                      ))}
                    </div>
                    {lab.map(tl => (
                      <span key={tl} className="absolute -translate-x-1/2 text-[8.5px] font-extrabold text-white/80 whitespace-nowrap"
                            style={{ left: (tl / T * 100) + '%', top: 'calc(50% + 10px)' }}>
                        {tl === 0 ? '0' : tl >= 1000 ? (tl / 1000) + ' km' : tl + ' m'}
                      </span>
                    ))}
                    <div className="absolute top-0 -translate-x-1/2" style={{ left: pos + '%' }}>
                      <div className="bg-amber-400 text-slate-900 text-[11px] font-extrabold px-1.5 py-0.5 rounded-md shadow whitespace-nowrap">{Math.round(meter).toLocaleString('id-ID')} m</div>
                      <div className="w-0.5 h-1.5 bg-amber-400 mx-auto" />
                    </div>
                  </div>
                );
              })()}
            </> : <p className="text-center text-[13.5px] font-bold">Pilih jenis latihan di bawah 👇 lalu tekan <b>Mulai</b> — HP boleh di saku (biarkan layar menyala)</p>}
          </div>
        </div>
        {aktif && (
          <div className="flex gap-2 mt-3">
            <button className="btn btn-muda flex-1" onClick={() => selesai(false)}>⏸ Selesai & Simpan</button>
            <button className="btn btn-utama flex-1" onClick={() => selesai(true)}>🏁 Tercapai!</button>
          </div>
        )}
        {gpsInfo && <p className="text-[12.5px] text-slate-600 mt-2 text-center leading-relaxed">{gpsInfo}</p>}
        {pesan && <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-[13.5px] font-bold text-hijau text-center">{pesan}</div>}

        {/* daftar ritual */}
        <div className="kartu p-4 mt-3">
          <b className="text-hijau text-[12px] uppercase tracking-wide">🕋 Daftar Latihan — jarak ibadah sebenarnya</b>
          <div className="mt-2 divide-y divide-slate-100">
            {(d.target || []).map((t, i) => {
              const p = pr.per?.[String(i + 1)] || { meter: 0, sesi: 0 };
              const pp = Math.min(100, Math.round(p.meter / t.target_m * 100));
              const prio = /PRIORITAS/i.test(t.keterangan || '');
              const ringan = t.target_m <= 3000;
              return (
                <div key={i} className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <b className="text-[14px]">{i + 1}. {t.nama} {prio && <span title="prioritas">⭐</span>}{ringan && !prio && <span title="mulai dari sini">🌱</span>}</b>
                      <small className="text-slate-500 block leading-snug">{t.keterangan}</small>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1.5 max-w-[260px]"><div className="h-full bg-hijau" style={{ width: pp + '%' }} /></div>
                      <small className="text-slate-500 font-bold">{p.meter.toLocaleString('id-ID')} m · {p.sesi} sesi</small>
                    </div>
                    <span className="font-black text-hijau text-[13px] whitespace-nowrap">{t.target_m.toLocaleString('id-ID')} m</span>
                    <button className={`btn ${p.meter > 0 ? 'btn-muda' : 'btn-utama'} !min-h-[46px] !px-4 !text-[13px]`} disabled={!!aktif} onClick={() => mulai(i)}>{p.meter > 0 ? 'Lanjut' : 'Mulai'}</button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">🌱 = ringan, cocok memulai · ⭐ = prioritas ibadah · Titik berangkat: Novotel Thakher City (±2,5 km dari Masjidil Haram). Jalan ke mana pun sah — putaran keliling pun dihitung.</p>
        </div>

        {/* riwayat + reset */}
        <div className="kartu p-4 mt-3">
          <b className="text-hijau text-[12px] uppercase tracking-wide">📜 Riwayat Anda</b>
          <div className="mt-2 text-[12.5px] leading-relaxed">
            {(d.riwayat || []).slice(0, 12).map(x => (
              <div key={x.id} className="border-b border-dashed border-slate-200 py-1.5 last:border-0">
                {new Date(x.waktu).toLocaleDateString('id-ID')} — <b>{Math.round(x.jarak_m).toLocaleString('id-ID')} m</b>{x.selesai ? ' ✅' : ''}
                <small className="text-slate-400"> (target {((d.target || [])[x.ritual - 1] || {}).target_m?.toLocaleString('id-ID') || '-'} m{x.aktif_s ? ` · aktif ${Math.round(x.aktif_s / 60)} mnt` : ''})</small>
              </div>
            ))}
            {(!d.riwayat || !d.riwayat.length) && <p className="text-slate-500">Belum ada.</p>}
          </div>
          {pr.sesi > 0 && <button className="btn btn-emas w-full mt-3" onClick={resetSendiri}>🔄 Mulai dari Awal — bersihkan histori</button>}
        </div>
      </div>
    </div>
  );
}
