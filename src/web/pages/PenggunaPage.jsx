import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';

const KOSONG = { id: null, username: '', nama: '', peran: 'ketua-regu', regu: '', wa: '', sandi: '' };
const LABEL = { admin: '🛂 Admin', ketrom: '🧭 KaRom', 'ketua-regu': '🚩 KaRu' };

export default function PenggunaPage() {
  const { tampilToast } = useApp();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);

  const muat = useCallback(async () => {
    const d = await api('/api/users');
    if (d.ok) setRows(d.users || []);
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const simpan = async () => {
    if (!form.username) { tampilToast('Username wajib', true); return; }
    if (!form.id && !form.sandi) { tampilToast('Kata sandi wajib untuk pengguna baru', true); return; }
    const r = form.id
      ? await api('/api/users', { method: 'PUT', body: JSON.stringify({ ...form, sandi: form.sandi || undefined }) })
      : await api('/api/users', { method: 'POST', body: JSON.stringify(form) });
    if (r.ok) { tampilToast('✅ Tersimpan'); setForm(null); muat(); }
    else tampilToast('Gagal: ' + (r.error || ''), true);
  };
  const hapus = async (u) => {
    if (!confirm(`Hapus pengguna ${u.username}?`)) return;
    const r = await api('/api/users?id=' + encodeURIComponent(u.id), { method: 'DELETE' });
    if (r.ok) { tampilToast('🗑️ ' + u.username + ' dihapus'); muat(); } else tampilToast('Gagal: ' + (r.error || ''), true);
  };
  const toggle = async (u) => {
    const r = await api('/api/users', { method: 'PUT', body: JSON.stringify({ id: u.id, aktif: u.aktif ? 0 : 1 }) });
    if (r.ok) { tampilToast(u.aktif ? '⛔ Dinonaktifkan (sesinya dicabut)' : '✅ Diaktifkan kembali'); muat(); }
  };

  return (
    <div className="p-3 md:p-5 max-w-4xl mx-auto pb-10">
      <h1 className="text-2xl font-extrabold text-hijau">👥 Pengguna</h1>
      <p className="text-slate-500 text-[13.5px] -mt-2">Peran: <b>Admin</b> (penuh) · <b>KaRom</b> (semua regu) · <b>KaRu</b> (khusus regunya). Nomor WA dipakai untuk tujuan SOS/check-in jamaah.</p>
      <button className="btn btn-utama mt-3" onClick={() => setForm({ ...KOSONG })}>＋ Tambah Pengguna</button>

      <div className="kartu mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="bg-hijau text-white text-left">
            <th className="p-2.5">Pengguna</th><th className="p-2.5">Peran</th><th className="p-2.5">Regu</th>
            <th className="p-2.5">No. WA</th><th className="p-2.5">Status</th><th className="p-2.5">Aksi</th>
          </tr></thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="p-2.5"><b>{u.username}</b><br /><small className="text-slate-500">{u.nama || '—'}</small></td>
                <td className="p-2.5">{LABEL[u.peran] || u.peran}</td>
                <td className="p-2.5">{u.regu || '—'}</td>
                <td className="p-2.5">{u.wa || '—'}</td>
                <td className="p-2.5">{u.aktif
                  ? <span className="bg-emerald-100 text-emerald-800 rounded-full px-2.5 py-1 text-[11px] font-extrabold">aktif</span>
                  : <span className="bg-slate-100 text-slate-500 rounded-full px-2.5 py-1 text-[11px] font-extrabold">nonaktif</span>}</td>
                <td className="p-2.5"><div className="flex flex-wrap gap-1.5">
                  <button className="btn btn-muda !min-h-[38px] !px-2.5 !text-[11.5px]" onClick={() => setForm({ ...KOSONG, ...u, sandi: '' })}>✏️</button>
                  <button className="btn btn-emas !min-h-[38px] !px-2.5 !text-[11.5px]" onClick={() => toggle(u)}>{u.aktif ? '⛔' : '▶'}</button>
                  <button className="btn btn-merah !min-h-[38px] !px-2.5 !text-[11.5px]" onClick={() => hapus(u)}>🗑️</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/50 z-[1400] grid place-items-center p-3" onClick={() => setForm(null)}>
          <div className="kartu p-5 w-full max-w-md max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <b className="text-hijau text-[16px]">{form.id ? '✏️ Ubah: ' + form.username : '＋ Tambah Pengguna'}</b>
            <label className="text-[12px] font-bold text-slate-500 block mt-3">Username *</label>
            <input className="input" value={form.username} autoCapitalize="none" onChange={e => setForm({ ...form, username: e.target.value })} placeholder="mis. karu6" />
            <label className="text-[12px] font-bold text-slate-500 block mt-2">Nama / Jabatan</label>
            <input className="input" value={form.nama} onChange={e => setForm({ ...form, nama: e.target.value })} />
            <label className="text-[12px] font-bold text-slate-500 block mt-2">Peran *</label>
            <select className="input" value={form.peran} onChange={e => setForm({ ...form, peran: e.target.value })}>
              <option value="ketua-regu">🚩 Ketua Regu (KaRu)</option>
              <option value="ketrom">🧭 Ketua Rombongan (KaRom)</option>
              <option value="admin">🛂 Admin</option>
            </select>
            {form.peran === 'ketua-regu' && <><label className="text-[12px] font-bold text-slate-500 block mt-2">Regu yang diawasi *</label>
              <input className="input" value={form.regu} onChange={e => setForm({ ...form, regu: e.target.value })} placeholder="mis. Regu 6 – Wisata Iman" /></>}
            <label className="text-[12px] font-bold text-slate-500 block mt-2">Nomor WhatsApp</label>
            <input className="input" value={form.wa} onChange={e => setForm({ ...form, wa: e.target.value })} placeholder="0812-3456-7890" />
            <label className="text-[12px] font-bold text-slate-500 block mt-2">{form.id ? 'Kata sandi baru (kosongkan bila tak diubah)' : 'Kata sandi *'}</label>
            <input className="input" type="password" value={form.sandi} onChange={e => setForm({ ...form, sandi: e.target.value })} />
            <div className="flex gap-2 mt-4">
              <button className="btn btn-muda flex-1" onClick={() => setForm(null)}>Batal</button>
              <button className="btn btn-utama flex-1" onClick={simpan}>💾 Simpan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
