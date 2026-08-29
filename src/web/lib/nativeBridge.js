/**
 * Native Bridge — komunikasi antara web app (WebView) dan native Android app
 * 
 * Deteksi environment:
 * - window.Android ada → mode Native App (WebView)
 * - window.Android tidak ada → mode Browser (Web Bluetooth)
 * 
 * Fungsi yang tersedia di native:
 * - startBLE(serverUrl, rombonganId) → mulai scan BLE
 * - stopBLE() → stop scan BLE
 * - startGPS(serverUrl, deviceId) → mulai GPS tracking
 * - stopGPS() → stop GPS
 * - bunyikanGelang(mac) → bunyikan iTag
 * - stopBunyikan(mac) → stop bunyikan
 * - openWhatsApp(number, name) → buka WhatsApp
 * - vibrate(pattern) → getar HP
 * - getDeviceInfo() → info device
 * - showToast(message) → tampilkan toast
 * - saveServerUrl(url) → simpan URL server
 * - getServerUrl() → ambil URL server
 * 
 * Callbacks dari native ke web:
 * - window.onBleDetected(mac, rssi, name) → BLE deteksi
 * - window.onBleStatus(status) → status BLE
 * - window.onGPSUpdate(lat, lng, accuracy) → GPS update
 */

// Deteksi apakah running di native app (WebView) atau browser
export const isNativeApp = () => {
  return typeof window !== 'undefined' && typeof window.Android !== 'undefined';
};

// Deteksi apakah Web Bluetooth tersedia
export const hasWebBluetooth = () => {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
};

// Deteksi apakah requestLEScan tersedia
export const hasLEScan = () => {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth?.requestLEScan;
};

// Info environment
export const getEnvironmentInfo = () => {
  const native = isNativeApp();
  const webBt = hasWebBluetooth();
  const leScan = hasLEScan();
  
  return {
    isNative: native,
    hasWebBluetooth: webBt,
    hasLEScan: leScan,
    mode: native ? 'native' : (leScan ? 'browser-full' : (webBt ? 'browser-limited' : 'browser-none')),
    description: native 
      ? 'Native App (WebView + BLE Native)' 
      : leScan 
        ? 'Browser dengan scan BLE' 
        : webBt 
          ? 'Browser tanpa scan BLE' 
          : 'Browser tanpa Bluetooth'
  };
};

// ===== BLE Functions =====

/**
 * Mulai scan BLE
 * @param {string} serverUrl - URL server
 * @param {string} rombonganId - ID rombongan
 * @param {object} callbacks - {onDetected, onStatus}
 */
export const startBLE = (serverUrl, rombonganId, callbacks = {}) => {
  const env = getEnvironmentInfo();
  
  if (env.isNative) {
    // Mode Native: gunakan Android bridge
    console.log('[NativeBridge] Starting BLE via native bridge');
    
    // Set callbacks
    if (callbacks.onDetected) {
      window.onBleDetected = callbacks.onDetected;
    }
    if (callbacks.onStatus) {
      window.onBleStatus = callbacks.onStatus;
    }
    
    // Panggil native
    window.Android.startBLE(serverUrl, rombonganId);
    return { ok: true, mode: 'native' };
    
  } else if (env.hasWebBluetooth) {
    // Mode Browser: gunakan Web Bluetooth
    console.log('[NativeBridge] Starting BLE via Web Bluetooth');
    return { ok: false, mode: 'browser', error: 'Web Bluetooth tidak mendukung background scan. Gunakan IPHI App.' };
    
  } else {
    return { ok: false, mode: 'none', error: 'Bluetooth tidak tersedia di browser ini.' };
  }
};

/**
 * Stop scan BLE
 */
export const stopBLE = () => {
  if (isNativeApp()) {
    window.Android.stopBLE();
    return { ok: true };
  }
  return { ok: false, error: 'Tidak dalam mode native' };
};

// ===== GPS Functions =====

/**
 * Mulai GPS tracking
 * @param {string} serverUrl - URL server
 * @param {string} deviceId - ID device
 * @param {object} callbacks - {onUpdate}
 */
export const startGPS = (serverUrl, deviceId, callbacks = {}) => {
  if (isNativeApp()) {
    console.log('[NativeBridge] Starting GPS via native bridge');
    
    if (callbacks.onUpdate) {
      window.onGPSUpdate = callbacks.onUpdate;
    }
    
    window.Android.startGPS(serverUrl, deviceId);
    return { ok: true };
  }
  
  // Fallback: browser geolocation
  if (navigator.geolocation) {
    console.log('[NativeBridge] Starting GPS via browser geolocation');
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (callbacks.onUpdate) {
          callbacks.onUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        }
      },
      (err) => console.error('[NativeBridge] GPS error:', err),
      { enableHighAccuracy: true, timeout: 15000 }
    );
    return { ok: true, watchId };
  }
  
  return { ok: false, error: 'GPS tidak tersedia' };
};

