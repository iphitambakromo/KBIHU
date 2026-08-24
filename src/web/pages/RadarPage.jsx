import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

/* Radar Gelang — halaman publik (gotong royong): pindai + bunyikan + lapor.
   Mode ?pasang=<jamaahId> (dgn login Admin/KaRom/KaRu): pasangkan tag ke jamaah. */
export default function RadarPage() {
  const hash = location.hash || '';
  const pasangId = (hash.match(/pasang=([^&]+)/) || [])[1] ? decodeURIComponent(hash.match(/pasang=([^&]+)/)[1]) : '';
  const TOK = () => localStorage.getItem('iphi_tok') || '';
  const [gps, setGps] = useState(null);
  const [log, setLog] = useState([]);
  const [scanAktif, setScanAktif] = useState(false);
  const [pasangInfo, setPasangInfo] = useState('');
  const [pasangNama, setPasangNama] = useState('…');
  const [acara, setAcara] = useState(null);
  const petaRef = useRef(null); const mapRef = useRef(null); const sayaRef = useRef(null);
  const terlapor = useRef({});
  const scanHandle = useRef(null);

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

  /* acara absensi aktif */
  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/absensi/aktif').then(r => r.json());
        if (d.ok && d.event) setAcara(d.event);
      } catch (e) {}
    })();
  }, []);

  /* mode pasang: ambil nama jamaah */
  useEffect(() => {
    if (!pasangId || !TOK()) return;
    (async () => {
      const st = await fetch('/api/state', { headers: { authorization: 'Bearer ' + TOK() } }).then(r => r.json());
      const m = (st.jamaah || []).find(x => x.id === pasangId);
      if (m) setPasangNama(m.nama + (m.beacon_id ? ' (⌚ ' + m.beacon_id + ')' : ''));
    })();
  }, [pasangId]);

  const labelJarak = rssi => rssi == null ? '' : rssi > -60 ? 'sangat dekat (<±3 m)' : rssi > -80 ? 'dekat (±3-10 m)' : 'tepi jangkauan (±10-25 m)';

  async function lapor(device, rssi) {
    const id = device.id || device.name;
    const kini = Date.now();
    if (terlapor.current[id] && kini - terlapor.current[id] < 120000) return;   // 1 laporan / 2 mnt
    terlapor.current[id] = kini;
    tambahLog(`⏳ Melaporkan <b>${device.name || 'tag'}</b>…`);
    try {
      const r = await fetch('/api/pub/ble', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ beaconId: id, lat: gps ? gps.lat : undefined, lng: gps ? gps.lng : undefined, oleh: 'gotong-royong', rssi })
      });
      const d = await r.json();
      if (d.ok) {
        tambahLog(`✅ <b>${d.jamaah}</b> tercatat${d.titik ? ' — di ' + d.titik : ''}${labelJarak(rssi) ? ' · ' + labelJarak(rssi) : ''}` +
          (d.absensi?.hadir ? ` · <b>HADIR</b> "${d.absensi.acara}"` : d.absensi ? ` · absensi ±${d.absensi.sisaMeter} m dari titik` : ''));
      } else tambahLog(`⚠️ Tag tidak terdaftar — lewati, atau minta Admin memasangkannya.`, true);
    } catch (e) { tambahLog('❌ Gagal mengirim — periksa internet', true); }
  }

  async function bunyikan(device) {
    try {
      const server = await device.gatt.connect();
      let bunyi = false;
      try {
        const sv = await server.getPrimaryService(0x1802);
        const ch = await sv.getCharacteristic(0x2A06);
        await ch.writeValue(new Uint8Array([2])); bunyi = true;
        setTimeout(() => { ch.writeValue(new Uint8Array([0])).catch(() => {}); try { server.disconnect(); } catch (e) {} }, 4000);
      } catch (e) {}
      if (!bunyi) {
        try {
          const sv = await server.getPrimaryService(0xFFF0);
          const cs = await sv.getCharacteristics();
          const w = cs.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (w) { await w.writeValue(new Uint8Array([1])); setTimeout(() => { try { server.disconnect(); } catch (e) {} }, 4000); bunyi = true; }
        } catch (e) {}
      }
      return bunyi;
    } catch (e) { return false; }
  }

  async function pilihTag(untukPasang = false) {
    if (!navigator.bluetooth?.requestDevice) { tambahLog('Butuh Chrome di Android untuk memindai bluetooth', true); return null; }
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [0x1802, 0x180F, 0xFFF0] });
      if (untukPasang) return device;
      const bunyi = await bunyikan(device);
      tambahLog(bunyi ? '🔊 Gelang dibunyikan — dekati suaranya!' : 'Tag terpilih (tidak bisa dibunyikan)');
      await lapor(device, null);
      return device;
    } catch (e) { return null; }
  }

  async function mulaiPindai() {
    if (!navigator.bluetooth) { tambahLog('Browser ini tidak mendukung bluetooth web — pakai Chrome Android, atau tombol Pilih Tag', true); return; }
    if (scanHandle.current) { scanHandle.current.stop(); scanHandle.current = null; setScanAktif(false); tambahLog('⏹ Pemindaian otomatis dihentikan'); return; }
    try {
      scanHandle.current = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
      setScanAktif(true);
      tambahLog('🟢 Memindai otomatis… tag terdaftar yang masuk jangkauan dilaporkan (1×/2 mnt). Biarkan layar menyala.');
      navigator.bluetooth.addEventListener('advertisementreceived', ev => lapor(ev.device, ev.rssi));
    } catch (e) {
      tambahLog('Pindai otomatis tak didukung — gunakan Pilih Tag Manual', true);
    }
  }

  async function pasangkan() {
    if (!pasangId) return;
    setPasangInfo('Dekatkan HANYA gelang jamaah ini ke HP (±30 cm), pilih tag-nya di jendela muncul…');
    const device = await pilihTag(true);
    if (!device) { setPasangInfo('❌ Tidak ada tag dipilih'); return; }
    const bunyi = await bunyikan(device);
    if (!confirm(`Tag "${device.name || device.id}"${bunyi ? ' sudah berbunyi' : ''}. Simpan sebagai gelang jamaah ini?`)) {
      try { device.gatt.disconnect(); } catch (e) {}
      setPasangInfo('Dibatalkan.'); return;
    }
    try { device.gatt.disconnect(); } catch (e) {}
    const r = await fetch('/api/jamaah', {
      method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOK() },
      body: JSON.stringify({ id: pasangId, punya_gelang: true, beacon_id: device.id })
    });
    const d = await r.json();
    setPasangInfo(d.ok ? `✅ Tersimpan: gelang ${device.id} → jamaah ini. Coba pindai lagi — harus langsung tercatat.` : '❌ Gagal: ' + (d.error || ''));
  }

  return (
    <div className="min-h-full bg-[#EEF3F0] p-3 pb-10 max-w-2xl mx-auto">
      <div className="bg-gradient-to-r from-hijau to-hijau2 text-white rounded-2xl p-4 text-center">
        <h1 className="font-extrabold text-[17px]">📡 Radar Gelang BLE</h1>
        <p className="text-white/85 text-[12px] mt-1 leading-relaxed">Deteksi gelang jamaah di sekitar Anda (±25 m) — tercatat otomatis ke dashboard & absensi.</p>
      </div>

      {acara && (
        <div className="mt-3 bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-3 text-center">
          <b className="text-hijau text-[13.5px]">✅ Mode Absensi: {acara.nama}</b>
          <p className="text-[12px] text-slate-600">Titik {acara.titik_nama} (radius {acara.radius} m) — gelang yang terdeteksi di dalam titik = <b>HADIR otomatis</b></p>
        </div>
      )}

      {pasangId && (
        <div className="mt-3 kartu p-4 border-2 border-hijau">
          <b className="text-hijau">⌚ Pasangkan gelang: {pasangNama}</b>
          <button className="btn btn-utama w-full mt-2" onClick={pasangkan}>📡 Pindai & Pasangkan (tes bunyi)</button>
          {pasangInfo && <p className="text-[12.5px] mt-2 font-bold">{pasangInfo}</p>}
        </div>
      )}

      <div className="mt-3 kartu p-4">
        <b className="text-hijau text-[12px] uppercase tracking-wide">📍 Posisi Anda (radar)</b>
        <p className="text-[13px] my-1.5">
          {gps == null ? 'Mencari posisi…' : gps.gagal
            ? <span className="text-merah font-bold">⚠️ GPS belum aktif — izinkan lokasi agar laporan valid</span>
            : <span className="text-hijau font-bold">✅ GPS aktif (±{Math.round(gps.ak)} m) — lingkaran biru = jangkauan</span>}
        </p>
        <div ref={petaRef} className="h-[200px] rounded-xl border border-slate-200" />
      </div>

      <div className="mt-3 space-y-2.5">
        <button className="btn btn-utama w-full" onClick={mulaiPindai}>{scanAktif ? '⏹ Hentikan Pemindaian' : '📡 Pindai Otomatis di Sekitar'}</button>
        <button className="btn btn-muda w-full" onClick={() => pilihTag(false)}>📲 Pilih Tag Manual + 🔊 Bunyikan</button>
      </div>

      <div className="mt-3 kartu p-4">
        <b className="text-hijau text-[12px] uppercase tracking-wide">📜 Penampakan</b>
        <div className="mt-2 space-y-1.5 max-h-[300px] overflow-y-auto">
          {log.length === 0 && <p className="text-slate-500 text-[13px]">Belum ada. Tag terdaftar yang terlihat muncul di sini & di dashboard ketua.</p>}
          {log.map((x, i) => (
            <div key={i} className={`border rounded-xl p-2.5 text-[13px] leading-relaxed ${x.warn ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}
                 dangerouslySetInnerHTML={{ __html: `${x.html}<small class="block text-slate-400">${x.jam}</small>` }} />
          ))}
        </div>
      </div>

      <p className="text-slate-500 text-[11.5px] text-center mt-3 leading-relaxed">
        🤝 Halaman ini bisa dibuka siapa pun yang ber-HP — bagikan tautannya ke jamaah lain: makin banyak yang membuka, makin luas jaringan pemantauan.<br/>
        <a className="text-hijau font-bold" href="#/">↩️ Kembali ke aplikasi</a>
      </p>
    </div>
  );
}
