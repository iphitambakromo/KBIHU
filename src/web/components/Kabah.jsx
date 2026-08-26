import React from 'react';

/* 🕋 Logo Kabah Makkah — gambar lokal (bukan URL luar) agar tetap tampil saat sinyal lemah / offline */
export default function Kabah({ size = 24, className = '' }) {
  return (
    <img src="/kabah.jpg" width={size} height={size} alt="" aria-hidden="true"
      className={'rounded-lg object-cover ring-1 ring-white/70 shrink-0 ' + className} />
  );
}
