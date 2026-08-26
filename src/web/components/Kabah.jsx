import React from 'react';

/* 🕋 Logo Kabah Makkah — ikon bersih di atas tile putih (gambar lokal, tetap tampil saat offline) */
export default function Kabah({ size = 24, className = '' }) {
  return (
    <span className={'inline-grid place-items-center rounded-lg bg-white ring-1 ring-black/15 shrink-0 p-[2px] ' + className}
      style={{ width: size, height: size }}>
      <img src="/kabah-ikon.png" alt="" aria-hidden="true" className="w-full h-full object-contain" />
    </span>
  );
}
