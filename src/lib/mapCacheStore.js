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
  zipBoroughMap: null,      // { zctaFeatureIndex → canonical boroughIndex (0-4) }
  zipToFeatureIndices: null, // { [zip]: number[] } all feature indices sharing a MODZCTA
  precomputedTiers: null,   // { [timespanIdx]: { tiers, zipMap, maxCount } } for all 5 timespans

  // ── Stage 4 + 6 pre-bakes (populated in Phase 2A or end of Phase 2B) ───
  precomputedZctaFills: null,    // { [tsIdx]: withHeat-FeatureCollection } — instant setData per timespan
  precomputedHeatPoints: null,   // { [tsIdx]: weighted-point-FeatureCollection } — heat-underlay
  precomputedBoroughTiers: null, // { [tsIdx]: avgTiers[] } — per-borough avg tier
  precomputedBoroughExprs: null, // { [tsIdx]: { on, off } } — borough outline color match expressions
  outlineGeoCache: null,         // { [intZoom]: ZCTA outline GeoJSON } — per integer zoom
  boroughOutlineGeoCache: null,  // { [intZoom]: borough outline GeoJSON }
  prebakeFingerprint: null,      // events fingerprint that caches were built against (invalidate on change)
  zipScatterPositions: null,     // { [zip]: [[lng,lat], ...] } pre-baked scatter positions

  // ── Phase 2B signals (set by MapView after GL init) ────────────────────
  mapLibreReady: false,     // true when MapLibre 'load' event fires
  layersReady: false,       // true when addLayers() completes (ZCTA + borough base layers added)
  warmupComplete: false,    // true after Phase 2B warmup zoom cycle finishes (shaders compiled, tiles primed)
};

export default mapCacheStore;
