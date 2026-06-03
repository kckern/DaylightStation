# CycleGame Visual Redesign — Design Doc

**Date:** 2026-06-03
**Status:** Validated (brainstormed section-by-section with KC, all sections approved)
**Companion plan:** `docs/plans/2026-06-03-cycle-game-ux-improvements.md` (Tasks 8–11 implement this)
**Audit basis:** `docs/_wip/audits/2026-06-03-cycle-game-design-usability-evaluation.md` (findings #1–3, #8)

## Goal

Give the cycle-game a bold, memorable **arcade / synthwave race-day identity** applied to the **whole widget** (lobby *and* race screen), replacing the timid grey-on-near-black palette and generic system-sans look. The lobby currently ignores the existing token system entirely; this redesign makes a single token system the source of truth and has every screen consume it.

## Locked decisions

1. **Aesthetic:** Bold arcade / synthwave, whole widget (not just the lobby).
2. **Font: Roboto Condensed is canon.** No new display font (kiosk font-loading risk + app-wide identity). "Bold" comes from color, glow, motion, layout motifs, and heavier/italic Roboto Condensed numerals — never a new typeface. `JetBrains Mono` is declared in tokens but never loaded; we do **not** add it — telemetry uses `ui-monospace`, and prominent numbers use tabular Roboto Condensed.
3. **Motion is fine here.** The global CSS animation-kill (`*, *::before, *::after { animation-duration: 0s !important }`) lives in `Menu.scss` scoped to `.menu-items-container`, NOT `TVApp.scss`. CycleGame renders outside the menu, so CSS animations/transitions play. (This retracts audit finding #1.)
4. **Kiosk reality:** Runs in an FKB WebView on a TV (~1280×720). Everything must be glanceable at distance: big numerals, strong contrast, no fussy detail. `TVApp.scss` forces `font-family: 'Roboto Condensed' !important` app-wide — which now helps us (no override fights).

## Section 1 — Color & atmosphere (token system)

Rewrite `_cgTokens.scss` into a synthwave palette consumed by lobby + race + countdown + results.

- Surfaces: `--cg-bg #0a0a14` deep indigo-black; `--cg-panel #12101f`; `--cg-panel-2 #1a1730`; borders `#2a2440` (violet-tinted).
- Brand/chrome accents: `--cg-magenta #ff2d95` (primary/energy/selection); `--cg-cyan #21e6ff` (telemetry/live/"GO").
- Rider lane identity: keep green/orange/purple *semantics*, neon-shifted → `#5dff9b` / `#ffb13d` / `#b072ff`. Magenta & cyan reserved for chrome so a rider is never confused with a UI accent.
- Text: `--cg-text #f3f0ff`; `--cg-muted` and `--cg-faint` chosen to pass **WCAG AA (≥4.5:1)** on `#0a0a14` (verified by node script — this absorbs standalone Task 3).
- `cg-backdrop` mixin (behind every screen): synthwave **horizon glow** (radial magenta→cyan bloom from the bottom edge), faint **scanlines** (low-opacity `repeating-linear-gradient`), optional **grain** (~3% inline SVG noise). Neon emphasis via `box-shadow`/`text-shadow` glows on selected/active elements.

## Section 2 — Typography & numerals

- Display/headings: Roboto Condensed heavy, tight tracking, UPPERCASE eyebrows + hero, subtle magenta→cyan text-glow on the wordmark.
- **Signature numeral treatment** (countdown digits, race clock, RPM, finish times, distances): Roboto Condensed **800 italic**, slight negative tracking (forward "speed" lean), `font-variant-numeric: tabular-nums`, neon glow (cyan for live telemetry, magenta for hero moments like "GO").
- Small mono telemetry only where alignment matters: `--cg-mono: ui-monospace, …` (no new font). Prominent numbers use tabular Roboto Condensed, not mono.
- Eyebrows/section labels: uppercase Roboto Condensed, `letter-spacing 0.28em`, `--cg-muted` (the existing `cg-eyebrow` mixin, now actually used by the lobby).

## Section 3 — Lobby layout, space & balance

- Atmosphere: `cg-backdrop` replaces the flat fill → depth, not a settings page.
- Race-type tiles: keep 3-up; selected tile = magenta neon border + inner glow + icon lit cyan; unselected dim to ~55% so the choice reads at TV distance. Larger icons, more padding.
- **Starting grid → an actual start grid (signature motif):** slots sit above a glowing neon **start-line** (thin magenta/cyan bar, checkered-edge hint); each slot framed as a grid box with a faint lane number; filled slots glow in the rider's lane color; empty slots show a dashed neon "add rider" affordance (fixes empty-slot recognition without re-adding names — a test forbids names on the slot).
- Spacing rhythm: consistent vertical scale (28px between major zones, 16px within) replacing today's mixed 20/22/16. Generous negative space around the hero; denser, aligned records rail.
- Start button: hero CTA — magenta gradient + cyan edge-glow + subtle idle pulse when `canStart`; checkered-flag icon kept; disabled state clearly inert.
- Records rail & volume: stronger hierarchy (lane-colored accents), the empty-score placeholder (Task 4) and volume readout (Task 5) styled as cyan telemetry chips.

## Section 4 — Race screen / countdown / results / speedometer + iconography

- **Race screen:** `cg-backdrop` + tokens; neon-shifted lane trio; leader line/tag gets a cyan crown halo glow; clock + tags use italic tabular numerals; roster gets lane-colored rank accents; darken vignette slightly so neon reads on the ambient video.
- **Countdown:** big number = hero numeral (magenta "GO" with burst glow on key-punch); lamps get true neon red/amber/green glows; speed-line streaks behind the number (highest-energy moment).
- **Results:** keep staggered reveal; winner row magenta spotlight + crown glow; medals on lane-colored chips.
- **Speedometer:** ring/ticks → tokens; cyan needle with glow; RPM = italic tabular numeral; multiplier badge in rider lane color.
- **Iconography (audit #8):** equipment tiles framed in a uniform neon circular chip so a wordmark like "Nicoday" sits consistently beside vector glyphs — a CSS framing fix, no new assets.

## Testing & risk

- Visual changes are CSS-dominant. **Regression guard = existing vitest suites stay green** (behavior unchanged). No snapshot tests (brittle on a kiosk).
- AA contrast verified by node script for `--cg-muted`/`--cg-faint` on the new bg.
- Final manual TV smoke per the companion plan.
- Blast radius: re-skins the working race screen — kept to CSS + token consumption; component logic untouched.

## Phasing (in the companion plan)

- **Phase 1 (behavioral):** Tasks 2, 4, 5, 6, 7. **Task 3 (standalone contrast) is absorbed into Task 8** (the token rewrite picks AA-passing muted/faint).
- **Phase 2 (visual):** Task 8 tokens + backdrop; Task 9 lobby re-skin; Task 10 race/countdown/results/speedometer re-skin; Task 11 iconography framing.
