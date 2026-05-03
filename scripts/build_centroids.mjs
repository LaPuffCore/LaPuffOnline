#!/usr/bin/env node
// Build-time precompute: building centroids as packed Float32Array binary.
// Output: public/data/building_centroids.bin
//
// Layout: tightly-packed Float32 pairs [lng0, lat0, lng1, lat1, ...]
// Order: BronxAndSafezones → Brooklyn → Manhattan → Queens → Staten Island
// (must match BOROUGH_FGBS order in mapDataPipeline.js exactly).
//
// Also writes building_centroids.meta.json with:
//   { totalCount, byBorough: [{name, count, offset}] }
//
// Saves ~80ms PiP work on desktop FGB cache build.
//
// Run with: node scripts/build_centroids.mjs

import fs from 'node:fs';
import path from 'node:path';
import { deserialize as fgbDeserialize } from 'flatgeobuf/lib/mjs/geojson.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const BOROUGHS = [
  { name: 'BronxAndSafezones', file: 'BronxAndSafezones_r.fgb' },
  { name: 'Brooklyn',          file: 'Brooklyn_r.fgb' },
  { name: 'Manhattan',         file: 'Manhattan_r.fgb' },
  { name: 'Queens',            file: 'Queens_r.fgb' },
  { name: 'Staten Island',     file: 'Staten Island_r.fgb' },
];

function getCentroid(geom) {
  if (!geom?.coordinates) return [0, 0];
  // For Polygon/MultiPolygon, take first ring of first poly's first vertex (matches getGeomCentroid in pipeline)
  let coord = null;
  if (geom.type === 'Polygon') coord = geom.coordinates[0]?.[0];
  else if (geom.type === 'MultiPolygon') coord = geom.coordinates[0]?.[0]?.[0];
  if (!coord) return [0, 0];
  return [coord[0], coord[1]];
}

const meta = { totalCount: 0, byBorough: [] };
const allCentroids = []; // [lng, lat, lng, lat, ...]

for (const b of BOROUGHS) {
  const filePath = path.join(ROOT, 'public/data', b.file);
  console.log(`Reading ${b.file}...`);
  const buf = fs.readFileSync(filePath);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let count = 0;
  const offset = meta.totalCount;
  for await (const feature of fgbDeserialize(u8)) {
    const [lng, lat] = getCentroid(feature.geometry);
    allCentroids.push(lng, lat);
    count++;
  }
  meta.byBorough.push({ name: b.name, count, offset });
  meta.totalCount += count;
  console.log(`  ${count} centroids (cumulative ${meta.totalCount})`);
}

const f32 = new Float32Array(allCentroids);
const binPath = path.join(ROOT, 'public/data/building_centroids.bin');
const metaPath = path.join(ROOT, 'public/data/building_centroids.meta.json');
fs.writeFileSync(binPath, Buffer.from(f32.buffer));
fs.writeFileSync(metaPath, JSON.stringify(meta));
console.log(`✓ Wrote ${binPath} (${(f32.byteLength / 1024 / 1024).toFixed(2)} MB, ${meta.totalCount} centroids)`);
console.log(`✓ Wrote ${metaPath}`);
