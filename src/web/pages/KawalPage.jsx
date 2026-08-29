import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { isNativeApp, startBLE, stopBLE, bunyikanGelang as nativeBunyikan, vibrate as nativeVibrate } from '../lib/nativeBridge.js';
import { useApp } from '../App.jsx';

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function KawalPage() {
  const { state, tampilToast } = useApp();
  const [jmList, setJmList] = useState([]);
  const [radius, setRadius] = useState(() => { try { return parseInt(localStorage.getItem('iphi_kawal_radius')) || 100; } catch { return 100; } });
  const [aktif, setAktif] = useState(false);
  const [statusMap, setStatusMap] = useState({});
  const [alerts, setAlerts] = useState([]);

  const petaRef = useRef(null);
  const mapRef = useRef(null);
  const sayaRef = useRef(null);
  const radiusCircleRef = useRef(null);
  const jamaahMarkersRef = useRef({});
  const userLat = useRef(0);
  const userLng = useRef(0);
  const tickRef = useRef(null);
  const deteksiRef = useRef({});

  useEffect(() => {
    if (state?.jamaah) setJmList(state.jamaah.filter(m => m.punya_gelang));
  }, [state]);

  useEffect(() => { try { localStorage.setItem('iphi_kawal_radius', String(radius)); } catch {} }, [radius]);

  // Init map
  useEffect(() => {
    if (!petaRef.current || mapRef.current) return;
    const map = L.map(petaRef.current, { zoomControl: true }).setView([-6.9932, 110.4203], 16);
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    setTimeout(() => map.invalidateSize(), 200);

    let attempts = 0;
    const cobaGps = () => {
      if (window._nativeLat && window._nativeLng && window._nativeLat !== 0) { updateMap(window._nativeLat, window._nativeLng); return; }
      attempts++;
      if (attempts < 25) setTimeout(cobaGps, 200);
      else if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => updateMap(p.coords.latitude, p.coords.longitude), () => {}, { enableHighAccuracy: true });
    };
    cobaGps();
    window._kawalGpsUpdate = (lat, lng) => updateMap(lat, lng);
    return () => { window._kawalGpsUpdate = null; try { map.remove(); } catch {} mapRef.current = null; };
  }, []);

  const updateMap = (lat, lng) => {
    userLat.current = lat; userLng.current = lng;
    if (!mapRef.current) return;
    if (!sayaRef.current) {
      sayaRef.current = L.marker([lat, lng], { icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: '<div style="width:24px;height:24px;border-radius:50%;background:#2A6FDB;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>' }) }).addTo(mapRef.current);
      mapRef.current.setView([lat, lng], 16);
    } else sayaRef.current.setLatLng([lat, lng]);
    if (radiusCircleRef.current) { radiusCircleRef.current.setLatLng([lat, lng]); radiusCircleRef.current.setRadius(radius); }
    else radiusCircleRef.current = L.circle([lat, lng], { radius, color: '#0E7490', weight: 2, fillOpacity: 0.08, dashArray: '8,4' }).addTo(mapRef.current);
  };

  const updateJamaahMarkers = (status) => {
    if (!mapRef.current) return;
    Object.values(jamaahMarkersRef.current).forEach(m => { try { mapRef.current.removeLayer(m); } catch {} });
    jamaahMarkersRef.current = {};
    jmList.forEach(m => {
      const s = status[m.id];
      if (!s || !s.lat || !s.lng) return;
      const warna = s.status === 'dalam' ? '#38A169' : s.status === 'luar' ? '#EAB308' : s.status === 'hilang' ? '#EF4444' : '#94A3B8';
      const ikon = s.status === 'dalam' ? '✅' : s.status === 'luar' ? '⚠️' : s.status === 'hilang' ? '❓' : '⏳';
      const marker = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div style="width:28px;height:28px;border-radius:50%;background:${warna};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:14px">${ikon}</div>` }) }).addTo(mapRef.current);
      marker.bindPopup(`<b>${m.nama}</b><br>${m.regu || ''}<br>${s.jarak ? Math.round(s.jarak) + ' m' : '—'}<br>Status: ${s.status}`);
      jamaahMarkersRef.current[m.id] = marker;
    });
  };

  const mulai = () => {
    setAktif(true); setAlerts([]); deteksiRef.current = {}; setStatusMap({});
    // Update posisi jamaah dari server setiap 3 detik
    tickRef.current = setInterval(() => {
      const now = Date.now();
      const newStatus = {}; const newAlerts = [];
      jmList.forEach(m => {
        const posisi = m.posisi;
        if (!posisi) { newStatus[m.id] = { status: 'tidak_ada', jarak: null, lat: null, lng: null }; return; }
        const jarak = haversine(userLat.current, userLng.current, posisi.lat, posisi.lng);
        const diDalam = jarak <= radius;
        const terakhirDeteksi = deteksiRef.current[m.id] || 0;
        const menitTakTerlihat = (now - terakhirDeteksi) / 60000;
        let status = 'dalam';
        if (!diDalam) { status = 'luar'; if (menitTakTerlihat > 1) { status = 'hilang'; newAlerts.push({ id: m.id, nama: m.nama, tipe: 'hilang', waktu: new Date().toLocaleTimeString('id-ID') }); } }
        newStatus[m.id] = { status, jarak, lat: posisi.lat, lng: posisi.lng, terakhirDeteksi };
      });
      setStatusMap(newStatus); updateJamaahMarkers(newStatus);
      if (newAlerts.length > 0) { setAlerts(prev => [...prev, ...newAlerts]); if (isNativeApp()) nativeVibrate('500,200,500'); else if (navigator.vibrate) navigator.vibrate([500, 200, 500]); }
    }, 3000);
    // Start BLE scan
    if (isNativeApp()) {
      const serverUrl = localStorage.getItem('iphi_server_url') || 'https://kbihu.iphi-haji.workers.dev';
      const rombonganId = localStorage.getItem('iphi_rombongan') || '';
      startBLE(serverUrl, rombonganId, {
        onDetected: (mac, rssi, name) => {
          const jm = jmList.find(m => m.mac_tag === mac);
          if (jm) deteksiRef.current[jm.id] = Date.now();
        },
        onStatus: (status) => console.log('[Kawal] BLE:', status)
      });
    }
  };

  const henti = () => {
    setAktif(false);
    setStatusMap({});
    setAlerts([]);
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (isNativeApp()) stopBLE();
    // Hapus marker jamaah dari peta
    Object.values(jamaahMarkersRef.current).forEach(m => { try { mapRef.current?.removeLayer(m); } catch {} });
    jamaahMarkersRef.current = {};
  };

  // Bunyikan gelang - gunakan MAC atau beacon_id
  const bunyikan = (m) => {
    const mac = m.mac_tag || (m.beacon_id ? m.beacon_id.split(',')[0] : '');
    if (!mac) { tampilToast('⚠️ Jamaah belum punya gelang terdaftar', true); return; }
    if (isNativeApp()) {
      nativeBunyikan(mac);
      tampilToast(`🔊 Bunyikan gelang ${m.nama}...`);
    } else {
      tampilToast('⚠️ Butuh IPHI App untuk bunyikan gelang', true);
    }
  };

  const stats = {
    total: jmList.length,
    dalam: Object.values(statusMap).filter(s => s.status === 'dalam').length,
    luar: Object.values(statusMap).filter(s => s.status === 'luar').length,
    hilang: Object.values(statusMap).filter(s => s.status === 'hilang').length,
  };

  return (
    <div className="p-3 space-y-3 max-w-[640px] mx-auto pb-10">
      <div className="kartu p-4 space-y-3">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-hijau">🛡️ Kawal Rombongan</h2>
        <p className="text-slate-500 text-[12px]">Pantau posisi rombongan. Jika jamaah keluar radius atau hilang >1 menit → alarm.</p>
        <div ref={petaRef} className="h-[250px] rounded-xl border border-slate-200" />
        <div>
          <label className="text-[12px] font-bold text-slate-600 flex justify-between"><span>Radius</span><span className="font-mono">{radius} m</span></label>
          <input type="range" min="50" max="500" step="10" value={radius} onChange={e => setRadius(Number(e.target.value))} className="w-full accent-emerald-700" disabled={aktif} />
          <div className="flex gap-2 mt-1">
            {[50, 100, 200, 500].map(r => <button key={r} className={`btn flex-1 !min-h-[34px] !text-[12px] ${radius === r ? 'btn-utama' : 'btn-muda'}`} onClick={() => !aktif && setRadius(r)} disabled={aktif}>{r}m</button>)}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="bg-emerald-50 rounded-xl p-2"><b className="text-lg text-hijau">{stats.dalam}</b><br/><small className="text-[10px] font-bold text-slate-500">DALAM</small></div>
          <div className="bg-amber-50 rounded-xl p-2"><b className="text-lg text-amber-700">{stats.luar}</b><br/><small className="text-[10px] font-bold text-slate-500">LUAR</small></div>
          <div className="bg-red-50 rounded-xl p-2"><b className="text-lg text-red-600">{stats.hilang}</b><br/><small className="text-[10px] font-bold text-slate-500">HILANG</small></div>
          <div className="bg-slate-50 rounded-xl p-2"><b className="text-lg text-slate-600">{stats.total}</b><br/><small className="text-[10px] font-bold text-slate-500">TOTAL</small></div>
        </div>
        <button className={`w-full btn ${aktif ? 'btn-merah' : 'btn-utama'} !min-h-[52px] !text-[16px]`} onClick={aktif ? henti : mulai}>
          {aktif ? '⏹ Berhenti Kawal' : '▶️ Mulai Kawal'}
        </button>
      </div>

      <div className="kartu p-4 space-y-2">
        <b className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">👥 Rombongan</b>
        {jmList.length === 0 && <p className="text-slate-400 text-[13px]">Tidak ada jamaah dengan gelang.</p>}
        {jmList.map(m => {
          const s = statusMap[m.id];
          const jarak = s?.jarak != null ? Math.round(s.jarak) : null;
          const status = s?.status || 'menunggu';
          const warnaBg = status === 'dalam' ? 'bg-emerald-50 border-emerald-200' : status === 'luar' ? 'bg-amber-50 border-amber-300' : status === 'hilang' ? 'bg-red-50 border-red-300' : 'bg-slate-50 border-slate-200';
          const ikon = status === 'dalam' ? '✅' : status === 'luar' ? '⚠️' : status === 'hilang' ? '❓' : '⏳';
          const teksStatus = status === 'dalam' ? 'dalam radius' : status === 'luar' ? 'DI LUAR RADIUS' : status === 'hilang' ? 'HILANG >1 mnt' : 'menunggu';
          return (
            <div key={m.id} className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 ${warnaBg}`}>
              <span className="text-lg">{ikon}</span>
              <div className="flex-1 min-w-0">
                <b className="text-[13.5px] block truncate">{m.nama}</b>
                <span className={`text-[11px] ${status === 'luar' || status === 'hilang' ? 'text-red-700 font-bold' : 'text-slate-500'}`}>{m.regu ? m.regu + ' · ' : ''}{teksStatus}{jarak != null ? ` · ${jarak} m` : ''}</span>
              </div>
              <button className="btn btn-muda !min-h-[34px] !px-2.5 !text-[12px]" title="Bunyikan gelang" onClick={() => bunyikan(m)}>🔊</button>
            </div>
          );
        })}
      </div>

      {alerts.length > 0 && (
        <div className="kartu p-4 space-y-2">
          <b className="text-[11px] font-extrabold uppercase tracking-wider text-red-400">⚠️ ALERT</b>
          {alerts.slice(-10).reverse().map((a, i) => (
            <div key={i} className="text-[12px] text-red-700 bg-red-50 rounded-lg p-2">❌ <b>{a.nama}</b> — {a.tipe === 'hilang' ? 'hilang >1 menit' : 'di luar radius'} · {a.waktu}</div>
          ))}
          <button className="btn btn-muda w-full !text-[12px]" onClick={() => setAlerts([])}>🗑 Bersihkan Alert</button>
        </div>
      )}
    </div>
  );
}
