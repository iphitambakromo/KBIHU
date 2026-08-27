import React, { useState } from 'react';
import { useApp } from '../App.jsx';
import { waLink, tampilkanHp } from '../lib/wa.js';

/* Daftar jamaah sesuai user (karu = regunya sendiri, karom/admin = semua —
   sudah difilter server via /api/state). Klik nama / tombol 💬 = langsung
   WhatsApp ke no. HP jamaah. */
export default function JamaahPage() {
  const { state, sesi } = useApp();
  const [cari, setCari] = useState('');
  const [bunyiCooldown, setBunyiCooldown] = useState({});

  const list = (state?.jamaah || []).filter(m => {
    if (!cari.trim()) return true;
    const q = cari.trim().toLowerCase();
    return (m.nama || '').toLowerCase().includes(q) || (m.regu || '').toLowerCase().includes(q);
  });

  const reguSaya = sesi && sesi.peran === 'ketua-regu' ? 'Regu Anda: ' + (sesi.regu || '') : 'Semua jamaah (hak akses Anda)';

  // Fungsi untuk bunyikan gelang
  const bunyikanGelang = async (m) => {
    if (!m.punya_gelang || (!m.beacon_id && !m.mac_tag)) return;
    if (bunyiCooldown[m.id]) return;
    
    setBunyiCooldown(prev => ({ ...prev, [m.id]: true }));
    setTimeout(() => setBunyiCooldown(prev => ({ ...prev, [m.id]: false })), 5000);
    
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [0x1802, 0xFCF1, 0xFFF0, 0xFFE0]
      });
      
      const server = await device.gatt.connect();
      try {
        const sv = await server.getPrimaryService(0x1802);
        const ch = await sv.getCharacteristic(0x2A06);
        await ch.writeValue(new Uint8Array([2]));
        setTimeout(async () => { try { await ch.writeValue(new Uint8Array([0])); } catch (e) {} try { server.disconnect(); } catch (e) {} }, 3500);
      } catch (e) {
        try { const sv2 = await server.getPrimaryService(0xFFF0);
          const cs = await sv2.getCharacteristics();
          const w = cs.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (w) { await w.writeValue(new Uint8Array([1])); setTimeout(() => { try { server.disconnect(); } catch (e) {} }, 3500); }
        } catch (e2) {}
      }
    } catch (e) {}
  };

  // Fungsi untuk cari jamaah
  const cariJamaah = (m) => {
    if (!m.punya_gelang || (!m.beacon_id && !m.mac_tag)) return;
    window.location.hash = '#/radar?cari=' + encodeURIComponent(m.id);
  };

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
              <div className="flex gap-1.5 shrink-0">
                {m.punya_gelang && (m.beacon_id || m.mac_tag) && (
                  <>
                    <button 
                      className="btn btn-emas !min-h-[48px] !px-3 !text-[12px]" 
                      onClick={() => cariJamaah(m)}
                      title={"Cari " + m.nama}
                    >
                      🔍
                    </button>
                    <button 
                      className={`btn !min-h-[48px] !px-3 !text-[12px] ${bunyiCooldown[m.id] ? 'btn-muda opacity-50' : 'btn-emas'}`}
                      onClick={() => bunyikanGelang(m)}
                      disabled={bunyiCooldown[m.id]}
                      title={"Bunyikan gelang " + m.nama}
                    >
                      {bunyiCooldown[m.id] ? '⏳' : '🔊'}
                    </button>
                  </>
                )}
                {wa
                  ? <a className="btn bg-[#25D366] text-white !min-h-[48px] !px-4 !text-[13.5px]" href={wa} target="_blank" rel="noopener" title={"WhatsApp " + m.nama}>💬 WA</a>
                  : <span className="text-slate-300 text-[12px] font-bold" title="No. HP belum diisi (Admin → Kelola Jamaah)">Belum ada HP</span>}
              </div>
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
