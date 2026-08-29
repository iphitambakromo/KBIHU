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
        private const val KAWAL_INTERVAL = 30_000L
        private const val FFE0_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb"
        private const val FFE3_CHAR = "0000ffe3-0000-1000-8000-00805f9b34fb"
        private const val ALERT_SERVICE = "00001802-0000-1000-8000-00805f9b34fb"
        private const val ALERT_CHAR = "00002a06-0000-1000-8000-00805f9b34fb"
        private val JSON_TYPE: MediaType = "application/json; charset=utf-8".toMediaType()
    }

    private var scanner: BluetoothLeScanner? = null
    private var isScanning = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val httpClient = OkHttpClient()
    private val gson = Gson()
    
    val detectedDevices = ConcurrentHashMap<String, DeviceInfo>()
    private val macCache = ConcurrentHashMap<String, String>()
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
        deviceId = "${Build.MANUFACTURER}_${Build.MODEL}_${Build.SERIAL ?: System.currentTimeMillis()}"
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
            
            scope.launch {
                while (isScanning) {
                    delay(KAWAL_INTERVAL)
                    kirimDataKawal()
                }
            }
            
            scope.launch {
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
            
            val isITag = name?.contains("iTAG", ignoreCase = true) == true || 
                         detectedDevices.containsKey(address) ||
                         macCache.containsKey(address)
            
            if (!isITag && detectedDevices.isEmpty()) return
            
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
            
            if (!info.identified && connectingDevices[address] != true) {
                scope.launch { konekDanBacaMAC(device) }
            }
            
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
        
        var gatt: BluetoothGatt? = null
        try {
            gatt = withTimeout(10_000) {
                suspendCancellableCoroutine { cont ->
                    val cb = object : BluetoothGattCallback() {
                        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                            if (newState == BluetoothProfile.STATE_CONNECTED) {
                                g.discoverServices()
                            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                                if (cont.isActive) cont.resume(g) {}
                            }
                        }
                        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                val svc = g.getService(UUID.fromString(FFE0_SERVICE))
                                val chr = svc?.getCharacteristic(UUID.fromString(FFE3_CHAR))
                                if (chr != null) g.readCharacteristic(chr)
                                else if (cont.isActive) cont.resume(g) {}
                            } else if (cont.isActive) cont.resume(g) {}
                        }
                        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
                            if (status == BluetoothGatt.GATT_SUCCESS && c.value?.size == 6) {
                                val mac = c.value.joinToString(":") { String.format("%02X", it) }
                                Log.d(TAG, "Real MAC: $mac")
                                macCache[address] = mac
                                saveMacCache()
                                
                                val existing = detectedDevices[address]
                                if (existing != null) {
                                    detectedDevices[address] = existing.copy(realMac = mac, identified = true)
                                    onBleDetected?.invoke(mac, existing.rssi, existing.name ?: "")
                                    onStatusChanged?.invoke("✅ $mac teridentifikasi")
                                    scope.launch { kirimDeteksi(detectedDevices[address]!!) }
                                }
                            }
                            if (cont.isActive) cont.resume(g) {}
                        }
                    }
                    device.connectGatt(this@BleService, false, cb)
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
            httpClient.newCall(req).execute()
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
            httpClient.newCall(req).execute()
        } catch (e: Exception) { Log.e(TAG, "Gagal kirim kawal", e) }
    }

    suspend fun bunyikanGelang(targetMac: String) {
        for ((_, info) in detectedDevices) {
            if (info.realMac == targetMac || info.address == targetMac) {
                try {
                    val device = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
                        .adapter.getRemoteDevice(info.address)
                    val gattConn = withTimeout(8_000) {
                        suspendCancellableCoroutine<BluetoothGatt> { cont ->
                            device.connectGatt(this@BleService, false, object : BluetoothGattCallback() {
                                override fun onConnectionStateChange(g: BluetoothGatt, s: Int, ns: Int) {
                                    if (ns == BluetoothProfile.STATE_CONNECTED) {
                                        if (cont.isActive) cont.resume(g) {}
                                    }
                                }
                            })
                        }
                    }
                    try {
                        val svc = gattConn.getService(UUID.fromString(ALERT_SERVICE))
                        val chr = svc?.getCharacteristic(UUID.fromString(ALERT_CHAR))
                        if (chr != null) {
                            chr.value = byteArrayOf(2)
                            gattConn.writeCharacteristic(chr)
                            delay(3000)
                            chr.value = byteArrayOf(0)
                            gattConn.writeCharacteristic(chr)
                        }
                    } finally {
                        gattConn.disconnect(); gattConn.close()
                    }
                } catch (e: Exception) { Log.e(TAG, "Gagal bunyikan", e) }
                break
            }
        }
    }

    fun stopBeeping(targetMac: String) {
        scope.launch {
            for ((_, info) in detectedDevices) {
                if (info.realMac == targetMac || info.address == targetMac) {
                    try {
                        val device = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
                            .adapter.getRemoteDevice(info.address)
                        device.connectGatt(this@BleService, false, object : BluetoothGattCallback() {
                            override fun onConnectionStateChange(g: BluetoothGatt, s: Int, ns: Int) {
                                if (ns == BluetoothProfile.STATE_CONNECTED) {
                                    try {
                                        val svc = g.getService(UUID.fromString(ALERT_SERVICE))
                                        val chr = svc?.getCharacteristic(UUID.fromString(ALERT_CHAR))
                                        if (chr != null) {
                                            chr.value = byteArrayOf(0)
                                            g.writeCharacteristic(chr)
                                        }
                                    } finally { g.disconnect(); g.close() }
                                }
                            }
                        })
                    } catch (e: Exception) {}
                    break
                }
            }
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
