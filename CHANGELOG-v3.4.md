# IPHI v3.4.0 - Native App Rebuild

## 📱 Perubahan Utama

### BLE (Bluetooth Low Energy)
- ✅ **Android 13+ API** — `writeCharacteristic(chr, value, writeType)` untuk bunyikan gelang
- ✅ **Offline Queue** — Deteksi yang gagal kirim disimpan & di-flush otomatis
- ✅ **Throttle 30 detik** — Per device, hemat bandwidth server
- ✅ **Max 3 GATT** — Koneksi simultan dibatasi, stabil untuk 50 jamaah
- ✅ **Better Error Messages** — Pesan error scan lebih jelas
- ✅ **MAC Cache** — Persisten di SharedPreferences

### GPS
- ✅ **setWaitForAccurateLocation(true)** — Tunggu fix akurat sebelum push
- ✅ **Filter Akurasi** — Hanya update jika akurasi lebih baik
- ✅ **Interval 5 detik** — Lebih responsif dari sebelumnya
- ✅ **Dual GPS** — Direct (MainActivity) + Service (background)

### WebView + Bridge
- ✅ **UserAgent** — `IPHI-Native/3.4` terdeteksi di server
- ✅ **getVersion()** — Return "3.4.0"
- ✅ **reload()** — Refresh halaman dari native
- ✅ **deviceId Persisten** — Tidak berubah setiap restart

### Icon & UI
- ✅ **Kabah Icon** — Semua density (mdpi → xxxhdpi)
- ✅ **Status Bar Hijau** — `#0B5D3B`
- ✅ **Navigation Bar Hijau** — Match tema
- ✅ **Splash Background Hijau** — Saat loading

### Build & CI
- ✅ **GitHub Actions** — Build debug + release APK otomatis
- ✅ **ProGuard** — Rules untuk OkHttp + Gson
- ✅ **Version 3.4.0** — versionCode 340

## 🔧 Bridge Functions (window.Android.*)

| Function | Parameter | Return | Keterangan |
|----------|-----------|--------|------------|
| `startBLE(srv, rom)` | serverUrl, rombonganId | void | Mulai scan BLE |
| `stopBLE()` | - | void | Stop scan BLE |
| `startGPS(srv, dev)` | serverUrl, deviceId | void | Mulai GPS |
| `stopGPS()` | - | void | Stop GPS |
| `bunyikanGelang(mac)` | MAC address | void | Nyalakan alarm |
| `stopBunyikan(mac)` | MAC address | void | Matikan alarm |
| `openWhatsApp(num, name)` | nomor, nama | void | Buka WA |
| `vibrate(pattern)` | "500,200,500" | void | Getar HP |
| `getDeviceInfo()` | - | JSON string | Info device |
| `getVersion()` | - | "3.4.0" | Versi app |
| `reload()` | - | void | Refresh page |
| `hasGPS()` | - | boolean | GPS aktif? |
| `getLatitude()` | - | double | Latitude |
| `getLongitude()` | - | double | Longitude |
| `getAccuracy()` | - | float | Akurasi (m) |
| `getServerUrl()` | - | string | URL server |
| `saveServerUrl(url)` | url | void | Simpan URL |
| `showToast(msg)` | message | void | Tampilkan toast |

## 📡 Callbacks (Native → Web)

| Callback | Parameter | Keterangan |
|----------|-----------|------------|
| `window.onBleDetected(mac, rssi, name)` | MAC, signal, nama | BLE device terdeteksi |
| `window.onBleStatus(status)` | status string | Status BLE berubah |
| `window.onGPSUpdate(lat, lng, acc)` | lat, lng, accuracy | GPS update |

## 📦 Build

```bash
# Via GitHub Actions (otomatis)
git push origin IPHI-v3.3

# Manual
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

## 📋 File Structure

```
app/src/main/
├── java/com/iphi/
│   ├── IphiApp.kt          # Application class + constants
│   ├── ble/BleService.kt   # BLE scanning + GATT + offline queue
│   ├── gps/GpsService.kt   # GPS background service
│   └── webview/MainActivity.kt  # WebView + Bridge + GPS direct
├── res/
│   ├── drawable/ic_notif.xml
│   ├── layout/activity_main.xml
│   ├── mipmap-mdpi/ic_launcher.png    (48x48)
│   ├── mipmap-hdpi/ic_launcher.png    (72x72)
│   ├── mipmap-xhdpi/ic_launcher.png   (96x96)
│   ├── mipmap-xxhdpi/ic_launcher.png  (144x144)
│   ├── mipmap-xxxhdpi/ic_launcher.png (512x512)
│   └── values/{colors,strings,themes}.xml
└── AndroidManifest.xml
```
