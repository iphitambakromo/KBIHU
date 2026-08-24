import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';

export default function AbsensiPage() {
  const { sesi, tampilToast, bolehKelola } = useApp();
  const [aktif, setAktif] = useState(null);      // event aktif (+titik)
  const [rekap, setRekap] = useState(null);      // rekap event aktif/dipilih
  const [events, setEvents] = useState([]);
  const [pilihTitik, setPilihTitik] = useState('');
  const [titikList, setTitikList] = useState([]);
  const [namaAcara, setNamaAcara] = useState('');

  const muatAktif = useCallback(async () => {
    const d = await api('/api/absensi/aktif');
    setAktif(d.ok ? d.event : null);
    return d.ok ? d.event : null;
  }, []);

  const muatRekap = useCallback(async (evId) => {
    if (!evId) { setRekap(null); return; }
    const d = await api('/api/absensi/rekap?event=' + encodeURIComponent(evId));
    if (d.ok) setRekap(d);
  }, []);

  const muatEvents = useCallback(async () => {
    const d = await api('/api/absensi/event');
    if (d.ok) setEvents(d.events || []);
  }, []);

  useEffect(() => {
    (async () => {
      const ev = await muatAktif();
      if (ev) muatRekap(ev.id);
      muatEvents();
      const st = await api('/api/state');
      if (st.ok) setTitikList(st.titik || []);
    })();
  }, [muatAktif, muatRekap, muatEvents]);

  /* poll live saat acara aktif */
  useEffect(() => {
    if (!aktif) return;
    const t = setInterval(() => { if (!document.hidden) { muatRekap(aktif.id); } }, 5000);
    return () => clearInterval(t);
  }, [aktif, muatRekap]);

  const mulai = async () => {
    if (!pilihTitik) { tampilToast('Pilih titik kumpul acara ini dulu', true); return; }
    const d = await api('/api/absensi/event', { method: 'POST', body: JSON.stringify({ titikId: pilihTitik, nama: namaAcara || undefined }) });
    if (d.ok) { tampilToast('✅ Acara dimulai — jamaah check-in di dalam titik = HADIR'); const ev = await muatAktif(); muatRekap(ev.id); muatEvents(); }
    else tampilToast('Gagal: ' + (d.error || ''), true);
  };
  const tutup = async () => {
    if (!aktif || !confirm('Tutup acara ini? Riwayat tetap tersimpan.')) return;
    const d = await api('/api/absensi/tutup', { method: 'POST', body: JSON.stringify({ id: aktif.id }) });
    if (d.ok) { tampilToast('⏹ Acara ditutup'); setAktif(null); setRekap(null); muatEvents(); }
  };
  const tandai = async (jid, status) => {
    const d = await api('/api/absensi/hadir', { method: 'POST', body: JSON.stringify({ eventId: aktif.id, jamaahId: jid, status }) });
    if (d.ok) muatRekap(aktif.id); else tampilToast('Gagal: ' + (d.error || ''), true);
  };
  const lihatRiwayat = async (id) => { await muatAktif(); muatRekap(id); };

  const urut = (a, b) => (a.status === 'hadir' ? 0 : a.status ? 1 : 2) - (b.status === 'hadir' ? 0 : b.status ? 1 : 2) || a.nama.localeCompare(b.nama);

  return (
    <div className="p-3 md:p-5 max-w-3xl mx-auto space-y-4 pb-10">
      <h1 className="text-2xl font-extrabold text-hijau">✅ Absensi Titik</h1>
      <p className="text-slate-500 text-[13.5px] -mt-2">Mulai acara di sebuah titik → jamaah yang check-in <b>di dalam radius titik</b> otomatis HADIR.</p>

      {/* acara aktif / mulai */}
      {aktif ? (
        <div className="kartu p-4 border-2 border-hijau">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <b className="text-[16px]">🔴 {aktif.nama}</b>
              <p className="text-[12.5px] text-slate-500">titik: <b>{aktif.titik_nama || '—'}</b> · radius {aktif.radius || '—'} m · mulai {new Date(aktif.waktu).toLocaleTimeString('id-ID')}</p>
            </div>
            {bolehKelola && <button className="btn btn-merah !min-h-[44px]" onClick={tutup}>⏹ Tutup</button>}
          </div>
        </div>
      ) : bolehKelola ? (
        <div className="kartu p-4 space-y-3">
          <b className="text-hijau">▶ Mulai acara absensi</b>
          <select className="input" value={pilihTitik} onChange={e => setPilihTitik(e.target.value)}>
            <option value="">— pilih titik (mis. Titik Kumpul Lobi) —</option>
            {titikList.map(t => <option key={t.id} value={t.id}>{t.tipe === 'tujuan' ? '🎯' : '📍'} {t.nama} (radius {t.radius} m)</option>)}
          </select>
          <input className="input" placeholder="Nama acara (opsional, mis. Berangkat ke Mina)" value={namaAcara} onChange={e => setNamaAcara(e.target.value)} />
          <button className="btn btn-utama w-full" onClick={mulai}>▶ Mulai Acara</button>
        </div>
      ) : (
        <div className="kartu p-4 text-slate-500">Tidak ada acara aktif. Absensi dimulai oleh KaRu / KaRom / Admin.</div>
      )}

      {/* rekap */}
      {rekap && (
        <div className="kartu p-4">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <b className="text-hijau text-[15px]">📋 {rekap.event.nama}</b>
            <span className="text-[12.5px] text-slate-500">{rekap.event.ditutup ? '⏹ ditutup' : '🔴 berjalan'}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 my-3 text-center">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2"><b className="text-2xl text-hijau">{rekap.hadir}</b><br/><small className="font-bold text-slate-500">HADIR</small></div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-2"><b className="text-2xl text-slate-600">{rekap.total - rekap.hadir - (rekap.rows.filter(r => r.status === 'izin' || r.status === 'alfa').length)}</b><br/><small className="font-bold text-slate-500">BELUM</small></div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2"><b className="text-2xl text-amber-700">{rekap.rows.filter(r => r.status === 'izin' || r.status === 'alfa').length}</b><br/><small className="font-bold text-slate-500">IZIN/ALFA</small></div>
          </div>
          <div className="divide-y divide-slate-100">
            {[...rekap.rows].sort(urut).map(r => (
              <div key={r.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <b className="text-[14px]">{r.nama} {r.punya_gelang ? '⌚' : ''}</b>
                  <div className="mt-0.5">
                    {r.status === 'hadir' ? <span className="text-[11px] font-extrabold bg-emerald-100 text-emerald-800 rounded-full px-2.5 py-1">✅ HADIR</span>
                      : r.status === 'izin' ? <span className="text-[11px] font-extrabold bg-amber-100 text-amber-800 rounded-full px-2.5 py-1">🤒 IZIN</span>
                      : r.status === 'alfa' ? <span className="text-[11px] font-extrabold bg-red-100 text-red-700 rounded-full px-2.5 py-1">❌ ALFA</span>
                      : <span className="text-[11px] font-extrabold bg-slate-100 text-slate-500 rounded-full px-2.5 py-1">⏳ BELUM</span>}
                    {r.waktu && r.status === 'hadir' && <span className="text-[11px] text-slate-400 ml-2">{new Date(r.waktu).toLocaleTimeString('id-ID')} via {r.sumber}</span>}
                    {r.dalamTitik === true && <span className="text-[11px] text-emerald-600 font-bold ml-2">📍 di titik</span>}
                    {r.dalamTitik === false && r.sisaMeter != null && <span className="text-[11px] text-slate-400 ml-2">±{r.sisaMeter} m dari titik</span>}
                  </div>
                </div>
                {bolehKelola && aktif && !rekap.event.ditutup && (
                  <div className="flex gap-1.5">
                    <button className="btn btn-muda !min-h-[38px] !px-3 !text-[11.5px]" onClick={() => tandai(r.id, 'hadir')}>✍️ Hadir</button>
                    <button className="btn btn-emas !min-h-[38px] !px-3 !text-[11.5px]" onClick={() => tandai(r.id, 'izin')}>🤒</button>
                    <button className="btn btn-merah !min-h-[38px] !px-3 !text-[11.5px]" onClick={() => tandai(r.id, 'alfa')}>❌</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* riwayat */}
      <div className="kartu p-4">
        <b className="text-hijau">🕘 Riwayat acara</b>
        <div className="mt-2 space-y-2">
          {events.length === 0 && <p className="text-slate-500 text-[13px]">Belum ada acara.</p>}
          {events.map(e => (
            <button key={e.id} onClick={() => lihatRiwayat(e.id)}
              className="w-full text-left border border-slate-200 rounded-xl p-3 hover:bg-emerald-50 transition">
              <b className="text-[13.5px]">{e.ditutup ? '🕘' : '🔴'} {e.nama}</b>
              <small className="block text-slate-500 text-[11.5px] mt-0.5">
                {new Date(e.waktu).toLocaleString('id-ID')} · titik {e.titik_nama || '—'} · {e.regu || 'semua regu'} · <b>{e.hadir} hadir</b>
              </small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
