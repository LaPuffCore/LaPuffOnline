# LA PUFF ONLINE & CLOUT CULLING GAMES
## MASTER ARCHITECTURE & REMAINING CHANGES PLAN
File Version: 1.0.0
System Time: Wednesday, May 20, 2026

git add . && git commit -m "Your commit message" && git push origin main

===========================================================================
[SYSTEM RULES & EXECUTION DIRECTIVES FOR COPILOT / DEVELOPER]
1. TRACKING STATE: Every single task item starts with `[Not Complete] ❌`. 
   As each task is successfully implemented, tested, and validated, it must be updated to `[Complete] ✅`.
2. SOLUTION SCOPE: All strategies, paths, and technical workflows outlined below are research suggestions and structural recommendations. They are NOT definitive mandates. They must be evaluated, handled, and refactored in-context within their respective development batches.
3. ARCHITECTURAL ORDERING: Tasks are organized sequentially from focused operational fixes to deep layout integrations. Site-wide optimizations, automated content moderation blocks, global zoom handling, and the final comprehensive mobile pass are explicitly positioned at the end to prevent cross-cutting code regression and redundant duplication of effort.
===========================================================================

## BATCH 1: BOROUGH HOVER, SELECTION, AND OUTLINE VISUALS (2D/3D & MAP CONTROLS)

### [Not Complete] ❌ Task 1.1: Differential Borough Hover and Selection Detection
* **Description:** Implement high-precision hover detection over borough outlines or extending a short width outward into water bodies (to account for coastline interactions), while completely ignoring shared interior boundaries between adjacent zipcodes within the same borough. This must operate independently from individual zipcode hover triggers.
* **Research Suggestions for Copilot:**
  * Parse `boroughs.geo.json` to extract pure exterior boundary geometries.
  * Use MapLibre GL JS `queryRenderedFeatures` with a custom pixel padding/radius or buffered geometry layer layered underneath the main map to capture "width equivalent into the water" without bleeding inward into neighbor zipcodes.
  * Maintain a dedicated React state (`hoveredBorough`) separate from `hoveredZip`.

### [Not Complete] ❌ Task 1.2: Visual Selection Styling for Boroughs (Purple Uniform Highlight)
* **Description:** When a borough outline is hovered (or cursor is in its adjacent water-buffer zone), change the entire outer boundary stroke to purple and apply a synchronized purple hover/selection effect to all constituent zipcode geometries nested inside that borough. Revert cleanly when mouse leaves the zone.
* **Research Suggestions for Copilot:**
  * Implement dynamic MapLibre feature-state management (`setFeatureState`).
  * In the map style layer configuration, define paint properties for lines and fills that change expression values based on `['feature-state', 'hover']` or matching the `borough_id`.
  * Ensure synchronous state updates to avoid flickering between interior zipcode boundaries and exterior borough perimeters.

### [Not Complete] ❌ Task 1.3: Mobile-Specific Borough Interaction Logic & Touch-Hold State
* **Description:** Disable desktop hover states on mobile viewports. Ensure tapping a borough outline fires the appropriate borough-level interactions immediately without blocking popups. Implement a 1-second touch-and-hold trigger for both zipcode and borough selections that briefly renders the active selection highlights (as they appear on desktop) before opening the corresponding side panel.
* **Research Suggestions for Copilot:**
  * Utilize pointer/touch event listeners (`onTouchStart`, `onTouchEnd`) combined with a JavaScript `setTimeout` clock (1000ms) to distinguish clean taps from prolonged holds.
  * Prevent default touch behavior on map canvas during a hold to eliminate accidental panning. Apply selection color style state exclusively during the active hold loop.

### [Not Complete] ❌ Task 1.4: Holographic Popup Extrusions Adaptation for Full Boroughs
* **Description:** Extend the existing zipcode 3D holographic projection/extrusion subsystem to handle full borough geometries. Left-clicking (or mobile tapping) a borough outline must project a unified 3D borough extrusion on the map canvas instead of just an isolated single zipcode block.
* **Research Suggestions for Copilot:**
  * Update the MapLibre `fill-extrusion` layer expressions. When a borough is active, calculate an aggregate base or uniform extrusion height for all features sharing the `borough_id`.
  * Group underlying multi-polygon features under a single active extrusion transaction state.

### [Not Complete] ❌ Task 1.5: Right Panel Filtering Adaptation (Borough-Level Events & Leaderboards)
* **Description:** Left-clicking or tapping a borough must update the right-hand panel to compute and display leaderboards and events aggregated at the macro borough level. For example, selecting Manhattan must display all Manhattan events and an active leaderboard sorting all users across all zipcodes contained within Manhattan.
* **Research Suggestions for Copilot:**
  * Modify the context/state provider (`useDataFilter`) to accept a `borough` scope parameter.
  * Refactor frontend filtering logic or adjust Supabase RPC/REST query strings to filter users and events using a mapping array or a structural database join linking zipcodes to their parent boroughs.

### [Not Complete] ❌ Task 1.6: Left Panel Filtering Adaptation (Borough-Level Geoposts)
* **Description:** Right-clicking (or mobile long-holding) a borough must update the left-hand post panel to aggregate and stream all geoposts from every zipcode belonging to that specific borough.
* **Research Suggestions for Copilot:**
  * Bind the `contextmenu` event (or mobile hold callback) to trigger a left-panel data fetch.
  * Use a declarative filtering function `posts.filter(post => post.borough === activeBorough)` or a single optimized Supabase query matching array-contained zipcodes.

### [Not Complete] ❌ Task 1.7: Floating Borough Dashboard Panels (🏝️ Button Integration)
* **Description:** Clicking the floating island button (🏝️) must instantly show the text/data dashboard overlays positioned directly above each borough center coordinate, without requiring map viewport movements or zoom updates to trigger visualization. Clicking these floating panels must activate the left panel, right panel, and central 3D holographic extrusion simultaneously for that borough.
* **Research Suggestions for Copilot:**
  * Mount panels as persistent DOM overlays via custom MapLibre HTML `Marker` containers or synchronize a React element layer directly over project coordinates.
  * Set conditional rendering based strictly on the `islandModeEnabled` boolean state, bypassing viewport movement event listeners.

### [Not Complete] ❌ Task 1.8: Floating Panel Data Syncing & Time-Scale Rewriting
* **Description:** Synchronize data within the borough floating panels with the active global time-scale selector (default 30d). "Hottest" status metrics and total event counts must update or hot-swap transparently without full component unmounting or layout shifting. Total participant counts must remain static as a running present total regardless of time-scale shifts.
* **Research Suggestions for Copilot:**
  * Hook the panels into the global `timeScale` state context. Use a reactivity memo (`useMemo`) to trigger automated internal state updates when time variables pivot.
  * Match hotness labels ("Hottest", "Hot", "Warm", "Cool", "Cold") explicitly with the color output arrays determined by the thematic borough map outline algorithm to guarantee absolute alignment.

### [Not Complete] ❌ Task 1.9: Geometric Pinning and Zoom-Responsive Sizing for Borough Panels
* **Description:** Fix the floating vertical position of the borough dashboards so they do not drift up or down relative to the map terrain when zooming. Reduce the initial ground clearance gap height by 50%. Enforce dynamic scaling boundaries: maintain 100% dimensions uniformly from zoom levels 11 to 16 inclusive, reduce size to 70% at zoom level 10, and shrink to 25% at zoom level 9.
* **Research Suggestions for Copilot:**
  * Use absolute coordinate mapping with explicit translation values in CSS (`transform: translate(-50%, -100%)`). 
  * Apply inline CSS variables driven by the map's current zoom level listener (`map.on('zoom', ...)`), recalculating element dimensions dynamically using step expressions matching the scale guidelines.

