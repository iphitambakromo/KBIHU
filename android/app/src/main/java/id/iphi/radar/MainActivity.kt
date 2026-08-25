package id.iphi.radar

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

const val BASE_DEFAULT = "https://traking.iphi-haji.workers.dev"

/** Semua state observable app — diupdate dari main thread agar Compose recompose. */
class RadarModel(val ctx: Context) {
    val main = Handler(Looper.getMainLooper())
    private val ble = BleScanner(ctx)

    val base = mutableStateOf(BASE_DEFAULT)
    val token = mutableStateOf<String?>(null)
    val userLabel = mutableStateOf("")
    val jamaahList = mutableStateOf<List<Jamaah>>(emptyList())
    val macMap = mutableStateOf<Map<String, Jamaah>>(emptyMap())
    val devices = mutableStateOf<Map<String, DevRow>>(emptyMap())
    val scanAktif = mutableStateOf(false)
    val statusPesan = mutableStateOf("")
    val gpsPesan = mutableStateOf("📍 GPS belum ada")
    val sedangBunyi = mutableStateOf<String?>(null)
    val macDicatat = mutableStateOf<String?>(null)

    private var gpsTerakhir: Location? = null
    private var lastLaporTime = 0L
    private var lastLaporRssi = 0
    private var lastLaporLat: Double? = null
    private var lastLaporLng: Double? = null
    private var tickJob: Runnable? = null

    private val lokasiListener = LocationListener { loc ->
        gpsTerakhir = loc
        main.post {
            gpsPesan.value = "📍 GPS ±" + Math.round(loc.accuracy).toInt() + " m — posisi dilaporkan otomatis"
        }
    }

    init {
        val p = ctx.getSharedPreferences("radar_iphi", Context.MODE_PRIVATE)
        val tok = p.getString("tok", null)
        if (!tok.isNullOrBlank()) {
            token.value = tok
            base.value = p.getString("base", BASE_DEFAULT) ?: BASE_DEFAULT
        }
    }

    fun login(baseUrl: String, user: String, sandi: String, done: (Boolean, String) -> Unit) {
        Thread {
            val (code, d) = Api.post(baseUrl, "/api/login", null,
                JSONObject().put("user", user.trim()).put("sandi", sandi))
            main.post {
                if (code in 200..299 && d.optBoolean("ok")) {
                    base.value = baseUrl
                    token.value = d.optString("token")
                    userLabel.value = d.optString("nama", user) + " (" + d.optString("peran", "") + ")"
                    ctx.getSharedPreferences("radar_iphi", Context.MODE_PRIVATE).edit()
                        .putString("tok", d.optString("token")).putString("base", baseUrl).apply()
                    muatState()
                    mulaiGps()
                    mulaiTick()
                    done(true, "")
                } else {
                    done(false, d.optString("error", "gagal masuk"))
                }
            }
        }.start()
    }

    fun logout() {
        hentiScan()
        stopTick()
        token.value = null
        userLabel.value = ""
        devices.value = emptyMap()
        statusPesan.value = ""
        ctx.getSharedPreferences("radar_iphi", Context.MODE_PRIVATE).edit().clear().apply()
    }

