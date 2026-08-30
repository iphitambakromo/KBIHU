package com.iphi.webview

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.webkit.*
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.gms.location.*
import com.iphi.IphiApp
import com.iphi.R
import com.iphi.ble.BleService
import com.iphi.gps.GpsService

class MainActivity : AppCompatActivity() {
    companion object {
        private const val TAG = "IPHI"
    }

    private lateinit var webView: WebView
    private var bleService: BleService? = null
    private var gpsService: GpsService? = null
    private var isBleBound = false
    private var isGpsBound = false

    // GPS langsung di MainActivity
    private lateinit var fusedClient: FusedLocationProviderClient
    private var lastLat = 0.0
    private var lastLng = 0.0
    private var lastAcc = 0f
    private var gpsCount = 0

    private val bleConn = object : ServiceConnection {
        override fun onServiceConnected(n: ComponentName?, s: IBinder?) {
            bleService = (s as BleService.LocalBinder).getService()
            isBleBound = true
            setupBleCallbacks()
            Log.d(TAG, "BLE service connected")
        }
        override fun onServiceDisconnected(n: ComponentName?) {
            bleService = null
            isBleBound = false
        }
    }
    private val gpsConn = object : ServiceConnection {
        override fun onServiceConnected(n: ComponentName?, s: IBinder?) {
            gpsService = (s as GpsService.GpsBinder).getService()
            isGpsBound = true
            setupGpsCallbacks()
            Log.d(TAG, "GPS service connected")
        }
        override fun onServiceDisconnected(n: ComponentName?) {
            gpsService = null
            isGpsBound = false
        }
    }

    private val permLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { perms ->
        val allGranted = perms.values.all { it }
        if (allGranted) {
            Toast.makeText(this, "✅ Izin diberikan", Toast.LENGTH_SHORT).show()
            startGpsDirect()
        } else {
            val denied = perms.filter { !it.value }.keys.joinToString()
            Toast.makeText(this, "⚠️ Izin ditolak: $denied", Toast.LENGTH_LONG).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        requestPermissions()

        webView = findViewById(R.id.webview)
        setupWebView()

        // Load URL server
        val url = getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE)
            .getString(IphiApp.PREF_SERVER_URL, IphiApp.DEFAULT_SERVER_URL) ?: IphiApp.DEFAULT_SERVER_URL
        Log.d(TAG, "Loading: $url")
        webView.loadUrl(url)

        // Start GPS langsung
        startGpsDirect()
    }

