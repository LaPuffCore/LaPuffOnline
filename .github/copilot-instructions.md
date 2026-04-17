# LaPuffOnline — Copilot Instructions

> **Living document**: These instructions reflect the **current working version** of the codebase, not a finalized spec. Values, thresholds, and architecture may change as the project evolves. Always treat this as "where we are now" and update it as changes land.

## Scope First
- Start with the smallest relevant scope.
- Do **not** read the full codebase for every task.
- Only expand to nearby files when the change clearly affects shared logic, styling, data flow, or reused components.

## Workflow
1. Read the file or files most likely involved.
2. Make the required change.
3. Check related files only if needed to keep behavior consistent.
4. Run `npm run build` at the end for code changes.

## Guardrails
- Do not run dev servers or deploy commands.
- Use `npm run build` only for verification.
- Prefer focused, surgical edits over broad refactors unless the task explicitly requires one.
- Do not inspect or search `node_modules`, `dist`, `.vite`, or other generated/vendor folders unless the task explicitly targets them.
- Prefer searches scoped to `src`, `.github`, `public`, or a specific file path instead of repo-wide scans.
- Follow the user's requests explicitly without adding extra features or changes that were not asked for, even if they seem beneficial. Focus on delivering exactly what was requested to maintain clarity and avoid unintended consequences.

## Project Notes
- Stack: React + Vite + Tailwind CSS + Supabase.
- Theme system uses CSS custom properties and `.lp-theme-scope`, Cursor styling is managed via CSS variables and can be overridden per tile or globally.
- `src/lib/theme.js` contains shared theme helpers.
- `EventTile` and `EventDetailPopup` should stay visually and behaviorally aligned where they share event UI.
- Map view uses Maplibre GL js and Maptiler API, with custom styling and theming applied via CSS variables.

## Archival Inertia Ability
- You have the power to record known conventions and logic in the section below this for future reference. 
- This can help maintain consistency and speed up future tasks by reducing the need to re-derive or re-discover established patterns.
- You can update this section as you learn more about the codebase or as conventions evolve or change as needed to make it up to date.
- Update the below section after each successful fix or feature implementation to capture any new insights or patterns you discover during your work. This will help build a comprehensive reference for future contributors and maintainers of the project.
- Update the section below while we are working on a fix or feature, so that you can capture insights in real time and ensure that the information is fresh and relevant to the task at hand. This will also help you internalize the conventions and logic as you work with them, making it easier to apply them in future tasks. 
- Do not let this process slow you down or distract you from the task. Focus on the task first, and then take a moment to jot down any relevant insights or patterns in the section below after you have completed the task. This way, you can maintain your workflow while still building up a valuable reference for the future.
- You do not need to read the full convention and logic section for every fix but instead you can start each fix by quickly scanning and searching within the section for any relevant information that might be helpful for the task at hand using a contextual search. This can help you quickly orient yourself and apply established patterns without having to re-derive them from scratch.
- User commands or requests within the specific prompt take precedence over any conventions or logic documented below. Always follow the user's instructions explicitly, even if they conflict with established conventions. The user's requests are the primary source of truth for what changes should be made, and the conventions are there to provide guidance and context but should not override the user's explicit instructions.

## Known Conventions And Logic

### App Architecture & Provider Chain
- Root: `App` → `AuthProvider` → `ThemeProvider` → `QueryClientProvider` → `Router` → `CustomCursorOverlay` → `AuthenticatedApp` → `AppWithEvents` → Routes.
- Router basename: `/LaPuffOnline` (subfolder deployment on GitHub Pages).
- Three routes: `/` (Home), `/favorites` (FavoritesPage), `/calendar` (CalendarPage), `*` (PageNotFound).
- `AppWithEvents` owns the single `events` state: merged `[...userEvents, ...autoEvents]`. All child pages receive this array.
- Entry: `main.jsx` uses React 18 `createRoot`, no `StrictMode` wrapper.

### Event Data Model & Two-Source System
- **User events**: Supabase `events` table. Fetched by `getApprovedEvents()`. No `_auto` flag.
- **Auto events**: Supabase `auto_events` table. Fetched by `getAutoEvents()`. Injected with `_auto: true`. Also enriches: `name` defaults to capitalized `source_site` if missing; `source_url` merged into `relevant_links` array so the popup shows a clickable source link.
- **Sample events**: Hardcoded in `sampleEvents.js`, flagged `_sample: true`, gated by `SAMPLE_MODE` in `sampleConfig.js`. Samples still on during development.
- Merge order: user/sample events first, auto events appended at end.
- Cached to `sessionStorage['lapuff_cached_events']` after merge. Fallback on error: `SAMPLE_EVENTS` if SAMPLE_MODE.
- `hydrateFavoriteEventCache(events)` runs on every `events` change to keep favorites offline-ready.

### Heatmap & Auto Event Exclusion (CRITICAL)
- **Auto events do NOT count toward the heatmap**. Only user-submitted events affect heat density.
- `buildZipEventMap()` in `MapView.jsx` skips events where `e._auto || e._sample`.
- This is a hard user requirement — auto events are volume-filler, not indicators of community activity.

### TileView Filters & Source Modes
- `DEFAULT_SOURCE = 'user'` — app loads showing user-submitted events first.
- Source modes: `'user'` (no `_sample` and no `_auto`), `'auto'` (`_sample || _auto`), `'all'` (no filter).
- `PAGE_SIZE = 12` items per Show More increment. Show More expands; becomes Show Less when exhausted.
- Filter chain (memoized via `useMemo`): date range → search → source mode → borough → price → RSVP → favorites → tags (AND) → trend → emoji (ranked sort).
- `MAX_TAG_FILTERS = 3`, `MAX_EMOJI_FILTERS = 5`.
- Archive toggle: `showArchive` flips between past (`ed < now`) and future events.
- Timespan options: 1d, 7d, 30d, 3mo, 6mo. Default index: 4 (6 months).
- Borough filter: `['All', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']`.
- Price filter: `['all', 'free', '$', '$$', '$$$']`.
- Search uses `expandSearchQuery()` with 80+ keyword synonyms for fuzzy matching.
- Emoji ranking: direct match gets priority, related emoji set (EMOJI_GROUPS) gets secondary rank.
- Popular emojis shown: 7 mobile, 8 desktop.
- Trend filter uses `getFavTrendsForEvents()` — batch-fetched only when filter is active.
- Favorites + archive filters apply to past archival mode for review.

### EventTile Conventions
- Border: `3px solid {borderColor}`, shadow: `6px 6px 0px {tileShadowColor}`, rounded: `2rem`.
- Hover: border color → accent color, scale 1.02.
- Image section height: `h-40 sm:h-44`. With image: grayscale-friendly zoom (0.97→1.05). Without: emoji placeholder with tinted background.
- Emoji fallback: `representative_emoji || '🎉'`.
- Price default: `'FREE'` when missing.
- Tags limited to 3 max to prevent height shifts.
- Auto events show 🤖 AUTO badge overlay.
- Title: `font-black text-[13px] sm:text-sm` with `line-clamp-2` and `min-h-[2.5rem]`.
- Favorite badge: count + trend icon (green up, red down, blue dash).
- Expiry: events older than 7 days (`7 * 86400000` ms) are marked expired; images hidden.
- `getTileAccentColor(event.hex_color, theme)` determines accent: tileAccentOverride > event hex > default.
- Real-time fav count via `subscribeToFavoriteCount(event.id, callback)`.
- Date, time, location text → `bodyTextColor` via inline style (not hardcoded Tailwind text-gray-*); opacity dimming 0.75/0.7 for secondary text.