    /** Muat jamaah + macMap dari /api/state. */
    fun muatState() {
        val tok = token.value ?: return
        Thread {
            val (code, d) = Api.get(base.value, "/api/state", tok)
            if (code !in 200..299) {
                main.post { statusPesan.value = "❌ " + d.optString("error", "gagal muat") }
                return@Thread
            }
            val list = mutableListOf<Jamaah>()
            val arr = d.optJSONArray("jamaah")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    list.add(Jamaah(
                        o.optString("id"), o.optString("nama"), o.optString("regu"),
                        normalizeMac(o.optString("mac_tag")), o.optBoolean("punya_gelang")))
                }
            }
            val map = list.filter { it.macTag.isNotEmpty() }.associateBy { it.macTag }
            main.post {
                jamaahList.value = list
                macMap.value = map
            }
        }.start()
    }

    fun mulaiScan() {
        if (scanAktif.value) return
        if (!ble.tersedia()) {
            main.post { statusPesan.value = "❌ Bluetooth tidak aktif — aktifkan dulu" }
            return
        }
        devices.value = emptyMap()
        ble.mulai { result ->
            val mac = result.device.address
            var nama: String? = null
            try { nama = result.device.name } catch (e: Exception) {}
            main.post {
                devices.value = devices.value + (mac to DevRow(mac, result.rssi, nama, System.currentTimeMillis()))
            }
        }
        main.post {
            scanAktif.value = true
            statusPesan.value = "🔵 Scan berjalan — tag yang terdaftar (MAC) langsung dikenali"
        }
    }

    fun hentiScan() {
        ble.henti()
        main.post { scanAktif.value = false }
    }

    fun bunyi(mac: String) {
        sedangBunyi.value = "🔊 Konek ke tag " + mac.takeLast(5) + "…"
        val device: BluetoothDevice? = try {
            (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager)
                ?.adapter?.getDevice(mac)
        } catch (e: Exception) { null }
        if (device == null) {
            main.post { sedangBunyi.value = "❌ Tag tidak ditemukan — dekatkan & scan lagi" }
            return
        }
        Gatt.bunyi(ctx, device) { hasil ->
            main.post {
                sedangBunyi.value = "🔊 " + hasil
            }
        }
    }

    /** Catat MAC (dari scan) ke jamaah terpilih — PUT /api/jamaah {mac_tag}. */
    fun simpanMac(mac: String, jamaahId: String) {
        val tok = token.value ?: return
        Thread {
            val (code, d) = Api.put(base.value, "/api/jamaah", tok,
                JSONObject().put("id", jamaahId).put("mac_tag", mac))
            main.post {
                if (code in 200..299) {
                    val nama = jamaahList.value.find { it.id == jamaahId }?.nama ?: jamaahId
                    statusPesan.value = "✅ MAC $mac → $nama"
                    macDicatat.value = null
                    muatState()
                } else {
                    statusPesan.value = "❌ " + d.optString("error", "gagal simpan")
                }
            }
        }.start()
    }

    private fun mulaiGps() {
        try {
            val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
            if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                val last = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                    ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                if (last != null) {
                    gpsTerakhir = last
                    main.post { gpsPesan.value = "📍 GPS ±" + Math.round(last.accuracy).toInt() + " m" }
                }
                lm.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, lokasiListener, main)
                lm.requestSingleUpdate(LocationManager.GPS_PROVIDER, lokasiListener, main)
            }
        } catch (e: Exception) {
        }
    }

    /** Tick 15 dtk: GPS refresh + lapor posisi tag terdaftar terkuat via /api/pub/mac (throttled). */
    private fun mulaiTick() {
        stopTick()
        val r = object : Runnable {
            override fun run() {
                try {
                    mulaiGps()
                    val dev = devices.value.values
                        .filter { macMap.value.containsKey(it.mac) }
                        .maxByOrNull { it.rssi }
                    val gps = gpsTerakhir
                    val tok = token.value
                    if (dev != null && gps != null && tok != null && perluLapor(dev, gps)) {
                        Thread {
                            val (code, d) = Api.post(base.value, "/api/pub/mac", tok, JSONObject()
                                .put("mac", dev.mac).put("rssi", dev.rssi)
                                .put("lat", gps.latitude).put("lng", gps.longitude)
                                .put("oleh", "radar-android"))
                            main.post {
                                if (code in 200..299) {
                                    lastLaporTime = System.currentTimeMillis()
                                    lastLaporRssi = dev.rssi
                                    lastLaporLat = gps.latitude
                                    lastLaporLng = gps.longitude
                                    val nama = macMap.value[dev.mac]?.nama ?: ""
                                    statusPesan.value = "📡 $nama dilaporkan · " + dev.rssi + " dBm"
                                }
                            }
                        }.start()
                    }
                } catch (e: Exception) {
                }
                main.postDelayed(this, 15000)
            }
        }
        tickJob = r
        main.postDelayed(r, 15000)
    }

    private fun stopTick() {
        tickJob?.let { main.removeCallbacks(it) }
        tickJob = null
    }

    private fun perluLapor(dev: DevRow, gps: Location): Boolean {
        val now = System.currentTimeMillis()
        if (lastLaporTime == 0L) return true
        if (now - lastLaporTime >= 90_000) return true  // refresh paksa tiap maks 90 dtk
        if (now - lastLaporTime < 30_000) return false
        val dr = Math.abs(dev.rssi - lastLaporRssi)
        val dMeters = if (lastLaporLat != null && lastLaporLng != null)
            jarakMeter(lastLaporLat!!, lastLaporLng!!, gps.latitude, gps.longitude) else 999.0
        return dr >= 4 || dMeters >= 8
    }

    fun bersihkan() {
        hentiScan()
        stopTick()
        try {
            (ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager)
                ?.removeUpdates(lokasiListener)
        } catch (e: Exception) {
        }
    }
}

class MainActivity : ComponentActivity() {
    lateinit var model: RadarModel
        private set

    private val izinLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grant ->
        if (grant.values.all { it }) model.mulaiScan()
        else model.statusPesan.value = "❌ Izin ditolak — izinkan Bluetooth & lokasi di Pengaturan HP"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        model = RadarModel(this)
        setContent { AppRoot(this) }
    }

    /** Tolak-ubah scan: minta izin bila belum, lalu mulai/hentikan. */
    fun hubungiScan() {
        if (model.scanAktif.value) {
            model.hentiScan()
            return
        }
        val list = if (Build.VERSION.SDK_INT >= 31) {
            listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.ACCESS_FINE_LOCATION)
        } else {
            listOf(Manifest.permission.BLUETOOTH, Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.ACCESS_FINE_LOCATION)
        }
        val kurang = list.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (kurang.isEmpty()) model.mulaiScan()
        else izinLauncher.launch(kurang.toTypedArray())
    }

    override fun onDestroy() {
        model.bersihkan()
        super.onDestroy()
    }
}
