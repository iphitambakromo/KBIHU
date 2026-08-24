import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';

const KOSONG = { id: null, nama: '', paspor: '', hp: '', umur: '', regu: '', hotel: '', punya_hp: true, punya_gelang: false, beacon_id: '', catatan: '', foto: '' };

export default function KelolaPage() {
  const { tampilToast } = useApp();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);        // dialog tambah/ubah
  const [impor, setImpor] = useState(false);
  const [imporTeks, setImporTeks] = useState('');
  const [imporRegu, setImporRegu] = useState('');
  const [imporHotel, setImporHotel] = useState('');
  const [hasil, setHasil] = useState('');

  const muat = useCallback(async () => {
    const d = await api('/api/jamaah');
    if (d.ok) setRows(d.jamaah || []);
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const simpan = async () => {
    if (!form.nama.trim()) { tampilToast('Nama wajib diisi', true); return; }
    const r = form.id
      ? await api('/api/jamaah', { method: 'PUT', body: JSON.stringify({ ...form, id: form.id }) })
      : await api('/api/jamaah', { method: 'POST', body: JSON.stringify(form) });
    if (r.ok) { tampilToast(form.id ? '✅ Perubahan disimpan' : '✅ Jamaah ditambahkan'); setForm(null); muat(); }
    else tampilToast('Gagal: ' + (r.error || ''), true);
  };
  const hapus = async (m) => {
    if (!confirm(`Hapus ${m.nama} beserta seluruh riwayatnya (posisi, absensi, latihan)?`)) return;
    const r = await api('/api/jamaah?id=' + encodeURIComponent(m.id), { method: 'DELETE' });
    if (r.ok) { tampilToast('🗑️ ' + m.nama + ' dihapus'); muat(); } else tampilToast('Gagal: ' + (r.error || ''), true);
  };
  const jalankanImpor = async () => {
    const baris = imporTeks.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(/\t|;/).map(c => c.trim()));
    if (!baris.length) { setHasil('❌ Tidak ada baris'); return; }
    const r = await api('/api/jamaah/impor', { method: 'POST', body: JSON.stringify({ rows: baris, regu: imporRegu, hotel: imporHotel }) });
    setHasil(r.ok ? `✅ ${r.sukses} diimpor${r.gagal.length ? ' · gagal: ' + r.gagal.join('; ') : ''}` : '❌ ' + (r.error || ''));
    muat();
  };
  const pilihFoto = (file) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const maks = 360, skala = Math.min(1, maks / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * skala); c.height = Math.round(img.height * skala);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      setForm(f => ({ ...f, foto: c.toDataURL('image/jpeg', 0.72) }));
    };
    img.src = URL.createObjectURL(file);
  };
  const tautanLatihan = async (m) => {
    const r = await api('/api/latihan/link', { method: 'POST', body: JSON.stringify({ jamaahId: m.id }) });
    if (r.ok) {
      try { await navigator.clipboard.writeText(r.url); tampilToast('🔗 Tautan latihan ' + m.nama + ' disalin'); }
      catch (e) { prompt('Tautan latihan ' + m.nama + ':', r.url); }
    } else tampilToast('Gagal: ' + (r.error || ''), true);
  };

  return (
    <div className="p-3 md:p-5 max-w-6xl mx-auto pb-10">
      <h1 className="text-2xl font-extrabold text-hijau">🛂 Kelola Jamaah</h1>
      <p className="text-slate-500 text-[13.5px] -mt-2">Tambah manual atau tempel dari Excel. Kolom: Nama · Paspor · HP · Umur · Ber-HP (ya/tidak) · ID Gelang · Catatan.</p>
      <div className="flex gap-2 flex-wrap mt-3">
        <button className="btn btn-utama" onClick={() => setForm({ ...KOSONG })}>＋ Tambah Jamaah</button>
        <button className="btn btn-muda" onClick={() => setImpor(true)}>📋 Impor Tempel Excel</button>
        <a className="btn btn-muda" href="#/cetak">🖨️ Cetak Kartu</a>
        <button className="btn btn-muda" onClick={muat}>🔄 Segarkan</button>
      </div>

      <div className="kartu mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="bg-hijau text-white text-left">
            <th className="p-2.5">Jamaah</th><th className="p-2.5">Paspor</th><th className="p-2.5">Umur</th>
            <th className="p-2.5">Perangkat</th><th className="p-2.5">Gelang</th><th className="p-2.5">Catatan</th><th className="p-2.5">Aksi</th>
          </tr></thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.id} className="border-b border-slate-100">
                <td className="p-2.5">
                  <div className="flex items-center gap-2">
                    {m.foto ? <img src={m.foto} alt="" className="w-9 h-9 rounded-lg object-cover" />
                      : <div className="w-9 h-9 rounded-lg bg-emerald-50 text-hijau grid place-items-center font-extrabold text-[12px]">{(m.nama || '?').replace(/^(H\.|Hj\.)\s*/, '').split(' ').slice(0, 2).map(x => x[0]).join('')}</div>}
                    <div><b>{m.nama}</b><br /><small className="text-slate-500">{m.regu || '—'}</small></div>
                  </div>
                </td>
                <td className="p-2.5">{m.paspor || '—'}</td>
                <td className="p-2.5">{m.umur || '—'}</td>
                <td className="p-2.5">{m.punya_hp && m.punya_gelang ? '📱+⌚' : m.punya_hp ? '📱' : '⌚'}</td>
                <td className="p-2.5 text-[11.5px]">{m.beacon_id || '—'}</td>
                <td className="p-2.5 max-w-[160px]"><small>{m.catatan || '—'}</small></td>
                <td className="p-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    <a className="btn btn-muda !min-h-[38px] !px-2.5 !text-[11.5px]" href={'#/kartu/' + encodeURIComponent(m.id)}>🪪</a>
                    <button className="btn btn-muda !min-h-[38px] !px-2.5 !text-[11.5px]" onClick={() => tautanLatihan(m)}>🥾</button>
                    <a className="btn btn-emas !min-h-[38px] !px-2.5 !text-[11.5px]" href={'#/radar?pasang=' + encodeURIComponent(m.id)}>⌚</a>
                    <button className="btn btn-muda !min-h-[38px] !px-2.5 !text-[11.5px]" onClick={() => setForm({ ...KOSONG, ...m, punya_hp: !!m.punya_hp, punya_gelang: !!m.punya_gelang })}>✏️</button>
                    <button className="btn btn-merah !min-h-[38px] !px-2.5 !text-[11.5px]" onClick={() => hapus(m)}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* dialog form */}
      {form && (
        <div className="fixed inset-0 bg-black/50 z-[1400] grid place-items-center p-3" onClick={() => setForm(null)}>
          <div className="kartu p-5 w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <b className="text-hijau text-[16px]">{form.id ? '✏️ Ubah: ' + form.nama : '＋ Tambah Jamaah'}</b>
            <label className="text-[12px] font-bold text-slate-500 block mt-3">Nama Lengkap (dengan gelar) *</label>
            <input className="input" value={form.nama} onChange={e => setForm({ ...form, nama: e.target.value })} placeholder="Hj. Siti Aminah" />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[12px] font-bold text-slate-500 block mt-2">No. Paspor</label><input className="input" value={form.paspor} onChange={e => setForm({ ...form, paspor: e.target.value })} /></div>
              <div><label className="text-[12px] font-bold text-slate-500 block mt-2">No. HP (WA)</label><input className="input" value={form.hp} onChange={e => setForm({ ...form, hp: e.target.value })} /></div>
              <div><label className="text-[12px] font-bold text-slate-500 block mt-2">Usia</label><input className="input" type="number" value={form.umur} onChange={e => setForm({ ...form, umur: e.target.value })} /></div>
              <div><label className="text-[12px] font-bold text-slate-500 block mt-2">Regu</label><input className="input" value={form.regu} onChange={e => setForm({ ...form, regu: e.target.value })} /></div>
            </div>
            <label className="text-[12px] font-bold text-slate-500 block mt-2">Hotel</label>
            <input className="input" value={form.hotel} onChange={e => setForm({ ...form, hotel: e.target.value })} />
            <div className="flex gap-4 mt-3 text-[13.5px] font-bold">
              <label className="flex items-center gap-2"><input type="checkbox" className="w-5 h-5 accent-[#0B5D3B]" checked={form.punya_hp} onChange={e => setForm({ ...form, punya_hp: e.target.checked })} /> 📱 Bawa smartphone</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="w-5 h-5 accent-[#B48A2F]" checked={form.punya_gelang} onChange={e => setForm({ ...form, punya_gelang: e.target.checked })} /> ⌚ Gelang BLE</label>
            </div>
            {form.punya_gelang && <><label className="text-[12px] font-bold text-slate-500 block mt-2">ID Gelang (beacon)</label>
              <input className="input" value={form.beacon_id} onChange={e => setForm({ ...form, beacon_id: e.target.value })} placeholder="otomatis saat dipasangkan lewat Radar" /></>}
            <label className="text-[12px] font-bold text-slate-500 block mt-2">Catatan</label>
            <input className="input" value={form.catatan} onChange={e => setForm({ ...form, catatan: e.target.value })} />
            <label className="text-[12px] font-bold text-slate-500 block mt-2">Foto (dikompres otomatis)</label>
            <div className="flex gap-2 items-center">
              {form.foto ? <img src={form.foto} alt="" className="w-14 h-14 rounded-xl object-cover border border-slate-200" /> : null}
              <input type="file" accept="image/*" className="text-[13px]" onChange={e => pilihFoto(e.target.files?.[0])} />
              {form.foto && <button className="btn btn-muda !min-h-[38px] !text-[11.5px]" onClick={() => setForm({ ...form, foto: '' })}>🗑️ foto</button>}
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn btn-muda flex-1" onClick={() => setForm(null)}>Batal</button>
              <button className="btn btn-utama flex-1" onClick={simpan}>💾 Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* dialog impor */}
      {impor && (
        <div className="fixed inset-0 bg-black/50 z-[1400] grid place-items-center p-3" onClick={() => setImpor(false)}>
          <div className="kartu p-5 w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <b className="text-hijau text-[16px]">📋 Impor Tempel Excel</b>
            <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">Salin blok dari Excel lalu tempel. Urutan kolom: <b>Nama · Paspor · HP · Umur · Ber-HP (ya/tidak) · ID Gelang · Catatan</b>. Baris berawalan # diabaikan.</p>
            <textarea className="input !font-mono !text-[11.5px] mt-2" rows={7} value={imporTeks} onChange={e => setImporTeks(e.target.value)}
              placeholder={'H. Yusuf\tX1189501\t0812-3333\t60\tya\t\t—\nHj. Rohmah\tX1189502\t0812-3334\t72\ttidak\tFSC-A215\tlansia, gelang BLE'} />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[12px] font-bold text-slate-500 block mt-2">Regu (sama semua)</label><input className="input" value={imporRegu} onChange={e => setImporRegu(e.target.value)} /></div>
              <div><label className="text-[12px] font-bold text-slate-500 block mt-2">Hotel (sama semua)</label><input className="input" value={imporHotel} onChange={e => setImporHotel(e.target.value)} /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn btn-muda flex-1" onClick={() => setImpor(false)}>Tutup</button>
              <button className="btn btn-utama flex-1" onClick={jalankanImpor}>Impor Sekarang</button>
            </div>
            {hasil && <p className="mt-3 font-bold text-[13px]">{hasil}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
