import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { isNativeApp, startBLE, stopBLE, bunyikanGelang as nativeBunyikan, vibrate as nativeVibrate } from '../lib/nativeBridge.js';
import { useApp } from '../App.jsx';

// Hitung jarak dari RSSI (estimasi)
const hitungJarak = (rssi) => {
  if (!rssi || rssi === 0) return null;
  // Rumus: jarak = 10^((-50 - RSSI) / 20)
  // -50 dBm = referensi (1 meter)
  const jarak = Math.pow(10, (-50 - rssi) / 20);
  return Math.round(jarak);
};

export default function KawalPage() {
  const { state, tampilToast } = useApp();
  const [jmList, setJmList] = useState([]);
  const [radius, setRadius] = useState(() => { try { return parseInt(localStorage.getItem('iphi_kawal_radius')) || 500; } catch { return 500; } });
  const [aktif, setAktif] = useState(false);
  const [statusMap, setStatusMap] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [progress, setProgress] = useState(null); // {terdeteksi, total, persen}
  const [reguList, setReguList] = useState([]);
  const [pilihRegu, setPilihRegu] = useState(() => { try { return localStorage.getItem('iphi_rombongan') || ''; } catch { return ''; } });

  const petaRef = useRef(null);
  const mapRef = useRef(null);
  const sayaRef = useRef(null);
  const radiusCircleRef = useRef(null);
  const jamaahMarkersRef = useRef({});
  const userLat = useRef(0);
  const userLng = useRef(0);
  const tickRef = useRef(null);
  const deteksiRef = useRef({}); // {jamaahId: timestampTerakhirDeteksi}
  const posisiRef = useRef({}); // {jamaahId: {lat, lng}} posisi terakhir terdeteksi
  const alertIdsRef = useRef(new Set()); // Fase 1: hindari alert duplikat & getar berulang

  useEffect(() => {
    if (state?.jamaah) {
      let filtered = state.jamaah.filter(m => m.punya_gelang);
      if (pilihRegu) {
        filtered = filtered.filter(m => m.regu === pilihRegu);
      }
      setJmList(filtered);
    }
  }, [state, pilihRegu]);

  // Save radius ke localStorage
  useEffect(() => { try { localStorage.setItem('iphi_kawal_radius', String(radius)); } catch {} }, [radius]);

  // Save pilihRegu ke localStorage
  useEffect(() => { try { localStorage.setItem('iphi_rombongan', pilihRegu); } catch {} }, [pilihRegu]);

  // Load daftar regu
  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/pub/regu').then(r => r.json());
        if (d.ok) setReguList(d.regu || []);
      } catch (e) {}
    })();
  }, []);

  // Init map
  useEffect(() => {
    if (!petaRef.current || mapRef.current) return;
    const map = L.map(petaRef.current, { zoomControl: true }).setView([-6.9932, 110.4203], 16);
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    setTimeout(() => map.invalidateSize(), 200);

    // Coba dapat GPS dari native
    let attempts = 0;
    const cobaGps = () => {
      if (window._nativeLat && window._nativeLng && window._nativeLat !== 0) {
        updateMap(window._nativeLat, window._nativeLng);
        return;
      }
      attempts++;
      if (attempts < 25) setTimeout(cobaGps, 200);
      else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          p => updateMap(p.coords.latitude, p.coords.longitude),
          () => {},
          { enableHighAccuracy: true }
        );
      }
    };
    cobaGps();

    // Fase 1 (bug #11): native mengirim ke window.onGPSUpdate — dengarkan callback nyata,
    // bukan hanya window._kawalGpsUpdate/_nativeLat sekali-baca. Ini yang membuat marker
    // watcher & lingkaran radius bergerak live di peta.
    window._kawalGpsUpdate = (lat, lng) => updateMap(lat, lng);
    window.onGPSUpdate = (lat, lng) => updateMap(lat, lng);
    return () => {
      window._kawalGpsUpdate = null;
      window.onGPSUpdate = null;
      try { map.remove(); } catch {}
      mapRef.current = null;
    };
  }, []);

  // Fase 1: bila radius diubah, perbarui lingkaran tanpa menunggu GPS berikutnya
  useEffect(() => {
    radiusCircleRef.current?.setRadius(radius);
  }, [radius]);

  const updateMap = (lat, lng) => {
    userLat.current = lat;
    userLng.current = lng;
    if (!mapRef.current) return;

    // Marker posisi saya (biru)
    if (!sayaRef.current) {
      sayaRef.current = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          html: '<div style="width:24px;height:24px;border-radius:50%;background:#2A6FDB;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>'
        })
      }).addTo(mapRef.current);
      mapRef.current.setView([lat, lng], 16);
    } else {
      sayaRef.current.setLatLng([lat, lng]);
    }

    // Lingkaran radius 500m
    if (radiusCircleRef.current) {
      radiusCircleRef.current.setLatLng([lat, lng]);
      radiusCircleRef.current.setRadius(radius);
    } else {
      radiusCircleRef.current = L.circle([lat, lng], {
        radius,
        color: '#0E7490',
        weight: 2,
        fillOpacity: 0.08,
        dashArray: '8,4'
      }).addTo(mapRef.current);
    }
  };

  // Update marker jamaah di peta
  const updateJamaahMarkers = (status) => {
    if (!mapRef.current) return;

    // Hapus marker lama
    Object.values(jamaahMarkersRef.current).forEach(m => {
      try { mapRef.current.removeLayer(m); } catch {}
    });
    jamaahMarkersRef.current = {};

    // Posisi device (pusat)
    const deviceLat = userLat.current;
    const deviceLng = userLng.current;
    if (!deviceLat || !deviceLng) return;

    // Hitung angle untuk setiap jamaah (agar tidak tumpang tindih)
    const angleStep = (2 * Math.PI) / Math.max(jmList.length, 1);

    jmList.forEach((m, idx) => {
      const s = status[m.id];
      if (!s) return;

      // Hitung posisi berdasarkan jarak RSSI
      let posisi;
      const jarak = s.rssi ? hitungJarak(s.rssi) : null;
      
      if (s.status === 'bersama' && jarak) {
        // Terdeteksi: posisi berdasarkan jarak RSSI dari device
        // Konversi meter ke derajat (approximate: 1 degree ≈ 111km)
        const jarakMeter = Math.min(jarak, radius); // Cap di radius
        const jarakDerajat = jarakMeter / 111000;
        const angle = angleStep * idx;
        posisi = {
          lat: deviceLat + Math.sin(angle) * jarakDerajat,
          lng: deviceLng + Math.cos(angle) * jarakDerajat
        };
      } else if (posisiRef.current[m.id]) {
        // Pernah terdeteksi sebelumnya: pakai posisi terakhir
        posisi = posisiRef.current[m.id];
      } else {
        // Belum pernah terdeteksi: tampilkan di dekat device
        const offset = 0.0001; // ~10 meter
        const angle = angleStep * idx;
        posisi = {
          lat: deviceLat + Math.sin(angle) * offset,
          lng: deviceLng + Math.cos(angle) * offset
        };
      }

      const warna = s.status === 'bersama' ? '#38A169' : s.status === 'jauh' ? '#EF4444' : '#94A3B8';
      const ikon = s.status === 'bersama' ? '✅' : s.status === 'jauh' ? '❓' : '⏳';
      const teksStatus = s.status === 'bersama' ? 'BERSAMA' : s.status === 'jauh' ? 'JAUH' : 'menunggu';

      const marker = L.marker([posisi.lat, posisi.lng], {
        icon: L.divIcon({
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          html: `<div style="width:28px;height:28px;border-radius:50%;background:${warna};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:14px">${ikon}</div>`
        })
      }).addTo(mapRef.current);

      const waktuTerakhir = s.terakhir ? new Date(s.terakhir).toLocaleTimeString('id-ID') : '—';
      marker.bindPopup(`
        <b>${m.nama}</b><br>
        ${m.regu || ''}<br>
        Status: <b>${teksStatus}</b><br>
        ${jarak ? 'Jarak: ~' + jarak + ' m<br>' : ''}
        Terakhir: ${waktuTerakhir}<br>
        ${s.rssi ? 'RSSI: ' + s.rssi : ''}
      `);

      jamaahMarkersRef.current[m.id] = marker;
    });
  };

  // Mulai kawal
  const mulai = () => {
    if (!pilihRegu) {
      tampilToast('⚠️ Pilih rombongan terlebih dahulu', true);
      return;
    }
    setAktif(true);
    setAlerts([]);
    deteksiRef.current = {};
    posisiRef.current = {};
    alertIdsRef.current = new Set();
    setStatusMap({});
    setProgress({ terdeteksi: 0, total: jmList.length, persen: 0 });

    // Poll status dari server setiap 3 detik
    tickRef.current = setInterval(async () => {
      try {
        const rombonganId = localStorage.getItem('iphi_rombongan') || '';
        if (!rombonganId) return;

        const res = await fetch(`/api/pub/kawal-status?rombongan=${encodeURIComponent(rombonganId)}`);
        const data = await res.json();
        if (!data.ok) return;

        const now = Date.now();
        const newStatus = {};
        const newAlerts = [];

        // Fase 1 (bug #3): sumber kebenaran alert = data.alert dari server (kawal_alert),
        // bukan menghitung ulang di sisi klien (yang tidak konsisten lintas device).
        const serverAlerts = (data.alert || []).map(a => ({
          id: 'srv-' + a.id,
          nama: a.jamaah || 'Jamaah',
          tipe: a.tipe,
          menit: a.durasi,
          waktu: a.waktu ? new Date(a.waktu).toLocaleTimeString('id-ID') : '—'
        }));

        // Update posisi dari server: jamaah 'bersama' ditempatkan di koordinat watcher yang live.
        // Fase 1 (bug #8): gunakan koordinat sahih (bukan 0,0); fallback ke RSSI hanya bila tanpa koordinat.
        const devicePosisi = (data.posisi
          && Number.isFinite(data.posisi.lat) && Number.isFinite(data.posisi.lng)
          && Math.abs(data.posisi.lat) > 0.0001 && Math.abs(data.posisi.lng) > 0.0001)
          ? data.posisi : null;
        if (devicePosisi) {
          (data.jamaah || []).forEach(j => {
            if (j.status === 'bersama') {
              posisiRef.current[j.id] = { lat: devicePosisi.lat, lng: devicePosisi.lng };
            }
          });
        }

        // Proses status jamaah
        jmList.forEach(m => {
          const serverJm = (data.jamaah || []).find(j => j.id === m.id);
          if (!serverJm) {
            newStatus[m.id] = { status: 'menunggu', terakhir: null, rssi: null };
            return;
          }
          const status = serverJm.status || 'jauh';
          newStatus[m.id] = { status, terakhir: serverJm.terakhir, rssi: serverJm.rssi };
        });

        setStatusMap(newStatus);
        updateJamaahMarkers(newStatus);

        // Update progress
        const terdeteksi = Object.values(newStatus).filter(s => s.status === 'bersama').length;
        setProgress({
          terdeteksi,
          total: jmList.length,
          persen: jmList.length ? Math.round((terdeteksi / jmList.length) * 100) : 0
        });

        // Fase 1 (bug #4): hanya tampilkan & getar untuk alert BARU (dedup), bukan tiap poll.
        const fresh = serverAlerts.filter(a => !alertIdsRef.current.has(a.id));
        fresh.forEach(a => alertIdsRef.current.add(a.id));
        if (fresh.length > 0) {
          setAlerts(prev => [...prev, ...fresh]);
          if (isNativeApp()) nativeVibrate('500,200,500,200,500');
          else if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
        }
      } catch (e) {
        console.error('[Kawal] Error polling:', e);
      }
    }, 3000);

    // Start BLE scan via native bridge
    if (isNativeApp()) {
      const serverUrl = localStorage.getItem('iphi_server_url') || 'https://kbihu.iphi-haji.workers.dev';
      const rombonganId = localStorage.getItem('iphi_rombongan') || '';
      startBLE(serverUrl, rombonganId, {
        onDetected: (mac, rssi, name) => {
          console.log('[Kawal] Detected:', mac, rssi);
          // Update posisi terakhir terdeteksi = posisi device saat ini
          const jm = jmList.find(m => m.mac_tag === mac);
          if (jm) {
            deteksiRef.current[jm.id] = Date.now();
            if (userLat.current && userLng.current) {
              posisiRef.current[jm.id] = { lat: userLat.current, lng: userLng.current };
            }
          }
        },
        onStatus: (status) => console.log('[Kawal] BLE:', status)
      });
    }
  };

  // Henti kawal
  const henti = () => {
    setAktif(false);
    setStatusMap({});
    setAlerts([]);
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (isNativeApp()) stopBLE();
    // Hapus marker jamaah
    Object.values(jamaahMarkersRef.current).forEach(m => {
      try { mapRef.current?.removeLayer(m); } catch {}
    });
    jamaahMarkersRef.current = {};
  };

  // Bunyikan gelang
  const bunyikan = (m) => {
    const mac = m.mac_tag || (m.beacon_id ? m.beacon_id.split(',')[0] : '');
    if (!mac) {
      tampilToast('⚠️ Jamaah belum punya gelang terdaftar', true);
      return;
    }
    if (isNativeApp()) {
      nativeBunyikan(mac);
      tampilToast(`🔊 Bunyikan gelang ${m.nama}...`);
    } else {
      tampilToast('⚠️ Butuh IPHI App untuk bunyikan gelang', true);
    }
  };

  // Statistik
  const stats = {
    total: jmList.length,
    bersama: Object.values(statusMap).filter(s => s.status === 'bersama').length,
    jauh: Object.values(statusMap).filter(s => s.status === 'jauh').length,
    menunggu: Object.values(statusMap).filter(s => s.status === 'menunggu').length,
  };

  return (
    <div className="p-3 space-y-3 max-w-[640px] mx-auto pb-10">
      {/* Header + Peta */}
      <div className="kartu p-4 space-y-3">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-hijau">🛡️ Kawal Rombongan</h2>
        <p className="text-slate-500 text-[12px]">
          Pantau jamaah via sinyal Bluetooth. Radius {radius}m. Hilang &gt;3 menit = alarm.
        </p>

        {/* Peta */}
        <div ref={petaRef} className="h-[250px] rounded-xl border border-slate-200" />

        {/* Pilih Rombongan */}
        <div>
          <label className="text-[12px] font-bold text-slate-600">Rombongan</label>
          <select
            className="input mt-1"
            value={pilihRegu}
            onChange={e => setPilihRegu(e.target.value)}
            disabled={aktif}
          >
            <option value="">— pilih rombongan —</option>
            {reguList.map(r => <option key={r.id} value={r.nama}>{r.nama}</option>)}
          </select>
        </div>

        {/* Radius setting */}
        <div>
          <label className="text-[12px] font-bold text-slate-600 flex justify-between">
            <span>Radius Visual</span>
            <span className="font-mono">{radius} m</span>
          </label>
          <input
            type="range"
            min="50"
            max="1000"
            step="50"
            value={radius}
            onChange={e => setRadius(Number(e.target.value))}
            className="w-full accent-emerald-700"
          />
          <div className="flex gap-2 mt-1">
            {[100, 200, 500, 1000].map(r => (
              <button
                key={r}
                className={`btn flex-1 !min-h-[34px] !text-[12px] ${radius === r ? 'btn-utama' : 'btn-muda'}`}
                onClick={() => setRadius(r)}
              >
                {r >= 1000 ? '1km' : r + 'm'}
              </button>
            ))}
          </div>
        </div>

        {/* Statistik */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="bg-emerald-50 rounded-xl p-2">
            <b className="text-lg text-hijau">{stats.bersama}</b>
            <br />
            <small className="text-[10px] font-bold text-slate-500">BERSAMA</small>
          </div>
          <div className="bg-red-50 rounded-xl p-2">
            <b className="text-lg text-red-600">{stats.jauh}</b>
            <br />
            <small className="text-[10px] font-bold text-slate-500">JAUH</small>
          </div>
          <div className="bg-slate-50 rounded-xl p-2">
            <b className="text-lg text-slate-400">{stats.menunggu}</b>
            <br />
            <small className="text-[10px] font-bold text-slate-500">MENUNGGU</small>
          </div>
          <div className="bg-blue-50 rounded-xl p-2">
            <b className="text-lg text-blue-600">{stats.total}</b>
            <br />
            <small className="text-[10px] font-bold text-slate-500">TOTAL</small>
          </div>
        </div>

        {/* Progress indicator */}
        {aktif && progress && progress.total > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <div className="flex justify-between text-[12px] mb-1">
              <span className="font-bold text-blue-700">📡 Mengidentifikasi gelang...</span>
              <span className="font-mono text-blue-600">{progress.terdeteksi}/{progress.total}</span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${progress.persen}%` }}
              />
            </div>
            <p className="text-[11px] text-blue-500 mt-1">
              {progress.terdeteksi < progress.total
                ? `Estimasi: ${Math.round((progress.total - progress.terdeteksi) * 1.5)} detik lagi`
                : '✅ Semua gelang teridentifikasi!'}
            </p>
          </div>
        )}

        {/* Tombol Mulai/Henti */}
        <button
          className={`w-full btn ${aktif ? 'btn-merah' : 'btn-utama'} !min-h-[52px] !text-[16px]`}
          onClick={aktif ? henti : mulai}
        >
          {aktif ? '⏹ Berhenti Kawal' : '▶️ Mulai Kawal'}
        </button>
      </div>

      {/* Daftar Jamaah */}
      <div className="kartu p-4 space-y-2">
        <b className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">👥 Rombongan</b>
        {jmList.length === 0 && (
          <p className="text-slate-400 text-[13px]">Tidak ada jamaah dengan gelang.</p>
        )}
        {jmList.map(m => {
          const s = statusMap[m.id];
          const status = s?.status || 'menunggu';
          const warnaBg =
            status === 'bersama'
              ? 'bg-emerald-50 border-emerald-200'
              : status === 'jauh'
              ? 'bg-red-50 border-red-300'
              : 'bg-slate-50 border-slate-200';
          const ikon = status === 'bersama' ? '✅' : status === 'jauh' ? '❓' : '⏳';
          const teksStatus =
            status === 'bersama'
              ? 'BERSAMA'
              : status === 'jauh'
              ? 'JAUH'
              : 'menunggu';
          const waktuTerakhir = s?.terakhir
            ? new Date(s.terakhir).toLocaleTimeString('id-ID')
            : null;

          return (
            <div
              key={m.id}
              className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 ${warnaBg}`}
            >
              <span className="text-lg">{ikon}</span>
              <div className="flex-1 min-w-0">
                <b className="text-[13.5px] block truncate">{m.nama}</b>
                <span
                  className={`text-[11px] ${
                    status === 'jauh' ? 'text-red-700 font-bold' : 'text-slate-500'
                  }`}
                >
                  {m.regu ? m.regu + ' · ' : ''}
                  {teksStatus}
                  {s?.rssi ? ' · ' + hitungJarak(s.rssi) + 'm' : ''}
                  {waktuTerakhir ? ' · ' + waktuTerakhir : ''}
                </span>
              </div>
              <button
                className="btn btn-muda !min-h-[34px] !px-2.5 !text-[12px]"
                title="Bunyikan gelang"
                onClick={() => bunyikan(m)}
              >
                🔊
              </button>
            </div>
          );
        })}
      </div>

      {/* Alert */}
      {alerts.length > 0 && (
        <div className="kartu p-4 space-y-2">
          <b className="text-[11px] font-extrabold uppercase tracking-wider text-red-400">
            ⚠️ ALERT
          </b>
          {alerts
            .slice(-10)
            .reverse()
            .map((a, i) => (
              <div
                key={i}
                className="text-[12px] text-red-700 bg-red-50 rounded-lg p-2"
              >
                ❌ <b>{a.nama}</b> — hilang {a.menit} menit · {a.waktu}
              </div>
            ))}
          <button
            className="btn btn-muda w-full !text-[12px]"
            onClick={() => setAlerts([])}
          >
            🗑 Bersihkan Alert
          </button>
        </div>
      )}
    </div>
  );
}
