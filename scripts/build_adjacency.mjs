#!/usr/bin/env node
// Build-time precompute: ZCTA adjacency matrix as JSON.
// Output: public/data/zcta_adjacency.json
// Pipeline reads this in Phase 2A — saves ~6% of mobile load + ~6% of desktop load.
//
// Adjacency rule MUST match mapDataPipeline.js / MapView.jsx buildAdjacency():
//   bbox-overlap with 0.008° buffer.
// IMPORTANT: feature order in JSON must match GeoJSON load order exactly.
//
// Run with: node scripts/build_adjacency.mjs

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GEO_PATH = path.join(ROOT, 'public/data/MODZCTA_2010_WGS1984.geo.json');
const OUT_PATH = path.join(ROOT, 'public/data/zcta_adjacency.json');

// Mirror Phase 2A safezone splitting so feature indices align with what runtime sees.
const SPECIAL_ZIPS = new Set(['99999']);
function isSpecialZip(z) {
  if (!z) return false;
  if (SPECIAL_ZIPS.has(String(z))) return true;
  const n = parseInt(z, 10);
  return !isNaN(n) && n > 11697;
}

const raw = JSON.parse(fs.readFileSync(GEO_PATH, 'utf8'));
const features = [];
let safezoneCounter = 0;

raw.features.forEach((f, i) => {
  let zip = String(f.properties.MODZCTA || f.properties.modzcta || '');
  if (isSpecialZip(zip) && f.geometry?.type === 'MultiPolygon') {
    f.geometry.coordinates.forEach((polyCoords, pi) => {
      safezoneCounter++;
      features.push({ ...f, geometry: { type: 'Polygon', coordinates: polyCoords } });
    });
  } else {
    features.push(f);
  }
});

console.log(`Computing adjacency for ${features.length} features...`);

const bboxes = features.map(f => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const rings = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat(1) : f.geometry.coordinates;
  rings.forEach(ring => ring.forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }));
  return { minX, minY, maxX, maxY };
});

const buf = 0.008;
const adj = features.map((_, i) => {
  const a = bboxes[i];
  const neighbors = [];
  for (let j = 0; j < features.length; j++) {
    if (j === i) continue;
    const b = bboxes[j];
    if (a.maxX + buf >= b.minX && b.maxX + buf >= a.minX &&
        a.maxY + buf >= b.minY && b.maxY + buf >= a.minY) {
      neighbors.push(j);
    }
  }
  return neighbors;
});

fs.writeFileSync(OUT_PATH, JSON.stringify(adj));
const stat = fs.statSync(OUT_PATH);
console.log(`✓ Wrote ${OUT_PATH} (${(stat.size / 1024).toFixed(1)} KB, ${features.length} entries)`);
