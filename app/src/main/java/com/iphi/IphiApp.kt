package com.iphi

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class IphiApp : Application() {
    companion object {
        const val CHANNEL_BLE = "iphi_ble"
        const val CHANNEL_GPS = "iphi_gps"
        const val CHANNEL_ALERT = "iphi_alert"
        const val PREFS_NAME = "iphi_prefs"
        const val PREF_SERVER_URL = "server_url"
        const val PREF_ROMBONGAN = "rombongan_id"
        const val PREF_MAC_CACHE = "mac_cache"
        const val DEFAULT_SERVER_URL = "https://kbihu.iphi-haji.workers.dev"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)

            manager.createNotificationChannel(NotificationChannel(
                CHANNEL_BLE, "BLE Scanner", NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Memindai gelang jamaah"
                setShowBadge(false)
            })

            manager.createNotificationChannel(NotificationChannel(
                CHANNEL_GPS, "GPS Tracker", NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Melacak posisi"
                setShowBadge(false)
            })

            manager.createNotificationChannel(NotificationChannel(
                CHANNEL_ALERT, "Peringatan", NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Peringatan jamaah hilang"
                enableVibration(true)
            })
        }
    }
}
