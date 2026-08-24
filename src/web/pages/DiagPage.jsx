import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function DiagPage() {
  const [d, setD] = useState(null);
  const muat = useCallback(async () => {
    const dd = await api('/api/diag');
    if (dd.ok) setD(dd);
  }, []);
  useEffect(() => { muat(); }, [muat]);
  const bersihkan = async () => {
    if (!confirm('Bersihkan seluruh catatan galat?')) return;
    await api('/api/diag/clear', { method: 'POST' }); muat();
  };
  if (!d) return <div className="p-6 text-slate-500 font-bold">Memuat…</div>;
  return (
    <div className="p-3 md:p-5 max-w-3xl mx-auto pb-10">
      <h1 className="text-2xl font-extrabold text-hijau">🛠 Diagnostik</h1>
      <p className="text-slate-500 text-[13.5px] -mt-2">Kesehatan sistem & 50 galat server terakhir — biar tidak pernah buta lagi.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center">
        {Object.entries(d.stat || {}).map(([k, v]) => (
          <div key={k} className="kartu p-3"><b className="text-xl text-hijau">{v}</b><br /><small className="font-bold text-slate-500">{k}</small></div>
        ))}
      </div>
      <div className="kartu p-4 mt-3">
        <div className="flex items-center justify-between">
          <b className="text-hijau text-[12px] uppercase tracking-wide">⚠️ Galat terakhir</b>
          {(d.galat || []).length > 0 && <button className="btn btn-emas !min-h-[38px] !text-[11.5px]" onClick={bersihkan}>🧹 Bersihkan</button>}
        </div>
        <div className="mt-2 space-y-2 max-h-[50vh] overflow-y-auto">
          {(d.galat || []).length === 0 && <p className="text-slate-500 text-[13px]">✅ Tidak ada galat tercatat. Sistem sehat.</p>}
          {(d.galat || []).map(g => (
            <div key={g.id} className="border-l-4 border-red-400 bg-red-50 rounded-r-xl p-2.5 text-[12.5px] leading-relaxed">
              <b>{new Date(g.waktu).toLocaleString('id-ID')}</b> · <code className="text-[11.5px]">{g.metode} {g.path}</code>
              <div className="text-slate-700 break-words">{g.pesan}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
