package id.iphi.radar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Hijau = Color(0xFF1B5E20)
private val HijauMuda = Color(0xFFE8F5E9)
private val Abu = Color(0xFF616161)
private val AbgLega = Color(0xFFF5F5F5)

@Composable
fun AppRoot(activity: MainActivity) {
    val m = activity.model
    MaterialTheme {
        if (m.token.value == null) LoginScreen(m) else ScanScreen(m, activity)
    }
}

@Composable
fun LoginScreen(m: RadarModel) {
    var user by remember { mutableStateOf("") }
    var sandi by remember { mutableStateOf("") }
    var base by remember { mutableStateOf(m.base.value) }
    var sibuk by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().padding(24.dp)) {
        Text("📡 Radar IPHI", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Hijau)
        Spacer(Modifier.height(4.dp))
        Text(
            "Scan BLE via MAC — posisi jamaah otomatis masuk dashboard. " +
                "Pakai untuk: karu / rombongan di lapangan.",
            fontSize = 13.sp, color = Abu
        )
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = base, onValueChange = { base = it },
            label = { Text("Server (API)") },
            singleLine = true, modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = user, onValueChange = { user = it },
            label = { Text("Nama pengguna") },
            singleLine = true, modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = sandi, onValueChange = { sandi = it },
            label = { Text("Kata sandi") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth()
        )
        if (err.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Text("❌ $err", color = Color(0xFFB71C1C), fontSize = 13.sp)
        }
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                if (!sibuk) {
                    sibuk = true
                    err = ""
                    m.login(base.trim().trimEnd('/'), user, sandi) { ok, msg ->
                        sibuk = false
                        if (!ok) err = msg
                    }
                }
            },
            enabled = !sibuk,
            modifier = Modifier.fillMaxWidth().height(50.dp)
        ) {
            Text(if (sibuk) "Memeriksa…" else "Masuk", fontSize = 16.sp)
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "Akun: karu1…karu5 (lihat Petugas di web). Setelah masuk, tekan Mulai Scan.",
            fontSize = 11.5.sp, color = Abu, textAlign = TextAlign.Center
        )
    }
}

@Composable
fun ScanScreen(m: RadarModel, activity: MainActivity) {
    val daftar = m.devices.value.values
        .sortedWith(compareByDescending<DevRow> { m.macMap.value.containsKey(it.mac) }
            .thenByDescending { it.rssi })

    Column(Modifier.fillMaxSize()) {
        // Header
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text("📡 Radar IPHI", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Hijau)
                Text(m.userLabel.value, fontSize = 12.sp, color = Abu)
            }
            TextButton(onClick = { m.logout() }) { Text("Keluar", color = Color(0xFFB71C1C)) }
        }

        // Kontrol scan
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            val aktif = m.scanAktif.value
            if (aktif) {
                Button(onClick = { m.hentiScan() }, modifier = Modifier.height(44.dp)) {
                    Text("⏹ Hentikan Scan")
                }
            } else {
                OutlinedButton(onClick = { activity.hubungiScan() }, modifier = Modifier.height(44.dp)) {
                    Text("🔵 Mulai Scan")
                }
            }
            Spacer(Modifier.width(10.dp))
            Column {
                Text("📟 MAC terdaftar: " + m.macMap.value.size + " dari " + m.jamaahList.value.size,
                    fontSize = 12.sp, color = Abu)
                Text(m.gpsPesan.value, fontSize = 12.sp, color = Abu)
            }
        }

        // Status
        if (m.statusPesan.value.isNotEmpty()) {
            Text(m.statusPesan.value, fontSize = 12.5.sp, color = Hijau,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
        }
        m.sedangBunyi.value?.let {
            Text(it, fontSize = 12.5.sp, color = Color(0xFFE65100),
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp))
        }

        // Daftar tag
        if (daftar.isEmpty()) {
            Column(Modifier.weight(1f).padding(24.dp)) {
                Text(
                    if (m.scanAktif.value) "📶 Mencari tag… (tag harus menyala & dekat ±25 m)"
                        else "Tekan 🔵 Mulai Scan untuk mendeteksi tag iTag di sekitar.",
                    fontSize = 14.sp, color = Abu, textAlign = TextAlign.Center
                )
            }
        } else {
            LazyColumn(Modifier.weight(1f)) {
                items(daftar, key = { it.mac }) { dev -> RowDev(m, dev) }
            }
        }
    }

    // Dialog catat MAC utk tag yang belum terdaftar
    m.macDicatat.value?.let { mac -> DialogCatatMac(m, mac) }
}

@Composable
fun RowDev(m: RadarModel, dev: DevRow) {
    val jm = m.macMap.value[dev.mac]
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 5.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (jm != null) HijauMuda else AbgLega)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                if (jm != null) "🎯 " + jm.nama else "📶 " + (dev.nama ?: "tag …" + dev.mac.takeLast(4)),
                fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1
            )
            Text(
                dev.mac + " · " + dev.rssi + " dBm" +
                    (if (jm != null) " · " + jm.regu else " · belum terdaftar"),
                fontSize = 11.5.sp, color = Abu
            )
        }
        TextButton(onClick = { m.bunyi(dev.mac) }) { Text("🔊") }
        if (jm == null) {
            TextButton(onClick = { m.macDicatat.value = dev.mac }) {
                Text("💾", fontSize = 15.sp)
            }
        }
    }
}

@Composable
fun DialogCatatMac(m: RadarModel, mac: String) {
    var cari by remember { mutableStateOf("") }
    val daftar = m.jamaahList.value.filter {
        cari.isEmpty() || it.nama.contains(cari, true) || it.regu.contains(cari, true)
    }
    AlertDialog(
        onDismissRequest = { m.macDicatat.value = null },
        title = { Text("💾 Catat MAC $mac") },
        text = {
            Column {
                Text(
                    "Tag ini belum terdaftar. Pilih jamaah pemiliknya — MAC akan tersimpan & " +
                        "tag langsung dikenal semua HP (otomatis lintas perangkat).",
                    fontSize = 12.5.sp, color = Abu
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = cari, onValueChange = { cari = it },
                    label = { Text("Cari nama / regu") },
                    singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                LazyColumn(Modifier.heightIn(max = 300.dp).fillMaxWidth()) {
                    items(daftar, key = { it.id }) { j ->
                        Row(
                            Modifier.fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { m.simpanMac(mac, j.id) }
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(j.nama, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                                Text(j.regu, fontSize = 11.5.sp, color = Abu)
                            }
                            if (j.macTag.isNotEmpty()) {
                                Text("📟 " + j.macTag, fontSize = 10.5.sp, color = Abu)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { m.macDicatat.value = null }) { Text("Tutup") }
        }
    )
}
