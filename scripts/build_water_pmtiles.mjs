#!/usr/bin/env node
/**
 * Build water_nyc.pmtiles as an INVERSE STENCIL polygon:
 *   bbox rectangle (-76.5, 39.0, -71.5, 42.5)  MINUS  NYC boroughs.
 *
 * Output: a single GeoJSON FeatureCollection with one MultiPolygon feature
 * inside the 'water' source-layer. Anywhere not a borough renders as water.
 *
 * Then converts to PMTiles via tippecanoe + pmtiles convert.
 *
 * Usage:  node scripts/build_water_pmtiles.mjs
 * Requires: tippecanoe + pmtiles CLI on PATH.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BOROUGH_FILE = path.join(ROOT, 'public/data/borough.geo.json');
const OUT_DIR = path.join(ROOT, 'public/data');
const OUT_GEOJSON = path.join(OUT_DIR, 'water_inverse.geojson');
const OUT_MBTILES = path.join(OUT_DIR, 'water_nyc.mbtiles');
const OUT_PMTILES = path.join(OUT_DIR, 'water_nyc.pmtiles');

// Coverage rectangle (minzoom-8 viewport + 1° pad — includes NJ, CT, PA, eastern LI).
const BBOX = [-76.5, 39.0, -71.5, 42.5]; // [minLng, minLat, maxLng, maxLat]

console.log('[water] Loading boroughs…');
const boroughs = JSON.parse(readFileSync(BOROUGH_FILE, 'utf8'));

// Outer ring = bbox rectangle (clockwise per GeoJSON RFC for outer rings).
const outer = [
  [BBOX[0], BBOX[1]],
  [BBOX[2], BBOX[1]],
  [BBOX[2], BBOX[3]],
  [BBOX[0], BBOX[3]],
  [BBOX[0], BBOX[1]],
];

// Holes = each borough polygon ring (must be opposite winding from outer).
// We collect all rings from all borough features as holes inside one polygon.
// MultiPolygon structure: [ [outer, ...holes], [poly2 outer, ...holes], ... ]
// To use a single polygon with N holes (boroughs as cutouts), we put outer first then holes.
const holes = [];
for (const f of boroughs.features) {
  const g = f.geometry;
  if (!g) continue;
  if (g.type === 'Polygon') {
    // Take only the outer ring of each borough (ignore borough-internal holes).
    if (g.coordinates[0]) holes.push(reverseRing(g.coordinates[0]));
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates) {
      if (poly[0]) holes.push(reverseRing(poly[0]));
    }
  }
}

function reverseRing(ring) {
  // Reverse winding so holes are CCW relative to CW outer (or vice versa).
  const r = ring.slice().reverse();
  return r;
}

console.log(`[water] ${holes.length} borough rings will be cut out of the bbox rectangle.`);

const waterFeature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [outer, ...holes],
  },
};

const fc = { type: 'FeatureCollection', features: [waterFeature] };
writeFileSync(OUT_GEOJSON, JSON.stringify(fc));
console.log(`[water] Wrote ${OUT_GEOJSON} (${(JSON.stringify(fc).length / 1024).toFixed(1)} KB)`);

console.log('[water] Running tippecanoe → MBTiles…');
execSync(
  `tippecanoe -o "${OUT_MBTILES}" --layer=water -Z4 -z14 ` +
  `--no-feature-limit --no-tile-size-limit --force "${OUT_GEOJSON}"`,
  { stdio: 'inherit' }
);

console.log('[water] Converting MBTiles → PMTiles…');
if (existsSync(OUT_PMTILES)) execSync(`rm -f "${OUT_PMTILES}"`);
execSync(`pmtiles convert "${OUT_MBTILES}" "${OUT_PMTILES}"`, { stdio: 'inherit' });

console.log('[water] Done.');
console.log('[water] Verifying output…');
execSync(`pmtiles show "${OUT_PMTILES}" | head -10`, { stdio: 'inherit' });
