let cache = null;
export function bacaGPS(timeoutMs = 12000, fresh = false) {
  if (!fresh && cache && Date.now() - cache.waktu < 60000) return Promise.resolve({ ...cache });
  return new Promise(resolve => {
    const gagal = () => resolve({ lat: -6.9932, lng: 110.4203, akurasi: 3000, fallback: true });
    if (!navigator.geolocation) return gagal();
    navigator.geolocation.getCurrentPosition(
      p => { cache = { lat: p.coords.latitude, lng: p.coords.longitude, akurasi: p.coords.accuracy, waktu: Date.now() }; resolve({ ...cache }); },
      gagal,
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: fresh ? 0 : 20000 });
  });
}
