/* IPHI worker — basis data: skema, seed, util */

export const jarakM = (aLat, aLng, bLat, bLng) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
export const mToLat = m => m / 111320;
export const mToLng = (m, lat) => m / (111320 * Math.cos(lat * Math.PI / 180));

async function sha256Hex(str) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function buatSandi(sandi) {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
  return { salt, hash: await sha256Hex(salt + ':' + sandi) };
}
export const tokenAcak = () => 't_' + [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, '0')).join('');
export const idAcak = (pre) => (pre || 'x') + Date.now().toString(36) + [...crypto.getRandomValues(new Uint8Array(3))].map(x => x.toString(16).padStart(2, '0')).join('');
export const nowISO = () => new Date().toISOString();

const SKEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, sandi_hash TEXT, salt TEXT, nama TEXT DEFAULT '', peran TEXT NOT NULL, regu TEXT DEFAULT '', wa TEXT DEFAULT '', foto TEXT DEFAULT '', aktif INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS jamaah (id TEXT PRIMARY KEY, nama TEXT NOT NULL, paspor TEXT, hp TEXT, umur INTEGER, regu TEXT, hotel TEXT, foto TEXT, catatan TEXT, punya_hp INTEGER DEFAULT 1, punya_gelang INTEGER DEFAULT 0, beacon_id TEXT, latihan_token TEXT)`,
  `CREATE TABLE IF NOT EXISTS sesi (id TEXT PRIMARY KEY, nama TEXT NOT NULL, tipe TEXT NOT NULL DEFAULT 'tracking', status TEXT DEFAULT 'aktif', regu TEXT DEFAULT '', waktu TEXT NOT NULL, oleh TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS titik (id TEXT PRIMARY KEY, sesi_id TEXT DEFAULT '', nama TEXT NOT NULL, tipe TEXT DEFAULT 'kumpul', lat REAL, lng REAL, radius INTEGER DEFAULT 100, warna TEXT DEFAULT '#0E7490', dibuat_oleh TEXT DEFAULT '', waktu TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS zona (id TEXT NOT NULL, sesi_id TEXT NOT NULL, nama TEXT NOT NULL, lat REAL, lng REAL, radius INTEGER DEFAULT 100, warna TEXT, jarak_asli_m INTEGER, PRIMARY KEY (sesi_id, id))`,
  `CREATE TABLE IF NOT EXISTS rute (id TEXT PRIMARY KEY, nama TEXT NOT NULL, keterangan TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS rute_titik (rute_id TEXT NOT NULL, urutan INTEGER NOT NULL, zona_id TEXT NOT NULL, nama TEXT NOT NULL, jarak_asli_m INTEGER NOT NULL, radius INTEGER DEFAULT 100, lat_asli REAL, lng_asli REAL, warna TEXT, PRIMARY KEY (rute_id, urutan))`,
  `CREATE TABLE IF NOT EXISTS target_ritual (urutan INTEGER PRIMARY KEY, nama TEXT NOT NULL, keterangan TEXT DEFAULT '', target_m INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS posisi (id INTEGER PRIMARY KEY AUTOINCREMENT, sesi_id TEXT DEFAULT '', jamaah_id TEXT NOT NULL, lat REAL, lng REAL, akurasi INTEGER, sumber TEXT, waktu TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kejadian (id INTEGER PRIMARY KEY AUTOINCREMENT, sesi_id TEXT DEFAULT '', jamaah_id TEXT, tipe TEXT, zona_titik TEXT, keterangan TEXT, waktu TEXT NOT NULL, ditangani INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS absensi_event (id TEXT PRIMARY KEY, nama TEXT NOT NULL, titik_id TEXT DEFAULT '', sesi_id TEXT DEFAULT '', regu TEXT DEFAULT '', waktu TEXT NOT NULL, ditutup INTEGER DEFAULT 0, oleh TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS absensi (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, jamaah_id TEXT NOT NULL, status TEXT DEFAULT 'hadir', sumber TEXT DEFAULT 'radar', lat REAL, lng REAL, waktu TEXT NOT NULL, oleh TEXT DEFAULT '', UNIQUE(event_id, jamaah_id))`,
  `CREATE TABLE IF NOT EXISTS kalibrasi (id INTEGER PRIMARY KEY AUTOINCREMENT, waktu TEXT NOT NULL, jenis TEXT DEFAULT 'titik', ref_id TEXT, nama TEXT, lat REAL, lng REAL, radius INTEGER, sumber TEXT, oleh TEXT)`,
  `CREATE TABLE IF NOT EXISTS galat (id INTEGER PRIMARY KEY AUTOINCREMENT, waktu TEXT NOT NULL, path TEXT, metode TEXT, pesan TEXT, level TEXT DEFAULT 'error')`,
  `CREATE TABLE IF NOT EXISTS latihan (id INTEGER PRIMARY KEY AUTOINCREMENT, jamaah_id TEXT NOT NULL, ritual INTEGER, jarak_m REAL, durasi_s INTEGER DEFAULT 0, aktif_s INTEGER DEFAULT 0, selesai INTEGER DEFAULT 0, waktu TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_latihan_jm ON latihan(jamaah_id, id DESC)`,
  `CREATE TABLE IF NOT EXISTS regu_ref (id TEXT PRIMARY KEY, nama TEXT UNIQUE NOT NULL, urutan INTEGER DEFAULT 0, waktu TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS token (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, waktu TEXT NOT NULL, expires TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_posisi_jm ON posisi(jamaah_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_kejadian ON kejadian(id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_titik ON titik(sesi_id)`,
  `CREATE INDEX IF NOT EXISTS idx_absensi_ev ON absensi(event_id)`,
];

/* Pengetahuan awal (DB-driven, sesuai desain): jarak asli Makkah + target ritual */
export const RUTE_MAKKAH = [
  ['z_markas', 'Markas / Hotel', 0, 250, 21.42650, 39.81870, '#0E7490'],
  ['z_haram',  'Masjidil Haram', 2500, 450, 21.42251, 39.82616, '#B4232A'],
  ['z_mina',   'Mina (Area Tenda)', 7000, 1500, 21.41333, 39.89389, '#12855A'],
  ['z_arafah', 'Padang Arafah', 9000, 2200, 21.35486, 39.98413, '#B48A2F'],
  ['z_muzd',   'Muzdalifah', 8000, 1500, 21.38763, 39.94142, '#4338CA'],
];
export const TARGET_RITUAL = [
  ['Jalan Hotel → Masjidil Haram', 'Novotel Thakher City → Haram; latih kakinya juga', 2500],
  ['Tawaf 7 putaran — garis TERLUAR', 'Mengelilingi Ka’bah 7x barisan paling luar: ±2 km', 2000],
  ['Sa’i Safa–Marwah 7 lintasan', 'Bolak-balik 7x: ±3,5 km — latihan terberat', 3500],
  ['Hotel → Mina (Hari Tarwiyah)', 'Biasanya bus; latihan opsional stamina', 8000],
  ['Mina → Arafah (Wukuf)', 'Bus; cukup latihan sebagian bila ingin', 14000],
  ['Arafah → Muzdalifah (malam mabit)', 'Sering ditempuh jalan kaki malam — PRIORITAS!', 6000],
  ['Muzdalifah → Mina (Jumrah Aqabah)', 'Jalan kaki pagi buta — PRIORITAS!', 3000],
  ['Mina → Masjidil Haram (Ifadah)', 'Perjalanan Nafar, umumnya kendaraan', 8000],
  ['Tawaf Wada’ (perpisahan)', '7 putaran terakhir sebelum pulang', 2000],
];

async function pastikanKolom(DB, tabel, kolom, def) {
  const { results } = await DB.prepare(`PRAGMA table_info(${tabel})`).all();
  if ((results || []).some(c => c.name === kolom)) return;
  try { await DB.prepare(`ALTER TABLE ${tabel} ADD COLUMN ${kolom} ${def}`).run(); } catch (e) {}
}
export async function skema(DB) {
  for (const q of SKEMA) await DB.prepare(q).run();
  await pastikanKolom(DB, 'users', 'foto', 'TEXT DEFAULT \'\'');
}

export async function seed(DB) {
  await skema(DB);
  const uAda = await DB.prepare('SELECT COUNT(*) c FROM users').first();
  if (!uAda || !uAda.c) {
    const akun = [
      ['u_admin', 'admin', '123', 'Admin IPHI', 'admin', ''],
      ['u_karom', 'karom', '123', 'Ketua Rombongan', 'ketrom', ''],
    ];
    for (let n = 1; n <= 5; n++) akun.push([`u_karu${n}`, `karu${n}`, '123456', `Ketua Regu ${n}`, 'ketua-regu', `Regu ${n} – Wisata Iman`]);
    for (const a of akun) {
      const s = await buatSandi(a[2]);
      await DB.prepare('INSERT INTO users (id, username, sandi_hash, salt, nama, peran, regu, aktif) VALUES (?,?,?,?,?,?,?,1)')
        .bind(a[0], a[1], s.hash, s.salt, a[3], a[4], a[5]).run();
    }
  }
  // pengetahuan: rute Makkah (jarak asli) + target ritual — sekali saja
  const rAda = await DB.prepare('SELECT COUNT(*) c FROM rute').first();
  if (!rAda || !rAda.c) {
    await DB.prepare("INSERT INTO rute (id, nama, keterangan) VALUES ('rute_makkah','Haji Makkah','Jarak asli antar titik ibadah (meter) dari markas')").run();
    for (let i = 0; i < RUTE_MAKKAH.length; i++) {
      const z = RUTE_MAKKAH[i];
      await DB.prepare('INSERT INTO rute_titik (rute_id, urutan, zona_id, nama, jarak_asli_m, radius, lat_asli, lng_asli, warna) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind('rute_makkah', i + 1, z[0], z[1], z[2], z[3], z[4], z[5], z[6]).run();
    }
  }
  const tAda = await DB.prepare('SELECT COUNT(*) c FROM target_ritual').first();
  if (!tAda || !tAda.c) {
    for (let i = 0; i < TARGET_RITUAL.length; i++) {
      await DB.prepare('INSERT INTO target_ritual (urutan, nama, keterangan, target_m) VALUES (?,?,?,?)')
        .bind(i + 1, TARGET_RITUAL[i][0], TARGET_RITUAL[i][1], TARGET_RITUAL[i][2]).run();
    }
  }
  // sesi tracking pertama + contoh jamaah (idempoten)
  const sAda = await DB.prepare("SELECT COUNT(*) c FROM sesi WHERE tipe='tracking'").first();
  if (!sAda || !sAda.c) {
    await DB.prepare("INSERT INTO sesi (id, nama, tipe, waktu, oleh) VALUES ('trk1','Tracking Rombongan','tracking',?,'admin')").bind(nowISO()).run();
  }
  // referensi regu: sekali isi dari regu yang sudah terpakai (jamaah + pengguna)
  const rRefAda = await DB.prepare('SELECT COUNT(*) c FROM regu_ref').first();
  if (!rRefAda || !rRefAda.c) {
    const set = new Set();
    (await DB.prepare("SELECT DISTINCT regu FROM jamaah WHERE TRIM(COALESCE(regu,'')) != ''").all()).results.forEach(r => set.add(r.regu.trim()));
    (await DB.prepare("SELECT DISTINCT regu FROM users WHERE TRIM(COALESCE(regu,'')) != ''").all()).results.forEach(r => set.add(r.regu.trim()));
    let urut = 0;
    for (const nama of [...set].sort()) {
      await DB.prepare('INSERT OR IGNORE INTO regu_ref (id, nama, urutan, waktu) VALUES (?,?,?,?)')
        .bind('rg' + (++urut), nama, urut, nowISO()).run();
    }
  }
  const jAda = await DB.prepare('SELECT COUNT(*) c FROM jamaah').first();
  if (!jAda || !jAda.c) {
    const contoh = [
      ['H. Ahmad Syaifuddin', 'X1189421', '0812-3100-101', 67, 'Regu 1 – Wisata Iman', 1, 0],
      ['Hj. Aminah Nurdiyanti', 'X1189422', '0812-3100-102', 63, 'Regu 1 – Wisata Iman', 0, 1],
      ['H. Bambang Sutrisno', 'X1189423', '0812-3100-103', 58, 'Regu 2 – Wisata Iman', 1, 0],
      ['Hj. Chodijah Maulana', 'X1189424', '0812-3100-104', 71, 'Regu 2 – Wisata Iman', 0, 1],
      ['H. Daud Rakhman', 'X1189425', '0812-3100-105', 61, 'Regu 3 – Wisata Iman', 1, 0],
      ['Hj. Fatimah Az-Zahra', 'X1189426', '0812-3100-106', 66, 'Regu 3 – Wisata Iman', 1, 1],
      ['H. Ganjar Prakoso', 'X1189427', '0812-3100-107', 59, 'Regu 4 – Wisata Iman', 1, 0],
      ['Hj. Hasanah Budiyarti', 'X1189428', '0812-3100-108', 74, 'Regu 4 – Wisata Iman', 0, 1],
      ['H. Irfan Hakim', 'X1189429', '0812-3100-109', 55, 'Regu 5 – Wisata Iman', 1, 0],
      ['Hj. Jasmin Rahmawati', 'X1189430', '0812-3100-110', 62, 'Regu 5 – Wisata Iman', 1, 0],
    ];
    for (let i = 0; i < contoh.length; i++) {
      const c = contoh[i];
      await DB.prepare('INSERT INTO jamaah (id, nama, paspor, hp, umur, regu, hotel, punya_hp, punya_gelang) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind('jm' + String(i + 1).padStart(2, '0'), c[0], c[1], c[2], c[3], c[4], 'Hotel Al-Safa', c[5], c[6]).run();
    }
  }
  return true;
}
