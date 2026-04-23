// Simple device ID helper. Stores ID in localStorage and mirrors in IndexedDB for resilience.
export async function getDeviceId() {
  const key = 'lapuff_device_id';
  try {
    // 1) Try localStorage first
    let id = localStorage.getItem(key);
    if (id) return id;

    // 2) Try IndexedDB (if present) — attempt to read 'device_id' from 'meta' store
    try {
      const openReq = indexedDB.open('lapuff-meta', 1);
      const idFromDb = await new Promise((resolve) => {
        openReq.onupgradeneeded = () => {
          const db = openReq.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        };
        openReq.onsuccess = () => {
          try {
            const db = openReq.result;
            const tx = db.transaction('meta', 'readonly');
            const store = tx.objectStore('meta');
            const getReq = store.get('device_id');
            getReq.onsuccess = () => resolve(getReq.result || null);
            getReq.onerror = () => resolve(null);
          } catch (e) { resolve(null); }
        };
        openReq.onerror = () => resolve(null);
      });
      if (idFromDb) {
        try { localStorage.setItem(key, idFromDb); } catch (e) {}
        return idFromDb;
      }
    } catch (e) { /* ignore */ }

    // 3) Generate a new UUID v4
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    const newId = `lapuff-${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;

    try { localStorage.setItem(key, newId); } catch (e) { /* ignore */ }

    // Mirror into IndexedDB for extra persistence
    try {
      const req = indexedDB.open('lapuff-meta', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction('meta', 'readwrite');
          tx.objectStore('meta').put(newId, 'device_id');
        } catch (e) { /* ignore */ }
      };
      req.onerror = () => {};
    } catch (e) { /* ignore */ }

    return newId;
  } catch (e) {
    return null;
  }
}
