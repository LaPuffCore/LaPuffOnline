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

## Everything below this is context specific and is not deterministic, it represents past history and may not be accurate, do not rely on it full or exclude options because of what is said but do note that it may contain useful insights and information about the codebase and conventions that have been established so far, but always verify against the actual code and user instructions for the current task at hand.

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
- **Mobile title truncation**: On screens < 640px (`isMobile` state, resize listener), title is hard-capped at 35 chars: `title.slice(0, 32) + '...'`. `EventDetailPopup` always receives full `event.event_name` untouched.
- Favorite badge: count + trend icon (green up, red down, blue dash).
- Expiry: events older than 7 days (`7 * 86400000` ms) are marked expired; images hidden.
- `getTileAccentColor(event.hex_color, theme)` determines accent: tileAccentOverride > event hex > default.
- Real-time fav count via `subscribeToFavoriteCount(event.id, callback)`.
- Date, time, location text → `bodyTextColor` via inline style (not hardcoded Tailwind text-gray-*); opacity dimming 0.75/0.7 for secondary text.
- **LIVE badge**: Pulsing green pill when `isEventLive(event)` (start−30min → end). Bottom-left of image.
- **AFTERS badge**: Purple pill when `isAftersWindow(event)` (end → end+1hr). Bottom-left of image.
- **Attendance count overlay**: Bottom-right of image, people icon + count, visible when event is live. Fetched from `attendance_count` on event object (from `events_with_counts` view).
- **TileView keeps live events visible**: Events happening now are retained in the present filter even if they would otherwise be excluded by date range.

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
- **LIVE/AFTERS image overlay**: Green LIVE or purple AFTERS badge shown on popup image when `isEventLive` or `isAftersWindow`.
- **Attendance count**: Bottom-right of image (people icon + count) when event is live. From `event.attendance_count`.
- **Check-in dropdown**: When `isEventHappeningNow(event)` (or afters window) is active, a check-in button appears. `handleManualCheckIn(type)` accepts `'main'` or `'afters'`. Afters check-in button only shows when `event.afters_lat && isAftersWindow(event)`.
- **Always shows full title** — `event.event_name` raw, never truncated (contrast to EventTile mobile truncation).

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
- File: `src/components/MapView.jsx` (~4736 lines as of 2026-05-04).
- Pipeline files: `src/lib/mapDataPipeline.js` (Phase 2A), `public/sw.js` (Service Worker v11).
- Center: `[-73.94, 40.71]`, zoom 10.5, bounds `[[-75.5, 40.0], [-72.5, 41.5]]`.
- GeoJSON: `./data/MODZCTA_2010_WGS1984.geo.json` (cleaned) for NYC zip boundaries.
- Borough GeoJSON: `./data/borough.geo.json` for 5 NYC borough MultiPolygons.
- Water GeoJSON: `./data/water_static.geojson` (2304 features, z10+z11 composite, dissolved tile-seams).
- Buildings PMTiles: `public/data/nyc_buildings.pmtiles` (~73MB, z13–16, source-layer `building`).
- Roads PMTiles: OCI-hosted `realfinaldeciroads.pmtiles` (Oracle Cloud, `us-ashburn-1`).
- NYC bbox: `[-74.27, 40.47, -73.68, 40.93]` used for all viewport guards and Phase 2B sweep.
- Heat tiers: cold (< 0.30), cool (0.30–0.55), warm (0.55–0.80), orange (0.80–1.0), hot (≥ 1.0). 4-pass adjacency blur.
- Heat colors: `#00ccdd` (cold), `#00dd66` (cool), `#f5c800` (warm/golden-yellow), `#dd6600` (orange), `#cc0d00` (hot).
- Heat mid colors (borough outlines): `#339eb3` (cold), `#33b366` (cool), `#b39900` (warm), `#cc6622` (orange), `#cc3333` (hot).
- Heat dark colors (upper border): `#001f29` (cold), `#002910` (cool), `#5c4a00` (warm), `#3d1500` (orange), `#2e0000` (hot).
- Normalization: logarithmic `Math.log(count+1) / Math.log(max+1)`.
- Pitch/bearing: 3D on → `{ pitch: 48, bearing: -17 }`, Real3D → `{ pitch: 55, bearing: -17 }`, off → `{ pitch: 0, bearing: 0 }`.
- ZipHologram: Canvas 460x340 (desktop) or 400x260 (mobile) with sine wave rotation, scanlines, glitch. Desktop and mobile versions are separate components (~95% identical code — candidate for merging).
- Special zips: `99999` or `>11697` → SAFEZONE (white fill, locked).
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
  - **2D**: ZCTA fill, ZCTA outline, borough outline (flat), heat-underlay. No extrusions, no Real3D layers.
  - **3D**: Everything in 2D + ZCTA fill-extrusions, upper 3D border extrusions, borough outline extrusions. Pitch/bearing: `{48, -17}`.
  - **Real3D**: Replaces all 3D layers with own stack: water, park, roads, landuse-baseplate, buildings-baseplate, buildings. Borough outline shared. Pitch/bearing: `{55, -17}`.
  - **Satellite**: 3-tier raster sources on the main map in ALL modes (bottom of stack). Single canvas — NO separate MapLibre instance. See Satellite section below.
  - **Heatmap**: Recolors ZCTA fills/extrusions by tier. Enables heat-underlay (gaussian kernel). In Real3D: `refreshBuildingColors()` rebuilds `[match, ['get', 'z'], ...]` paint expression with tier colors.
  - **Topo**: When `heatmap && topoOn`: sets heat-underlay opacity to 0.50 (otherwise 0). Works in all modes.

- **Conditionals must cleanly separate** 2D from 3D from Real3D logic. Each overlay combo may need its own paint property values.

### MapView — 2D Mode Rules
- **2D is DONE and correct. DO NOT TOUCH 2D logic.** All 2D modes (standard, heatmap, satellite, and their combos) work perfectly and must remain exactly as-is unless map theme color customization is explicitly requested.

