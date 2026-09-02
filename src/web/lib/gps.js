/**
 * GPS Module — kompatibel dengan native bridge dan browser
 * 
 * Mode Native: GPS dari native Android (High Accuracy, background)
 * Mode Browser: GPS dari navigator.geolocation
 */

import { isNativeApp, startGPS as nativeStartGPS } from './nativeBridge.js';

let cache = null;
let nativeGpsActive = false;
let lastNativePos = null;

/* fix K4: satu penerima GPS native — perbarui cache DAN teruskan ke hook per-halaman
   (_kawalGpsUpdate, _radarGpsUpdate, _latihanGpsUpdate) yang dulu tidak pernah dipanggil siapa pun. */
export function terimaGpsNative(lat, lng, accuracy) {
  lastNativePos = { lat, lng, akurasi: accuracy, waktu: Date.now() };
  cache = lastNativePos;
  try { if (typeof window._kawalGpsUpdate === 'function') window._kawalGpsUpdate(lat, lng); } catch (e) {}
  try { if (typeof window._radarGpsUpdate === 'function') window._radarGpsUpdate(lat, lng); } catch (e) {}
  try { if (typeof window._latihanGpsUpdate === 'function') window._latihanGpsUpdate(lat, lng, accuracy); } catch (e) {}
}

// Callback untuk GPS dari native
if (typeof window !== 'undefined') {
  window.onGPSUpdate = (lat, lng, accuracy) => {
    terimaGpsNative(lat, lng, accuracy);
    console.log('[GPS] Native update:', lat, lng, accuracy);
  };
}

/**
 * Baca posisi GPS
 * @param {number} timeoutMs - Timeout dalam milidetik
 * @param {boolean} fresh - Pakai baca baru (bukan cache)
 * @returns {Promise<{lat, lng, akurasi, waktu, fallback}>}
 */
export function bacaGPS(timeoutMs = 12000, fresh = false) {
  // Cek cache dulu
  if (!fresh && cache && Date.now() - cache.waktu < 60000) {
    return Promise.resolve({ ...cache });
  }
  
  // Mode Native: cek window._nativeLat langsung (dari pushGps())
  if (isNativeApp()) {
    if (window._nativeLat && window._nativeLng && window._nativeLat !== 0) {
      const pos = { 
        lat: window._nativeLat, 
        lng: window._nativeLng, 
        akurasi: window._nativeAcc || 20, 
        waktu: window._nativeGpsTime || Date.now() 
      };
      cache = pos;
      return Promise.resolve({ ...pos });
    }
    
    // Cek dari callback onGPSUpdate
    if (lastNativePos && Date.now() - lastNativePos.waktu < 30000) {
      cache = lastNativePos;
      return Promise.resolve({ ...cache });
    }
    
    // Tunggu sebentar untuk GPS fix
    return new Promise(resolve => {
      let attempts = 0;
      const check = () => {
        attempts++;
        if (window._nativeLat && window._nativeLng && window._nativeLat !== 0) {
          const pos = { 
            lat: window._nativeLat, 
            lng: window._nativeLng, 
            akurasi: window._nativeAcc || 20, 
            waktu: Date.now() 
          };
          cache = pos;
          resolve({ ...pos });
        } else if (attempts < 15) {
          setTimeout(check, 200);
        } else {
          // Fallback
          resolve({ lat: -6.9932, lng: 110.4203, akurasi: 3000, fallback: true });
        }
      };
      check();
    });
  }
  
  // Browser: gunakan navigator.geolocation
  return new Promise(resolve => {
    const gagal = () => {
      if (cache) {
        resolve({ ...cache, fallback: true });
      } else {
        resolve({ lat: -6.9932, lng: 110.4203, akurasi: 3000, fallback: true });
      }
    };
    
    if (!navigator.geolocation) return gagal();
    
    navigator.geolocation.getCurrentPosition(
      p => {
        cache = { 
          lat: p.coords.latitude, 
          lng: p.coords.longitude, 
          akurasi: p.coords.accuracy, 
          waktu: Date.now() 
        };
        resolve({ ...cache });
      },
      gagal,
      { 
        enableHighAccuracy: true, 
        timeout: timeoutMs, 
        maximumAge: fresh ? 0 : 20000 
      }
    );
  });
}

/**
 * Mulai GPS tracking (native)
 * @param {string} serverUrl - URL server
 * @param {string} deviceId - ID device
 */
export function mulaiGPSTracking(serverUrl, deviceId) {
  if (isNativeApp()) {
    console.log('[GPS] Starting native GPS tracking');
    nativeStartGPS(serverUrl, deviceId, {
      onUpdate: (lat, lng, accuracy) => terimaGpsNative(lat, lng, accuracy)
    });
    nativeGpsActive = true;
    return { ok: true, mode: 'native' };
  }
  
  // Browser: tidak ada background tracking
  return { ok: false, mode: 'browser', error: 'Background GPS butuh IPHI App' };
}

/**
 * Stop GPS tracking
 */
export function stopGPSTracking() {
  if (isNativeApp() && nativeGpsActive) {
    // Native GPS di-stop dari Android
    nativeGpsActive = false;
  }
}

/**
 * Dapatkan posisi terakhir (tanpa request baru)
 */
export function getLastPosition() {
  return cache;
}
