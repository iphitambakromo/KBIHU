package id.iphi.radar

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Klien HTTP sederhana ke Cloudflare Worker (tanpa dependency tambahan). */
object Api {
    fun post(base: String, path: String, token: String?, body: JSONObject): Pair<Int, JSONObject> =
        exchange(base + path, "POST", token, body.toString())

    fun put(base: String, path: String, token: String?, body: JSONObject): Pair<Int, JSONObject> =
        exchange(base + path, "PUT", token, body.toString())

    fun get(base: String, path: String, token: String?): Pair<Int, JSONObject> =
        exchange(base + path, "GET", token, null)

    private fun exchange(urlStr: String, method: String, token: String?, body: String?): Pair<Int, JSONObject> {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.setRequestProperty("content-type", "application/json")
            if (!token.isNullOrBlank()) conn.setRequestProperty("authorization", "Bearer $token")
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
            return code to JSONObject(text)
        } catch (e: Exception) {
            return -1 to JSONObject().put("error", e.message ?: "gagal koneksi")
        } finally {
            conn.disconnect()
        }
    }
}
