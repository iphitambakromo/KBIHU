package id.iphi.radar

/** Jamaah dari /api/state (subset yang dipakai app radar). */
data class Jamaah(
    val id: String,
    val nama: String,
    val regu: String,
    val macTag: String,   // MAC tag dalam bentuk FF:FF:12:A4:9C:44 (kosong = belum dicatat)
    val punyaGelang: Boolean
)

/** Baris hasil scan BLE. */
data class DevRow(
    val mac: String,
    var rssi: Int,
    var nama: String?,
    var terakhir: Long
)

/** Normalisasi MAC: huruf besar, tanpa pemisah, tambah titik dua. "" bila bukan 12 digit hex. */
fun normalizeMac(raw: String?): String {
    val hex = (raw ?: "").trim().uppercase().replace(Regex("[^0-9A-F]"), "")
    if (hex.length != 12) return ""
    return hex.chunked(2).joinToString(":")
}

/** Jarak meter (haversine). */
fun jarakMeter(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val r = 6371000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
