/**
 * DEVICE ID SERVICE: The "Triple-Lock" Identity
 * Uses LocalStorage, IndexedDB, and Cookies + Simple Fingerprinting.
 * Includes a "Soft Wipe" detection to trigger subtractive DB sync.
 */

const ID_KEY = 'lapuff_device_id';
const COOKIE_NAME = 'lp_dev_id';
const DB_NAME = 'lapuff-meta';
const STORE_NAME = 'meta';

// 1. Simple Fingerprint Generator (Hardware & Browser DNA)
const getFingerprint = () => {
  if (typeof window === 'undefined') return 'server';
  const { userAgent, language, hardwareConcurrency, deviceMemory } = navigator;
  const { width, height, colorDepth } = window.screen;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Combine traits into a base64 string
  return btoa(`${userAgent}-${language}-${hardwareConcurrency}-${deviceMemory}-${width}x${height}-${colorDepth}-${timezone}`);
};

// 2. IndexedDB Wrapper (Compatible with your existing lapuff-meta structure)
const idb = {
  async get(key) {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        try {
          const db = request.result;
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const getReq = store.get(key);
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      };
      request.onerror = () => resolve(null);
    });
  },
  async set(key, value) {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        try {
          const db = request.result;
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(value, key);
          transaction.oncomplete = () => resolve(true);
        } catch (e) { resolve(false); }
      };
      request.onerror = () => resolve(false);
    });
  }
};

// 3. Cookie Helpers (Long-lived storage backup)
const setLongLivedCookie = (value) => {
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 2); // 2 Year Persistence
  document.cookie = `${COOKIE_NAME}=${value}; expires=${expires.toUTCString()}; path=/; SameSite=Strict`;
};

const getCookie = () => {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${COOKIE_NAME}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
};

/**
 * Main Initialization: Retrieves or Generates the Device ID.
 * Detected "Soft Wipes" (where LS is empty but IDB/Cookies have the ID)
 * will trigger the subtractive RPC in Phase 2.
 */
export async function initializeDeviceId() {
  // 1) Try all three locks
  const lsId = localStorage.getItem(ID_KEY);
  const idbId = await idb.get('device_id'); // Using your existing key name
  const cookieId = getCookie();

  // Identify the "Anchor" (The ID that survived the longest)
  const anchorId = lsId || idbId || cookieId;

  if (!anchorId) {
    // TRULY NEW USER: Generate fresh ID v4 with Fingerprint DNA
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    const uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    
    const fingerprint = getFingerprint();
    const finalId = `lapuff-${uuid}.${fingerprint}`;

    try {
      localStorage.setItem(ID_KEY, finalId);
      await idb.set('device_id', finalId);
      setLongLivedCookie(finalId);
    } catch (e) { /* ignore */ }

    return { id: finalId, isNew: true, wasWiped: false, prevId: null };
  }

  // RECOVERY MODE: If any lock is missing, restore it from the Anchor
  try {
    if (!lsId) localStorage.setItem(ID_KEY, anchorId);
    if (!idbId) await idb.set('device_id', anchorId);
    if (!cookieId) setLongLivedCookie(anchorId);
  } catch (e) { /* ignore */ }

  // Detect a "Soft Wipe": LocalStorage was empty, but IndexedDB or Cookie still had the identity.
  const wasWiped = !lsId && (idbId || cookieId);

  return { 
    id: anchorId, 
    isNew: false, 
    wasWiped: !!wasWiped,
    prevId: wasWiped ? anchorId : null 
  };
}

/**
 * Standard async getter (maintains backward compatibility with your app)
 */
export async function getDeviceId() {
  const result = await initializeDeviceId();
  return result.id;
}