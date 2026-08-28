import React from 'react';

/* 🕋 Logo Kabah Makkah — ikon bersih di atas tile emas (gambar lokal, tetap tampil saat offline) */
export default function Kabah({ size = 24, className = '' }) {
  return (
    <span className={'inline-grid place-items-center rounded-lg bg-amber-100 ring-2 ring-amber-400 shrink-0 p-1 ' + className}
      style={{ width: size, height: size }}>
      <img src="/kabah-ikon.png" alt="" aria-hidden="true" className="w-full h-full object-contain" />
    </span>
  );
}
