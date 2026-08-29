package com.iphi.webview

import android.Manifest
import android.annotation.SuppressLint
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import android.webkit.*
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.iphi.IphiApp
import com.iphi.R
import com.iphi.ble.BleService
import com.iphi.gps.GpsService

class MainActivity : AppCompatActivity() {
    companion object {
        private const val TAG = "MainActivity"
    }

    private lateinit var webView: WebView
    private var bleService: BleService? = null
    private var gpsService: GpsService? = null
    private var isBleBound = false
    private var isGpsBound = false

    private val bleConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            bleService = (service as BleService.LocalBinder).getService()
            isBleBound = true
            setupBleCallbacks()
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            bleService = null
            isBleBound = false
        }
    }

    private val gpsConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            gpsService = (service as GpsService.GpsBinder).getService()
            isGpsBound = true
            setupGpsCallbacks()
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            gpsService = null
            isGpsBound = false
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.values.all { it }
        if (allGranted) {
            Toast.makeText(this, "✅ Izin diberikan", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "⚠️ Beberapa izin ditolak", Toast.LENGTH_LONG).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        requestPermissions()
        
        webView = findViewById(R.id.webview)
        setupWebView()
        
        val serverUrl = getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE)
            .getString(IphiApp.PREF_SERVER_URL, IphiApp.DEFAULT_SERVER_URL) ?: IphiApp.DEFAULT_SERVER_URL
        
        webView.loadUrl(serverUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url.toString()
                
                // Handle WhatsApp links
                if (url.contains("wa.me") || url.contains("whatsapp.com")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        intent.setPackage("com.whatsapp")
                        startActivity(intent)
                    } catch (e: Exception) {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        } catch (e2: Exception) {}
                    }
                    return true
                }
                
                // Handle tel: links
                if (url.startsWith("tel:")) {
                    startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(url)))
                    return true
                }
                
                // Handle mailto: links
                if (url.startsWith("mailto:")) {
                    startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse(url)))
                    return true
                }
                
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectJavaScriptBridge()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                Log.d(TAG, "JS: ${consoleMessage?.message()}")
                return true
            }
        }

        // Add JavaScript interface
        webView.addJavascriptInterface(WebAppInterface(), "Android")
    }

    private fun injectJavaScriptBridge() {
        val js = """
            (function() {
                // Notify native that bridge is ready
                if (window.Android) {
                    console.log('IPHI Bridge: Android interface available');
                }
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    inner class WebAppInterface {
        @JavascriptInterface
        fun startBLE(serverUrl: String, rombonganId: String) {
            Log.d(TAG, "startBLE: server=$serverUrl, rombongan=$rombonganId")
            getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE).edit()
                .putString(IphiApp.PREF_SERVER_URL, serverUrl)
                .putString(IphiApp.PREF_ROMBONGAN, rombonganId)
                .apply()
            
            val intent = Intent(this@MainActivity, BleService::class.java).apply {
                action = "START"
                putExtra("server", serverUrl)
                putExtra("rombongan", rombonganId)
            }
            startForegroundService(intent)
            bindService(intent, bleConnection, Context.BIND_AUTO_CREATE)
        }

        @JavascriptInterface
        fun stopBLE() {
            Log.d(TAG, "stopBLE")
            val intent = Intent(this@MainActivity, BleService::class.java).apply { action = "STOP" }
            startService(intent)
            if (isBleBound) { unbindService(bleConnection); isBleBound = false }
        }

        @JavascriptInterface
        fun startGPS(serverUrl: String, deviceId: String) {
            Log.d(TAG, "startGPS: server=$serverUrl")
            val intent = Intent(this@MainActivity, GpsService::class.java).apply {
                action = "START"
                putExtra("server", serverUrl)
                putExtra("device", deviceId)
            }
            startForegroundService(intent)
            bindService(intent, gpsConnection, Context.BIND_AUTO_CREATE)
        }

        @JavascriptInterface
        fun stopGPS() {
            Log.d(TAG, "stopGPS")
            val intent = Intent(this@MainActivity, GpsService::class.java).apply { action = "STOP" }
            startService(intent)
            if (isGpsBound) { unbindService(gpsConnection); isGpsBound = false }
        }

        @JavascriptInterface
        fun bunyikanGelang(mac: String) {
            Log.d(TAG, "bunyikanGelang: $mac")
            val intent = Intent(this@MainActivity, BleService::class.java).apply {
                action = "BEEP"
                putExtra("mac", mac)
            }
            startService(intent)
        }

        @JavascriptInterface
        fun stopBunyikan(mac: String) {
            bleService?.stopBeeping(mac)
        }

        @JavascriptInterface
        fun openWhatsApp(number: String, name: String) {
            val formatted = if (number.startsWith("0")) "62${number.substring(1)}" else number
            val message = "Assalamualaikum, saya dari IPHI. Terkait $name..."
            try {
                val url = "https://wa.me/$formatted?text=${Uri.encode(message)}"
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                intent.setPackage("com.whatsapp")
                startActivity(intent)
            } catch (e: Exception) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$formatted")))
                } catch (e2: Exception) {
                    runOnUiThread { Toast.makeText(this@MainActivity, "WhatsApp tidak terinstall", Toast.LENGTH_SHORT).show() }
                }
            }
        }

        @JavascriptInterface
        fun openWhatsAppGroup(groupId: String) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://chat.whatsapp.com/$groupId"))
                startActivity(intent)
            } catch (e: Exception) {}
        }

        @JavascriptInterface
        fun vibrate(pattern: String) {
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            try {
                val ms = pattern.split(",").map { it.trim().toLong() }.toLongArray()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(ms, -1))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(ms, -1)
                }
            } catch (e: Exception) {
                vibrator.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE))
            }
        }

        @JavascriptInterface
        fun getDeviceInfo(): String {
            return """{"deviceId":"${bleService?.deviceId ?: Build.MODEL}","model":"${Build.MODEL}","manufacturer":"${Build.MANUFACTURER}"}"""
        }

        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread { Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show() }
        }

        @JavascriptInterface
        fun saveServerUrl(url: String) {
            getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE).edit()
                .putString(IphiApp.PREF_SERVER_URL, url).apply()
        }

        @JavascriptInterface
        fun getServerUrl(): String {
            return getSharedPreferences(IphiApp.PREFS_NAME, MODE_PRIVATE)
                .getString(IphiApp.PREF_SERVER_URL, IphiApp.DEFAULT_SERVER_URL) ?: IphiApp.DEFAULT_SERVER_URL
        }
    }

    private fun setupBleCallbacks() {
        bleService?.onBleDetected = { mac, rssi, name ->
            val escaped = mac.replace("\"", "\\\"").replace("'", "\\'")
            val escapedName = name.replace("\"", "\\\"").replace("'", "\\'")
            webView.post {
                webView.evaluateJavascript(
                    "if(window.onBleDetected) window.onBleDetected('$escaped', $rssi, '$escapedName');",
                    null
                )
            }
        }
        bleService?.onStatusChanged = { status ->
            val escaped = status.replace("\"", "\\\"").replace("'", "\\'")
            webView.post {
                webView.evaluateJavascript(
                    "if(window.onBleStatus) window.onBleStatus('$escaped');",
                    null
                )
            }
        }
    }

    private fun setupGpsCallbacks() {
        gpsService?.onLocationUpdate = { lat, lng, acc ->
            bleService?.lastLat = lat
            bleService?.lastLng = lng
            webView.post {
                webView.evaluateJavascript(
                    "if(window.onGPSUpdate) window.onGPSUpdate($lat, $lng, $acc);",
                    null
                )
            }
        }
    }

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
        val notGranted = perms.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (notGranted.isNotEmpty()) permissionLauncher.launch(notGranted.toTypedArray())
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isBleBound) unbindService(bleConnection)
        if (isGpsBound) unbindService(gpsConnection)
    }
}
