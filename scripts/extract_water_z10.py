#!/usr/bin/env python3
"""
extract_water_z10.py
Extracts water polygons from water.pmtiles at z=10 (ocean baseplate) and z=11
(NYC-area detail: rivers, channels, bays). Dissolves tile-seam overlaps into
unified shapes and writes water_static.geojson.

Output: public/data/water_static.geojson
  - All polygons from z10 (viewport-wide baseplate) + z11 (NYC detail)
  - Tile-seam duplicates dissolved via unary_union
  - Correct Mercator Y → WGS84 latitude projection (not linear approximation)
  - NO area filtering — every feature preserved
  - NO simplification — exact geometry from source tiles
  - Polygon winding corrected via shapely orient()
"""
import sys, json, math
from pathlib import Path

# ── deps ───────────────────────────────────────────────────────────────────────
try:
    from pmtiles.reader import MemorySource, Reader
    import gzip
except ImportError:
    print("ERROR: install pmtiles: pip install pmtiles", file=sys.stderr)
    sys.exit(1)

try:
    import mapbox_vector_tile
except ImportError:
    print("Installing mapbox_vector_tile...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "mapbox-vector-tile", "-q"])
    import mapbox_vector_tile

try:
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    from shapely.geometry.polygon import orient
    import shapely
except ImportError:
    print("Installing shapely...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "shapely", "-q"])
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    from shapely.geometry.polygon import orient
    import shapely

# ── helpers ────────────────────────────────────────────────────────────────────
def tile_to_wgs84_bounds(x, y, z):
    """Returns (west, south, east, north) in WGS84 degrees for a tile."""
    n = 2 ** z
    west  =  x / n * 360.0 - 180.0
    east  = (x + 1) / n * 360.0 - 180.0
    def merc_to_lat(ty):
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
    north = merc_to_lat(y)
    south = merc_to_lat(y + 1)
    return west, south, east, north

def lng_to_tile_x(lng, z):
    return int((lng + 180.0) / 360.0 * 2**z)

def lat_to_tile_y(lat, z):
    lr = math.radians(lat)
    return int((1.0 - math.log(math.tan(lr) + 1.0/math.cos(lr)) / math.pi) / 2.0 * 2**z)

# Correct Mercator Y helpers for accurate WGS84 projection within a tile.
# Linear lat interpolation introduces ~100-200m errors at z10; this is exact.
def lat_to_merc_y(lat_deg):
    r = math.radians(lat_deg)
    return math.log(math.tan(math.pi / 4 + r / 2))

def merc_y_to_lat(my):
    return math.degrees(2 * math.atan(math.exp(my)) - math.pi / 2)

def mvt_to_geojson_geoms(tile_data, tile_x, tile_y, tile_z, layer_name='water'):
    """
    Decode MVT tile bytes → list of shapely geometries projected to WGS84.
    MVT coords are tile-local integers [0..extent]. We project to WGS84 here
    using correct inverse-Mercator for latitude (not linear approximation).
    """
    if not tile_data:
        return []
    try:
        raw = bytes(tile_data)
        if raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)
        decoded = mapbox_vector_tile.decode(raw)
    except Exception as e:
        print(f"  WARN: tile {tile_z}/{tile_x}/{tile_y} decode failed: {e}", file=sys.stderr)
        return []

    if layer_name not in decoded:
        return []

    west, south, east, north = tile_to_wgs84_bounds(tile_x, tile_y, tile_z)
    lon_span  = east - west
    merc_n    = lat_to_merc_y(north)
    merc_s    = lat_to_merc_y(south)
    merc_span = merc_n - merc_s
    EXTENT    = 4096.0

    def mvt_to_wgs(pt):
        lx, ly = pt
        lon = west + (lx / EXTENT) * lon_span
        # Correct: interpolate in Mercator Y space, then convert to WGS84 lat
        my  = merc_n - (ly / EXTENT) * merc_span
        lat = merc_y_to_lat(my)
        return (lon, lat)

    geoms = []
    for feature in decoded[layer_name].get('features', []):
        geom   = feature.get('geometry')
        if not geom:
            continue
        gtype  = geom.get('type')
        coords = geom.get('coordinates')
        if gtype not in ('Polygon', 'MultiPolygon') or not coords:
            continue
        try:
            if gtype == 'Polygon':
                wgs_coords = [[mvt_to_wgs(p) for p in ring] for ring in coords]
                g = shape({'type': 'Polygon', 'coordinates': wgs_coords})
            else:
                wgs_polys  = [[[mvt_to_wgs(p) for p in ring] for ring in poly] for poly in coords]
                g = shape({'type': 'MultiPolygon', 'coordinates': wgs_polys})
            geoms.append(g)
        except Exception as e:
            print(f"  WARN: geom conversion failed at {tile_z}/{tile_x}/{tile_y}: {e}", file=sys.stderr)
    return geoms

def extract_tiles(reader, z, bounds, label):
    """Extract all non-empty water polygons from tiles at zoom z within bounds."""
    west, south, east, north = bounds
    x_min = lng_to_tile_x(west, z)
    x_max = lng_to_tile_x(east, z)
    y_min = lat_to_tile_y(north, z)   # y increases southward
    y_max = lat_to_tile_y(south, z)
    print(f"  {label}: z={z} tiles x={x_min}..{x_max}, y={y_min}..{y_max} "
          f"({(x_max-x_min+1)*(y_max-y_min+1)} cells)")
    geoms      = []
    tile_count = 0
    for tx in range(x_min, x_max + 1):
        for ty in range(y_min, y_max + 1):
            tile_data = reader.get(z, tx, ty)
            if tile_data is None:
                continue
            gs = mvt_to_geojson_geoms(tile_data, tx, ty, z)
            if gs:
                geoms.extend(gs)
                tile_count += 1
    print(f"    → {tile_count} non-empty tiles, {len(geoms)} raw polygons")
    return geoms

# ── main ───────────────────────────────────────────────────────────────────────
def main():
    repo_root    = Path(__file__).parent.parent
    pmtiles_path = repo_root / 'public' / 'data' / 'water.pmtiles'
    out_path     = repo_root / 'public' / 'data' / 'water_static.geojson'

    if not pmtiles_path.exists():
        print(f"ERROR: {pmtiles_path} not found", file=sys.stderr)
        sys.exit(1)

    print(f"Reading {pmtiles_path} ({pmtiles_path.stat().st_size/1024/1024:.1f} MB) ...")
    with open(pmtiles_path, 'rb') as f:
        source = MemorySource(f.read())

    reader = Reader(source)
    header = reader.header()
    print(f"  header: min_zoom={header['min_zoom']}  max_zoom={header['max_zoom']}")

    # ── Two-zoom strategy ────────────────────────────────────────────────────
    # z10: Full MapLibre viewport envelope — ocean baseplate, NY Bight, Atlantic.
    # z11: NYC detail area — rivers, channels, East River, Hudson, Harlem River, bays.
    # Using z11 detail for NYC area prevents the area-filter issue that previously
    # removed small-but-critical water bodies (channels around Manhattan).
    FULL_BBOX = (-75.5, 40.0, -72.5, 41.5)   # matches MapLibre maxBounds
    NYC_BBOX  = (-74.5, 40.3, -73.5, 41.1)   # NYC detail area for z11

    print("\nExtracting tiles ...")
    all_geoms = []
    all_geoms += extract_tiles(reader, 10, FULL_BBOX, 'z10 full viewport')
    all_geoms += extract_tiles(reader, 11, NYC_BBOX,  'z11 NYC detail')

    if not all_geoms:
        print("ERROR: no geometries extracted — check source-layer name 'water'", file=sys.stderr)
        sys.exit(1)

    # ── Fix invalid geometries before dissolve ───────────────────────────────
    print(f"\nFixing invalid geometries ({len(all_geoms)} raw) ...")
    fixed = []
    for g in all_geoms:
        if not g.is_valid:
            g = g.buffer(0)
        if g.is_valid and not g.is_empty:
            fixed.append(g)
    print(f"  {len(fixed)} valid geometries after fix")

    # ── Dissolve tile-seam overlaps ──────────────────────────────────────────
    # unary_union merges polygons that touch/overlap — removes tile-grid duplicate edges.
    # This correctly fuses any Manhattan-channel polygon into the main ocean body.
    print("\nDissolving tile-seam overlaps (unary_union) ...")
    dissolved = unary_union(fixed)
    print(f"  Dissolved → type={dissolved.geom_type}")

    # ── Extract polygon parts and fix winding order ──────────────────────────
    print("\nExtracting final polygons and fixing winding order ...")
    raw_polys = []
    if dissolved.geom_type == 'Polygon':
        raw_polys = [dissolved]
    elif dissolved.geom_type == 'MultiPolygon':
        raw_polys = list(dissolved.geoms)
    elif dissolved.geom_type == 'GeometryCollection':
        raw_polys = [g for g in dissolved.geoms if g.geom_type in ('Polygon', 'MultiPolygon')]

    # shapely orient(): sign=1.0 → outer ring CCW (GeoJSON standard), holes CW.
    # Prevents rendering artifacts from incorrect winding order.
    oriented = []
    for g in raw_polys:
        if g.geom_type == 'MultiPolygon':
            for part in g.geoms:
                o = orient(part, sign=1.0)
                if not o.is_empty:
                    oriented.append(o)
        else:
            o = orient(g, sign=1.0)
            if not o.is_empty:
                oriented.append(o)

    print(f"  {len(oriented)} final polygons")

    # ── Write GeoJSON ─────────────────────────────────────────────────────────
    # NO area filtering — every feature preserved as requested.
    # NO simplification — exact geometry from source tiles.
    # Coordinates rounded to 6 decimal places (~0.1m precision, tiny file overhead vs 5dp).
    def round_coords(geom_map):
        def rnd(pt):  return [round(pt[0], 6), round(pt[1], 6)]
        def rnd_ring(ring): return [rnd(p) for p in ring]
        gm = dict(geom_map)
        t  = gm['type']
        if t == 'Polygon':
            gm['coordinates'] = [rnd_ring(r) for r in gm['coordinates']]
        elif t == 'MultiPolygon':
            gm['coordinates'] = [[rnd_ring(r) for r in poly] for poly in gm['coordinates']]
        return gm

    features = [
        {'type': 'Feature', 'properties': {'water': 'ocean'}, 'geometry': round_coords(mapping(g))}
        for g in oriented
    ]

    fc = {'type': 'FeatureCollection', 'features': features}
    with open(out_path, 'w') as f:
        json.dump(fc, f, separators=(',', ':'))

    size_kb = out_path.stat().st_size / 1024
    print(f"\n✓ Wrote {out_path}")
    print(f"  Features : {len(features)}")
    print(f"  File size: {size_kb:.0f} KB")

if __name__ == '__main__':
    main()
