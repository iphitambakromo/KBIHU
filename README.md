# IPHI — Tracking Amanah Mengawal Barisan

Aplikasi v2 (rebuild): **satu peta GPS** di mana pun berada — titik kumpul/tujuan, absensi terikat titik,
radar gelang BLE, kartu digital QR + SOS WhatsApp, kartu leher PDF 3 bahasa, latihan mandiri berodometer.

## Stack
React + Tailwind (Vite) · Cloudflare Workers + D1 · Leaflet (OSM/Esri) · PWA

## Pengembangan lokal
```bash
npm install
npm run db:init        # skema D1 lokal
npm run build          # build frontend -> dist/
npx wrangler dev       # http://localhost:8787
```
Akun awal: `admin/123` · `karom/123` · `karu1–karu5/123456` — **segera ganti**.

## Deploy (workers.dev, DB baru)
1. Push repo ini ke GitHub.
2. Cloudflare Dashboard → **Workers & Pages → Create → Workers → Connect to Git** → pilih repo `iphi`.
   - Build command: `npm install && npm run build` (terdeteksi otomatis dari `wrangler.toml` + `package.json`).
3. Buat database D1 baru (sekali): Dashboard → **D1 → Create** → nama `iphi-db` → salin **database_id** → ganti di `wrangler.toml`.
4. Jalankan skema di remote (sekali, dari komputer): `npx wrangler d1 execute iphi-db --remote --file=schema.sql`
5. Deploy → aplikasi ada di `https://iphi.<subdomain>.workers.dev`. Buka sekali → tabel & data contoh dibuat otomatis (`/api/seed`).

Catatan:
- Semua fitur peran (KaRu hanya regunya, penandaan absensi manual, dsb.) ditegakkan di server.
- Galat server tercatat di tabel `galat` — lihat di menu 🛠 Diagnostik (Admin).
