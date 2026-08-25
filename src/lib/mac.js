/* Identitas MAC gelang — dipakai worker & web (satu sumber).
   Gelang iTAG memancarkan nama "iTAG(FF:FF:12:A4:FF:63)" — MAC-nya isi dalam kurung.
   normMac menormalkan: buang wrapper, kapital, buang spasi/tanda hubung. */
export function normMac(v) {
  if (v == null) return '';
  let t = String(v).trim().toUpperCase();
  if (!t) return '';
  const kurung = t.match(/\(([^)]+)\)/);
  if (kurung) t = kurung[1].trim();
  t = t.replace(/[\s\-_]/g, '');
  if (!t) return '';
  if (/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(t)) return t;          // MAC standar
  if (/^[0-9A-F]{12}$/.test(t)) return t.replace(/([0-9A-F]{2})(?=[0-9A-F]+)/g, '$1:'); // MAC tanpa titik dua
  if (/^[A-Z0-9]{4,32}$/.test(t)) return t;                        // kode tag alfanumerik (vendor lain)
  return '';
}