### MapView — 3D Mode Rules (Extruded ZIP Codes)
- 3D mode extrudes the ZCTA zip polygons as colored blocks.
- The **"Upper 3D Border"** is the top-edge ring of each extrusion, rendered as a separate red-tinted extrusion layer at the top of the zip block. In heatmap combos, upper border height follows the heatmap extrusion height.
- 3D extrusion heights per tier: 30, 200, 700, 1600, 2800.
- Outline: neon red `#ff2200`, glow layers at varying widths.
- Zip polygon glitching (e.g., zip 11422) was solved by `enforceGeoJSONWinding` on all features at GeoJSON load time.

### MapView — Real3D Mode Rules (Individual Buildings — PMTiles)
- Real3D renders NYC building footprints from PMTiles (`public/data/nyc_buildings.pmtiles`, ~73MB, z13–16).
- **Data source**: `nyc-buildings` MapLibre vector source (`pmtiles://` protocol). Source-layer `building`. Per-feature props: `{ z=zip, b=bid, h=height_m, m=min_height, c=colour }`.
- **No FGB, no flatgeobuf, no client-side baking.** Buildings were previously loaded as FlatGeobuf files and had tier values baked into GeoJSON properties — this caused 196MB OOM on mobile and was replaced entirely by PMTiles.
- **Tier coloring via `[match]` expression**: `refreshBuildingColors()` builds `['match', ['get', 'z'], zip1, tierColor1, zip2, tierColor2, ..., defaultColor]` from `precomputedTiersRef` and `geoData` zip lookup. `setPaintProperty` GPU-side swap is near-instant on timespan or heatmap change.
- **3 zoom bands**:
  - z < 13: Roads and landuse visible. No baseplates or buildings.
  - z 13–14: Baseplates (flat footprints, `real3d-buildings-baseplate`, fade-in z13–13.5).
  - z ≥ 14: Full building extrusions at actual `h` heights (`real3d-buildings`).
- **Road feature zoom schema** (roads fade out as buildings appear):
  - Motorway: z9–13.
  - Primary/secondary: z10–13.
  - Tertiary/residential: z11–13.
  - Landuse proxy: maxzoom 13, fades out z12–13.
- **Two color palettes**:
  - **Standard palette (heatmap OFF)**: 7 dark-red shades, `b % 7` (bid mod 7) for GPU-side clustering. Baseplates use 3 uniform dark reds.
  - **Heatmap palette (heatmap ON)**: Buildings use `[match, ['get', 'z'], ...]` tier colors + `b % 5` shade variation. Baseplates use uniform dark tier colors.
- **Layer lifecycle**: Real3D layers created once (`addBuildingLayers` + `initReal3DLayers`), toggled via `setLayoutProperty('visibility')`. No destroy/recreate.
- **No separate mobile loading gate** — PMTiles streams fast enough on mobile. The old FGB-era gating popup was removed when FGB was replaced.

### MapView — Real3D Architecture (Single Canvas, PMTiles)

#### Single-Canvas Architecture (ALL modes):
All modes (2D, 3D, Real3D) use a single MapLibre canvas. Satellite and topo heatmap are normal layers on the main map. No separate canvases, no camera sync.

#### NYC Restriction:
- Fill/line layers from MapTiler use `filter: ['within', NYC_BBOX_GEOM]` for GPU-side restriction.
- Building/baseplate layers use local PMTiles data (NYC-only) — no additional `['within']` filter needed.

**NYC-restricted layers** (only render inside NYC bounding box):
- `real3d-park` (fill)
- `real3d-roads-primary` (line)
- `real3d-roads-tertiary` (line)
- `real3d-landuse-baseplate` (fill)

**Unrestricted layers** (intentionally extend past borough edges):
- `real3d-water` (fill) — rivers/harbor flow past boroughs
- `real3d-roads-motorway` (line) — highways cross boundaries
- `real3d-buildings-baseplate` (fill-extrusion) — PMTiles source `nyc-buildings`, z13–14
- `real3d-buildings` (fill-extrusion) — PMTiles source `nyc-buildings`, z14+
- `borough-outline` (fill-extrusion) — outer NYC perimeter
- `sat-layer-arcgis` / `sat-layer-wayback` / `sat-layer` (raster) — satellite tiers everywhere
- `heat-underlay` (heatmap) — topo glow radiates past boroughs

#### Real3D Layer Stack (back to front):
```
sat-layer-arcgis (raster z9-11, when satellite ON)
sat-layer-wayback (raster z11-13, when satellite ON)
sat-layer (raster z13+, when satellite ON)
real3d-water (fill, unrestricted — BELOW heat-underlay)
heat-underlay (heatmap, when heatmap + topo ON)
real3d-park (fill, NYC-restricted)
real3d-roads-primary (line, NYC-restricted, z10-13)
real3d-roads-tertiary (line, NYC-restricted, z11-13)
real3d-landuse-baseplate (fill, NYC-restricted, maxzoom 13)
real3d-buildings-baseplate (fill-extrusion, PMTiles, z13-14)
real3d-buildings (fill-extrusion, PMTiles, z14+)
real3d-roads-motorway (line, unrestricted, z9-13)
borough-outline (fill-extrusion, unrestricted, topmost)
```

#### Tier Coloring — `refreshBuildingColors()`
- Central function. Rebuilds `[match, ['get', 'z'], ...zipTierColorPairs, defaultColor]` paint expression from `precomputedTiersRef` (all 5 timespan indices pre-computed on map init) + `geoData` zip lookup.
- Memoized per `(heatmap, timespanIdx)` key in `memoizedExprs.current`.
- Called on: heatmap toggle, timespan change, Real3D toggle (on), `zoomend`, `moveend` (z≥13 only).
- `setPaintProperty` swaps expression GPU-side — zero per-building CPU work after first expression build.

#### Borough Outline — Safezone Filtering + Height Stagger
- `removeSafezoneOverlapQuads` — interior borough edges KEPT for visual clarity; only quads overlapping safezone ZCTA features are removed.
- Height stagger: each borough's outline base/height offset by `_boroughIdx * 0.1m` to prevent Z-fighting.
- `_boroughIdx` assigned via rank map (not by sorting features) — features stay in original GeoJSON order to match skeleton cache index. Higher-tier boroughs get higher `_boroughIdx` and render on top.
- Width ramp: 1.5x at z12+, smooth 1.5x→2.5x at z11–12, then 2.5x→7x at z9–11.
- `computeBoroughAvgTiers` uses TOTAL tier points (tier 4=5pts, 3=4pts, 2=3pts, 1=2pts, 0=0pts). Boroughs with more hot zips rank higher regardless of cold zip count.

