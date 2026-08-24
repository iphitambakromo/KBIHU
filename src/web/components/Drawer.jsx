import React from 'react';
export default function Drawer({ open, onClose, onKeluar, sesi, rute }) {
  const grup = [
    { t: 'Utama', items: [
      { l: '🗺️ Dashboard', href: '#/' },
      { l: '✅ Absensi Titik', href: '#/absensi' },
      { l: '📡 Radar Gelang', href: '#/radar' },
      { l: '📊 Progres Latihan', href: '#/progres' },
      { l: '🪪 Cetak Kartu', href: '#/cetak', khusus: sesi.peran === 'admin' || sesi.peran === 'ketrom' },
    ]},
    { t: 'Pengaturan', items: [
      { l: '🛂 Kelola Jamaah', href: '#/kelola', khusus: sesi.peran === 'admin' },
      { l: '👥 Pengguna', href: '#/pengguna', khusus: sesi.peran === 'admin' },
      { l: '🛠 Diagnostik', href: '#/diag', khusus: sesi.peran === 'admin' },
    ]},
  ];
  return (
    <>
      <div className={`fixed inset-0 bg-black/50 z-[1400] transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <aside className={`fixed top-0 left-0 bottom-0 w-[85vw] max-w-[330px] bg-white z-[1500] shadow-2xl flex flex-col
        transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="bg-gradient-to-r from-hijau to-hijau2 text-white p-4 flex items-center gap-3">
          <div className="flex-1">
            <b className="text-[15px]">🕌 IPHI</b>
            <small className="block opacity-85 text-[11px] mt-1">
              {sesi.nama} · {sesi.peran === 'admin' ? 'Admin' : sesi.peran === 'ketrom' ? 'KaRom' : 'KaRu ' + (sesi.regu || '')}
            </small>
          </div>
          <button className="w-11 h-11 rounded-xl bg-white/20 text-lg" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {grup.map(g => (
            <div key={g.t}>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 px-3 pt-4 pb-1">{g.t}</p>
              {g.items.filter(x => x.href || x.segera).filter(x => !x.khusus || x.khusus).map(x => x.href ? (
                <a key={x.l} href={x.href}
                  className={`w-full text-left rounded-xl px-3.5 py-3.5 text-[15px] font-bold min-h-[54px] flex items-center
                    ${('#/' + rute) === x.href || (x.href === '#/' && rute === '') ? 'bg-emerald-50 text-hijau' : 'text-slate-700 hover:bg-emerald-50'}`}>{x.l}</a>
              ) : (
                <button key={x.l} disabled={x.segera}
                  className={`w-full text-left rounded-xl px-3.5 py-3.5 text-[15px] font-bold min-h-[54px]
                    ${x.segera ? 'text-slate-300 cursor-not-allowed' : 'text-slate-700 hover:bg-emerald-50'}`}>
                  {x.l}{x.segera && <span className="float-right text-[10px] text-slate-300 font-extrabold mt-1">segera</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="btn btn-merah m-3" onClick={onKeluar}>🚪 Keluar</button>
      </aside>
    </>
  );
}
