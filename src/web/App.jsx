import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { bacaGPS } from './lib/gps.js';
import Toast from './components/Toast.jsx';
import Drawer from './components/Drawer.jsx';
import MapView from './components/MapView.jsx';
import AbsensiPage from './pages/AbsensiPage.jsx';
import CetakPage from './pages/CetakPage.jsx';
import ProgresPage from './pages/ProgresPage.jsx';
import KelolaPage from './pages/KelolaPage.jsx';
import PenggunaPage from './pages/PenggunaPage.jsx';
import DiagPage from './pages/DiagPage.jsx';
import PengaturanPage from './pages/PengaturanPage.jsx';
import RadarPage from './pages/RadarPage.jsx';
import KawalPage from './pages/KawalPage.jsx';
import JamaahPage from './pages/JamaahPage.jsx';

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
  const [rute, setRute] = useState((location.hash || '#/').replace('#/', ''));
  const [beepStatus, setBeepStatus] = useState('');   // status bunyi iTag (dashboard)
  const [beepBusy, setBeepBusy] = useState(false);
  const beepGuardRef = useRef(false);
  useEffect(() => {
    const fn = () => { setRute((location.hash || '#/').replace('#/', '')); setDrawer(false); };
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  const ruteBersih = (rute || "").split("?")[0];  // abaikan param (?cari=, ?pasang=) utk matching menu
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const tampilToast = useCallback((pesan, err = false) => {
    setToast({ pesan, err });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const stateSig = useRef('');
  const muat = useCallback(async () => {
    try {
      const d = await api('/api/state');
      if (!d.ok) return;
      // skip re-render bila data tak berubah (hindari gangguan saat mengetik form)
      // signature MENDALAM: perubahan data apa pun (jamaah, gelang, MAC, titik, SOS, kejadian,
      // posisi, stat) langsung memperbarui layar — tanpa perlu refresh browser.
      // Halaman form tak terpengaruh (rute form tak di-poll).
      const sig = JSON.stringify([
        d.sesi?.id,
        (d.jamaah || []).map(m => [m.id, m.nama, m.regu, m.paspor, m.hotel, m.catatan, m.punya_hp, m.punya_gelang, m.beacon_id, m.mac_tag, m.sosAktif, m.poisoni?.waktu]),
        (d.titik || []).map(t => [t.id, t.nama, t.lat, t.lng, t.radius]),
        (d.kejadian || []).map(k => [k.id, k.tipe, k.ditangani]),
        d.stat
      ]);
      if (sig === stateSig.current) return;
      stateSig.current = sig;
      setState(d);
    } catch (e) {}
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
    // halaman form: jangan poll (re-render periodik bisa mengganggu input terkendali)
    const RUTE_FORM = ['kelola', 'pengaturan', 'pengguna', 'diag', 'cetak'];
    const t = setInterval(() => {
      if (document.hidden) return;
      const r = (location.hash || '#/').replace('#/', '').split('?')[0].split('/')[0];
      if (RUTE_FORM.includes(r)) return;
      muat();
    }, 5000);
    return () => clearInterval(t);
  }, [sesi, muat]);

  const keluar = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('iphi_tok'); location.reload();
  };

  const gantiNamaTitik = async (t) => {
    const nama = prompt(`Ganti nama titik "${t.nama}":`, t.nama);
    if (nama === null) return;
    const v = nama.trim();
    if (!v) { tampilToast('Nama tidak boleh kosong', true); return; }
    const r = await api('/api/titik', { method: 'PUT', body: JSON.stringify({ id: t.id, nama: v }) });
    if (r.ok) { tampilToast(`✏️ → "${v}"`); muat(); }
    else tampilToast('Gagal: ' + (r.error || ''), true);
  };

  const bolehKelola = sesi && ['admin', 'ketrom', 'ketua-regu'].includes(sesi.peran);

  /* ===== BUNYI ITAG (dashboard): bunyi per jamaah / bunyi semua — tag bunyi saat HP konek ===== */
  const namaDefaultTag = (nm) => /^(itag|itag\s+baru)$/i.test(String(nm || '').trim());
  const cocokTag = (m, ev) => {
    if (!m.beacon_id) return false;
    const id = ev.device.id || '', nm = ev.device.name || '';
    if (id && id === m.beacon_id) return true;                       // kode per-HP (pasang di HP ini)
    if (nm && !namaDefaultTag(m.beacon_id) && nm === m.beacon_id) return true; // nama unik (global)
    return false;
  };
  const bunyikanDevice = async (device) => {
    try {
      const server = await device.gatt.connect();
      const putuskan = () => setTimeout(() => { try { server.disconnect(); } catch (e) {} }, 4000);
      try { const sv = await server.getPrimaryService(0x1802); const ch = await sv.getCharacteristic(0x2A06);
        await ch.writeValue(new Uint8Array([2]));
        setTimeout(() => { ch.writeValue(new Uint8Array([0])).catch(() => {}); }, 1000);
        putuskan(); return 'servis baterai';
      } catch (e) {}
      try { const sv2 = await server.getPrimaryService(0xFFE0); const ch2 = await sv2.getCharacteristic(0xFFE1);
        await ch2.writeValue(new Uint8Array([1])); putuskan(); return 'servis iTag'; } catch (e) {}
      try { const sv3 = await server.getPrimaryService(0xFFF0); const cs = await sv3.getCharacteristics();
        const w = cs.find(c => c.properties.write || c.properties.writeWithoutResponse);
        if (w) { await w.writeValue(new Uint8Array([1])); putuskan(); return 'servis 0xFFF0'; } } catch (e) {}
      putuskan(); return 'konek';   // sebagian iTag bunyinya saat tersambung/terputus
    } catch (e) { return 'gagal'; }
  };
  const bunyiJamaah = async (m) => {
    if (beepGuardRef.current) return;
    if (!navigator.bluetooth?.requestDevice) { tampilToast('Browser tidak mendukung Bluetooth', true); return; }
    beepGuardRef.current = true; setBeepBusy(true);
    setBeepStatus(`🔊 Mencari tag ${m.nama} (±2,5 dtk)…`);
    let device = null;
    if (navigator.bluetooth.requestLEScan) {
      try {
        const scan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
        device = await new Promise((res) => {
          const h = (ev) => { if (cocokTag(m, ev)) { clearTimeout(t); try { scan.stop(); } catch (e) {} try { navigator.bluetooth.removeEventListener('advertisementreceived', h); } catch (e) {} res(ev.device); } };
          const t = setTimeout(() => { try { scan.stop(); } catch (e) {} try { navigator.bluetooth.removeEventListener('advertisementreceived', h); } catch (e) {} res(null); }, 2500);
          navigator.bluetooth.addEventListener('advertisementreceived', h);
        });
      } catch (e) { device = null; }
    }
    if (!device) {
      setBeepStatus(`🔊 Tag ${m.nama} tidak terdeteksi otomatis — pilih dari daftar…`);
      try { device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [0x1802, 0xFCF1, 0xFFF0, 0xFFE0] }); }
      catch (e) { beepGuardRef.current = false; setBeepBusy(false); setBeepStatus(''); tampilToast('Pembatalan — tidak ada tag dipilih', true); return; }
    }
    const info = await bunyikanDevice(device);
    beepGuardRef.current = false; setBeepBusy(false);
    if (info === 'gagal') { setBeepStatus(''); tampilToast(`⚠️ Gagal konek ke tag ${m.nama}`, true); return; }
    setBeepStatus(`🔊 Tag ${m.nama} berbunyi (tag bunyi saat tersambung/terputus)`);
    setTimeout(() => setBeepStatus(''), 6000);
  };
  const bunyiSemua = async () => {
    if (beepGuardRef.current) return;
    if (!navigator.bluetooth?.requestLEScan) { tampilToast('Bunyi semua butuh Chrome/Kiwi Android (scan Bluetooth)', true); return; }
    const daftar = (state?.jamaah || []).filter(m => m.punya_gelang && m.beacon_id);
    if (!daftar.length) { tampilToast('Belum ada jamaah dengan gelang terpasang', true); return; }
    beepGuardRef.current = true; setBeepBusy(true);
    setBeepStatus(`📶 Mendeteksi tag (${daftar.length} jamaah, ±4 dtk)…`);
    const matches = {};
    try {
      const scan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
      await new Promise((res) => {
        const h = (ev) => { for (const m of daftar) if (!matches[m.id] && cocokTag(m, ev)) matches[m.id] = ev.device; };
        const t = setTimeout(() => { try { scan.stop(); } catch (e) {} try { navigator.bluetooth.removeEventListener('advertisementreceived', h); } catch (e) {} res(); }, 4000);
        navigator.bluetooth.addEventListener('advertisementreceived', h);
      });
    } catch (e) {}
    const urut = daftar.filter(m => matches[m.id]);
    if (!urut.length) { beepGuardRef.current = false; setBeepBusy(false); setBeepStatus(''); tampilToast('Tidak ada tag dalam jangkauan (±10–25 m)', true); return; }
    const hasil = [];
    for (const m of urut) {
      setBeepStatus(`🔊 ${(hasil.length + 1)}/${urut.length}: ${m.nama}…`);
      const info = await bunyikanDevice(matches[m.id]);
      hasil.push({ nama: m.nama, ok: info !== 'gagal' });
      await new Promise(r => setTimeout(r, 1500));
    }
    beepGuardRef.current = false; setBeepBusy(false);
    const okN = hasil.filter(h => h.ok).length;
    setBeepStatus(`✅ ${okN}/${urut.length} tag dibunyikan` + (urut.length < daftar.length ? ` — ${daftar.length - urut.length} tag tidak terdeteksi (jauh/baterai habis)` : ''));
    setTimeout(() => setBeepStatus(''), 8000);
  };

  return (
    <Ctx.Provider value={{ sesi, state, muat, tampilToast, bolehKelola }}>
      {!sesi ? <Login onOk={(d) => setSesi(d)} /> : (
        <div className="h-full flex flex-col">
          {/* HEADER */}
          <header className="bg-gradient-to-r from-hijau to-hijau2 text-white flex items-center gap-3 px-3 py-2.5 shadow-lg z-[1200]">
            <button className="w-12 h-12 rounded-xl bg-white/15 border border-white/25 text-xl" onClick={() => setDrawer(true)} aria-label="Menu">☰</button>
            <a href="#/" className="min-w-0 flex-1 -m-1 p-1" title="Kembali ke Dashboard">
              <h1 className="font-extrabold leading-tight text-[17px]">🕌 IPHI</h1>
              <p className="text-white/80 text-[10px] leading-snug">Tracking Amanah Mengawal Barisan · Awasi Kendali Rombongan · Optimalisasi Manajemen Operasional</p>
            </a>
            <span className="hidden sm:inline-block bg-white/15 border border-white/25 rounded-full px-3 py-1.5 text-[12px] font-bold">
              {sesi.peran === 'admin' ? '🛂 Admin' : sesi.peran === 'ketrom' ? '🧭 KaRom' : '🚩 KaRu'}
            </span>
          </header>

          {ruteBersih === 'absensi' ? <div className="flex-1 overflow-y-auto"><AbsensiPage /></div> : ruteBersih === 'radar' ? <div className="flex-1 overflow-y-auto"><RadarPage /></div> : ruteBersih === 'kawal' ? <div className="flex-1 overflow-y-auto"><KawalPage /></div>
            : ruteBersih === 'jamaah' ? <div className="flex-1 overflow-y-auto"><JamaahPage /></div>
            : ruteBersih === 'progres' ? <div className="flex-1 overflow-y-auto"><ProgresPage /></div>
            : ruteBersih === 'kelola' ? (sesi.peran === 'admin' ? <div className="flex-1 overflow-y-auto"><KelolaPage /></div> : <div className="flex-1 grid place-items-center text-slate-500 font-bold">🔒 Khusus Admin</div>)
            : rute === 'pengguna' ? (sesi.peran === 'admin' ? <div className="flex-1 overflow-y-auto"><PenggunaPage /></div> : <div className="flex-1 grid place-items-center text-slate-500 font-bold">🔒 Khusus Admin</div>)
            : rute === 'diag' ? (sesi.peran === 'admin' ? <div className="flex-1 overflow-y-auto"><DiagPage /></div> : <div className="flex-1 grid place-items-center text-slate-500 font-bold">🔒 Khusus Admin</div>)
            : rute === 'pengaturan' ? (sesi.peran === 'admin' ? <div className="flex-1 overflow-y-auto"><PengaturanPage /></div> : <div className="flex-1 grid place-items-center text-slate-500 font-bold">🔒 Khusus Admin</div>)
            : rute === 'cetak' ? (
            sesi.peran === 'admin' || sesi.peran === 'ketrom' ? <div className="flex-1 overflow-y-auto"><CetakPage /></div>
            : <div className="flex-1 grid place-items-center text-slate-500 font-bold">🔒 Khusus Admin / KaRom</div>
          ) : (
          <>
          {/* RESPONSIF: HP = peta setengah layar di atas + panel bawah; tablet/PC = grid 2 kolom */}
          <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-rows-[minmax(0,1fr)] md:grid-cols-[380px_1fr] lg:grid-cols-[420px_1fr]">
            <MapView />
            <section className="order-2 md:order-1 p-3 space-y-3 overflow-y-auto flex-1 min-h-0 md:max-h-none md:border-r md:border-slate-200">
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
                        <>
                          <button className="btn btn-muda !min-h-[42px] !px-3 !text-[12px]" title="Ganti nama"
                                  onClick={() => gantiNamaTitik(t)}>✏️</button>
                          <button className="btn btn-emas !min-h-[42px] !px-3 !text-[12px]"
                                  onClick={async () => { await api('/api/titik?id=' + encodeURIComponent(t.id), { method: 'DELETE' }); muat(); tampilToast('🗑️ Titik dihapus'); }}>🗑️</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="kartu p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[12px] font-extrabold uppercase tracking-wide text-hijau">Jamaah — posisi terkini</h2>
                  {(state?.jamaah || []).some(m => m.punya_gelang && m.beacon_id) && (
                    <button className="btn btn-emas !min-h-[34px] !px-3 !text-[11.5px] shrink-0" disabled={beepBusy} onClick={bunyiSemua} title="Bunyikan semua tag regu yang dalam jangkauan (±10-25 m)">🔊 Bunyi Semua</button>
                  )}
                </div>
                {beepStatus && <p className="text-[11.5px] text-slate-600 font-bold mt-1.5">{beepStatus}</p>}
                <div className="mt-2 space-y-2">
                  {(state?.jamaah || []).map(m => (
                    <div key={m.id} className="flex items-center gap-3 border border-slate-200 rounded-xl p-2.5">
                      {m.foto
                        ? <img src={m.foto} alt="" className="w-11 h-11 rounded-xl object-cover" />
                        : <div className="w-11 h-11 rounded-xl bg-emerald-50 text-hijau grid place-items-center font-extrabold">{(m.nama || '?').replace(/^(H\.|Hj\.)\s*/, '').split(' ').slice(0, 2).map(x => x[0]).join('')}</div>}
                      <div className="flex-1 min-w-0">
                        <b className="text-[13.5px] block truncate">{m.nama}</b>
                        {(() => {
                          const menit = m.posisi ? Math.max(0, Math.round((Date.now() - new Date(m.posisi.waktu)) / 60000)) : null;
                          const lamaTakTerlihat = m.punya_gelang && menit != null && menit > 30;
                          return <>
                            {lamaTakTerlihat && <small className="text-merah font-extrabold text-[11px] block">⌚ 30+ menit tak terlihat — periksa!</small>}
                            <small className="text-slate-500 text-[11.5px]">
                              {m.posisi
                                ? `${m.punya_gelang && !m.punya_hp ? 'terlihat ' + menit + ' mnt lalu ⌚' : new Date(m.posisi.waktu).toLocaleTimeString('id-ID') + ' · ' + (m.posisi.sumber === 'sos' ? '🆘' : m.posisi.sumber === 'checkin' ? '📲' : m.posisi.sumber === 'ble' ? '⌚' : '📡')}${m.titik ? ' · di ' + m.titik : ' · di luar titik'}`
                                : 'belum ada data'}
                            </small>
                          </>;
                        })()}
                      </div>
                      <div className="flex gap-1.5">
                        {m.punya_gelang && m.punya_gelang && (
                          <a className="btn btn-merah !min-h-[38px] !px-3 !text-[11.5px] animate-pulse" href={'#/radar?cari=' + encodeURIComponent(m.id)} title="Cari jamaah ini">🔍</a>
                        )}
                        {m.punya_gelang && m.beacon_id && <button className="btn btn-utama !min-h-[38px] !px-3 !text-[11.5px]" disabled={beepBusy} title="Bunyikan iTag jamaah ini (tag bunyi saat tersambung)" onClick={() => bunyiJamaah(m)}>🔊</button>}
                        {sesi && ['admin', 'ketrom', 'ketua-regu'].includes(sesi.peran) && <a className="btn btn-emas !min-h-[38px] !px-3 !text-[11.5px]" href={'#/radar?pasang=' + encodeURIComponent(m.id)} title="Pasangkan gelang BLE (di HP ini, utk regu sendiri)">⌚</a>}
                        <a className="btn btn-muda !min-h-[38px] !px-3 !text-[11.5px]" href={'#/kartu/' + encodeURIComponent(m.id)}>🪪</a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="kartu p-4">
                <h2 className="text-[12px] font-extrabold uppercase tracking-wide text-hijau">🔔 Kejadian terbaru</h2>
                <div className="mt-2 text-[12.5px] leading-relaxed">
                  {(state?.kejadian || []).slice(0, 10).map(k => (
                    <div key={k.id} className="border-b border-dashed border-slate-200 py-1.5 last:border-0">
                      {{sos:'🆘',checkin:'📲',masuk_titik:'📍'}[k.tipe] || '•'} <b>{k.nama || ''}</b> — {k.keterangan}
                      <small className="text-slate-400 block">{new Date(k.waktu).toLocaleTimeString('id-ID')}</small>
                    </div>
                  ))}
                  {(!state?.kejadian || state.kejadian.length === 0) && <p className="text-slate-500">Belum ada kejadian.</p>}
                </div>
              </div>
            </section>
          </div>

          </>
          )}
          <Drawer open={drawer} onClose={() => setDrawer(false)} onKeluar={keluar} sesi={sesi} rute={ruteBersih} />
          <Toast toast={toast} />
        </div>
      )}
    </Ctx.Provider>
  );
}
