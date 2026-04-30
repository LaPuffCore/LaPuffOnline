// mapCacheStore — singleton that bridges MapLoadingScreen Phase 2A output → MapView input.
// All fields start null/false; MapLoadingScreen (Phase 2A) writes data, MapView reads on mount.
// Phase 2B signals (mapLibreReady, layersReady) are written by MapView and polled by MapLoadingScreen.

const mapCacheStore = {
  // ── Phase 2A outputs (set by MapLoadingScreen pipeline) ────────────────
  geoData: null,            // parsed ZCTA FeatureCollection (with safezone split)
  adjacency: null,          // adjacency graph array
  zctaSkeleton: null,       // precomputed ring skeletons for ZCTA outlines
  zctaBboxes: null,         // per-feature bounding boxes for PiP shortcut
  boroughGeoData: null,     // raw borough FeatureCollection
  boroughSkeleton: null,    // precomputed ring skeletons for borough outlines
  zipBoroughMap: null,      // { zctaFeatureIndex → boroughFeatureIndex }
  precomputedTiers: null,   // { [timespanIdx]: { tiers, zipMap, maxCount } } for all 5 timespans

  // Desktop only — FGB pipeline results
  buildingFGB: null,        // parsed FeatureCollection (381K buildings, with baked _tier_* props)
  buildingZctaIndex: null,  // Int16Array: building feature index → ZCTA feature index (-1 = not found)
  buildingTiersBaked: false,// true once _tier_0.._tier_4 are baked into building properties

  // ── Phase 2B signals (set by MapView after GL init) ────────────────────
  mapLibreReady: false,     // true when MapLibre 'load' event fires
  layersReady: false,       // true when addLayers() completes (ZCTA + borough base layers added)
};

export default mapCacheStore;
