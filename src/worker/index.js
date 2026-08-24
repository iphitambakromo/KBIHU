/* IPHI worker — router API fase 1: auth, state, titik (kumpul/tujuan).
   Prinsip desain: peta selalu GPS pengguna; titik ditempel/diseret; DB memegang pengetahuan. */
import { seed, skema, buatSandi, tokenAcak, idAcak, nowISO, jarakM } from './db.js';

const JSON_HDR = { 'content-type': 'application/json; charset=utf-8' };
const j = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HDR });

async function catatGalat(DB, request, pesan) {
  try {
    const u = new URL(request.url);
    await DB.prepare('INSERT INTO galat (waktu, path, metode, pesan) VALUES (?,?,?,?)')
      .bind(nowISO(), u.pathname, request.method, String(pesan).slice(0, 500)).run();
  } catch (e) {}
}

async function auth(req, DB) {
  const h = req.headers.get('authorization') || '';
  const token = h.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const row = await DB.prepare('SELECT * FROM token WHERE token=?').bind(token).first();
  if (!row) return null;
  if (row.expires && new Date(row.expires) < new Date()) {
    await DB.prepare('DELETE FROM token WHERE token=?').bind(token).run();
    return null;
  }
  return await DB.prepare('SELECT * FROM users WHERE id=? AND aktif=1').bind(row.user_id).first();
}