### [Not Complete] ❌ Task 1.10: 3D Mode & Heatmap Occlusion Shifting for Borough Panels
* **Description:** When the map enters 3D mode alongside an active 3D heatmap, calculate if an extruded column directly underlies a borough panel. If an occlusion path is detected, programmatically lift the panel vertically to preserve the precise relative distance between the top of the 3D extruded geometry block and the base of the floating dashboard panel.
* **Research Suggestions for Copilot:**
  * Read the active extrusion height configuration inside the zoom/heatmap execution thread.
  * Dynamically append an offset modification value to the panel marker container's vertical offset position parameter using pixel conversions or custom anchor settings.

===========================================================================

## BATCH 2: GEOPOSTS UI & SUPABASE DATA WIRING (LEFT PANEL)

### [Not Complete] ❌ Task 2.1: Supabase Integration and Wire-in for Geoposts
* **Description:** Connect the live backend data layer of geoposts from Supabase to populate the left-side post panel cleanly when partitioned by zipcode or borough selection scopes.
* **Research Suggestions for Copilot:**
  * Establish realtime PostgREST subscriptions or structured query triggers inside `PostPanel.jsx` listening for active geographic bounds or array-mapped zipcodes.
  * Abstract the fetch logic into a clear hook (`useGeopostsFetch`) to handle data retrieval seamlessly.

### [Not Complete] ❌ Task 2.2: Horizontal Tile Mosaic UI Layout Styling
* **Description:** Format all post previews inside the left side panel to render as clean horizontal tiles, perfectly mirroring the visual architecture used for events inside the right side panels.
* **Research Suggestions for Copilot:**
  * Share layout structural base classes or layout mechanics via unified CSS patterns.
  * Use standard inline block metrics with clear column configurations to structure content horizontally within the fixed panel width.

### [Not Complete] ❌ Task 2.3: User Context Tagging and Badge Assignment
* **Description:** Inside each horizontal post tile, display the creator's username or fallback to an anonymous string ("anon"). If a valid username is attached, look up account attributes to conditionally render custom user flair badges ("Participant" vs "Orbiter").
* **Research Suggestions for Copilot:**
  * Implement an account relation query on the Supabase backend or check cache states to pull roles.
  * Enclose badges in distinct micro inline wrappers with hardcoded color profiles matching structural parameters.

### [Not Complete] ❌ Task 2.4: Post Content Styling, Text Truncation, & Fallback Image Handling
* **Description:** Render post previews with custom text fills made slightly transparent. Enforce rich-text clipping at an identical content boundary threshold across all tiles to eliminate overflow. If a post includes an image attachment, display it within the thumbnail container; if no image exists, generate a clean placeholder filled with the user's custom chosen outline hex color code.
* **Research Suggestions for Copilot:**
  * Apply `text-overflow: ellipsis` along with `-webkit-line-clamp` rules for uniform text blocks.
  * Utilize conditional rendering expressions for the media container: `<img src={post.image_url ?? createColorPlaceholder(post.custom_outline_color)} />`.

### [Not Complete] ❌ Task 2.5: Mobile Layout Adjustments & Topbar Collision Rules
* **Description:** Adjust the left post panel on mobile screens to ensure it sits cleanly below the main topbar menu instead of overlapping it. If the topbar collapses, allow the post panel to expand upward to the bottom edge of the toggle button; if the topbar expands, recalculate and push the post panel back down smoothly. Ensure full scaling adjustments across horizontal mobile layouts.
* **Research Suggestions for Copilot:**
  * Track topbar visibility states globally via context flags (`isTopbarExpanded`).
  * Drive the mobile panel element's layout placement (`top` bounding values) using a synchronized variable matching the active dimension state of the topbar menu.

===========================================================================

## BATCH 3: SAFEZONES ISOLATION & DATA ROUTING (ZIPCODE 9999)

### [Not Complete] ❌ Task 3.1: Structural Data Isolation for Overlapping Safezones
* **Description:** Implement an independent data tracking mechanism for event pins and geoposts occurring inside designated Safezones. Because all Safezones are hardcoded to share zipcode `9999`, decouple the processing pipeline by checking secondary location keys or custom safezone index numbers to ensure content from Safezone 1 never bleeds into Safezone 2.
* **Research Suggestions for Copilot:**
  * Introduce an explicit database constraint or query filter: `WHERE zipcode = '9999' AND safezone_id = X`.
  * Ensure the application front-end reads both keys before distributing event blocks or parsing arrays.

### [Not Complete] ❌ Task 3.2: Geopost Dropdown Drilldowns & Custom Safezone Tag Rendering
* **Description:** Ensure that all borough selector dropdown menus inside the geoposts view contain explicit safezone drill-down options (e.g., Selecting Safezone 16 targets Central Park). Geopost card elements targeting these zones must render bottom-right tags designed with a distinct color schema: solid white background fill, sharp black text, and a crisp black outline displaying the true geographic name. Clicking this tag must filter the geopost view filter directly.
* **Research Suggestions for Copilot:**
  * Seed a static dictionary mapping `safezone_id` values to human-readable strings like "Central Park".
  * Apply hardcoded inline styling profiles directly to the safezone filter badges to guarantee high visibility contrast.

### [Not Complete] ❌ Task 3.3: Tilesview Content Aggregation Rules for Safezones
* **Description:** When rendering data within `Tileview.jsx`, ensure that any events or posts mapped to a Safezone (`9999`) are correctly aggregated into the structural array of the physical parent borough that geographically encloses them.
* **Research Suggestions for Copilot:**
  * Embed a client-side geometric coordinate check or use a pre-calculated lookup dictionary to cross-reference safezone IDs back to parent borough IDs (e.g., Central Park routes to Manhattan).

### [Not Complete] ❌ Task 3.4: Mapview Coordinate Fallbacks & Exclusivity for Safezones
* **Description:** Ensure map view event pins for safezones display directly within the exact boundaries of that safezone. Implement a geographic coordinate fallback check: if an address string places a pin slightly outside the boundary line due to geocoding skew, automatically snap the pin coordinates back to a set center coordinate point designated for that safezone.
* **Research Suggestions for Copilot:**
  * Create a structural map object of safezone coordinate center points: `const SAFEZONE_CENTERS = { 16: [lng, lat] }`.
  * Write a geometric verification check inside the pin-generation parsing engine to enforce boundaries.

### [Not Complete] ❌ Task 3.5: 3D Borough Outline Geometry Fix (Hole Cleansing & Adjacencies)
* **Description:** Correct issues in `boroughs.geo.json` where internal safezone boundaries (zipcode 9999) are treated as negative geometric cutouts. This error causes the map engine to render erroneous cyan-blue 3D outlines around safezones. Strip out safezone negative holes while preserving true external borough-to-borough adjacency borders on land.
* **Research Suggestions for Copilot:**
  * Process `boroughs.geo.json` using spatial analysis tools or a data script. Run a polygon union or geometry dissolution operation to close interior holes mapped to zip 9999.
  * Ensure borough outlines span continuously over internal parks and safezones.

