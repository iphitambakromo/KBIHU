package id.iphi.radar

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Scanner BLE — native Android memberi MAC asli tiap perangkat (tidak seperti browser). */
class BleScanner(private val context: Context) {
    private val manager: BluetoothManager? =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

    fun tersedia(): Boolean {
        val a = manager?.adapter
        return a != null && a.isEnabled
    }

    @SuppressLint("MissingPermission")
    fun mulai(onResult: (ScanResult) -> Unit) {
        val scanner = manager?.adapter?.bluetoothLeScanner ?: return
        if (aktif != null) return
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                result?.let { onResult(it) }
            }
        }
        aktif = cb
        try {
            scanner.startScan(emptyList(), null, cb)
        } catch (e: Exception) {
            aktif = null
        }
    }

    @SuppressLint("MissingPermission")
    fun henti() {
        val cb = aktif ?: return
        aktif = null
        try {
            manager?.adapter?.bluetoothLeScanner?.stopScan(cb)
        } catch (e: Exception) {
        }
    }

    private var aktif: ScanCallback? = null
}

/**
 * Bunyi tag via GATT: coba servis baterai (0x1802, char 0x2A06 = control point),
 * fallback servis iTag (0xFFF0, char writable). Tag iTag juga bunyi saat tersambung/terputus.
 */
object Gatt {
    private val SVC_BATTERY = UUID.fromString("00001802-0000-1000-8000-00805F9B34FB")
    private val CH_CPC = UUID.fromString("00002A06-0000-1000-8000-00805F9B34FB")
    private val SVC_ITAG = UUID.fromString("0000FFF0-0000-1000-8000-00805F9B34FB")

    /** Jalankan di thread terpisah; hasil via [done] di main thread. */
    fun bunyi(context: Context, device: BluetoothDevice, done: (String) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        val t = Thread {
            val pesan = try {
                val latch = CountDownLatch(1)
                var gatt: BluetoothGatt? = null
                gatt = device.connectGatt(context, false, object : android.bluetooth.BluetoothGattCallback() {
                    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                        if (newState != BluetoothProfile.STATE_CONNECTED && newState != BluetoothProfile.STATE_DISCONNECTED) return
                        latch.countDown()
                    }
                })
                if (!latch.await(10, TimeUnit.SECONDS)) {
                    try { gatt?.close() } catch (e: Exception) {}
                    "timeout koneksi ke tag"
                } else if (gatt?.isConnected != true) {
                    try { gatt?.close() } catch (e: Exception) {}
                    "gagal konek ke tag"
                } else {
                    val g = gatt!!
                    var hasil = ""
                    try {
                        g.discoverServices()
                        Thread.sleep(800)
                        // 1) battery control point
                        val sv = g.getService(SVC_BATTERY)
                        val ch = sv?.getCharacteristic(CH_CPC)
                        if (ch != null) {
                            try { ch.value = byteArrayOf(2); g.writeCharacteristic(ch) } catch (e: Exception) {}
                            Thread.sleep(3500)
                            try { ch.value = byteArrayOf(0); g.writeCharacteristic(ch) } catch (e: Exception) {}
                            hasil = "servis baterai"
                        }
                        // 2) fallback servis iTag 0xFFF0
                        if (hasil.isEmpty()) {
                            val sv2 = g.getService(SVC_ITAG)
                            if (sv2 != null) {
                                val w = sv2.characteristics.firstOrNull { c ->
                                    (c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0 ||
                                        (c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
                                }
                                if (w != null) {
                                    try { w.value = byteArrayOf(1); g.writeCharacteristic(w) } catch (e: Exception) {}
                                    Thread.sleep(3500)
                                    hasil = "servis iTag"
                                }
                            }
                        }
                        if (hasil.isEmpty()) hasil = "tag tanpa servis bunyi (bunyi saat tersambung/terputus?)"
                    } catch (e: Exception) {
                        hasil = "gagal GATT: ${e.message}"
                    }
                    try { g.close() } catch (e: Exception) {}
                    hasil
                }
            } catch (e: Exception) {
                "gagal konek: ${e.message}"
            }
            main.post { done(pesan) }
        }
        t.start()
    }
}
