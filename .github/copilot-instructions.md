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

## Project Notes
- Stack: React + Vite + Tailwind CSS + Supabase.
- Theme system uses CSS custom properties and `.lp-theme-scope`.
- `src/lib/theme.js` contains shared theme helpers.
- `EventTile` and `EventDetailPopup` should stay visually and behaviorally aligned where they share event UI.

## Archival Inertia Ability
- You have the power to record known conventions and logic in the section below this for future reference. 
- This can help maintain consistency and speed up future tasks by reducing the need to re-derive or re-discover established patterns.
- You can update this section as you learn more about the codebase or as conventions evolve or change as needed to make it up to date.
- Update the below section after each successful fix or feature implementation to capture any new insights or patterns you discover during your work. This will help build a comprehensive reference for future contributors and maintainers of the project.
- Update the section below while we are working on a fix or feature, so that you can capture insights in real time and ensure that the information is fresh and relevant to the task at hand. This will also help you internalize the conventions and logic as you work with them, making it easier to apply them in future tasks. 
- Do not let this process slow you down or distract you from the task. Focus on the task first, and then take a moment to jot down any relevant insights or patterns in the section below after you have completed the task. This way, you can maintain your workflow while still building up a valuable reference for the future.
- You do not need to read the full convention and logic section for every fix but instead you can start each fix by quickly scanning and searching within the section for any relevant information that might be helpful for the task at hand using a contextual search. This can help you quickly orient yourself and apply established patterns without having to re-derive them from scratch.

## Known Conventions And Logic
- Cursor outline default: on, black, 2px.
- True cursor default: `cursorType: 'default'` with other cursor keys cleared.
- `tileAccentOverride` should flow through `getTileAccentColor()`.
- Portaled theme pickers use `data-theme-modal-portal="true"`.