/**
 * Stop GPS tracking
 */
export const stopGPS = () => {
  if (isNativeApp()) {
    window.Android.stopGPS();
    return { ok: true };
  }
  return { ok: false };
};

// ===== Gelang Functions =====

/**
 * Bunyikan gelang
 * @param {string} mac - MAC address gelang
 */
export const bunyikanGelang = (mac) => {
  if (isNativeApp()) {
    window.Android.bunyikanGelang(mac);
    return { ok: true };
  }
  return { ok: false, error: 'Butuh IPHI App untuk bunyikan gelang' };
};

/**
 * Scan iTag untuk mendapatkan MAC asli
 * @returns {Promise<{mac: string, deviceId: string} | null>}
 */
export const scanITag = async () => {
  if (isNativeApp()) {
    // Native: gunakan BLE scanner untuk deteksi iTag
    // Return promise yang resolve saat iTag terdeteksi
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 30000); // timeout 30 detik
      
      // Setup callback untuk terima hasil scan
      window._scanITagCallback = (mac, deviceId) => {
        clearTimeout(timeout);
        window._scanITagCallback = null;
        resolve({ mac, deviceId });
      };
      
      // Panggil native untuk mulai scan
      if (window.Android.scanITag) {
        window.Android.scanITag();
      } else {
        // Fallback: gunakan BLE scan yang sudah ada
        resolve(null);
      }
    });
  }
  
  // Browser: gunakan Web Bluetooth
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'iTAG' }],
      optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb']
    }).catch(() => {
      return navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb']
      });
    });
    
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
    const characteristic = await service.getCharacteristic('0000ffe3-0000-1000-8000-00805f9b34fb');
    const value = await characteristic.readValue();
    
    const macBytes = new Uint8Array(value.buffer);
    const mac = Array.from(macBytes).map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
    
    server.disconnect();
    return { mac, deviceId: device.id };
  } catch (e) {
    console.error('Scan iTag error:', e);
    return null;
  }
};

/**
 * Stop bunyikan gelang
 * @param {string} mac - MAC address gelang
 */
export const stopBunyikan = (mac) => {
  if (isNativeApp()) {
    window.Android.stopBunyikan(mac);
    return { ok: true };
  }
  return { ok: false };
};

// ===== WhatsApp Functions =====

/**
 * Buka WhatsApp
 * @param {string} number - Nomor telepon
 * @param {string} name - Nama jamaah
 */
export const openWhatsApp = (number, name) => {
  if (isNativeApp()) {
    window.Android.openWhatsApp(number, name);
    return { ok: true };
  }
  
  // Fallback: buka WhatsApp Web
  const formatted = number.startsWith('0') ? '62' + number.substring(1) : number;
  const message = encodeURIComponent(`Assalamualaikum, saya dari IPHI. Terkait ${name}...`);
  window.open(`https://wa.me/${formatted}?text=${message}`, '_blank');
  return { ok: true };
};

// ===== Utility Functions =====

/**
 * Getar HP
 * @param {string} pattern - Pattern getar (comma separated ms)
 */
export const vibrate = (pattern) => {
  if (isNativeApp()) {
    window.Android.vibrate(pattern);
  } else if (navigator.vibrate) {
    const ms = pattern.split(',').map(Number);
    navigator.vibrate(ms);
  }
};

/**
 * Get device info
 * @returns {object} Device info
 */
export const getDeviceInfo = () => {
  if (isNativeApp()) {
    try {
      return JSON.parse(window.Android.getDeviceInfo());
    } catch (e) {
      return { deviceId: 'unknown', model: 'unknown', manufacturer: 'unknown' };
    }
  }
  return { deviceId: navigator.userAgent, model: navigator.platform, manufacturer: 'Browser' };
};

/**
 * Show toast message
 * @param {string} message - Message to show
 */
export const showToast = (message) => {
  if (isNativeApp()) {
    window.Android.showToast(message);
  } else {
    // Fallback: console log
    console.log('[Toast]', message);
  }
};

/**
 * Save server URL
 * @param {string} url - Server URL
 */
export const saveServerUrl = (url) => {
  if (isNativeApp()) {
    window.Android.saveServerUrl(url);
  }
  localStorage.setItem('iphi_server_url', url);
};

/**
 * Get server URL
 * @returns {string} Server URL
 */
export const getServerUrl = () => {
  if (isNativeApp()) {
    return window.Android.getServerUrl();
  }
  return localStorage.getItem('iphi_server_url') || 'https://kbihu.iphi-haji.workers.dev';
};

export default {
  isNativeApp,
  hasWebBluetooth,
  hasLEScan,
  getEnvironmentInfo,
  startBLE,
  stopBLE,
  startGPS,
  stopGPS,
  bunyikanGelang,
  stopBunyikan,
  openWhatsApp,
  vibrate,
  getDeviceInfo,
  showToast,
  saveServerUrl,
  getServerUrl,
};
