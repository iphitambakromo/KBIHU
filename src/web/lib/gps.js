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

// Callback untuk GPS dari native
if (typeof window !== 'undefined') {
  window.onGPSUpdate = (lat, lng, accuracy) => {
    lastNativePos = { lat, lng, akurasi: accuracy, waktu: Date.now() };
    cache = lastNativePos;
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
  
  // Mode Native: gunakan posisi dari native GPS service
  if (isNativeApp() && lastNativePos && Date.now() - lastNativePos.waktu < 30000) {
    cache = lastNativePos;
    return Promise.resolve({ ...cache });
  }
  
  return new Promise(resolve => {
    const gagal = () => {
      // Jika ada cache (meski lama), gunakan
      if (cache) {
        resolve({ ...cache, fallback: true });
      } else {
        // Default: Semarang, Indonesia
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
      onUpdate: (lat, lng, accuracy) => {
        lastNativePos = { lat, lng, akurasi: accuracy, waktu: Date.now() };
        cache = lastNativePos;
      }
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
