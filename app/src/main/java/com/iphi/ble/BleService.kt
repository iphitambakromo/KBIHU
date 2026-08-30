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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.*
import java.util.concurrent.ConcurrentHashMap

class BleService : Service() {
    companion object {
        private const val TAG = "BleService"
        private const val NOTIFICATION_ID = 1001
        private const val KAWAL_INTERVAL = 30_000L
        private const val DETEKSI_THROTTLE = 30_000L  // 30 detik per device
        private const val MAX_GATT_CONNECTIONS = 3
        private const val FFE0_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb"
        private const val FFE3_CHAR = "0000ffe3-0000-1000-8000-00805f9b34fb"
        private const val ALERT_SERVICE = "00001802-0000-1000-8000-00805f9b34fb"
        private const val ALERT_CHAR = "00002a06-0000-1000-8000-00805f9b34fb"
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    private var scanner: BluetoothLeScanner? = null
    private var isScanning = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .writeTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .build()
    private val gson = Gson()

    val detectedDevices = ConcurrentHashMap<String, DeviceInfo>()
    private val macCache = ConcurrentHashMap<String, String>()
    private val connectingDevices = ConcurrentHashMap<String, Boolean>()
    private val lastDeteksiTime = ConcurrentHashMap<String, Long>()
    private val offlineQueue = mutableListOf<Map<String, Any>>()

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
        val battery: Int = -1,
        val identified: Boolean = false
    )

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        val bm = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        scanner = bm.adapter?.bluetoothLeScanner
        deviceId = getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE)
            .getString(IphiApp.PREF_DEVICE_ID, "${Build.MANUFACTURER}_${Build.MODEL}") ?: "${Build.MANUFACTURER}_${Build.MODEL}"
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
            "STOP_BEEP" -> {
                val mac = intent.getStringExtra("mac") ?: ""
                if (mac.isNotEmpty()) scope.launch { stopBunyikanGelang(mac) }
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

            // Kirim data kawal periodik
            scope.launch {
                while (isScanning) {
                    delay(KAWAL_INTERVAL)
                    kirimDataKawal()
                }
            }

            // Bersihkan device lama & update notifikasi
            scope.launch {
                while (isScanning) {
                    delay(60_000)
                    val now = System.currentTimeMillis()
                    detectedDevices.entries.removeAll { now - it.value.lastSeen > 120_000 }
                    updateNotification()
                }
            }

            // Flush offline queue
            scope.launch {
                while (isScanning) {
                    delay(15_000)
                    flushOfflineQueue()
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
        scope.cancel()
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
            val isITag = name?.contains("iTAG", ignoreCase = true) == true ||
                         detectedDevices.containsKey(address) ||
                         macCache.containsKey(address)

            // Jangan proses device yang tidak dikenal dan sinyal lemah
            if (!isITag && rssi < -70) return

            Log.d(TAG, "BLE: $address ($name) RSSI: $rssi")

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
            // Batasi jumlah koneksi simultan
            if (!info.identified && connectingDevices.size < MAX_GATT_CONNECTIONS && connectingDevices[address] != true) {
                scope.launch { konekDanBacaMAC(device) }
            }

            // Jika sudah identifikasi, kirim ke server (throttled)
            if (info.identified && info.realMac != null) {
                onBleDetected?.invoke(info.realMac, rssi, info.name ?: "")
                val now = System.currentTimeMillis()
                val lastTime = lastDeteksiTime[info.realMac] ?: 0L
                if (now - lastTime > DETEKSI_THROTTLE) {
                    lastDeteksiTime[info.realMac!!] = now
                    scope.launch { kirimDeteksi(info) }
                }
            }

            onDeviceDetected?.invoke(info)
            updateNotification()
        }

        override fun onScanFailed(errorCode: Int) {
            val msg = when (errorCode) {
                SCAN_FAILED_ALREADY_STARTED -> "Scan sudah berjalan"
                SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "Gagal registrasi"
                SCAN_FAILED_INTERNAL_ERROR -> "Error internal"
                SCAN_FAILED_FEATURE_UNSUPPORTED -> "BLE tidak didukung"
                else -> "Error: $errorCode"
            }
            onStatusChanged?.invoke("❌ $msg")
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

        var gatt: BluetoothGatt? = null
        try {
            gatt = withTimeout(10_000) {
                suspendCancellableCoroutine { cont ->
                    val cb = object : BluetoothGattCallback() {
                        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                            if (newState == BluetoothProfile.STATE_CONNECTED) {
                                Log.d(TAG, "Connected to $address, discovering services...")
                                g.discoverServices()
                            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                                Log.d(TAG, "Disconnected from $address")
                                if (cont.isActive) cont.resume(g) {}
                            }
                        }
                        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                val svc = g.getService(UUID.fromString(FFE0_SERVICE))
                                val chr = svc?.getCharacteristic(UUID.fromString(FFE3_CHAR))
                                if (chr != null) {
                                    Log.d(TAG, "Reading ffe3 from $address...")
                                    g.readCharacteristic(chr)
                                } else {
                                    Log.w(TAG, "ffe3 not found on $address")
                                    if (cont.isActive) cont.resume(g) {}
                                }
                            } else {
                                Log.w(TAG, "Service discovery failed: $status")
                                if (cont.isActive) cont.resume(g) {}
                            }
                        }
                        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
                            if (status == BluetoothGatt.GATT_SUCCESS && c.value?.size == 6) {
                                val mac = c.value.joinToString(":") { String.format("%02X", it) }
                                Log.d(TAG, "✅ Real MAC: $mac (from $address)")
                                macCache[address] = mac
                                saveMacCache()

                                val existing = detectedDevices[address]
                                if (existing != null) {
                                    detectedDevices[address] = existing.copy(realMac = mac, identified = true)
                                    onBleDetected?.invoke(mac, existing.rssi, existing.name ?: "")
                                    onStatusChanged?.invoke("✅ $mac teridentifikasi")
                                    scope.launch { kirimDeteksi(detectedDevices[address]!!) }
                                }
                            } else {
                                Log.w(TAG, "ffe3 read failed: status=$status, size=${c.value?.size}")
                            }
                            if (cont.isActive) cont.resume(g) {}
                        }
                    }
                    device.connectGatt(this@BleService, false, cb)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal konek $address: ${e.message}")
        } finally {
            try { gatt?.disconnect(); gatt?.close() } catch (e: Exception) {}
            connectingDevices.remove(address)
        }
    }

    private suspend fun kirimDeteksi(info: DeviceInfo) {
        if (info.realMac == null) return
        val json = gson.toJson(mapOf(
            "mac_tag" to info.realMac,
            "device_id" to deviceId,
            "lat" to lastLat,
            "lng" to lastLng,
            "rssi" to info.rssi,
            "sumber" to "native"
        ))
        try {
            val body = json.toRequestBody(JSON_TYPE)
            val req = Request.Builder().url("$serverUrl/api/pub/deteksi").post(body).build()
            httpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "Deteksi response: ${resp.code}")
                    addToOfflineQueue(json)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal kirim deteksi", e)
            addToOfflineQueue(json)
        }
    }

    private suspend fun kirimDataKawal() {
        if (!isScanning) return
        val list = detectedDevices.values
            .filter { System.currentTimeMillis() - it.lastSeen < 60_000 && it.realMac != null }
            .map { mapOf("mac" to it.realMac!!, "rssi" to it.rssi) }
        if (list.isEmpty()) return
        val json = gson.toJson(mapOf(
            "rombongan_id" to rombonganId,
            "device_id" to deviceId,
            "lat" to lastLat,
            "lng" to lastLng,
            "deteksi" to list
        ))
        try {
            val body = json.toRequestBody(JSON_TYPE)
            val req = Request.Builder().url("$serverUrl/api/pub/kawal").post(body).build()
            httpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) Log.w(TAG, "Kawal response: ${resp.code}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal kirim kawal", e)
        }
    }

    private fun addToOfflineQueue(json: String) {
        synchronized(offlineQueue) {
            offlineQueue.add(mapOf("json" to json, "time" to System.currentTimeMillis()))
            if (offlineQueue.size > 200) offlineQueue.removeFirst()
        }
    }

    private suspend fun flushOfflineQueue() {
        val items: List<Map<String, Any>>
        synchronized(offlineQueue) {
            if (offlineQueue.isEmpty()) return
            items = offlineQueue.toList()
        }
        val toRemove = mutableListOf<Map<String, Any>>()
        for (item in items) {
            try {
                val json = item["json"] as String
                val body = json.toRequestBody(JSON_TYPE)
                val req = Request.Builder().url("$serverUrl/api/pub/deteksi").post(body).build()
                httpClient.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) toRemove.add(item)
                }
            } catch (_: Exception) {}
        }
        synchronized(offlineQueue) { offlineQueue.removeAll(toRemove) }
        if (toRemove.isNotEmpty()) Log.d(TAG, "Flushed ${toRemove.size} offline items")
    }

    /**
     * Bunyikan gelang via Immediate Alert Service (0x1802 / 0x2A06)
     * Kompatibel Android 13+ (API 33) dengan writeCharacteristic(chr, value, writeType)
     */
    suspend fun bunyikanGelang(targetMac: String) {
        // Cari address BLE dari MAC asli
        val entry = detectedDevices.entries.find { it.value.realMac == targetMac || it.key == targetMac }
        if (entry == null) {
            Log.w(TAG, "Device $targetMac not found for bunyikan")
            onStatusChanged?.invoke("⚠️ Gelang $targetMac tidak ditemukan")
            return
        }

        val address = entry.key
        Log.d(TAG, "Bunyikan: $targetMac → $address")

        try {
            val device = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
                .adapter.getRemoteDevice(address)
            val gattConn = withTimeout(8_000) {
                suspendCancellableCoroutine<BluetoothGatt> { cont ->
                    device.connectGatt(this@BleService, false, object : BluetoothGattCallback() {
                        override fun onConnectionStateChange(g: BluetoothGatt, s: Int, ns: Int) {
                            if (ns == BluetoothProfile.STATE_CONNECTED) {
                                g.discoverServices()
                            } else if (ns == BluetoothProfile.STATE_DISCONNECTED) {
                                if (cont.isActive) try { cont.resume(g) {} } catch (_: Exception) {}
                            }
                        }
                        override fun onServicesDiscovered(g: BluetoothGatt, s: Int) {
                            if (cont.isActive) cont.resume(g) {}
                        }
                    })
                }
            }
            try {
                val svc = gattConn.getService(UUID.fromString(ALERT_SERVICE))
                val chr = svc?.getCharacteristic(UUID.fromString(ALERT_CHAR))
                if (chr != null) {
                    // Android 13+ API
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gattConn.writeCharacteristic(chr, byteArrayOf(2), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                    } else {
                        @Suppress("DEPRECATION")
                        chr.value = byteArrayOf(2)
                        @Suppress("DEPRECATION")
                        gattConn.writeCharacteristic(chr)
                    }
                    onStatusChanged?.invoke("🔔 Menyala: $targetMac")
                    delay(3000)
                    // Stop
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gattConn.writeCharacteristic(chr, byteArrayOf(0), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                    } else {
                        @Suppress("DEPRECATION")
                        chr.value = byteArrayOf(0)
                        @Suppress("DEPRECATION")
                        gattConn.writeCharacteristic(chr)
                    }
                } else {
                    Log.w(TAG, "Alert characteristic not found")
                    onStatusChanged?.invoke("⚠️ Karakteristik alert tidak ditemukan")
                }
            } finally {
                gattConn.disconnect(); gattConn.close()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal bunyikan $targetMac", e)
            onStatusChanged?.invoke("❌ Gagal bunyikan: ${e.message}")
        }
    }

    /**
     * Stop bunyikan gelang
     */
    suspend fun stopBunyikanGelang(targetMac: String) {
        val entry = detectedDevices.entries.find { it.value.realMac == targetMac || it.key == targetMac }
        if (entry == null) return

        try {
            val device = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
                .adapter.getRemoteDevice(entry.key)
            val gattConn = withTimeout(8_000) {
                suspendCancellableCoroutine<BluetoothGatt> { cont ->
                    device.connectGatt(this@BleService, false, object : BluetoothGattCallback() {
                        override fun onConnectionStateChange(g: BluetoothGatt, s: Int, ns: Int) {
                            if (ns == BluetoothProfile.STATE_CONNECTED) {
                                g.discoverServices()
                            } else if (ns == BluetoothProfile.STATE_DISCONNECTED) {
                                if (cont.isActive) try { cont.resume(g) {} } catch (_: Exception) {}
                            }
                        }
                        override fun onServicesDiscovered(g: BluetoothGatt, s: Int) {
                            if (cont.isActive) cont.resume(g) {}
                        }
                    })
                }
            }
            try {
                val svc = gattConn.getService(UUID.fromString(ALERT_SERVICE))
                val chr = svc?.getCharacteristic(UUID.fromString(ALERT_CHAR))
                if (chr != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gattConn.writeCharacteristic(chr, byteArrayOf(0), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                    } else {
                        @Suppress("DEPRECATION")
                        chr.value = byteArrayOf(0)
                        @Suppress("DEPRECATION")
                        gattConn.writeCharacteristic(chr)
                    }
                }
            } finally {
                gattConn.disconnect(); gattConn.close()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal stop bunyikan $targetMac", e)
        }
    }

    // Legacy wrapper (dipanggil dari MainActivity)
    fun stopBeeping(targetMac: String) {
        scope.launch { stopBunyikanGelang(targetMac) }
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
        val count = detectedDevices.values.count { it.identified }
        val text = if (count > 0) "📡 $count gelang terdeteksi" else "🔍 Mencari gelang..."
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, createNotification(text))
    }

    override fun onDestroy() {
        stopScanning()
        super.onDestroy()
    }
}
