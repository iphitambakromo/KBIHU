package com.iphi.ble

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.gson.Gson
import com.iphi.IphiApp
import com.iphi.R
import com.iphi.webview.MainActivity
import kotlinx.coroutines.*
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.util.*
import java.util.concurrent.ConcurrentHashMap

class BleService : Service() {
    companion object {
        private const val TAG = "BleService"
        private const val NOTIFICATION_ID = 1001
        private const val KAWAL_INTERVAL = 15_000L  // 15 detik (lebih responsif untuk 50 jamaah)
        private const val FFE0_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb"
        private const val FFE3_CHAR = "0000ffe3-0000-1000-8000-00805f9b34fb"
        private const val ALERT_SERVICE = "00001802-0000-1000-8000-00805f9b34fb"
        private const val ALERT_CHAR = "00002a06-0000-1000-8000-00805f9b34fb"
        private val JSON_TYPE: MediaType = "application/json; charset=utf-8".toMediaType()
    }

    private var scanner: BluetoothLeScanner? = null
    private var isScanning = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    /* fix K8: loop scan disimpan sebagai job terpisah — stopScanning tidak lagi membatalkan
       seluruh scope (dulu scope.cancel() membuat start/stop berikutnya mati total & senyap) */
    private var kawalJob: Job? = null
    private var bersihJob: Job? = null
    private var lastNotifUpdate = 0L   // fix S6: throttle notifikasi
    private val httpClient = OkHttpClient()
    private val gson = Gson()
    
    val detectedDevices = ConcurrentHashMap<String, DeviceInfo>()
    private val macCache = ConcurrentHashMap<String, String>()
    /* Fase 1: peta terbalik realMAC → alamat iklan. Kunci untuk "bunyikan kapan saja"
       seperti iSearching: kita bisa reconnect langsung via alamat yang tersimpan,
       tanpa bergantung pada daftar scan (detectedDevices) yang dibersihkan tiap 120s. */
    private val realMacToAddr = ConcurrentHashMap<String, String>()
    private val connectingDevices = ConcurrentHashMap<String, Boolean>()
    
    var serverUrl = ""
    var rombonganId = ""
    var deviceId = ""
    var lastLat = 0.0
    var lastLng = 0.0
    
    var onDeviceDetected: ((DeviceInfo) -> Unit)? = null
    var onStatusChanged: ((String) -> Unit)? = null
    var onBleDetected: ((String, Int, String) -> Unit)? = null
    
    private val binder = LocalBinder()
    
    inner class LocalBinder : Binder() {
        fun getService(): BleService = this@BleService
    }

