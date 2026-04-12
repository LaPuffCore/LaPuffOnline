# LaPuffOnline — Copilot Instructions

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

## Known Conventions And Logic

### App Architecture & Provider Chain
- Root: `App` → `AuthProvider` → `ThemeProvider` → `QueryClientProvider` → `Router` → `CustomCursorOverlay` → `AuthenticatedApp` → `AppWithEvents` → Routes.
- Router basename: `/LaPuffOnline` (subfolder deployment on GitHub Pages).
- Three routes: `/` (Home), `/favorites` (FavoritesPage), `/calendar` (CalendarPage), `*` (PageNotFound).
- `AppWithEvents` owns the single `events` state: merged `[...userEvents, ...autoEvents]`. All child pages receive this array.
- Entry: `main.jsx` uses React 18 `createRoot`, no `StrictMode` wrapper.

### Event Data Model & Two-Source System
- **User events**: Supabase `events` table. Fetched by `getApprovedEvents()`. No `_auto` flag.
- **Auto events**: Supabase `auto_events` table. Fetched by `getAutoEvents()`. Injected with `_auto: true`.
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

### Theme System
- 54 customizable fields via `THEME_FIELDS` in `src/lib/theme.js`.
- Default accent: `#7C3AED` (purple). Page bg: `#FAFAF8`. Surface: `#FFFFFF`.
- CSS variables applied to `:root` via `applyThemeToDocument()`: `--lp-accent`, `--lp-accent-soft` (14% opacity), `--lp-accent-softer` (8% opacity), `--lp-title-text`, `--lp-subtext`, `--lp-body-text`, `--lp-button-*`, `--lp-page-bg`, `--lp-surface-bg`, `--lp-topbar-*`, `--lp-micro-icon`, `--lp-tile-shadow`, `--lp-logo-*`, `--lp-search-*`, `--lp-leaderboard-*`, `--lp-calendar-*`, `--lp-emoji-stain`.
- `.lp-theme-scope` wrapper remaps Tailwind classes to CSS variables (e.g., `.bg-white` → `--lp-surface-bg`).
- Auto-contrast: when surface color changes but text not overridden, WCAG luminance auto-adjusts.
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
- Center: `[-73.94, 40.71]`, zoom 10.5, bounds `[[-75.5, 40.0], [-72.5, 41.5]]`.
- GeoJSON: `./data/MODZCTA_2010_WGS1984.geo.json` (cleaned) for NYC zip boundaries.
- Heat tiers: cold (< 0.30), cool (0.30–0.55), warm (0.55–0.80), orange (0.80–1.0), hot (≥ 1.0). 4-pass adjacency blur.
- Heat colors: `#00ccdd` (cold), `#00dd66` (cool), `#aadd00` (warm), `#dd6600` (orange), `#cc0d00` (hot).
- Normalization: logarithmic `Math.log(count+1) / Math.log(max+1)`.
- Pitch/bearing: 3D on → `{ pitch: 48, bearing: -17 }`, Real3D → `{ pitch: 55, bearing: -17 }`, off → `{ pitch: 0, bearing: 0 }`.
- ZipHologram: Canvas 460x340 (desktop) or 400x260 (mobile) with sine wave rotation, scanlines, glitch.
- Special zips: `99999` or `>11697` → SAFEZONE (white fill, locked).
- Satellite mode: MapTiler satellite layer, reduced opacity (fill 0.5, glow 0.55).
- Offline: disables 3D features, shows connection notice.
- Side panel pagination: `PAGE_SIZE = 6`.

### MapView — Mode Architecture & Toggle Logic
- **4 buttons**: Satellite, Heatmap, 3D, Real3D.
- **3 core view categories**: 2D, 3D, Real3D. Only one of these three is active at a time.
- 2D = both 3D and Real3D are OFF (default view).
- 3D = 3D is ON, Real3D is OFF. They are mutually exclusive toggles (one swaps off the other).
- Real3D = Real3D is ON, 3D is OFF.
- **Satellite and Heatmap are additive overlays** — they can both be ON simultaneously with any of 2D/3D/Real3D, creating combo modes (e.g., 3D + Heatmap + Satellite).
- All conditionals must cleanly split 2D logic from 3D/Real3D logic and all additive combos.

### MapView — 2D Mode Rules
- **2D is DONE and correct. DO NOT TOUCH 2D logic.** All 2D modes (standard, heatmap, satellite, and their combos) work perfectly and must remain exactly as-is unless the 2d mode is specifically asked to change and this will only be later with map theme color customization not during our map overhaul.

