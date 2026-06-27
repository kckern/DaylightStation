# Side-Scroller Theme Config — Design

**Date:** 2026-06-24
**Module:** `frontend/src/modules/Piano/SideScrollerGame/`

## Goal

Decouple the piano-controlled side-scroller's *visuals and sound* from the code.
Make the engine/renderer generic and move all assets + mappings into the
per-game config (`config.games['side-scroller'].theme`), which lives in the
household piano YAML in the **data dir** — not the repo. Swapping characters
(Mega Man → Sonic) becomes pure YAML pointing at data-dir assets.

Today only gameplay numbers (levels, health, note_range, scroll_speed, …) are
config-driven. The sprite URL, the 5×6 grid, the pose→frame map, the run-cycle
length, the display size, the obstacle gradients, and the background/ground
styling are all hardcoded in `RunnerCanvas.jsx` / `RunnerCanvas.scss`. There is
also a redundant committed copy of `megaman-sprites.png` inside the module.

## Scope

**Full theme pack** — one swappable visual+audio bundle: player sprite,
obstacle skins, background, ground, and sound effects. Every piece falls back to
a built-in default that reproduces today's exact look, so an absent/empty theme
changes nothing.

## Config Schema

New optional `theme` block under `games['side-scroller']`:

```yaml
games:
  side-scroller:
    # ...existing gameplay config (levels, health, note_range, …) unchanged
    theme:
      player:
        src: /api/v1/static/img/sprites/megaman-sprites.png
        grid:        { cols: 5, rows: 6 }   # → background-size, cell math
        displaySize: 144                     # px (or { width, height })
        frames:                              # pose → [col,row] (0-indexed)
          stand: [0, 0]
          jump:  [4, 0]
          duck:  [0, 3]
          hit:   [2, 3]
          run:   [[0,1],[1,1],[2,1],[3,1]]   # nested array = anim cycle
      obstacles:
        low:  { src: /api/v1/static/img/sprites/spike.png }      # image skin…
        high: { fill: ["#3366cc","#1a3399"], border: "#6699ff" } # …or CSS fallback
      background: { src: null, color: "linear-gradient(...)" }   # img or gradient
      ground:     { color: "rgba(100,200,255,0.5)" }
      sounds:                                # all null until assets land
        jump:     null   # → /api/v1/static/audio/sfx/jump.wav
        duck:     null
        hit:      null   # collision
        dodge:    null   # successful dodge / heal
        levelup:  null
        gameover: null
        start:    null
```

### Schema rules

- **Pose keys are fixed** (`stand/run/jump/duck/hit`) — the engine needs those
  semantics; the theme only maps each pose to cell(s). A nested array for `run`
  is the animation cycle (length no longer hardcoded to 4).
- **Per-piece fallback** — any obstacle/background/ground piece can be an image
  (`src`) *or* the procedural CSS (`fill`/`border`/`color`). Omit → default.
- **Frame → `background-position`** is computed:
  `col/(cols-1)*100%`, `row/(rows-1)*100%` (matches today's 0/25/50/75/100 ×
  0/20/40/60/80/100). Guard `cols/rows === 1` → `0% 0%`.
- **Sounds** default to all-null; a null/missing path is a silent no-op.

## Code Architecture

### New: `sideScrollerTheme.js`

Single home for defaults + resolution.

- `DEFAULT_THEME` — encodes today's exact look (megaman URL, 5×6 grid, current
  frame map, 144px, obstacle gradients, bg gradient, ground color) and all-null
  sounds. This is the "generic code, defaults in one place" anchor.
- `resolveTheme(gameConfig)` — deep-merges `gameConfig.theme` over
  `DEFAULT_THEME` per-piece (override just `player` and keep default obstacles).
- `frameToPosition([col,row], grid)` — pure helper → `background-position`
  string; guards single-cell grids.
- `getSpriteFrame(state, worldPos, {idle, invincible}, theme)` — moved out of
  RunnerCanvas, now generic; for `run` cycles `worldPos*32 % runFrames.length`.

### New: `sideScrollerSounds.js` + `useSideScrollerSfx(sounds)`

- Preloads an `HTMLAudioElement` per non-null path; clones-on-play for
  overlapping triggers; wraps `play()` in `.catch()` →
  `logger.warn('side-scroller.sfx-blocked', …)`.
- Null path → instant no-op, no element created.
- Returns a stable `playSfx(name)`.

### `RunnerCanvas.jsx` — pure renderer of the resolved theme

- Player: inline `backgroundImage`, `backgroundPosition` (from frame),
  `backgroundSize` (`cols*100% rows*100%`), width/height from `displaySize`.
- Obstacles: `theme.obstacles[type].src` → image background; else inline
  `fill`/`border` (CSS fallback). The `--low`/`--high` color SCSS rules go away.
- Background/ground: inline from theme.

### `SCSS`

Strip hardcoded visual values (`background-size: 500% 600%`, `width/height:
144px`, obstacle gradient colors, canvas bg gradient, ground color). Keep
structure only (positioning, z-index, `image-rendering: pixelated`).

### `useSideScrollerGame.js`

- Resolve theme once via `useMemo`; thread `theme` to `RunnerCanvas`.
- Call `playSfx(...)` at the **existing event log points**:
  `side-scroller.action` → `jump`/`duck`, `.collision` → `hit`, `.heal` →
  `dodge`, `.level-advance` → `levelup`, `.game-over` → `gameover`,
  `.game-started` → `start`. No new state machine.

### Asset cleanup

Move the committed `megaman-sprites.png` out of the module to `_deleteme/`
(redundant; the default theme points at the data-dir `/api/v1/static/...` copy).

## Autoplay Caveat

The Piano kiosk already produces audio (synth voices), so an AudioContext is
live — but `HTMLAudioElement.play()` is gated separately. All sound paths
default to null, so this is moot today. When real assets are added, verify
playback on the actual kiosk and add a one-time unlock-on-first-key only if
needed (per the fitness audio-cue lesson, `reference_fitness_audio_cue_playback`).

## Testing

- `sideScrollerTheme.test.js`: `frameToPosition` math + single-cell edge case;
  `resolveTheme` per-piece merge/fallback; `getSpriteFrame` pose selection +
  run-cycle length.
- `sideScrollerSounds.test.js`: `playSfx` null→no-op, non-null→attempts play,
  unknown name→no-op.
- Existing `sideScrollerEngine.test.js` stays green (no engine logic touched).

## Net Result

Zero behavior change with no theme configured. Swapping in a new character
(sprite + sounds) is pure YAML pointing at data-dir assets — nothing in the repo.
