# Radar IPHI (App Android Native)

Radar BLE berbasis **MAC asli** tag iTag — karena Android native bisa membaca MAC
(browser/Chrome tidak bisa, alasan ini dulu bikin tag selalu terbaca "iTag" di HP lain).

## Fitur
- 🔵 **Scan BLE** — daftar tag dengan **MAC asli + sinyal (dBm)**
- 🎯 **Match otomatis via MAC** — tag yang MAC-nya sudah terdaftar langsung tampil
  **nama jamaah + regu** (data dari Cloudflare Worker / D1 — sama dengan web app)
- 📡 **Posisi otomatis** — GPS HP + tag terkuat terdaftar dilaporkan ke dashboard
  (`/api/pub/mac`, throttled: min 30 dtk antar laporan, refresh paksa 90 dtk)
- 🔊 **Bunyikan tag** — via GATT (servis baterai / iTag); tag iTag juga bunyi saat tersambung/terputus
- 💾 **Catat MAC sekali-scan** — tag baru? tekan 💾 → pilih jamaah → MAC tersimpan ke
  `jamaah.mac_tag` (ganti kerja nRF Connect + ketik manual)

## Install (di HP karu)
1. Buka https://github.com/iphitambakromo/traking/actions → workflow **Build APK (Radar IPHI)**
2. Build selesai → unduh artifact **radar-iphi-apk** → ekstrak → `app-debug.apk`
3. Kirim APK ke HP (WhatsApp/Telegram) → install (izinkan "sumber tidak dikenal")
4. Buka app → masuk (akun karu, sandi sama dgn web) → **Mulai Scan** (izinkan Bluetooth + lokasi)

## Alur lapangan
- Jamaah yang MAC-nya sudah dicatat: tag-nya tampil **nama** → HP otomatis lapor posisi
  ke dashboard (jika GPS nyala).
- Tag belum dikenal (mac belum dicatat): tampil "📶 tag …XXXX" → tekan 💾 → pilih jamaah →
  setelah itu tag langsung dikenal di **semua HP** (MAC identik lintas perangkat).

## Catatan
- Scan berjalan saat app terbuka (layar nyala). Untuk hemat baterai, layar boleh redup.
- API: default `https://traking.iphi-haji.workers.dev` (bisa diganti di layar login, mis. server lokal).
- Android 5.0+ (minSdk 21). Izin: BLUETOOTH_SCAN/CONNECT + lokasi (GPS utk laporan posisi).

## Build manual (opsional)
```
cd android
gradle assembleDebug        # butuh JDK 17 + Android SDK 34
# hasil: app/build/outputs/apk/debug/app-debug.apk
```
