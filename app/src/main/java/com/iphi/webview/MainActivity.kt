package com.iphi.webview

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothProfile
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
import android.webkit.*
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.gms.location.*
import com.iphi.IphiApp
import com.iphi.R
import com.iphi.ble.BleService
import com.iphi.gps.GpsService
import java.util.UUID

class MainActivity : AppCompatActivity() {
    companion object {
        private const val TAG = "IPHI"
        private val FFE0_SERVICE = UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb")
        private val FFE3_CHAR = UUID.fromString("0000ffe3-0000-1000-8000-00805f9b34fb")
    }

    private lateinit var webView: WebView
    private var bleService: BleService? = null
    private var gpsService: GpsService? = null
    private var isBleBound = false
    private var isGpsBound = false
    
    // GPS langsung
    private lateinit var fusedClient: FusedLocationProviderClient
    private var lastLat = 0.0
    private var lastLng = 0.0
    private var lastAcc = 0f
    private var gpsCount = 0

    private val bleConn = object : ServiceConnection {
        override fun onServiceConnected(n: ComponentName?, s: IBinder?) { bleService = (s as BleService.LocalBinder).getService(); isBleBound = true; setupBleCb() }
        override fun onServiceDisconnected(n: ComponentName?) { bleService = null; isBleBound = false }
    }
    private val gpsConn = object : ServiceConnection {
        override fun onServiceConnected(n: ComponentName?, s: IBinder?) { gpsService = (s as GpsService.GpsBinder).getService(); isGpsBound = true; setupGpsCb() }
        override fun onServiceDisconnected(n: ComponentName?) { gpsService = null; isGpsBound = false }
    }

    private val permLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { perms ->
        if (perms.values.all { it }) { Toast.makeText(this, "✅ Izin diberikan", Toast.LENGTH_SHORT).show(); startGps() }
        else Toast.makeText(this, "⚠️ Izin lokasi ditolak — GPS tidak jalan", Toast.LENGTH_LONG).show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        reqPerms()
        
        webView = findViewById(R.id.webview)
        setupWv()
        
        val url = getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE)
            .getString(IphiApp.PREF_SERVER_URL, IphiApp.DEFAULT_SERVER_URL) ?: IphiApp.DEFAULT_SERVER_URL
        webView.loadUrl(url)
        
