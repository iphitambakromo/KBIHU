/* Stempel versi service worker BARU tiap build (hash bundle) — supaya tiap deploy,
   semua HP otomatis memuat aplikasi versi baru (cache lama dihapus saat activate).
   Ini menghilangkan gejala "harus refresh browser" setelah update. */
const fs = require('fs'), path = require('path');
const dist = path.join(__dirname, '..', 'dist');
const file = path.join(dist, 'sw.js');
if (!fs.existsSync(file)) { console.log('stamp-sw: dist/sw.js belum ada — skip'); process.exit(0); }
const assets = fs.existsSync(path.join(dist, 'assets')) ? fs.readdirSync(path.join(dist, 'assets')) : [];
const js = assets.find(f => /^index-.*\.js$/.test(f));
const versi = 'iphi-' + (js ? js.slice('index-'.length, -3) : Date.now().toString(36));
const sw = fs.readFileSync(file, 'utf8');
const baru = sw.replace(/const VERSI = '[^']*'/, "const VERSI = '" + versi + "'");
if (baru === sw) { console.error('stamp-sw: pola VERSI tidak ditemukan di sw.js'); process.exit(1); }
fs.writeFileSync(file, baru);
console.log('stamp-sw: versi service worker →', versi);
