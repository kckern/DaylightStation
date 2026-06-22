# Art Library — precise crop editor · Design

**Date:** 2026-06-22
**Status:** Approved model (A), ready for spec review → plan
**Builds on:** the Art admin Library
(`docs/superpowers/specs/2026-06-22-art-admin-library-design.md`) and the ArtMode
screensaver engine (`frontend/src/screen-framework/widgets/`).

---

## 1. Problem

Per-work crop is currently a coarse `crop_anchor` keyword (top/center/bottom) plus
global per-axis budgets. The bulk of the manual curation is deciding, per work,
**whether** it may be cropped and **exactly which vertical band** to keep when it is.
The Library needs a direct-manipulation crop editor on the loupe that produces a
precise crop the screensaver obeys.

## 2. Crop model (metadata.yaml `crop`)

A new optional `crop` object per work:

```yaml
crop:
  enabled: true        # false → NEVER crop (always matted/contained). Omit = auto.
  top: 14.8            # % of source HEIGHT trimmed from the top
  bottom: 20.0         # % of source height trimmed from the bottom
  # left / right reserved for a later panorama pass (v1 writes vertical only)
```

Semantics:

- **`enabled: false`** — the work is never cover-cropped; it always shows fully (matted
  gallery mode). This is the explicit "not croppable" flag. Squares / 4:3 / portraits
  already default to not-cropped via the ratio gate; this makes it explicit or, for a
  qualifying landscape, lets the curator force matted.
- **A band (`top`/`bottom` present, `enabled` not false)** — defines the exact vertical
  keep-window `[top, 100−bottom]` of source height, full width. The screensaver shows
  this band cover-filled into the opening. A band implies croppable (overrides the ratio
  gate so the engine cover-fills using the band).
- **Absent `crop`** — today's auto behavior (ratio gate + `crop_anchor` + budgets) is
  unchanged. `crop_anchor` remains the fallback for un-banded works.

Validation (backend + UI): `top`, `bottom` are numbers in `[0, 90]` with `top + bottom ≤ 90`
(always keep ≥10% of height). `enabled` is boolean.

## 3. Backend

- **`artSource` projection** (`sources/artSource.mjs`): surface `crop` in both `readMeta`
  and `projectMeta` (normalized: `enabled` boolean default-absent, `top`/`bottom` numbers
  or null), alongside the existing curation fields.
- **Admin PATCH** (`workMetadata.mjs`): add `crop` to the `WRITABLE` allowlist and validate
  it (shape + ranges above; reject otherwise with 400, same path as the anchor validator).
  A `crop: null` patch clears it.
- No new endpoints — the existing `PATCH /admin/art/works/*` carries `{ crop }`.

## 4. Screensaver engine (the one real change)

`frontend/src/screen-framework/widgets/artModes.js` + the panel render in
`ArtMode.jsx` / `ArtLayer.jsx`.

- **Mode gate** (`fillDecision`): if `crop.enabled === false` → force the matted gallery
  mode (never matless/cover), regardless of ratio/budget. If a band is present → qualify
  as cover (matless) so the band is honored.
- **Band rendering** — a cover-cropped sub-rectangle can't be expressed by `object-position`
  alone (it only re-centers a fixed cover crop; it can't pick an arbitrary band height).
  Add a **pure helper** `cropBandFit({ top, bottom }, srcRatio, openingRatio)` →
  `{ backgroundSize, backgroundPosition }` (or an equivalent `{ scale, translate }`),
  computing how the source must be scaled+positioned so the band `[top, 100−bottom] × full
  width` exactly covers the opening (uniform scale = cover; horizontal centered; vertical
  aligned to the band). When a panel has a band, render it via that helper (a
  `background-image` layer, or a transformed `<img>` inside an `overflow:hidden` window);
  otherwise keep the existing `<img object-fit:cover` + `cropFocus(crop_anchor)` path
  untouched. Image-load detection (the curtain-reveal `onLoaded` signal) must still fire —
  keep an `<img onLoad>` for loading even if display uses a background layer.
- The helper is pure and unit-tested across cases (band taller/shorter than opening,
  full-frame band = no-op, clamps).

## 5. Library crop editor (loupe)

New `frontend/src/modules/Admin/Art/CropEditor.jsx`, rendered as an overlay on the loupe
artwork (replaces the current numpad-compass overlay for landscape works):

- A **keep-window** drawn over the image at the opening's aspect, with **top and bottom
  drag handles** (independent → slide *and* resize). The area outside the window is dimmed
  (what gets trimmed). A live readout shows `top %` / `bottom %`.
- Handles are draggable (pointer) **and** keyboard-nudgable when focused (↑/↓ = 1%,
  Shift+↑/↓ = 0.2%) so it works without precise mousing.
- A **"Don't crop (matted)"** toggle → writes `crop: { enabled: false }`; a **"Reset to
  auto"** clears `crop`.
- Drag-end / toggle calls the existing `useArtCuration.mutate({ crop })` (optimistic
  auto-save + undo). Logged via the existing `art.action` / `art.curate` events.
- Clamps to the validation range; the window can't invert or keep <10%.
- The numpad/anchor flow stays for works without a band (back-compat); defining a band is
  the precise upgrade.

Pure geometry (window px ⇄ crop %) lives in a tested helper `cropGeometry.js` so the
component stays thin.

## 6. Scope

- **In:** vertical band (top/bottom) + `enabled:false`, the loupe editor, the engine band
  render + `enabled` gate, backend surface/validate/persist.
- **Out (later):** left/right panorama bands (model reserves the keys; no UI yet); changing
  the global budgets; diptych cropping (bands apply to single-panel landscapes).

## 7. Testing

- **Backend unit:** `crop` round-trips through PATCH (merge preserves it; `crop:null`
  clears); validation rejects out-of-range / `top+bottom>90` / bad shape; `projectMeta`
  surfaces it.
- **Engine unit:** `cropBandFit` math (taller/shorter/equal-aspect bands, full-frame no-op,
  clamps); `fillDecision` forces matted when `enabled:false` and cover when a band exists.
- **Frontend unit:** `cropGeometry` (window↔% conversions, clamps); `CropEditor` writes the
  expected `crop` patch on drag-end and on the don't-crop toggle.
- **Manual:** define a band on a tall landscape in the Library, confirm the screensaver
  shows exactly that band; set `enabled:false`, confirm it mattes.

## 8. Key files

- Backend: `sources/artSource.mjs` (surface), `workMetadata.mjs` (writable+validate).
- Engine: `screen-framework/widgets/artModes.js` (`cropBandFit`, `fillDecision` gate),
  `ArtMode.jsx` + `ArtLayer.jsx` (band render path).
- Library: `modules/Admin/Art/CropEditor.jsx`, `cropGeometry.js`, `Loupe.jsx` (mount the
  editor), `useArtCuration.js` (unchanged — carries `crop`).