#### Per-Integer-Zoom Outline Cache
- ZCTA + borough quad geometry is identical at z14.3 vs z14.7 — only changes on integer zoom crossings.
- `lastIntZoomRef` tracks last integer floor; `outlineCacheRevRef` is a monotonic counter bumped on source data change (heatmap toggle, tier recompute).
- Zoom listener short-circuits if `floor(zoom) === lastIntZoomRef && rev === lastBuiltRev` — pan within an integer band is free (cache hit).
- `zoomend` safety net: full `doOutlineRebuild()` regardless of cache.
- `moveend` safety net: `refreshBuildingColors()` at z≥13 only for Real3D paint settle on pan.

### MapView — Satellite System (3-Tier Hybrid)
- **z9–10**: ArcGIS World Imagery — source `sat-source-arcgis`, layer `sat-layer-arcgis` (maxzoom 11).
- **z11–12**: USGS Wayback `2018-01-18` release `13045` — source `sat-source-wayback`, layer `sat-layer-wayback` (minzoom 11, maxzoom 13). Used because Clarity tiles at z11/z12 are blurry upscales from native z13.
- **z13+**: MapTiler Clarity (`satellite-v2`) — source `sat-source`, layer `sat-layer` (minzoom 13). Best resolution.
- All three are normal raster layers on the main map. No separate canvas, no camera sync. Satellite toggle adds/removes all three layers.
- **NO duplicate satellite `toggle` listeners** — satellite useEffect is the single source of truth for adding/removing sat layers.
- **Phase 2A precache**: `precacheSatelliteTiles` in `mapDataPipeline.js` warms all three tiers over NYC bbox (ArcGIS z9–10, Wayback z11–12, Clarity z13) at concurrency 6 via SW cache.

### MapView — Loading Pipeline (Phase 2A + Phase 2B)

#### Phase 2A (`src/lib/mapDataPipeline.js`)
Runs on loading screen start (before MapLibre mounts). Fire-and-forget:
- Prefetch ZCTA GeoJSON, borough GeoJSON, water_static.geojson into SW `STATIC_CACHE`.
- Prefetch PMTiles full files (nyc_buildings + roads) into SW `PMTILES_FULL_CACHE`.
- Precache satellite tiles (3-tier, NYC bbox, concurrency 6).
- Precompute ZCTA heatmap tiers for all 5 timespans → stored in `mapCacheStore.precomputedTiers`.

#### Phase 2B (inside MapView.jsx useEffect on `mapReady`)
Runs after MapLibre mounts, while still under loading screen:
- **Aggressive warm sweep** — grid-based `jumpTo` across full NYC bbox at z9–16:
  - z9–10: 1 point, z11–12: 2×2, z13: 3×3, z14–16: 4×4 = ~65 jumps RAF-paced (~1s desktop).
  - During sweep: adds sat layers at 0.01 opacity (invisible but forces tile fetch + shader compile), sets heat-underlay 0.5 then 0, briefly shows Real3D + 3D extrusions (all modes warmed).
  - Tear-down: removes sat layers only if user `satellite` state is false; returns to 2D default; fires `onLoadingDone`.
- **Mobile**: skips aggressive sweep (too slow), sets `mapCacheStore.warmupComplete = true` directly.
- **Warmup boolean guard**: `mapCacheStore.warmupComplete` prevents re-running on subsequent map mounts within the same session.
- **`buildFGBCache()`** (not an FGB load — name is legacy): hydrates `zipToZctaIdxMapRef` from geoData, loads `precomputedTiersRef` from cache, calls `refreshBuildingColors()`.

#### Service Worker (`public/sw.js` v11)
- `STATIC_CACHE` (v1): ZCTA GeoJSON + borough GeoJSON + water_static.geojson — pre-loaded on SW activate.
- `PMTILES_FULL_CACHE` (v6): nyc_buildings.pmtiles + roads.pmtiles — fetched once as full file, served as Range-extracted byte slices on subsequent requests.
- `TILES_CACHE`: satellite raster tiles. LRU cap: 100 (mobile) / 300 (desktop) via `MAX_TILE_CACHE_SIZE`.
- FGB cache path REMOVED. `handleFGB` is a pass-through stub.

### MapView — Caching & Reliability
- **Pre-computed per session**: All 5 timespan tier maps stored in `precomputedTiersRef`. Built in Phase 2A, loaded into MapView on init. `refreshBuildingColors()` uses these to build the `[match]` paint expression without recomputing tiers.
- **Must recompute on events/timespan change**: ZCTA fill `withHeat` features (for fill colors) + borough avg tiers. Building tier expression is rebuilt but only via `setPaintProperty` — no heavy iteration.
- **Must recompute on mode toggle only**: Paint properties, layer visibility, camera pitch/bearing.
- **Tier fingerprint**: event-set fingerprint prevents redundant tier recomputation when events haven't changed.
- **Outline geometry**: Per-integer-zoom cached. Rebuild only on integer zoom crossing OR `outlineCacheRevRef` bump. `removeSafezoneOverlapQuads` pre-computed once per heatmap effect.
- **Layer lifecycle**: Real3D layers created once, toggled via `setLayoutProperty('visibility')`.
- **`cachedTierDataRef`**: Caches `buildZipEventMap` + `computeTiers` results. Paint-only toggles (satellite, topoOn, threeD) skip tier recomputation.
- **`zipToZctaIdxMapRef`**: zip string → geoData feature index. Used to build `[match]` expression without iterating features on every tier change.

### MapView — General Principles
- When fixing map issues, be strictly additive and corrective. Do not remove existing features (leaderboard, holograms, side panel, etc.).
- Always consult MapLibre GL JS and MapTiler API documentation for the correct approach.
- All heatmap-dependent visuals MUST respond to the timespan slider — they're bound to event density.
- 2D fill layers and fill-extrusion layers render in SEPARATE GPU passes. Fill-extrusions ALWAYS render above 2D fills regardless of layer order.
- Fill-extrusion opacity < 1.0 (e.g., 0.92) forces MapLibre framebuffer compositing, hiding tile-seam Z-fighting. Use this for any fill-extrusion that shows seams.

