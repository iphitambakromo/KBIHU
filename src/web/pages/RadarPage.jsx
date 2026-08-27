import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { normMac } from '../../lib/mac.js';
import { bytesToHex, ekstrakMacSiar, mfrHexDari, namaDefaultTag } from '../../lib/ble.js';

/* Deteksi browser utk pesan panduan (scan BLE cuma ada di Chrome Android) */
const deteksiBrowser = (() => {
  const ua = navigator.userAgent || '';
  const v = (re) => { const m = ua.match(re); return m ? m[1].split('.')[0] : ''; };
  let nama = 'browser tidak dikenal';
  if (ua.includes('Edg/')) nama = 'Edge ' + v(/Edg\/([\d.]+)/);
  else if (ua.includes('SamsungBrowser/')) nama = 'Samsung Internet ' + v(/SamsungBrowser\/([\d.]+)/);
  else if (ua.includes('Brave')) nama = 'Brave';
  else if (ua.includes('OPR/')) nama = 'Opera ' + v(/OPR\/([\d.]+)/);
  else if (ua.includes('UCBrowser') || ua.includes('UBrowser')) nama = 'UC Browser';
  else if (ua.includes('Chrome/')) nama = 'Chrome ' + v(/Chrome\/([\d.]+)/);
  else if (ua.includes('Firefox/')) nama = 'Firefox ' + v(/Firefox\/([\d.]+)/);
  else if (ua.includes('Safari/')) nama = 'Safari';
  const plat = ua.includes('Android') ? 'Android' : ua.includes('Windows') ? 'Windows (PC/laptop)' : ua.includes('iPhone') ? 'iOS (iPhone)' : ua.includes('Mac') ? 'macOS' : ua.includes('Linux') ? 'Linux' : '';
  return nama + (plat ? ' di ' + plat : '');
})();

/* helper BLE bersama (bytesToHex, ekstrakMacSiar, mfrHexDari, namaDefaultTag) → ../../lib/ble.js 

/* Baca nama ASLI tag dari GATT (servis 0x1800, char 0x2A00) — untuk sinkron nama
   di HP yang scan-nya masih menampilkan "iTag" padahal tag sudah di-rename di HP lain. */
