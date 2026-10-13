# ArtMode View-Mode Cycle — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Purpose

Add a **Tab** key that cycles ArtMode through five framing modes — a progression
from "museum" (framed + matted) to "immersive" (full-bleed) — plus two placard
refinements (image-width clamp with ellipsis, and balanced two-line titles).

## Scope

ArtMode only. No backend changes. Reuses the existing matte, frame, curtain, dim,
and placard layers; adds a view-mode selector and a smarter placard.

## The five modes

A single pure descriptor drives rendering. Each mode is
`{ name, frame, window, fit, placard }`:

| # | Name | Frame | Target window | Fit | Placard |
|---|------|-------|---------------|-----|---------|
| 1 | Gallery (default) | on | frame window − mat margin | capped cover-crop (current `artLayout`) | yes, on mat |
| 2 | Framed · Contain | on | frame window | contain | yes, bottom overlay |
| 3 | Framed · Cover | on | frame window | cover (crop) | yes, bottom overlay |
| 4 | Bare · Contain | off | full stage | contain | no |
| 5 | Bare · Cover | off | full stage | cover (crop) | no |

Behavior notes:

- The full-stage `.artmode__matte` layer always sits behind the art, so any
  letter/pillarbox gap in **contain** modes shows **matte, not black** — for free.
  In **cover** modes the image fills its window, so no matte shows (mode 5 is a
  true full-bleed; mode 3 fills the frame window).
- `.artmode__dim` (ambient brightness) and the curtain reveal stay on top in every
  mode, unchanged.
- Frame `<img>` is rendered in modes 1-3, hidden in 4-5.
- Placards render in modes 1-3, hidden in 4-5. In modes 2-3 there is no mat band,
  so the placard floats as a bottom overlay inside the frame window (instead of
  sitting on a mat as in mode 1).

## Rendering approach (hybrid)

- **Mode 1** keeps the existing `artLayout` geometry (the matted look with capped
  cover-crop). Not reworked — avoids regressing the delicate gallery presentation.
- **Modes 2-5** use a CSS `object-fit` path: place the image in its target window
  (frame-window insets for 2-3, full stage for 4-5), `object-fit: contain | cover`,
  with `overflow: hidden` so cover-crop clips cleanly to the window edges.

**Diptych.** Two-up in every mode. In the object-fit modes (2-5) the target window
splits into two equal-width halves (no gap); each panel object-fits within its half.
Contain → matte boxing inside each half; cover → each image covers its half, the two
meeting at center. Mode 1 keeps the existing `artLayout` diptych geometry.

## Input & state

- New `viewMode` state, initialized from an optional `defaultViewMode` prop
  (default `gallery`).
- Added to the existing keydown handler:
  - **Tab** → next mode, wrapping 5 → 1.
  - **Shift+Tab** → previous mode, wrapping 1 → 5.
  - Both call `preventDefault` / `stopPropagation` so kiosk focus never moves.
- `viewMode` is independent of art loading, so shuffling art (← / →) preserves the
  current mode. A remount (each fresh showing of the screensaver) re-initializes to
  the default — same lifecycle as the manual brightness bias.

## Placard refinements

### Width = image width, with ellipsis

Each panel's rendered display width is plumbed to its placard as a hard `max-width`,
so a placard never extends past its artwork.

- `artLayout` is extended to return `widthPct` per panel (% of stage width) for
  gallery mode.
- In modes 2-5 the panel width is the target-window width directly (full stage, or
  half for diptych).
- The subtitle (`artist · date`) is a single line: `white-space: nowrap; overflow:
  hidden; text-overflow: ellipsis`.

### Balanced two-line titles

A new pure helper `layoutTitle(title, maxWidthPx, measure) → string[]` (1 or 2 lines):

- If the whole title fits on one line at `maxWidthPx` (per `measure`) → one line.
- Otherwise split at the word boundary that **minimizes the difference between the
  two line widths**, so no orphaned dangling word → two balanced lines.
- If the best 2-line split still has a line exceeding `maxWidthPx`, that line is left
  for CSS ellipsis (the helper does not itself insert `…`).
- A single unsplittable word that overflows → one line (CSS ellipsizes it).

`measure(str) → px` is injected, so the algorithm is pure and unit-testable with a
fake measurer (e.g. width = character count).

Each title line renders as its own `.artmode__placard-line` span with
`white-space: nowrap; overflow: hidden; text-overflow: ellipsis` — per-line
truncation that works in every browser (no reliance on `-webkit-line-clamp` +
`text-wrap: balance` cooperating).

### Measurement

The component measures title text against the placard font via one shared offscreen
`<canvas>` 2D context, memoized on `[title, panelWidthPx, font]`. The font string
matches the placard CSS (family, weight, size). Titles still pass through
`smartquotes` before measuring/rendering.

## New / changed units

- `frontend/src/screen-framework/widgets/artModes.js` (new, pure): the 5-mode
  descriptor table + `nextMode(i)` / `prevMode(i)` (wrapping).
- `frontend/src/screen-framework/widgets/titleLayout.js` (new, pure):
  `layoutTitle(title, maxWidthPx, measure)`.
- `frontend/src/screen-framework/widgets/artLayout.js` (modified): add `widthPct`
  per panel to the output.
- `frontend/src/screen-framework/widgets/ArtMode.jsx` (modified): consume the mode
  descriptor (frame toggle, render path, placard gating), Tab / Shift+Tab handling,
  canvas measurement + `layoutTitle`, per-panel placard max-width.
- `frontend/src/screen-framework/widgets/ArtMode.css` (modified): object-fit
  window/image rules; placard-as-bottom-overlay variant for modes 2-3; per-line
  title spans with ellipsis.

## Config

`screensaver.props.defaultViewMode` — optional, default `gallery`. Absent → gallery.
Backward compatible; existing config and behavior unchanged when the prop is omitted.

## Error handling / edge cases

- Missing art / fetch failure → existing black-fallback path; modes still cycle but
  there's nothing to fit (no regression).
- Title with no spaces (single long word) → one ellipsized line.
- `measure` unavailable (no canvas / zero width before layout) → fall back to a
  single line (CSS ellipsis still applies); never throw.

## Testing

**Pure — `artModes.js`:** descriptor fields per mode (frame on/off, fit, placard
flag); `nextMode` wraps 5→1; `prevMode` wraps 1→5.

**Pure — `titleLayout.js` (`layoutTitle`):** short title → one line; long title →
two balanced lines (assert the two measured widths are within a small delta);
over-long → second line left to ellipsis; single unsplittable word → one line.

**Pure — `artLayout.js`:** existing tests stay green; new assertion that each panel
output includes a sensible `widthPct`.

**Component — `ArtMode.test.jsx`:**
- Tab cycles 1→2→3→4→5→1; Shift+Tab reverses.
- Frame `<img>` hidden in modes 4-5, present in 1-3.
- Placards hidden in modes 4-5, present in 1-3.
- `object-fit` value applied per mode (contain vs cover) in modes 2-5.
- Diptych renders two windows in each mode.
- Mode survives a shuffle (press → ; mode unchanged).
- Tab is `preventDefault`ed (focus not moved).
- Placard `max-width` tracks panel width; a long title renders two
  `.artmode__placard-line` spans.
- Existing gallery / ambient / curtain / smart-quote tests stay green.

## Open items / future

- Per-mode default crop tuning; remembering mode across showings (localStorage) if
  desired later — deliberately out of scope (mode resets on remount).