### EventDetailPopup Conventions
- Portal renders to `document.body`, z-index `100000`.
- Border: `4px sm:6px solid {borderColor}`, shadow: `15px 15px rgba(0,0,0,0.2)`.
- Image navigation: arrows on desktop, swipe on mobile (threshold: `|dx| > 55px`).
- Keyboard: Arrow left/right for tile nav, Escape to close.
- Date button navigates to `/calendar` with `{ initialDate, initialView: 'weekly' }`.
- Tags: all displayed (no limit), styled `text-[8px] sm:text-[9px] font-black` with `#` prefix.
- Links: removes protocol prefix `.replace(/^https?:\/\/(www\.)?/, '')`.
- MiniMap: OpenStreetMap embed if lat/lng, else Google Maps. Grayscale default, color on hover.
- Backdrop: mobile = `bg-black/45`, desktop = `backdrop-blur-xl bg-white/40`.
- **Text color split**: date button and MiniMap address → `buttonTextColor`; event description → `bodyTextColor`. Both inherit `bg-gray-50` (= `--lp-button-fill`) and `buttonShadowColor` for consistent button styling.
- `border-black` class must NOT be on the popup card or any element that needs `style={{ borderColor }}` inline — the CSS scope `!important` override will win. Remove the class and use only inline style.
- Image carousel arrows: always `bg-black/55 text-white` with z-20 — never inherit fill color (would be invisible on light images).