async function bacaNamaGATT(dev) {
  let server = null;
  try { server = await dev.gatt.connect(); }
  catch (e) { return { err: 'gagal konek ke tag (' + ((e && e.name) || 'gagal') + ')' }; }
  try {
    const dec = (buf) => new TextDecoder().decode(buf).replace(/\u0000/g, '').trim();
    let nama = '';
    try {
      const svc = await server.getPrimaryService(0x1800);
      nama = dec(await (await svc.getCharacteristic(0x2A00)).readValue());
    } catch (e) {
      const svcs = await server.getPrimaryServices();
      for (const s of svcs) {
        try {
          const cs = await s.getCharacteristics();
          const target = cs.find(c => String(c.uuid || '').toLowerCase().endsWith('2a00'));
          if (target) { nama = dec(await target.readValue()); break; }
        } catch (e2) {}
      }
    }
    return { nama };
  } catch (e) { return { err: 'gagal baca nama tag (' + ((e && e.name) || 'gagal') + ')' }; }
  finally { try { if (dev.gatt && dev.gatt.connected) dev.gatt.disconnect(); } catch (e) {} }
}

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
  /* Simpan referensi device untuk menghindari pilih device berulang */
  const savedDeviceRef = useRef(null);  // referensi device yang sudah dipilih
  /* MAC gotong royong: daftar MAC terdaftar (identitas global) + MAC jamaah yang sedang dipasangkan */
  const [macDaftar, setMacDaftar] = useState([]);
  const [pasangMac, setPasangMac] = useState('');
  const [pasangOtomatisA, setPasangOtomatisA] = useState(false);
  const pasangMacRef = useRef('');
  const pasangModeRef = useRef(false);
  const macPeta = {};
  for (const x of macDaftar) { const k = normMac(x.mac_tag); if (k) macPeta[k] = x; }
  const macPetaRef = useRef(macPeta);
  useEffect(() => { macPetaRef.current = macPeta; }, [macDaftar]);
  /* MAC -> nama jamaah (membedakan iTag yang namanya seragam) */
  const [namaMap, setNamaMap] = useState({});          // mac -> {nama, regu}
  const namaMapRef = useRef({});
  const [pasangList, setPasangList] = useState([]);    // [{mac, rssi, pct}]
  const [pasangScan, setPasangScan] = useState(false);
  const pasangScanRef = useRef(null);
  const pasangRssiRef = useRef({});                    // mac -> {rssi, t}
  const pasangHandlerRef = useRef(null);
  const [deteksi, setDeteksi] = useState(0);        // jumlah tag unik saat scan pasang
  const [sinkron, setSinkron] = useState('');       // pesan status sinkron nama tag
  const [sinkroning, setSinkroning] = useState(''); // mac yang sedang disinkron, atau 'semua'
  const sinkronNamaRef = useRef({});                // mac -> nama asli (hasil GATT), biar tidak ter-overwrite iklan ulang
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
  /* daftar MAC global (publik) — identitas yang sama di semua HP */
  useEffect(() => {
    (async () => {
      try { const d = await fetch('/api/pub/mac').then(r => r.json()); if (d.ok) setMacDaftar(d.daftar || []); } catch (e) {}
    })();
  }, []);
  useEffect(() => { pasangMacRef.current = pasangMac; }, [pasangMac]);
  useEffect(() => () => {
    try { scanHandle.current?.stop(); } catch (e) {}
    try { cariScanRef.current?.stop(); } catch (e) {}
    try { pasangScanRef.current?.stop(); } catch (e) {}
  }, []);
  useEffect(() => {
    const h = (ev) => {
      const id = ev.device.id || ev.device.name;
      if (!id) return;
      const kini = Date.now();
      const rssi = Number.isFinite(ev.rssi) ? ev.rssi : -100;
      let svc = '', mfr = '', mfrHex = '';
      try {
        if (ev.serviceData) { const p = []; ev.serviceData.forEach((v, k) => p.push((String(k).replace(/0x/i, '') + ':' + bytesToHex(v)).toUpperCase())); svc = p.join(' '); }
        if (ev.manufacturerData) { const p = []; ev.manufacturerData.forEach((v, k) => { const hx = bytesToHex(v); if (hx.length > mfrHex.length) mfrHex = hx; p.push(('MFR' + Number(k).toString(16).padStart(2, '0') + ':' + hx).toUpperCase()); }); mfr = p.join(' '); }
      } catch (e) {}
      const st = pasangRssiRef.current;
      const nmSinkron = sinkronNamaRef.current[id];
      // SIAR BERGIRI: simpan yang terpanjang per perangkat, jangan buang bingkai payload MAC
      if (!st[id]) st[id] = { rssi, t: kini, svc, mfr, mfrHex, nm: nmSinkron || ev.device.name || '', dev: ev.device };
      else {
        const e = st[id];
        e.t = kini;
        if (rssi > e.rssi) e.rssi = rssi;
        if (svc.length > (e.svc || '').length) e.svc = svc;
        if (mfr.length > (e.mfr || '').length) e.mfr = mfr;
        if (mfrHex.length > (e.mfrHex || '').length) e.mfrHex = mfrHex;
        if (nmSinkron && !e.nm) e.nm = nmSinkron;
      }
      for (const k of Object.keys(st)) if (kini - st[k].t > 4000) delete st[k];
      const list = Object.entries(st).map(([mac, v]) => {
        const macSiar = ekstrakMacSiar(v.mfrHex || '', macPetaRef.current);
        return { mac, rssi: v.rssi, pct: rssiKePct(v.rssi), svc: v.svc || '', mfr: v.mfr || '', nm: v.nm || '', dev: v.dev,
                 macSiar, jmSiar: macSiar && macPetaRef.current[macSiar] ? macPetaRef.current[macSiar] : null };
      });
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
      if (m) {
        setPasangMac(m.mac_tag || '');
        setPasangNama(m.nama + (m.mac_tag ? ' (⌚ ' + m.mac_tag + ')' : m.beacon_id ? ' (⌚ ' + m.beacon_id.split(',')[0].slice(0, 12) + (m.beacon_id.includes(',') ? '…' : '') + ')' : ''));
      }
    })();
  }, [pasangId]);


  /* ===== MODE CARI ===== */
  useEffect(() => { cariRef.current = cari; }, [cari]);
  useEffect(() => {
    if (!cariId) return;
    (async () => {
      const r = await fetch('/api/pub/cari-mulai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jamaahId: cariId }) }).then(x => x.json());
      if (r.ok && r.jamaah.punya_gelang && (r.jamaah.beacon_id || r.jamaah.mac_tag)) {
        setCari(r.jamaah);
        setCariStatus('🔵 JAUH — mulai berjalan perlahan ke segala arah');
        tambahLog(`🔍 <b>Mode Cari dimulai</b> untuk ${r.jamaah.nama}${r.jamaah.mac_tag ? ' — via MAC global, tanpa pasang ulang' : ''}`);
        mulaiCariScan(r.jamaah.beacon_id || '', r.jamaah.mac_tag || '');
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

  const mulaiCariScan = async (beaconId, macTag) => {
    if (!navigator.bluetooth) { setCariStatus('⚠️ Browser tidak mendukung bluetooth — gunakan Chrome Android'); return; }
    // multi-HP: beacon_id kini DAFTAR kode per-HP — cocok bila kode/nama termasuk di dalamnya
    const kodeCari = new Set(String(beaconId || '').split(',').map(s => s.trim()).filter(Boolean));
    try {
      // Gunakan requestLEScan — izin hanya diminta SEKALI
      cariScanRef.current = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
      navigator.bluetooth.addEventListener('advertisementreceived', ev => {
        if (!cariRef.current) return;
        const id = ev.device.id || ev.device.name;
        const nm = normMac(ev.device?.name);
        const macSiarP = ekstrakMacSiar(mfrHexDari(ev), macPetaRef.current, false);
        // cocok: ID perangkat lokal (daftar multi-HP), nama siaran (pasang lama), atau MAC global (nama / payload siar)
        if (!kodeCari.has(id) && !kodeCari.has(String(ev.device.name || '')) && !(macTag && (nm === macTag || macSiarP === macTag))) return;
        const rssi = ev.rssi || -100;
        const pct = rssiKePct(rssi);
        const info = rssiKeLabel(rssi);
        setSinyal({ rssi, pct, ...info });
        setCariStatus(info.label);
        navigator.vibrate?.(info.vibrate);
        
        // Simpan referensi device
        savedDeviceRef.current = ev.device;
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        setCariStatus('⚠️ Izin Bluetooth ditolak — buka pengaturan browser dan izinkan Bluetooth');
      } else {
        setCariStatus('⚠️ Tidak bisa memindai — pastikan Bluetooth aktif & gunakan Chrome Android');
      }
    }
  };
  const hentiCariScan = () => {
    try { cariScanRef.current?.stop(); } catch (e) {}
    cariScanRef.current = null;
    navigator.vibrate?.(0);
  };

  const bunyikanGelang = async () => {
    if (!cari || (!cari.beacon_id && !cari.mac_tag)) return;
    if (Date.now() - bunyiRef.current < 5000) { setBunyiCooldown(Math.ceil((5000 - (Date.now() - bunyiRef.current)) / 1000)); return; }
    bunyiRef.current = Date.now();
    setBunyiCooldown(5);
    const cd = setInterval(() => setBunyiCooldown(c => c > 0 ? c - 1 : 0), 1000);
    setTimeout(() => clearInterval(cd), 5000);
    try {
      let device = savedDeviceRef.current;
      
      // Jika belum ada referensi device, minta user pilih
      if (!device) {
        setCariStatus('Pilih tag dari daftar — tag bunyi saat tersambung…');
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [0x1802, 0xFCF1, 0xFFF0, 0xFFE0]
        });
        // Simpan referensi device untuk penggunaan berikutnya
        savedDeviceRef.current = device;
      }
      
      // validasi: kalau MAC terdaftar & nama tag unik, harus cocok (nama default "iTag" tak bisa diverifikasi di pemilih)
      if (cari.mac_tag && device.name && !namaDefaultTag(String(device.name).trim()) && normMac(device.name) !== cari.mac_tag) {
        tambahLog(`⚠️ Tag terpilih bukan milik ${cari.nama} — pilih tag bernama <b>${cari.mac_tag}</b>`, true);
        savedDeviceRef.current = null;  // Reset referensi
        return;
      }
      const server = await device.gatt.connect();
      try {
        const sv = await server.getPrimaryService(0x1802);
        const ch = await sv.getCharacteristic(0x2A06);
        await ch.writeValue(new Uint8Array([2]));
        tambahLog('🔊 Gelang dibunyikan — dekati!');
        setTimeout(async () => { try { await ch.writeValue(new Uint8Array([0])); } catch (e) {} try { server.disconnect(); } catch (e) {} }, 3500);
      } catch (e) {
        try { const sv2 = await server.getPrimaryService(0xFFF0);
          const cs = await sv2.getCharacteristics();
          const w = cs.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (w) { await w.writeValue(new Uint8Array([1])); tambahLog('🔊 Gelang dibunyikan — dekati!'); setTimeout(() => { try { server.disconnect(); } catch (e) {} }, 3500); }
        } catch (e2) {}
      }
    } catch (e) { 
      savedDeviceRef.current = null;  // Reset referensi jika gagal
      setCariStatus('Pembatalan — tidak ada tag dipilih'); 
    }
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

  async function lapor(device, rssi, ev) {
    const id = device.id || device.name;
    // nama default ("iTag") bukan identitas — utamakan MAC dari payload siaran
    const macNamaL = normMac(device.name);
    const mac = (macNamaL && !namaDefaultTag(String(device.name || '').trim())) ? macNamaL : ekstrakMacSiar(mfrHexDari(ev), macPetaRef.current, false);
    const kini = Date.now();
    if (terlapor.current[id] && kini - terlapor.current[id] < 120000) return;
    terlapor.current[id] = kini;
    const jm = (mac && macPeta[mac]) || namaMapRef.current[id] || (device.name ? namaMapRef.current[device.name] : undefined);
    tambahLog(jm ? `⏳ Melaporkan <b>${jm.nama}</b>${jm.regu ? ` (${jm.regu})` : ''}…` : `⏳ Melaporkan <b>${device.name || 'tag'}</b>…`);
    
    // Simpan referensi device
    savedDeviceRef.current = device;
    
    try {
      const r = await fetch('/api/pub/ble', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ beaconId: id, macTag: mac || undefined, nama: device.name || '', lat: gps ? gps.lat : undefined, lng: gps ? gps.lng : undefined, oleh: 'gotong-royong', rssi }) });
      const d = await r.json();
      if (d.ok) tambahLog(`✅ <b>${d.jamaah}</b> tercatat${d.titik ? ' — di ' + d.titik : ''}${labelJarak(rssi) ? ' · ' + labelJarak(rssi) : ''}` +
          (d.absensi?.hadir ? ` · <b>HADIR</b>` : ''));
      else tambahLog(`⚠️ Tag tidak terdaftar — isi MAC-nya di Kelola Jamaah (✏️)`, true);
    } catch (e) { tambahLog('❌ Gagal kirim — periksa internet', true); }
  }

  async function bunyikan(device) {
    const gagal = (info) => ({ ok: false, info });
    try {
      // Simpan referensi device
      savedDeviceRef.current = device;
      
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
    } catch (e) { 
      savedDeviceRef.current = null;  // Reset referensi jika gagal
      return gagal('gagal terhubung ke tag'); 
    }
  }

  async function pilihTag(untukPasang = false) {
    if (!navigator.bluetooth?.requestDevice) { tambahLog('Butuh Chrome di Android', true); return null; }
    try {
      let device = savedDeviceRef.current;
      
      // Jika belum ada referensi device, minta user pilih
      if (!device) {
        device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [0x1802, 0x180F, 0xFFF0, 0xFFE0] });
        // Simpan referensi device
        savedDeviceRef.current = device;
      }
      
      if (untukPasang) return device;
      const bunyi = await bunyikan(device);
      tambahLog(bunyi.ok ? '🔊 Gelang dibunyikan — dekati!' : 'Tag terpilih (perintah bunyi tidak didukung tag ini)');
      await lapor(device, null);
      return device;
    } catch (e) { 
      savedDeviceRef.current = null;  // Reset referensi jika gagal
      return null; 
    }
  }

  async function mulaiPindai() {
    if (!navigator.bluetooth) { tambahLog('Gunakan Chrome Android', true); return; }
    if (!navigator.bluetooth.requestLEScan) { tambahLog(`⚠️ ${deteksiBrowser} tidak mendukung scan — buka radar di Chrome Android, atau pakai 📲 Pilih Tag`, true); return; }
    if (scanHandle.current) { scanHandle.current.stop(); scanHandle.current = null; setScanAktif(false); tambahLog('⏹ Dihentikan'); return; }
    try {
      // Gunakan requestLEScan — izin hanya diminta SEKALI
      scanHandle.current = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
      setScanAktif(true);
      tambahLog('🟢 Memindai… biarkan layar menyala.');
      navigator.bluetooth.addEventListener('advertisementreceived', ev => lapor(ev.device, ev.rssi, ev));
    } catch (e) { 
      if (e.name === 'NotAllowedError') {
        tambahLog('⚠️ Izin Bluetooth ditolak — buka pengaturan browser dan izinkan Bluetooth', true);
      } else {
        tambahLog(`⚠️ Gagal memindai (${(e && e.name) || 'gagal'}) — pakai 📲 Pilih Tag Manual`, true);
      }
    }
  }

  /* ===== PASANG OTOMATIS VIA MAC (gotong royong): tag yang MAC-nya cocok = langsung tersimpan ===== */
  const macAsli = (nm) => { const k = normMac(nm); return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(k) ? k : ''; };
  const simpanHasilPasang = async (device, mac) => {
    const r = await fetch('/api/jamaah', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.getItem('iphi_tok') },
      body: JSON.stringify({ id: pasangId, punya_gelang: true, beacon_id: device.id, sanding_tambah: true, mac_tag: mac || undefined }) });
    return await r.json();
  };
  const muatMacDaftar = () => (async () => {
    try { const x = await fetch('/api/pub/mac').then(rr => rr.json()); if (x.ok) setMacDaftar(x.daftar || []); } catch (e) {}
  })();
  const pasangListener = (ev) => {
    if (!pasangModeRef.current) return;
    // cocok via nama iTAG(MAC) ATAU via MAC di payload siaran
    const macNama = normMac(ev.device?.name);
    const macSiarP = ekstrakMacSiar(mfrHexDari(ev), macPetaRef.current, false);
    const mac = (macNama && macNama === (pasangMacRef.current || '') ? macNama : '') || (macSiarP && macSiarP === (pasangMacRef.current || '') ? macSiarP : '');
    if (!mac) return;
    pasangModeRef.current = false;
    
    // Simpan referensi device
    savedDeviceRef.current = ev.device;
    
    (async () => {
      const bunyi = await bunyikan(ev.device);
      try { ev.device.gatt.disconnect(); } catch (e) {}
      const d = await simpanHasilPasang(ev.device, mac);
      batalkanPasang();
      setPasangInfo(d.ok ? `✅ Tersimpan — gelang terpasang & dikenali semua HP${bunyi && bunyi.ok ? ' (tag berbunyi)' : ''}` : '❌ Gagal: ' + (d.error || ''));
      if (d.ok) { muatMacDaftar(); tambahLog(`⌚ <b>${(pasangNama || 'jamaah').replace(/ \(⌚.*$/, '')}</b> tersandingkan via MAC ${mac}`); }
    })();
  };
  function pasangOtomatis() {
    if (!navigator.bluetooth?.requestLEScan) { setPasangInfo('⚠️ Browser ini tidak bisa memindai — pakai "Pasang via Sinyal" atau 📲 Manual'); return; }
    if (pasangScanRef.current) { hentiPasangSinyal(); return; } // jangan rangkap scan
    pasangModeRef.current = true;
    setPasangOtomatisA(true);
    setPasangInfo('📡 Memindai otomatis — dekatkan gelang ke HP (±1 m). Tag yang MAC-nya cocok langsung tersimpan. Tekan tombol lagi untuk batal.');
    (async () => {
      try {
        // Gunakan requestLEScan — izin hanya diminta SEKALI
        pasangScanRef.current = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
        navigator.bluetooth.addEventListener('advertisementreceived', pasangListener);
      } catch (e) { 
        batalkanPasang(); 
        if (e.name === 'NotAllowedError') {
          setPasangInfo('⚠️ Izin Bluetooth ditolak — buka pengaturan browser dan izinkan Bluetooth');
        } else {
          setPasangInfo('⚠️ Gagal memindai — pastikan Bluetooth aktif');
        }
      }
    })();
  }
  function batalkanPasang() {
    pasangModeRef.current = false;
    setPasangOtomatisA(false);
    try { pasangScanRef.current?.stop(); } catch (e) {}
    pasangScanRef.current = null;
    try { navigator.bluetooth?.removeEventListener('advertisementreceived', pasangListener); } catch (e) {}
  }

  async function pasangkan() {
    if (!pasangId) return;
    if (pasangMac) { // MAC terdaftar → pindai otomatis (tanpa klik pilih)
      if (pasangModeRef.current) { batalkanPasang(); setPasangInfo('⏹ Dihentikan'); return; }
      pasangOtomatis();
      return;
    }
    // fallback manual: pilih tag — MAC dalam nama tag ikut tersimpan (identitas global)
    setPasangInfo('Dekatkan HANYA gelang jamaah ini (±30 cm), lalu pilih tag-nya dari daftar…');
    const device = await pilihTag(true);
    if (!device) { setPasangInfo('❌ Tidak ada tag dipilih'); return; }
    const hasilBunyi = await bunyikan(device);
    const namaBersih = (pasangNama || 'jamaah').replace(/ \(⌚.*$/, '');
    const mac = macAsli(device.name);   // nama siar = iTAG(MAC) → identitas global = MAC
    const lain = mac && macPeta[mac] && macPeta[mac].id !== pasangId ? macPeta[mac] : null;
    const nmDev = device.name ? String(device.name).trim() : '';
    // MAC ada → kunci lokal = ID perangkat (identitas global lewat MAC);
    // tanpa MAC: nama unik (rename) = global; nama default ("iTag") = kode per-HP
    const pakaiNama = !mac && nmDev && !namaDefaultTag(nmDev);
    const kunci = pakaiNama ? nmDev : device.id;
    const tampilkan = mac ? `⌚ MAC ${mac}` : pakaiNama ? `⌚ "${kunci}"` : `⌚ …${pendek(device.id)}`;
    setPasangInfo(hasilBunyi.ok
      ? `🔊 Tag "${device.name || 'tag'}" ${tampilkan} BERBUNYI — ini tag yang benar.`
      : `Tag terpilih: "${device.name || 'tag'}" ${tampilkan}. Perintah bunyi: ${hasilBunyi.info} — wajar, sebagian iTag bunyinya saat tersambung/terputus, bukan lewat web.` + (lain ? ` ⚠️ TAG INI TERCATAT ATAS NAMA ${lain.nama.toUpperCase()}.` : ''));
    if (!confirm(`Simpankan tag ini untuk ${namaBersih}${lain ? ` — PERHATI: tercatat atas nama ${lain.nama}!` : ''}?`)) { try { device.gatt.disconnect(); } catch (e) {} setPasangInfo('Batal.'); return; }
    try { device.gatt.disconnect(); } catch (e) {}
    const r = await fetch('/api/jamaah', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.getItem('iphi_tok') },
      body: JSON.stringify({ id: pasangId, punya_gelang: true, beacon_id: kunci, sanding_tambah: true, mac_tag: mac || undefined }) });
    const d = await r.json();
    const cakupan = mac ? ' — MAC tersimpan: radar di HP mana pun mengenali (gotong royong)'
      : pakaiNama ? ' — radar di HP mana pun mengenali lewat nama'
      : ' — tag dikenali di HP ini (tiap HP pasang tag rombongan sendiri). ⚠️ Di HP/tablet LAIN tag ini tetap tampil "iTag" (nama pabrik tidak bisa permanen diganti) — kalau perangkat lain juga perlu membacanya, pasang tag ini juga di perangkat itu (tombol ⌚)';
    setPasangInfo(d.ok ? `✅ Tersimpan: ${namaBersih} ${tampilkan}${cakupan}` : '❌ Gagal: ' + (d.error || ''));
    if (d.ok) muatMacDaftar();
  }

  /* ===== PASANG VIA SINYAL: tanpa dialog pemilih — tag sinyal-terkuat = tag di tangan ===== */
  async function pasangViaSinyal() {
    if (!navigator.bluetooth?.requestLEScan) { setPasangInfo(`⚠️ ${deteksiBrowser} tidak mendukung scan sinyal — buka radar ini di Chrome Android. Sementara bisa pakai 📲 Manual.`); return; }
    if (pasangScanRef.current) { hentiPasangSinyal(); setPasangInfo('⏹ Dihentikan'); return; }
    try {
      // Gunakan requestLEScan — izin hanya diminta SEKALI
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
  async function kunciTag(mac, nmTag, macSiarArg) {
    if (!pasangId) return;
    hentiPasangSinyal();
    const namaBersih = (pasangNama || 'jamaah').replace(/ \(⌚.*$/, '');
    const nmBersih = String(nmTag || '').trim();
    // Prioritas identitas global: MAC dari payload siaran (identitas asli tag) → MAC dalam nama (iTAG(MAC)) → nama unik → kode per-HP
    const macN0 = macAsli(macSiarArg || '') || macAsli(nmBersih);
    const pakaiNama = !macN0 && nmBersih && !namaDefaultTag(nmBersih);   // nama unik (tanpa MAC) = global; default = kode per-HP
    const kunci = pakaiNama ? nmBersih : mac;
    const lain = macN0 && macPeta[macN0] && macPeta[macN0].id !== pasangId ? macPeta[macN0] : null;
    const sudah = namaMapRef.current[kunci] || namaMapRef.current[mac];
    const pesan = (lain ? `⚠️ Tag ini TERCATAT atas nama ${lain.nama}! ` : '') + (sudah && sudah.nama !== namaBersih
      ? `Tag ini sudah terpasang ke ${sudah.nama}. Pindahkan ke ${namaBersih}?`
      : `Simpan tag ini untuk ${namaBersih}?`);
    if (!confirm(pesan)) return;
    const r = await fetch('/api/jamaah', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.getItem('iphi_tok') },
      body: JSON.stringify({ id: pasangId, punya_gelang: true, beacon_id: kunci, sanding_tambah: true, mac_tag: macN0 || undefined }) });
    const d = await r.json();
    if (d.ok) {
      setNamaMap(m => ({ ...m, [kunci]: { nama: namaBersih, regu: '' } }));
      if (macN0) muatMacDaftar();
      const tampilkan = macN0 ? `⌚ MAC ${macN0}` : pakaiNama ? `⌚ "${kunci}"` : `⌚ …${pendek(mac)}`;
      const cakupan = macN0 ? ' — MAC tersimpan: radar di HP mana pun mengenali (gotong royong)'
        : pakaiNama ? ' — radar di HP mana pun mengenali lewat nama'
        : ' — tag dikenali di HP ini (tiap HP pasang tag rombongan sendiri). ⚠️ Di HP/tablet LAIN tag ini tetap tampil "iTag" — pasang ulang di perangkat yang akan dipakai membaca';
      setPasangInfo(`✅ Tersimpan: ${namaBersih} ${tampilkan}${cakupan}. Ulangi untuk jamaah berikutnya (tombol ⌚ di dashboard).`);
      tambahLog(`⌚ <b>${namaBersih}</b> tersandingkan ke tag ${tampilkan}`);
    } else setPasangInfo('❌ Gagal: ' + (d.error || ''));
  }

  /* ===== SINKRON NAMA TAG: konek sebentar ke tag (tag bunyi), baca nama asli dari GATT =====
     Untuk HP yang scan-nya masih menampilkan "iTag" padahal tag sudah di-rename di HP lain. */
  const sinkronSatu = async (t) => {
    if (sinkroning) return;
    const dev = t.dev;
    if (!dev || !dev.gatt) { setSinkron('⚠️ Tag ini belum tersedia utk konek — dekati tag lalu biarkan scan menyegarkannya.'); return; }
    setSinkroning(t.mac);
    setSinkron(`🔄 Sinkron "${t.nm || 'tag …' + pendek(t.mac)}" — tag akan konek sebentar & bunyi…`);
    
    // Simpan referensi device
    savedDeviceRef.current = dev;
    
    const r = await bacaNamaGATT(dev);
    setSinkroning('');
    if (r.err) { setSinkron('⚠️ ' + r.err + ' — coba lagi saat tag lebih dekat.'); return; }
    if (!r.nama) { setSinkron(`⚠️ Tag …${pendek(t.mac)} tidak mengumumkan nama lewat GATT.`); return; }
    sinkronNamaRef.current[t.mac] = r.nama;
    const st = pasangRssiRef.current;
    if (st[t.mac]) st[t.mac].nm = r.nama;
    setPasangList(l => l.map(x => x.mac === t.mac ? { ...x, nm: r.nama } : x));
    setSinkron(`✅ Nama asli tag: "${r.nama}"` + (r.nama !== t.nm ? ' — nama di HP ini sudah diperbarui, sekarang bisa 🔒 dikunci.' : ''));
  };
  const sinkronSemua = async () => {
    if (sinkroning || pasangList.length === 0) return;
    const daftar = [...pasangList].sort((a, b) => b.rssi - a.rssi);
    setSinkroning('semua');
    const hasil = [];
    for (let i = 0; i < daftar.length; i++) {
      const t = daftar[i];
      setSinkron(`🔄 Sinkron ${(i + 1)}/${daftar.length}: "${t.nm || 'tag …' + pendek(t.mac)}" — tag bunyi saat konek…`);
      const dev = t.dev;
      if (!dev || !dev.gatt) { hasil.push({ dulu: t.nm || '…' + pendek(t.mac), kini: 'gagal' }); continue; }
      
      // Simpan referensi device
      savedDeviceRef.current = dev;
      
      const r = await bacaNamaGATT(dev);
      if (r.err) hasil.push({ dulu: t.nm || '…' + pendek(t.mac), kini: 'gagal' });
      else if (!r.nama) hasil.push({ dulu: t.nm || '…' + pendek(t.mac), kini: 'tanpa nama' });
      else {
        sinkronNamaRef.current[t.mac] = r.nama;
        const st = pasangRssiRef.current;
        if (st[t.mac]) st[t.mac].nm = r.nama;
        setPasangList(l => l.map(x => x.mac === t.mac ? { ...x, nm: r.nama } : x));
        hasil.push({ dulu: t.nm || '…' + pendek(t.mac), kini: r.nama });
      }
      await new Promise(res => setTimeout(res, 400));
    }
    setSinkroning('');
    const gagal = hasil.filter(h => h.kini === 'gagal').length;
    const masihDefault = hasil.some(h => h.kini === 'iTag');
    setSinkron(`✅ Sinkron selesai: ${hasil.length - gagal}/${daftar.length} tag. Nama terbaca: ` + hasil.map(h => `"${h.kini}"`).join(', ') +
      (masihDefault ? ' — ⚠️ masih ada "iTag": rename tag itu belum tersimpan di TAG-nya (hanya di HP yang melakukan rename). Screenshot layar rename di app iTag, kirim ke petugas teknis.' : ''));
  };

  return (
    <div className="min-h-full bg-[#EEF3F0] p-3 pb-10 max-w-2xl mx-auto">
      <div className="bg-gradient-to-r from-hijau to-hijau2 text-white rounded-2xl p-4 text-center">
        <h1 className="font-extrabold text-[17px]">📡 Radar Gelang BLE</h1>
        <p className="text-white/85 text-[12px] mt-1">Deteksi gelang jamaah ±25 m — tercatat ke dashboard & absensi.</p>
      </div>

      {!navigator.bluetooth?.requestLEScan && (
        <div className="mt-3 bg-amber-50 border-2 border-amber-300 rounded-2xl p-3">
          <b className="text-amber-700 text-[13px]">⚠️ {deteksiBrowser} tidak mendukung scan Bluetooth.</b>
          <p className="text-[12px] text-slate-600 mt-1">Pindai Otomatis & Pasang via Sinyal hanya jalan di <b>Chrome Android</b>. Di browser ini tetap bisa: 📲 pasang manual & 📲 pilih tag manual.</p>
        </div>
      )}

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
            <p className="text-slate-500 text-[12px]">{cari.regu} · ⌚ {cari.mac_tag || cari.beacon_id?.slice(0, 17) || '—'}</p>

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
          {pasangMac
            ? <p className="text-[12px] text-slate-600 mt-1">MAC terdaftar: <b className="font-mono">{pasangMac}</b> — pindai otomatis, tanpa klik pilih. Dikenali semua HP (gotong royong).</p>
            : <p className="text-[12px] text-slate-600 mt-1">⚠️ MAC belum diisi (Kelola Jamaah ✏️). Kalau nama tag-nya <b>iTAG(MAC)</b>, MAC ikut tersimpan otomatis saat pasang.</p>}
          {pasangMac ? (
            <button className={`btn w-full mt-2 !text-[13px] ${pasangOtomatisA ? 'btn-merah' : 'btn-utama'}`} onClick={pasangkan}>
              {pasangOtomatisA ? '⏹ Batalkan' : '📡 Pindai Otomatis (MAC)'}
            </button>
          ) : (
            <div className="flex gap-2 mt-2">
              <button className={`btn flex-1 !text-[13px] ${pasangScan ? 'btn-merah' : 'btn-utama'}`} onClick={pasangViaSinyal}>
                {pasangScan ? '⏹ Hentikan Sinyal' : '📶 Pasang via Sinyal (otomatis)'}
              </button>
              <button className="btn btn-muda !text-[13px] !px-3" onClick={pasangkan}>📲 Manual</button>
            </div>
          )}
          {pasangScan && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[11.5px] text-slate-500 font-bold">{deteksi} tag terdeteksi — kunci baris 🎯 teratas (sinyal terkuat = tag di tangan Anda):</p>
              <div className="flex items-center gap-2">
                <button className={`btn btn-muda !min-h-[38px] !px-3 !text-[12px]`} disabled={!!sinkroning || pasangList.length === 0} onClick={sinkronSemua}>
                  {sinkroning === 'semua' ? '⏳ Sinkron…' : '🔄 Sinkron Semua Nama Tag'}
                </button>
                <small className="text-slate-400 text-[10.5px] leading-tight flex-1">HP ini masih baca tag yang sudah di-rename sebagai "iTag"? Tekan — HP konek sebentar ke tiap tag (tag bunyi) & nama aslinya langsung terbaca.</small>
              </div>
              {(() => { const atas = pasangList[0]; const bersih = (pasangNama || '').replace(/ \(⌚.*$/, ''); if (atas && atas.nm && bersih && atas.nm !== bersih) return <p className="text-[11.5px] text-amber-700 font-bold">⚠️ Nama tag terkuat "{atas.nm}" berbeda dari "{bersih}" — pastikan tag-nya yang benar.</p>; return null; })()}
              {pasangList.length === 0 && <p className="text-slate-400 text-[12.5px]">📶 Mencari tag… (tag harus menyala & dekat, ±1 m)</p>}
              {pasangList.map((t, i) => {
                const nm = namaMap[t.mac] || (t.nm ? namaMap[t.nm] : undefined);
                return (
                  <div key={t.mac} className={`flex items-center gap-2 border rounded-xl p-2 ${i === 0 ? 'border-hijau bg-emerald-50' : 'border-slate-200'}`}>
                    <div className="flex-1 min-w-0">
                      <b className="text-[13px] block truncate">{i === 0 ? '🎯 ' : ''}{t.jmSiar ? '✅ ' + t.jmSiar.nama + ' (MAC siar)' : (nm ? nm.nama : (t.nm ? '🏷️ ' + t.nm : 'Tag baru'))}</b>
                      <small className="text-slate-500 text-[11px]">{t.macSiar || 'iTag'} …{pendek(t.mac)} · {t.rssi} dBm{(t.jmSiar && t.jmSiar.regu) ? ' · ' + t.jmSiar.regu : (nm && nm.regu ? ' · ' + nm.regu : '')}</small>
                    </div>
                    <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${t.pct > 60 ? 'bg-emerald-500' : t.pct > 30 ? 'bg-amber-400' : 'bg-blue-400'}`} style={{ width: t.pct + '%' }} />
                    </div>
                    <button className="btn btn-muda !min-h-[36px] !px-2.5 !text-[12px]" title="Sinkron nama tag (konek sebentar, tag bunyi)" disabled={!!sinkroning} onClick={() => sinkronSatu(t)}>
                      {sinkroning === t.mac ? '⏳' : '🔄'}
                    </button>
                    <button className="btn btn-utama !min-h-[36px] !px-2.5 !text-[12px]" onClick={() => kunciTag(t.mac, t.nm, t.macSiar)}>🔒</button>
                  </div>
                );
              })}
              {pasangList.length > 0 && (
                <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
                  <b className="text-[11px] text-slate-500">🧪 Data mentah tag (v-MAC2) — screenshot kotak ini (buat teknis):</b>
                  {pasangList.map(t => (
                    <p key={t.mac} className="text-[10px] font-mono text-slate-600 break-all leading-relaxed">
                      {namaMap[t.mac]?.nama || 'tag baru'} …{pendek(t.mac)} rssi{t.rssi} | {t.svc || 'svc:-'} {t.mfr || 'mfr:-'}{t.macSiar ? ' | 🔑' + t.macSiar + (t.jmSiar ? ' → ' + t.jmSiar.nama + ' (' + t.jmSiar.regu + ')' : '') : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          {sinkron && <p className="text-[12px] mt-2 font-bold text-slate-700">{sinkron}</p>}
          {pasangInfo && <p className="text-[12.5px] mt-2 font-bold">{pasangInfo}</p>}
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            💡 <b>MAC = identitas asli tag</b> (lihat di app iTag / kolom MAC di Kelola Jamaah ✏️). Tag yang MAC-nya terdaftar akan ditandai <b>✅ (MAC siar)</b> di daftar scan dari HP mana pun — gotong royong, tanpa perlu ganti nama tag. Kalau nama tag <b>iTAG(MAC)</b>, MAC ikut tersimpan otomatis. Dekatkan HANYA tag jamaah ini: sinyal terkuat = tag di dekat Anda. Kotak data mentah menampilkan <b>🔑 MAC siaran</b> tiap tag — salin ke Kelola Jamaah bila belum terisi.
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