### MapView — 3D Mode Rules (Extruded ZIP Codes)
- 3D mode extrudes the ZCTA zip polygons as colored blocks.
- The **"Upper 3D Border"** is the top-edge ring of each extrusion, rendered as a separate red-tinted extrusion layer sitting on top of the zip block at a translated height. It traces the 2D zip boundary lines but elevated to the height of the block beneath it. In heatmap combos, the upper border height follows the heatmap extrusion height of each zip.
- The upper 3D border structure and logic is currently working and should be maintained. Only the visual fixes below apply.
- 3D extrusion heights per tier: 30, 200, 700, 1600, 2800.
- Outline: neon red `#ff2200`, glow layers at varying widths. Current dynamic width formula: `14m + max(0, 13-zoom)*4.5m` (thickens as zoom decreases).

### MapView — 3D Known Issues & Desired Fixes
- **GeoJSON sync**: All geographic vertices/features for ZCTA zip polygons, the upper 3D border, and 3D extrusions MUST be derived from the same cleaned `MODZCTA_2010_WGS1984.geo.json`. If any pre-generated data (e.g., in `nycZipGeoJSON.js` or other files) was built from an older GeoJSON, it must be regenerated from the cleaned version. Everything must be in sync. If needed then make all 3d extrusion and border layers pull directly from the same source GeoJSON to guarantee this - whatever is drawing the upper border 3d extrusions as we call them in 3d mode.
- **Upper 3D border pixelation on zoom-out**: The thin top ring shimmers due to MSAA sub-pixel aliasing at low zooms (maybe). Potentially fix with zoom-interpolated thickness: as zoom decreases, thickness must increase to maintain visual mass - but try a number of solutions. Allow controlled bleed/overlap between adjacent borders at low zoom to smooth this visually. **DO NOT simplify geometry or reduce vertices** — zip boundaries must remain distinct and match the actual ZCTA shapes.
- **2D line X-ray through 3D blocks**: Standard 2D line layers (zcta-line, zcta-line-glow, etc.) are visible "through" the 3D extrusions. Fix: hide ALL standard 2D line layers unconditionally when any 3D mode is active. Confirm this does NOT disable the upper 3D border (which is its own extrusion layer, not a 2D line).
- **Borough outlines in 3D** (NEW): Introduce a `nyc_boroughs.geojson` source. In 3D modes, render borough boundary outlines at ground level. They must NOT be visible through 3D blocks (no x-ray). Preferred approach: use 2D lines (since 2D lines already render cleanly without pixelation) applied only to borough boundaries — if 2D lines can be occluded by 3D extrusions. If 2D lines cannot be occluded, use a fill-extrusion with height slightly below the coldest (shortest) tier height so the engine naturally hides it behind taller blocks. Apply the same anti-pixelation zoom-interpolation as the upper 3D border. Color: standard red when heatmap is off, or a darker differential of the borough's average heatmap color when heatmap is on. Make outlines thick enough to be visible at borough edges.
- **Zip polygon glitching** (e.g., zip 11422): Random flat red vertices/caps appear at certain zoom levels. This is a GeoJSON triangulation issue — broken polygons or bad zoom-out simplification in the source data. Investigate the cleaned GeoJSON for broken polygon rings. If any derived zip data elsewhere in the codebase was generated from an older GeoJSON, regenerate it.

### MapView — Real3D Mode Rules (Individual Buildings)
- Real3D renders actual OSM building footprints from the MapTiler 3D buildings source.
- **3 zoom tiers**:
  - Far zoom (zoomed out): No 3D building extrusions or baseplates rendered.
  - Medium zoom: Baseplates only (flat footprints from the API). If the API provides outlines, keep them; if not, skip custom outlines. Just the native baseplates.
  - Close zoom: Full 3D building extrusions at actual building heights.
- Current zoom thresholds are too high (buildings appear too late). Reduce the medium and close zoom thresholds by ~1 tick each so buildings render sooner.
- **Two color palettes** with clustering for visual differentiation of adjacent buildings:
  - **Standard palette (heatmap OFF)**: Dark-red to light-red range. Buildings use `featureId % 5` shading within the red range for clustering. Baseplates use a solid red from the same range.
  - **Heatmap palette (heatmap ON)**: Buildings inherit the heatmap color of their containing zip code (e.g., warm-yellow zip → yellow-range building colors with clustering). Baseplates use a solid color from that zip's heat tier. This IS bound to the timespan slider — changing from 1d to 6mo may recolor buildings as event density shifts.
- Buildings must only render within NYC (5 boroughs). Apply a strict `['within', nycPolygonGeometry]` filter to the building layer to exclude NJ/CT/LI buildings.

