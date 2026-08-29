# 🕋 IPHI v3.0 — WebView + Native Bridge

Aplasi IPHI dengan arsitektur **WebView + Native Bridge** — satu app untuk semua fitur.

## ✨ Fitur

- **WebView** — tampilkan web app IPHI (dashboard, absensi, kelola jamaah, dll)
- **BLE Native** — scan gelang iTag, baca MAC asli dari ffe3
- **GPS Native** — tracking posisi rombongan (High Accuracy)
- **Background Service** — BLE + GPS jalan terus meski app di-minimize
- **WhatsApp** — hubungi jamaah langsung dari kartu
- **Multi-device** — banyak HP kirim ke server yang sama
- **Offline** — data tersimpan lokal, sync saat online

## 🏗️ Arsitektur

```
┌─────────────────────────────────────────────────┐
│  IPHI App (1 APK)                               │
│  ┌─────────────────────────────────────────┐   │
│  │  WebView → web app IPHI                 │   │
│  │  (dashboard, absensi, kelola, dll)       │   │
│  └──────────────────┬──────────────────────┘   │
│                     │ JavaScript Bridge         │
│  ┌──────────────────┴──────────────────────┐   │
│  │  Native BLE + GPS                       │   │
│  │  (baca MAC asli, tracking posisi)       │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  Cloudflare (Workers + D1)                      │
│  (API + Database terpusat)                      │
└─────────────────────────────────────────────────┘
```

## 📱 JavaScript Bridge API

```javascript
// Start/Stop Services
window.Android.startBLE(serverUrl, rombonganId)
window.Android.stopBLE()
window.Android.startGPS(serverUrl, deviceId)
window.Android.stopGPS()

// Gelang
window.Android.bunyikanGelang(mac)
window.Android.stopBunyikan(mac)

// WhatsApp
window.Android.openWhatsApp(number, name)

// Utility
window.Android.vibrate(pattern)
window.Android.getDeviceInfo()
window.Android.showToast(message)
window.Android.saveServerUrl(url)
window.Android.getServerUrl()

// Callbacks dari Native ke JavaScript
window.onBleDetected = (mac, rssi, name) => {}
window.onBleStatus = (status) => {}
window.onGPSUpdate = (lat, lng, accuracy) => {}
```

## 🔧 Build

### GitHub Actions (Recommended)
1. Push ke GitHub
2. Buka tab Actions
3. Jalankan workflow "Build IPHI APK"
4. Download artifact

### Android Studio
1. Buka project di Android Studio
2. Build → Build APK
3. APK di: `app/build/outputs/apk/debug/app-debug.apk`

## 📋 Persyaratan

- Android 8.0 (API 26)+
- Bluetooth LE
- GPS
- Internet

## 📄 Lisensi

Internal IPHI
