# Game Boy bezel — hotspots & overlays

**Date:** 2026-06-25
**Status:** Implemented (frontend module + backend passthrough + manifest)
**Scope:** Turn the static `bezel.png` chrome into a functional control surface
(clickable engravings) plus a stage for environmental UI (HR, RPM, player,
credit, game-state meters).

## Concept

The emulator already renders full-bleed layers over the bezel art (`chrome`,
`mount`, `shader`). Two new coordinate-anchored concepts sit on top:

- **Hotspots** — interactive regions over engravings (speaker → volume, stereo
  text → mute, START → pause, logo → exit, A → save-state, battery LED →
  toast). Pointer/tap activation.
- **Overlays** — read-only info chips staged in free bezel margins, bound to a
  data `source`.

Both use the **same `%`-region convention as `presentation.screen`**
(`{ x, y, width, height }`, x/y = top-left, as % of the 1920×1080 bezel).

## Verified hotspot coordinates

Each region was guessed, cropped against a labeled 100px grid, and corrected via
vision-agent critique until pixel-tight. (Coords are % of 1920×1080.)

| id | x | y | width | height | action |
|---|---|---|---|---|---|
| speaker | 79.17 | 64.81 | 11.98 | 22.22 | `volume` |
| dot_matrix_text | 39.58 | 7.22 | 23.54 | 3.15 | `mute` |
| start | 3.75 | 80.74 | 6.04 | 3.33 | `pause` |
| logo | 20.42 | 88.43 | 32.60 | 5.28 | `exit` |
| a_button | 89.06 | 35.19 | 5.47 | 9.72 | `save_state` |
| battery_led | 19.58 | 31.76 | 2.29 | 4.07 | `do: { toast }` |
| b_button | 83.23 | 42.59 | 5.42 | 9.72 | — (decorative) |
| dpad | 2.34 | 35.65 | 10.68 | 16.67 | — |
| select | 3.44 | 71.76 | 5.94 | 3.06 | — |
| stripe_left | 29.17 | 7.41 | 6.88 | 4.26 | — |
| stripe_right | 64.17 | 7.41 | 11.61 | 4.26 | — |

**No headphone jack** exists on this front-face art (the DMG jack is on the
bottom edge, off-frame), so volume maps to the speaker grille and mute to the
stereo-sound print.

## Overlay zones (provisional — free body plastic, not engravings)

| id | x | y | width | height | source | format |
|---|---|---|---|---|---|---|
| rpm | 15.63 | 11.11 | 11.72 | 16.67 | `fitness.cadence` | rpm |
| hr | 15.10 | 43.52 | 12.24 | 15.74 | `fitness.heart_rate` | bpm |
| player | 71.77 | 12.04 | 12.19 | 18.52 | `session.current_player` | player_card |
| coins | 71.77 | 51.85 | 12.19 | 12.04 | `governance.credit` | coins |

## Schema (manifest `presentation` block)

```yaml
presentation:
  screen: { x, y, width, height }      # existing
  hotspots:
    - id: speaker
      region: { x, y, width, height }
      action: volume                   # volume|mute|pause|save_state|exit
    - id: battery_led
      region: { ... }
      do: { toast: "..." }             # OR a bindings-vocab block
  overlays:
    - id: hr
      region: { ... }
      source: fitness.heart_rate       # state.*|governance.*|<overlayData key>
      format: bpm
```

**Scope:** per-system, with **per-game override** that deep-merges by `id`
(mirrors how `governance` already merges). Pokémon Red adds a `badges` overlay
reading the existing `states.badges` semantic map.

## Wiring

**Backend** (`3_applications/emulator/`)
- `mergePresentation.mjs` *(new)* — scalars game-over-system; `hotspots`/
  `overlays` merge by `id` (deep-merged `region`).
- `loadEmulatorConfig.mjs` — attaches `presentation = mergePresentation(system, game)` per game.
- `EmulatorCatalog.resolveGameRules` — passes `presentation` through.
- `4_api/v1/routers/emulator.mjs` — `/library` returns `presentation`.

**Frontend** (`modules/Emulator/`)
- `core/hotspotController.js` *(new)* — pure controller: `activate(hotspot)` →
  built-in verbs (volume step / mute / pause / save_state / exit) or `do:` via
  `runActions`; owns volume/mute/paused state, emits `onChange`.
- `core/resolveOverlayValue.js` *(new)* — `resolveOverlayValue(source, ctx)` +
  `formatOverlayValue(format, value)`.
- `ui/regionStyle.js`, `ui/HotspotLayer.jsx`, `ui/OverlayLayer.jsx` *(new)*.
- `core/EmulatorSession.js` — adds `runActions(do, ctx)` reusing the binding
  handler map.
- `EmulatorConsole.jsx` — accepts `presentation` + `overlayData`; builds the
  controller from runtime; renders the two layers; polls `getGameState()`.
- `EmulatorConsole.scss` — `.emu-hotspot` (transparent, hover/focus affordance)
  + `.emu-overlay` (Roboto Condensed chip).
- `Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx` — forwards `presentation`.

## Decisions

- **Activation:** pointer/tap (regions are also keyboard-focusable, so a
  focus-capable remote works for free).
- **Volume:** the speaker hotspot steps the **mixer** game bus (0.25 wrap), not
  `engine.setVolume` directly, so it cooperates with cue ducking.
- **`do:` blocks** reuse the per-game bindings vocab via `session.runActions`.
- **Decoupling preserved:** overlay data arrives via the injected `overlayData`
  bag + `state.*`/`governance.*` resolved from the session/gate. The console
  imports nothing fitness-specific.

## Open / future

- `save_state` routes to an injected `actionHandlers.saveState` (no verified
  EmulatorJS save API wired yet).
- `governance.credit` overlay needs the gate's `getStatus()` to surface
  `credit` (the fitness credit gate should include it).
- `state.*` overlays depend on the `states`/`bindings` → frontend `game.states`
  flow, which uses `watches`/`hooks` naming in the catalog — a separate
  pre-existing gap.
- Overlay placements are provisional; nudge against the live render.
