/* 📄 PDF LAPORAN ABSENSI — A4 potret, jsPDF teks (tajam, ringan, bisa dicetak).
   Dipakai tombol "PDF Laporan Absensi" di halaman Absensi (acara aktif MAUPUN riwayat).
   Catatan: font bawaan jsPDF (helvetica) tak mendukung emoji/Unicode di luar latin-1
   → semua teks di sini huruf biasa saja. */
import { jsPDF } from 'jspdf';

const fmtWaktu = (s) => !s ? '—' : new Date(s).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtJam = (s) => !s ? '—' : new Date(s).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const teksStatus = (s) => s === 'hadir' ? 'HADIR' : s === 'izin' ? 'IZIN' : s === 'alfa' ? 'ALFA' : 'BELUM';
const potong = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function pdfAbsensi(rekap) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, ML = 14, MR = 14;
  const ev = rekap.event || {};
  const rows = [...(rekap.rows || [])].sort((a, b) =>
    ((a.status === 'hadir' ? 0 : a.status ? 1 : 2) - (b.status === 'hadir' ? 0 : b.status ? 1 : 2)) ||
    String(a.nama || '').localeCompare(String(b.nama || '')));
  const nINI = (s) => (rekap.rows || []).filter(r => r.status === s).length;
  const total = rekap.total || rows.length;

  /* ---- kepala laporan ---- */
  let y = 15;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(6, 78, 59);
  doc.text('LAPORAN ABSENSI JAMAAH', W / 2, y, { align: 'center' });
  doc.setFontSize(10); doc.setTextColor(110);
  doc.text('IPHI · Tracking Amanah · Kab. Pati', W / 2, y + 5.5, { align: 'center' });
  doc.setDrawColor(6, 78, 59); doc.setLineWidth(0.7); doc.line(ML, y + 9.5, W - MR, y + 9.5);
  y += 16.5;
  doc.setFontSize(10.5); doc.setTextColor(30);
  doc.setFont('helvetica', 'bold');
  doc.text('Acara: ' + potong(ev.nama || '-', 95), ML, y);
  doc.setFont('helvetica', 'normal');
  doc.text('Waktu: ' + fmtWaktu(ev.waktu) + (ev.ditutup ? '     Status: selesai' : '     Status: masih berjalan'), ML, y + 5.5);
  doc.text('Titik: ' + potong(ev.titik_nama || '-', 40) + (ev.titik_radius ? '  (radius ' + ev.titik_radius + ' m)' : '') +
    '     Regu: ' + (ev.regu || 'semua regu') + '     Pencatat: ' + (ev.oleh || '-'), ML, y + 11);
  doc.text('Dibuat: ' + new Date().toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB', ML, y + 16.5);
  y += 22;

  /* ---- tabel ---- */
  const kol = [
    { t: 'No', x: ML, w: 9, tengah: true },
    { t: 'Nama Jamaah', x: ML + 9, w: 62 },
    { t: 'Regu', x: ML + 71, w: 44 },
    { t: 'Status', x: ML + 115, w: 22, tengah: true },
    { t: 'Waktu', x: ML + 137, w: 30, tengah: true },
    { t: 'Sumber', x: ML + 167, w: 15 },
  ];
  const tinggi = 7.2, batas = 258;
  const kepalaTabel = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    doc.setFillColor(6, 78, 59); doc.rect(ML, y, W - ML - MR, tinggi, 'F');
    kol.forEach(k => doc.text(k.t, k.tengah ? k.x + k.w / 2 : k.x + 1.5, y + 4.9, { align: k.tengah ? 'center' : 'left' }));
    y += tinggi;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40, 40, 40);
  };
  kepalaTabel();
  rows.forEach((r, i) => {
    if (y + tinggi > batas) { doc.addPage(); y = 18; kepalaTabel(); }
    if (i % 2 === 1) { doc.setFillColor(240, 253, 244); doc.rect(ML, y, W - ML - MR, tinggi, 'F'); }
    doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'normal');
    doc.text(String(i + 1), kol[0].x + kol[0].w / 2, y + 4.9, { align: 'center' });
    doc.text(potong(r.nama, 34), kol[1].x + 1.5, y + 4.9);
    doc.text(potong(r.regu || '-', 28), kol[2].x + 1.5, y + 4.9);
    const st = teksStatus(r.status);
    if (st === 'HADIR') { doc.setFont('helvetica', 'bold'); doc.setTextColor(6, 95, 70); }
    else if (st === 'ALFA') { doc.setFont('helvetica', 'bold'); doc.setTextColor(185, 28, 28); }
    else if (st === 'IZIN') { doc.setFont('helvetica', 'bold'); doc.setTextColor(180, 83, 9); }
    else { doc.setFont('helvetica', 'normal'); doc.setTextColor(130, 130, 130); }
    doc.text(st, kol[3].x + kol[3].w / 2, y + 4.9, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40);
    doc.text(fmtJam(r.waktu), kol[4].x + kol[4].w / 2, y + 4.9, { align: 'center' });
    doc.text(potong(r.sumber || '-', 13), kol[5].x + 1.5, y + 4.9);
    y += tinggi;
  });

  /* ---- ringkasan ---- */
  y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(30, 30, 30);
  doc.text('Ringkasan — Total: ' + total + '   ·   HADIR: ' + nINI('hadir') +
    '   ·   IZIN: ' + nINI('izin') + '   ·   ALFA: ' + nINI('alfa') +
    '   ·   BELUM: ' + Math.max(0, total - nINI('hadir') - nINI('izin') - nINI('alfa')), ML, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(130, 130, 130);
  doc.text('Sumber: geo = otomatis (GPS di titik) · manual = ditandai ketua · kartu = check-in kartu digital', ML, y + 4.5);

  /* ---- tanda tangan ---- */
  y = Math.max(y + 16, 236);
  doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
  const x1 = 26, x2 = 128;
  doc.text('Ketua Regu' + (ev.regu ? ' — ' + potong(ev.regu, 24) : ''), x1, y);
  doc.text('Koordinator IPHI', x2, y);
  doc.line(x1, y + 24, x1 + 52, y + 24);
  doc.line(x2, y + 24, x2 + 52, y + 24);
  doc.setTextColor(130, 130, 130); doc.setFontSize(8);
  doc.text('(ttd & nama jelas)', x1 + 12, y + 28.5);
  doc.text('(ttd & nama jelas)', x2 + 12, y + 28.5);

  /* ---- simpan PDF ---- */
  const fileName = 'absensi-' + String(ev.nama || 'laporan').replace(/[^\w\d-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) + '.pdf';
  
  // Cek apakah di WebView (native app)
  const isWebView = typeof window !== 'undefined' && typeof window.Android !== 'undefined';
  
  if (isWebView) {
    // WebView: buka PDF di tab baru atau download via data URL
    try {
      const pdfBlob = doc.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfUrl, '_blank');
      // Cleanup setelah 1 menit
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
    } catch (e) {
      // Fallback: download langsung
      doc.save(fileName);
    }
  } else {
    // Browser biasa: download langsung
    doc.save(fileName);
  }
  
  return doc;
}
