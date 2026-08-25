import React, { useState } from 'react';
import { useApp } from '../App.jsx';
import { waLink, tampilkanHp } from '../lib/wa.js';

/* Daftar jamaah sesuai user (karu = regunya sendiri, karom/admin = semua —
   sudah difilter server via /api/state). Klik nama / tombol 💬 = langsung
   WhatsApp ke no. HP jamaah. */
export default function JamaahPage() {
  const { state, sesi } = useApp();
  const [cari, setCari] = useState('');

  const list = (state?.jamaah || []).filter(m => {
    if (!cari.trim()) return true;
    const q = cari.trim().toLowerCase();
    return (m.nama || '').toLowerCase().includes(q) || (m.regu || '').toLowerCase().includes(q);
  });

  const reguSaya = sesi && sesi.peran === 'ketua-regu' ? 'Regu Anda: ' + (sesi.regu || '') : 'Semua jamaah (hak akses Anda)';

  return (
    <div className="p-3 md:p-5 max-w-3xl mx-auto space-y-4 pb-10">
      <h1 className="text-2xl font-extrabold text-hijau">👥 Jamaah (WhatsApp)</h1>
      <p className="text-slate-500 text-[13.5px] -mt-2">
        {reguSaya}. <b>Klik nama</b> atau tombol <b>💬</b> = langsung chat WhatsApp jamaah itu.
      </p>

      <input className="input" placeholder="🔍 Cari nama / regu…" value={cari} onChange={e => setCari(e.target.value)} />

      <div className="space-y-2">
        {list.length === 0 && <p className="text-slate-500 text-[13px]">Tidak ada jamaah{cari ? ' yang cocok dengan "' + cari + '"' : ''}.</p>}
        {list.map(m => {
          const wa = waLink(m.hp);
          return (
            <div key={m.id} className="kartu flex items-center gap-3 p-3">
              {m.foto
                ? <img src={m.foto} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
                : <div className="w-12 h-12 rounded-xl bg-emerald-50 text-hijau grid place-items-center font-extrabold shrink-0">{(m.nama || '?').replace(/^(H\.|Hj\.)\s*/, '').split(' ').slice(0, 2).map(x => x[0]).join('')}</div>}
              <div className="flex-1 min-w-0">
                {wa
                  ? <a href={wa} target="_blank" rel="noopener" className="text-[15px] font-extrabold text-hijau hover:underline block truncate">{m.nama}</a>
                  : <b className="text-[15px] block truncate">{m.nama}</b>}
                <small className="text-slate-500 text-[12px] block">
                  {m.regu || '—'}
                  {m.punya_hp ? '' : ' · 📵 tanpa HP'}
                  {m.punya_gelang ? ' · ⌚' : ''}
                  {m.hp && wa ? ' · ' + tampilkanHp(m.hp) : ''}
                </small>
              </div>
              {wa
                ? <a className="btn bg-[#25D366] text-white !min-h-[48px] !px-4 !text-[13.5px] shrink-0" href={wa} target="_blank" rel="noopener" title={"WhatsApp " + m.nama}>💬 WA</a>
                : <span className="text-slate-300 text-[12px] font-bold shrink-0" title="No. HP belum diisi (Admin → Kelola Jamaah)">Belum ada HP</span>}
            </div>
          );
        })}
      </div>

      <p className="text-slate-400 text-[11.5px] leading-relaxed">
        💡 No. HP diinput oleh Admin / KaRom di <b>Kelola Jamaah</b> (field "No. HP (WA)"). Format: 0812… / 812… / 62812…
      </p>
    </div>
  );
}
