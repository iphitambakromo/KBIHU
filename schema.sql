-- IPHI — skema lengkap sejak awal (desain tunggal: titik/rute/target di DB)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  sandi_hash TEXT, salt TEXT,
  nama TEXT DEFAULT '', peran TEXT NOT NULL,           -- admin | ketrom | ketua-regu
  regu TEXT DEFAULT '', wa TEXT DEFAULT '', foto TEXT DEFAULT '', aktif INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS jamaah (
  id TEXT PRIMARY KEY, nama TEXT NOT NULL, paspor TEXT, hp TEXT, umur INTEGER,
  regu TEXT, hotel TEXT, foto TEXT, catatan TEXT,
  punya_hp INTEGER DEFAULT 1, punya_gelang INTEGER DEFAULT 0, beacon_id TEXT,
  latihan_token TEXT
);
CREATE TABLE IF NOT EXISTS sesi (
  id TEXT PRIMARY KEY, nama TEXT NOT NULL,
  tipe TEXT NOT NULL DEFAULT 'tracking',               -- tracking | simulasi-grup
  status TEXT DEFAULT 'aktif',                         -- aktif | ditutup
  regu TEXT DEFAULT '', waktu TEXT NOT NULL, oleh TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS titik (                     -- kumpul / tujuan (tracking)
  id TEXT PRIMARY KEY, sesi_id TEXT DEFAULT '',
  nama TEXT NOT NULL, tipe TEXT DEFAULT 'kumpul',      -- kumpul | tujuan
  lat REAL, lng REAL, radius INTEGER DEFAULT 100,
  warna TEXT DEFAULT '#0E7490', dibuat_oleh TEXT DEFAULT '', waktu TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS zona (                      -- bubble rute (simulasi-grup)
  id TEXT NOT NULL, sesi_id TEXT NOT NULL, nama TEXT NOT NULL,
  lat REAL, lng REAL, radius INTEGER DEFAULT 100, warna TEXT,
  jarak_asli_m INTEGER,                                 -- jarak asli dari markas (Makkah)
  PRIMARY KEY (sesi_id, id)
);
CREATE TABLE IF NOT EXISTS rute (                      -- template pengetahuan (DB)
  id TEXT PRIMARY KEY, nama TEXT NOT NULL, keterangan TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS rute_titik (
  rute_id TEXT NOT NULL, urutan INTEGER NOT NULL,
  zona_id TEXT NOT NULL, nama TEXT NOT NULL,
  jarak_asli_m INTEGER NOT NULL, radius INTEGER DEFAULT 100,
  lat_asli REAL, lng_asli REAL, warna TEXT,
  PRIMARY KEY (rute_id, urutan)
);
CREATE TABLE IF NOT EXISTS target_ritual (             -- latihan mandiri (DB, bisa diubah admin)
  urutan INTEGER PRIMARY KEY, nama TEXT NOT NULL, keterangan TEXT DEFAULT '',
  target_m INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posisi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesi_id TEXT DEFAULT '', jamaah_id TEXT NOT NULL,
  lat REAL, lng REAL, akurasi INTEGER, sumber TEXT, waktu TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kejadian (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesi_id TEXT DEFAULT '', jamaah_id TEXT, tipe TEXT, zona_titik TEXT,
  keterangan TEXT, waktu TEXT NOT NULL, ditangani INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS absensi_event (
  id TEXT PRIMARY KEY, nama TEXT NOT NULL, titik_id TEXT DEFAULT '',
  sesi_id TEXT DEFAULT '', regu TEXT DEFAULT '',
  waktu TEXT NOT NULL, ditutup INTEGER DEFAULT 0, oleh TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS absensi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL, jamaah_id TEXT NOT NULL,
  status TEXT DEFAULT 'hadir', sumber TEXT DEFAULT 'radar',
  lat REAL, lng REAL, waktu TEXT NOT NULL, oleh TEXT DEFAULT '',
  UNIQUE(event_id, jamaah_id)
);
CREATE TABLE IF NOT EXISTS kalibrasi (                  -- audit penempatan/geser titik & zona
  id INTEGER PRIMARY KEY AUTOINCREMENT, waktu TEXT NOT NULL,
  jenis TEXT DEFAULT 'titik', ref_id TEXT, nama TEXT,
  lat REAL, lng REAL, radius INTEGER, sumber TEXT, oleh TEXT
);
CREATE TABLE IF NOT EXISTS galat (                      -- 🛠 diagnostik error server
  id INTEGER PRIMARY KEY AUTOINCREMENT, waktu TEXT NOT NULL,
  path TEXT, metode TEXT, pesan TEXT, level TEXT DEFAULT 'error'
);
CREATE TABLE IF NOT EXISTS regu_ref (                 -- referensi regu resmi (menu Pengaturan)
  id TEXT PRIMARY KEY, nama TEXT UNIQUE NOT NULL, urutan INTEGER DEFAULT 0, waktu TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS latihan (                  -- catatan odometer latihan mandiri
  id INTEGER PRIMARY KEY AUTOINCREMENT, jamaah_id TEXT NOT NULL, ritual INTEGER,
  jarak_m REAL, durasi_s INTEGER DEFAULT 0, aktif_s INTEGER DEFAULT 0,
  selesai INTEGER DEFAULT 0, waktu TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS token (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, waktu TEXT NOT NULL, expires TEXT NOT NULL);

-- ===== v2.0: Tabel untuk Native App & Kawal Rombongan =====

CREATE TABLE IF NOT EXISTS deteksi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_tag TEXT NOT NULL,
  jamaah_id TEXT,
  device_id TEXT,
  lat REAL,
  lng REAL,
  rssi INTEGER,
  sumber TEXT DEFAULT 'native',
  waktu TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kawal_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rombongan_id TEXT NOT NULL,
  ketua_device TEXT,
  lat REAL,
  lng REAL,
  jumlah_deteksi INTEGER DEFAULT 0,
  waktu TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kawal_jamaah (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rombongan_id TEXT NOT NULL,
  jamaah_id TEXT NOT NULL,
  mac_tag TEXT,
  status DEFAULT 'tidak_terdeteksi',
  rssi INTEGER,
  jarak_meter REAL,
  terakhir_terdeteksi TEXT,
  lat REAL,
  lng REAL,
  waktu TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kawal_alert (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rombongan_id TEXT NOT NULL,
  jamaah_id TEXT NOT NULL,
  tipe TEXT DEFAULT 'hilang',
  durasi_menit INTEGER,
  lat REAL,
  lng REAL,
  ditangani INTEGER DEFAULT 0,
  waktu TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posisi_jm ON posisi(jamaah_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_kejadian ON kejadian(id DESC);
CREATE INDEX IF NOT EXISTS idx_titik ON titik(sesi_id);
CREATE INDEX IF NOT EXISTS idx_absensi_ev ON absensi(event_id);
CREATE INDEX IF NOT EXISTS idx_latihan_jm ON latihan(jamaah_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_deteksi_mac ON deteksi(mac_tag, waktu);
CREATE INDEX IF NOT EXISTS idx_deteksi_jm ON deteksi(jamaah_id, waktu);
CREATE INDEX IF NOT EXISTS idx_kawal_log ON kawal_log(rombongan_id, waktu);
CREATE INDEX IF NOT EXISTS idx_kawal_jm ON kawal_jamaah(rombongan_id, jamaah_id);
CREATE INDEX IF NOT EXISTS idx_kawal_alert ON kawal_alert(rombongan_id, ditangani);
