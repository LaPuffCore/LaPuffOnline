#!/usr/bin/env python3
"""
extract_water_z10.py
Extracts all z=10 water polygons from water.pmtiles, dissolves overlapping/touching
polygons (tile-grid seams) into unified shapes, and writes water_static.geojson.

Output: public/data/water_static.geojson
  - Single GeoJSON FeatureCollection
  - All polygons reflect the z=10 simplification level (ocean stays as one polygon)
  - Overlapping/adjacent tile-seam quads are merged into one polygon (no double-fill)
  - Usable at ALL zoom levels with no further recalculation
"""
import sys, json, os
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
    import shapely
except ImportError:
    print("Installing shapely...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "shapely", "-q"])
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    import shapely

# ── helpers ────────────────────────────────────────────────────────────────────
def tile_to_wgs84_bounds(x, y, z):
    """Returns (west, south, east, north) in WGS84 degrees for a tile."""
    n = 2 ** z
    west  =  x / n * 360.0 - 180.0
    east  = (x + 1) / n * 360.0 - 180.0
    import math
    def merc_to_lat(ty):
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
    north = merc_to_lat(y)
    south = merc_to_lat(y + 1)
    return west, south, east, north

def mvt_to_geojson_geoms(tile_data, tile_x, tile_y, tile_z, layer_name='water'):
    """
    Decode MVT tile bytes and return list of shapely geometries projected to WGS84.
    MVT coordinates are in tile-local units [0..4096]. We map them to WGS84 here.
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
    lon_span = east - west
    lat_span = north - south
    EXTENT = 4096.0

    geoms = []
    for feature in decoded[layer_name].get('features', []):
        geom = feature.get('geometry')
        if not geom:
            continue
        gtype = geom.get('type')
        coords = geom.get('coordinates')
        if gtype not in ('Polygon', 'MultiPolygon') or not coords:
            continue

        def mvt_to_wgs(pt):
            lx, ly = pt
            lon = west + (lx / EXTENT) * lon_span
            lat = north - (ly / EXTENT) * lat_span
            return (lon, lat)

        try:
            if gtype == 'Polygon':
                wgs_coords = [[mvt_to_wgs(p) for p in ring] for ring in coords]
                geoms.append(shape({'type': 'Polygon', 'coordinates': wgs_coords}))
            else:  # MultiPolygon
                wgs_polys = [[[mvt_to_wgs(p) for p in ring] for ring in poly] for poly in coords]
                geoms.append(shape({'type': 'MultiPolygon', 'coordinates': wgs_polys}))
        except Exception as e:
            print(f"  WARN: geom conversion failed: {e}", file=sys.stderr)
    return geoms

# ── main ───────────────────────────────────────────────────────────────────────
def main():
    repo_root = Path(__file__).parent.parent
    pmtiles_path = repo_root / 'public' / 'data' / 'water.pmtiles'
    out_path     = repo_root / 'public' / 'data' / 'water_static.geojson'

    if not pmtiles_path.exists():
        print(f"ERROR: {pmtiles_path} not found", file=sys.stderr)
        sys.exit(1)

    print(f"Reading {pmtiles_path} ...")
    with open(pmtiles_path, 'rb') as f:
        source = MemorySource(f.read())

    reader = Reader(source)
    header = reader.header()
    print(f"  min_zoom={header['min_zoom']} max_zoom={header['max_zoom']}")
    print(f"  bounds: {header.get('bounds', 'n/a')}")

    # Enumerate z=10 tiles
    TARGET_Z = 10
    print(f"\nCollecting z={TARGET_Z} tiles ...")
    all_geoms = []
    tile_count = 0

    # We need to iterate tile IDs at z=10. Use the directory.
    # pmtiles Python SDK: reader.get(tile_id) where tile_id is Hilbert ID
    # Iterate by converting z/x/y to tile_id
    from pmtiles.tile import zxy_to_tileid, tileid_to_zxy

    # Determine z10 tile range from header bounds
    # Default: full NYC envelope
    BOUNDS = (-75.5, 40.0, -72.5, 41.5)

    import math
    def lng_to_tile_x(lng, z):
        return int((lng + 180.0) / 360.0 * 2**z)
    def lat_to_tile_y(lat, z):
        lr = math.radians(lat)
        return int((1.0 - math.log(math.tan(lr) + 1.0/math.cos(lr)) / math.pi) / 2.0 * 2**z)

    z = TARGET_Z
    x_min = lng_to_tile_x(BOUNDS[0], z)
    x_max = lng_to_tile_x(BOUNDS[2], z)
    y_min = lat_to_tile_y(BOUNDS[3], z)  # Note: y increases southward
    y_max = lat_to_tile_y(BOUNDS[1], z)

    print(f"  z={z} tile range: x={x_min}-{x_max}, y={y_min}-{y_max}")

    for tx in range(x_min, x_max + 1):
        for ty in range(y_min, y_max + 1):
            tile_data = reader.get(z, tx, ty)
            if tile_data is None:
                continue
            geoms = mvt_to_geojson_geoms(tile_data, tx, ty, z)
            if geoms:
                all_geoms.extend(geoms)
                tile_count += 1

    print(f"  Decoded {tile_count} non-empty tiles, {len(all_geoms)} raw polygons")

    if not all_geoms:
        print("ERROR: no geometries extracted — check source-layer name", file=sys.stderr)
        sys.exit(1)

    # ── Dissolve overlapping/adjacent polygons ─────────────────────────────────
    print("\nDissolving overlapping geometries ...")
    # Fix any invalid geometries first
    fixed = []
    for i, g in enumerate(all_geoms):
        if not g.is_valid:
            g = g.buffer(0)
        if g.is_valid and not g.is_empty:
            fixed.append(g)
    print(f"  {len(fixed)} valid geometries after fix")

    dissolved = unary_union(fixed)
    print(f"  Dissolved → type={dissolved.geom_type}")

    # ── Simplify coordinates (0.001° ≈ 80m at z10 — below perception threshold for a stencil)
    print("\nSimplifying geometry (tolerance=0.001°) ...")
    dissolved = dissolved.simplify(0.001, preserve_topology=True)
    print(f"  After simplify → type={dissolved.geom_type}")

    # ── Write GeoJSON ──────────────────────────────────────────────────────────
    if dissolved.geom_type == 'GeometryCollection':
        # Extract only polygonal parts
        polys = [g for g in dissolved.geoms if g.geom_type in ('Polygon', 'MultiPolygon')]
        from shapely.ops import unary_union as uu
        dissolved = uu(polys) if polys else dissolved

    features = []
    MIN_AREA_DEG2 = 1e-4  # ~1km² equivalent — keeps ocean, rivers, bays; drops tiny docks/ponds invisible at z10

    def round_coords(geom_map):
        """Round all coordinates to 5 decimal places (~1m precision) to shrink file size."""
        import copy
        def rnd(pt): return [round(pt[0], 5), round(pt[1], 5)]
        def rnd_ring(ring): return [rnd(p) for p in ring]
        gm = copy.deepcopy(geom_map)
        t = gm['type']
        if t == 'Polygon':
            gm['coordinates'] = [rnd_ring(r) for r in gm['coordinates']]
        elif t == 'MultiPolygon':
            gm['coordinates'] = [[rnd_ring(r) for r in poly] for poly in gm['coordinates']]
        return gm

    if dissolved.geom_type == 'Polygon':
        if dissolved.area >= MIN_AREA_DEG2:
            features.append({'type': 'Feature', 'properties': {'water': 'ocean'}, 'geometry': round_coords(mapping(dissolved))})
    elif dissolved.geom_type == 'MultiPolygon':
        for poly in dissolved.geoms:
            if poly.area >= MIN_AREA_DEG2:
                features.append({'type': 'Feature', 'properties': {'water': 'ocean'}, 'geometry': round_coords(mapping(poly))})
    else:
        # fallback: dump everything
        for g in (dissolved.geoms if hasattr(dissolved, 'geoms') else [dissolved]):
            if g.geom_type in ('Polygon', 'MultiPolygon') and g.area >= MIN_AREA_DEG2:
                features.append({'type': 'Feature', 'properties': {}, 'geometry': round_coords(mapping(g))})

    fc = {'type': 'FeatureCollection', 'features': features}

    with open(out_path, 'w') as f:
        json.dump(fc, f, separators=(',', ':'))  # compact output

    size_kb = out_path.stat().st_size / 1024
    print(f"\nWrote {out_path}")
    print(f"  Features: {len(features)}")
    print(f"  File size: {size_kb:.1f} KB")
    print("\nDone! Replace water.pmtiles source in MapView with:")
    print("  source: 'water-static', type: 'geojson', data: './data/water_static.geojson'")

if __name__ == '__main__':
    main()
