const TOK = () => localStorage.getItem('iphi_tok') || '';
export async function api(path, opts = {}) {
  const h = { 'content-type': 'application/json', ...(opts.headers || {}) };
  if (TOK()) h.authorization = 'Bearer ' + TOK();
  const r = await fetch(path, { ...opts, headers: h });
  let d;
  try { d = await r.json(); } catch (e) { d = { ok: false, error: 'Server error (' + r.status + ')' }; }
  /* fix K11: 401 dari /api/login = kredensial salah (bukan sesi habis) — jangan reload halaman,
     biarkan komponen Login menampilkan pesan errornya. */
  if (r.status === 401 && !String(path).startsWith('/api/login')) {
    localStorage.removeItem('iphi_tok'); location.reload(); throw new Error('unauthorized');
  }
  return d;
}
