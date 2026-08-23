import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { bacaGPS } from './lib/gps.js';
import Toast from './components/Toast.jsx';
import Drawer from './components/Drawer.jsx';
import MapView from './components/MapView.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

/* ---------- LOGIN ---------- */
function Login({ onOk }) {
  const [user, setUser] = useState(''); const [sandi, setSandi] = useState('');
  const [err, setErr] = useState(''); const [tunggu, setTunggu] = useState(false);
  const masuk = async () => {
    if (!user) { setErr('Isi nama pengguna'); return; }
    setTunggu(true);
    try {
      const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ user, sandi }) });
      if (!d.ok) setErr(d.error || 'gagal'); else { localStorage.setItem('iphi_tok', d.token); onOk(d); }
    } finally { setTunggu(false); }
  };
  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-gradient-to-br from-hijau to-hijau2">
      <div className="kartu w-full max-w-md p-7 text-center">
        <div className="text-4xl">🕌</div>
        <h1 className="text-2xl font-extrabold text-hijau mt-2">IPHI</h1>
        <p className="text-[12.5px] font-bold text-hijau leading-relaxed mt-1">
          Tracking Amanah Mengawal Barisan<br/>Awasi Kendali Rombongan · Optimalisasi Manajemen Operasional
        </p>
        <p className="text-slate-500 text-[13px] mt-3">Masuk dengan akun pembina</p>
        <input className="input mt-4 text-center" placeholder="admin / karom / karu1" value={user}
               autoCapitalize="none" onChange={e => setUser(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && masuk()} />
        <input className="input mt-3 text-center" type="password" placeholder="kata sandi" value={sandi}
               onChange={e => setSandi(e.target.value)} onKeyDown={e => e.key === 'Enter' && masuk()} />
        {err && <p className="text-merah font-bold text-[13px] mt-2">❌ {err}</p>}
        <button className="btn btn-utama w-full mt-4" onClick={masuk} disabled={tunggu}>
          {tunggu ? 'Memeriksa…' : 'Masuk'}
        </button>
        <p className="text-slate-400 text-[11px] mt-4">Akun awal: admin/123 · karom/123 · karu1–karu5/123456 — segera ganti.</p>
      </div>
    </div>
  );
}

/* ---------- APLIKASI ---------- */
export default function App() {
  const [sesi, setSesi] = useState(null);              // info user login
  const [state, setState] = useState(null);            // data dashboard
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const tampilToast = useCallback((pesan, err = false) => {
    setToast({ pesan, err });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const muat = useCallback(async () => {
    try { const d = await api('/api/state'); if (d.ok) setState(d); } catch (e) {}
  }, []);

  useEffect(() => {
    (async () => {
      await fetch('/api/seed', { method: 'POST' }).catch(() => {});
      if (!localStorage.getItem('iphi_tok')) return;
      try {
        const me = await api('/api/me');
        if (me.ok) { setSesi(me); muat(); }
      } catch (e) {}
    })();
  }, [muat]);

  useEffect(() => {
    if (!sesi) return;
    muat();
    const t = setInterval(() => { if (!document.hidden) muat(); }, 5000);
    return () => clearInterval(t);
  }, [sesi, muat]);

  const keluar = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('iphi_tok'); location.reload();
  };

  const bolehKelola = sesi && ['admin', 'ketrom', 'ketua-regu'].includes(sesi.peran);

  return (
    <Ctx.Provider value={{ sesi, state, muat, tampilToast, bolehKelola }}>
      {!sesi ? <Login onOk={(d) => setSesi(d)} /> : (
        <div className="h-full flex flex-col">
          {/* HEADER */}
          <header className="bg-gradient-to-r from-hijau to-hijau2 text-white flex items-center gap-3 px-3 py-2.5 shadow-lg z-[1200]">
            <button className="w-12 h-12 rounded-xl bg-white/15 border border-white/25 text-xl" onClick={() => setDrawer(true)} aria-label="Menu">☰</button>
            <div className="min-w-0 flex-1">
              <h1 className="font-extrabold leading-tight text-[17px]">🕌 IPHI</h1>
              <p className="text-white/80 text-[10px] leading-snug">Tracking Amanah Mengawal Barisan · Awasi Kendali Rombongan · Optimalisasi Manajemen Operasional</p>
            </div>
            <span className="hidden sm:inline-block bg-white/15 border border-white/25 rounded-full px-3 py-1.5 text-[12px] font-bold">
              {sesi.peran === 'admin' ? '🛂 Admin' : sesi.peran === 'ketrom' ? '🧭 KaRom' : '🚩 KaRu'}
            </span>
          </header>

          {/* RESPONSIF: peta penuh + panel bawah (HP) / grid 2 kolom (tableti & PC) */}
          <div className="flex-1 min-h-0 md:grid md:grid-cols-[380px_1fr] lg:grid-cols-[420px_1fr]">
            <MapView />
            <section className="order-2 md:order-1 p-3 space-y-3 overflow-y-auto max-h-[38vh] md:max-h-none md:border-r md:border-slate-200">
              <div className="kartu p-4">
                <h2 className="text-[12px] font-extrabold uppercase tracking-wide text-hijau">Sesi Aktif</h2>
                <p className="font-extrabold text-[15px]">{state?.sesi?.nama || '—'}</p>
                <div className="flex gap-2 mt-3">
                  <span className="bg-emerald-50 border border-emerald-200 text-hijau rounded-full px-3 py-1.5 text-[12px] font-bold">
                    {state?.stat?.total ?? '—'} jamaah
                  </span>
                  <span className="bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-3 py-1.5 text-[12px] font-bold">
                    ⌚ {state?.stat?.gelang ?? '—'} gelang
                  </span>
                </div>
              </div>
              <div className="kartu p-4">
                <h2 className="text-[12px] font-extrabold uppercase tracking-wide text-hijau">Titik & Tujuan</h2>
                {(state?.titik || []).length === 0 && (
                  <p className="text-slate-500 text-[13px] mt-2">Belum ada titik. Tekan <b>📍 Titik Kumpul</b> di peta saat berada di lokasi.</p>
                )}
                <div className="mt-2 space-y-2">
                  {(state?.titik || []).map(t => (
                    <div key={t.id} className="flex items-center gap-3 border border-slate-200 rounded-xl p-3">
                      <span className="text-xl">{t.tipe === 'kumpul' ? '📍' : '🎯'}</span>
                      <div className="flex-1 min-w-0">
                        <b className="text-[14px] block truncate">{t.nama}</b>
                        <small className="text-slate-500">radius {t.radius} m · oleh {t.dibuat_oleh}</small>
                      </div>
                      {bolehKelola && (
                        <button className="btn btn-emas !min-h-[42px] !px-3 !text-[12px]"
                                onClick={async () => { await api('/api/titik?id=' + encodeURIComponent(t.id), { method: 'DELETE' }); muat(); tampilToast('🗑️ Titik dihapus'); }}>🗑️</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-slate-400 text-[11px] text-center pb-2">Absensi, Radar Gelang, Kartu Jamaah & Simulasi hadir di fase berikutnya</p>
            </section>
          </div>

          <Drawer open={drawer} onClose={() => setDrawer(false)} onKeluar={keluar} sesi={sesi} />
          <Toast toast={toast} />
        </div>
      )}
    </Ctx.Provider>
  );
}