### MapView — Real3D Known Issues & Desired Fixes
- **Square bounding artifacts, flashing, Z-fighting**: Caused by `queryRenderedFeatures` + `setFeatureState` styling approach (see post-mortem below). Fix: eliminate `queryRenderedFeatures` for Real3D styling entirely if possible. Consolidate into a single declarative layer using GPU-side data-driven paint expressions. The square bleeding comes from only styling on-screen tiles — panning reveals unqueried buildings in default color.
- **Double-rendered baseplates**: If the MapTiler API already provides baseplates, do not create a second baseplate layer (causes Z-fighting). If we cannot control API baseplate colors, then create our own baseplates slightly raised above the API ones to avoid Z-interference. Alternatively, use MapLibre zoom interpolation on `fill-extrusion-height`: medium zoom = height 0 (acts as baseplate), high zoom = scales to actual building height. This avoids separate competing layers.
- **Cyan loading flash**: Default fallback color must be our standard red range (boosted brightness), not cyan/blue. When Heatmap is ON, buildings must strictly inherit their containing zip's heat color with no flash of wrong color during loading.
- **Building-to-zip assignment**: The current raytracer/centroid approach (`queryRenderedFeatures` → `getGeomCentroid` → `findTierForPoint`) causes artifacts and square blocks. Replace with a simpler declarative system if possible — use data-driven paint expressions (`['%', ['to-number', ['id'], 0], ...]`) on the GPU side to determine shade index, and bind tier coloring to the zip polygon data. Research whether MapLibre GL JS supports `['within', ...]` or point-in-polygon at the expression level for this, or if a pre-computed join is needed.

### MapView — Post-Mortem: Failed Approaches (DO NOT REPEAT)
- **Failure 1 — queryRenderedFeatures + setFeatureState for Real3D**: Caused "square bleeding" artifacts because it only styles tiles currently rendered on-screen. Panning reveals unqueried buildings flashing the default color. Must use GPU-side data-driven paint expressions instead. Verify this approach works in our MapLibre GL JS + MapTiler setup.
- **Failure 2 — Borough outline as simple 2D line in 3D mode**: May or may not be occluded by 3D extrusions depending on MapLibre's rendering order. Test whether 2D lines can be naturally hidden behind fill-extrusions. If they cannot, use a fill-extrusion with height just below the cold tier height so the engine occlude it behind taller blocks. Ensure no pixelation.
- **Failure 3 — Fixed integer values for 3D outline widths**: Browser MSAA handles thin 3D geometries poorly at low zooms. Must use zoom-interpolated expressions like `['interpolate', ['linear'], ['zoom'], 9, 80, 15, 10]` (research exact values for our setup). This was never fully pinned down — needs fresh investigation.
- **Failure 4 — Zip polygon glitching (e.g., 11422)**: Confirmed as GeoJSON triangulation issue. Random flat red vertices/caps appear at certain zooms. Ensure the cleaned GeoJSON has valid polygon rings and that all derived data in the codebase matches it.

### MapView — UI Micro-Fixes
- **Zoom controls overlap**: The native MapLibre zoom-out (minus) button overlaps the custom Recentering button. Fix: add `marginBottom: '80px'` to the MapLibre NavigationControl container on load, or reposition the custom recentering button so the native minus button is always clickable.

### MapView — Caching & Reliability
- Evaluate whether the NYC-only map data (tiles, GeoJSON, building footprints) is small enough to cache on mobile/web devices, especially since we restrict 3D rendering to the 5 boroughs only.
- The map occasionally fails to load on first click but works on refresh — investigate whether this is a race condition, tile loading failure, or memory overflow. Consider caching the GeoJSON and critical map assets, consistent with how the rest of the app caches events to sessionStorage.
- Compare map data footprint to existing app caches (`sessionStorage` event cache, `localStorage` favorites/theme) to ensure we are not exceeding mobile storage quotas.

### MapView — General Principles
- When fixing map issues, be strictly additive and corrective. Do not remove existing features (leaderboard, holograms, side panel, etc.).
- Always consult MapLibre GL JS and MapTiler API documentation for the correct approach before implementing map changes.
- All heatmap-dependent visuals (fill colors, extrusion heights, building colors) MUST respond to the timespan slider — they are bound to event density which changes with the selected time window.

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

### React Query
- `refetchOnWindowFocus: false`, `retry: 1`.

### Removed / Dead Scrapers (for reference)
- NYC Open Data (`nycdata.js`): removed — returned permit events, not real public events.
- NYC Parks, RA, Meetup, Dice, TimeOut: all removed — blocked by Cloudflare, auth requirements, or returned 0 events.
- If re-adding sources, use JSON extraction (`__SERVER_DATA__`, `__NEXT_DATA__`, JSON-LD) not HTML scraping.