    data class DeviceInfo(
        val address: String,
        val realMac: String?,
        val name: String?,
        val rssi: Int,
        val lastSeen: Long,
        val identified: Boolean = false
    )

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        val bm = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        scanner = bm.adapter?.bluetoothLeScanner
        /* fix S7: pakai deviceId persisten dari IphiApp (unik per instalasi).
           Dulu memakai Build.SERIAL yang selalu "unknown" di API 26+ → semua HP model sama identik. */
        deviceId = getSharedPreferences(IphiApp.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(IphiApp.PREF_DEVICE_ID, null)
            ?: "${Build.MANUFACTURER}_${Build.MODEL}_${System.currentTimeMillis()}"
        loadMacCache()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "START" -> {
                serverUrl = intent.getStringExtra("server") ?: IphiApp.DEFAULT_SERVER_URL
                rombonganId = intent.getStringExtra("rombongan") ?: ""
                startForeground(NOTIFICATION_ID, createNotification("Memulai scan..."))
                startScanning()
            }
            "STOP" -> stopScanning()
            "BEEP" -> {
                val mac = intent.getStringExtra("mac") ?: ""
                if (mac.isNotEmpty()) scope.launch { bunyikanGelang(mac) }
            }
        }
        return START_STICKY
    }

    private fun loadMacCache() {
        try {
            val prefs = getSharedPreferences(IphiApp.PREFS_NAME, Context.MODE_PRIVATE)
            val data = prefs.getString(IphiApp.PREF_MAC_CACHE, "{}") ?: "{}"
            val map = gson.fromJson(data, Map::class.java) as? Map<String, String> ?: emptyMap()
            macCache.putAll(map)
            // Fase 1: bangun peta terbalik from cache
            macCache.forEach { (addr, mac) -> realMacToAddr[mac] = addr }
            Log.d(TAG, "Loaded ${macCache.size} MAC cache")
        } catch (e: Exception) { Log.e(TAG, "Error loading cache", e) }
    }

    private fun saveMacCache() {
        try {
            val prefs = getSharedPreferences(IphiApp.PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(IphiApp.PREF_MAC_CACHE, gson.toJson(macCache)).apply()
        } catch (e: Exception) { Log.e(TAG, "Error saving cache", e) }
    }

    private fun startScanning() {
        if (isScanning) return
        if (scanner == null) { onStatusChanged?.invoke("❌ Bluetooth tidak tersedia"); return }
        
        isScanning = true
        onStatusChanged?.invoke("🟢 Scan aktif")
        
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()
        
        try {
            scanner?.startScan(null, settings, scanCallback)
            
            kawalJob = scope.launch {
                while (isScanning) {
                    delay(KAWAL_INTERVAL)
                    kirimDataKawal()
                }
            }
            
            bersihJob = scope.launch {
                while (isScanning) {
                    delay(60_000)
                    val now = System.currentTimeMillis()
                    detectedDevices.entries.removeAll { now - it.value.lastSeen > 120_000 }
                    updateNotification()
                }
            }
        } catch (e: SecurityException) {
            onStatusChanged?.invoke("❌ Izin Bluetooth ditolak")
            isScanning = false
        }
    }

    private fun stopScanning() {
        isScanning = false
        try { scanner?.stopScan(scanCallback) } catch (e: Exception) {}
        /* fix K8: batalkan hanya job loop scan — scope tetap hidup untuk start berikutnya */
        kawalJob?.cancel(); kawalJob = null
        bersihJob?.cancel(); bersihJob = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            val address = device.address
            val name = try { device.name } catch (e: SecurityException) { null }
            val rssi = result.rssi
            
            // Filter: proses device yang terlihat seperti iTag
            // 1. Nama mengandung "iTAG" (case insensitive)
            // 2. Sudah dikenal (di cache atau sudah terdeteksi)
            // 3. Sinyal sangat kuat (sangat dekat, kemungkinan iTag)
            val isITag = name?.contains("iTAG", ignoreCase = true) == true || 
                         detectedDevices.containsKey(address) ||
                         macCache.containsKey(address)
            
            // Jangan proses device yang tidak dikenal dan sinyal lemah
            if (!isITag && rssi < -70) return
            
            Log.d(TAG, "BLE detected: $address ($name) RSSI: $rssi")
            
            val cachedMac = macCache[address]
            val existing = detectedDevices[address]
            val info = DeviceInfo(
                address = address,
                realMac = cachedMac ?: existing?.realMac,
                name = name ?: existing?.name,
                rssi = rssi,
                lastSeen = System.currentTimeMillis(),
                identified = cachedMac != null || (existing?.identified ?: false)
            )
            detectedDevices[address] = info
            
            // Jika belum identifikasi, coba konek untuk baca MAC asli
            // Batasi jumlah koneksi simultan (maks 3)
            if (!info.identified && connectingDevices.size < 3 && connectingDevices[address] != true) {
                scope.launch { konekDanBacaMAC(device) }
            }
            
            // Jika sudah identifikasi, kirim ke server
            if (info.identified && info.realMac != null) {
                onBleDetected?.invoke(info.realMac, rssi, info.name ?: "")
                scope.launch { kirimDeteksi(info) }
            }
            
            onDeviceDetected?.invoke(info)
            updateNotification()
        }

        override fun onScanFailed(errorCode: Int) {
            onStatusChanged?.invoke("❌ Scan gagal: $errorCode")
            isScanning = false
        }
    }

    private suspend fun konekDanBacaMAC(device: BluetoothDevice) {
        val address = device.address
        if (macCache.containsKey(address)) return
        if (connectingDevices[address] == true) return
        connectingDevices[address] = true
        
        Log.d(TAG, "Connecting to $address...")
        onStatusChanged?.invoke("🔗 Menghubungkan ke ${device.name ?: address}...")
        
        /* fix S4: referensi gatt dipegang di luar coroutine — bila koneksi timeout,
           handle tetap di-disconnect/close (dulu bocor; Android membatasi ±32 GATT client) */
        var gatt: BluetoothGatt? = null
        try {
            withTimeout(10_000) {
                suspendCancellableCoroutine<Unit> { cont ->
                    val cb = object : BluetoothGattCallback() {
                        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                            if (newState == BluetoothProfile.STATE_CONNECTED) {
                                g.discoverServices()
                            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                                if (cont.isActive) cont.resume(Unit) {}
                            }
                        }
                        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                val svc = g.getService(UUID.fromString(FFE0_SERVICE))
                                val chr = svc?.getCharacteristic(UUID.fromString(FFE3_CHAR))
                                if (chr != null) {
                                    @Suppress("DEPRECATION")
                                    g.readCharacteristic(chr)
                                } else if (cont.isActive) cont.resume(Unit) {}
                            } else if (cont.isActive) cont.resume(Unit) {}
                        }
                        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
                            @Suppress("DEPRECATION")
                            val nilai = c.value
                            if (status == BluetoothGatt.GATT_SUCCESS && nilai?.size == 6) {
                                val mac = nilai.joinToString(":") { String.format("%02X", it) }
                                Log.d(TAG, "Real MAC: $mac")
                                macCache[address] = mac
                                realMacToAddr[mac] = address   // Fase 1: agar bisa bunyikan kemudian
                                saveMacCache()
                                
                                val existing = detectedDevices[address]
                                if (existing != null) {
                                    detectedDevices[address] = existing.copy(realMac = mac, identified = true)
                                    onBleDetected?.invoke(mac, existing.rssi, existing.name ?: "")
                                    onStatusChanged?.invoke("✅ $mac teridentifikasi")
                                    scope.launch { kirimDeteksi(detectedDevices[address]!!) }
                                }
                            }
                            if (cont.isActive) cont.resume(Unit) {}
                        }
                    }
                    gatt = device.connectGatt(this@BleService, false, cb)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal konek: ${e.message}")
        } finally {
            try { gatt?.disconnect(); gatt?.close() } catch (e: Exception) {}
            connectingDevices.remove(address)
        }
    }

    private suspend fun kirimDeteksi(info: DeviceInfo) {
        if (info.realMac == null) return
        try {
            val json = gson.toJson(mapOf(
                "mac_tag" to info.realMac,
                "device_id" to deviceId,
                "lat" to lastLat,
                "lng" to lastLng,
                "rssi" to info.rssi,
                "sumber" to "native"
            ))
            val body = RequestBody.create(JSON_TYPE, json)
            val req = Request.Builder().url("$serverUrl/api/pub/deteksi").post(body).build()
            httpClient.newCall(req).execute().use { resp ->   // fix S5: response ditutup (dulu bocor)
                if (!resp.isSuccessful) Log.w(TAG, "deteksi HTTP ${resp.code}")
            }
        } catch (e: Exception) { Log.e(TAG, "Gagal kirim deteksi", e) }
    }

    private suspend fun kirimDataKawal() {
        if (!isScanning) return
        val list = detectedDevices.values
            .filter { System.currentTimeMillis() - it.lastSeen < 60_000 && it.realMac != null }
            .map { mapOf("mac" to it.realMac!!, "rssi" to it.rssi) }
        if (list.isEmpty()) return
        try {
            val json = gson.toJson(mapOf(
                "rombongan_id" to rombonganId,
                "device_id" to deviceId,
                "lat" to lastLat,
                "lng" to lastLng,
                "deteksi" to list
            ))
            val body = RequestBody.create(JSON_TYPE, json)
            val req = Request.Builder().url("$serverUrl/api/pub/kawal").post(body).build()
            httpClient.newCall(req).execute().use { resp ->   // fix S5: response ditutup (dulu bocor)
                if (!resp.isSuccessful) Log.w(TAG, "kawal HTTP ${resp.code}")
            }
        } catch (e: Exception) { Log.e(TAG, "Gagal kirim kawal", e) }
    }

    /* fix K6: versi lama memanggil getService() tepat setelah CONNECTED tanpa discoverServices()
       → selalu null → gelang tidak pernah berbunyi (gagal senyap). Sekarang alurnya:
       connect → discoverServices → onServicesDiscovered → tulis Alert Level (0x2A06).
       Sekalian pakai API tulis Android 13+ (writeCharacteristic dengan writeType). */
    @Suppress("DEPRECATION")
    private fun tulisAlert(gatt: BluetoothGatt, chr: BluetoothGattCharacteristic, nilai: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(chr, byteArrayOf(nilai.toByte()), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        } else {
            chr.value = byteArrayOf(nilai.toByte())
            gatt.writeCharacteristic(chr)
        }
    }

    private suspend fun konekSiapTulis(device: BluetoothDevice): BluetoothGatt? {
        var gatt: BluetoothGatt? = null
        try {
            withTimeout(12_000) {
                suspendCancellableCoroutine<Unit> { cont ->
                    val cb = object : BluetoothGattCallback() {
                        override fun onConnectionStateChange(g: BluetoothGatt, s: Int, ns: Int) {
                            if (ns == BluetoothProfile.STATE_CONNECTED) g.discoverServices()
                            else if (ns == BluetoothProfile.STATE_DISCONNECTED && cont.isActive) cont.resume(Unit) {}
                        }
                        override fun onServicesDiscovered(g: BluetoothGatt, s: Int) {
                            if (cont.isActive) cont.resume(Unit) {}
                        }
                    }
                    gatt = device.connectGatt(this@BleService, false, cb)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal konek utk tulis: ${e.message}")
            try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) {}
            return null
        }
        return gatt
    }

    /** Fase 1: cari device dari realMAC / alamat iklan — bekerja walau sedang tidak ter-scan.
     *  Seperti iSearching: reconnect langsung via alamat yang tersimpan (realMacToAddr/macCache),
     *  tidak bergantung pada detectedDevices (yang dibersihkan tiap 120s). */
    private fun cariDevice(targetMac: String): DeviceInfo? {
        val t = targetMac.trim().uppercase()
        // 1) dari perangkat yang terdeteksi (live) berdasarkan realMac atau address
        detectedDevices.values.firstOrNull { it.realMac?.equals(t, ignoreCase = true) == true || it.address.equals(t, ignoreCase = true) }
            ?.let { return it }
        // 2) dari peta terbalik realMac → address (persisten) → konek langsung
        val addr = realMacToAddr[t] ?: macCache.entries.firstOrNull { it.value.equals(t, ignoreCase = true) }?.key
        if (addr != null) {
            detectedDevices[addr]?.let { return it }
            return try {
                val device = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
                    .adapter.getRemoteDevice(addr)
                DeviceInfo(addr, t, null, 0, System.currentTimeMillis(), true)
            } catch (_: Exception) { null }
        }
        return null
    }

    /** Fase 1: tulis Alert Level (0x2A06) dengan umpan balik → tidak lagi gagal senyap. */
    private suspend fun tulisAlertLevel(info: DeviceInfo, level: Int): Boolean {
        var gattConn: BluetoothGatt? = null
        return try {
            val device = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
                .adapter.getRemoteDevice(info.address)
            gattConn = konekSiapTulis(device)
            val svc = gattConn?.getService(UUID.fromString(ALERT_SERVICE))
            val chr = svc?.getCharacteristic(UUID.fromString(ALERT_CHAR))
            if (gattConn != null && chr != null) {
                tulisAlert(gattConn, chr, level)
                true
            } else {
                Log.w(TAG, "Karakteristik alert (0x2A06) tidak ditemukan di ${info.address}")
                onStatusChanged?.invoke("⚠️ ${info.address} tidak mendukung perintah bunyi")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal tulis alert", e)
            onStatusChanged?.invoke("⚠️ Gagal konek ke gelang ${info.address}: ${e.message}")
            false
        } finally { try { gattConn?.disconnect(); gattConn?.close() } catch (e: Exception) {} }
    }

    suspend fun bunyikanGelang(targetMac: String) {
        val info = cariDevice(targetMac)
        if (info == null) { onStatusChanged?.invoke("⚠️ Gelang $targetMac tidak dikenal"); return }
        onStatusChanged?.invoke("🔊 Bunyikan ${info.address}...")
        if (tulisAlertLevel(info, 2)) {
            delay(3000)
            tulisAlertLevel(info, 0)
        }
    }

    fun stopBeeping(targetMac: String) {
        scope.launch {
            val info = cariDevice(targetMac) ?: return@launch
            if (tulisAlertLevel(info, 0)) onStatusChanged?.invoke("🔇 Stop ${info.address}")
        }
    }

    private fun createNotification(text: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pi = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, IphiApp.CHANNEL_BLE)
            .setContentTitle("IPHI")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notif)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification() {
        /* fix S6: throttle — dulu dipanggil tiap iklan BLE (bisa ratusan/detik) → spam & boros baterai */
        val now = System.currentTimeMillis()
        if (now - lastNotifUpdate < 5_000) return
        lastNotifUpdate = now
        val count = detectedDevices.values.count { it.identified }
        val text = if (count > 0) "📡 $count gelang terdeteksi" else "🔍 Mencari gelang..."
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, createNotification(text))
    }

    override fun onDestroy() {
        stopScanning()
        scope.cancel()   // aman: hanya saat service benar-benar dihancurkan
        super.onDestroy()
    }
}
