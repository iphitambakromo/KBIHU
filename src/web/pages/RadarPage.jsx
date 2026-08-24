import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

/* Radar Gelang — publik. Mode Cari: getar panas-dingin + bar sinyal + bunyikan gelang. */
export default function RadarPage() {
  const hash = location.hash || '';
  const pasangId = (hash.match(/pasang=([^&]+)/) || [])[1] ? decodeURIComponent(hash.match(/pasang=([^&]+)/)[1]) : '';
  const cariId = (hash.match(/cari=([^&]+)/) || [])[1] ? decodeURIComponent(hash.match(/cari=([^&]+)/)[1]) : '';
  const [gps, setGps] = useState(null);
  const [log, setLog] = useState([]);
  const [scanAktif, setScanAktif] = useState(false);
  const [pasangInfo, setPasangInfo] = useState('');
  const [pasangNama, setPasangNama] = useState('…');
  const [acara, setAcara] = useState(null);
  // mode cari
  const [cari, setCari] = useState(null);          // {id, nama, foto, regu, beacon_id}
  const [sinyal, setSinyal] = useState(null);       // {rssi, pct, label, warna}
  const [cariStatus, setCariStatus] = useState('');
  const petaRef = useRef(null); const mapRef = useRef(null); const sayaRef = useRef(null);
  const terlapor = useRef({});
  const scanHandle = useRef(null);
  const cariScanRef = useRef(null);
  const cariRef = useRef(null);   // akses cari di dalam event listener (hindari closure stale)
  const getarRef = useRef(null);
  const bunyiRef = useRef(0);
  const [bunyiCooldown, setBunyiCooldown] = useState(0);
  /* MAC -> nama jamaah (membedakan iTag yang namanya seragam) */
  const [namaMap, setNamaMap] = useState({});          // mac -> {nama, regu}
  const namaMapRef = useRef({});
  const [pasangList, setPasangList] = useState([]);    // [{mac, rssi, pct}]
  const [pasangScan, setPasangScan] = useState(false);
  const pasangScanRef = useRef(null);
  const pasangRssiRef = useRef({});                    // mac -> {rssi, t}
  const pasangHandlerRef = useRef(null);
  const [deteksi, setDeteksi] = useState(0);        // jumlah tag unik saat scan pasang
  const emptyTimerRef = useRef(null);
  useEffect(() => { namaMapRef.current = namaMap; }, [namaMap]);
  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/pub/gelang').then(r => r.json());
        if (d.ok) { const m = {}; (d.gelang || []).forEach(g => { m[g.mac] = g; }); setNamaMap(m); }
      } catch (e) {}
    })();
  }, []);
  useEffect(() => {
    const h = (ev) => {
      const id = ev.device.id || ev.device.name;
      if (!id) return;
      const kini = Date.now();
      const rssi = Number.isFinite(ev.rssi) ? ev.rssi : -100;
      const st = pasangRssiRef.current;
      if (!st[id] || rssi > st[id].rssi) st[id] = { rssi, t: kini };
      for (const k of Object.keys(st)) if (kini - st[k].t > 4000) delete st[k];
      const list = Object.entries(st).map(([mac, v]) => ({ mac, rssi: v.rssi, pct: rssiKePct(v.rssi) }));
      list.sort((a, b) => b.rssi - a.rssi);
      setPasangList(list.slice(0, 12));
      setDeteksi(Object.keys(st).length);
    };
    pasangHandlerRef.current = h;
    return () => {
      try { navigator.bluetooth?.removeEventListener('advertisementreceived', h); } catch (e) {}
      try { pasangScanRef.current?.stop(); } catch (e) {}
      clearTimeout(emptyTimerRef.current);
    };
  }, []);

  const tambahLog = (html, warn = false) => setLog(l => [{ html, warn, jam: new Date().toLocaleTimeString('id-ID') }, ...l].slice(0, 40));

  /* GPS + peta kecil */
  useEffect(() => {
    if (!navigator.geolocation) { setGps({ gagal: true }); return; }
    navigator.geolocation.getCurrentPosition(p => {
      const g = { lat: p.coords.latitude, lng: p.coords.longitude, ak: p.coords.accuracy };
      setGps(g);
      if (mapRef.current) return;
      setTimeout(() => {
        if (!petaRef.current) return;
        mapRef.current = L.map(petaRef.current, { zoomControl: false }).setView([g.lat, g.lng], 16);
        L.tileLayer(localStorage.getItem('iphi_peta') === 'satelit'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapRef.current);
        L.circle([g.lat, g.lng], { radius: 25, color: '#2A6FDB', weight: 1, fillOpacity: .12 }).addTo(mapRef.current);
        sayaRef.current = L.circleMarker([g.lat, g.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2A6FDB', fillOpacity: 1 }).addTo(mapRef.current);
        setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 200);
      }, 60);
    }, () => setGps({ gagal: true }), { enableHighAccuracy: true, timeout: 12000 });
  }, []);

  useEffect(() => {
    (async () => {
      try { const d = await fetch('/api/absensi/aktif').then(r => r.json()); if (d.ok && d.event) setAcara(d.event); } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    if (!pasangId) return;
    const TOK = localStorage.getItem('iphi_tok') || '';
    if (!TOK) return;
    (async () => {
      const st = await fetch('/api/state', { headers: { authorization: 'Bearer ' + TOK } }).then(r => r.json());
      const m = (st.jamaah || []).find(x => x.id === pasangId);
      if (m) setPasangNama(m.nama + (m.beacon_id ? ' (⌚ ' + m.beacon_id + ')' : ''));
    })();
  }, [pasangId]);

  /* ===== MODE CARI ===== */
  useEffect(() => { cariRef.current = cari; }, [cari]);
  useEffect(() => {
    if (!cariId) return;
    (async () => {
      const r = await fetch('/api/pub/cari-mulai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jamaahId: cariId }) }).then(x => x.json());
      if (r.ok && r.jamaah.punya_gelang && r.jamaah.beacon_id) {
        setCari(r.jamaah);
        setCariStatus('🔵 JAUH — mulai berjalan perlahan ke segala arah');
        tambahLog(`🔍 <b>Mode Cari dimulai</b> untuk ${r.jamaah.nama}`);
        mulaiCariScan(r.jamaah.beacon_id);
      } else if (r.ok) {
        tambahLog(`⚠️ ${r.jamaah?.nama || 'Jamaah'} belum punya gelang terpasang — pasangkan dulu lewat Kelola Jamaah`, true);
      }
    })();
    return () => { hentiCariScan(); };
  }, [cariId]);

  const rssiKePct = (rssi) => Math.max(0, Math.min(100, Math.round((rssi + 90) / 50 * 100)));
  const pendek = (id) => String(id || '').replace(/=+$/, '').slice(-4); // 4 char terakhir kode tag (tanpa padding base64)
  const rssiKeLabel = (rssi) => {
    if (rssi > -50) return { label: '🎯 DITEMUKAN! Tekan 🔊', warna: 'bg-red-500', vibrate: [100,50,100,50,100,50,100,50,100,50,100] };
    if (rssi > -65) return { label: '🔴 SANGAT DEKAT', warna: 'bg-red-400', vibrate: [100,100,100,100,100,100,100] };
    if (rssi > -75) return { label: '🟡 DEKAT — teruskan', warna: 'bg-yellow-400', vibrate: [200,400,200,400,200] };
    if (rssi > -85) return { label: '🟢 ADA SINYAL — jalan', warna: 'bg-emerald-400', vibrate: [200,2000] };
    return { label: '🔵 JAUH — jalan perlahan', warna: 'bg-blue-400', vibrate: [200,4000] };
  };

  const mulaiCariScan = async (beaconId) => {
    if (!navigator.bluetooth) { setCariStatus('⚠️ Browser tidak mendukung bluetooth — gunakan Chrome Android'); return; }
    try {
      cariScanRef.current = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
      navigator.bluetooth.addEventListener('advertisementreceived', ev => {
        if (!cariRef.current) return;
        const id = ev.device.id || ev.device.name;
        if (id !== beaconId) return;
        const rssi = ev.rssi || -100;
        const pct = rssiKePct(rssi);
        const info = rssiKeLabel(rssi);
        setSinyal({ rssi, pct, ...info });
        setCariStatus(info.label);
        navigator.vibrate?.(info.vibrate);
      });
    } catch (e) {
      setCariStatus('⚠️ Tidak bisa memindai — pastikan Bluetooth aktif & gunakan Chrome Android');
    }
  };
  const hentiCariScan = () => {
    try { cariScanRef.current?.stop(); } catch (e) {}
    cariScanRef.current = null;
    navigator.vibrate?.(0);
  };

  const bunyikanGelang = async () => {
    if (!cari || !cari.beacon_id) return;
    if (Date.now() - bunyiRef.current < 5000) { setBunyiCooldown(Math.ceil((5000 - (Date.now() - bunyiRef.current)) / 1000)); return; }
    bunyiRef.current = Date.now();
    setBunyiCooldown(5);
    const cd = setInterval(() => setBunyiCooldown(c => c > 0 ? c - 1 : 0), 1000);
    setTimeout(() => clearInterval(cd), 5000);
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [0x1802] }],
        optionalServices: [0x1802, 0xFFF0]
      });
      const server = await device.gatt.connect();
      try {
        const sv = await server.getPrimaryService(0x1802);
        const ch = await sv.getCharacteristic(0x2A06);
        await ch.writeValue(new Uint8Array([2]));
        setTimeout(async () => { try { await ch.writeValue(new Uint8Array([0])); } catch (e) {} try { server.disconnect(); } catch (e) {} }, 3500);
      } catch (e) {
        try { const sv2 = await server.getPrimaryService(0xFFF0);
          const cs = await sv2.getCharacteristics();
          const w = cs.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (w) { await w.writeValue(new Uint8Array([1])); setTimeout(() => { try { server.disconnect(); } catch (e) {} }, 3500); }
        } catch (e2) {}
      }
    } catch (e) { /* batal pilih */ }
  };

  const selesaiCari = async () => {
    if (!cari) return;
    hentiCariScan();
    navigator.vibrate?.([800]);
    try {
      const pos = await new Promise(res => navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 8000 }));
      const r = await fetch('/api/pub/cari-selesai', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jamaahId: cari.id, lat: pos?.lat, lng: pos?.lng, oleh: 'pencari' }) }).then(x => x.json());
      tambahLog(`🎯 <b>${cari.nama} DITEMUKAN!</b> Posisi tercatat di dashboard.`);
    } catch (e) { tambahLog('⚠️ Gagal mencatat — cek koneksi', true); }
    setCari(null); setSinyal(null); setCariStatus('');
  };

  /* akhir MODE CARI */

  const labelJarak = rssi => rssi == null ? '' : rssi > -60 ? 'sangat dekat (<±3 m)' : rssi > -80 ? 'dekat (±3-10 m)' : 'tepi jangkauan (±10-25 m)';

  async function lapor(device, rssi) {
    const id = device.id || device.name;
    const kini = Date.now();
    if (terlapor.current[id] && kini - terlapor.current[id] < 120000) return;
    terlapor.current[id] = kini;
    const nm = namaMapRef.current[id];
    tambahLog(`⏳ Melaporkan <b>${nm ? nm.nama : (device.name || 'tag')}</b>${nm ? ` <small class="text-slate-400">iTag …${pendek(id)}</small>` : ''}…`);
    try {
      const r = await fetch('/api/pub/ble', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ beaconId: id, lat: gps ? gps.lat : undefined, lng: gps ? gps.lng : undefined, oleh: 'gotong-royong', rssi }) });
      const d = await r.json();
      if (d.ok) tambahLog(`✅ <b>${d.jamaah}</b> tercatat${d.titik ? ' — di ' + d.titik : ''}${labelJarak(rssi) ? ' · ' + labelJarak(rssi) : ''}` +
          (d.absensi?.hadir ? ` · <b>HADIR</b>` : ''));
      else tambahLog(`⚠️ Tag tidak terdaftar`, true);
    } catch (e) { tambahLog('❌ Gagal kirim — periksa internet', true); }
  }

  async function bunyikan(device) {
    const gagal = (info) => ({ ok: false, info });
    try {
      const server = await device.gatt.connect();
      const putuskan = () => setTimeout(() => { try { server.disconnect(); } catch (e) {} }, 4000);
      try { const sv = await server.getPrimaryService(0x1802); const ch = await sv.getCharacteristic(0x2A06);
        await ch.writeValue(new Uint8Array([2]));
        setTimeout(() => { ch.writeValue(new Uint8Array([0])).catch(() => {}); }, 1000);
        putuskan(); return { ok: true, info: 'servis baterai' };
      } catch (e) {}
      try { const sv2 = await server.getPrimaryService(0xFFE0); const ch2 = await sv2.getCharacteristic(0xFFE1);
        await ch2.writeValue(new Uint8Array([1])); putuskan(); return { ok: true, info: 'servis iTag' }; } catch (e) {}
      try { const sv3 = await server.getPrimaryService(0xFFF0); const cs = await sv3.getCharacteristics();
        const w = cs.find(c => c.properties.write || c.properties.writeWithoutResponse);
        if (w) { await w.writeValue(new Uint8Array([1])); putuskan(); return { ok: true, info: 'servis 0xFFF0' }; }
        return gagal('tag tidak punya servis bunyi yang dikenal');
      } catch (e) {}
      return gagal('tag tidak punya servis bunyi yang dikenal');
    } catch (e) { return gagal('gagal terhubung ke tag'); }
  }

  async function pilihTag(untukPasang = false) {
    if (!navigator.bluetooth?.requestDevice) { tambahLog('Butuh Chrome di Android', true); return null; }
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [0x1802, 0x180F, 0xFFF0, 0xFFE0] });
      if (untukPasang) return device;
      const bunyi = await bunyikan(device);
      tambahLog(bunyi.ok ? '🔊 Gelang dibunyikan — dekati!' : 'Tag terpilih (perintah bunyi tidak didukung tag ini)');
      await lapor(device, null);
      return device;
    } catch (e) { return null; }
  }

  async function mulaiPindai() {
    if (!navigator.bluetooth) { tambahLog('Gunakan Chrome Android', true); return; }
    if (scanHandle.current) { scanHandle.current.stop(); scanHandle.current = null; setScanAktif(false); tambahLog('⏹ Dihentikan'); return; }
    try {
      scanHandle.current = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
      setScanAktif(true);
      tambahLog('🟢 Memindai… biarkan layar menyala.');
      navigator.bluetooth.addEventListener('advertisementreceived', ev => lapor(ev.device, ev.rssi));
    } catch (e) { tambahLog(`⚠️ Gagal memindai (${(e && e.name) || 'gagal'}) — pakai 📲 Pilih Tag Manual`, true); }
  }

  async function pasangkan() {
    if (!pasangId) return;
    setPasangInfo('Dekatkan HANYA gelang jamaah ini (±30 cm), lalu pilih tag-nya dari daftar…');
    const device = await pilihTag(true);
    if (!device) { setPasangInfo('❌ Tidak ada tag dipilih'); return; }
    const hasilBunyi = await bunyikan(device);
    const namaBersih = (pasangNama || 'jamaah').replace(/ \(⌚.*$/, '');
    setPasangInfo(hasilBunyi.ok
      ? `🔊 Tag "${device.name || 'tag'}" (⌚ …${pendek(device.id)}) BERBUNYI — ini tag yang benar.`
      : `Tag terpilih: "${device.name || 'tag'}" (⌚ …${pendek(device.id)}). Perintah bunyi: ${hasilBunyi.info} — wajar, sebagian iTag bunyinya saat tersambung/terputus, bukan lewat web.`);
    if (!confirm(`Simpankan tag ini untuk ${namaBersih}?`)) { try { device.gatt.disconnect(); } catch (e) {} setPasangInfo('Batal.'); return; }
    try { device.gatt.disconnect(); } catch (e) {}
    const r = await fetch('/api/jamaah', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.getItem('iphi_tok') },
      body: JSON.stringify({ id: pasangId, punya_gelang: true, beacon_id: device.id }) });
    const d = await r.json();
    setPasangInfo(d.ok ? `✅ Tersimpan: ${namaBersih} ⌚ …${pendek(device.id)} — tag bisa berbunyi saat koneksi putus (normal)` : '❌ Gagal: ' + (d.error || ''));
  }

  /* ===== PASANG VIA SINYAL: tanpa dialog pemilih — tag sinyal-terkuat = tag di tangan ===== */
  async function pasangViaSinyal() {
    if (!navigator.bluetooth?.requestLEScan) { setPasangInfo('⚠️ Browser ini tidak mendukung scan sinyal — pakai 📲 Manual'); return; }
    if (pasangScanRef.current) { hentiPasangSinyal(); setPasangInfo('⏹ Dihentikan'); return; }
    try {
      pasangScanRef.current = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
      navigator.bluetooth.addEventListener('advertisementreceived', pasangHandlerRef.current);
      setPasangScan(true); setDeteksi(0);
      setPasangInfo('📶 Scan aktif — tag yang mendekat akan muncul di daftar. Kunci baris teratas (🎯 = sinyal terkuat).');
      clearTimeout(emptyTimerRef.current);
      emptyTimerRef.current = setTimeout(() => {
        if (Object.keys(pasangRssiRef.current).length === 0)
          setPasangInfo('📶 Scan berjalan tapi tag belum terlihat. Pastikan: tag menyala, dekat (±1 m), Bluetooth HP aktif. Atau pakai 📲 Manual.');
      }, 8000);
    } catch (e) {
      const nm = (e && e.name) || 'gagal';
      setPasangInfo(nm === 'NotAllowedError'
        ? '⚠️ HP menolak izin "memindai perangkat Bluetooth" (izin ini BERBEDA dari izin pilih tag). Buka ikon gembok 🔒 di address bar → Bluetooth → izinkan "memindai" → coba lagi. Atau pakai 📲 Manual.'
        : `⚠️ Gagal memindai (${nm}: ${(e && e.message) || ''}) — pakai 📲 Manual`);
    }
  }
  const hentiPasangSinyal = () => {
    try { pasangScanRef.current?.stop(); } catch (e) {}
    pasangScanRef.current = null;
    clearTimeout(emptyTimerRef.current);
    try { navigator.bluetooth?.removeEventListener('advertisementreceived', pasangHandlerRef.current); } catch (e) {}
    setPasangScan(false); setPasangList([]); setDeteksi(0); pasangRssiRef.current = {};
  };
  async function kunciTag(mac) {
    if (!pasangId) return;
    hentiPasangSinyal();
    const namaBersih = (pasangNama || 'jamaah').replace(/ \(⌚.*$/, '');
    const sudah = namaMapRef.current[mac];
    const pesan = (sudah && sudah.nama !== namaBersih)
      ? `⚠️ Tag ini sudah terpasang ke ${sudah.nama}. Pindahkan ke ${namaBersih}?`
      : `Simpan tag ini untuk ${namaBersih}?`;
    if (!confirm(pesan)) return;
    const r = await fetch('/api/jamaah', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.getItem('iphi_tok') },
      body: JSON.stringify({ id: pasangId, punya_gelang: true, beacon_id: mac }) });
    const d = await r.json();
    if (d.ok) {
      setNamaMap(m => ({ ...m, [mac]: { nama: namaBersih, regu: '' } }));
      setPasangInfo(`✅ Tersimpan: ${namaBersih} ⌚ …${pendek(mac)} — ulangi untuk jamaah berikutnya (tombol ⌚ di dashboard).`);
      tambahLog(`⌚ <b>${namaBersih}</b> tersandingkan ke tag …${pendek(mac)}`);
    } else setPasangInfo('❌ Gagal: ' + (d.error || ''));
  }

  return (
    <div className="min-h-full bg-[#EEF3F0] p-3 pb-10 max-w-2xl mx-auto">
      <div className="bg-gradient-to-r from-hijau to-hijau2 text-white rounded-2xl p-4 text-center">
        <h1 className="font-extrabold text-[17px]">📡 Radar Gelang BLE</h1>
        <p className="text-white/85 text-[12px] mt-1">Deteksi gelang jamaah ±25 m — tercatat ke dashboard & absensi.</p>
      </div>

      {/* ===== MODE CARI ===== */}
      {cari && (
        <div className="mt-3 bg-white border-2 border-red-400 rounded-2xl overflow-hidden shadow-lg">
          <div className="bg-red-500 text-white p-3 text-center">
            <b className="text-[15px]">🔍 MENCARI</b>
          </div>
          <div className="p-4 text-center">
            {cari.foto
              ? <img src={cari.foto} alt="" className="w-20 h-20 rounded-2xl object-cover mx-auto border-2 border-red-200" />
              : <div className="w-20 h-20 rounded-2xl bg-red-50 grid place-items-center text-3xl font-black text-red-500 mx-auto border-2 border-red-200">{(cari.nama || '?').replace(/^(H\.|Hj\.)\s*/, '').split(' ').slice(0, 2).map(x => x[0]).join('')}</div>}
            <h2 className="font-extrabold text-[17px] mt-2">{cari.nama}</h2>
            <p className="text-slate-500 text-[12px]">{cari.regu} · ⌚ {cari.beacon_id?.slice(0, 17)}</p>

            {/* Bar sinyal */}
            <div className="mt-4">
              <div className="h-6 bg-slate-100 rounded-full overflow-hidden mx-4">
                <div className={`h-full transition-all duration-500 ${sinyal ? sinyal.warna : 'bg-slate-200'}`} style={{ width: (sinyal?.pct || 0) + '%' }} />
              </div>
              <p className={`font-extrabold text-[15px] mt-2 ${sinyal ? (sinyal.pct > 70 ? 'text-red-600' : sinyal.pct > 40 ? 'text-amber-600' : 'text-blue-600') : 'text-slate-400'}`}>
                {cariStatus || '🔵 JAUH — mulai berjalan'}
              </p>
              {sinyal && <small className="text-slate-400">RSSI {sinyal.rssi} dBm · {sinyal.pct}%</small>}
            </div>

            {/* Tombol */}
            <div className="flex gap-2 mt-4 px-2">
              <button className={`btn flex-1 !text-[14px] ${bunyiCooldown > 0 ? 'btn-muda opacity-50' : 'btn-emas'}`} disabled={bunyiCooldown > 0} onClick={bunyikanGelang}>
                {bunyiCooldown > 0 ? `⏳ ${bunyiCooldown}s` : '🔊 Bunyikan'}
              </button>
              <button className="btn btn-utama flex-1 !text-[14px]" onClick={selesaiCari}>✅ Ditemukan</button>
            </div>
            <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
              Getar HP = pandu arah (makin rapat = makin dekat). Saat sangat dekat → tekan 🔊 untuk dengar bunyi gelang → temukan jamaah → tekan ✅.
            </p>
          </div>
        </div>
      )}

      {acara && !cari && (
        <div className="mt-3 bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-3 text-center">
          <b className="text-hijau text-[13.5px]">✅ Mode Absensi: {acara.nama}</b>
          <p className="text-[12px] text-slate-600">Gelang di dalam titik = HADIR otomatis</p>
        </div>
      )}

      {pasangId && (
        <div className="mt-3 kartu p-4 border-2 border-hijau">
          <b className="text-hijau">⌚ Pasangkan gelang: {pasangNama}</b>
          <div className="flex gap-2 mt-2">
            <button className={`btn flex-1 !text-[13px] ${pasangScan ? 'btn-merah' : 'btn-utama'}`} onClick={pasangViaSinyal}>
              {pasangScan ? '⏹ Hentikan Sinyal' : '📶 Pasang via Sinyal (otomatis)'}
            </button>
            <button className="btn btn-muda !text-[13px] !px-3" onClick={pasangkan}>📲 Manual</button>
          </div>
          {pasangScan && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[11.5px] text-slate-500 font-bold">{deteksi} tag terdeteksi — kunci baris 🎯 teratas (sinyal terkuat = tag di tangan Anda):</p>
              {pasangList.length === 0 && <p className="text-slate-400 text-[12.5px]">📶 Mencari tag… (tag harus menyala & dekat, ±1 m)</p>}
              {pasangList.map((t, i) => {
                const nm = namaMap[t.mac];
                return (
                  <div key={t.mac} className={`flex items-center gap-2 border rounded-xl p-2 ${i === 0 ? 'border-hijau bg-emerald-50' : 'border-slate-200'}`}>
                    <div className="flex-1 min-w-0">
                      <b className="text-[13px] block truncate">{i === 0 ? '🎯 ' : ''}{nm ? nm.nama : 'Tag baru'}</b>
                      <small className="text-slate-500 text-[11px]">iTag …{pendek(t.mac)} · {t.rssi} dBm{nm && nm.regu ? ' · ' + nm.regu : ''}</small>
                    </div>
                    <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${t.pct > 60 ? 'bg-emerald-500' : t.pct > 30 ? 'bg-amber-400' : 'bg-blue-400'}`} style={{ width: t.pct + '%' }} />
                    </div>
                    <button className="btn btn-utama !min-h-[36px] !px-2.5 !text-[12px]" onClick={() => kunciTag(t.mac)}>🔒</button>
                  </div>
                );
              })}
            </div>
          )}
          {pasangInfo && <p className="text-[12.5px] mt-2 font-bold">{pasangInfo}</p>}
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            Semua iTag bernama sama? Tidak masalah — sistem memakai MAC-nya. Dekatkan HANYA tag jamaah ini: sinyal terkuat = tag di dekat Anda.
          </p>
        </div>
      )}

      {!cari && (
        <>
          <div className="mt-3 kartu p-4">
            <b className="text-hijau text-[12px] uppercase tracking-wide">📍 Posisi Anda</b>
            <p className="text-[13px] my-1.5">
              {gps == null ? 'Mencari posisi…' : gps.gagal
                ? <span className="text-merah font-bold">⚠️ GPS belum aktif</span>
                : <span className="text-hijau font-bold">✅ GPS aktif (±{Math.round(gps.ak)} m)</span>}
            </p>
            <div ref={petaRef} className="h-[200px] rounded-xl border border-slate-200" />
          </div>

          <div className="mt-3 space-y-2.5">
            <button className="btn btn-utama w-full" onClick={mulaiPindai}>{scanAktif ? '⏹ Hentikan' : '📡 Pindai Otomatis'}</button>
            <button className="btn btn-muda w-full" onClick={() => pilihTag(false)}>📲 Pilih Tag + 🔊</button>
          </div>

          <div className="mt-3 kartu p-4">
            <b className="text-hijau text-[12px] uppercase tracking-wide">📜 Penampakan</b>
            <div className="mt-2 space-y-1.5 max-h-[300px] overflow-y-auto">
              {log.length === 0 && <p className="text-slate-500 text-[13px]">Belum ada.</p>}
              {log.map((x, i) => (
                <div key={i} className={`border rounded-xl p-2.5 text-[13px] ${x.warn ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}
                     dangerouslySetInnerHTML={{ __html: `${x.html}<small class="block text-slate-400">${x.jam}</small>` }} />
              ))}
            </div>
          </div>

          <p className="text-slate-500 text-[11.5px] text-center mt-3">
            🤝 Bagikan tautan ini ke jamaah lain — makin banyak yang membuka, makin luas jaringannya.<br/>
            <a className="text-hijau font-bold" href="#/">↩️ Kembali</a>
          </p>
        </>
      )}
    </div>
  );
}
