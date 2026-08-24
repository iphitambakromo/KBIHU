import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

/* Template kartu leher 100×138 mm (mm supaya presisi cetak) — dipakai cetak massal & PDF */
export function KartuCetak({ m, qr }) {
  const nm = m.nama || '';
  const kelas = nm.length > 28 ? 'kc-nama kc-nama-xs' : nm.length > 16 ? 'kc-nama kc-nama-s' : 'kc-nama';
  const cat = (m.catatan || '');
  const catPot = cat.length > 64 ? cat.slice(0, 64) + '…' : cat;
  return (
    <div className="kc">
      <div className="kc-kepala">
        <div className="kc-brand">
          <div className="kc-flag" />
          <div>
            <div className="kc-negara">REPUBLIK INDONESIA</div>
            <div className="kc-sub">Tracking Amanah · IPHI · Kab. Pati</div>
          </div>
        </div>
        <span className="kc-peran">{m.punya_hp && m.punya_gelang ? '📱+⌚ HP & GELANG' : m.punya_hp ? '📱 BER-HP' : '⌚ GELANG BLE'}</span>
      </div>
      <div className="kc-badan">
        {m.foto
          ? <img className="kc-foto" src={m.foto} alt="" />
          : <div className="kc-foto kc-foto-inisial">{nm.replace(/^(H\.|Hj\.)\s*/, '').split(' ').slice(0, 2).map(x => x[0]).join('')}</div>}
        <div className="kc-tengah">
          <div className={kelas}>{nm}</div>
          <div className="kc-meta">
            <b>Regu:</b> {(m.regu || '-').slice(0, 34)}<br />
            <b>Paspor:</b> {m.paspor || '-'}<br />
            <b>Hotel:</b> {(m.hotel || '-').slice(0, 34)}
            {catPot && <><br /><i>{catPot}</i></>}
          </div>
        </div>
      </div>
      <div className="kc-qr">
        {qr && <img src={qr} alt="QR" className="kc-qrimg" />}
        <div className="kc-qrteks">
          <b>Jika terpisah dari rombongan, scan QR ini</b><br />
          <span>If separated from your group,<br />scan this QR code</span>
          <span dir="rtl" className="kc-arab">إذا انفصلت عن المجموعة، امسح رمز QR هذا</span>
        </div>
      </div>
      <div className="kc-sos">🆘 DARURAT — TEKAN "SOS" DI KARTU DIGITAL · HUBUNGI KETUA REGU</div>
    </div>
  );
}

export async function kartuPDF(wrapEl, namaFile) {
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(wrapEl, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [100, 138] });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 100, 138);
  pdf.save(namaFile);
}

/* ---------- Halaman cetak massal ---------- */
export default function CetakPage() {
  const [jamaah, setJamaah] = useState([]);
  const [qrs, setQrs] = useState({});
  const [pesan, setPesan] = useState('');
  const wrapRef = useRef({});

  useEffect(() => {
    (async () => {
      const d = await fetch('/api/state', { headers: { authorization: 'Bearer ' + localStorage.getItem('iphi_tok') } }).then(r => r.json());
      if (!d.ok) return;
      setJamaah(d.jamaah || []);
      const q = {};
      for (const m of d.jamaah || []) {
        q[m.id] = await QRCode.toDataURL(location.origin + '/#/kartu/' + encodeURIComponent(m.id), { width: 240, margin: 1 });
      }
      setQrs(q);
    })();
  }, []);

  const pdfSatu = async (m) => {
    setPesan('⏳ Membuat PDF ' + m.nama + '…');
    await kartuPDF(wrapRef.current[m.id], 'kartu-' + m.nama + '.pdf');
    setPesan('✅ PDF kartu ' + m.nama + ' terunduh');
  };
  const pdfSemua = async () => {
    const { default: html2canvas } = await import('html2canvas');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [100, 138] });
    for (let i = 0; i < jamaah.length; i++) {
      setPesan(`⏳ Membuat PDF… (${i + 1}/${jamaah.length})`);
      const canvas = await html2canvas(wrapRef.current[jamaah[i].id], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      if (i > 0) pdf.addPage([100, 138], 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 100, 138);
    }
    pdf.save('kartu-jamaah-' + jamaah.length + '.pdf');
    setPesan('✅ PDF massal terunduh (' + jamaah.length + ' kartu)');
  };

  return (
    <div className="p-3 md:p-5 max-w-5xl mx-auto">
      <div className="hidden print:block" />
      <div className="no-print space-y-3">
        <h1 className="text-2xl font-extrabold text-hijau">🪪 Cetak Kartu Jamaah</h1>
        <p className="text-slate-500 text-[13.5px] -mt-2">Kartu leher <b>100×138 mm</b> · 3 bahasa · QR menuju kartu digital (check-in & SOS). Cetak massal: A4 potret <b>4 kartu/halaman</b> — aktifkan <b>Background graphics</b> di dialog cetak.</p>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-utama" onClick={pdfSemua}>📄 Unduh PDF (semua, 1 kartu/halaman)</button>
          <button className="btn btn-muda" onClick={() => window.print()}>🖨️ Cetak Massal (A4)</button>
        </div>
        {pesan && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 font-bold text-[13.5px] text-hijau">{pesan}</div>}
      </div>

      <div className="cetak-hal print:block">
        {jamaah.map(m => (
          <div key={m.id} className="cetak-item">
            <div ref={el => (wrapRef.current[m.id] = el)}><KartuCetak m={m} qr={qrs[m.id]} /></div>
            <div className="no-print flex gap-2 mt-2 justify-center">
              <a className="btn btn-muda !min-h-[40px] !text-[12px]" href={'#/kartu/' + encodeURIComponent(m.id)}>🪪 Lihat digital</a>
              <button className="btn btn-utama !min-h-[40px] !text-[12px]" onClick={() => pdfSatu(m)}>📄 PDF</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
