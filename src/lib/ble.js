/* Helper BLE bersama (RadarPage, KawalPage) — baca & ekstrak identitas dari siaran BLE. */

export const bytesToHex = (u8) => Array.from(u8 || []).map(b => b.toString(16).padStart(2, '0')).join('');

/* Baca MAC produk dari payload data-manufaktur.
   Siaran iTAG bergilir per bingkai: bingkai nama vs bingkai payload —
   payload-nya memuat MAC tag (sama dengan yang tampil di app iTag & kolom MAC Kelola Jamaah).
   1) MAC yang sudah terdaftar di Kelola Jamaah & ketemu di payload (6 byte persis) → dipakai.
   2) Tidak terdaftar → 6 byte pertama payload apa adanya (agar kelihatan & bisa disalin). */
export function ekstrakMacSiar(hex, macPeta, fallback = true) {
  if (!hex || hex.length < 12) return '';
  const H = String(hex).toUpperCase();
  if (macPeta) {
    for (const k of Object.keys(macPeta)) {
      const reg = k.replace(/[^0-9A-F]/g, '');
      if (reg.length === 12 && H.includes(reg)) return k;
    }
  }
  if (!fallback) return '';
  const keenam = H.slice(0, 12);
  if (/^(00|ff){6}$/i.test(keenam)) return '';
  return keenam.match(/.{2}/g).join(':');
}

/* hex payload manufaktur terpanjang dari satu event (siaran bergiri: payload bisa di bingkai mana pun) */
export const mfrHexDari = (ev) => {
  let best = '';
  try { if (ev && ev.manufacturerData) ev.manufacturerData.forEach(v => { const hx = bytesToHex(v); if (hx.length > best.length) best = hx; }); } catch (e) {}
  return best;
};

/* Nama pabrik/default iTag BUKAN identitas unik — kalau tag masih memakai nama ini,
   pasang pakai kode per-HP (device.id), bukan nama. */
export const namaDefaultTag = (nm) => /^(itag|itag\s+baru)$/i.test(String(nm || '').trim());
