# ArtMode Layout v2 — Single-with-Crop + Portrait Diptych

**Date:** 2026-06-15
**Status:** Approved design (validated visually), ready for implementation plan

## Purpose

Make ArtMode fill the frame well for any artwork shape: landscape works show
singly (cover-cropped within a budget to minimize mat), and portrait/square works
show as a **diptych** — paired with a companion painting, two beveled cuts in a
shared matte. All layout measurements account for the ornate frame PNG's effective
border so the visible mat is balanced.

## Scope

In scope:
- Loosen the aspect filter so portraits/squares become eligible (as diptych pairs).
- Companion selection for a portrait primary.
- API serves one or two artworks plus a shared matte.
- Frontend ArtMode: single-with-crop and portrait-diptych layouts, frame-window-aware
  geometry, per-painting nameplates, all config-driven.

Deferred (YAGNI):
- 3+ up layouts, mixed orientation pairs, animated transitions between shuffles.

## Decisions (locked, validated)

- **Aspect taxonomy** (ratio = w/h): **landscape 4:3–16:9** (1.333–1.778) → single;
  **taller than 4:3** (ratio < 1.333, incl. 1:1 square) → diptych; **panoramic > 16:9**
  → excluded. No tallness floor.
- **Companion (diptych), tiered:** (1) same `artist` AND same `credit` (collection);
  (2) same `artist`; (3) same `credit` (different artist); (4) random eligible portrait.
  The companion must itself be portrait/square and not the primary. ("collection/series"
  → the `credit` field.)
- **Shared matte:** average the two paintings' average RGBs → `deriveMatte` once → one
  shared palette for the whole diptych.
- **Crop:** each painting may cover-crop up to **8% per side** (≤16% per axis),
  config-driven cap, applied **as needed to fill** (not always maxed). Single fills the
  opening; diptych panels widen (trim top/bottom) to tighten the gaps.
- **Diptych gaps:** three **equal visible** gaps — left margin = center divider = right
  margin — distributed **inside the frame's transparent window** (not the full canvas).
  Panels share a common height; offset is permitted (the divider need not be at canvas
  center when panel widths differ).
- **Nameplates:** one engraved brass plate per painting, on the frame's bottom rail
  (same vertical position as single mode), centered under each painting.
- **Frame effective border:** the frame PNG's transparent-window insets are config and
  are factored into the opening for both layouts.
- **Shuffle:** each shuffle re-draws a fresh featured pick (landscape→single,
  taller→a new pair).

## Aspect filter (backend)

The eligibility index keeps every work whose ratio is **≤ 16:9** (i.e., not
panoramic) and classifies each: `landscape` (1.333 ≤ ratio ≤ 1.778) or `portrait`
(ratio < 1.333, includes square). Panoramic (> 1.778) excluded. Selection picks
uniformly from all eligible works.

## Companion selection (backend)

When the picked work is `portrait`, choose a companion from the portrait pool by the
tiered rule above (artist+credit → artist → credit → random), excluding the primary.
Within a tier, pick randomly. If the portrait pool has only the primary (degenerate;
~never, given 473 portraits), fall back to rendering it as a single.

## Shared matte (backend)

For a diptych: `avg = mean(primary.avgRGB, companion.avgRGB)`, then
`matte = deriveMatte(avg)` (the existing pure function, guardrails intact). For a
single: `deriveMatte(primary.avgRGB)` as today. Each panel also reports its own
`color` for reference.

## API response shape

`GET /api/v1/art/featured` returns a unified shape:

```json
{
  "mode": "single" | "diptych",
  "matte": { "branch": "...", "base": "...", "glow": "...", "edge": "...",
             "bevelTop": "...", "bevelLeft": "...", "bevelRight": "...", "bevelBottom": "..." },
  "panels": [
    { "image": "/media/img/art/classic/.../A.jpg",
      "meta": { "title": "...", "artist": "...", "date": "...", "width": 0, "height": 0, "...": "..." },
      "color": { "average": "#...", "hue": 0, "saturation": 0, "value": 0 } }
    /* one entry for single, two for diptych */
  ]
}
```

This replaces today's flat `{ image, meta, color, matte }`. ArtMode is reworked to
consume `panels` (so the change is coordinated, not backward-compatible — acceptable
since ArtMode is the only consumer).

