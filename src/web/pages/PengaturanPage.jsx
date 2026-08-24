import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';

/* ⚙️ Pengaturan — referensi REGU (dropdown di seluruh aplikasi).
   Ganti nama di sini -> jamaah & KaRu ikut berubah otomatis (cascade).
   Menu ini dirancang mudah dikembangkan (pengaturan lain menyusul). */
export default function PengaturanPage() {
  const { tampilToast } = useApp();
  const [regu, setRegu] = useState([]);
  const [edit, setEdit] = useState(null);        // {id, nama, jamaah, users}
  const [baru, setBaru] = useState('');
  const [padan, setPadan] = useState(null);      // alat perbaikan nama lama tak terdaftar

  const muat = useCallback(async () => {
    const d = await api('/api/pengaturan/regu');
    if (d.ok) setRegu(d.regu || []);
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const tambah = async () => {
    const nama = baru.trim();
    if (!nama) return;
    const r = await api('/api/pengaturan/regu', { method: 'POST', body: JSON.stringify({ nama }) });
    if (r.ok) { setBaru(''); tampilToast('✅ Regu "' + nama + '" ditambahkan'); muat(); }
    else tampilToast('Gagal: ' + (r.error || ''), true);
  };
  const simpanNama = async () => {
    const nama = edit.namaBaru.trim();
    if (!nama || nama === edit.nama) { setEdit(null); return; }
    if (!confirm(`Ubah "${edit.nama}" → "${nama}"?\nSemua jamaah & KaRu regu ini ikut berubah otomatis.`)) return;
    const r = await api('/api/pengaturan/regu', { method: 'PUT', body: JSON.stringify({ id: edit.id, nama }) });
    if (r.ok) {
      tampilToast(`✅ Berubah — ${r.jamaah} jamaah & ${r.users} pengguna ikut terbarui`);
      setEdit(null); muat();
    } else { tampilToast('Gagal: ' + (r.error || ''), true); }
  };
  const hapus = async (r0) => {
    if (!confirm(`Hapus referensi regu "${r0.nama}"?`)) return;
    const r = await api('/api/pengaturan/regu?id=' + encodeURIComponent(r0.id), { method: 'DELETE' });
    if (r.ok) { tampilToast('🗑️ Dihapus'); muat(); }
    else tampilToast('Gagal: ' + (r.error || ''), true);
  };
  const padankan = async () => {
    if (!padan.dari || !padan.ke) { setPadan({ ...padan, hasil: '❌ Isi keduanya' }); return; }
    if (!confirm(`Pindahkan semua "${padan.dari}" → "${padan.ke}"?`)) return;
    const r = await api('/api/regu/rename', { method: 'POST', body: JSON.stringify(padan) });
    setPadan({ ...padan, hasil: r.ok ? `✅ ${r.jamaah} jamaah & ${r.users} pengguna dipindah` : '❌ ' + (r.error || 'gagal') });
    muat();
  };

  return (
    <div className="p-3 md:p-5 max-w-3xl mx-auto pb-10">
      <h1 className="text-2xl font-extrabold text-hijau">⚙️ Pengaturan</h1>
      <p className="text-slate-500 text-[13.5px] -mt-2">Referensi resmi yang dipakai aplikasi. Daftar ini sumber dropdown di seluruh form.</p>

      {/* ---- REFERENSI REGU ---- */}
      <div className="kartu p-4 mt-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <b className="text-hijau text-[15px]">🚩 Referensi Regu</b>
            <p className="text-[12px] text-slate-500 leading-relaxed mt-0.5">
              Daftar regu resmi rombongan. <b>Ubah nama di sini → jamaah & KaRu pengawasnya ikut berubah otomatis.</b><br />
              Hapus hanya bisa bila tak dipakai siapa pun.
            </p>
          </div>
          <span className="bg-emerald-50 border border-emerald-200 text-hijau rounded-full px-3 py-1.5 text-[12px] font-bold">{regu.length} regu</span>
        </div>

        <div className="flex gap-2 mt-3">
          <input className="input flex-1" placeholder="tambah regu baru, mis. Regu 6 – Wisata Iman" value={baru} onChange={e => setBaru(e.target.value)} onKeyDown={e => e.key === 'Enter' && tambah()} />
          <button className="btn btn-utama" onClick={tambah}>＋ Tambah</button>
        </div>

        <div className="mt-3 divide-y divide-slate-100">
          {regu.map(r => (
            <div key={r.id} className="py-2.5 flex items-center gap-3">
              <span className="text-xl">🚩</span>
              <div className="flex-1 min-w-0">
                <b className="text-[14.5px] block truncate">{r.nama}</b>
                <small className="text-slate-500">{r.jamaah} jamaah · {r.users} pengguna</small>
              </div>
              <button className="btn btn-muda !min-h-[40px] !px-3 !text-[12px]" onClick={() => setEdit({ ...r, namaBaru: r.nama })}>✏️ Ubah nama</button>
              <button className="btn btn-merah !min-h-[40px] !px-3 !text-[12px]" onClick={() => hapus(r)}>🗑️</button>
            </div>
          ))}
          {regu.length === 0 && <p className="text-slate-500 text-[13px] py-2">Belum ada regu — tambahkan di atas.</p>}
        </div>

        <button className="btn btn-emas w-full mt-3" onClick={() => setPadan({ dari: '', ke: '', hasil: '' })}>
          🛠 Perbaikan Cepat: pindahkan nama regu lama (typo) yang belum terdaftar
        </button>
        {padan && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <b className="text-amber-800 text-[13px]">🛠 Pindahkan nama lama → nama resmi</b>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <input className="input" placeholder="nama lama (typo)" list="daftar-regu-set" value={padan.dari} onChange={e => setPadan({ ...padan, dari: e.target.value })} />
              <select className="input" value={padan.ke} onChange={e => setPadan({ ...padan, ke: e.target.value })}>
                <option value="">— pilih nama resmi —</option>
                {regu.map(r => <option key={r.id} value={r.nama}>{r.nama}</option>)}
              </select>
            </div>
            <datalist id="daftar-regu-set">{regu.map(r => <option key={'d' + r.id} value={r.nama} />)}</datalist>
            {padan.hasil && <p className="mt-2 font-bold text-[13px]">{padan.hasil}</p>}
            <div className="flex gap-2 mt-2">
              <button className="btn btn-muda flex-1 !min-h-[42px]" onClick={() => setPadan(null)}>Tutup</button>
              <button className="btn btn-utama flex-1 !min-h-[42px]" onClick={padankan}>🔀 Pindahkan</button>
            </div>
          </div>
        )}
      </div>

      <p className="text-slate-400 text-[11.5px] text-center mt-3">Menu ini akan berkembang: pengaturan target latihan, akun, tampilan, dsb. menyusul.</p>

      {/* dialog ubah nama */}
      {edit && (
        <div className="fixed inset-0 bg-black/50 z-[1400] grid place-items-center p-3" onClick={() => setEdit(null)}>
          <div className="kartu p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <b className="text-hijau text-[16px]">✏️ Ubah Nama Regu</b>
            <p className="text-[12.5px] text-slate-500 mt-1">Dipakai {edit.jamaah} jamaah & {edit.users} pengguna — semuanya otomatis mengikuti nama baru.</p>
            <label className="text-[12px] font-bold text-slate-500 block mt-3">Nama sekarang</label>
            <input className="input bg-slate-50" value={edit.nama} disabled />
            <label className="text-[12px] font-bold text-slate-500 block mt-2">Nama baru</label>
            <input className="input" value={edit.namaBaru} onChange={e => setEdit({ ...edit, namaBaru: e.target.value })} onKeyDown={e => e.key === 'Enter' && simpanNama()} />
            <div className="flex gap-2 mt-4">
              <button className="btn btn-muda flex-1" onClick={() => setEdit(null)}>Batal</button>
              <button className="btn btn-utama flex-1" onClick={simpanNama}>💾 Ubah & Menular</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
