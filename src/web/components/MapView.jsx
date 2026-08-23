import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApp } from '../App.jsx';
import { bacaGPS } from '../lib/gps.js';
import { api } from '../lib/api.js';

export default function MapView() {
  const { state, muat, tampilToast, bolehKelola } = useApp();
  const elRef = useRef(null);
  const petaRef = useRef(null);
  const dasarRef = useRef({});
  const [satelit, setSatelit] = useState(localStorage.getItem('iphi_peta') === 'satelit');
  const sayaRef = useRef(null);
  const titikRef = useRef({});        // id -> {circle, label}
  const lastTitikKey = useRef('');
  const sedangSeret = useRef(false);

  /* init peta sekali */
  useEffect(() => {
    if (!elRef.current || petaRef.current) return;
    const peta = L.map(elRef.current, { zoomControl: true }).setView([-6.9932, 110.4203], 15);
    petaRef.current = peta;
    dasarRef.current.jalan = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    dasarRef.current.satelit = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri World Imagery' });
    (satelit ? dasarRef.current.satelit : dasarRef.current.jalan).addTo(peta);
    setTimeout(() => peta.invalidateSize(), 150);
    (async () => {
      const pos = await bacaGPS();
      sayaRef.current = { lat: pos.lat, lng: pos.lng };
      L.circleMarker([pos.lat, pos.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2A6FDB', fillOpacity: 1 })
        .bindTooltip('📍 Posisi Anda', { permanent: true, direction: 'top' }).addTo(peta);
      peta.setView([pos.lat, pos.lng], 16);
    })();
    return () => { peta.remove(); petaRef.current = null; };
  }, []);

  /* ganti lapisan */
  const ganti = () => {
    const peta = petaRef.current; if (!peta) return;
    const ke = !satelit;
    peta.removeLayer(ke ? dasarRef.current.jalan : dasarRef.current.satelit);
    (ke ? dasarRef.current.satelit : dasarRef.current.jalan).addTo(peta);
    localStorage.setItem('iphi_peta', ke ? 'satelit' : 'jalan');
    setSatelit(ke);
  };

  /* gambar & sinkron titik (bisa diseret utk yang berwenang) */
  useEffect(() => {
    const peta = petaRef.current; if (!peta || !state) return;
    const key = (state.titik || []).map(t => t.id + ':' + t.lat + ':' + t.lng + ':' + t.radius + ':' + t.nama).join('|');
    if (key === lastTitikKey.current) return;
    lastTitikKey.current = key;
    Object.values(titikRef.current).forEach(x => { peta.removeLayer(x.c); });
    titikRef.current = {};
    (state.titik || []).forEach(t => {
      const warna = t.tipe === 'tujuan' ? '#B48A2F' : '#0E7490';
      const c = L.circle([t.lat, t.lng], { radius: t.radius, color: warna, weight: 2, fillOpacity: 0.1 }).addTo(peta);
      c.bindTooltip(`<span class="lbl-titik">${t.tipe === 'tujuan' ? '🎯' : '📍'} ${t.nama}</span>`,
        { permanent: true, direction: 'center' });
      try { const el = (c.getElement && c.getElement()) || c._path; if (el) { el.style.pointerEvents = 'visiblePainted'; el.setAttribute('pointer-events', 'visiblePainted'); if (bolehKelola) el.style.cursor = 'move'; } } catch (e) {}
      if (bolehKelola) {
        c.on('mousedown', e => {
          L.DomEvent.preventDefault(e.originalEvent);
          peta.dragging.disable();
          const geser = ev => c.setLatLng(ev.latlng);
          const lepas = async ev => {
            peta.off('mousemove', geser); peta.off('mouseup', lepas);
            peta.dragging.enable();
            const { lat, lng } = ev.latlng;
            if (sedangSeret.current) return;
            sedangSeret.current = true;
            try {
              const r = await api('/api/titik', { method: 'PUT', body: JSON.stringify({ id: t.id, lat, lng, sumber: 'seret' }) });
              if (r.ok) { tampilToast(`✋ "${t.nama}" dipindah`); muat(); }
              else tampilToast('Gagal: ' + (r.error || ''), true);
            } finally { setTimeout(() => { sedangSeret.current = false; }, 400); }
          };
          peta.on('mousemove', geser); peta.on('mouseup', lepas);
        });
      }
      titikRef.current[t.id] = { c };
    });
  }, [state, bolehKelola, muat, tampilToast]);

  /* tombol titik kumpul cepat */
  const buatKumpul = async () => {
    const pos = await bacaGPS(12000, true);
    const d = await api('/api/titik', { method: 'POST', body: JSON.stringify({ lat: pos.lat, lng: pos.lng, radius: 100, tipe: 'kumpul', sumber: 'cepat' }) });
    if (d.ok) {
      muat();
      petaRef.current?.flyTo([pos.lat, pos.lng], 16);
      tampilToast(`📍 "${d.titik.nama}" dibuat di posisi Anda (radius 100 m)`);
    } else tampilToast('Gagal: ' + (d.error || ''), true);
  };

  const pusatkan = async () => {
    const pos = await bacaGPS(12000, true);
    petaRef.current?.flyTo([pos.lat, pos.lng], 17);
  };

  return (
    <div className="order-1 md:order-2 relative flex-1 min-h-[58vh] md:min-h-0">
      <div ref={elRef} className="absolute inset-0 z-0" />
      <div className="absolute top-3 right-3 z-[500] flex gap-2">
        <button className="btn !min-h-[44px] !px-4 !text-[13px] bg-white/95 text-slate-800 border border-slate-200 shadow-md" onClick={ganti}>
          {satelit ? '🗺️ Street' : '🛰️ Satelit'}
        </button>
        <button className="btn !min-h-[44px] !px-4 !text-[13px] bg-white/95 text-slate-800 border border-slate-200 shadow-md" onClick={pusatkan}>📍</button>
      </div>
      {bolehKelola && (
        <button className="btn btn-utama absolute left-3 bottom-4 z-[500] shadow-lg !px-5" onClick={buatKumpul}>
          📍 Buat Titik Kumpul
        </button>
      )}
    </div>
  );
}