## Layout geometry (frontend)

**Frame window:** config gives the frame PNG's transparent-window insets
`{ top, right, bottom, left }` (%). The visible window is the rectangle inside those
insets. The matte plane still fills the whole stage (behind the frame), so no seam
shows; the art/gaps are laid out **within the window**.

**Opening:** the window inset further by `matMargin` (%) on top/bottom (and, for
single, all sides) — the mat band between the frame's inner edge and the art.

**Crop policy (shared by both layouts):** for a target cell of aspect `cellAR` and an
art of aspect `artAR`, the displayed box aspect is
`clamp(cellAR, artAR*(1-2c), artAR/(1-2c))` where `c` = `cropMaxPerSide` (0.08). The
art fills the box via `object-fit: cover` (cropping ≤ c per side). The box is then
fit into the cell; if the box aspect was clamped (cell too extreme for the budget),
residual mat remains on the deficient axis. The bevel/cut hugs the box.

**Single:** cell = opening. Box aspect clamps toward the opening aspect; the painting
cover-fills the opening up to the crop cap, residual mat otherwise. One nameplate
centered on the rail.

**Diptych:** two panels at a common height `H`.
- Default `H` = opening height (height-limited). Panel display widths = boxAR·H.
- Distribute across the window width with three equal gaps (`space-evenly` within the
  window). The visible left margin, center divider, and right margin are equal.
- **Fill:** widen panels (increase box aspect toward `artAR/(1-2c)`, trimming
  top/bottom) only as needed to bring the gaps down to `matMargin`, capped at `c`.
- **Overflow:** if panels at full opening height would exceed the window width even at
  max side-crop, reduce `H` (width-limited) so they fit.
- Two nameplates on the rail, each centered at its panel's computed center-x (canvas
  coordinates).

## Config (screen YAML, under `screensaver.props`)

```yaml
screensaver:
  widget: art
  idle: 180
  showOnLoad: true
  interactive: true
  props:
    placard: true
    cropMaxPerSide: 8        # % cover-crop allowed per side (≤16%/axis)
    matMargin: 4             # % mat band inside the frame window
    frame:                   # frame PNG effective border (transparent-window insets, %)
      top: 11.9
      right: 6.5
      bottom: 11.1
      left: 7.0
```

ArtMode reads these from props with sensible defaults (so a screen that omits them
still renders).

## Frontend application

ArtMode renders `mode`:
- `single`: one window cut (cover-crop), shared matte vars, one placard.
- `diptych`: a row of two panels (`space-evenly` within the frame window), each a
  beveled cut with the shared matte's bevel colors, two placards on the rail at
  computed centers.
Matte palette applies as CSS custom properties as in v1. Frame-window insets, mat
margin, and crop cap drive the geometry. On fetch failure → black fallback (as today).
Shuffle / brightness / exit interactions unchanged; shuffle re-draws a fresh pick.

## Error handling

- No eligible art → 503 (as today).
- Portrait with no companion (degenerate) → render single.
- Per-image color/analysis failure → that panel still shows the image; matte falls back
  to the cream default (CSS var fallback).

## Testing

- **Filter/classification (adapter):** landscape → `mode: single`, 1 panel; portrait/
  square → `mode: diptych`, 2 panels; panoramic excluded.
- **Companion (adapter):** with a same-artist+credit portrait present, it is chosen over
  a same-artist-only one, over a credit-only one, over a random one (inject a
  deterministic `pick`). Companion ≠ primary; companion is portrait.
- **Shared matte (adapter):** diptych matte equals `deriveMatte(mean(avgA, avgB))`.
- **Crop math (pure helper):** `boxAspect(cellAR, artAR, c)` clamps within
  `[artAR*(1-2c), artAR/(1-2c)]`; fills (==cellAR) when within budget; clamps at the cap
  otherwise.
- **Diptych geometry (pure helper):** given two ratios, window, matMargin, crop cap →
  returns common height, per-panel box aspects, equal gap, and panel center-x's; gaps are
  equal and within the window; panels fit.
- **ArtMode (component):** renders 1 window for single / 2 for diptych; applies matte
  vars; renders the right number of placards; black fallback on failure.

## Open Items / Future

- Mixed-orientation or 3-up layouts; cross-fade on shuffle; remembering recent pairs.
