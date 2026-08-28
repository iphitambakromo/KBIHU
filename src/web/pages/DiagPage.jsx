import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function DiagPage() {
  const [d, setD] = useState(null);
  const [detail, setDetail] = useState(null); // {tipe, data}
  const [pesan, setPesan] = useState('');
  
  const muat = useCallback(async () => {
    const dd = await api('/api/diag');
    if (dd.ok) setD(dd);
  }, []);
  useEffect(() => { muat(); }, [muat]);
  
  const bersihkan = async () => {
    if (!confirm('Bersihkan seluruh catatan galat?')) return;
    await api('/api/diag/clear', { method: 'POST' }); muat();
  };
  
  // Hapus semua data (kecuali users)
  const hapusSemua = async () => {
    if (!confirm('⚠️ HAPUS SEMUA DATA (kecuali user)?\n\nData yang dihapus:\n- Jamaah\n- Posisi\n- Kejadian\n- Absensi\n- Latihan\n- Titik\n\nTindakan ini TIDAK BISA dibatalkan!')) return;
    if (!confirm('Anda YAKIN? Ketik "YA" di dialog berikutnya untuk konfirmasi.')) return;
    const r = await api('/api/diag/hapus-semua', { method: 'POST' });
    if (r.ok) {
      setPesan(`✅ ${r.pesan}`);
      muat();
    } else {
      setPesan(`❌ ${r.error || 'Gagal'}`);
    }
  };
  
  // Hapus satu tabel
  const hapusTabel = async (tabel) => {
    if (!confirm(`Hapus semua data dari tabel "${tabel}"?`)) return;
    const r = await api('/api/diag/hapus-tabel', { method: 'POST', body: JSON.stringify({ tabel }) });
    if (r.ok) {
      setPesan(`✅ ${r.pesan}`);
      muat();
    } else {
      setPesan(`❌ ${r.error || 'Gagal'}`);
    }
  };
  
  // Lihat detail tabel
  const lihatDetail = async (tabel) => {
    const r = await api(`/api/diag/detail?tabel=${encodeURIComponent(tabel)}`);
    if (r.ok) {
      setDetail({ tabel, data: r.data || [] });
    } else {
      setPesan(`❌ ${r.error || 'Gagal memuat data'}`);
    }
  };
  
  if (!d) return <div className="p-6 text-slate-500 font-bold">Memuat…</div>;
  
  return (
    <div className="p-3 md:p-5 max-w-3xl mx-auto pb-10">
      <h1 className="text-2xl font-extrabold text-hijau">🛠 Diagnostik</h1>
      <p className="text-slate-500 text-[13.5px] -mt-2">Kesehatan sistem & manajemen data.</p>
      
      {pesan && (
        <div className={`mt-3 p-3 rounded-xl text-[13px] font-bold ${pesan.startsWith('✅') ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {pesan}
        </div>
      )}
      
      {/* Statistik */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center">
        {Object.entries(d.stat || {}).map(([k, v]) => (
          <div key={k} className="kartu p-3 cursor-pointer hover:bg-emerald-50 transition" onClick={() => lihatDetail(k)}>
            <b className="text-xl text-hijau">{v}</b>
            <br />
            <small className="font-bold text-slate-500">{k}</small>
          </div>
        ))}
      </div>
      
      {/* Aksi Cepat */}
      <div className="kartu p-4 mt-3">
        <b className="text-hijau text-[12px] uppercase tracking-wide">🗑️ Manajemen Data</b>
        <div className="mt-3 space-y-2">
          <button 
            className="btn btn-merah w-full !min-h-[44px]"
            onClick={hapusSemua}
          >
            ⚠️ Hapus Semua Data (kecuali User)
          </button>
          <p className="text-[11px] text-slate-400">
            Menghapus: Jamaah, Posisi, Kejadian, Absensi, Latihan, Titik
          </p>
        </div>
      </div>
      
      {/* Detail Tabel */}
      {detail && (
        <div className="kartu p-4 mt-3">
          <div className="flex items-center justify-between mb-2">
            <b className="text-hijau text-[12px] uppercase tracking-wide">📋 Detail: {detail.tabel}</b>
            <div className="flex gap-2">
              <button 
                className="btn btn-emas !min-h-[34px] !text-[11px]"
                onClick={() => hapusTabel(detail.tabel)}
              >
                🗑️ Hapus Semua
              </button>
              <button 
                className="btn btn-muda !min-h-[34px] !text-[11px]"
                onClick={() => setDetail(null)}
              >
                ✕ Tutup
              </button>
            </div>
          </div>
          <div className="max-h-[40vh] overflow-y-auto">
            {detail.data.length === 0 ? (
              <p className="text-slate-400 text-[13px]">Tidak ada data.</p>
            ) : (
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="bg-slate-100">
                    {Object.keys(detail.data[0]).map(k => (
                      <th key={k} className="p-1.5 text-left">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.data.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="p-1.5 max-w-[150px] truncate">
                          {v != null ? String(v) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {detail.data.length > 50 && (
              <p className="text-[11px] text-slate-400 mt-2">
                Menampilkan 50 dari {detail.data.length} baris
              </p>
            )}
          </div>
        </div>
      )}
      
      {/* Galat */}
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