async function tangani(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const DB = env.DB;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

  /* ---------- SEED (idempoten) ---------- */
  if (path === '/api/seed' && method === 'POST') { await seed(DB); return j({ ok: true }); }

  /* ---------- AUTH ---------- */
  if (path === '/api/login' && method === 'POST') {
    await skema(DB);
    const b = await request.json().catch(() => ({}));
    const u = await DB.prepare('SELECT * FROM users WHERE username=? AND aktif=1').bind(String(b.user || '').trim()).first();
    if (!u) return j({ ok: false, error: 'nama pengguna / kata sandi salah' }, 401);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(u.salt + ':' + (b.sandi || '')));
    const cekHash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    const ok = u.sandi_hash && cekHash === u.sandi_hash;
    if (!ok) return j({ ok: false, error: 'nama pengguna / kata sandi salah' }, 401);
    const token = tokenAcak();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await DB.prepare('DELETE FROM token WHERE user_id=?').bind(u.id).run();
    await DB.prepare('INSERT INTO token (token, user_id, waktu, expires) VALUES (?,?,?,?)').bind(token, u.id, nowISO(), expires).run();
    return j({ ok: true, token, peran: u.peran, regu: u.regu || '', nama: u.nama || u.username, user: u.username,
               sandi_default: /^(123|123456)$/.test(b.sandi || '') });
  }
  if (path === '/api/logout' && method === 'POST') {
    const t = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (t) await DB.prepare('DELETE FROM token WHERE token=?').bind(t).run();
    return j({ ok: true });
  }
  const USER = await auth(request, DB);
  if (path === '/api/me' && method === 'GET') {
    if (!USER) return j({ ok: false, error: 'tidak terautentikasi' }, 401);
    return j({ ok: true, peran: USER.peran, regu: USER.regu || '', nama: USER.nama || USER.username, user: USER.username });
  }
  const tolak = () => j({ ok: false, error: 'tidak terautentikasi' }, 401);
  const bolehKelola = () => USER && ['admin', 'ketrom', 'ketua-regu'].includes(USER.peran);

  /* ---------- helper titik ---------- */
  const titikSesi = async (sesiId) =>
    (await DB.prepare('SELECT * FROM titik WHERE sesi_id=?').bind(sesiId).all()).results || [];
  const dalamTitikMana = (tk, lat, lng) => {
    let terbaik = null;
    for (const t of tk) {
      const d = jarakM(lat, lng, t.lat, t.lng);
      if (d <= t.radius && (!terbaik || d < terbaik.jarak)) terbaik = { t, jarak: Math.round(d) };
    }
    return terbaik;
  };

  /* ---------- STATE (dashboard) ---------- */
  if (path === '/api/state' && method === 'GET') {
    if (!USER) return tolak();
    let jamaah = (await DB.prepare('SELECT * FROM jamaah ORDER BY nama').all()).results || [];
    if (USER.peran === 'ketua-regu') {
      const r = (USER.regu || '').trim();
      jamaah = r ? jamaah.filter(m => String(m.regu || '').trim() === r) : [];
    }
    const sesi = (await DB.prepare("SELECT * FROM sesi WHERE tipe='tracking' AND status='aktif' ORDER BY waktu DESC LIMIT 1").first())
      || { id: 'trk1', nama: 'Tracking Rombongan' };
    const titik = (await DB.prepare('SELECT * FROM titik WHERE sesi_id=? ORDER BY waktu DESC').bind(sesi.id).all()).results || [];
    const jmFinal = [];
    for (const m of jamaah) {
      const p = (await DB.prepare('SELECT lat, lng, sumber, waktu FROM posisi WHERE jamaah_id=? ORDER BY id DESC LIMIT 1').bind(m.id).first());
      const dm = p ? dalamTitikMana(titik, p.lat, p.lng) : null;
      jmFinal.push({ ...m, punya_hp: !!m.punya_hp, punya_gelang: !!m.punya_gelang,
        posisi: p ? { lat: p.lat, lng: p.lng, sumber: p.sumber, waktu: p.waktu } : null,
        titik: dm ? dm.t.nama : null });
    }
    const kejadian = (await DB.prepare('SELECT k.*, j.nama FROM kejadian k LEFT JOIN jamaah j ON j.id=k.jamaah_id WHERE k.sesi_id=? ORDER BY k.id DESC LIMIT 20').bind(sesi.id).all()).results || [];
    return j({ ok: true, sesi, titik, jamaah: jmFinal,
      stat: { total: jamaah.length, gelang: jamaah.filter(m => m.punya_gelang).length },
      kejadian,
      anda: { peran: USER.peran, nama: USER.nama || USER.username, regu: USER.regu || '' } });
  }

  /* ---------- TITIK (kumpul / tujuan) ---------- */
  if (path === '/api/titik' && method === 'GET') {
    if (!USER) return tolak();
    const sesiId = url.searchParams.get('sesi') || 'trk1';
    const rows = (await DB.prepare('SELECT * FROM titik WHERE sesi_id=? ORDER BY waktu DESC').bind(sesiId).all()).results || [];
    return j({ ok: true, titik: rows });
  }
  if (path === '/api/titik' && method === 'POST') {
    if (!bolehKelola()) return USER ? j({ ok: false, error: 'hanya Admin / KaRu / KaRom' }, 403) : tolak();
    const b = await request.json().catch(() => ({}));
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return j({ ok: false, error: 'koordinat diperlukan' }, 400);
    const id = idAcak('tk');
    const nama = String(b.nama || `Titik Kumpul ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`).slice(0, 60);
    const radius = Number.isFinite(Number(b.radius)) && Number(b.radius) >= 20 ? Math.round(Number(b.radius)) : 100;
    await DB.prepare('INSERT INTO titik (id, sesi_id, nama, tipe, lat, lng, radius, warna, dibuat_oleh, waktu) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, b.sesiId || 'trk1', nama, b.tipe === 'tujuan' ? 'tujuan' : 'kumpul', b.lat, b.lng, radius, b.warna || '#0E7490', USER.username, nowISO()).run();
    await DB.prepare('INSERT INTO kalibrasi (waktu, jenis, ref_id, nama, lat, lng, radius, sumber, oleh) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(nowISO(), 'titik', id, nama, b.lat, b.lng, radius, b.sumber || 'cepat', USER.username).run();
    const t = await DB.prepare('SELECT * FROM titik WHERE id=?').bind(id).first();
    return j({ ok: true, titik: t });
  }
  if (path === '/api/titik' && method === 'PUT') {
    if (!bolehKelola()) return USER ? j({ ok: false, error: 'hanya Admin / KaRu / KaRom' }, 403) : tolak();
    const b = await request.json().catch(() => ({}));
    const t = await DB.prepare('SELECT * FROM titik WHERE id=?').bind(String(b.id || '')).first();
    if (!t) return j({ ok: false, error: 'titik tidak ditemukan' }, 404);
    const val = (k, def) => b[k] === undefined ? (t[k] ?? def) : b[k];
    await DB.prepare('UPDATE titik SET nama=?, tipe=?, lat=?, lng=?, radius=? WHERE id=?')
      .bind(String(val('nama')).slice(0, 60), val('tipe'), val('lat'), val('lng'),
            Number.isFinite(Number(val('radius'))) && Number(val('radius')) >= 20 ? Math.round(Number(val('radius'))) : t.radius, t.id).run();
    await DB.prepare('INSERT INTO kalibrasi (waktu, jenis, ref_id, nama, lat, lng, radius, sumber, oleh) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(nowISO(), 'titik', t.id, val('nama'), val('lat'), val('lng'), val('radius'), b.sumber || 'seret', USER.username).run();
    return j({ ok: true, titik: await DB.prepare('SELECT * FROM titik WHERE id=?').bind(t.id).first() });
  }
  if (path === '/api/titik' && method === 'DELETE') {
    if (!bolehKelola()) return USER ? j({ ok: false, error: 'hanya Admin / KaRu / KaRom' }, 403) : tolak();
    const id = url.searchParams.get('id') || '';
    await DB.prepare('DELETE FROM titik WHERE id=?').bind(id).run();
    return j({ ok: true });
  }


  /* ---------- PUBLIK: kartu jamaah, check-in, SOS ---------- */
  const waKetua = async (regu) => {
    const r = String(regu || '').trim();
    let u = r ? await DB.prepare("SELECT wa, nama FROM users WHERE peran='ketua-regu' AND regu=? AND wa != '' LIMIT 1").bind(r).first() : null;
    if (!u) u = await DB.prepare("SELECT wa, nama FROM users WHERE peran='ketrom' AND wa != '' LIMIT 1").first();
    if (!u) u = await DB.prepare("SELECT wa, nama FROM users WHERE peran='admin' AND wa != '' LIMIT 1").first();
    return u || null;
  };
  if (path.startsWith('/api/pub/jamaah/') && method === 'GET') {
    const id = decodeURIComponent(path.split('/')[4] || '');
    const m = await DB.prepare('SELECT * FROM jamaah WHERE id=?').bind(id).first();
    if (!m) return j({ ok: false, error: 'jamaah tidak ditemukan' }, 404);
    const wk = await waKetua(m.regu);
    const ev = await DB.prepare('SELECT id, nama, titik_id FROM absensi_event WHERE ditutup=0 ORDER BY waktu DESC LIMIT 1').first();
    let titikAcara = null;
    if (ev && ev.titik_id) titikAcara = await DB.prepare('SELECT * FROM titik WHERE id=?').bind(ev.titik_id).first();
    return j({ ok: true, jamaah: { id: m.id, nama: m.nama, regu: m.regu, hotel: m.hotel, umur: m.umur, foto: m.foto,
      punya_hp: !!m.punya_hp, punya_gelang: !!m.punya_gelang, catatan: m.catatan },
      waKetua: wk ? wk.wa : '', waKetuaNama: wk ? wk.nama : '', acara: ev ? { id: ev.id, nama: ev.nama, titik: titikAcara } : null });
  }

  async function catatPosisi(DB2, jamaahId, lat, lng, sumber) {
    const sesi = await DB2.prepare("SELECT id FROM sesi WHERE tipe='tracking' AND status='aktif' ORDER BY waktu DESC LIMIT 1").first();
    const sesiId = sesi ? sesi.id : 'trk1';
    await DB2.prepare('INSERT INTO posisi (sesi_id, jamaah_id, lat, lng, akurasi, sumber, waktu) VALUES (?,?,?,?,?,?,?)')
      .bind(sesiId, jamaahId, lat, lng, 20, sumber, nowISO()).run();
    const tk = await titikSesi(sesiId);
    const dm = dalamTitikMana(tk, lat, lng);
    const kej = [];
    if (sumber === 'sos') kej.push(['sos', dm ? dm.t.nama : null, 'Tombol SOS ditekan jamaah']);
    if (sumber === 'checkin') kej.push(['checkin', dm ? dm.t.nama : null, dm ? 'Check-in di ' + dm.t.nama : 'Check-in (di luar titik)']);
    if (dm) kej.push(['masuk_titik', dm.t.nama, 'Terdeteksi di titik ' + dm.t.nama]);
    for (const k of kej) {
      await DB2.prepare('INSERT INTO kejadian (sesi_id, jamaah_id, tipe, zona_titik, keterangan, waktu) VALUES (?,?,?,?,?,?)')
        .bind(sesiId, jamaahId, k[0], k[1], k[2], nowISO()).run();
    }
    return { titik: dm ? dm.t.nama : null, jarak: dm ? dm.jarak : null };
  }

  if (path === '/api/pub/checkin' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const m = await DB.prepare('SELECT * FROM jamaah WHERE id=?').bind(String(b.jamaahId || '')).first();
    if (!m) return j({ ok: false, error: 'jamaah tidak dikenali' }, 404);
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return j({ ok: false, error: 'aktifkan GPS' }, 400);
    const r = await catatPosisi(DB, m.id, b.lat, b.lng, 'checkin');
    const wk = await waKetua(m.regu);
    // absensi: bila ada acara aktif dgn titik -> hadir bila masuk radius titik acara
    let absensi = null;
    const ev = await DB.prepare('SELECT * FROM absensi_event WHERE ditutup=0 ORDER BY waktu DESC LIMIT 1').first();
    if (ev) {
      const tt = await DB.prepare('SELECT * FROM titik WHERE id=?').bind(ev.titik_id || '').first();
      const d = tt ? jarakM(b.lat, b.lng, tt.lat, tt.lng) : Infinity;
      if (tt && d <= tt.radius) {
        await DB.prepare('INSERT OR IGNORE INTO absensi (event_id, jamaah_id, status, sumber, lat, lng, waktu, oleh) VALUES (?,?,?,?,?,?,?,?)')
          .bind(ev.id, m.id, 'hadir', 'checkin', b.lat, b.lng, nowISO(), 'kartu').run();
        absensi = { hadir: true, acara: ev.nama, titik: tt.nama };
      } else if (tt) {
        absensi = { hadir: false, acara: ev.nama, titik: tt.nama, sisaMeter: Math.round(d - tt.radius) };
      }
    }
    return j({ ok: true, jamaah: m.nama, titik: r.titik, waKetua: wk ? wk.wa : '', waKetuaNama: wk ? wk.nama : '', absensi });
  }

  if (path === '/api/pub/sos' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const m = await DB.prepare('SELECT * FROM jamaah WHERE id=?').bind(String(b.jamaahId || '')).first();
    if (!m) return j({ ok: false, error: 'jamaah tidak dikenali' }, 404);
    const lat = Number.isFinite(b.lat) ? b.lat : -6.9932, lng = Number.isFinite(b.lng) ? b.lng : 110.4203;
    const r = await catatPosisi(DB, m.id, lat, lng, 'sos');
    const wk = await waKetua(m.regu);
    return j({ ok: true, jamaah: m.nama, regu: m.regu, titik: r.titik, waKetua: wk ? wk.wa : '', waKetuaNama: wk ? wk.nama : '' });
  }

  /* ---------- ABSENSI (terikat titik) ---------- */
  if (path === '/api/absensi/aktif' && method === 'GET') {
    const ev = await DB.prepare('SELECT e.id, e.nama, e.regu, e.waktu, t.nama AS titik_nama, t.lat, t.lng, t.radius FROM absensi_event e LEFT JOIN titik t ON t.id=e.titik_id WHERE e.ditutup=0 ORDER BY e.waktu DESC LIMIT 1').first();
    return j({ ok: true, event: ev || null });
  }
  if (path === '/api/absensi/event' && method === 'POST') {
    if (!USER) return tolak();
    if (!['admin', 'ketrom', 'ketua-regu'].includes(USER.peran)) return j({ ok: false, error: 'tidak diizinkan' }, 403);
    const b = await request.json().catch(() => ({}));
    // tutup acara lain yang masih terbuka (satu acara aktif agar check-in tak ambigu)
    await DB.prepare('UPDATE absensi_event SET ditutup=1 WHERE ditutup=0').run();
    const regu = USER.peran === 'ketua-regu' ? (USER.regu || '') : String(b.regu || '');
    const id = idAcak('ab');
    const nama = String(b.nama || 'Absensi ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })).slice(0, 80);
    await DB.prepare('INSERT INTO absensi_event (id, nama, titik_id, sesi_id, regu, waktu, ditutup, oleh) VALUES (?,?,?,?,?,?,0,?)')
      .bind(id, nama, String(b.titikId || ''), 'trk1', regu, nowISO(), USER.username).run();
    return j({ ok: true, id, nama });
  }
  if (path === '/api/absensi/tutup' && method === 'POST') {
    if (!USER) return tolak();
    const b = await request.json().catch(() => ({}));
    await DB.prepare('UPDATE absensi_event SET ditutup=1 WHERE id=?').bind(String(b.id || '')).run();
    return j({ ok: true });
  }
  if (path === '/api/absensi/event' && method === 'GET') {
    if (!USER) return tolak();
    let rows = (await DB.prepare('SELECT e.*, t.nama AS titik_nama FROM absensi_event e LEFT JOIN titik t ON t.id=e.titik_id ORDER BY e.waktu DESC LIMIT 30').all()).results || [];
    if (USER.peran === 'ketua-regu') { const r = (USER.regu || '').trim(); rows = rows.filter(e => !e.regu || e.regu === r); }
    const out = [];
    for (const e of rows) {
      const c = (await DB.prepare("SELECT COUNT(*) n FROM absensi WHERE event_id=? AND status='hadir'").bind(e.id).first()).n;
      out.push({ ...e, hadir: c });
    }
    return j({ ok: true, events: out });
  }
  if (path === '/api/absensi/hadir' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const ev = await DB.prepare('SELECT * FROM absensi_event WHERE id=? AND ditutup=0').bind(String(b.eventId || '')).first();
    if (!ev) return j({ ok: false, error: 'tidak ada acara aktif' }, 404);
    const m = b.jamaahId ? await DB.prepare('SELECT * FROM jamaah WHERE id=?').bind(String(b.jamaahId)).first() : null;
    if (!m) return j({ ok: false, error: 'jamaah tidak dikenali' }, 404);
    const status = String(b.status || 'hadir');
    if (status !== 'hadir') {
      if (!USER || !['admin', 'ketrom', 'ketua-regu'].includes(USER.peran)) return j({ ok: false, error: 'penandaan status hanya oleh ketua' }, 403);
      if (USER.peran === 'ketua-regu' && String(m.regu || '').trim() !== String(USER.regu || '').trim()) return j({ ok: false, error: 'di luar regu Anda' }, 403);
    }
    if (status === 'hadir') {
      await DB.prepare('INSERT OR IGNORE INTO absensi (event_id, jamaah_id, status, sumber, lat, lng, waktu, oleh) VALUES (?,?,?,?,?,?,?,?)')
        .bind(ev.id, m.id, 'hadir', b.sumber || 'manual', Number.isFinite(b.lat) ? b.lat : null, Number.isFinite(b.lng) ? b.lng : null, nowISO(), USER ? USER.username : 'kartu').run();
    } else {
      await DB.prepare('INSERT INTO absensi (event_id, jamaah_id, status, sumber, waktu, oleh) VALUES (?,?,?,?,?,?) ON CONFLICT(event_id, jamaah_id) DO UPDATE SET status=excluded.status, sumber=excluded.sumber, waktu=excluded.waktu, oleh=excluded.oleh')
        .bind(ev.id, m.id, status, 'manual', nowISO(), USER.username).run();
    }
    const n = (await DB.prepare("SELECT COUNT(*) n FROM absensi WHERE event_id=? AND status='hadir'").bind(ev.id).first()).n;
    return j({ ok: true, jamaah: m.nama, status, hadir: n });
  }
  if (path === '/api/absensi/rekap' && method === 'GET') {
    if (!USER) return tolak();
    const ev = await DB.prepare('SELECT e.*, t.nama AS titik_nama, t.lat AS titik_lat, t.lng AS titik_lng, t.radius AS titik_radius FROM absensi_event e LEFT JOIN titik t ON t.id=e.titik_id WHERE e.id=?').bind(String(url.searchParams.get('event') || '')).first();
    if (!ev) return j({ ok: false, error: 'acara tidak ditemukan' }, 404);
    let ms = (await DB.prepare('SELECT * FROM jamaah ORDER BY nama').all()).results || [];
    if (ev.regu) ms = ms.filter(m => String(m.regu || '').trim() === ev.regu);
    if (USER.peran === 'ketua-regu') { const r = (USER.regu || '').trim(); ms = ms.filter(m => String(m.regu || '').trim() === r); }
    const rec = {};
    (await DB.prepare('SELECT * FROM absensi WHERE event_id=?').bind(ev.id).all()).results.forEach(x => rec[x.jamaah_id] = x);
    const rows = await Promise.all(ms.map(async m => {
      const p = (await DB.prepare('SELECT lat, lng, sumber, waktu FROM posisi WHERE jamaah_id=? ORDER BY id DESC LIMIT 1').bind(m.id).first());
      let dalam = null, sisa = null;
      if (p && ev.titik_lat != null) {
        const d = jarakM(p.lat, p.lng, ev.titik_lat, ev.titik_lng);
        dalam = d <= ev.titik_radius; sisa = Math.max(0, Math.round(d - ev.titik_radius));
      }
      return { id: m.id, nama: m.nama, regu: m.regu, punya_gelang: !!m.punya_gelang,
        status: rec[m.id] ? rec[m.id].status : null, sumber: rec[m.id] ? rec[m.id].sumber : null,
        waktu: rec[m.id] ? rec[m.id].waktu : null, terakhirPosisi: p ? p.waktu : null, dalamTitik: dalam, sisaMeter: sisa };
    }));
    return j({ ok: true, event: ev, rows, total: rows.length, hadir: rows.filter(r => r.status === 'hadir').length });
  }


  /* ---------- JAMAAH: pembaruan merge (pasangkan gelang dsb) ---------- */
  if (path === '/api/jamaah' && method === 'PUT') {
    if (!USER) return tolak();
    if (!['admin', 'ketrom', 'ketua-regu'].includes(USER.peran)) return j({ ok: false, error: 'tidak diizinkan' }, 403);
    const b = await request.json().catch(() => ({}));
    const ada = await DB.prepare('SELECT * FROM jamaah WHERE id=?').bind(String(b.id || '')).first();
    if (!ada) return j({ ok: false, error: 'jamaah tidak ditemukan' }, 404);
    if (USER.peran === 'ketua-regu' && String(ada.regu || '').trim() !== String(USER.regu || '').trim())
      return j({ ok: false, error: 'di luar regu Anda' }, 403);
    const val = (k, def = '') => b[k] === undefined ? (ada[k] ?? def) : b[k];
    await DB.prepare('UPDATE jamaah SET nama=?, paspor=?, hp=?, umur=?, regu=?, hotel=?, punya_hp=?, punya_gelang=?, beacon_id=?, catatan=?, foto=? WHERE id=?')
      .bind(String(val('nama') || 'Tanpa Nama').trim(), val('paspor'), val('hp'),
            b.umur === undefined ? (ada.umur ?? null) : (Number(b.umur) || null),
            val('regu'), val('hotel'),
            b.punya_hp === undefined ? (ada.punya_hp ?? 1) : (b.punya_hp ? 1 : 0),
            b.punya_gelang === undefined ? (ada.punya_gelang ?? 0) : (b.punya_gelang ? 1 : 0),
            val('beacon_id'), val('catatan'),
            b.foto === undefined ? (ada.foto || '') : b.foto, ada.id).run();
    return j({ ok: true, beacon_id: val('beacon_id') });
  }

  /* ---------- PUBLIK: radar BLE — lapor gelang terlihat ---------- */
  if (path === '/api/pub/ble' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    if (!b.beaconId) return j({ ok: false, error: 'beaconId wajib' }, 400);
    const m = await DB.prepare('SELECT * FROM jamaah WHERE beacon_id=?').bind(String(b.beaconId)).first();
    if (!m) return j({ ok: false, error: 'tag tidak terdaftar' }, 404);
    // koordinat radar (pelapor); fallback: titik terdekat tidak diketahui -> pakai posisi terakhir? tolak bila tak ada GPS
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return j({ ok: false, error: 'aktifkan GPS radar' }, 400);
    const r = await catatPosisi(DB, m.id, b.lat, b.lng, 'ble');
    await DB.prepare('INSERT INTO kejadian (sesi_id, jamaah_id, tipe, zona_titik, keterangan, waktu) VALUES (?,?,?,?,?,?)')
      .bind('trk1', m.id, 'ble', r.titik, `Gelang terlihat radar HP${b.oleh ? ' (' + String(b.oleh).slice(0, 40) + ')' : ''}`, nowISO()).run();
    // absensi: bila acara aktif dgn titik dan radar berada dlm radius -> jamaah hadir
    let absensi = null;
    const ev = await DB.prepare('SELECT * FROM absensi_event WHERE ditutup=0 ORDER BY waktu DESC LIMIT 1').first();
    if (ev) {
      const tt = await DB.prepare('SELECT * FROM titik WHERE id=?').bind(ev.titik_id || '').first();
      const d = tt ? jarakM(b.lat, b.lng, tt.lat, tt.lng) : Infinity;
      if (tt && d <= tt.radius) {
        await DB.prepare('INSERT OR IGNORE INTO absensi (event_id, jamaah_id, status, sumber, lat, lng, waktu, oleh) VALUES (?,?,?,?,?,?,?,?)')
          .bind(ev.id, m.id, 'hadir', 'gelang', b.lat, b.lng, nowISO(), String(b.oleh || 'radar').slice(0, 40)).run();
        absensi = { hadir: true, acara: ev.nama, titik: tt.nama };
      } else if (tt) {
        absensi = { hadir: false, acara: ev.nama, titik: tt.nama, sisaMeter: Math.round(d - tt.radius) };
      }
    }
    return j({ ok: true, jamaah: m.nama, titik: r.titik, absensi });
  }

  return j({ ok: false, error: 'endpoint tidak dikenal' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await tangani(request, env);
    } catch (e) {
      const pesan = (e && (e.message || String(e))) || 'kesalahan tak diketahui';
      try { await catatGalat(env.DB, request, pesan); } catch (_) {}
      console.error('IPHI error:', new URL(request.url).pathname, pesan);
      return j({ ok: false, error: 'server: ' + pesan }, 500);
    }
  },
};
