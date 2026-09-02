import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApp } from '../App.jsx';
import { bacaGPS } from '../lib/gps.js';
import { api } from '../lib/api.js';
import { waLink, tampilkanHp } from '../lib/wa.js';
const jarakKe = (aLat, aLng, bLat, bLng) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const escHtml = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function MapView() {
  const { state, muat, tampilToast, bolehKelola } = useApp();
  const elRef = useRef(null);
  const petaRef = useRef(null);
  const dasarRef = useRef({});
  const [satelit, setSatelit] = useState(localStorage.getItem('iphi_peta') === 'satelit');
  const [modeTitik, setModeTitik] = useState(false);
  const [titikAktifAcara, setTitikAktifAcara] = useState('');
  const [sosBuka, setSosBuka] = useState(false);
  const sayaRef = useRef(null);
  const titikRef = useRef({});        // id -> {circle, label}
  const lastTitikKey = useRef('');
  const sedangSeret = useRef(false);

  /* init peta sekali */
  useEffect(() => {
    if (!elRef.current || petaRef.current) return;
    const peta = L.map(elRef.current, { zoomControl: true, center: [-6.9932, 110.4203], zoom: 15 });
    petaRef.current = peta;
    dasarRef.current.jalan = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    dasarRef.current.satelit = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri World Imagery' });
    (satelit ? dasarRef.current.satelit : dasarRef.current.jalan).addTo(peta);
    let mati = false;
    setTimeout(() => { if (!mati) { try { peta.invalidateSize(); } catch (e) {} } }, 150);
    (async () => {
      const pos = await bacaGPS();
      sayaRef.current = { lat: pos.lat, lng: pos.lng };
      L.marker([pos.lat, pos.lng], {
        interactive: false,
        icon: L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10],
          html: '<div class="pulse-wrap" style="--pc:#2A6FDB"><span class="pulse-ring"></span><span class="pulse-ring d2"></span><span class="pulse-core"></span></div>' })
      }).addTo(peta);
      peta.setView([pos.lat, pos.lng], 16, { animate: false });
    })();
    return () => { mati = true; try { peta.remove(); } catch (e) {} petaRef.current = null; };
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

  const kartuTitik = (t) => {
    const esc = escHtml;
    const js = state?.jamaah || [];
    const dalam = [], luar = [];
    js.forEach(m => {
      if (!m.posisi) { luar.push({ ...m, sisa: null }); return; }
      const d = jarakKe(m.posisi.lat, m.posisi.lng, t.lat, t.lng);
      if (d <= t.radius) dalam.push(m); else luar.push({ ...m, sisa: Math.round(d - t.radius) });
    });
    const baris = (arr, cls) => arr.slice(0, 6).map(m =>
      `<div style="display:flex;gap:6px;align-items:center;padding:2px 0"><span class="chip ${cls}">${esc(m.nama)}</span>${m.sisa != null ? `<small style="color:#64748b">±${m.sisa} m</small>` : ''}</div>`).join('')
      + (arr.length > 6 ? `<small style="color:#94a3b8">+${arr.length - 6} lainnya…</small>` : '');
    return `<div style="min-width:230px">
      <b style="font-size:14.5px">${t.tipe === 'tujuan' ? '🎯' : '📍'} ${esc(t.nama)}</b>
      <div style="font-size:11px;color:#64748b;margin:2px 0 6px">radius ${t.radius} m · oleh ${esc(t.dibuat_oleh || '-')}</div>
      <div style="display:flex;gap:6px;margin-bottom:4px">
        <span class="chip c-ok">✅ ${dalam.length} di titik</span>
        <span class="chip c-belum">⏳ ${luar.length} belum</span>
      </div>
      ${dalam.length ? baris(dalam, 'c-ok') : ''}
      ${luar.length ? baris(luar, 'c-belum') : ''}
      <div class="kartu-aksi" data-id="${t.id}" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"></div>
    </div>`;
  };

  /* gambar & sinkron titik (bisa diseret + popup kartu + bubble denyut) */
  useEffect(() => {
    const peta = petaRef.current; if (!peta || !state) return;
    const key = (state.titik || []).map(t => t.id + ':' + t.lat + ':' + t.lng + ':' + t.radius + ':' + t.nama + ':' + (t.id === titikAktifAcara ? 'A' : '')).join('|');
    if (key === lastTitikKey.current) return;
    lastTitikKey.current = key;
    Object.values(titikRef.current).forEach(x => { peta.removeLayer(x.c); if (x.p) peta.removeLayer(x.p); });
    titikRef.current = {};
    (state.titik || []).forEach(t => {
      const warna = t.tipe === 'tujuan' ? '#B48A2F' : '#0E7490';
      const c = L.circle([t.lat, t.lng], { radius: t.radius, color: warna, weight: 2, fillOpacity: 0.1 }).addTo(peta);
      c.bindPopup(() => kartuTitik(t), { maxWidth: 300 });
      const p = L.marker([t.lat, t.lng], {
        interactive: false, keyboard: false,
        icon: L.divIcon({
          className: '', iconSize: [30, 30], iconAnchor: [15, 15],
          html: `<div class="pulse-wrap ${t.id === titikAktifAcara ? 'pulse-kuat' : ''}" style="--pc:${warna}"><span class="pulse-ring"></span><span class="pulse-ring d2"></span><span class="pulse-core"></span></div>`
        })
      }).addTo(peta);
      try { const el = (c.getElement && c.getElement()) || c._path; if (el) { el.style.pointerEvents = 'visiblePainted'; el.setAttribute('pointer-events', 'visiblePainted'); if (bolehKelola) el.style.cursor = 'move'; } } catch (e) {}
      let mulaiSeret = null;
      if (bolehKelola) {
        c.on('mousedown', e => {
          L.DomEvent.preventDefault(e.originalEvent);
          peta.dragging.disable();
          mulaiSeret = e.latlng;
          const geser = ev => c.setLatLng(ev.latlng);
          const lepas = async ev => {
            peta.off('mousemove', geser); peta.off('mouseup', lepas);
            peta.dragging.enable();
            const { lat, lng } = ev.latlng;
            if (!mulaiSeret || jarakKe(mulaiSeret.lat, mulaiSeret.lng, lat, lng) < 3) { return; }
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
      titikRef.current[t.id] = { c, p };
    });
  }, [state, bolehKelola, muat, tampilToast, titikAktifAcara]);

  /* marker jamaah di peta (klik = info) */
  const jamaahRef = useRef({});
  useEffect(() => {
    const peta = petaRef.current; if (!peta || !state) return;
    const jk = (state.jamaah || []).filter(m => m.posisi).map(m => m.id + ':' + m.posisi.lat + ':' + m.posisi.lng + ':' + (m.sosAktif || '')).join('|');
    if (jk === jamaahRef.current._key) return;
    jamaahRef.current._key = jk;
    Object.values(jamaahRef.current).forEach(x => { if (x.m) peta.removeLayer(x.m); });
    Object.keys(jamaahRef.current).forEach(k => { if (k !== '_key') delete jamaahRef.current[k]; });
    (state.jamaah || []).forEach(m => {
      if (!m.posisi) return;
      const isSOS = m.sosAktif;
      const warna = isSOS ? '#B4232A' : m.punya_gelang && !m.punya_hp ? '#B48A2F' : '#12855A';
      const ukuran = isSOS ? 22 : 14;
      const html = isSOS
        ? `<div class="pulse-wrap pulse-kuat" style="--pc:${warna}"><span class="pulse-ring"></span><span class="pulse-ring d2"></span><span class="pulse-core" style="width:${ukuran-8}px;height:${ukuran-8}px;font-size:10px;display:flex;align-items:center;justify-content:center">🆘</span></div>`
        : `<div style="width:${ukuran}px;height:${ukuran}px;border-radius:50%;background:${warna};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`;
      const m2 = L.marker([m.posisi.lat, m.posisi.lng], {
        icon: L.divIcon({ className: '', iconSize: [isSOS ? 30 : ukuran, isSOS ? 30 : ukuran], iconAnchor: [isSOS ? 15 : ukuran/2, isSOS ? 15 : ukuran/2], html })
      }).addTo(peta);
      /* kartu jamaah: nama, regu, terakhir terlihat, SOS, no. HP + tombol WA, tautan kartu */
      const sumberIcon = m.punya_gelang && !m.punya_hp ? '⌚' : '📱';
      const wa = waLink(m.hp);
      const jamTampil = new Date(m.posisi.waktu).toLocaleTimeString('id-ID');
      const hpBaris = m.hp ? `<div style="font-size:11.5px;color:#475569;margin-top:3px">📞 ${escHtml(tampilkanHp(m.hp))}</div>` : '';
      const waTombol = wa
        ? `<a href="${wa}" target="_blank" rel="noopener" style="display:inline-block;margin-top:7px;background:#25D366;color:#fff;font-weight:700;font-size:12.5px;padding:8px 13px;border-radius:9px;text-decoration:none">💬 WhatsApp</a>`
        : '';
      m2.bindPopup(`<div style="min-width:185px;font-family:inherit">
        <b style="font-size:14px">${escHtml(m.nama)}</b>
        <div style="font-size:11.5px;color:#475569;margin-top:1px">${escHtml(m.regu || '—')}</div>
        <div style="font-size:11.5px;color:#475569;margin-top:3px">${sumberIcon} terakhir ${jamTampil} · ${m.titik ? 'di ' + escHtml(m.titik) : 'di luar titik'}</div>
        ${isSOS ? '<div style="color:#B4232A;font-weight:800;font-size:12px;margin-top:3px">🆘 SOS AKTIF</div>' : ''}
        ${hpBaris}${waTombol}
        <a href="#/kartu/${escHtml(m.id)}" style="display:inline-block;margin-top:7px;font-size:11.5px;color:#0B5D3B;font-weight:700;text-decoration:none">🪪 Kartu jamaah →</a>
      </div>`);
      jamaahRef.current[m.id] = { m: m2 };
    });
  }, [state]);

  /* aksi dalam kartu popup */
  useEffect(() => {
    const peta = petaRef.current; if (!peta) return;
    const buka = async (ev) => {
      const el = ev.popup.getElement(); if (!el) return;
      const box = el.querySelector('.kartu-aksi'); if (!box) return;
      const id = box.getAttribute('data-id');
      const t = (state?.titik || []).find(x => x.id === id); if (!t) return;
      const tombol = (label, cls, act) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.style.cssText = 'min-height:40px;padding:8px 12px;font-size:12px'; b.textContent = label; b.onclick = act; box.appendChild(b); };
      if (bolehKelola) {
        tombol('▶ Absensi', 'btn-utama', async () => {
          const r = await api('/api/absensi/event', { method: 'POST', body: JSON.stringify({ titikId: t.id }) });
          peta.closePopup();
          if (r.ok) { tampilToast(`✅ Absensi dimulai di "${t.nama}"`); location.hash = '#/absensi'; }
          else tampilToast('Gagal: ' + (r.error || ''), true);
        });
        tombol('📏', 'btn-muda', async () => {
          const v = prompt(`Radius "${t.nama}" (meter):`, t.radius);
          if (v === null) return;
          const rad = Number(v);
          if (!Number.isFinite(rad) || rad < 20) { tampilToast('Radius minimal 20 m', true); return; }
          const r = await api('/api/titik', { method: 'PUT', body: JSON.stringify({ id: t.id, radius: rad, sumber: 'kartu' }) });
          if (r.ok) { tampilToast(`📏 Radius → ${rad} m`); muat(); peta.closePopup(); }
        });
        tombol('✏️ Nama', 'btn-muda', async () => {
          peta.closePopup();
          await ubahNamaTitik(t);
        });
        tombol('🗑️', 'btn-emas', async () => {
          if (!confirm(`Hapus titik "${t.nama}"?`)) return;
          await api('/api/titik?id=' + encodeURIComponent(t.id), { method: 'DELETE' });
          peta.closePopup(); muat(); tampilToast('🗑️ Titik dihapus');
        });
      }
    };
    peta.on('popupopen', buka);
    return () => peta.off('popupopen', buka);
  }, [state, bolehKelola, muat, tampilToast]);

  /* tombol titik kumpul cepat */
  const buatKumpul = async () => {
    const waktu = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const nama = prompt('Nama titik kumpul:', `Titik Kumpul ${waktu}`);
    if (nama === null) return;
    const pos = await bacaGPS(12000, true);
    /* fix K7: jangan buat titik dari koordinat fallback (GPS gagal) — dulu titik bisa tercipta
       di koordinat default walau jamaah ada di lokasi lain */
    if (pos.fallback) { tampilToast('⚠️ GPS belum tersedia — pindah ke tempat terbuka, aktifkan lokasi, lalu coba lagi', true); return; }
    const d = await api('/api/titik', { method: 'POST', body: JSON.stringify({ lat: pos.lat, lng: pos.lng, radius: 100, tipe: 'kumpul', nama: nama.trim(), sumber: 'cepat' }) });
    if (d.ok) {
      muat();
      petaRef.current?.flyTo([pos.lat, pos.lng], 16);
      tampilToast(`📍 "${d.titik.nama}" dibuat di posisi Anda (radius 100 m)`);
    } else tampilToast('Gagal: ' + (d.error || ''), true);
  };

  /* Dari tombol "Buat Titik Kumpul" di halaman Absensi: #/?buattitik=1 → langsung buat titik */
  useEffect(() => {
    if (!location.hash.includes('buattitik')) return;
    history.replaceState(null, '', '#/');
    setTimeout(() => buatKumpul(), 400);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const ubahNamaTitik = async (t) => {
    const nama = prompt(`Ganti nama titik "${t.nama}":`, t.nama);
    if (nama === null) return;
    const v = nama.trim();
    if (!v) { tampilToast('Nama tidak boleh kosong', true); return; }
    const r = await api('/api/titik', { method: 'PUT', body: JSON.stringify({ id: t.id, nama: v }) });
    if (r.ok) { tampilToast(`✏️ → "${v}"`); muat(); }
    else tampilToast('Gagal: ' + (r.error || ''), true);
  };

  const mulaiTitikPeta = () => {
    if (modeTitik) { setModeTitik(false); return; }
    setModeTitik(true);
    tampilToast('🗺️ Ketuk lokasi di peta untuk menempatkan titik TUJUAN — Esc batal');
  };
  useEffect(() => {
    const peta = petaRef.current; if (!peta) return;
    const klik = async e => {
      if (!modeTitik) return;
      setModeTitik(false);
      const d = await api('/api/titik', { method: 'POST', body: JSON.stringify({ lat: e.latlng.lat, lng: e.latlng.lng, radius: 100, tipe: 'tujuan', sumber: 'peta' }) });
      if (d.ok) { muat(); tampilToast(`🎯 "${d.titik.nama}" ditempatkan di titik ketukan`); }
      else tampilToast('Gagal: ' + (d.error || ''), true);
    };
    peta.on('click', klik);
    return () => peta.off('click', klik);
  }, [modeTitik, muat, tampilToast]);
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape' && modeTitik) setModeTitik(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [modeTitik]);

  const pusatkan = async () => {
    const pos = await bacaGPS(12000, true);
    petaRef.current?.flyTo([pos.lat, pos.lng], 17);
  };

  const sosList = (state?.jamaah || []).filter(m => m.sosAktif);
  const selesaiSos = async (jamaahId) => {
    const r = await api('/api/sos/selesai', { method: 'POST', body: JSON.stringify(jamaahId ? { jamaahId } : {}) });
    if (r.ok) { tampilToast(jamaahId ? '✅ SOS ditandai selesai' : `✅ ${r.selesai} SOS ditandai selesai`); muat(); }
    else tampilToast('Gagal: ' + (r.error || ''), true);
  };

  return (
    <div className={`order-1 md:order-2 relative h-[50vh] shrink-0 md:h-full md:flex-1 md:min-h-0 ${modeTitik ? 'mode-titik' : ''}`}>
      <div ref={elRef} id="peta-utama" className="absolute inset-0 z-0" />
      {modeTitik && <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[600] bg-slate-900/85 text-white font-bold text-[12.5px] px-4 py-2 rounded-full shadow-lg pointer-events-none">🗺️ Ketuk lokasi di peta… (Esc = batal)</div>}
      <div className="absolute top-3 right-3 z-[500] flex gap-2">
        <button className="btn !min-h-[44px] !px-4 !text-[13px] bg-white/95 text-slate-800 border border-slate-200 shadow-md" onClick={ganti}>
          {satelit ? '🗺️ Street' : '🛰️ Satelit'}
        </button>
        <button className="btn !min-h-[44px] !px-4 !text-[13px] bg-white/95 text-slate-800 border border-slate-200 shadow-md" onClick={pusatkan}>📍</button>
      </div>
      {sosList.length > 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[700] w-[94%] max-w-md">
          <div className="bg-merah text-white rounded-2xl shadow-xl overflow-hidden animate-pulse-slow">
            <button className="w-full p-2.5 flex items-center justify-between" onClick={() => setSosBuka(k => !k)}>
              <b className="text-[14px]">🆘 {sosList.length} SOS AKTIF</b>
              <span className="text-lg">{sosBuka ? '▾' : '▸'}</span>
            </button>
            {sosBuka && (
              <div className="bg-white text-slate-800 max-h-[240px] overflow-y-auto">
                {sosList.map(m => (
                  <div key={m.id} className="flex items-center gap-2 p-2.5 border-b border-slate-100">
                    <div className="flex-1 min-w-0">
                      <b className="text-[13px] block truncate">{m.nama}</b>
                      <small className="text-slate-500">{m.regu || '-'}{m.posisi ? ' · ' + new Date(m.posisi.waktu).toLocaleTimeString('id-ID') : ''}</small>
                    </div>
                    <button className="btn btn-utama !min-h-[34px] !px-2.5 !text-[11px]" onClick={() => selesaiSos(m.id)}>✅ Selesai</button>
                  </div>
                ))}
                <button className="w-full p-2 bg-red-50 text-red-700 font-bold text-[12px]" onClick={() => selesaiSos(null)}>✅ Tandai Semua Selesai</button>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="absolute bottom-3 right-3 z-[550] bg-black/60 text-white rounded-full px-3 py-1 text-[11px] font-bold backdrop-blur-sm pointer-events-none">
        {state?.stat?.total ?? 0}jm · {state?.stat?.gelang ?? 0}⌚{(state?.stat?.sosAktif ?? 0) > 0 ? ' · 🆘' + state.stat.sosAktif : ''}
      </div>
      {bolehKelola && (
        <div className="absolute left-3 bottom-3 z-[500] flex gap-1.5">
          <button className="h-10 px-3 rounded-xl bg-hijau text-white shadow-md text-[12.5px] font-bold" onClick={buatKumpul}>📍 Titik</button>
          <button className={`h-10 px-3 rounded-xl shadow-md text-[12.5px] font-bold ${modeTitik ? 'bg-merah text-white' : 'bg-white/95 text-slate-700 border border-slate-200'}`} onClick={mulaiTitikPeta}>🗺️{modeTitik ? ' Batal' : ''}</button>
        </div>
      )}
    </div>
  );
}
