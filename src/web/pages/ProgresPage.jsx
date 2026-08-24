import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';

const RITUAL_NAMA = ['Hotel→Haram', 'Tawaf', "Sa'i", '→Mina', '→Arafah', '→Muzdalifah', '→Jumrah', '→Ifadah', "Wada'"];
const waDigits = t => { const d = String(t || '').replace(/[^0-9]/g, ''); if (!d) return ''; if (d.startsWith('0')) return '62' + d.slice(1); if (d.startsWith('62')) return d; if (d.startsWith('8')) return '62' + d; return d; };

export default function ProgresPage() {
  const { tampilToast, sesi } = useApp();
  const [d, setD] = useState(null);
  const [bagikan, setBagikan] = useState(null);   // {nama, url}

  const muat = useCallback(async () => {
    const dd = await api('/api/latihan/progres');
    if (dd.ok) setD(dd);
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const buatLink = async (jid, nama) => {
    const r = await api('/api/latihan/link', { method: 'POST', body: JSON.stringify({ jamaahId: jid }) });
    if (r.ok) setBagikan({ nama, url: r.url });
    else tampilToast('Gagal: ' + (r.error || ''), true);
  };
  const salin = async () => {
    try { await navigator.clipboard.writeText(bagikan.url); tampilToast('✅ Tautan disalin'); } catch (e) { tampilToast('Salin manual dari kotak', true); }
  };
  const kirimWA = () => {
    const wa = ''; // dibuka via share WA tanpa nomor (pilih kontak di WA)
    const teks = encodeURIComponent(`Assalamualaikum ${bagikan.nama}, ini tautan latihan mandiri Anda utk persiapan fisik ibadah haji:\n\n${bagikan.url}\n\nBuka, pilih latihan, tekan Mulai, dan jalan rutin ya! 🥾`);
    window.open(`https://wa.me/?text=${teks}`, '_blank');
  };
  const reset = async (jid, nama) => {
    if (!confirm(`Bersihkan SEMUA histori latihan ${nama}?`)) return;
    const r = await api('/api/latihan/reset', { method: 'POST', body: JSON.stringify({ jamaahId: jid }) });
    if (r.ok) { tampilToast(`🔄 Histori ${nama} dibersihkan (${r.terhapus} catatan)`); muat(); }
    else tampilToast('Gagal: ' + (r.error || ''), true);
  };

  if (!d) return <div className="p-6 text-slate-500 font-bold">Memuat…</div>;
  const bolehReset = sesi && ['admin', 'ketrom', 'ketua-regu'].includes(sesi.peran);
  const bolehLink = sesi && ['admin', 'ketrom'].includes(sesi.peran);

  return (
    <div className="p-3 md:p-5 max-w-4xl mx-auto pb-10">
      <h1 className="text-2xl font-extrabold text-hijau">📊 Progres Latihan Mandiri</h1>
      <p className="text-slate-500 text-[13.5px] -mt-2">Kesiapan: total ≥ {(d.siapPada / 1000).toLocaleString('id-ID')} km = ✅ <b>SIAP</b> (80% dari total target {(d.totalTarget / 1000).toLocaleString('id-ID')} km)</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="kartu p-3"><b className="text-2xl text-hijau">{d.rows.filter(r => r.siap).length}</b><br /><small className="font-bold text-slate-500">✅ SIAP</small></div>
        <div className="kartu p-3"><b className="text-2xl text-amber-600">{d.rows.filter(r => r.meter > 0 && !r.siap).length}</b><br /><small className="font-bold text-slate-500">🔶 perlu latihan</small></div>
        <div className="kartu p-3"><b className="text-2xl text-slate-500">{d.rows.filter(r => r.meter === 0).length}</b><br /><small className="font-bold text-slate-500">⏳ belum mulai</small></div>
      </div>

      <div className="kartu mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="bg-hijau text-white text-left">
            <th className="p-2.5">Jamaah</th><th className="p-2.5">Total</th><th className="p-2.5">Sesi</th>
            <th className="p-2.5 min-w-[240px]">Per ritual</th><th className="p-2.5">Aksi</th>
          </tr></thead>
          <tbody>
            {d.rows.map(r => {
              const pct = Math.min(100, Math.round(r.meter / d.totalTarget * 100));
              return (
                <tr key={r.id} className="border-b border-slate-100 align-top">
                  <td className="p-2.5"><b>{r.nama}</b> {r.punya_gelang ? '⌚' : ''}<br /><small className="text-slate-500">{r.regu || '—'}</small></td>
                  <td className="p-2.5"><b className={r.siap ? 'text-hijau' : 'text-slate-700'}>{(r.meter / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km</b><br />
                    <small className="text-slate-400">{pct}% {r.siap && <b className="text-hijau">· SIAP</b>}</small></td>
                  <td className="p-2.5">{r.sesi}</td>
                  <td className="p-2.5">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(r.perRitual).map(([k, v]) => (
                        <span key={k} className="bg-emerald-50 text-hijau border border-emerald-200 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold">
                          {RITUAL_NAMA[k - 1] || '#' + k} {v.meter.toLocaleString('id-ID')}m{v.sesi > 1 ? ' ×' + v.sesi : ''}
                        </span>
                      ))}
                      {!Object.keys(r.perRitual).length && <small className="text-slate-400">belum</small>}
                    </div>
                  </td>
                  <td className="p-2.5">
                    <div className="flex flex-col gap-1.5">
                      {bolehLink && <button className="btn btn-utama !min-h-[38px] !px-3 !text-[11.5px]" onClick={() => buatLink(r.id, r.nama)}>🔗 Tautan</button>}
                      {bolehReset && r.meter > 0 && <button className="btn btn-emas !min-h-[38px] !px-3 !text-[11.5px]" onClick={() => reset(r.id, r.nama)}>🔄</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* dialog bagikan */}
      {bagikan && (
        <div className="fixed inset-0 bg-black/50 z-[1400] grid place-items-center p-4" onClick={() => setBagikan(null)}>
          <div className="kartu p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <b className="text-hijau">🔗 Tautan Latihan — {bagikan.nama}</b>
            <p className="text-[12.5px] text-slate-500 mt-1">Kirim via WhatsApp atau salin. Jamaah cukup buka tautan — tanpa login, tanpa instal.</p>
            <input className="input mt-2 text-[12.5px]" readOnly value={bagikan.url} onFocus={e => e.target.select()} />
            <div className="flex gap-2 mt-3">
              <button className="btn btn-utama flex-1" onClick={kirimWA}>💬 WhatsApp</button>
              <button className="btn btn-muda flex-1" onClick={salin}>📋 Salin</button>
              <button className="btn btn-muda" onClick={() => setBagikan(null)}>✕</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