### Theme System
- 54 customizable fields via `THEME_FIELDS` in `src/lib/theme.js`.
- Default accent: `#7C3AED` (purple). Page bg: `#FAFAF8`. Surface: `#FFFFFF`.
- CSS variables applied to `:root` via `applyThemeToDocument()`: `--lp-accent`, `--lp-accent-soft` (14% opacity), `--lp-accent-softer` (8% opacity), `--lp-title-text`, `--lp-subtext`, `--lp-body-text`, `--lp-button-*`, `--lp-page-bg`, `--lp-surface-bg`, `--lp-topbar-*`, `--lp-micro-icon`, `--lp-tile-shadow`, `--lp-logo-*`, `--lp-search-*`, `--lp-leaderboard-*`, `--lp-calendar-*`, `--lp-emoji-stain`.
- `.lp-theme-scope` wrapper remaps Tailwind classes to CSS variables (e.g., `.bg-white` → `--lp-surface-bg`).
- Auto-contrast: `applyThemeToDocument(theme, overrides)` takes overrides as 2nd arg. A text var is only auto-contrasted when its key is NOT in overrides (user hasn't set it). `safeText(text, bg)` uses contrast ratio ≥3:1.
- `bg-gray-50` in `.lp-theme-scope` → `var(--lp-button-fill)`. This is semantic: gray-50 = button surface across all button-like elements.
- `.lp-hover-invert:hover` uses `--lp-button-text` as bg and `--lp-button-fill` as text — correct inversion even with custom themes. Higher specificity than `!important` scope.
- `--lp-button-shadow` CSS var drives all `shadow-[NpxNpx0pxblack]` Tailwind classes inside `.lp-theme-scope` via targeted rules.
- ThemeCustomizerModal ThemeRow uses JS hover state (not CSS group-hover) so dynamic inline styles can override properly.
- Anti-softlock: ThemeRow hover bg = accentColor, text = `contrastColor(accent)`. Footer Apply/Cancel/Reset All always hover to black fill + white text — no exceptions.
- Footer idle for Cancel/ResetAll: uses `buttonTextColor` if it passes contrast check vs `idleFillBg`, else `contrastColor(buttonFill)`.
- `buttonShadowColor` field under Buttons section in THEME_FIELDS.
- Persistence: `localStorage['lapuff_theme_overrides']` as JSON.
- Preview mode: `setPreviewThemeOverrides()` for live editing, `clearPreviewThemeOverrides()` to cancel.
- Dark section hover: labels turn `--lp-hover-text` (#ccff00 fluorescent) when section bg luminance < 0.35.

### Cursor System
- Cursor outline default: on, black, 2px.
- True cursor default: `cursorType: 'default'` with other cursor keys cleared.
- Portaled theme pickers use `data-theme-modal-portal="true"`.
- Custom cursor: `html.lp-force-custom-cursor` hides native cursors; `CustomCursorOverlay` renders replacement.
- Cursor trails: 5 groups (basic, neon, retro, particles, effects), each with name/id/group.

### Styling Conventions (Global)
- Font: Nunito (400, 600, 700, 800, 900) from Google Fonts.
- Border pattern: `border-3 border-black` (thick bold retro).
- Shadow pattern: `box-shadow: Npx Npx 0px {color}` — retro offset, no blur. Button shadows use `--lp-button-shadow`, tile shadows use `--lp-tile-shadow`.
- Rounded: `rounded-2xl` (32px) or `rounded-3xl` (48px).
- Active button: `bg-[#7C3AED] text-white border-[#7C3AED]`.
- Hover: `scale-[1.02] -translate-y-1` or `bg-{accent}14` (8% opacity tint).
- `.lp-hover-invert:hover` inverts button fill ↔ text color.
- `.lp-button-base` + `.lp-button-active` for standard button states.
- `.lp-accent-shadow`: `3px 3px 0 var(--lp-accent)`.
- `.border-3 { border-width: 3px !important; }` custom utility.
- Grid: `grid-cols-2 md:grid-cols-3 lg:grid-cols-4` with gap scaling. Mobile tiles scale to 0.92 with negative margins.
- Responsive: sm (640px tablet), md (768px desktop), lg (1024px large).

### MapView — Core Facts
- Library: MapLibre GL JS with MapTiler tiles. Key: `VjoJJ0mSCXFo9kFGYGxJ`.
- File: `src/components/MapView.jsx` (~2967 lines as of commit 1c3c045).
- Center: `[-73.94, 40.71]`, zoom 10.5, bounds `[[-75.5, 40.0], [-72.5, 41.5]]`.
- GeoJSON: `./data/MODZCTA_2010_WGS1984.geo.json` (cleaned) for NYC zip boundaries.
- Borough GeoJSON: `./data/borough.geo.json` for 5 NYC borough MultiPolygons.
- Heat tiers: cold (< 0.30), cool (0.30–0.55), warm (0.55–0.80), orange (0.80–1.0), hot (≥ 1.0). 4-pass adjacency blur.
- Heat colors: `#00ccdd` (cold), `#00dd66` (cool), `#f5c800` (warm/golden-yellow), `#dd6600` (orange), `#cc0d00` (hot).
- Heat mid colors (borough outlines): `#339eb3` (cold), `#33b366` (cool), `#b39900` (warm), `#cc6622` (orange), `#cc3333` (hot).
- Heat dark colors (upper border): `#001f29` (cold), `#002910` (cool), `#5c4a00` (warm), `#3d1500` (orange), `#2e0000` (hot).
- Normalization: logarithmic `Math.log(count+1) / Math.log(max+1)`.
- Pitch/bearing: 3D on → `{ pitch: 48, bearing: -17 }`, Real3D → `{ pitch: 55, bearing: -17 }`, off → `{ pitch: 0, bearing: 0 }`.
- ZipHologram: Canvas 460x340 (desktop) or 400x260 (mobile) with sine wave rotation, scanlines, glitch. Desktop and mobile versions are separate components (~95% identical code — candidate for merging).
- Special zips: `99999` or `>11697` → SAFEZONE (white fill, locked).
- Satellite mode: ArcGIS World Imagery tiles via separate MapLibre canvas instance (z=1 behind main map z=2). Camera synced on every `move` event.
- Offline: disables 3D features, shows connection notice.
- Side panel pagination: `PAGE_SIZE = 6`.

### MapView — Mode Architecture & Toggle Logic
- **State variables**: `heatmap` (bool), `satellite` (bool), `threeD` (bool), `real3D` (bool), `topoOn` (bool).
- **3 core view categories**: 2D, 3D, Real3D. Only one active at a time.
  - **2D** = `threeD === false && real3D === false` (default).
  - **3D** = `threeD === true && real3D === false`. Toggle handler: `setThreeD(!v)` + if turning ON → `setReal3D(false)`.
  - **Real3D** = `real3D === true && threeD === false`. Toggle handler: `setReal3D(!v)` + if turning ON → `setThreeD(false)`.
- **2 additive overlays**: Satellite and Heatmap. Each is independent. Both can be ON simultaneously with any core view.
- **Topo sub-toggle**: `topoOn` is a child of `heatmap`. Only visible/usable when `heatmap === true`. Turning heatmap OFF does NOT auto-clear `topoOn` — it just hides the button. Turning heatmap ON with topo already toggled means topo is immediately active. `topoOn` is persisted to `localStorage['lapuff_topo_on']`.
- **12 total mode combinations** (3 core × 4 overlay states):

| Core | Heatmap OFF + Sat OFF | Heatmap ON + Sat OFF | Heatmap OFF + Sat ON | Heatmap ON + Sat ON |
|---|---|---|---|---|
| **2D** | Base state | Heatmap colors + topo | Satellite imagery | Full combo |
| **3D** | Extruded zips | Extruded + heat colors | Extruded + satellite | Full combo |
| **Real3D** | Buildings (red) | Buildings (tier colors) | Buildings + satellite | Full combo |

- **What each mode owns**:
  - **2D**: ZCTA fill, ZCTA outline, borough outline (flat), heat-underlay. No extrusions, no stencil, no Real3D layers.
  - **3D**: Everything in 2D + ZCTA fill-extrusions, upper 3D border extrusions, borough outline extrusions. Pitch/bearing: `{48, -17}`.
  - **Real3D**: Replaces all 3D layers with own stack: park, roads, landuse-baseplate, buildings-baseplate, buildings. Adds water. Borough outline shared. Pitch/bearing: `{55, -17}`. All feature layers NYC-restricted via `['within', NYC_BBOX_GEOM]`.
  - **Satellite**: Raster source+layer on the main map in ALL modes (bottom of stack). Single canvas, no separate MapLibre instance.
  - **Heatmap**: Recolors ZCTA fills/extrusions by tier. Enables heat-underlay (gaussian kernel). In Real3D: triggers `assignBuildingTiersToMap` for building-to-zip color assignment.
  - **Topo**: When `heatmap && topoOn`: sets heat-underlay opacity to 0.50 (otherwise 0). Works on main map in all modes.

- **Conditionals must cleanly separate** 2D from 3D from Real3D logic. Each overlay combo within a core view may need its own paint property values (e.g., fill opacity differs satellite vs non-satellite).

### MapView — 2D Mode Rules
- **2D is DONE and correct. DO NOT TOUCH 2D logic.** All 2D modes (standard, heatmap, satellite, and their combos) work perfectly and must remain exactly as-is unless the 2d mode is specifically asked to change and this will only be later with map theme color customization not during our map overhaul.

### MapView — 3D Mode Rules (Extruded ZIP Codes)
- 3D mode extrudes the ZCTA zip polygons as colored blocks.
- The **"Upper 3D Border"** is the top-edge ring of each extrusion, rendered as a separate red-tinted extrusion layer sitting on top of the zip block at a translated height. It traces the 2D zip boundary lines but elevated to the height of the block beneath it. In heatmap combos, the upper border height follows the heatmap extrusion height of each zip.
- 3D extrusion heights per tier: 30, 200, 700, 1600, 2800.
- Outline: neon red `#ff2200`, glow layers at varying widths.

### MapView — 3D Known Issues & Desired Fixes
- **Zip polygon glitching** (e.g., zip 11422): Random flat red vertices/caps appear at certain zoom levels. This is a GeoJSON triangulation issue — broken polygons or bad zoom-out simplification in the source data. Investigate the cleaned GeoJSON for broken polygon rings. If any derived zip data elsewhere in the codebase was generated from an older GeoJSON, regenerate it.

### MapView — Real3D Mode Rules (Individual Buildings)
- Real3D renders NYC building footprints from a local FlatGeobuf file (`public/data/BUILDING.fgb`, 381K polygons).
- **Data source**: GeoJSON via `flatgeobuf` library. Properties: `height_roof` (float), `ground_elevation` (float, 181 nulls), `objectid` (string). All parsed to numbers at load time.
- **NYC-only data** — no `['within']` filter needed for buildings (unlike previous MapTiler approach).
- **3 zoom tiers**:
  - Far zoom (< zoom 13): No 3D building extrusions or baseplates rendered. Roads and landuse visible.
  - Medium zoom (zoom 13–14): Baseplates only (flat footprints at 7m height, opacity fade-in z13–13.5).
  - Close zoom (zoom 14+): Full 3D building extrusions at actual `height_roof` heights (opacity 0.92).
- **Road feature zoom schema** (roads disappear when baseplates appear):
  - Motorway/trunk: z9 to z13.
  - Primary/secondary: z11 to z13.
  - Tertiary/residential: z12 to z13.
  - Landuse proxy: maxzoom 13, fades out z12-13.
- **Two color palettes** with clustering via `objectid % N` for GPU-side differentiation:
  - **Standard palette (heatmap OFF)**: 7 dark-red shades via `_s7` (objectid%7). Baseplates use 3 dark reds via `_s7`.
  - **Heatmap palette (heatmap ON)**: Buildings use baked `_tier_X` property + `_s5` (objectid%5) shade index. Baseplates use uniform dark tier colors.
- **Tier baking**: `bakeAllTiersIntoBuildings()` writes `_tier_0.._tier_4` for all 5 timespans. Paint expressions read `['get', '_tier_X']` — GPU evaluates directly. Zero per-building CPU work on timespan/heatmap change.
- **No more raytracer**: Eliminated `assignBuildingTiersToMap` (queryRenderedFeatures + setFeatureState). No tile-seam artifacts. No moveend/zoomend listeners for building coloring.

### MapView — Real3D Architecture (Simplified — no stencil, no separate canvases)

#### Single-Canvas Architecture (ALL modes):
All modes (2D, 3D, Real3D) use a single MapLibre canvas. Satellite and topo heatmap are normal layers on the main map. No separate canvases, no camera sync.

#### NYC Restriction:
- Fill/line layers from MapTiler use `filter: ['within', NYC_BBOX_GEOM]` for GPU-side restriction.
- Building/baseplate layers use local FGB data (NYC-only) — no filter needed.

**NYC-restricted layers** (only render inside NYC bounding box):
- `real3d-park` (fill)
- `real3d-roads-primary` (line)
- `real3d-roads-tertiary` (line)
- `real3d-landuse-baseplate` (fill)

**Unrestricted layers** (intentionally extend past borough edges):
- `real3d-water` (fill) — rivers/harbor flow past boroughs
- `real3d-roads-motorway` (line) — highways cross boundaries
- `real3d-buildings-baseplate` (fill-extrusion) — NYC-only FGB data, source: `fgb-buildings`
- `real3d-buildings` (fill-extrusion) — NYC-only FGB data, source: `fgb-buildings`
- `borough-outline` (fill-extrusion) — outer NYC perimeter
- `sat-layer` (raster) — satellite imagery everywhere
- `heat-underlay` (heatmap) — topo glow radiates past boroughs

#### Real3D Layer Stack (back to front):
```
sat-layer (raster, when satellite ON)
real3d-water (fill, unrestricted — BELOW heat-underlay)
heat-underlay (heatmap, when heatmap + topo ON)
real3d-park (fill, NYC-restricted)
real3d-roads-primary (line, NYC-restricted, z11-13)
real3d-roads-tertiary (line, NYC-restricted, z12-13)
real3d-landuse-baseplate (fill, NYC-restricted, maxzoom 13)
real3d-buildings-baseplate (fill-extrusion, FGB source, z13-14)
real3d-buildings (fill-extrusion, FGB source, z14+)
real3d-roads-motorway (line, unrestricted, z9-13, moved to top)
borough-outline (fill-extrusion, unrestricted, topmost)
```

#### FGB Building Data Pipeline
- `loadBuildingFGB()`: Fetches `BUILDING.fgb` via flatgeobuf `deserialize(resp.body)`, parses all string properties to numbers, caches in `buildingFGBRef`.
- `bakeAllTiersIntoBuildings()`: Writes `_tier_0.._tier_4` into every building's properties from `precomputedTiersRef` + `buildingZctaMapRef`. Single `setData` push.
- GeoJSON source `fgb-buildings` with `generateId: true` — MapLibre assigns sequential IDs for internal use.
- Source persists across Real3D toggles (visibility toggle, not destroy/recreate).

#### Satellite — Unified Raster Layer (All Modes)
- Satellite is a raster source+layer on the main map in ALL modes (2D, 3D, Real3D).
- No separate MapLibre canvas. No camera sync overhead.
- Raster layer inserted at bottom of stack, below all other layers.

#### Redundant Computations Found
- `PaginatedSection` component defined inside MapView — recreated on every render. Should be module-level.
- `ZipHologram` + `ZipHologramMobile` — 95% duplicate code, only differ in canvas size and depth.

#### Toggle Lag — Tier Data Caching
- `cachedTierDataRef` caches `buildZipEventMap` + `computeTiers` results between effect runs.
- Paint-only toggles (satellite, topoOn, threeD) skip expensive tier recomputation.
- Only events/timespanIdx/geoData changes trigger full recomputation.

#### Borough Outline — Safezone Filtering + Height Stagger
- `removeSafezoneOverlapQuads` replaces `fixSharedBoundaryQuads`. Interior borough edges are KEPT for visual clarity; only quads overlapping safezone ZCTA features are removed.
- Height stagger: each borough's outline base/height offset by `_boroughIdx * 0.1m` to prevent Z-fighting at overlapping edges.
- `_boroughIdx` assigned via rank map (not by sorting features) — features stay in original GeoJSON order to match skeleton cache index. Higher-tier boroughs get higher `_boroughIdx` and render on top.
- Width ramp increased from 2x-4x to 2.5x-7x (zoom 11→9) to reduce pixelation at low zoom.
- Borough outline color reads baked `_color` from feature properties. Color persists across zoom changes — the zoom handler regenerates quad geometry from skeleton + the same `boroughWithColorRef` overrides.

#### Dead Code
- `HEAT_TONES` constant — marked "legacy", never referenced. REMOVED.
- `PEAK_WEIGHTS` constant — unused after `computeBoroughAvgTiers` rewrite. REMOVED.
- `REAL3D_ALL_LAYER_IDS` included `real3d-hm-baseplate-*` and `real3d-hm-buildings-*` IDs that were never created. REMOVED.
- `buildTierGeoCollections()` — defined but never called (intended for `['within']` per-tier approach).
- `buildNYCStencilGeoJSON()` — REMOVED (stencil eliminated).
- `satelliteMapStyle()` — REMOVED (satellite is now a raster layer, no separate map instance).

### MapView — Post-Mortem: Failed Approaches (DO NOT REPEAT)
- **Failure 1 — queryRenderedFeatures + setFeatureState for Real3D**: Caused "square bleeding" artifacts because it only styles tiles currently rendered on-screen. Panning reveals unqueried buildings flashing the default color. Must use GPU-side data-driven paint expressions instead. SOLVED by baking `_tier_0.._tier_4` into properties.
- **Failure 2 — Borough outline as simple 2D line in 3D mode**: 2D lines render BELOW fill-extrusions in MapLibre regardless of layer order. Solved by using fill-extrusion annular quads for borough outlines.
- **Failure 3 — Fixed integer values for 3D outline widths**: Browser MSAA handles thin 3D geometries poorly at low zooms. Must use zoom-interpolated expressions. Current solution: `getZoomAwareOutlineWidth` computes meter-based widths with pitch and zoom ramps.
- **Failure 4 — Zip polygon glitching (e.g., 11422)**: Confirmed as GeoJSON triangulation issue. Solved by `enforceGeoJSONWinding` on all features at load time.
- **Failure 5 — Baseplate tier clustering via feature-state (commit 1c3c045)**: Making `baseplateColorExpr(true)` use `buildingColorExprByState(true)` caused tile-seam artifacts because queryRenderedFeatures only assigns tiers to on-screen tiles. Baseplates should use simple uniform dark colors, NOT feature-state dependent clustering.
- **Failure 6 — Stencil masking fill-extrusions**: A 2D `fill` layer CANNOT mask `fill-extrusion` layers in MapLibre — they render in separate GPU passes. Stencil only works for 2D layers (parks, roads, landuse fills). Building layers need `['within']` GPU-side filter for true NYC restriction.
- **Failure 7 — Separate canvases for satellite/topo in Real3D**: Created 2-3 MapLibre canvas instances (sat z=1, topo z=2, main z=3) with camera sync. Massive overhead: double/triple GPU draw calls, constant `map.on('move', syncCamera)` events. Eliminated entirely by using `['within']` for NYC restriction (no stencil needed → no visual occlusion → no need for layers below the stencil). All modes now use a single canvas with satellite/topo as normal layers.
- **Failure 10 — Sorting borough features by tier**: `buildColoredBoroughFeatures` sorted features ascending by tier for height stagger, but skeleton cache kept original GeoJSON order. Zoom handler indexed `overrides[si]` against skeleton — skeleton[0] (Manhattan) got sorted[0]'s color (lowest-tier = blue). SOLVED by keeping features in original order, assigning `_boroughIdx` via rank map.

### MapView — UI Micro-Fixes
- **Zoom controls overlap**: The native MapLibre zoom-out (minus) button overlaps the custom Recentering button. Fix: add `marginBottom: '80px'` to the MapLibre NavigationControl container on load, or reposition the custom recentering button so the native minus button is always clickable.

### MapView — Caching & Reliability
- **Cacheable (compute once)**: ZCTA GeoJSON, borough GeoJSON, ZCTA skeleton, borough skeleton, zip→borough mapping, adjacency matrix. All already cached in state or refs.
- **Pre-computed per session**: All 5 timespan tiers stored in `precomputedTiersRef`. Baked into building properties as `_tier_0.._tier_4` via `bakeAllTiersIntoBuildings()`.
- **Must recompute on timespan/event change**: Only `withHeat` features (for ZCTA fill colors) and borough avg tiers. Building tiers read from baked properties (GPU-side).
- **Must recompute on mode toggle only**: Paint properties, layer visibility, camera pitch/bearing. These do NOT need data recomputation.
- **Building tier updates**: Paint expression swap only. `setPaintProperty` switches `['get', '_tier_X']` column — GPU recompiles shader, no per-building CPU work.
- **Layer lifecycle**: Real3D layers created once (`initReal3DLayers`), toggled via `setLayoutProperty('visibility')`. No destroy/recreate.
- **Optimization path**: `cachedTierDataRef` caches per-effect run. `precomputedTiersRef` caches all timespans. Paint-only toggles skip expensive recomputation. `removeSafezoneOverlapQuads` pre-computed once per heatmap effect.
- The map occasionally fails to load on first click but works on refresh — likely a race condition between GeoJSON fetch and `addLayers`.

### MapView — General Principles
- When fixing map issues, be strictly additive and corrective. Do not remove existing features (leaderboard, holograms, side panel, etc.).
- Always consult MapLibre GL JS and MapTiler API documentation for the correct approach before implementing map changes.
- All heatmap-dependent visuals (fill colors, extrusion heights, building colors) MUST respond to the timespan slider — they are bound to event density which changes with the selected time window.
- 2D fill layers and fill-extrusion layers render in SEPARATE GPU passes. Fill-extrusions ALWAYS render above 2D fills regardless of layer order. Only `moveLayer` ordering within the same layer type matters.
- Fill-extrusion opacity < 1.0 (e.g., 0.92) forces MapLibre to use framebuffer compositing, which hides tile-seam Z-fighting artifacts. Use this trick for any fill-extrusion that shows tile seams.

### MapView — Changelog (current session, base commit 1c3c045)

**Round 4 — Group A (safe fixes, 2026-04-16):**
- **A1 — ZCTA outline width lock (3D/Real3D):** Changed `getZoomAwareOutlineWidth` ZCTA path from `Math.max(0, 10.5 - zoom)` to `Math.max(0, 10.5 - Math.min(zoom, 10))`. Outline width at zoom 10 is now the constant for all zooms ≥ 10. Affects 3D and Real3D only (non-3D path unchanged).
- **A2 — Revert baseplate clustering:** `baseplateColorExpr(true)` no longer delegates to `buildingColorExprByState(true)`. Heatmap ON baseplates now use uniform dark tier colors via `feature-state` tier (no ID%5 clustering). Eliminates tile-seam artifacts caused by per-feature clustering on baseplates. Affects Real3D + Heatmap combo only.
- **A3 — NYC building filter:** Added `filter: ['within', NYC_BBOX_GEOM]` to `real3d-buildings-baseplate` and `real3d-buildings` layers. GPU-side restriction prevents NJ/CT building rendering in all Real3D combos.
- **A4 — Dead code removal:** Removed `HEAT_TONES`, `PEAK_WEIGHTS`, unused `REAL3D_ALL_LAYER_IDS` entries.
- **Zoom thresholds applied:** Baseplates `minzoom: 10, maxzoom: 11` (was 13–14.5). Buildings `minzoom: 11` (was 14). Landuse proxy opacity ramp adjusted. Baseplate opacity fade-in at zoom 10–10.5.

**Round 4 — Performance fixes:**
- **B1 — Deduplicate `buildZipEventMap`:** Reuse result from line 1706 at line 1956 (was calling function twice with identical params).
- **B2 — Pre-compute `fixSharedBoundaryQuads`:** Removed PiP from zoom/pitch listener. Now pre-computed once in heatmap effect, stored in `boroughQuadFilterRef` (Set of removed quad indices). Zoom listener uses O(n) index filtering instead of O(n×boroughs×vertices) PiP.
- **Road tier elimination:** Removed `assignRoadTiersToMap`, `roadMotorwayColorExpr`, `roadPrimaryColorExpr` (all dead code). Roads now use static colors (`#884400`/`#ff2200` for heatmap on/off).
- **Building tier simplification:** `assignBuildingTiersToMap` only queries `real3d-buildings` layer (not baseplates), removed per-building NYC PiP check (redundant with `['within']` filter).

**Round 4 — Safezone fixes:**
- Safezone extrusion height: 10→1m (features like buildings/parks render above it).
- Building baseplate base: 0→2m. Building extrusion base: `['max', 2, ...]`.
- `fixSharedBoundaryQuads` now removes ALL internal borough boundary edges. Only outer NYC perimeter outline survives — eliminates safezone wall artifacts from interior edges.

**Round 4 — Architecture overhaul (stencil + canvas removal):**
- **Stencil removed:** `real3d-nyc-stencil` layer and `real3d-stencil-source` completely removed. NYC restriction handled entirely by `['within', NYC_BBOX_GEOM]` filters on individual layers.
- **Separate canvases removed:** Eliminated `satContainerRef`, `satMapRef`, `topoContainerRef`, `topoMapRef`. No more second/third MapLibre instances. No camera sync code.
- **Satellite unified:** Satellite is now a raster source+layer on the main map in ALL modes (2D, 3D, Real3D). No separate canvas needed since no stencil blocks it.
- **Topo unified:** Heat-underlay (topo glow) renders on main map in ALL modes. Guard changed from `!real3D` to just `heatmap && topoOn`.
- **Single canvas:** All modes use one MapLibre canvas. CSS background `#0d0000` provides dark fill outside NYC. z-index stack simplified.
- **~200 lines removed.** File reduced from ~2966 to ~2773 lines.

**Round 4 — 5-issue fix batch (post-overhaul):**
- **Water layer ordering:** Water now inserted BELOW heat-underlay via `addLayer(spec, 'heat-underlay')`. Removed `moveLayer('real3d-water')` to top. Stack: satellite → water → heat-underlay → parks/roads/buildings.
- **Borough outlines — safezone filter:** Replaced `fixSharedBoundaryQuads` (removed ALL internal edges) with `removeSafezoneOverlapQuads` (only removes quads overlapping safezone ZCTA features). Interior borough lines now visible for clarity.
- **Borough outlines — height stagger:** Base/height offset by `_boroughIdx * 0.1m`. Features sorted by `avgTier` ascending before assigning `_boroughIdx`, so higher-tier (red) boroughs get higher `_boroughIdx` and render on top. Subpixel 0.1m gap is invisible but prevents Z-fighting.
- **Borough pixelation:** Width ramp increased from 2x→4x to 2.5x→7x (zoom 11→9) for thicker outlines at low zoom.
- **Borough opacity:** Zoom-interpolated opacity `['interpolate', ['linear'], ['zoom'], 9, 0.4, 11, 1.0]` softens thin extrusions at distance.
- **Toggle lag:** `cachedTierDataRef` caches `buildZipEventMap` + `computeTiers`. Paint-only toggles (satellite, topoOn, threeD) skip expensive recomputation.
- **Heat-underlay opacity:** Removed `!real3D` restriction from initial layer creation so topo glow works in Real3D immediately.
- **Zoom handler:** Removed RAF debounce — fires synchronously on zoom/pitch for instant outline response.

**Round 4 — FGB Building Migration (commit 9dd1a94 → 910502b → 25b9e99 → 5b9ef99):**
- **BUILDING.fgb source:** Replaced MapTiler `openmaptiles` building source with local FlatGeobuf file (381K NYC-only polygons). Eliminates: tile-seam artifacts, `['within']` incompatibility, NJ/CT building rendering, external tile dependency for buildings.
- **ZCTA index map:** `buildingZctaMapRef` = `Int16Array(n)` built once at FGB load time via centroid PiP. Maps each building feature index → ZCTA feature index (-1 = not found). Built with yielding (5K chunks) to avoid blocking.
- **Baked tier properties (5b9ef99):** All 5 timespan tiers baked into building properties as `_tier_0.._tier_4` via `bakeAllTiersIntoBuildings()`. Paint expressions read `['get', '_tier_X']` — GPU evaluates directly. On timespan change, `setPaintProperty` switches column (instant). Zero per-building CPU work on timespan change.
- **Layer visibility toggle (5b9ef99):** Real3D layers created once via `initReal3DLayers()`, never destroyed. Toggle uses `setReal3DLayersVisible(map, true/false)` — zero WebGL rebuild. `real3dLayersCreatedRef` tracks init state.
- **Pre-computed tiers (25b9e99):** All 5 timespan tiers computed in background on map init. Time slider reads from `precomputedTiersRef` — no recomputation.
- **Deferred load (25b9e99):** `addBuildingLayers` creates empty source (instant toggle), then `setTimeout(0)` pushes data from cache or viewport fetch.
- **Heatmap toggle = paint-only:** `[heatmap, real3D, mapReady]` effect runs `setPaintProperty` only (no setData, no feature-state loop).
- **Timespan toggle = paint-only:** `[timespanIdx, real3D, mapReady]` effect runs `setPaintProperty` to switch `_tier_X` column.
- **Raytracer eliminated:** Removed `assignBuildingTiersToMap`, `bakeBuildingTiers`, and all `moveend`/`zoomend` building tier listeners.
- **Building cache persistence:** `buildingFGBRef.current` NEVER cleared on Real3D toggle-off. Layers hidden via visibility, source persists. On re-activation, layers shown instantly.
- **FGB spatial index:** `building_indexed.fgb` has Hilbert R-tree spatial index. Bbox range queries work for viewport fetch.

### MapView — Post-Mortem: Failed Approaches (DO NOT REPEAT)
- **Failure 8 — `['within']` on MapTiler vector tile fill-extrusions**: `['within', NYC_BBOX_GEOM]` filter on building/baseplate fill-extrusion layers from MapTiler's `openmaptiles` source caused ALL buildings to disappear. Works fine on fill/line layers (parks, roads, landuse) but NOT on fill-extrusion layers from external vector tile sources. SOLVED by migrating to local FGB data (no filter needed).
- **Failure 9 — queryRenderedFeatures + setFeatureState for building tier coloring**: Caused tile-seam artifacts (only styles on-screen tiles), square bleeding, purple fallback on pan, main thread blocking from millions of PiP ops. SOLVED by baking `_tier_0.._tier_4` into GeoJSON properties — GPU reads directly, zero CPU work.

### MapView — Baked Tier Architecture (commit 690b888+, replaces feature-state approach)
- **Building tier colors via baked properties**: Each building has `_tier_0.._tier_4` in its GeoJSON properties. Paint expressions use `['get', '_tier_X']` where X = active timespan index. GPU evaluates directly from properties — no feature-state, no CPU loop.
- **`bakeAllTiersIntoBuildings()`**: Iterates all 381K buildings once, writing all 5 tier values from `precomputedTiersRef` using `buildingZctaMapRef`. Called when both pre-computed tiers AND ZCTA index are ready. After baking: clears `memoizedExprs.current`, calls `setData`, then calls `refreshBuildingColors()`.
- **`refreshBuildingColors()`**: Central helper — clears `memoizedExprs.current = {}` and calls `setPaintProperty` for `real3d-buildings`, `real3d-buildings-baseplate`, and `real3d-landuse-baseplate` using current `heatmapRef.current + timespanIdxRef.current`. Called from: bake completion, heatmap effect, timespan effect, Real3D toggle (subsequent activation), addBuildingLayers setTimeout, fetchViewportBuildings (after setData), zoom listener (z13/z14 boundary crossing).
- **`buildFGBCache` setData logic**: If `bakeAllTiersIntoBuildings()` ran (returns true), skip the second `setData` call — bake already called it + refreshed paint. Only call `setData` directly when baking is skipped (precomputed tiers not yet ready).
- **`fetchViewportBuildings`**: Now bakes all 5 `_tier_X` columns from `precomputedTiersRef` for each viewport feature (not just `_tier` for current timespan). Calls `refreshBuildingColors()` after setData if Real3D is active. Guard: `if (buildingFGBRef.current) return` prevents overwriting baked full-cache data.
- **Timespan change = `refreshBuildingColors()` only**: Switches `['get', '_tier_X']` column. GPU recompiles shader — near-instant.
- **Heatmap toggle = `refreshBuildingColors()` only**: Switches between red palette (reads `_s7`) and tier palette (reads `_tier_X`).
- **Pre-computed tiers**: `precomputedTiersRef.current[timespanIdx]` = `{ tiers, zipMap, maxCount }` for all 5 timespans. Computed in background on `[events, geoData, adjacency]` change. Time slider reads pre-computed (near-instant).
- **Deferred building load**: `addBuildingLayers` adds empty source + layers (instant), then `setTimeout(0)` pushes data from cache or viewport fetch + calls `refreshBuildingColors()`. Real3D toggle never freezes.
- **Zoom thresholds**: Baseplates z13-14 (opacity fade z13-13.5), buildings z14+. Building base 2m above ground.
- **Layer visibility toggle**: `initReal3DLayers()` creates all 9 Real3D layers + sources once. `setReal3DLayersVisible()` toggles visibility. No layer/source destroy/recreate on toggle.
- **`fetchViewportBuildings` zoom guard**: `< 13` — no viewport fetch needed below z13 since baseplates don't appear until z13. Full cache guard prevents viewport data from ever overwriting baked data.
- **Zoom boundary color refresh**: `onZoom` listener detects crossing z13 (baseplates appear) or z14 (buildings appear) thresholds in Real3D+heatmap mode and calls `refreshBuildingColors()` — guards against stale expressions after zoom-driven layer transitions.

### MapView — Safezone Hover (commit 25b9e99)
- **`zcta-safezone-hover`** fill layer: transparent, captures mouse events for safezone features.
- **Hover/click handlers** registered on both `zcta-fill` and `zcta-safezone-hover`.
- **HoveredZip encoding**: safezone hover sets `hoveredZip` to `SAFE:{zip}` prefix. `isSafezoneHover` boolean derived from prefix.
- **Side panel**: `openSidePanel('SAFE:{zip}')` → sets `sideZip='SAFEZONE'`, shows events for that zip, colonists section replaced with "🛡️ There are no colonists in safezones".
- **Upper 3D outline**: `createZctaOutlineGeoJSON` now skips `_special` features — safezones don't get 3D border quads.

### MapView — Borough Outline Improvements (commit 25b9e99)
- **computeBoroughAvgTiers**: Weighted average of zip tiers (sum/count), ranked 0-4. Replaced peak-count ranking that produced visually incorrect results.
- **Width at z12+**: 1.5x constant (was 2.5x), smooth ramp 1.5x→2.5x at z11-12, then 2.5x→7x at z9-11.

### Favorites System
- Storage keys: `lapuff_favorites` (IDs), `lapuff_fav_counts` (counts), `lapuff_fav_history` (activity), `lapuff_favorite_event_cache` (snapshots, max 240), `lapuff_sb_favs` (synced set).
- **Anonymous**: localStorage only + one-time `update_event_fav_count` RPC (delta +1). No points.
- **Authenticated (Orbiter)**: upsert to `event_favorites` table, triggers `fav_count` increment. No points yet.
- **Authenticated + Participant**: `markFavoriteContributions(session)` → RPC awards 5 points per favorited event.
- **Auto-event guard**: `isAutoEvent(id, snapshot)` checks `_auto` flag → skips DB sync entirely. Local star/count still works. Auto events in `auto_events` table have no FK to `events`.
- Trend calculation: `resolveTrendFromThreshold(count, threshold)` — up if `count >= threshold`, neutral if within 4, down otherwise. Threshold = 12h peak.
- Real-time subscription: `subscribeToFavoriteCount(eventId, callback)` via Postgres changes channel. Multiple listeners reuse single channel.
- `window.dispatchEvent(new Event('favoritesChanged'))` broadcasts all favorite state changes.

### Points / Clout System
- Values: SELF_CHECKIN=150, ATTENDEE_TO_ORGANIZER=80, REFERRAL_SUCCESS=50, SUBMIT_EVENT=20, EVENT_FAVORITED=5, HOT_ZONE_BASE=3, HOT_ZONE_MULTIPLIER_MAX=8.
- Roaming: 15-minute throttle, multiplier `1 + heatValue * 7` → 3 to 24 points per roam.
- RPC: `award_clout(points_to_add, audit_reason)` — server enforces `auth.uid()`.
- Eligibility: `email_confirmed_at` must be set.
- Referral: localStorage `lapuff_pending_referral` from `?ref=CODE` URL param. Auto-opens auth after 1s.

### Location & Participant Status
- NYC bounding box: lat 40.47–40.93, lng -74.27 to -73.68.
- Spoofing detection: impossible speed > 55 m/s between pings.
- High accuracy GPS only, 12s timeout, no continuous tracking.
- 24h participant window: `localStorage['lapuff_nyc_24h']`.
- Status: 'participant' (< 24h since NYC ping), 'orbiter' (else).
- Dot colors: green (participant), red (orbiter), yellow (loading).
- Check-in radius: 200m (Haversine). Active window: `[eventTime, eventTime + 6h]`.

### Authentication
- Custom auth via `supabaseAuth.js` — NOT using `@supabase/supabase-js` auth client directly.
- Session key: `localStorage['lapuff_session']`.
- Refresh: auto-refresh if < 5min (300s) to expiry.
- Signup: email, password (min 8), username (required, profanity-checked), bio (optional), home_zip (5-digit or empty, default '10001').
- Profanity filter: leet-speak normalization (`0→o, 1→i, 3→e, 4→a, 5→s`), spacer stripping, repeated-char collapse.
- Username displayed: `username` → `user_metadata.username` → `email prefix` → "Account".

### Event Submission
- Location types: `'address'` (full address + city + zip) or `'rsvp'` (link only, city = 'Private/Online').
- Photo upload: max 5, max 1MB each, stored in Supabase `event-images` bucket. Filename: `Date.now()-random.ext`.
- Timezone: auto-detected from browser, converted via `localToUTC(date, time, offset)`.
- Submitted events await approval (`is_approved = false`).
- Links: flexible array, trimmed on submit.

### Auto-Tags System
- `generateAutoTags(event)` → max 7 tags.
- 32 rules covering: music, jazz, art, food, brunch, market, sports, workshop, lecture, family, kids, outdoor, free, nightlife, culture, fashion, film, dance, books, reading, poetry, comedy, nature, party, charity, tech, wellness, theater, social, activism, + borough tags.
- If 'books' OR 'poetry' → auto-add macro tag 'reading'.
- If `price_category === 'free'` → auto-add 'free' tag.
- Borough name → lowercase tag (e.g., 'Manhattan' → 'manhattan').
- Tag colors in `tagColors.js`: music=purple, food=orange, sports=blue, family=green, boroughs=gray.

### Date/Time Handling
- DB format: `event_date` = 'YYYY-MM-DD' string, `event_time_utc` = UTC ISO string.
- Local display: `new Date(event.event_date + 'T00:00:00')` for safe parsing (no timezone drift).
- Scraper dates normalized to `America/New_York` timezone for correct day boundary.
- TZ conversion: `utcToLocal(utcStr, tzOffset)` → "H:MM AM/PM".
- 12 supported timezones in `timezones.js` (ET default).

### Auto Event Scraper System
- GitHub Actions CRON: `0 10 * * *` (10:00 UTC = 6:00 AM ET daily) + manual workflow_dispatch.
- 4 working scrapers: Allevents.in (130+), Songkick (50), Eventbrite (39), Luma (25). Total ~234 events/run.
- Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Runtime: Node 20 on Ubuntu, 20-minute timeout. Dependencies: `cheerio`, `node-fetch`, `rss-parser`.
- Scraper infrastructure lives in `scripts/` with its own `package.json` (ESM modules).

### Scraper Extraction Strategies
- **Allevents.in**: JSON-LD arrays in `<script type="application/ld+json">` from 7 NYC category pages. Fallback to `__NEXT_DATA__` and `window.__INITIAL_STATE__`. DO NOT BREAK — this is the most reliable source.
- **Eventbrite**: `window.__SERVER_DATA__` JSON from `/d/ny--new-york/events/` (3 pages). Items stored as Python repr strings — parsed via `parsePythonRepr()` (single→double quotes, True/False/None conversion). 36 events per page.
- **Luma**: `__NEXT_DATA__` from `lu.ma/nyc` (NOT `lu.ma/new-york` which redirects to a single event). `data.events[]` + `data.featured_events[]`.
- **Songkick**: `SK.page_data` JSON from metro area 7644 calendar. Only page 1 accessible (pages 2+ return 406).
- All scrapers use `httpGet()` with full Chrome 120 browser fingerprint (User-Agent, Sec-Ch-Ua, etc.).
- Delay: 2000ms between requests per scraper.

### Scraper Data Pipeline
- Dedup: 3 dimensions — `external_id` (unique per source), `source_url`, `event_name|event_date` (case-insensitive).
- External ID format: `"site:siteEventId"` (e.g., `"allevents:abc123"`). Fallback: SHA-256 hash of `name|date|address` (first 16 hex chars).
- Date window: 30 days past → 6 months ahead. Events outside are dropped.
- Upsert: PostgREST `POST` with `Prefer: resolution=merge-duplicates,return=minimal`, chunks of 50.
- Prune: DELETE events with `event_date < (now - 60 days)`.
- NYC validation: ZIP in range → accept. Address contains NYC keywords → accept. Coords in bounding box (40.4–41.0 lat, -74.3 to -73.6 lng) → accept.
- Borough assignment: ZIP ranges first, then address keywords, then coord bounding boxes, fallback 'Manhattan'.

### Scraper Enrichment (No LLM)
- Emoji: 107 keyword→emoji rules in `emoji-color.js`, first match wins. Default: 🎉.
- Color: 44-entry emoji→hex map. Default: `#7C3AED`.
- Price: explicit $0/free keywords → 'free', numeric < $20 → '$', < $60 → '$$', ≥ $60 → '$$$'. Default: '$'.
- Description: HTML stripped, entities decoded, whitespace collapsed, truncated at 800 chars.

### Supabase Schema
- `events` table: user-submitted events with `is_approved`, `fav_count`, `trend_threshold_count`.
- `auto_events` table: scraped events with `external_id` UNIQUE, `source_site`, `source_url`. No FK to `events`.
- `profiles` table: `username`, `clout_points`, `home_zip`, `bio`.
- `event_favorites` table: `user_id`, `event_id` — authenticated favorites.
- `favorite_point_contributions` table: one-time point tracking per user per event.
- RPCs: `update_event_fav_count(p_event_id, p_delta)`, `award_clout(points_to_add, audit_reason)`, `award_points_for_active_favorites(p_user_id)`.
- Supabase URL: `https://gazuabyyugbbthonqnsp.supabase.co`.
- Publishable key in `supabase.js`, service role key in GitHub Secrets only.

### CRT Effect
- Overlay layers: noise grain (0.07 opacity), lattice mesh (0.18), scanlines (0.1), chroma fringe (0.06), animated data wash line (y += 0.11 per frame), tube vignette.
- z-index 1 (behind map canvas at z-index 2). Pointer-events: none.
- Mobile: vignette reduced to 0.45 opacity with `limitMobile` prop.

### Home Page
- Dual views: 'tiles' (TileView) and 'map' (MapView) toggle.
- Mobile header auto-hide: hysteresis scroll detection, `MIN_DELTA=4px`, `HIDE_AFTER_Y=96px`, `HIDE_SCROLL_DISTANCE=18px`.
- Referral: captures `?ref=CODE` param, persists to `lapuff_pending_referral`, auto-opens auth after 1s.
- Logo hover: swaps background/shadow colors dynamically from theme.
- Desktop: Submit Event button + user dropdown. Mobile: HamburgerMenu.

### FavoritesPage
- Merges live + cached favorites via `mergeFavoriteEventsWithCache(events)`.
- Grouped by `event_date`, sorted by date then name.
- FavoriteCard: `getTileAccentColor(hex_color, theme)` for border-top color.
- Real-time fav count + trend subscription per card.
- Empty state: emoji + "No favorites yet!" + browse link.

### CalendarPage
- Views: monthly (7-col grid, max 3 events/cell), weekly (7-day vertical list, 2–3 events/day), daily (full list with expand/collapse).
- Navigation preserves `location.state.initialDate` and `initialView` from EventDetailPopup.
- MiniMap in day view: OpenStreetMap embed (if lat/lng) or Google Maps fallback.
- Theme-aware: calendar bg from `resolvedTheme.calendarBackgroundColor`.

### Leaderboard
- Top 50 users by `clout_points` from `profiles`.
- Tier badges: ranks 1-3 gold (🥇), 4-7 silver (🥈), 8-10 bronze (🥉), 11+ RGB/cyberpunk (⚡).
- Each tier has unique glow shadows and row colors.
- `USERS_PER_PAGE = 10`. Trophy overlay with rank number for top 10.
- SAMPLE_MODE generates 50 mock users for dev.

### HamburgerMenu
- Items: ⭐ My Favorites (with count), 📅 Favorites Calendar, 🎨 Theme Customizer, 👥 Refer A User, ⚡ Clout Points.
- Favorites count: only counts IDs that exist in loaded events list.
- Shadow: `8px 8px 0px {tileShadowColor}`.
- Animation: `fade-in slide-in-from-top-2 duration-200`.
- Nav item text: `buttonTextColor → bodyTextColor → microIconColor` priority.
- Nav item bg: always-on `hexToRgba(buttonFillColor, 0.22)` shading so items stay defined in all themes.

### React Query
- `refetchOnWindowFocus: false`, `retry: 1`.

### Removed / Dead Scrapers (for reference)
- NYC Open Data (`nycdata.js`): removed — returned permit events, not real public events.
- NYC Parks, RA, Meetup, Dice, TimeOut: all removed — blocked by Cloudflare, auth requirements, or returned 0 events.
- If re-adding sources, use JSON extraction (`__SERVER_DATA__`, `__NEXT_DATA__`, JSON-LD) not HTML scraping.
