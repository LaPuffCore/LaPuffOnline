// fgbWorker.js — Web Worker that parses + bakes building FGBs off the main thread.
//
// Protocol:
//   Main → Worker: { type: 'PARSE_AND_BAKE', boroughs: [{name, url, cacheKey, buf}], precomputedTiers, zctaFeaturesProps }
//     - boroughs[i].buf can be ArrayBuffer (transferred) OR omitted (worker fetches url)
//     - precomputedTiers: { 0:{tiers:[...]}, 1:{...}, ... } (Int16-castable arrays)
//     - zctaFeaturesProps: array of { MODZCTA, _special } for each ZCTA feature (used to build MODZCTA→idx map)
//
//   Worker → Main:
//     { type: 'BOROUGH_DONE', borough, features, idxMap }   (per borough; features is a normal array)
//     { type: 'PROGRESS', pct, msg }
//     { type: 'ALL_DONE', totalCount }
//     { type: 'ERROR', message }
//
// We use structured clone for features (geometries are nested arrays — not transferable),
// but transfer the Int16Array idxMap directly. For 380k buildings on a fast machine the
// structured clone costs ~150-300ms total but the parse+bake (2-4s) is fully off-main-thread.

import { deserialize as fgbDeserialize } from 'flatgeobuf/lib/mjs/geojson.js';

const FGB_YIELD_CHUNK = 10000;

function normalizeFGBProps(props, i) {
  const hr = parseFloat(props?.HEIGHT_ROOF ?? props?.height_roof);
  return {
    height_roof: isNaN(hr) ? 8 : hr,
    MODZCTA: props?.MODZCTA ?? null,
    _s5: i % 5,
    _s7: i % 7,
    _tier_0: 0, _tier_1: 0, _tier_2: 0, _tier_3: 0, _tier_4: 0,
  };
}

self.addEventListener('message', async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'PARSE_AND_BAKE') return;

  const { boroughs, precomputedTiers, zctaFeaturesProps } = msg;

  try {
    // Build MODZCTA → ZCTA index map once
    const zipToZctaIdx = {};
    for (let i = 0; i < zctaFeaturesProps.length; i++) {
      const z = zctaFeaturesProps[i]?.MODZCTA;
      if (z) zipToZctaIdx[String(z)] = i;
    }

    // Cast precomputed tiers into Int8Arrays for fast indexed access
    const tiersByT = {};
    for (let t = 0; t < 5; t++) {
      const src = precomputedTiers?.[t]?.tiers;
      tiersByT[t] = src ? Int8Array.from(src.map(v => Math.max(-1, Math.min(127, v ?? 0)))) : null;
    }

    let totalCount = 0;
    const totalBoroughs = boroughs.length;

    for (let bi = 0; bi < boroughs.length; bi++) {
      const b = boroughs[bi];
      let buf = b.buf ? new Uint8Array(b.buf) : null;
      if (!buf) {
        // Worker can fetch directly — SW handles caching
        const resp = await fetch(b.url);
        if (!resp.ok) throw new Error(`fetch ${b.name} failed: ${resp.status}`);
        buf = new Uint8Array(await resp.arrayBuffer());
      }

      const features = [];
      let count = 0;
      for await (const feature of fgbDeserialize(buf)) {
        if (!feature?.geometry?.coordinates) continue;
        const props = normalizeFGBProps(feature.properties, totalCount + count);
        // Bake tiers inline using MODZCTA→zctaIdx lookup
        const z = props.MODZCTA;
        if (z != null) {
          const zctaIdx = zipToZctaIdx[String(z)] ?? -1;
          if (zctaIdx >= 0) {
            for (let t = 0; t < 5; t++) {
              const arr = tiersByT[t];
              if (arr && arr.length > zctaIdx) props[`_tier_${t}`] = arr[zctaIdx];
            }
          }
        }
        feature.properties = props;
        features.push(feature);
        count++;
        if (count % FGB_YIELD_CHUNK === 0) {
          // Yield so we can send progress
          const overallPct = Math.round(((bi + count / 100000) / totalBoroughs) * 100);
          self.postMessage({ type: 'PROGRESS', pct: Math.min(overallPct, 99), msg: `Parsing ${b.name}...` });
          await new Promise(r => setTimeout(r, 0));
        }
      }

      // Build ZCTA index for this borough
      const idxMap = new Int16Array(features.length);
      for (let i = 0; i < features.length; i++) {
        const z = features[i].properties?.MODZCTA;
        idxMap[i] = z != null ? (zipToZctaIdx[String(z)] ?? -1) : -1;
      }

      totalCount += count;

      // Send borough — structured clone for features, transfer idxMap buffer
      self.postMessage(
        { type: 'BOROUGH_DONE', borough: b.name, features, idxMap, count },
        [idxMap.buffer]
      );

      // Release worker-local buffer immediately to free heap before next borough
      buf = null;
    }

    self.postMessage({ type: 'ALL_DONE', totalCount });
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: err?.message || String(err) });
  }
});
