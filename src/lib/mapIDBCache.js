// mapIDBCache.js — IndexedDB persistence for baked building data.
//
// Purpose: Phase 2A's expensive FGB parse (~6-10s, 196MB across 5 borough FGBs)
// only needs to run once. After parse + tier-bake completes, we serialize the
// resulting FeatureCollection + Int16 ZCTA-index to IndexedDB. On 2nd+ load,
// Phase 2A skips FGB parse entirely and rehydrates from IDB (~800ms JSON.parse).
//
// What we store:
//   `buildings`    : { fc: FeatureCollection, version: string }
//                    fc has tier columns `_tier_0.._tier_4` baked in already.
//                    We keep tiers in the snapshot — they're small ints, and the
//                    fingerprint check below ensures stale tiers aren't used.
//   `zctaIndex`    : { buf: ArrayBuffer (Int16), version: string }
//   `meta`         : { version, eventFingerprint, savedAt }
//
// Versioning: `version` is the FGB cache key (e.g. 'lapuff-fgb-v8'). If the FGB
// pipeline ever bumps that key (new file format / new fields), we wipe IDB and
// re-parse from FGB on the next load. This makes invalidation automatic.
//
// Event fingerprint: heatmap tier values depend on live event data. We bake the
// tiers into the FC during Phase 2A based on the *current* event fingerprint,
// then store that fingerprint with the snapshot. On rehydrate, if the new
// fingerprint differs, we either (a) re-bake tiers in-place (cheap, ~50ms) or
// (b) re-run the pipeline. Right now we choose (a) for any fingerprint mismatch.

const DB_NAME    = 'lapuff_map_cache_v3';
const DB_VERSION = 1;
const STORE      = 'kv';

let _dbPromise = null;
function openDB() {
  if (_dbPromise) return _dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  _dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => { console.warn('[mapIDBCache] open failed:', req.error); resolve(null); };
  });
  return _dbPromise;
}

async function idbGet(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => resolve(null);
    } catch (_e) { resolve(null); }
  });
}

async function idbPut(key, value) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror   = () => resolve(false);
    } catch (_e) { resolve(false); }
  });
}

async function idbDel(key) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror   = () => resolve(false);
    } catch (_e) { resolve(false); }
  });
}

/** Read cached baked buildings + ZCTA index for the given pipeline version. */
export async function loadBakedBuildings(version) {
  const meta = await idbGet('meta');
  if (!meta || meta.version !== version) return null;
  const buildings = await idbGet('buildings');
  const zctaIndex = await idbGet('zctaIndex');
  if (!buildings?.fc?.features || !zctaIndex?.buf) return null;
  return {
    fc: buildings.fc,
    zctaIndex: new Int16Array(zctaIndex.buf),
    eventFingerprint: meta.eventFingerprint || null,
    savedAt: meta.savedAt || 0,
  };
}

/** Persist baked buildings + ZCTA index. Called once Phase 2A finishes. */
export async function saveBakedBuildings({ fc, zctaIndex, version, eventFingerprint }) {
  if (!fc?.features || !zctaIndex) return false;
  const buf = zctaIndex.buffer.slice(0); // detach reference so GC can release the source
  const ok1 = await idbPut('buildings', { fc, version });
  const ok2 = await idbPut('zctaIndex', { buf, version });
  const ok3 = await idbPut('meta', { version, eventFingerprint, savedAt: Date.now() });
  return ok1 && ok2 && ok3;
}

/** Wipe everything (used on version mismatch). */
export async function clearBakedBuildings() {
  await idbDel('buildings');
  await idbDel('zctaIndex');
  await idbDel('meta');
}

/** Re-bake _tier_0.._tier_4 in-place against new precomputedTiers. Cheap (~50ms). */
export function rebakeTiersInPlace(fc, zctaIndex, precomputedTiers, timespanCount = 5) {
  if (!fc?.features || !zctaIndex) return;
  const features = fc.features;
  for (let i = 0; i < features.length; i++) {
    const zIdx = zctaIndex[i];
    const props = features[i].properties;
    for (let t = 0; t < timespanCount; t++) {
      const tiers = precomputedTiers?.[t]?.tiers;
      props[`_tier_${t}`] = (zIdx >= 0 && tiers && tiers.length > zIdx) ? (tiers[zIdx] ?? 0) : 0;
    }
  }
}
