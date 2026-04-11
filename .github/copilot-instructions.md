# LaPuffOnline — Copilot Workspace Instructions

## Codebase Context
- Always use the **full codebase** as context when solving problems. Never limit context to a single file.
- Before making changes, explore all relevant files (components, lib, pages, css) to understand the full picture, then implement across all affected files in one pass.

## Workflow Order
1. **Read** all relevant files first
2. **Write** all changes (multi-file edits in parallel where possible)
3. **Build/test** once at the end to catch any errors
4. **Fix** any build errors found, then confirm done

Do NOT read one file → ask → read another → ask. Batch all reads upfront, make all writes, then validate.

## Deployment
- The project uses a GitHub Actions pipeline for build and deploy. **Do not run dev servers or deploy commands.** Only run `npm run build` to verify correctness.

## Project Stack
- React + Vite, Tailwind CSS, Supabase
- Theme system: CSS custom properties via `applyThemeToDocument()`, `.lp-theme-scope` on component roots
- `src/lib/theme.js` — `DEFAULT_THEME`, `THEME_FIELDS`, `CURSOR_TRAILS`, `getTileAccentColor`, `useSiteTheme`
- `src/components/CustomCursorOverlay.jsx` — full cursor rendering (trails, overlays, outline)
- `src/components/ThemeCustomizerModal.jsx` — customization popup
- `src/components/ColorPicker.jsx` — portaled color picker (always anchors to its trigger button)
- Cursor settings persist across views; color settings do not persist into map view

## Conventions
- Cursor outline: default on, black, 2px
- True cursor default = `cursorType: 'default'`, all cursor keys cleared
- `tileAccentOverride` wires through `getTileAccentColor()` in both `EventTile` and `EventDetailPopup`
- Modal footer is `flex-shrink-0` pinned — never sticky-scroll
- `data-theme-modal-portal="true"` on portaled pickers so modal outside-click ignores them
