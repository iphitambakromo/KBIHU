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
    return j({ ok: true, sesi, titik, jamaah: jamaah.map(m => ({ ...m, punya_hp: !!m.punya_hp, punya_gelang: !!m.punya_gelang })),
      stat: { total: jamaah.length, gelang: jamaah.filter(m => m.punya_gelang).length },
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