### MapView — UI Micro-Fixes
- **Controls positioning**: `top-[112px] md:top-[84px]` when header expanded, `top-[68px]` when collapsed. Smooth `transition-[top] duration-300`.
- **Pin button**: Separate element next to time toggles box with `gap-2` spacing, pill-shaped `px-2 py-1 rounded-xl`.
- **Side panel**: Desktop `top-[72px]` when header visible, `top-0` when collapsed. Smooth transition.
- **Stacking context**: Map container at `zIndex: 3`, CRT overlay at `zIndex: 20` (sibling). `pointer-events: none` on CRT ensures click-through.

### MapView — Post-Mortem: Failed Approaches (DO NOT REPEAT)
- **Failure 1 — queryRenderedFeatures + setFeatureState for building tier colors**: Only styles on-screen tiles → "square bleeding" artifacts on pan. Replaced first by baked GeoJSON properties, then by PMTiles `[match, ['get', 'z']]` expression.
- **Failure 2 — Borough outline as simple 2D line in 3D mode**: 2D lines render BELOW fill-extrusions in MapLibre regardless of layer order. Solved by fill-extrusion annular quads.
- **Failure 3 — Fixed integer values for 3D outline widths**: MSAA handles thin 3D geometries poorly at low zooms. Use zoom-interpolated expressions. Current: `getZoomAwareOutlineWidth` with meter-based ramps.
- **Failure 4 — Zip polygon glitching**: GeoJSON triangulation issue. Solved by `enforceGeoJSONWinding` at load time.
- **Failure 5 — Stencil masking fill-extrusions**: A 2D `fill` layer cannot mask `fill-extrusion` layers — separate GPU passes. Building layers use `['within']` for NYC restriction, not stencil.
- **Failure 6 — Separate canvases (sat/topo)**: 2–3 MapLibre instances with constant `map.on('move', syncCamera)`. Massive overhead. Eliminated by single-canvas + `['within']` approach.
- **Failure 7 — FlatGeobuf (FGB) building data**: 196MB across 5 borough FGBs, 381K polygons, required client-side ZCTA PiP index and tier baking (1.9M property writes). Caused mobile OOM and ~6–10s cold load. Replaced by PMTiles (73MB, z13–16, MapLibre streams natively).
- **Failure 8 — `['within']` on MapTiler vector tile fill-extrusions**: Causes all buildings from external tile source to disappear. Works on fill/line but NOT fill-extrusion from external sources. Building layers use local PMTiles data — no `['within']` filter needed.
- **Failure 9 — Sorting borough features by tier for height stagger**: Skeleton cache kept original GeoJSON order; sorted index caused wrong color assignment. Solved by keeping features in original order and assigning `_boroughIdx` via rank map.
- **Failure 10 — Duplicate satellite toggle listener**: Event listener added on every heatmap effect run. Caused double-toggle behavior. Removed — satellite useEffect is the single source of truth.

### MapView — Safezone Architecture
- **Safezone split**: The original `99999` MultiPolygon (20 sub-polygons) is split at GeoJSON load time into individual `SAFEZONE_N` features, each a single Polygon with `_special: true`, `_safezoneNum: N`.
- **`isSafezoneModzcta(zip)`**: Recognizes both `'SAFEZONE'` (legacy) and `'SAFEZONE_N'` prefixed strings.
- **`getSafezoneLabel(zip)`**: Returns "Safe Zone N" from `SAFEZONE_N` string.
- **`getEventsInSafezone(szFeature, events, timespanIdx)`**: PiP-based event lookup per individual safezone polygon.
- **Side panel**: `openSidePanel('SAFE:SAFEZONE_3')` → stores `sideZip = 'SAFEZONE_3'`, does PiP for that specific polygon only.
- **3D outlines**: Both `createZctaOutlineGeoJSON` AND `buildZctaSkeleton` skip `_special` features — safezones get no upper border quads.
- **Hover**: `hoveredZip` set to `SAFE:SAFEZONE_N`, `isSafezoneHover` derived from prefix.
- **Properties preserved**: white fill, locked extrusion height, all visual safezone properties unchanged.

### MapView — Borough Outline Improvements
- **computeBoroughAvgTiers**: Uses TOTAL tier points (not average). Tier 4=5pts, 3=4pts, 2=3pts, 1=2pts, 0=0pts. Boroughs with many hot zips rank higher regardless of cold zip count. Prevents boroughs with more zips from being penalized.
- **Width at z12+**: 1.5x constant, smooth ramp 1.5x→2.5x at z11–12, then 2.5x→7x at z9–11.
- **Height stagger**: `_boroughIdx * 0.1m` prevents Z-fighting between overlapping borough edge quads.
- **Safezone overlap filter**: `removeSafezoneOverlapQuads` removes only quads touching safezone ZCTA boundaries; interior borough lines are kept for visual clarity.

### Favorites System
- Storage keys: `lapuff_favorites` (IDs), `lapuff_fav_counts` (counts), `lapuff_fav_history` (activity), `lapuff_favorite_event_cache` (snapshots, max 240), `lapuff_sb_favs` (synced set).
- **Anonymous**: localStorage only + one-time `update_event_fav_count` RPC (delta +1). No points.
- **Authenticated (Orbiter)**: upsert to `event_favorites` table, triggers `fav_count` increment. No points yet.
- **Authenticated + Participant**: `markFavoriteContributions(session)` → RPC awards 20 points per favorited event (EVENT_FAVORITED=20 as of current).
- **Auto-event guard**: `isAutoEvent(id, snapshot)` checks `_auto` flag → skips DB sync entirely. Local star/count still works. Auto events in `auto_events` table have no FK to `events`.
- Trend calculation: `resolveTrendFromThreshold(count, threshold)` — up if `count >= threshold`, neutral if within 4, down otherwise. Threshold = 12h peak.
- Real-time subscription: `subscribeToFavoriteCount(eventId, callback)` via Postgres changes channel. Multiple listeners reuse single channel.
- `window.dispatchEvent(new Event('favoritesChanged'))` broadcasts all favorite state changes.
- **LIVE/AFTERS badges**: FavoritesPage FavoriteCard shows green LIVE or purple AFTERS overlay on image when `isEventLive(event)` or `isAftersWindow(event)`.