        // Start GPS langsung
        startGps()
    }

    // ===== GPS LANGSUNG =====
    private fun startGps() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "GPS permission not granted"); return
        }
        Log.d(TAG, "Starting GPS...")
        
        // 1. Last known location (instant)
        try {
            fusedClient.lastLocation.addOnSuccessListener { loc ->
                if (loc != null) {
                    lastLat = loc.latitude; lastLng = loc.longitude; lastAcc = loc.accuracy
                    Log.d(TAG, "Last GPS: $lastLat, $lastLng (±${lastAcc}m)")
                    pushGps()
                }
            }
        } catch (e: Exception) { Log.e(TAG, "lastLocation error", e) }
        
        // 2. Realtime updates
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 3000)
            .setMinUpdateIntervalMillis(2000).build()
        
        fusedClient.requestLocationUpdates(req, object : LocationCallback() {
            override fun onLocationResult(r: LocationResult) {
                r.lastLocation?.let { loc ->
                    lastLat = loc.latitude; lastLng = loc.longitude; lastAcc = loc.accuracy; gpsCount++
                    Log.d(TAG, "GPS #$gpsCount: $lastLat, $lastLng (±${lastAcc}m)")
                    pushGps()
                }
            }
        }, Looper.getMainLooper())
        
        // 3. Periodic push ke WebView (backup)
        webView.postDelayed(object : Runnable {
            override fun run() { if (!isDestroyed) { pushGps(); webView.postDelayed(this, 3000) } }
        }, 5000)
        
        // 4. Start GPS service untuk background
        val srvUrl = getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE).getString(IphiApp.PREF_SERVER_URL, IphiApp.DEFAULT_SERVER_URL) ?: IphiApp.DEFAULT_SERVER_URL
        val intent = Intent(this, GpsService::class.java).apply { action = "START"; putExtra("server", srvUrl); putExtra("device", "${Build.MANUFACTURER}_${Build.MODEL}") }
        startForegroundService(intent); bindService(intent, gpsConn, Context.BIND_AUTO_CREATE)
    }
    
    private fun pushGps() {
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
    private fun setupWv() {
        webView.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; databaseEnabled = true
            allowFileAccess = true; allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(true); builtInZoomControls = true; displayZoomControls = false
            setGeolocationEnabled(true)
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, r: WebResourceRequest?): Boolean {
                val url = r?.url.toString()
                if (url.contains("wa.me") || url.contains("whatsapp.com")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage("com.whatsapp")) } catch (e: Exception) { try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) {} }; return true
                }
                if (url.startsWith("tel:")) { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(url))); return true }
                if (url.startsWith("mailto:")) { startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse(url))); return true }
                return false
            }
            override fun onPageFinished(v: WebView?, url: String?) { super.onPageFinished(v, url); injectBridge() }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage?): Boolean { Log.d(TAG, "JS: ${m?.message()}"); return true }
        }
        webView.addJavascriptInterface(WebAppInterface(), "Android")
    }

    private fun injectBridge() {
        webView.evaluateJavascript("(function(){if(window.Android)console.log('IPHI Bridge OK');})();", null)
    }

    // ===== JavaScript Interface =====
    inner class WebAppInterface {
        @JavascriptInterface fun startBLE(srv: String, rom: String) {
            Log.d(TAG, "startBLE: $srv/$rom")
            getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE).edit().putString(IphiApp.PREF_SERVER_URL, srv).putString(IphiApp.PREF_ROMBONGAN, rom).apply()
            val i = Intent(this@MainActivity, BleService::class.java).apply { action = "START"; putExtra("server", srv); putExtra("rombongan", rom) }
            startForegroundService(i); bindService(i, bleConn, Context.BIND_AUTO_CREATE)
        }
        @JavascriptInterface fun stopBLE() { startService(Intent(this@MainActivity, BleService::class.java).apply { action = "STOP" }); if (isBleBound) { unbindService(bleConn); isBleBound = false } }
        @JavascriptInterface fun startGPS(srv: String, dev: String) { startGps() }
        @JavascriptInterface fun stopGPS() { startService(Intent(this@MainActivity, GpsService::class.java).apply { action = "STOP" }); if (isGpsBound) { unbindService(gpsConn); isGpsBound = false } }
        @JavascriptInterface fun bunyikanGelang(mac: String) { startService(Intent(this@MainActivity, BleService::class.java).apply { action = "BEEP"; putExtra("mac", mac) }) }
        @JavascriptInterface fun stopBunyikan(mac: String) { bleService?.stopBeeping(mac) }
        @JavascriptInterface fun openWhatsApp(num: String, name: String) {
            val f = if (num.startsWith("0")) "62${num.substring(1)}" else num
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$f?text=${Uri.encode("Assalamualaikum, dari IPHI. Terkait $name...")}")).setPackage("com.whatsapp")) } catch (e: Exception) { try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$f"))) } catch (_: Exception) { runOnUiThread { Toast.makeText(this@MainActivity, "WhatsApp tidak ada", Toast.LENGTH_SHORT).show() } } }
        }
        @JavascriptInterface fun vibrate(p: String) { try { val ms = p.split(",").map { it.trim().toLong() }.toLongArray(); val v = getSystemService(VIBRATOR_SERVICE) as Vibrator; if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) v.vibrate(VibrationEffect.createWaveform(ms, -1)) else @Suppress("DEPRECATION") v.vibrate(ms, -1) } catch (_: Exception) {} }
        @JavascriptInterface fun getDeviceInfo(): String = """{"deviceId":"${bleService?.deviceId ?: Build.MODEL}","model":"${Build.MODEL}","manufacturer":"${Build.MANUFACTURER}"}"""
        @JavascriptInterface fun showToast(m: String) { runOnUiThread { Toast.makeText(this@MainActivity, m, Toast.LENGTH_SHORT).show() } }
        @JavascriptInterface fun saveServerUrl(u: String) { getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE).edit().putString(IphiApp.PREF_SERVER_URL, u).apply() }
        @JavascriptInterface fun getServerUrl(): String = getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE).getString(IphiApp.PREF_SERVER_URL, IphiApp.DEFAULT_SERVER_URL) ?: IphiApp.DEFAULT_SERVER_URL
        @JavascriptInterface fun getLatitude(): Double = lastLat
        @JavascriptInterface fun getLongitude(): Double = lastLng
        @JavascriptInterface fun getAccuracy(): Float = lastAcc
        @JavascriptInterface fun hasGPS(): Boolean = lastLat != 0.0 && lastLng != 0.0
    }

    private fun setupBleCb() {
        bleService?.onBleDetected = { mac, rssi, name ->
            val e = mac.replace("\"", "\\\"").replace("'", "\\'"); val n = name.replace("\"", "\\\"").replace("'", "\\'")
            webView.post { webView.evaluateJavascript("if(window.onBleDetected)window.onBleDetected('$e',$rssi,'$n');", null) }
        }
        bleService?.onStatusChanged = { s -> val e = s.replace("\"", "\\\"").replace("'", "\\'"); webView.post { webView.evaluateJavascript("if(window.onBleStatus)window.onBleStatus('$e');", null) } }
    }
    private fun setupGpsCb() {
        gpsService?.onLocationUpdate = { lat, lng, acc -> bleService?.lastLat = lat; bleService?.lastLng = lng; webView.post { webView.evaluateJavascript("if(window.onGPSUpdate)window.onGPSUpdate($lat,$lng,$acc);", null) } }
    }
    private fun reqPerms() {
        val p = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) { p.add(Manifest.permission.BLUETOOTH_SCAN); p.add(Manifest.permission.BLUETOOTH_CONNECT) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) p.add(Manifest.permission.POST_NOTIFICATIONS)
        val ng = p.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (ng.isNotEmpty()) permLauncher.launch(ng.toTypedArray())
    }
    override fun onBackPressed() { if (webView.canGoBack()) webView.goBack() else super.onBackPressed() }
    override fun onDestroy() { super.onDestroy(); if (isBleBound) unbindService(bleConn); if (isGpsBound) unbindService(gpsConn) }
}
