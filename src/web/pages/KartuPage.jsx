import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const waDigits = t => { const d = String(t || '').replace(/[^0-9]/g, ''); if (!d) return ''; if (d.startsWith('0')) return '62' + d.slice(1); if (d.startsWith('62')) return d; if (d.startsWith('8')) return '62' + d; return d; };

export default function KartuPage({ id }) {
  const [d, setD] = useState(null);
  const [hasil, setHasil] = useState('');
  const [qr, setQr] = useState('');
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/pub/jamaah/' + encodeURIComponent(id));
        const dd = await r.json();
        setD(dd);
        if (dd.ok) {
          setQr(await QRCode.toDataURL(location.origin + '/#/kartu/' + encodeURIComponent(id), { width: 220, margin: 1 }));
        }
      } catch (e) { setD({ ok: false, error: 'koneksi gagal' }); }
    })();
  }, [id]);

  if (!d) return <div className="min-h-full grid place-items-center text-slate-500 font-bold">Memuat kartu…</div>;
  if (!d.ok) return (
    <div className="min-h-full grid place-items-center p-6">
      <div className="kartu p-8 text-center max-w-sm">
        <div className="text-4xl">🔒</div>
        <p className="font-extrabold mt-2">Tautan kartu tidak valid</p>
        <p className="text-slate-500 text-sm mt-1">Minta pembimbing mengirim ulang tautan kartu Anda.</p>
      </div>
    </div>
  );

  const m = d.jamaah;
  const acara = d.acara;

  const kirim = async (tipe) => {
    setSibuk(true);
    try {
      const pos = await new Promise(res => navigator.geolocation
        ? navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 10000 })
        : res(null));
      const body = { jamaahId: m.id, ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) };
      const r = await fetch(tipe === 'sos' ? '/api/pub/sos' : '/api/pub/checkin', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const dd = await r.json();
      if (!dd.ok) { setHasil('❌ ' + (dd.error || 'gagal')); return; }
      if (tipe === 'sos') {
        setHasil(`🆘 SOS terkirim${dd.waKetuaNama ? ' — ' + dd.waKetuaNama : ''}. Jika WhatsApp tidak terbuka otomatis, tekan tombol hijau.`);
        const wa = waDigits(dd.waKetua);
        const tautan = pos ? `https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}` : '(posisi tidak terbaca)';
        if (wa) window.open(`https://wa.me/${wa}?text=${encodeURIComponent('🚨 SOS — ' + dd.jamaah + ' (' + (dd.regu || '') + '). Saya terpisah rombongan! Posisi saya (' + new Date().toLocaleTimeString('id-ID') + '):\n' + tautan)}`, '_blank');
      } else {
        if (dd.absensi && dd.absensi.hadir) {
          setHasil(`✅ Check-in berhasil — HADIR otomatis di acara "${dd.absensi.acara}" (titik ${dd.absensi.titik})`);
        } else if (dd.absensi && dd.absensi.hadir === false) {
          setHasil(`✅ Check-in tercatat${dd.titik ? ' di ' + dd.titik : ''}. ⏳ Absensi "${dd.absensi.acara}": mendekat ke ${dd.absensi.titik} — masih ±${dd.absensi.sisaMeter} m dari titik.`);
        } else {
          setHasil(`✅ Check-in terkirim${dd.titik ? ' — Anda di titik ' + dd.titik : ''}`);
        }
      }
    } finally { setSibuk(false); }
  };

  return (
    <div className="min-h-full bg-gradient-to-br from-hijau to-hijau2 p-4 flex items-center justify-center">
      <div className="kartu w-full max-w-md overflow-hidden">
        {/* kepala */}
        <div className="bg-gradient-to-r from-hijau to-hijau2 text-white p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-9 h-6 rounded border border-white/40" style={{ background: 'linear-gradient(to bottom, #B4232A 0 50%, #fff 50% 100%)' }} />
            <div className="text-left leading-tight">
              <div className="text-[11px] font-black tracking-widest">REPUBLIK INDONESIA</div>
              <div className="text-[8.5px] opacity-85">Tracking Amanah Mengawal Barisan · IPHI</div>
            </div>
          </div>
          {m.foto
            ? <img src={m.foto} alt="" className="w-20 h-20 rounded-2xl object-cover mx-auto border-[3px] border-white/50" />
            : <div className="w-20 h-20 rounded-2xl bg-white/15 border-[3px] border-white/40 grid place-items-center text-3xl font-black mx-auto">{m.nama.replace(/^(H\.|Hj\.)\s*/, '').split(' ').slice(0, 2).map(x => x[0]).join('')}</div>}
          <h1 className="font-extrabold text-lg leading-tight mt-2">{m.nama}</h1>
          <p className="text-white/85 text-[13px]">{m.regu || '—'} · {m.hotel || '—'}</p>
          {m.punya_gelang && <span className="inline-block mt-1 bg-amber-100 text-amber-900 text-[11px] font-extrabold rounded-full px-3 py-1">⌚ Pengguna Gelang BLE</span>}
        </div>
        {/* QR + 3 bahasa */}
        <div className="p-4 text-center">
          {qr && <img src={qr} alt="QR" className="w-36 h-36 mx-auto" />}
          <p className="text-[12.5px] font-bold mt-2">Jika terpisah dari rombongan, scan QR ini</p>
          <p className="text-[11px] text-slate-500">If separated from your group, scan this QR code</p>
          <p dir="rtl" className="text-[12px] text-slate-600 font-bold mt-0.5">إذا انفصلت عن المجموعة، امسح رمز QR هذا</p>
        </div>
        {/* aksi */}
        <div className="px-4 pb-5 space-y-3">
          {acara && (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-3 text-center">
              <b className="text-hijau text-[13.5px]">✅ Absensi aktif: {acara.nama}</b>
              {acara.titik && <p className="text-[12px] text-slate-600 mt-0.5">Titik: <b>{acara.titik.nama}</b> (radius {acara.titik.radius} m) — tekan Check-in saat sudah di titik</p>}
            </div>
          )}
          <button className="btn btn-utama w-full" disabled={sibuk} onClick={() => kirim('checkin')}>📲 Saya di Sini (Check-in)</button>
          <button className="btn btn-merah w-full animate-pulse-slow" disabled={sibuk} onClick={() => kirim('sos')}>🆘 SOS — AKU TERPISAH!</button>
          {d.waKetua && <a className="btn btn-muda w-full" href={`https://wa.me/${waDigits(d.waKetua)}`} target="_blank" rel="noopener">💬 Hubungi Ketua ({d.waKetuaNama || 'ketua'})</a>}
          {hasil && <div className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-[13.5px] font-bold leading-relaxed">{hasil}</div>}
          <p className="text-[10.5px] text-slate-400 text-center leading-relaxed">Kartu Keselamatan Jamaah — IPHI · data lokasi hanya dikirim saat tombol ditekan</p>
        </div>
      </div>
    </div>
  );
}