### Points / Clout System
**Current point values (snapshot — may be tuned):**
- EVENT_ATTEND_CHECKIN: 250 (GPS-gated, 750ft, within event window)
- AFTERS_ATTEND_CHECKIN: 200 (GPS-gated, 750ft, during +1hr afters window)
- SELF_CHECKIN: 150 (organizer at own event — user_id matches event.user_id)
- REFERRAL_SUCCESS: 50 (someone signs up via your ?ref=CODE)
- SUBMIT_EVENT: 50 (awarded at approval time, not at submit; `checkAndAwardSubmitPoints` runs on events load, checks user's approved events vs clout_ledger via ON CONFLICT DO NOTHING dedup)
- EVENT_FAVORITED: 20 (one-time per event, when someone favorites your submitted event)
- HOT_ZONE_BASE: 1, HOT_ZONE_MAX: 10 (roam pts = `round(1 + heat × 9)`, 30-min throttle)
- ATTENDEE_TO_ORGANIZER: **REMOVED** — no mechanism to distinguish organizer role yet

**Roaming:**
- 30-minute throttle (`lapuff_last_roam_award` localStorage key).
- Heat value sourced from `lapuff_zip_heat` (JSON, zip→0–1 float), written by MapView after every tier computation.
- `runAutoPingScan` does Nominatim reverse geocode after check-in loop to get current zip → heat → `processRoamingPoints`.
- If `lapuff_zip_heat` is empty (map never loaded), roam skips silently.

**RPC (upgraded):** `award_clout(p_user_id, p_amount, p_reason, p_event_id, p_checkin_type)` — DB-enforced unique constraint `unique_clout_award(user_id, event_id, checkin_type)` with `ON CONFLICT DO NOTHING`. Prevents double-award including race conditions.
- `awardPoints(session, amount, reason, eventId=null, checkinType=null)` sends `p_user_id` in body.
- Submit events use `checkin_type='submit'` in ledger for audit.

**Eligibility:** `email_confirmed_at` must be set (`isEligibleForPoints`).
**Referral:** localStorage `lapuff_pending_referral` from `?ref=CODE` URL param. Auto-opens auth after 1s.

**Zip heat index:** `lapuff_zip_heat` written to localStorage by MapView whenever tier computation runs (on events/timespan change). Format: `{ "10001": 0.82, "11201": 0.34, ... }`. Universal index — reusable by any future feature.

### Location & Participant Status
- NYC bounding box: lat 40.47–40.93, lng -74.27 to -73.68.
- Spoofing detection: impossible speed > 55 m/s between pings.
- High accuracy GPS only, 12s timeout, no continuous tracking.
- 24h participant window: `localStorage['lapuff_nyc_24h']`.
- Status: 'participant' (< 24h since NYC ping), 'orbiter' (else).
- Dot colors: green (participant), red (orbiter), yellow (loading).
- **Check-in radius: 750ft (~229m) Haversine** (`isWithin750ft`). Active window: start−30min → end (main); end → end+1hr (afters). 30-min early grace period for all check-ins.
- **Typed check-in**: `markCheckedIn(id, type)` / `isCheckedIn(id, type)` where type = `'main'` or `'afters'`. Key format: `"${eventId}:${type}"`. Legacy bare key `"${eventId}"` also written for main for backward compat.
- Auto-ping scan (`runAutoPingScan`) requires 2 pings ≥ 30min apart within 750ft — then auto-checks in.
- `checkAndAwardSubmitPoints(session, events)` called in App.jsx on every events load — awards 50pts per approved event owned by user (DB dedup blocks repeats).

### Authentication
- Custom auth via `supabaseAuth.js` — NOT using `@supabase/supabase-js` auth client directly.
- Session key: `localStorage['lapuff_session']`.
- Refresh: auto-refresh if < 5min (300s) to expiry.
- Signup: email, password (min 8), username (required, profanity-checked), bio (optional), home_zip (5-digit or empty, default '10001').
- Profanity filter: leet-speak normalization (`0→o, 1→i, 3→e, 4→a, 5→s`), spacer stripping, repeated-char collapse.
- Username displayed: `username` → `user_metadata.username` → `email prefix` → "Account".

### Live / Afters Event Timing System
All timing logic lives in `src/lib/eventUtils.js`. Key functions:
- `isEventHappeningNow(event)` — `start−30min → end+1hr` (includes afters buffer). For auto events: `start → start+2hr`.
- `isEventLive(event)` — `start−30min → end` (no afters). Shows LIVE badge.
- `isAftersWindow(event)` — `end → end+1hr`. Shows AFTERS badge. Not for auto events.
- `isCheckInWindowOpen(event)` — alias for `isEventHappeningNow`.
- All use 30-min early grace: `startMs - 30 * 60 * 1000`.
- `event_time_utc_end` is the source of end time. If missing, some functions may fall back to `start + 6hr` internally.

LIVE/AFTERS badges appear in: EventTile (image overlay), EventDetailPopup (image overlay), FavoritesPage (FavoriteCard image), CalendarPage weekly + daily views. **Not** in CalendarPage monthly view.

TileView: live events are retained in the present event list even when they'd be filtered out by date range.

### Event Check-In System
- **Manual check-in**: In `EventDetailPopup`, a check-in dropdown appears when `isEventHappeningNow`. User taps "Check In Here" → GPS acquired → distance checked (750ft / ~229m Haversine) → points awarded if eligible + session valid.
- **Auto-ping**: `runAutoPingScan(events, session, onCheckIn)` in `locationService.js`. Requires `lapuff_autopings_enabled` localStorage. Pings location, stores in `lapuff_autopings` ring buffer. When 2 pings ≥ 30min apart are within 750ft of an event → auto check-in.
- **Check-in dedup**: `markCheckedIn(id, type)` / `isCheckedIn(id, type)`. Key: `"${eventId}:${type}"` in `lapuff_checkedins` localStorage. Legacy bare key `"${eventId}"` also written for `main`.
- **Afters check-in**: `handleManualCheckIn('afters')` in EventDetailPopup. Only shown when `event.afters_lat && isAftersWindow(event)`. Uses `event.afters_lat/lng` for distance check.
- **DB dedup**: `event_attendance` table has `UNIQUE(user_id, event_id, checkin_type)`. `clout_ledger` has `UNIQUE(user_id, event_id, checkin_type)` with `ON CONFLICT DO NOTHING`. Server-side guard against race conditions and bot abuse.
- **Attendance count**: `events_with_counts` view provides `attendance_count` (count of all `event_attendance` rows per event). Used in EventTile/EventDetailPopup image overlay when live.
- **30-min early grace** for all check-ins (both manual and auto-ping).

### Afters System
- **Afters window**: `end → end+1hr` after `event_time_utc_end`.
- **Afters pin**: Spawns on map when `isAftersWindow(event) && event.afters_lat`. Purple canvas `Marker` (`aftersMarkersRef`).
- **Route line**: OSRM `/route/v1/walking/{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=geojson` draws a dotted purple GeoJSON line between main pin and afters pin. Source: `afters-route`, layer: `afters-route-line`, `line-dasharray: [3,4]`. Straight-line fallback if OSRM fails.
- **AftersCheckInModal**: Module-level component in `MapView.jsx`. Opens on afters pin click. Lazy-imports GPS + points libs. Shows 750ft GPS check-in with same logic as EventDetailPopup afters check-in.
- **Navigation (AFTERS button)**: Clicking AFTERS badge in EventTile/EventDetailPopup navigates to map, fits both main + afters pin in viewport. If already on map, adjusts viewport only (does not switch to 2D). If on tiles view, switches to map view and pans to frame both pins.
- **DB columns**: `events.afters_address` (TEXT), `events.afters_lat` (FLOAT8), `events.afters_lng` (FLOAT8).
- All 30 sample events have artificial nearby afters addresses for testing.

### Event Submission
- Location types: `'address'` (full address + city + zip) or `'rsvp'` (link only, city = 'Private/Online').
- Photo upload: max 5, **any size accepted** — compressed client-side via canvas API (`compressImage()`) to < 1MB JPEG before upload. Max dimension 1920px, quality loop 0.85→0.1. Stored in Supabase `event-images` bucket. Filename: `Date.now()-random.ext`.
- Timezone: auto-detected from browser, converted via `localToUTC(date, time, offset)`.
- **Submitted events always set `is_approved: false`** — must be manually approved in Supabase (or future admin UI). Approved events appear on site and trigger submit points.
- Both Start Time and End Time are required fields. End time drives `event_time_utc_end` column.
- **Afters Address field** (optional, below description): uses same `AddressSearch.jsx` Nominatim geocoder, outputs `afters_address`, `afters_lat`, `afters_lng` to Supabase.
- Links: flexible array, trimmed on submit.
- **Geocoding at submit**: `AddressSearch.jsx` uses Nominatim — `lat`/`lng` from search results are passed to `EventSubmitForm.jsx` and included in the Supabase INSERT payload. Events table has `lat FLOAT8` and `lng FLOAT8` columns.
- All 30 sample events in `sampleEvents.js` have hardcoded `lat`, `lng`, `afters_address`, `afters_lat`, `afters_lng`, and `event_time_utc_end` (start+6hrs).

### Event Pin Markers (MapView)
- Pin toggle button: `showPins` state, 📍 pill button next to time toggles (separate element, not inside time toggle box).
- **Pin visibility window**: user/sample events persist from start−30min through `event_time_utc_end + 1hr` (afters window). Pins are removed after end+1hr.
- Pin effect: `[showPins, events, mapReady]` deps. Filters `!e._auto` and requires valid `parseFloat(lat/lng)`.
- Pin DOM: MapLibre `Marker` with custom SVG element (pin shape + emoji), `anchor: 'bottom'`.
- Pin colors: `hex_color` fill, darkened stroke, white inner circle.
- Hover: tooltip with event name/date. Click: opens EventDetailPopup.
- **LIVE pill**: When `isEventLive(event)`, a small green pill badge floats above the pin (`pillMarkersRef`, `offset: [0, -112]`). DOM `Marker` with `anchor: 'bottom'`.
- **AFTERS pill**: When `isAftersWindow(event)`, pill turns purple and reads "AFTERS". Cleared and re-evaluated on pin effect re-run.
- **Afters pin**: When an event is in its afters window AND has `afters_lat`/`afters_lng`, a separate purple canvas `Marker` spawns at the afters location (`aftersMarkersRef`).
- **Route line**: OSRM `/route/v1/walking/` API draws dotted purple line between main pin and afters pin during afters window. Source: `afters-route`, layer: `afters-route-line`, `line-dasharray: [3,4]`. Falls back to straight line if OSRM fails.
- **AftersCheckInModal**: Clicking an afters pin opens `AftersCheckInModal` (module-level component in MapView.jsx). Lazy-imports GPS + points libs. Shows afters check-in UI with same 750ft GPS logic.
- **Critical data flow**: DB rows synced before `lat`/`lng` columns existed will have null coords. `AppWithEvents` enriches DB events from SAMPLE_EVENTS by matching `event_name__event_date` keys to backfill missing lat/lng. This enrichment only runs in SAMPLE_MODE when base events differ from SAMPLE_EVENTS array reference.
- MapView reads `e.lat`/`e.lng` directly — zero geocoding API calls at runtime.

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
- `events` table: user-submitted events. Key columns: `id`, `event_name`, `user_id`, `is_approved` (bool, default false — manual approval gate), `fav_count`, `lat`, `lng`, `event_time_utc`, `event_time_utc_end`, `afters_address`, `afters_lat`, `afters_lng`, `zip_code`, `borough`.
- `auto_events` table: scraped events with `external_id` UNIQUE, `source_site`, `source_url`. No FK to `events`.
- `profiles` table: `username`, `clout_points`, `home_zip`, `bio`.
- `event_favorites` table: `user_id`, `event_id` — authenticated favorites.
- `event_attendance` table: `user_id`, `event_id`, `checkin_type` (`'main'` or `'afters'`), `status`, `verified_at`. Unique constraint: `unique_user_event_type(user_id, event_id, checkin_type)`.
- `clout_ledger` table: `user_id`, `amount`, `reason`, `event_id`, `checkin_type`. Unique constraint: `unique_clout_award(user_id, event_id, checkin_type)` — DB-enforced dedup for all point awards.
- `favorite_point_contributions` table: one-time point tracking per user per event.
- `events_with_counts` VIEW: `SELECT events.*, (SELECT count(*) FROM event_attendance WHERE event_attendance.event_id = events.id) AS attendance_count FROM events`. Used by `getApprovedEvents()` — provides `attendance_count` on every event object.
- **RPCs (current):**
  - `update_event_fav_count(p_event_id, p_delta)` — increments fav_count
  - `award_clout(p_user_id, p_amount, p_reason, p_event_id, p_checkin_type)` — inserts to clout_ledger + updates profiles.clout_points. Uses `ON CONFLICT DO NOTHING` on `unique_clout_award`. Also updates profiles via trigger.
  - `award_points_for_active_favorites(p_user_id)` — batch favorite point awards
- Supabase URL: `https://gazuabyyugbbthonqnsp.supabase.co`.
- Publishable key in `supabase.js`, service role key in GitHub Secrets only.

### CRT Effect
- Overlay layers: noise grain (0.07 opacity), lattice mesh (0.18), scanlines (0.1), chroma fringe (0.06), animated data wash line (y += 0.11 per frame), tube vignette.
- z-index 1 (behind map canvas at z-index 2). Pointer-events: none.
- Mobile: vignette reduced to 0.45 opacity with `limitMobile` prop.

### Home Page
- Dual views: 'tiles' (TileView) and 'map' (MapView) toggle.
- Mobile header auto-hide: hysteresis scroll detection, `MIN_DELTA=4px`, `HIDE_AFTER_Y=96px`, `HIDE_SCROLL_DISTANCE=18px`.
- **Header hide mechanism (tile view)**: Uses `marginTop: -headerHeight` (measured via `useLayoutEffect` + `headerRef`) to pull header out of the flex column layout. Content fills the space synchronously — same duration/easing `500ms cubic-bezier(0.22,1,0.36,1)`. Map mode uses `position: absolute` + `-translateY-full` (unchanged).
- Referral: captures `?ref=CODE` param, persists to `lapuff_pending_referral`, auto-opens auth after 1s.
- Logo hover: swaps background/shadow colors dynamically from theme.
- Desktop: Submit Event button + user dropdown. Mobile: HamburgerMenu.

### FavoritesPage
- Merges live + cached favorites via `mergeFavoriteEventsWithCache(events)`.
- Grouped by `event_date`, sorted by date then name.
- FavoriteCard: `getTileAccentColor(hex_color, theme)` for border-top color (uses `style={{ border }}` full shorthand).
- Real-time fav count + trend subscription per card.
- **LIVE/AFTERS badges** on FavoriteCard image: green pulsing LIVE or purple AFTERS pill when event is in its window.
- Empty state: emoji + "No favorites yet!" + browse link.
- **Events persist in favorites view during their live/afters window** even if they'd otherwise be past-dated.

### CalendarPage
- Views: monthly (7-col grid, max 3 events/cell), weekly (7-day vertical list, 2–3 events/day), daily (full list with expand/collapse).
- Navigation preserves `location.state.initialDate` and `initialView` from EventDetailPopup.
- MiniMap in day view: OpenStreetMap embed (if lat/lng) or Google Maps fallback.
- Theme-aware: calendar bg from `resolvedTheme.calendarBackgroundColor`.
- **Monthly event tile truncation**: Event names sliced to 40 chars: `.slice(0, 37) + '...'`. Uses `whitespace-nowrap` to enforce single line.
- **Daily view z-index**: Expanded `DayEventDetails` card uses `style={{ zIndex: expanded ? 50 : 'auto' }}` on outer div and inner card. Outer div has no `overflow-hidden` (was causing clip). Entire card is `onClick` toggle (not just a button header).
- **DayEventDetails hover states**:
  - Time+Date button: `onMouseEnter` → `bg:#000, color:#fff`; reset on leave.
  - Links: same invert + border color reset.
  - Tags: same invert pattern + `border-color` inline reset. `cursor-pointer`.
  - Map wrapper: border color → black on hover.
  - `borderColor` passed as prop to `DayEventDetails` (computed outside component, not inside).
- **Weekly + Daily LIVE/AFTERS badges**: Green LIVE or purple AFTERS pill shown on event card when in window.

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

### GeoPost System
- Component: `src/components/GeoPostView.jsx` — full feed + editor in one file (~905 lines).
- Nav tab: 🌍 GeoPost button in view toggle group in Home.jsx (`view === 'geo'`). Mobile: emoji above 2-line "Geo-/Post" text, `px-2.5` same width as other tabs.
- Session: `session` state stored in Home.jsx and passed as prop to GeoPostView.

#### DB Schema:
- `geoposts`: id (UUID), user_id (nullable FK → profiles), content (JSONB `{html, fillColor}`), image_url, zip_code (nullable TEXT), borough (nullable TEXT), scope (TEXT DEFAULT 'digital'), is_participant, post_approved, created_at.
- **Required migration**: `ALTER TABLE geoposts ALTER COLUMN zip_code DROP NOT NULL; ALTER TABLE geoposts ALTER COLUMN borough DROP NOT NULL; ALTER TABLE geoposts ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'digital';`
- `post_reactions`: id, post_id FK, user_id (nullable), emoji_text, UNIQUE(post_id, user_id, emoji_text).
- `post_clout_given`: (user_id, post_id) PRIMARY KEY — audit log, one unique reactor = one 5pt award.
- `clout_ledger` updated: added `geopost_id UUID`, unique constraint `UNIQUE(user_id, event_id, geopost_id, checkin_type)`.
- `geopost_feed` VIEW: joins profiles for username (defaults to 'Orbiter'), includes total_reactions count, filters post_approved=true.
- Trigger `on_reaction_added` → `handle_post_reaction_clout()`: 5 pts to author via `clout_ledger` insert. Only fires when reactor has a user_id. SECURITY DEFINER for offline accrual. Blocks self-voting.

#### Scope & location hierarchy:
- `scope='digital'`: null borough, null zip. Visible only in "All" filter.
- `scope='nyc'`: null borough, null zip. Visible only in "All" filter.
- `scope='borough'`: borough set, null zip. Visible in All + their specific borough filter.
- `scope='zip'`: both borough and zip_code set. Visible in All + their borough + their specific zip filter.
- PostgREST `eq` filter naturally excludes NULLs — `borough=eq.Brooklyn` excludes digital/nyc scope posts automatically.
- Location tag on post card: zip → `📍 zip · borough`, borough → `🏙 borough`, nyc → `🗽 NYC`, digital → `💻 Digital`.

#### Filter bar (GeoPostView):
- 🌀 All | 🏙 Borough▼ | 📍 Zip▼ | Time▼ | Status▼ | 🔥 Top toggle
- All dropdowns are inline (open from button), never modal popups.
- Zip dropdown: shows borough selector row first, then zip list for chosen borough.
- Active filter = accent color background (EXCEPT "Time" button when filter is 'all' — no highlight).
- Time options: All Time (default 'all'), 1d, 7d, 1mo, 3mo, 6mo.
- Status: All / Participant / Orbiter.
- 🔥 Top: sorts by `total_reactions.desc` when on, `created_at.desc` when off.
- Show More/Less: 10 per page, "Show More" +10, "Show Less" collapses to 10. Client-side slice.

#### Supabase helpers (src/lib/supabase.js):
- `fetchGeoPostFeed({ type, value, timeFilter, statusFilter, sortByTop })` — full filter support.
- `submitGeoPost(payload, session)` — payload includes `scope` field. Uses `baseHeaders` (not `SB_HEADERS`).
- `addPostReaction(postId, emojiText, session)` — 409 = duplicate (silent).
- `removePostReaction(postId, emojiText, session)` — deletes reaction.
- `fetchReactionsForPosts(postIds)` — batch fetch reactions with profiles join.
- `uploadGeoPostImage(file, session)` — Supabase fallback.
- `uploadToOracleCloud(file)` in `src/lib/oracleStorage.js` — OCI primary path.
- OCI bucket: `geopost-images`, namespace `idfnjqqb9g0p`, region `us-ashburn-1`.
- Required Vite env vars: `VITE_OCI_TENANCY`, `VITE_OCI_USER`, `VITE_OCI_FINGERPRINT`, `VITE_OCI_PRIVATE_KEY`.

#### Location selector (create post):
- Progressive: Digital (default) → NYC → Borough▼ → Zip▼
- Digital scope: no checkin popup, always orbiter.
- NYC/Borough scope: checkin popup with self-attestation (no GPS), user picks Participant or Orbiter.
- Zip scope: checkin popup → GPS `isUserInZipCode(zip)` check → Participant confirmed; failure or GPS error → stays Orbiter.
- Subtext: "you can post at the zip, borough, or city level"

#### Editor toolbar (v2):
- Rendered BELOW contenteditable, ABOVE image preview and submit button.
- All toolbar buttons use `onMouseDown + e.preventDefault()` to preserve editor selection.
- `selectionchange` listener updates bold/italic/underline/align/fontSize states live.
- Undo/Redo | B/I/U with active states | Align L/C/R (SVG icons) with active state.
- Font size A↓/A↑: 6 levels (1-6), 3=normal. A↑ highlighted when >3, A↓ highlighted when <3.
- Lists dropdown: bullet / numbered / roman numeral / remove.
- Cool Font dropdown: 9 Unicode styles + Zalgo. With selection = convert selection; no selection = toggle intercept mode (keydown listener converts typed chars). `src/lib/unicodeFonts.js` has `convertFont(text, key)`, `toZalgo(text)`, `ALL_COOL_FONTS`.
- Text color + Highlight: inline `HexColorPicker` component (preset grid + hex input). Selection preserved via `savedRangeRef` (saved on mousedown, restored before execCommand).
- Emoji picker: 16 QUICK_EMOJIS, inserts at cursor via `execCommand('insertText')`.
- Clear button: clears editor innerHTML.

#### Reaction display:
- Top 4 emoji by count shown as pill buttons. Clicking adds/removes reaction.
- `+` button toggles inline 16-emoji quick picker per post.
- `…` button opens ReactorListModal (username + emoji list). Dismiss: backdrop, X.
- Reactions batch-loaded for all posts via `fetchReactionsForPosts`.

#### Badges:
- Green `● PARTICIPANT` pill next to username if `is_participant: true`.
- Red `● ORBITER` pill if false.

#### Points:
- `POINTS.GEOPOST_REACTION: 5` in pointsSystem.js (documentation only — DB trigger handles award).
- Client does NOT call `awardPoints` for reactions.

#### Image compression:
- `compressGeoImage(file)` in GeoPostView.jsx — max 500KB, max 1280px, JPEG quality ramp 0.82→0.3.

### GeoPostView Fix Notes (2026-04)
- Create-post container now renders as a dedicated full-width section above the Geo-Feed separator.
- The two-column split (left filters, right feed) starts only below the Geo-Feed separator on desktop.
- Filter controls were restored and re-wired for `all`, `borough`, `zip`, `time`, `status`, and top-sort across desktop/mobile.
- Search now runs against the full filtered post set before pagination, not just currently visible cards.
- Search normalization now strips HTML and converts cool-font Unicode text to plain searchable text.
- Sample posts are merged into feed results for all location/status/time combinations using the same filter logic path as real posts.
- Post card color logic now uses luminance inversion for feed UI chrome (username/status/date/tags/reaction chips), while preserving authored post text styling.
- Zip-scope post cards now expose both borough and zip tags for drill-down parity.
- Back-to-top chevron was simplified to a single-shadow button and now forcibly scrolls to top reliably.
- Desktop topbar `+ Submit Event` button sizing was aligned to `Sign In / Up` dimensions.
- Desktop tile text clamp rules are now shape-specific: image long/square tiles clamp to 3 lines, image tall tiles clamp to 9 lines, and all no-image tiles clamp to 9 lines before showing a `Show more` affordance.
- Desktop image sizing now reallocates unused short-text space into image preview height for long/square image tiles, while tall image tiles use a taller vertical preview target for better fill.
- Desktop filter panel row movement now uses viewport-anchor row stepping (one grid row at a time) and bounded grid-row injection so it remains visible while physically displacing only the active row.