### [Not Complete] ❌ Task 3.6: 2D Safezone Outline Restyling Rules
* **Description:** Change the color of 2D boundary lines around safezones (zipcode 9999) from red to grey. Ensure these grey strokes are rendered interior to the safezone boundary path to prevent them from overlapping or obscuring adjacent standard zipcode borders.
* **Research Suggestions for Copilot:**
  * Apply a specific MapLibre style expression rule filtering for `['==', ['get', 'zipcode'], '9999']`.
  * Set paint properties: `line-color: '#808080'` and utilize line-offset properties to keep the path rendering neatly inward.

### [Not Complete] ❌ Task 3.7: Geometric Repair for Zipcode 11370 (Queens Boundary Fix)
* **Description:** Fix a geometric error where zipcode 11370 (Queens) is clipped by the safezone geometry layer, misidentifying it as an independent adjacent borough. Ensure the borough outline layer merges 11370 smoothly into the main Queens polygon geometry.
* **Research Suggestions for Copilot:**
  * Inspect the polygon vertices of the Queens feature layer in the master geojson file.
  * Re-link disconnected boundary coordinates to guarantee proper structural continuity.

### [Not Complete] ❌ Task 3.8: Geometry Fragment Clean Up for Zipcode 11231
* **Description:** Remove an erroneous, isolated blue boundary line fragment that visualizes in 3D mode inside zipcode 11231 when the heatmap is active. This fragment is caused by an un-cleansed internal safezone vertex artifact.
* **Research Suggestions for Copilot:**
  * Filter the 3D outline layer vector source to remove stray micro-polygons or null-island shards located near the coordinate envelope of zip 11231.

===========================================================================

## BATCH 4: EVENT PINS, FAVORITES, CALENDAR, & TILEVIEW VISUALS

