import React from 'react';

/* 🕋 Logo Kabah (SVG inline — tajam di semua ukuran, tak butuh file gambar) */
export default function Kabah({ size = 24, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      {/* tubuh kubus hitam (kiswah) */}
      <rect x="4.75" y="7.75" width="22.5" height="19.5" rx="2.5" fill="#101014" stroke="#ffffff" strokeWidth="1.5" />
      {/* hisham: pita emas di atas */}
      <rect x="4.75" y="11.5" width="22.5" height="4.2" fill="#d9a514" />
      {/* sulaman emas tipis di bawah pita */}
      <rect x="6" y="17" width="20" height="1.1" fill="#f2c94c" opacity="0.9" />
      {/* pintu emas (Bab al-Ka'bah) di sisi kanan */}
      <rect x="18.5" y="19.5" width="5.5" height="7.75" rx="1" fill="#d9a514" />
    </svg>
  );
}
