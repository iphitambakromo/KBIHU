package com.iphi.gps

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.iphi.IphiApp
import com.iphi.R
import com.iphi.webview.MainActivity
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody

class GpsService : Service() {
    companion object {
        private const val TAG = "GpsService"
        private const val NOTIFICATION_ID = 1002
        private const val UPDATE_INTERVAL = 5_000L    // 5 detik
        private const val FASTEST_INTERVAL = 3_000L   // 3 detik minimum
        private const val POST_INTERVAL = 15_000L     // fix S9: kirim posisi ke server maks tiap 15 detik
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private val binder = GpsBinder()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val httpClient = OkHttpClient()
    private var lastPost = 0L

    var onLocationUpdate: ((Double, Double, Float) -> Unit)? = null
    var serverUrl = ""
    var deviceId = ""
    var isTracking = false

    inner class GpsBinder : Binder() {
        fun getService(): GpsService = this@GpsService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { loc ->
                    val lat = loc.latitude
                    val lng = loc.longitude
                    val acc = loc.accuracy
                    Log.d(TAG, "GPS: $lat, $lng (±${acc}m)")
                    onLocationUpdate?.invoke(lat, lng, acc)
                    kirimPosisiKeServer(lat, lng, acc)   // fix S9
                }
            }
        }
    }

    /* fix S9: DULU GpsService tidak pernah mengirim apa pun ke server — fitur
       "background GPS tracking" (POST /api/pub/posisi) mati total. Kini posisi device
       pengawal dikirim (throttle 15 detik) selama service berjalan. */
    private fun kirimPosisiKeServer(lat: Double, lng: Double, acc: Float) {
        val now = System.currentTimeMillis()
        if (serverUrl.isEmpty() || now - lastPost < POST_INTERVAL) return
        lastPost = now
        scope.launch {
            try {
                val json = org.json.JSONObject().apply {
                    put("lat", lat); put("lng", lng)
                    put("akurasi", acc.toInt()); put("device_id", deviceId)
                }.toString()
                val req = Request.Builder().url("$serverUrl/api/pub/posisi")
                    .post(RequestBody.create(JSON_TYPE, json)).build()
                httpClient.newCall(req).execute().use { }
            } catch (e: Exception) { Log.e(TAG, "Gagal kirim posisi", e) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "START" -> {
                serverUrl = intent.getStringExtra("server") ?: IphiApp.DEFAULT_SERVER_URL
                deviceId = intent.getStringExtra("device") ?: ""
                startForeground(NOTIFICATION_ID, createNotification("Melacak posisi..."))
                startTracking()
            }
            "STOP" -> stopTracking()
        }
        return START_STICKY
    }

    private fun startTracking() {
        if (isTracking) return
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, UPDATE_INTERVAL)
            .setMinUpdateIntervalMillis(FASTEST_INTERVAL)
            .setMaxUpdateDelayMillis(10_000)
            .setWaitForAccurateLocation(false)  // ← FIX: false supaya langsung dapat lokasi
            .build()
        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
            isTracking = true
            Log.d(TAG, "GPS tracking started (interval: ${UPDATE_INTERVAL}ms)")
        } catch (e: SecurityException) {
            Log.e(TAG, "GPS permission denied", e)
        }
    }

    private fun stopTracking() {
        isTracking = false
        fusedClient.removeLocationUpdates(locationCallback)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotification(text: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pi = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, IphiApp.CHANNEL_GPS)
            .setContentTitle("IPHI GPS")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notif)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    override fun onDestroy() {
        stopTracking()
        scope.cancel()
        super.onDestroy()
    }
}
