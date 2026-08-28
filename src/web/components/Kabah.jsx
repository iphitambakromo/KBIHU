import React from 'react';

/* 🕋 Logo Kabah Makkah — ikon 3D di atas tile emas */
export default function Kabah({ size = 24, className = '' }) {
  return (
    <span className={'inline-grid place-items-center rounded-lg bg-amber-100 ring-2 ring-amber-400 shrink-0 p-1 ' + className}
      style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" className="w-full h-full">
        <defs>
          <linearGradient id="kabah-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{stopColor:'#2A2A2A', stopOpacity:1}} />
            <stop offset="100%" style={{stopColor:'#1A1A1A', stopOpacity:1}} />
          </linearGradient>
          <linearGradient id="kabah-gold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{stopColor:'#B48A2F', stopOpacity:1}} />
            <stop offset="100%" style={{stopColor:'#8E7020', stopOpacity:1}} />
          </linearGradient>
        </defs>
        
        {/* Kabah Body */}
        <rect x="50" y="60" width="100" height="100" rx="5" fill="url(#kabah-gradient)" stroke="#2A2A2A" strokeWidth="2"/>
        <rect x="55" y="65" width="90" height="90" rx="3" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1"/>
        
        {/* Gold Strip */}
        <rect x="50" y="80" width="100" height="20" fill="url(#kabah-gold)" opacity="0.8"/>
        <rect x="50" y="120" width="100" height="20" fill="url(#kabah-gold)" opacity="0.8"/>
        
        {/* Door */}
        <rect x="85" y="130" width="30" height="30" rx="3" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1"/>
        <rect x="90" y="135" width="20" height="25" rx="2" fill="#1A1A1A"/>
        
        {/* Black Cloth */}
        <rect x="70" y="40" width="60" height="25" rx="3" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1"/>
        
        {/* Gold Top */}
        <circle cx="100" cy="40" r="10" fill="url(#kabah-gold)" opacity="0.8"/>
        
        {/* Shadow */}
        <rect x="55" y="160" width="90" height="10" rx="2" fill="black" opacity="0.3"/>
      </svg>
    </span>
  );
}
