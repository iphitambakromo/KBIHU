/* IPHI worker — router API fase 1: auth, state, titik (kumpul/tujuan).
   Prinsip desain: peta selalu GPS pengguna; titik ditempel/diseret; DB memegang pengetahuan. */
import { seed, skema, buatSandi, tokenAcak, idAcak, nowISO, jarakM } from './db.js';
import { normMac } from '../lib/mac.js';

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
    // SOS aktif: satu query tanpa bind (menghindari bug shim D1 lokal utk query bind pada kejadian dlm request campuran; juga lebih efisien)
    const sosAktifMap = {};
    for (const r of (await DB.prepare("SELECT jamaah_id, id FROM kejadian WHERE tipe='sos' AND ditangani=0").all()).results || []) {
      if (r.jamaah_id) sosAktifMap[r.jamaah_id] = r.id;
    }
    const jmFinal = [];
    for (const m of jamaah) {
      const p = (await DB.prepare('SELECT lat, lng, sumber, waktu FROM posisi WHERE jamaah_id=? ORDER BY id DESC LIMIT 1').bind(m.id).first());
      const dm = p ? dalamTitikMana(titik, p.lat, p.lng) : null;
      const sosId = sosAktifMap[m.id] || null;
      jmFinal.push({ ...m, punya_hp: !!m.punya_hp, punya_gelang: !!m.punya_gelang,
        posisi: p ? { lat: p.lat, lng: p.lng, sumber: p.sumber, waktu: p.waktu } : null,
        titik: dm ? dm.t.nama : null,
        sosAktif: !!sosId, _sosId: sosId });
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
    const jam = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const nama = String(b.nama || (b.tipe === 'tujuan' ? `Titik Tujuan ${jam}` : `Titik Kumpul ${jam}`)).slice(0, 60);
    const radius = Number.isFinite(Number(b.radius)) && Number(b.radius) >= 20 ? Math.round(Number(b.radius)) : 100;
    await DB.prepare('INSERT INTO titik (id, sesi_id, nama, tipe, lat, lng, radius, warna, dibuat_oleh, waktu) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, b.sesiId || 'trk1', nama, b.tipe === 'tujuan' ? 'tujuan' : 'kumpul', b.lat, b.lng, radius, b.warna || (b.tipe === 'tujuan' ? '#B48A2F' : '#0E7490'), USER.username, nowISO()).run();
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

  /* auth: tandai SOS selesai (per jamaah / semua) */
  if (path === '/api/sos/selesai' && method === 'POST') {
    if (!USER) return tolak();
    if (!bolehKelola()) return j({ ok: false, error: 'hanya Admin / KaRom / KaRu' }, 403);
    const b = await request.json().catch(() => ({}));
    const tutupSatu = async (jid) => {
      const r = await DB.prepare("UPDATE kejadian SET ditangani=1 WHERE jamaah_id=? AND tipe='sos' AND ditangani=0").bind(String(jid)).run();
      return (r.meta && r.meta.changes) || 0;
    };
    let n = 0;
    if (b.jamaahId) {
      if (USER.peran === 'ketua-regu') {
        const m = await DB.prepare('SELECT regu FROM jamaah WHERE id=?').bind(String(b.jamaahId)).first();
        if (m && String(m.regu || '').trim() !== String(USER.regu || '').trim()) return j({ ok: false, error: 'di luar regu Anda' }, 403);
      }
      n = await tutupSatu(b.jamaahId);
    } else if (USER.peran === 'ketua-regu') {
      const milik = (await DB.prepare("SELECT id FROM jamaah WHERE TRIM(COALESCE(regu,''))=?").bind(String(USER.regu || '').trim()).all()).results || [];
      for (const x of milik) n += await tutupSatu(x.id);
    } else {
      const r = await DB.prepare("UPDATE kejadian SET ditangani=1 WHERE tipe='sos' AND ditangani=0").run();
      n = (r.meta && r.meta.changes) || 0;
    }
    return j({ ok: true, selesai: n });
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
  if (path === '/api/absensi/hapus' && method === 'POST') {
    if (!USER) return tolak();
    if (!['admin', 'ketrom', 'ketua-regu'].includes(USER.peran)) return j({ ok: false, error: 'tidak diizinkan' }, 403);
    const b = await request.json().catch(() => ({}));
    const ev = await DB.prepare('SELECT * FROM absensi_event WHERE id=?').bind(String(b.id || '')).first();
    if (!ev) return j({ ok: false, error: 'acara tidak ditemukan' }, 404);
    if (USER.peran === 'ketua-regu' && String(ev.regu || '').trim() !== String(USER.regu || '').trim())
      return j({ ok: false, error: 'di luar regu Anda' }, 403);
    await DB.prepare('DELETE FROM absensi WHERE event_id=?').bind(ev.id).run();
    await DB.prepare('DELETE FROM absensi_event WHERE id=?').bind(ev.id).run();
    return j({ ok: true, nama: ev.nama });
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


  /* ---------- PASANGAN MULTI-HP ---------- */
  /* beacon_id = DAFTAR kode per-HP (dipisah koma): tiap HP yang melakukan ritual pasang
     menambah kodenya (sanding_tambah) — HP lain tak tertimpa. Atap 20 kode (tertua terkasih).
     Form admin (tanpa flag) = ganti/bersihkan seluruh daftar, seperti sebelumnya. */
  const kodeBaris = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const gabungKode = (sedia, tambah, atap = 20) => {
    const out = [];
    for (const k of [...kodeBaris(tambah), ...kodeBaris(sedia)]) if (out.indexOf(k) === -1) out.push(k);
    return out.slice(0, atap).join(',');
  };

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
    // sanding_tambah (alur pasang di HP) = TAMBAH kode per-HP ke daftar (multi-HP, tak menimpa);
    // form admin (tanpa flag) = ganti/bersihkan seluruh daftar.
    const beaconAkhir = (b.sanding_tambah && String(val('beacon_id') || '').trim())
      ? gabungKode(ada.beacon_id, val('beacon_id'))
      : val('beacon_id');
    await DB.prepare('UPDATE jamaah SET nama=?, paspor=?, hp=?, umur=?, regu=?, hotel=?, punya_hp=?, punya_gelang=?, beacon_id=?, mac_tag=?, catatan=?, foto=? WHERE id=?')
      .bind(String(val('nama') || 'Tanpa Nama').trim(), val('paspor'), val('hp'),
            b.umur === undefined ? (ada.umur ?? null) : (Number(b.umur) || null),
            val('regu'), val('hotel'),
            b.punya_hp === undefined ? (ada.punya_hp ?? 1) : (b.punya_hp ? 1 : 0),
            b.punya_gelang === undefined ? (ada.punya_gelang ?? 0) : (b.punya_gelang ? 1 : 0),
            beaconAkhir, normMac(val('mac_tag')), val('catatan'),
            b.foto === undefined ? (ada.foto || '') : b.foto, ada.id).run();
    return j({ ok: true, beacon_id: beaconAkhir, mac_tag: normMac(val('mac_tag')) });
  }

  /* ---------- PUBLIK: radar BLE — lapor gelang terlihat ---------- */
  /* peta device-id -> nama jamaah (radar publik: membedakan iTag yang namanya seragam) */
  if (path === '/api/pub/gelang' && method === 'GET') {
    const rows = (await DB.prepare("SELECT beacon_id, nama, regu FROM jamaah WHERE COALESCE(punya_gelang,0)=1 AND COALESCE(beacon_id,'') != ''").all()).results || [];
    // multi-HP: tiap kode per-HP jadi entri sendiri (pencocokan tetap per-kode)
    const gelang = [];
    rows.forEach(r => kodeBaris(r.beacon_id).forEach(k => gelang.push({ mac: k, nama: r.nama, regu: r.regu || '' })));
    return j({ ok: true, gelang });
  }
  if (path === '/api/pub/ble' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const mac = normMac(b.macTag);
    const bid = String(b.beaconId || '');
    if (!mac && !bid) return j({ ok: false, error: 'macTag atau beaconId wajib' }, 400);
    // 1) MAC (identitas global dari nama siar tag) — jalan di HP mana pun, gotong royong
    let m = null;
    if (mac) m = await DB.prepare('SELECT * FROM jamaah WHERE mac_tag=?').bind(mac).first();
    // 2) ID perangkat lokal (pasang per-HP) — multi-HP: cocok bila kode ada di DAFTAR pasangan
    const semuaJm = (await DB.prepare('SELECT * FROM jamaah').all()).results || [];
    if (!m && bid) m = semuaJm.find(r => kodeBaris(r.beacon_id).includes(bid)) || null;
    // 3) legacy: NAMA siaran tag (rename iTag) — jalan lintas HP/browser; nama pabrik "iTag" dikecualikan (tidak unik)
    const nmBcast = String(b.nama || '').trim();
    if (!m && nmBcast && !/^(itag|itag\s+baru)$/i.test(nmBcast) && nmBcast !== bid)
      m = semuaJm.find(r => kodeBaris(r.beacon_id).includes(nmBcast)) || null;
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

  /* publik: simpan posisi background tracking */
  if (path === '/api/pub/posisi' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return j({ ok: false, error: 'koordinat diperlukan' }, 400);
    
    // Simpan posisi ke tabel posisi (tanpa jamaah_id, untuk tracking umum)
    await DB.prepare('INSERT INTO posisi (sesi_id, jamaah_id, lat, lng, akurasi, sumber, waktu) VALUES (?,?,?,?,?,?,?)')
      .bind('trk1', 'background', b.lat, b.lng, b.akurasi || 20, 'background', nowISO()).run();
    
    return j({ ok: true });
  }

  /* publik: ambil riwayat posisi */
  if (path === '/api/pub/riwayat-posisi' && method === 'GET') {
    const limit = Number(url.searchParams.get('limit')) || 100;
    const rows = (await DB.prepare('SELECT * FROM posisi WHERE jamaah_id=? ORDER BY id DESC LIMIT ?').bind('background', limit).all()).results || [];
    return j({ ok: true, posisi: rows });
  }

  /* publik: daftar MAC gelang terdaftar — identitas global untuk gotong royong */
  if (path === '/api/pub/mac' && method === 'GET') {
    const rows = (await DB.prepare("SELECT id, nama, regu, mac_tag FROM jamaah WHERE mac_tag IS NOT NULL AND mac_tag != '' ORDER BY nama").all()).results || [];
    return j({ ok: true, daftar: rows });
  }

  /* publik: seluruh jamaah + daftar sandi per-HP + MAC — untuk Mode Kawal & lookup lintas HP */
  if (path === '/api/pub/kawal' && method === 'GET') {
    const rows = (await DB.prepare("SELECT id, nama, regu, punya_gelang, beacon_id, mac_tag FROM jamaah ORDER BY regu, nama").all()).results || [];
    return j({ ok: true, daftar: rows.map(r => ({ id: r.id, nama: r.nama, regu: r.regu || '', punya_gelang: !!r.punya_gelang, beacon_id: r.beacon_id || '', mac_tag: r.mac_tag || '' })) });
  }


  /* ---------- LATIHAN MANDIRI ---------- */
  const jamaahByToken = async (tok) => {
    if (!tok) return null;
    return await DB.prepare('SELECT * FROM jamaah WHERE latihan_token=?').bind(String(tok)).first();
  };
  const progresJamaah = async (jid) => {
    const rows = (await DB.prepare('SELECT ritual, SUM(jarak_m) m, COUNT(*) n FROM latihan WHERE jamaah_id=? GROUP BY ritual').bind(jid).all()).results || [];
    const per = {}; rows.forEach(r => { if (r.ritual != null) per[r.ritual] = { meter: Math.round(r.m || 0), sesi: r.n }; });
    const total = (await DB.prepare('SELECT SUM(jarak_m) m, COUNT(*) n FROM latihan WHERE jamaah_id=?').bind(jid).first());
    return { per, meter: Math.round(total.m || 0), sesi: total.n || 0 };
  };
  const totalTarget = async () => {
    const t = (await DB.prepare('SELECT SUM(target_m) t FROM target_ritual').first());
    return t.t || 0;
  };

  /* publik: profil latihan + riwayat (via tautan pribadi) */
  if (path.startsWith('/api/pub/latihan/') && method === 'GET') {
    const tok = decodeURIComponent(path.split('/')[4] || '');
    const m = await jamaahByToken(tok);
    if (!m) return j({ ok: false, error: 'tautan tidak valid' }, 404);
    const target = (await DB.prepare('SELECT * FROM target_ritual ORDER BY urutan').all()).results || [];
    const riwayat = (await DB.prepare('SELECT * FROM latihan WHERE jamaah_id=? ORDER BY id DESC LIMIT 60').bind(m.id).all()).results || [];
    return j({ ok: true, jamaah: { id: m.id, nama: m.nama, regu: m.regu, hotel: m.hotel, umur: m.umur }, target, riwayat, progres: await progresJamaah(m.id), totalTarget: await totalTarget() });
  }
  /* publik: catat hasil (tahan offline: checkpoint & akhir sesi) */
  if (path === '/api/pub/latihan' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const m = await jamaahByToken(String(b.token || ''));
    if (!m) return j({ ok: false, error: 'tautan tidak valid' }, 404);
    const ritual = Number.isFinite(Number(b.ritual)) ? Math.round(Number(b.ritual)) : null;
    await DB.prepare('INSERT INTO latihan (jamaah_id, ritual, jarak_m, durasi_s, aktif_s, selesai, waktu) VALUES (?,?,?,?,?,?,?)')
      .bind(m.id, ritual, Math.max(0, Math.round(Number(b.jarakM) || 0)), Math.round(Number(b.durasiS) || 0), Math.round(Number(b.aktifS) || 0), b.selesai ? 1 : 0, nowISO()).run();
    return j({ ok: true, progres: await progresJamaah(m.id) });
  }
  /* publik: reset sendiri */
  if (path === '/api/pub/latihan/reset' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const m = await jamaahByToken(String(b.token || ''));
    if (!m) return j({ ok: false, error: 'tautan tidak valid' }, 404);
    const r = await DB.prepare('DELETE FROM latihan WHERE jamaah_id=?').bind(m.id).run();
    return j({ ok: true, terhapus: (r && r.meta && r.meta.changes) || 0 });
  }
  /* auth: buat/bagikan tautan latihan */
  if (path === '/api/latihan/link' && method === 'POST') {
    if (!USER) return tolak();
    if (!['admin', 'ketrom'].includes(USER.peran)) return j({ ok: false, error: 'khusus Admin / KaRom' }, 403);
    const b = await request.json().catch(() => ({}));
    const m = await DB.prepare('SELECT * FROM jamaah WHERE id=?').bind(String(b.jamaahId || '')).first();
    if (!m) return j({ ok: false, error: 'jamaah tidak ditemukan' }, 404);
    let tok = m.latihan_token;
    if (!tok) {
      tok = 'lt_' + [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
      await DB.prepare('UPDATE jamaah SET latihan_token=? WHERE id=?').bind(tok, m.id).run();
    }
    return j({ ok: true, url: new URL(request.url).origin + '/#/latihan/' + encodeURIComponent(tok), nama: m.nama });
  }
  /* auth: papan progres seluruh jamaah */
  if (path === '/api/latihan/progres' && method === 'GET') {
    if (!USER) return tolak();
    let ms = (await DB.prepare('SELECT * FROM jamaah ORDER BY nama').all()).results || [];
    if (USER.peran === 'ketua-regu') { const r = (USER.regu || '').trim(); ms = r ? ms.filter(x => String(x.regu || '').trim() === r) : []; }
    const target = (await DB.prepare('SELECT * FROM target_ritual ORDER BY urutan').all()).results || [];
    const totTarget = await totalTarget();
    const rows = [];
    for (const m of ms) {
      const pr = await progresJamaah(m.id);
      rows.push({ id: m.id, nama: m.nama, regu: m.regu, punya_gelang: !!m.punya_gelang, punya_hp: !!m.punya_hp,
        meter: pr.meter, sesi: pr.sesi, perRitual: pr.per, siap: pr.meter >= 0.8 * totTarget });
    }
    return j({ ok: true, rows, target, totalTarget: totTarget, siapPada: Math.round(0.8 * totTarget) });
  }
  /* auth: reset per jamaah oleh ketua */
  if (path === '/api/latihan/reset' && method === 'POST') {
    if (!USER) return tolak();
    if (!['admin', 'ketrom', 'ketua-regu'].includes(USER.peran)) return j({ ok: false, error: 'tidak diizinkan' }, 403);
    const b = await request.json().catch(() => ({}));
    const m = await DB.prepare('SELECT * FROM jamaah WHERE id=?').bind(String(b.jamaahId || '')).first();
    if (!m) return j({ ok: false, error: 'jamaah tidak ditemukan' }, 404);
    if (USER.peran === 'ketua-regu' && String(m.regu || '').trim() !== String(USER.regu || '').trim()) return j({ ok: false, error: 'di luar regu Anda' }, 403);
    const r = await DB.prepare('DELETE FROM latihan WHERE jamaah_id=?').bind(m.id).run();
    return j({ ok: true, terhapus: (r && r.meta && r.meta.changes) || 0 });
  }


  /* ---------- KELOLA JAMAAH (admin) ---------- */
  if (path === '/api/jamaah' && method === 'GET') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const rows = (await DB.prepare('SELECT * FROM jamaah ORDER BY nama').all()).results || [];
    return j({ ok: true, jamaah: rows });
  }
  if (path === '/api/jamaah' && method === 'POST') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const b = await request.json().catch(() => ({}));
    if (!b.nama || !String(b.nama).trim()) return j({ ok: false, error: 'nama wajib' }, 400);
    const id = idAcak('jm');
    await DB.prepare('INSERT INTO jamaah (id, nama, paspor, hp, umur, regu, hotel, punya_hp, punya_gelang, beacon_id, mac_tag, catatan, foto) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, String(b.nama).trim(), b.paspor || '', b.hp || '', Number(b.umur) || null, b.regu || '', b.hotel || '',
            b.punya_hp ? 1 : 0, b.punya_gelang ? 1 : 0, b.beacon_id || '', normMac(b.mac_tag), b.catatan || '', b.foto || '').run();
    return j({ ok: true, id });
  }
  if (path === '/api/jamaah' && method === 'DELETE') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const id = url.searchParams.get('id') || '';
    await DB.batch([
      DB.prepare('DELETE FROM jamaah WHERE id=?').bind(id),
      DB.prepare('DELETE FROM posisi WHERE jamaah_id=?').bind(id),
      DB.prepare('DELETE FROM kejadian WHERE jamaah_id=?').bind(id),
      DB.prepare('DELETE FROM absensi WHERE jamaah_id=?').bind(id),
      DB.prepare('DELETE FROM latihan WHERE jamaah_id=?').bind(id),
    ]);
    return j({ ok: true });
  }
  if (path === '/api/jamaah/impor' && method === 'POST') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const b = await request.json().catch(() => ({}));
    const baris = (b.rows || []).filter(r => String(r[0] || '').trim());
    if (!baris.length) return j({ ok: false, error: 'tidak ada baris' }, 400);
    let sukses = 0; const gagal = [];
    for (let i = 0; i < baris.length; i++) {
      const r = baris[i];
      const nama = String(r[0] || '').trim();
      if (!nama) { gagal.push('baris ' + (i + 1) + ': nama kosong'); continue; }
      const beacon = String(r[5] || '').trim();
      const punyaHP = /^(ya|hp|1|true)$/i.test(String(r[4] == null ? 'ya' : r[4]));
      await DB.prepare('INSERT INTO jamaah (id, nama, paspor, hp, umur, regu, hotel, punya_hp, punya_gelang, beacon_id, catatan) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(idAcak('jm'), nama, String(r[1] || '').trim(), String(r[2] || '').trim(), Number(r[3]) || null,
              b.regu || '', b.hotel || '', punyaHP ? 1 : 0, beacon ? 1 : 0, beacon, String(r[6] || '').trim()).run();
      sukses++;
    }
    return j({ ok: true, sukses, gagal });
  }

  /* ---------- PENGGUNA (admin) ---------- */
  if (path === '/api/users' && method === 'GET') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const rows = (await DB.prepare('SELECT id, username, nama, peran, regu, wa, foto, aktif FROM users ORDER BY peran, username').all()).results || [];
    return j({ ok: true, users: rows });
  }
  if (path === '/api/users' && method === 'POST') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const b = await request.json().catch(() => ({}));
    if (!b.username || !b.sandi || !b.peran) return j({ ok: false, error: 'username, sandi, peran wajib' }, 400);
    const ada = await DB.prepare('SELECT id FROM users WHERE username=?').bind(String(b.username).trim()).first();
    if (ada) return j({ ok: false, error: 'username sudah dipakai' }, 400);
    const sc = await buatSandi(String(b.sandi));
    await DB.prepare('INSERT INTO users (id, username, sandi_hash, salt, nama, peran, regu, wa, foto, aktif) VALUES (?,?,?,?,?,?,?,?,?,1)')
      .bind(idAcak('u'), String(b.username).trim(), sc.hash, sc.salt, b.nama || '', b.peran, b.peran === 'ketua-regu' ? (b.regu || '') : '', b.wa || '', b.foto || '').run();
    return j({ ok: true });
  }
  if (path === '/api/users' && method === 'PUT') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const b = await request.json().catch(() => ({}));
    const u = await DB.prepare('SELECT * FROM users WHERE id=?').bind(String(b.id || '')).first();
    if (!u) return j({ ok: false, error: 'pengguna tidak ditemukan' }, 404);
    if (b.sandi) { const sc = await buatSandi(String(b.sandi)); await DB.prepare('UPDATE users SET sandi_hash=?, salt=? WHERE id=?').bind(sc.hash, sc.salt, u.id).run(); }
    await DB.prepare('UPDATE users SET nama=?, peran=?, regu=?, wa=?, foto=?, aktif=? WHERE id=?')
      .bind(b.nama !== undefined ? b.nama : u.nama, b.peran || u.peran,
            (b.peran || u.peran) === 'ketua-regu' ? (b.regu !== undefined ? b.regu : u.regu) : '',
            b.wa !== undefined ? b.wa : u.wa, b.foto === undefined ? (u.foto || '') : b.foto, b.aktif === undefined ? u.aktif : (b.aktif ? 1 : 0), u.id).run();
    if (b.aktif === 0) await DB.prepare('DELETE FROM token WHERE user_id=?').bind(u.id).run();
    return j({ ok: true });
  }
  if (path === '/api/users' && method === 'DELETE') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const id = url.searchParams.get('id') || '';
    if (id === 'u_admin') return j({ ok: false, error: 'akun admin utama tidak dapat dihapus' }, 400);
    await DB.batch([DB.prepare('DELETE FROM users WHERE id=?').bind(id), DB.prepare('DELETE FROM token WHERE user_id=?').bind(id)]);
    return j({ ok: true });
  }

  /* ---------- DIAGNOSTIK (admin) ---------- */
  if (path === '/api/diag' && method === 'GET') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const galat = (await DB.prepare('SELECT * FROM galat ORDER BY id DESC LIMIT 50').all()).results || [];
    const stat = {};
    for (const t of ['jamaah', 'titik', 'posisi', 'kejadian', 'absensi_event', 'latihan', 'users']) {
      stat[t] = (await DB.prepare(`SELECT COUNT(*) c FROM ${t}`).first()).c;
    }
    return j({ ok: true, galat, stat });
  }
  if (path === '/api/diag/clear' && method === 'POST') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    await DB.prepare('DELETE FROM galat').run();
    return j({ ok: true });
  }


  /* ---------- REFERENSI REGU (Pengaturan) ---------- */
  const daftarReguRef = async () => {
    const ref = (await DB.prepare('SELECT * FROM regu_ref ORDER BY urutan, nama').all()).results || [];
    if (ref.length) return ref;
    // fallback bila referensi belum terisi: kumpulkan dari data
    const set = new Set();
    (await DB.prepare("SELECT DISTINCT regu FROM jamaah WHERE TRIM(COALESCE(regu,'')) != ''").all()).results.forEach(r => set.add(r.regu.trim()));
    (await DB.prepare("SELECT DISTINCT regu FROM users WHERE TRIM(COALESCE(regu,'')) != ''").all()).results.forEach(r => set.add(r.regu.trim()));
    return [...set].sort().map((nama, i) => ({ id: 'rg' + i, nama, urutan: i }));
  };
  if (path === '/api/regu' && method === 'GET') {
    if (!USER) return tolak();
    const ref = await daftarReguRef();
    return j({ ok: true, regu: ref.map(r => r.nama) });
  }
  if (path === '/api/pengaturan/regu' && method === 'GET') {
    if (!USER) return tolak();
    const ref = await daftarReguRef();
    const out = [];
    for (const r of ref) {
      const jm = (await DB.prepare('SELECT COUNT(*) c FROM jamaah WHERE TRIM(COALESCE(regu,\'\'))=?').bind(r.nama).first()).c;
      const us = (await DB.prepare('SELECT COUNT(*) c FROM users WHERE TRIM(COALESCE(regu,\'\'))=?').bind(r.nama).first()).c;
      out.push({ ...r, jamaah: jm, users: us });
    }
    return j({ ok: true, regu: out });
  }
  if (path === '/api/pengaturan/regu' && method === 'POST') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const b = await request.json().catch(() => ({}));
    const nama = String(b.nama || '').trim();
    if (!nama) return j({ ok: false, error: 'nama regu wajib' }, 400);
    const ada = await DB.prepare('SELECT id FROM regu_ref WHERE nama=?').bind(nama).first();
    if (ada) return j({ ok: false, error: 'nama regu sudah ada' }, 400);
    const maks = (await DB.prepare('SELECT COALESCE(MAX(urutan),0) m FROM regu_ref').first()).m;
    await DB.prepare('INSERT INTO regu_ref (id, nama, urutan, waktu) VALUES (?,?,?,?)')
      .bind(idAcak('rg'), nama, maks + 1, nowISO()).run();
    return j({ ok: true, nama });
  }
  if (path === '/api/pengaturan/regu' && method === 'PUT') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const b = await request.json().catch(() => ({}));
    const r = await DB.prepare('SELECT * FROM regu_ref WHERE id=?').bind(String(b.id || '')).first();
    if (!r) return j({ ok: false, error: 'regu tidak ditemukan' }, 404);
    const baru = String(b.nama || '').trim();
    if (!baru || baru === r.nama) return j({ ok: false, error: 'isi nama baru (berbeda)' }, 400);
    const bentrok = await DB.prepare('SELECT id FROM regu_ref WHERE nama=? AND id != ?').bind(baru, r.id).first();
    if (bentrok) return j({ ok: false, error: 'nama itu sudah dipakai regu lain' }, 400);
    await DB.prepare('UPDATE regu_ref SET nama=? WHERE id=?').bind(baru, r.id).run();
    // CASCADE: nama baru menular ke jamaah & KaRu otomatis
    const a = await DB.prepare('UPDATE jamaah SET regu=? WHERE TRIM(COALESCE(regu,\'\'))=?').bind(baru, r.nama).run();
    const u = await DB.prepare('UPDATE users SET regu=? WHERE TRIM(COALESCE(regu,\'\'))=?').bind(baru, r.nama).run();
    return j({ ok: true, nama: baru, jamaah: (a.meta && a.meta.changes) || 0, users: (u.meta && u.meta.changes) || 0 });
  }
  if (path === '/api/pengaturan/regu' && method === 'DELETE') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const id = url.searchParams.get('id') || '';
    const r = await DB.prepare('SELECT * FROM regu_ref WHERE id=?').bind(id).first();
    if (!r) return j({ ok: false, error: 'regu tidak ditemukan' }, 404);
    const jm = (await DB.prepare('SELECT COUNT(*) c FROM jamaah WHERE TRIM(COALESCE(regu,\'\'))=?').bind(r.nama).first()).c;
    const us = (await DB.prepare('SELECT COUNT(*) c FROM users WHERE TRIM(COALESCE(regu,\'\'))=?').bind(r.nama).first()).c;
    if (jm + us > 0) return j({ ok: false, error: `masih dipakai ${jm} jamaah & ${us} pengguna — pindahkan/padankan dulu` }, 400);
    await DB.prepare('DELETE FROM regu_ref WHERE id=?').bind(id).run();
    return j({ ok: true });
  }
  if (path === '/api/regu/rename' && method === 'POST') {
    if (!USER) return tolak();
    if (USER.peran !== 'admin') return j({ ok: false, error: 'khusus admin' }, 403);
    const b = await request.json().catch(() => ({}));
    const dari = String(b.dari || '').trim(), ke = String(b.ke || '').trim();
    if (!dari || !ke || dari === ke) return j({ ok: false, error: 'isi nama lama & nama baru (berbeda)' }, 400);
    const a = await DB.prepare('UPDATE jamaah SET regu=? WHERE TRIM(COALESCE(regu,\'\'))=?').bind(ke, dari).run();
    const u = await DB.prepare('UPDATE users SET regu=? WHERE TRIM(COALESCE(regu,\'\'))=?').bind(ke, dari).run();
    return j({ ok: true, jamaah: (a.meta && a.meta.changes) || 0, users: (u.meta && u.meta.changes) || 0 });
  }


  /* ---------- MODE CARI (pencarian jamaah hilang) ---------- */
  if (path === '/api/pub/cari-mulai' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const m = b.jamaahId ? await DB.prepare('SELECT * FROM jamaah WHERE id=?').bind(String(b.jamaahId)).first() : null;
    if (!m) return j({ ok: false, error: 'jamaah tidak ditemukan' }, 404);
    return j({ ok: true, jamaah: { id: m.id, nama: m.nama, regu: m.regu, foto: m.foto,
      beacon_id: m.beacon_id, mac_tag: m.mac_tag || '', punya_gelang: !!m.punya_gelang } });
  }
  if (path === '/api/pub/cari-selesai' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const m = b.jamaahId ? await DB.prepare('SELECT * FROM jamaah WHERE id=?').bind(String(b.jamaahId)).first() : null;
    if (!m) return j({ ok: false, error: 'jamaah tidak ditemukan' }, 404);
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return j({ ok: false, error: 'GPS diperlukan' }, 400);
    const sesi = (await DB.prepare("SELECT id FROM sesi WHERE tipe='tracking' AND status='aktif' ORDER BY waktu DESC LIMIT 1").first()) || { id: 'trk1' };
    await DB.prepare('INSERT INTO posisi (sesi_id, jamaah_id, lat, lng, akurasi, sumber, waktu) VALUES (?,?,?,?,?,?,?)')
      .bind(sesi.id, m.id, b.lat, b.lng, 10, 'cari', nowISO()).run();
    await DB.prepare('INSERT INTO kejadian (sesi_id, jamaah_id, tipe, zona_titik, keterangan, waktu) VALUES (?,?,?,?,?,?)')
      .bind(sesi.id, m.id, 'ditemukan', null, `🎯 ${m.nama} DITEMUKAN oleh ${String(b.oleh || 'pencari').slice(0, 40)} via Mode Cari`, nowISO()).run();
    return j({ ok: true, jamaah: m.nama });
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