### [Not Complete] ❌ Task 4.1: Pin View Dropdown Filtering Engine (All vs Favs)
* **Description:** Upgrade the main event pin toggle button (emoji button) with a press-and-hold dropdown menu for both mobile and desktop viewports. Users can toggle between "All" (renders all valid emoji pins; default state) and "Favs" (limits visibility exclusively to the user's favorited events). This visibility toggle must not alter or recalculate underlying heatmap or map layer data.
* **Research Suggestions for Copilot:**
  * Implement an inline dropdown component triggered by long-press or right-click events.
  * Apply a filter array variable directly onto the visible map pin presentation layer: `const visiblePins = displayFavsOnly ? pins.filter(p => favorites.includes(p.id)) : pins`.

### [Not Complete] ❌ Task 4.2: Land Validation and Zipcode Boundary Pin Constraints
* **Description:** Implement a strict validation check to guarantee that all event pins are positioned on land surfaces inside their assigned zipcode areas. Cross-check event coordinates against the geometry envelope of their target zipcode to prevent pins from drifting into water bodies.
* **Research Suggestions for Copilot:**
  * Build a backend or client-side check using ray-casting geometry matching.
  * If coordinate calculations fall outside the target polygon bounds, snap the pin location to a default land coordinate point stored inside that zipcode's database profile.

### [Not Complete] ❌ Task 4.3: Exclusive Interactive Tapping Logic for Pins
* **Description:** Ensure that clicking a map event pin on desktop or tapping it on mobile opens the correct `eventdetailspopup` overlay cleanly. Apply isolation logic (`stopPropagation`) to ensure interacting with pins never triggers unintended map actions, clicks on underlying layers, or accidental panel updates.
* **Research Suggestions for Copilot:**
  * Wrap pointer callback handlers in strict execution blocks: `e.originalEvent.stopPropagation()`.
  * Manage cursor hover and click priorities using layer order assignments inside the map controller.

### [Not Complete] ❌ Task 4.4: Synchronized Scale & Zoom Behavior for "Live" / "Afters" Status Tags
* **Description:** Fix positioning bugs where "Live" and "Afters" indicator badges drift away from event pins during zoom adjustments. Restrict these status badges to only visualize once the map reaches the zoom threshold where the full event pin icon renders. Maintain a consistent gap distance above the pin icon mirroring the layout at zoom level 14.
* **Research Suggestions for Copilot:**
  * Bind the status badges directly into the same vector render layout configuration or HTML marker container as the parent pin.
  * Use relative vertical positioning offsets (`transform: translateY(-100%)`) inside the unified element wrapper to lock layout scaling together.

### [Not Complete] ❌ Task 4.5: Standardizing Afters Pin Mechanics and Connector Lines
* **Description:** Fix visual rendering and scaling issues with Afters pins. Ensure Afters pins inherit identical state properties, scaling behaviors, and styles as standard event pins. When active during designated times, draw a clean connection line between the main event pin and its Afters pin, and render an Afters status indicator floating at a fixed distance above it.
* **Research Suggestions for Copilot:**
  * Re-use the master pin component structure for Afters pins, changing only coordinate variables and asset labels.
  * Render connection lines using a dynamic GeoJSON `LineString` layer with explicit stroke properties.

### [Not Complete] ❌ Task 4.6: Favorite Star Badge Visualization on Pins
* **Description:** Add a small yellow favorite star with a thin black outline to the top-right corner of event pins favorited by the user (supporting both authenticated users and anonymous local sessions). When zoomed out (pin renders as a small dot), display a small star badge in the top right. As the user zooms in, scale the star badge up proportionally, keeping it positioned half overlapping and half off the main pin face.
* **Research Suggestions for Copilot:**
  * Render the star overlay using absolute positioning markers inside the pin component template.
  * Bind the scale attributes (`transform: scale(...)`) to follow the map's active zoom level values.

### [Not Complete] ❌ Task 4.7: Bidirectional Cloud Synchronization for Favorites
* **Description:** Implement cloud synchronization for user favorites on sign-in. This operation must be additive and never destructive: if an unauthenticated user favorites events locally on a device, sign-in must append those device cache favorites to their database profile without wiping existing cloud entries. The cloud database acts as the primary source of truth once a user is authenticated.
* **Research Suggestions for Copilot:**
  * On sign-in, read local storage arrays and execute an upsert call to the Supabase favorites table using `INSERT ... ON CONFLICT DO NOTHING`.
  * Re-fetch the combined list on successful authentication to update active UI indicators.

### [Not Complete] ❌ Task 4.8: Historical Filtering for the Favorites and Calendar Dashboards
* **Description:** Update the favorites filtering system so that past, expired favorited events do not show up within the standard favorites tab list. These historical entries must, however, remain fully visible inside the user's calendar dashboard interface.
* **Research Suggestions for Copilot:**
  * Apply date filter logic to the favorites view: `favorites.filter(e => new Date(e.end_time) >= currentTimestamp)`.
  * Keep the calendar source query independent of active expiration timestamps.

### [Not Complete] ❌ Task 4.9: Standardizing Map Component Previews for Auto-Generated Events
* **Description:** Fix a UI discrepancy inside the `eventdetailspopup` component where auto-generated events render with a massive OpenStreetMap label overlay. Update the preview frame to utilize the clean map layout used for user-submitted events.
* **Research Suggestions for Copilot:**
  * Standardize map render properties within the popup container.
  * Disable default attribution display settings or map controls on the auto-generated event preview instance to match the user-submitted map format.

### [Not Complete] ❌ Task 4.10: Layout Clipping Fix for Rounded Mode Tags in Tileview
* **Description:** Fix a layout bug in `Tileview.jsx` where tag elements are clipped by the bottom boundary of the tile card container when "roundmode" is active. Shift the tag position upward slightly or adjust z-index and padding values to ensure tags render clearly without altering the baseline dimensions or geometry of the cards.
* **Research Suggestions for Copilot:**
  * Add a subtle bottom padding rule (`padding-bottom: 6px`) to the interior container element or shift text baselines using minor layout adjustments to guarantee full visibility.

### [Not Complete] ❌ Task 4.11: Debugging and Stability Pass for the Daily Calendar Drilldown
* **Description:** Investigate and resolve a critical application crash that forces a white-page lock on both desktop and mobile viewports when opening the daily calendar drilldown interface.
* **Research Suggestions for Copilot:**
  * Implement React Error Boundaries around the calendar component to capture stack traces.
  * Check for null pointer references or unhandled date format parsing issues during timezone conversions inside data fetching pipelines.

===========================================================================

## BATCH 5: SEARCH & NOTIFICATIONS ENGINEERING

### [Not Complete] ❌ Task 5.1: Username-Priority Search Optimization inside Geoposts
* **Description:** Refactor the search algorithm within the geoposts view. If a user enters an exact string match for a valid system username (`searchString === account.username`), prioritize and return content created by that user at the top of the search results list. Append loose keyword match results lower down the list.
* **Research Suggestions for Copilot:**
  * Perform a multi-tier search operation or use sorted arrays: rank exact creator matches at score tier 1, and keyword mentions or fuzzy text matches at tier 2.

### [Not Complete] ❌ Task 5.2: In-App Notification Delivery Architecture
* **Description:** Build an expandable notifications feed option within the primary hamburger navigation menu. This feature is restricted to authenticated users. Generate horizontal notification rows tracking interactions: post reactions, event favoriting, event check-ins, successful user referrals, and zone roaming outcomes. Clicking a row must open the corresponding item view popup directly.
* **Research Suggestions for Copilot:**
  * Create a standard modal overlay component inside the hamburger menu stack.
  * Render notification rows as structured rows with action icons, text layouts, and target link values.

### [Not Complete] ❌ Task 5.3: Clout Point Indicator Layouts inside Notification Tiles
* **Description:** When an interaction awards clout points to a user, display the point value indicator (`+[X] ⚡`) aligned to the far right column of the notification tile. If an interaction does not award points, do not show the empty placeholder asset.
* **Research Suggestions for Copilot:**
  * Implement conditional layout flags inside the notification card component: `{notification.points_awarded > 0 && <span class="clout-pill">+{notification.points_awarded} ⚡</span>}`.

### [Not Complete] ❌ Task 5.4: Supabase Database Schema Modifications for Notifications
* **Description:** Design and deploy a real-time notification tracking schema within the Supabase database instance.
* **Research Suggestions for Copilot:**
  * Create a `notifications` table containing fields for `id`, `user_id` (recipient), `actor_id` (triggering user), `type`, `source_id` (target post/event UUID), `points`, and `read_status`.
  * Write database triggers on the points and interactions tables to automatically insert new notification rows.

### [Not Complete] ❌ Task 5.5: Notification Modal Interaction Controls
* **Description:** Ensure the notifications panel operates as a distinct popup overlay matching the application's global UI behavior. Users must be able to dismiss the panel by clicking outside the container bounds, clicking a top-right 'X' button, or pressing the Escape key.
* **Research Suggestions for Copilot:**
  * Attach keypress listeners (`keydown`) and click-away event wrapper hooks (`useOutsideClick`) to manage state transitions cleanly.

===========================================================================

## BATCH 6: CONTENT GATING, MODERATION, & ADVANCED FEATURES

### [Not Complete] ❌ Task 6.1: Legal Age Verification Gate for Sign-Up Workflows
* **Description:** Implement an age-gating popup overlay triggered when a user clicks the "Join The Games" button. The popup must prompt: "You must be 18+ to join LaPuff Online, confirm you are 18+" alongside distinct "Yes" and "No" confirmation buttons, and a subtext footer link agreeing to the Terms of Service and Privacy Policy.
* **Research Suggestions for Copilot:**
  * Open this gate layer directly above the sign-up workflow modal without closing it or clearing user text input fields.
  * Clicking outside the gate counts as a "No" action, keeping the sign-up flow open but paused.

### [Not Complete] ❌ Task 6.2: Sign-Up Finalization Mechanics
* **Description:** Clicking "Yes" on the age-gate modal closes the gate and securely commits the cached registration payload to the Supabase authentication database, finalizing user sign-up. Selecting "No" or dismissing the gate must freeze the submission process.
* **Research Suggestions for Copilot:**
  * Separate form submission hooks into two steps: cache validation state first, then commit to the network endpoint only upon positive age confirmation.

### [Not Complete] ❌ Task 6.3: Feature Roadmap Preview Overlay (Update 2 Plans)
* **Description:** Add an "Update 2" overview option inside the hamburger navigation menu. This menu item must open a clean popup layout outlining development schedules, accessible to both anonymous visitors and authenticated users.
* **Research Suggestions for Copilot:**
  * Create a straightforward text/image display component containing static copy block definitions detailing feature timelines.

### [Not Complete] ❌ Task 6.4: Dynamic Vertical Growth Engine for Geopost Creators
* **Description:** Refactor the create-post workspace layout inside `geopostview` to expand vertically when a user uploads or attaches media files. To preserve alignment, extend the underlying background tile mosaic down by adding more tile rows dynamically, keeping the feed divider element locked flush against the bottom edge. If missing image assets for the new rows, fill empty blocks with globe placeholder illustrations.
* **Research Suggestions for Copilot:**
  * Calculate row addition values based on asset height dimensions. Use grid-row count modifiers and append placeholder images into array slots to lengthen the view container cleanly.

### [Not Complete] ❌ Task 6.5: Layer Order and Depth Management (Z-Space Rules)
* **Description:** Enforce layer priority rules within the geopost view. Post tile hover animations must never clip over or appear in front of the search/filter bar when it is in up-arrow or pinned modes. The topbar header and its boundary outlines must always maintain layout priority over expanding post tiles.
* **Research Suggestions for Copilot:**
  * Define explicit stacking values in the CSS layout: assign topbars and search bars a higher priority (`z-index: 1000`), and map post tiles to lower priority values (`z-index: 100`).

### [Not Complete] ❌ Task 6.6: High-Fidelity Social Image Export Engine
* **Description:** Build a canvas-based image export tool that allows users to download posts or events formatted as high-fidelity images across variable aspect ratios (1:1 square, 16:9 widescreen, 9:16 vertical story, and 1080x1350 portrait layout styles), inheriting theme color schemes cleanly.
* **Research Suggestions for Copilot:**
  * Use the `html2canvas` library to capture styled component fragments and convert them into raw image downloads via canvas rendering.

### [Not Complete] ❌ Task 6.7: Native Instagram Story Integration and Deep-Linking Options
* **Description:** Investigate and build a mobile "Share to Instagram" feature that deep-links directly into the Instagram application, passing the generated event artwork image straight into the user's active Story creation tray. Provide a secondary "Copy Link" fallback option that copies a direct application link to the clipboard.
* **Research Suggestions for Copilot:**
  * Research the Instagram custom URL scheme protocols (`instagram-stories://share`). Pass encoded application data IDs, asset blobs, or clipboard strings via mobile sharing interfaces.

### [Not Complete] ❌ Task 6.8: Global Customization Theme Engine and Contrast Guard
* **Description:** Review and optimize the user customization modal. Ensure custom background fills apply uniformly across all site sections (excluding the core map layout, where customization is restricted to topbars and mouse cursors). Implement an automated text luminosity check: if a user applies custom fill colors without setting matching text colors, check the background tone brightness and force text elements to render in a high-contrast alternative color (e.g., flipping text to white on a dark background) to maintain absolute legibility.
* **Research Suggestions for Copilot:**
  * Implement a color calculation utility using a standard formula: `Y = 0.299R + 0.587G + 0.114B`. If the calculated value falls below a set threshold, dynamically switch text styles to high contrast.

### [Not Complete] ❌ Task 6.9: Cursor Tracking Performance Tuning & Quick CSS Color Presets
* **Description:** Optimize the custom desktop mouse cursor tracking engine to remove lag and performance stuttering. Integrate a quick-select theme palette row directly into the modal, featuring one-click pre-configured styling profiles ("Dark Mode", "Angelwave", "Pinked", "LaPuff Green", "Culling Games Red"). All built-in themes must strictly adhere to the contrast safety rules.
* **Research Suggestions for Copilot:**
  * Shift cursor movement styling updates to utilize hardware-accelerated CSS properties (`transform: translate3d(x,y,0)`) wrapped inside a performance-optimized `requestAnimationFrame` loop.

### [Not Complete] ❌ Task 6.10: Spherized CRT Post-Processing Visual Filter
* **Description:** Upgrade the application's retro CRT visual overlay option by implementing a spherized, convex glass distortion warping filter to mimic authentic physical tube monitors.
* **Research Suggestions for Copilot:**
  * Develop a custom WebGL fragment shader or create a highly performant CSS radial warp distortion mask to achieve retro curved glass monitor effects.

===========================================================================

## BATCH 7: SYSTEMS PERFORMANCE, ARCHITECTURE-WIDE ZOOM, & MOBILE PASS (INTENSIVE FINAL PHASES)

### [Not Complete] ❌ Task 7.1: Client Hardware Profiling & OOM Prevention Subsystem
* **Description:** Build a tier-detection engine that profiles client hardware on initialization, assigning devices to one of 5 performance profiles: Low, Medium-Low, Medium, Medium-High, or High. Profile assignments are calculated by checking available Service Worker cache allocations, total system RAM, CPU core counts, and GPU limits. This engine automatically dials back asset density on lower-end hardware to prevent Out-Of-Memory (OOM) browser crashes. The developer's reference laptop serves as the baseline for the "Medium" performance tier.
* **Research Suggestions for Copilot:**
  * Query the native browser APIs: `navigator.deviceMemory`, `navigator.hardwareConcurrency`, and check WebGL parameters via `getParameter(UNMASKED_RENDERER_WEBGL)`.
  * Adjust texture scale constraints, map particle counts, and data chunk sizes dynamically based on the assigned tier.

### [Not Complete] ❌ Task 7.2: Multi-Slide Carousel Tutorial Walkthrough Panel
* **Description:** Build an 8-slide welcome/tutorial walkthrough popup overlay that displays automatically on a user's first visit to the site, tracking state via local cache. The layout structure must include a clear header title, an informative illustration asset box, and descriptive subtext for each feature slide. Include chevron navigation arrows on desktop layouts, swipe gesture event triggers for mobile, and a row of 8 indicator dots at the bottom that transitions from grey to white to track progress. Ensure clicking navigation arrows never activates background elements or accidentally dismisses the modal. Add a permanent "Tutorial" re-entry link inside the main hamburger navigation menu.
* **Research Suggestions for Copilot:**
  * Manage slide progression using an internal index pointer state (`activeSlideIndex`).
  * Implement touch start and touch end gesture vector calculation listeners to ensure smooth swipe handling on mobile viewports.

### [Not Complete] ❌ Task 7.3: Global Anti-Spam Rate Limiting for Database Operations
* **Description:** Enforce anti-spam rate limits across all client database submission interfaces to protect Supabase database capacities and shield public feeds from bot networks or automated event/post spamming attacks.
* **Research Suggestions for Copilot:**
  * Set up rate-limiting buckets or deploy Supabase Edge Functions integrated with Redis token-bucket modules to validate requests before they hit database tables.

### [Not Complete] ❌ Task 7.4: Automated Content Moderation Layer (Text and Media)
* **Description:** Integrate an automated text and image moderation workflow active across all public submission endpoints (including usernames, posts, comments, titles, and descriptions). Implement a standard content filtering workflow that screens attached images for gore, nudity, or inappropriate content while permitting standard swimwear assets (e.g., bikinis are allowed, full genitalia is blocked).
* **Research Suggestions for Copilot:**
  * Route media payloads through quick, high-performance moderation cloud APIs (e.g., Sightengine or Google Cloud Vision API).
  * Run text inputs through a standardized regex validation dictionary or basic text classification pipelines before saving entries to database tables.

### [Not Complete] ❌ Task 7.5: GamesMasterLaPuff Admin Moderation Command Dashboard
* **Description:** Build a secure Admin Moderation Panel accessible inside the hamburger menu exclusively for the validated `GamesMasterLaPuff` administrator account. The panel must display a real-time feed tracking all filter infractions (detailing who, where, what, and when). Each infraction entry row must include a dropdown menu providing granular blocking options: "ban by username", "ban by ip", "ban by hardware id", or multi-vector combination blocks. Banned users must be locked out of the application and redirected to a dedicated landing page reading: "You have received the BAN HAMMER by LaPuff" featuring a prominent judge's gavel asset.
* **Research Suggestions for Copilot:**
  * Enforce strict row-level security (RLS) rules on the Supabase backend to ensure only the admin account can access or modify moderation tables.
  * Fingerprint client hardware configurations using secure device hashing protocols combined with tracking network IP addresses.

### [Not Complete] ❌ Task 7.6: Advanced Admin Profile Drilldowns & Ban History Views
* **Description:** Clicking an infraction row inside the admin dashboard must open a deep-profile drilldown displaying all associated historical offenses grouped by matching IP addresses, hardware IDs, and account usernames to quickly expose alternate accounts or sock puppets. Include a red caution icon in the top left to return to the active reports feed, and a green revert arrow icon in the top right to toggle into the Ban History logs where the administrator can review past penalties or lift active bans.
* **Research Suggestions for Copilot:**
  * Construct aggregate database queries that cross-reference tracking variables.
  * Implement status update functions (`status: 'active' -> 'revoked'`) to handle lifting bans cleanly.

### [Not Complete] ❌ Task 7.7: Unified Browser Scaling Optimization Rules
* **Description:** Resolve layout rendering issues caused by native browser zooming on the two primary views: Mapview and Geopostview. For Geopostview, ensure the custom text, image, and tile slider controllers function properly while forcing layout ratios to scale uniformly regardless of browser zoom settings. For Mapview, lock and disable default browser zoom responses entirely, instead routing zoom commands directly into the core map rendering engine. Standardize the entire system configuration to match a 100% Chrome browser zoom layout baseline on a standard 100% Windows display scale.
* **Research Suggestions for Copilot:**
  * Read and calculate browser scale deviations using window dimension metrics (`window.devicePixelRatio`).
  * Apply inverse transformation scaling values or adjust root font sizes via CSS to normalize layout presentation across varying zoom levels.

### [Not Complete] ❌ Task 7.8: Squeaky-Clean Global Mobile Pass (The Absolute Final Optimization Layer)
* **Description:** Execute a comprehensive mobile optimization and responsiveness alignment pass across the entire application interface. This phase must occur last, only after all core desktop features, layouts, and data tracking systems have completely stabilized. Fine-tune layout sizing, interactive touch regions, resource loading parameters, and interface layouts specifically for mobile devices to ensure a smooth, uniform user experience.
* **Research Suggestions for Copilot:**
  * Audit code bases using mobile emulation profiles. Clean up structural inconsistencies and layout issues by utilizing clear media queries and adjusting layout breakpoints across the entire style stack.

===========================================================================
## APPENDED RAW USER PROMPT REFERENCE (EXACT DUPLICATION FOR COPILOT LOG CONTEXT)
===========================================================================
Here are our remaining site fixes:
We need to fix and implement the borough selection feature
When hovering over a borough outline ONLY or also the borough outlines width equivalent into the water then give
This is meant to be a differential selection than the zipcode selections which occur whenever hovering in the zipcode selection areas of the individual zipcodes, so hovering borough outline (and slightly outside it to sea (not inward) when available as we also need to ignore shared interior borough zip boundaries for this)
When a borough outline is hovered, make the whole borough outline that is selected have a purple selection color and make all zipcode outlines inside the have a purple hover selection too, when the user isn't hovering the borough outline or slightly outside it at sea then turn this selection back off - this is to signify to the user when they are hovering a borough vs when they are hovering individual zip area, by separating it to just the borough outline and showing a differing selection effect the user always knows what they are calling either zip or borough with their clicks on desktop
on mobile btw we can't really have hover effects and the popups block the screen so just make it so that it correctly triggers the correct borough interactions when tapping a borough outline just without hover select color changes when clicked (so we can still functionally click borough outlines), for the holding feature on mobile which makes the zip or borough posts panel appear make the mobile hold take 1 second to trigger for borough selection and zip selections and while held make any zip or borough selection colors appear as they would in our desktop logic for zip or borough as this is the only time we can see them on mobile briefly
This creates a separate selection state for all related things when clicking borough instead of zip on desktop and mobile
Left clicking (or tapping on mobile) a borough selection makes a full borough extrusion appear instead of just the zipcode only extrusion in the holographic popup (same as zip but at borough level instead of zip drill down - adapt our zipbased holographic popup to show full boroughs when boroughs selected)
Left clicking (or tapping on mobile) a borough selection makes the events and leaderboard side panel show events and leaderboards at the borough level (same as zip but at borough level instead of zip drill down, aka when left clicking manhattan borough selection or tapping on mobile then show all manhattan events and manhattan relative leaderboard that includes all users in all manhattan zips and all events in manhattan - adapt the zip based right panel to also be able to filter our sitewide borough data essentially)
Right clicking (or holding on mobile) makes the left side panel postpanel appear at the borough level showing all posts from that borough from geoposts (same as zip but at borough level instead of zip drill down, adapt the zip based left post panel to also be able to filter our geopost data by borough too when a borough selection is made instead of a zip essentially)
Another way a borough selection can be made is by clicking our hovering borough panels when the 🏝️ button is pressed and they are on, clicking these floating borough panels will make the left and right side panels and the middle holographic extrusion appear (all of it) for the borough all at once based on the respective borough clicked
Make the following changes to the Borough panels that hover over boroughs when the 🏝️ button is turned on:
Make sure when the 🏝️ button is turned on they are instantly visible and dont require a zoom or move change or etc to appear whenever toggled on they should appear instantly
Make sure that the popups over boroughs that the 🏝️ button turns on are correctly time synced with the time change button - which one is the hottest or how many events there are should change per timespan per borough and allow the ‘hottest’ to change from one to another if needed (participants should stay the same that’s a present measure always) this should rewrite their data without them needing to re-render fully or should instantly swap so they dont disappear when time scale button is pressed and it accurately represents our time scale’s data that is pressed which is 30d by default
Make sure the borough panels accurately count how many participants and events are in each borough (events changes by timespan, participant is the running present total in each regardless of timepsan) (make sure the hottest, hot, warm, cool, and cold claims match the assigned borough tiers so it is all in sync, it receives this decision by the math we use to determine the borough outline color)
Make sure that the floating borough panels that appear when 🏝️ is pressed stay floating at the same exact level just like our event pins do, currently when zooming in or out they change their vertical relative position and weirdly float up or down when they should stay relatively pinned and floating at a coordinate just like our event pins do! Reduce the amount they are floating above the land by half for now and make sure they keep their coordinates through all zooms
We need to keep the borough panels the same size from z11 to z16 inclusive exactly the same but it needs to be smaller from z9 to z11, getting smaller from z11 to z9 i want it 25% its current size at z9 and 70% its current size at z10, then from z11 up it should be the same size it is
Make sure when 🏝️ is pressed and it is 3d mode and heatmap is on in 3d mode that then and only then can the borough floating panels move up in vertical height if they have a zone under them that when raising would occlude them, if they need to raise then they should keep the same gap as they had from the ground as the gap between the top of the extruded block and the panel
Along with the above fix we need to properly wire in the post data from geoposts and supabase to the left side postpanel popup by zip and borough accordingly - stylize them just like the events are in the event and user panel -
make the posts previews display as horizontal tiles just like events do in the events and users panel,
inside the horizontal posttiles in the panel it should have the username who posted it or anon and then if username it should have participant or orbiter tag
make the horizontal post tiles in this panel inherit their custom post fills (although now the fills are slightly transparent), their rich text (cut at the same content amount for each with no overflow), and the image of the event is instead the post image and if no post image then make it have the hex color of the chosen custom outline color as the image in the image box instead!
On mobile we need to make it so that the postpanel popup to show posts by zip or borough doesn't obstruct the topbar and instead ends under it, if topbar is collapsed then it expands to just under the expand button, and if topbar expands it moves back to below topbar (same as our other panels for events and users etc on mobile) and that the horizontal post previews are styled the same but for mobile scaling
We also need to equip geoposts and safezones to individually track their event pins and posts per individual safezone (so that posts and events from safezone 1 arent accidentally called in safezone 2’s selection etc) essentially making sure safezones have their own independent event and post wiring, this is difficult because all our safezones share zipcode 9999 so we will also have to separate by that
this means all borough dropdowns in geopost should have safezone with the different ones selectable (i.e safe zone 16 is actually central park so the safezone drill down should show central park as an option, safezone bottom right tags on posts should be the same as the others but have white fill, black text and black button outline that says the actual name aka ‘Central Park’ and can be clicked to navigate to that geopost view filter just like the others)
in tilesview the safezone events should go into whatever borough they are actually contained in
In mapview eventpins for safezones should be in the safezone hover coordinate wise and actually in the events display panel for that safezone etc - when it thinks an event is in a safezone by address the event pin location should also result in that safezone so they share properties, if misaligned aka if the event is in the safezone but the pin didnt calculate there have fallback center coordinates for our safezones that it can fallback to when it needs to correctly represent being there
For event pins in the mapview that are toggled by the pin emoji button we need to do the following:
Make the pin button styled exactly as is but act now as having a built in dropdown when held on mobile and web instead that allows to select between “All” which is all emoji pins (default selection when tapped or clicked) or the other option is “Favs” which only pulls the event pins for your favorites in visibility (but doesnt alter any other calculations of map or heatmap or etc just helps user thin visible event pins to only favorites if desired)
Map event pins need to make sure that the zipcode the event claims it is in actually matches where the event pin is coordinate wise on our map - if it claims in our data that our event is in a zipcode the resulting event pin coordinate position should also be there and in that zipcode on the map - since event submissions already get sorted into zipcode assigned addresses then the pin result should be checked to ensure the coordinates are always in the zip assigned to that event, youll have to update our sample pins with this logic to ensure but also ensure it happens to all user submitted events that also get turned into pins
The live and afters tags float far away from the map pins when zooming out, this is incorrect, firstly make it so that the live and afters buttons only appear above them when at the same zoom that the full eventpin materializes at, second make sure they keep the same gap that they have at z14 above the pin equivalent whenever they are visible (currently they appear when we cant even see the full map pin and become really far away from it when zooming out when it should stay the same closeness and just be a part of the same render object as the pin so it stays with it)
Make sure the coordinates given for map pins are always on land and not the water, we can generally confirming this by only letting map pins be in our zipcode areas (as events are bound to specific zipcodes)
Make sure map event pins always display eventdetailspopup relevant to that event when clicked on desktop or tapped on mobile! Make sure clicking or tapping the pin is exclusive and doesnt cause clicks on other things by accident!
The afters pin is currently weirdly zooming and scaling at different zooms when it should have the exact same state and style properties as our normal event pins which already work correctly, they just simply are in different places and have a line drawn between it and the event pin when active for the period we designated and have an afters sign floating above it which also acts like the live sign above events pins, make sure the afters pins act exactly the same as event pins otherwise!!
Give events that the user or anon has favorited (whether signed in or not) a favorite star on them on the map - when the event or afters pin is the small circle before zooming in make it a small star in yellow in the top right with a thin black outline, when zooming in more and the pin appears fully have the favorite star scale up with it and stay in the top right area of the pin (it can half overlap the pin and be half off it positionally)
Borough outlines for 3d extrusion versions in real3d:
Safezones which are the interior lines of all our boroughs in borough geo.json and which we know what they are because we correctly define them as zip 9999, the issue is that the internal boundaries count safezone as a separate borough and make that color cyan blue for extrusions around safezones (on accident from interior geometry negatives in our borough outline)
We want to remove 3d borough outlines around safezones that are zipcode 9999 specifically but keep the ones that are for borough adjacency and for boroughs - they are around zipcodes marked 9999 and wont
We want the 2d ziplines around safezones of zipcode 9999 to be grey instead of red for only safezone 2d zip outlines and they should be interior to the zipcode only to not interfere with any other zip outlines, safezones should not have red zip outlines if they are zip code 9999
11370 should be in the queens but is borough outline is getting chopped by the safezone outline and getting detected as an adjacency borough when it isnt and should just be contained in queens, if safezone borough outlines are removed allow the borough outlines to connect over them as needed to make whole geometries - just make sure that when removing the safezone borough outlines that boroughs can still
The issue is primarily that our boroughs.geo.json has the safezone cuts in it as negative holes but we just want borough outlines to surround their borough fully and continuously and only interact with other borough outlines at adjacency points like between queens and brooklyn on the land
It also makes a random blue line on real3d in zip 11231 when heatmap on these are clearly geometry fragments from safezones which shouldnt have borough outlines only interior zipcode outlines in grey
We want to implement a notifications system into the hamburger menu as the new top option called “notifications” that will display a number based on that user’s notifications amount or for anonymous people not signed in they dont get one (signed in users only, no sense in tracking an anonymous users notifs for them)
Users who are signed in get a notification for when someone reacts to their post, or favorites their event as well as how many points they got, clicking the notification brings the user to that post or event popup, the notifications are horizontal tiles stacked in a list like the leaderboard but with an icon of notif type for each notif type then the text like “[username] reacted to your geopost” and then to the right of that if points awarded they get a “+[X] ⚡” as the right most aligned column of the notification tile that shows how much points they got for an interaction (if no points dont show “+[X] ⚡”)
Users who are signed in get notifications for any other interactions they get clout points for such as event check ins (when clicked shows event checked into and displays [username] checked into your event) and and referring users (displays “You referred [username] successfully”) and roaming states “You earned ____ points in a [hot/warm/cold/etc] zone” after a zone roaming is complete
Discuss any supabase additions or adjustments we need to make to track this logic and properly give users notifications, as most of these things are related to points we mostly track them by their points outcomes already
Make the notifications display work as a popup when clicked in the hamburger menu that works like our other popup logics, it can be closed by clicking out of it or pressing the x in the top right or pressing escape
Our sign up system needs to have a gate on it when users hit “Join The Games” it needs to have a popup that says “You must be 18+ to join LaPuff Online, confirm you are 18+” with a “Yes” and “No” button and below those buttons in the popup it says “By clicking ‘Yes’, you agree to our Terms of Service and Privacy Policy.”
this appears above the sign up popup without closing it when join the games is pressed and exclusivizes clicks to it and can be closed by clicking outside of it (which will be the same as a no and not wipe data from the sign up or close the sign up popup)
Clicking out of the popup or choosing no on the age check popup will not progress the signup process
Clicking yes will finalize the submission process for signup to supabase just like the join the games button did before but now just gated by this popup we need legally.
Daily calendar drilldown broken, it just needs to be fixed, it crashes to a white page on mobile and desktop?
Make sure username search in geopost works correctly, if i search sample_user_10 and its a username i should only see any content by that username first as first position (username based priority search) and then any content mentioning that username afterwards, right now when searching sample_user_10 it pulls a bunch of random posts and not even the one by sample_user_10 so let’s do whatever we can to ensure our search is specific and sharp when text string matches a username in our accounts system, but you can keep it somewhat relational and non specific if they type something into search that doesn't match someone’s username specifically - after the content that matches someone’s username displays as the first posts than any loose search content based on that username can come after but it should be able to know and prioritize specific user content if the search bar str === a username in our account system list!
Update 2 describer option in hamburger menu with popup describing update 2 plans, very simple, allows me to list all update 2 plans, can be seen by both anonymous and signed in users
In geopostview when we attach an image to a post the createpost area should be able to grow more vertically tall to see the attached image, to do this we should extend the geopost tile mosaic behind it down as many rows as needed and the geopost feed separator can extend to stay flush with it - by adding more rows to the moasic behind it we can keep all the mosaic tiles flush and just cleanly animated extend it as needed to show the image at full height - if we don’t have enough images add our globe placeholders instead as needed for the new rows - this should just shift the mosaic size to be taller to accommodate and the bottom of the mosaic should shift down geofeedseparator while still keeping it flush with it then geofeed can be below that, extend page size as needed vertically to accommodate when it occurs by how much it extends (so still same tiles to show more this just lengthens this whole screen by this section when an image is attached and it needs to display its full height based on the fixed width we have)
In geopostview when hovering a posttile it should not intrude or appear above the filter bar if it is in up arrow emoji mode or up arrow emoji and pinned mode (users can always click it to see full popup so this is fine), filterbar always frontmost zspace when [up arrow emoji] button or [up arrow emoji and pinned] are toggled on – also when hovering a tile dont make it or let it extend over the topbar or the topbar outline, the topbar is always in front of posttiles in zspace
To handle browser zoom on these two specific pages before all others (mapview and geopostview) we will make sure the text size, image size, and tile size scaler slider for custom sizing control in geopost view work and then force all browser zooms to render at the same ratio always and not break our system in geopostview, for mapview we just disable browser zooming and make zoom commands wire into the map, if the browser is zoomed or not it always displays the same – we have built everything so far at our default standard of chrome browser at 100% zoom with 100% windows cale so completely standardized - we will handle all this last just like the architecture wide needs so the page is fully done first before we do this to it
Make sure favorites sync and work properly and write and unwrite cloud on sign in as required –
Make sure signed in users cloud sync their favorites so if they favorite something signed in and login somewhere else or again later it is counted as a favorite and the favorite button has an on selection (we use the cloud to visually and data sync favorites for signed in users so they are counted as favorites across all sign ins and they see they are favorited when signing in - aka if something isnt favorited on my screen then i sign in and my signed in account had it favorited it should sync on screen to being favorite toggled on and selected as favorite when i sign in and visible in my favorites tab - cloud priority sync
For syncing anonymous unsigned in favorites into an account once signed in - this should only be additive and not destructive, so if a user isnt signed in favorites are device only cache, but if they sign in and their device cache has a favorite their sign in didnt then it should be added to their favorites for their signed in cloud sync - this should not remove any from cloud sync only add ones that weren’t added before from local cache
Cloud sync should always take priority and authority over local device cache when signed in and can only be added to by local device cache
Make sure past favoriterd events dont show up in favorites page but they can show up on calendar page
Make sure the map preview for auto events in eventdetailspopup is the same as the map preview for user events in eventdetailspopup - currently user events are correct but auto ones have a weird giant openstreetmap label on them
On Tileview.jsx which we get to by pressing the Tiles button in the selector we need to make sure when on roundmode that the tags are not being clipped by the bottom of the tilecontainer as they currently are on Tileview.jsx, they have enough vertical room that they should just be able to be shifted up a little to clear whatever is clipping it or we can make them more forward in zspace than the other container elements or guarantee a small bottom padding - dont change the overall tile shape or size doing this, make it work within the tilesize we have now for the events on tileview.jsx and just modify its contents minimally so that the few pixels getting cut off the tags arent!
When mapview is done we need to tune a low medium and high end version detection and use system that filters if a user is on a strong enough laptop or phone and places them in that tier based on how much SW cache, total active RAM and other limitations or advantages they have that we need to tune for so that different low end mobile devices and low end laptops don’t OOM crash. Currently my laptop I am using has these following specs and doesn’t crash at all so we can standardize above or below this with where this laptop places (likely medium end system) , if you think we should have 4 or 5 tiers instead and have a good argument for it you can tell me why (low, medium low, medium, medium high, high) could be a good arrangement actually - tell me what parameters we need to tune based on our system.
I need to make a welcome or intro or tutorial or signposting style popup all in one that describes how the site works to users when they arrive for the first time only on any device, we record this in local cache if first time or not
it should have about 8 informational slides of tutorial things with mini images to represent it in between a title above the image and then subtitle text below the image explaining that factor in the title that is also pictured with our site functions and how it achieves it and what users can do and why they should
It should have left and right chevrons on either side of it to move through each informational panel and a circle dolley of 8 circles at the bottom of it that lights up the circle from grey to white to show which slide 1 through 8 we are on (pressing chevrons on desktop or mobile makes it go left or right and definitely do not trigger the outside the popup click to close or anything else when clicking the chevrons, on mobile swiping left or right is how you go through them and there are no chevrons but there are the lower white dots so we know which of the 8 we are on and still close etc)
It should work with the same logic as all our other popups (above everything, closable by clicking outside or pressing esc or pressing x button)
I want you to draft what parts need the most explaining and their text and then i can edit it from there, fill 8 swipes worth for now
It should be added to the hamburger menu as ‘Tutorial’ in case a user ever needs to reopen it
Architecture wide or large implementation needs:
Controlling anti-spam at all submission points via rate limiting where needed and where needed for our supabase rate limits and to protect the database from being spammed etc or the events from being spammed with fake events or posts being spammed with 100s of posts a second etc so we need to discern the rate limit for all event submissions
Controlling content filtering with image filter to check for things like gore and nudity and poop and pee and other standard things (full genitalia not bikini, bikini allowed) just like we do for text and make sure our text filter is enforcing at all text submission points where it needs to like usernames, posts, comments, event descriptions and event titles, etc, anywhere a user is entering custom text of their own and same with images we need to protect image attachments for events and posts the same way to filter bad things - we should prioritize finding standardized instant call workflows for the image thing that doesn't require complex ai api setup or etc
A ban system that will allow me to ban users by ip, username, and device hardware combinations at varying levels if needed without accidentally banning other users - will need to give GamesMasterLaPuff account an admin panel in the hamburger menu that will open up my admin panel that only my validated authid user can process things through, it will let me see anyone who is trying to spam or use profanity or upload bad images from the above implementations by noting the details of who, where, how and when someone tried to defy the content filter system - next to each display of action is a dropdown that lets me choose “ban by username” “ban by ip” “ban by hardware id” “ban by username and ip combo” “ban by username and hardware combo” and clicking any of them will commit that site ban (banned users load into a page they are locked to seeing and cant see anymore site and always get redirected to that says “You have received the BAN HAMMER by LaPuff” with a big hammer image of a judge gavel, clicking the main part of the horizontal report tile in my admin panel popup in the list of reports will bring me into a drill down showing all reportable offenses grouped around that report’s ip, hardware ids, and username to show any potential sock puppets or etc, in the top right of the admin panel is a green revert arrow icon and when i click it it goes out of reports and into ban history where i can view the bans done or remove a ban if desired to lift a ban, we can navigate back to reports as a red caution icon in the top left of the popup can be clicked to access reports
Make a button for users to download any posts or events into 1:1 squares or 1080x1350 or 16:9 or 9:16 etc that make images of them based on their styles and content for users to export and use in other places - investigate if we can make a ‘share to instagram’ button on events or posts that will make them share to story the image it makes on their phone directly to a fully formed instagram story (only person ive seen do this is partiful app but it has to be possible) - clicking the share button on any post makes a dropdown that has an export as square, export as tall, export as long, export as insta tall, or share to instagram (the export buttons give images, share to instagram brings it right into an instagram story, very advanced but would be very cool to figure out how partiful does this on mobile devices) - we also want there to be a copy post link or copy event link in this share button option too in case people dont just want to do images and want to share a site-link that directly opens the post or event that it is shared from instead
We will need to do a bug fix pass on the customization popup to ensure that we have everything it can customize properly wired (for instance all section fills across site should get affected by customization of section fill, excluding mapview where color customization doesnt affect our map at all except for the topbar and cursor changes) and that when fill colors are chosen but text colors arent chosen the appropriate text luminosity always applies to our text so it can always be seen across site…. Aka if text default is black but the user chooses a custom fill color of black if that black text were to be on black it needs to know to become white or some opposite visible luminosity color always, black just an example here (if both custom text and custom fill are chosen then we respect user choice but if only one or the other it needs to luminosity the text or fill for things to be visible always legibly) – we also need to make sure the mouse cursor customization system is optimized and not laggy (desktop only as it is desktop only) – we also should probably make some standard css style colored presets like “dark mode, angelwave, pinked, lapuff green, culling games red, etc…” for users to choose from above the color customization section and below the cursor customization section in the customization popup, when chosen they apply a preset of custom colors to all the below color custom selection options based on the color theme and style (dark mode is typically darker range fills like black incognito with white text for instance) - all presets should follow our luminosity principle and always have somewhat opposite and visible text colors compared to fill colors (no light yellow text on white fill or black text on black fill for instance)
Enhance or work on crt effect and other visuals and anywhere else we can add liveliness or animation cheaply (ideas and brainstorming), make crt effect spherize!
Overall browser zoom out and zoom in scaling properties for the whole site every page and view area needs reviewing for browser zoom adjustments, we will do this one by one and last
MOBILE PASS LAST:
X. The most most most last step, the step after everything is done, will be to do a mobile optimization pass with desktop complete just tuning things and their sizings and representations on mobile only to work properly as needed - we have been primarily focused on desktop first and most things inherit well but we will need to do this pass after everything, and i mean everything, just to get everything squeaky clean. This is a whole other thing and will t
