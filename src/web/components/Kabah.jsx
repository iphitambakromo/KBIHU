import React from 'react';

/* 🕋 Logo Kabah Makkah — gambar 3D dengan border emas */
export default function Kabah({ size = 24, className = '' }) {
  return (
    <span className={'inline-grid place-items-center rounded-lg ring-2 ring-amber-400 shrink-0 ' + className}
      style={{ width: size, height: size }}>
      <img src="/kabah-ikon.png" alt="Kabah" className="w-full h-full object-contain rounded" />
    </span>
  );
}
