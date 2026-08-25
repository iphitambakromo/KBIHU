/* Normalisasi no. HP Indonesia → tautan wa.me.
   "0812..."  →  wa.me/62812...
   "812..."   →  wa.me/62812...
   "62812..." →  wa.me/62812...
   Kosong/tidak valid → null. */
export function waLink(hp) {
  if (!hp) return null;
  let d = String(hp).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8') && d.length >= 10 && d.length <= 13) d = '62' + d;
  if (!/^\d{9,15}$/.test(d)) return null;
  return 'https://wa.me/' + d;
}

/* No. HP untuk tampil di antarmuka (tanpa normalisasi). */
export function tampilkanHp(hp) {
  const d = String(hp || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('62')) return '+62 ' + d.slice(2);
  if (d.startsWith('08')) return '+62 ' + d.slice(1);
  if (d.startsWith('0')) return '+' + d;
  return d;
}