    // ===== GPS LANGSUNG (tanpa service, lebih cepat) =====
    private fun startGpsDirect() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "GPS permission not granted")
            return
        }
        Log.d(TAG, "Starting direct GPS...")

        // 1. Last known location (instant)
        try {
            fusedClient.lastLocation.addOnSuccessListener { loc ->
                if (loc != null) {
                    lastLat = loc.latitude
                    lastLng = loc.longitude
                    lastAcc = loc.accuracy
                    Log.d(TAG, "Last GPS: $lastLat, $lastLng (±${lastAcc}m)")
                    pushGpsToWebView()
                }
            }
        } catch (e: Exception) { Log.e(TAG, "lastLocation error", e) }

        // 2. Realtime updates (setiap 3 detik)
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 3000)
            .setMinUpdateIntervalMillis(2000)
            .setWaitForAccurateLocation(true)
            .build()

        fusedClient.requestLocationUpdates(req, object : LocationCallback() {
            override fun onLocationResult(r: LocationResult) {
                r.lastLocation?.let { loc ->
                    // Filter: hanya update jika akurasi lebih baik
                    if (loc.accuracy <= lastAcc || lastAcc == 0f || gpsCount < 5) {
                        lastLat = loc.latitude
                        lastLng = loc.longitude
                        lastAcc = loc.accuracy
                        gpsCount++
                        Log.d(TAG, "GPS #$gpsCount: $lastLat, $lastLng (±${lastAcc}m)")
                        pushGpsToWebView()
                    }
                }
            }
        }, Looper.getMainLooper())

        // 3. Periodic push ke WebView (backup setiap 3 detik)
        webView.postDelayed(object : Runnable {
            override fun run() {
                if (!isDestroyed) {
                    pushGpsToWebView()
                    webView.postDelayed(this, 3000)
                }
            }
        }, 5000)

        // 4. Start GPS service untuk background tracking
        val srvUrl = getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE)
            .getString(IphiApp.PREF_SERVER_URL, IphiApp.DEFAULT_SERVER_URL) ?: IphiApp.DEFAULT_SERVER_URL
        val devId = getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE)
            .getString(IphiApp.PREF_DEVICE_ID, "${Build.MANUFACTURER}_${Build.MODEL}") ?: "${Build.MANUFACTURER}_${Build.MODEL}"
        val intent = Intent(this, GpsService::class.java).apply {
            action = "START"
            putExtra("server", srvUrl)
            putExtra("device", devId)
        }
        startForegroundService(intent)
        bindService(intent, gpsConn, Context.BIND_AUTO_CREATE)
    }

    private fun pushGpsToWebView() {
        if (lastLat == 0.0 && lastLng == 0.0) return
        val js = """
            (function(){
                window._nativeLat=$lastLat;
                window._nativeLng=$lastLng;
                window._nativeAcc=$lastAcc;
                window._nativeGpsTime=Date.now();
                if(window.onGPSUpdate)window.onGPSUpdate($lastLat,$lastLng,$lastAcc);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    // ===== WebView Setup =====
    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            setGeolocationEnabled(true)
            userAgentString = "$userAgentString IPHI-Native/3.4"
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, r: WebResourceRequest?): Boolean {
                val url = r?.url.toString()
                // WhatsApp
                if (url.contains("wa.me") || url.contains("whatsapp.com")) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage("com.whatsapp"))
                    } catch (e: Exception) {
                        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) {}
                    }
                    return true
                }
                // Telepon
                if (url.startsWith("tel:")) {
                    startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(url)))
                    return true
                }
                // Email
                if (url.startsWith("mailto:")) {
                    startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse(url)))
                    return true
                }
                return false
            }
            override fun onPageFinished(v: WebView?, url: String?) {
                super.onPageFinished(v, url)
                injectBridge()
            }
            override fun onReceivedError(v: WebView?, r: WebResourceRequest?, e: WebResourceError?) {
                super.onReceivedError(v, r, e)
                if (r?.isForMainFrame == true) {
                    Log.e(TAG, "Page error: ${e?.description}")
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage?): Boolean {
                Log.d(TAG, "JS: ${m?.message()}")
                return true
            }
        }
        // JavaScript Interface
        webView.addJavascriptInterface(WebAppInterface(), "Android")
    }

    private fun injectBridge() {
        webView.evaluateJavascript("""
            (function(){
                if(window.Android) {
                    console.log('✅ IPHI Native Bridge v3.4 aktif');
                    window._nativeBridgeReady = true;
                }
            })();
        """.trimIndent(), null)
    }

    // ===== JavaScript Interface (Bridge) =====
    inner class WebAppInterface {
        @JavascriptInterface
        fun startBLE(srv: String, rom: String) {
            Log.d(TAG, "startBLE: srv=$srv rom=$rom")
            getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE).edit()
                .putString(IphiApp.PREF_SERVER_URL, srv)
                .putString(IphiApp.PREF_ROMBONGAN, rom)
                .apply()
            val i = Intent(this@MainActivity, BleService::class.java).apply {
                action = "START"
                putExtra("server", srv)
                putExtra("rombongan", rom)
            }
            startForegroundService(i)
            bindService(i, bleConn, Context.BIND_AUTO_CREATE)
        }

        @JavascriptInterface
        fun stopBLE() {
            Log.d(TAG, "stopBLE")
            startService(Intent(this@MainActivity, BleService::class.java).apply { action = "STOP" })
            if (isBleBound) {
                unbindService(bleConn)
                isBleBound = false
            }
        }

        @JavascriptInterface
        fun startGPS(srv: String, dev: String) {
            Log.d(TAG, "startGPS: $srv / $dev")
            startGpsDirect()
        }

        @JavascriptInterface
        fun stopGPS() {
            Log.d(TAG, "stopGPS")
            startService(Intent(this@MainActivity, GpsService::class.java).apply { action = "STOP" })
            if (isGpsBound) {
                unbindService(gpsConn)
                isGpsBound = false
            }
        }

        @JavascriptInterface
        fun bunyikanGelang(mac: String) {
            Log.d(TAG, "bunyikanGelang: $mac")
            startService(Intent(this@MainActivity, BleService::class.java).apply {
                action = "BEEP"
                putExtra("mac", mac)
            })
        }

        @JavascriptInterface
        fun stopBunyikan(mac: String) {
            Log.d(TAG, "stopBunyikan: $mac")
            bleService?.stopBeeping(mac)
        }

        @JavascriptInterface
        fun openWhatsApp(num: String, name: String) {
            val f = if (num.startsWith("0")) "62${num.substring(1)}" else num
            val msg = Uri.encode("Assalamualaikum, dari IPHI. Terkait $name...")
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$f?text=$msg")).setPackage("com.whatsapp"))
            } catch (e: Exception) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$f")))
                } catch (_: Exception) {
                    runOnUiThread { Toast.makeText(this@MainActivity, "WhatsApp tidak terinstall", Toast.LENGTH_SHORT).show() }
                }
            }
        }

        @JavascriptInterface
        fun vibrate(p: String) {
            try {
                val ms = p.split(",").map { it.trim().toLong() }.toLongArray()
                val v = getSystemService(VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(ms, -1))
                } else {
                    @Suppress("DEPRECATION")
                    v.vibrate(ms, -1)
                }
            } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun getDeviceInfo(): String {
            val devId = getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE)
                .getString(IphiApp.PREF_DEVICE_ID, Build.MODEL) ?: Build.MODEL
            return """{"deviceId":"$devId","model":"${Build.MODEL}","manufacturer":"${Build.MANUFACTURER}","sdk":${Build.VERSION.SDK_INT}}"""
        }

        @JavascriptInterface
        fun showToast(m: String) {
            runOnUiThread { Toast.makeText(this@MainActivity, m, Toast.LENGTH_SHORT).show() }
        }

        @JavascriptInterface
        fun saveServerUrl(u: String) {
            getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE).edit()
                .putString(IphiApp.PREF_SERVER_URL, u).apply()
        }

        @JavascriptInterface
        fun getServerUrl(): String {
            return getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE)
                .getString(IphiApp.PREF_SERVER_URL, IphiApp.DEFAULT_SERVER_URL) ?: IphiApp.DEFAULT_SERVER_URL
        }

        @JavascriptInterface
        fun getLatitude(): Double = lastLat

        @JavascriptInterface
        fun getLongitude(): Double = lastLng

        @JavascriptInterface
        fun getAccuracy(): Float = lastAcc

        @JavascriptInterface
        fun hasGPS(): Boolean = lastLat != 0.0 && lastLng != 0.0

        @JavascriptInterface
        fun getVersion(): String = "3.4.0"

        @JavascriptInterface
        fun reload() {
            runOnUiThread { webView.reload() }
        }
    }

    // ===== BLE Callbacks =====
    private fun setupBleCallbacks() {
        bleService?.onBleDetected = { mac, rssi, name ->
            val safeMac = mac.replace("\"", "\\\"").replace("'", "\\'")
            val safeName = name.replace("\"", "\\\"").replace("'", "\\'")
            webView.post {
                webView.evaluateJavascript(
                    "if(window.onBleDetected)window.onBleDetected('$safeMac',$rssi,'$safeName');",
                    null
                )
            }
        }
        bleService?.onStatusChanged = { s ->
            val safe = s.replace("\"", "\\\"").replace("'", "\\'")
            webView.post {
                webView.evaluateJavascript(
                    "if(window.onBleStatus)window.onBleStatus('$safe');",
                    null
                )
            }
        }
    }

    // ===== GPS Callbacks =====
    private fun setupGpsCallbacks() {
        gpsService?.onLocationUpdate = { lat, lng, acc ->
            bleService?.lastLat = lat
            bleService?.lastLng = lng
            webView.post {
                webView.evaluateJavascript(
                    "if(window.onGPSUpdate)window.onGPSUpdate($lat,$lng,$acc);",
                    null
                )
            }
        }
    }

    // ===== Permissions =====
    private fun requestPermissions() {
        val perms = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            perms.add(Manifest.permission.BLUETOOTH_SCAN)
            perms.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val needed = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            permLauncher.launch(needed.toTypedArray())
        }
    }

    // ===== Back Navigation =====
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    // ===== Lifecycle =====
    override fun onDestroy() {
        super.onDestroy()
        if (isBleBound) unbindService(bleConn)
        if (isGpsBound) unbindService(gpsConn)
        webView.destroy()
    }
}
