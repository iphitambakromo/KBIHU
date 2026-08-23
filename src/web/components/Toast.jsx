import React from 'react';
export default function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`fixed left-1/2 -translate-x-1/2 bottom-6 z-[3000] px-5 py-3 rounded-xl text-white font-bold text-[14px]
      shadow-xl max-w-[92vw] text-center transition ${toast.err ? 'bg-merah' : 'bg-slate-800'}`}>
      {toast.pesan}
    </div>
  );
}
