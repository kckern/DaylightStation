# Side-Scroller Piano Game — Design

## Overview

A Chrome-dino-style endless runner controlled by piano notes. A stick figure runs across a scrolling ground, dodging low blocks (jump) and high bars (duck). Two ActionStaffs on the right side show which note/chord triggers each action. Target notes rotate on each successful dodge. Difficulty progresses through note complexity first (white keys → sharps → bass clef → dyads → triads), then speed, with a sprint finale.

## Architecture

### File Structure

**New files:**
- `SideScrollerGame/useSideScrollerGame.js` — game state machine hook
- `SideScrollerGame/sideScrollerEngine.js` — pure functions (obstacle spawning, collision, scoring)
- `SideScrollerGame/components/RunnerCanvas.jsx` — scrolling world + stick figure
- `SideScrollerGame/components/SideScrollerOverlay.jsx` — countdown / game over

**Modified files:**
- `SideScrollerGame/SideScrollerGame.jsx` — replace placeholder with real layout
- `SideScrollerGame/SideScrollerGame.scss` — full styles
- `data/household/config/piano.yml` — add level configs under `side-scroller`

**Shared (no changes needed):**
- `ActionStaff` — shows jump/duck target notes
- `PianoKeyboard` — bottom keyboard display
- `useAutoGameLifecycle` — phase management
- `useStaffMatching` / `generateTargets` — works with any action list, pass `['jump', 'duck']`
- `noteUtils.js` — `computeKeyboardRange`, `buildNotePool`, `shuffle`

### Component Hierarchy

```
SideScrollerGame
├── Health bar (far left, Mega Man-style, 28 notches)
├── RunnerCanvas (game world, fills left side)
│   ├── Scrolling ground
│   ├── Stick figure (running / jumping / ducking)
│   └── Obstacles (low blocks, high bars)
├── ActionStaff x2 (stacked right: jump top, duck bottom)
├── PianoKeyboard (bottom)
└── SideScrollerOverlay (countdown / game over)
```

## Game Mechanics

### World & Scrolling

- Ground scrolls left at `scroll_speed` (per level config)
- Stick figure stays at fixed X position (~15-20% from left)
- Obstacles spawn off-screen right and scroll left
- Game loop uses `requestAnimationFrame` for smooth scrolling
- Engine tracks world position as a float: `worldPos += scroll_speed * dt`
- Obstacles removed once past left edge

### Obstacle Types

- **Low blocks:** Filled rectangles on the ground line. Height = ~60% of standing figure. Must jump to avoid.
- **High bars:** Horizontal rectangles at head height. Bottom edge at ~50% of figure height. Must duck to avoid.
- Spawned at `obstacle_interval_ms` intervals. Type chosen randomly (50/50).

### Player States

- **Running:** Default. Two-frame leg alternation (~200ms). Normal hitbox.
- **Jumping:** Parabolic Y arc over `jump_duration_ms` (500ms). Can't double-jump. Clears low blocks.
- **Ducking:** Crouches to half height. Stays ducked as long as the note is held (sustained via `useStaffMatching`). Returns to running on release. Clears high bars.

### Collision & Health

- Axis-aligned bounding box collision
- **Health:** 28 notches (Mega Man-style, reuse Space Invaders CSS pattern)
- **Damage:** 2 notches per obstacle hit
- **Healing:** +1 notch per obstacle successfully dodged
- **Invincibility:** 1000ms flash after a hit (no double-damage from same obstacle)
- **Game over:** Health reaches 0

### Scoring

- Distance-based: score ticks up continuously while alive
- Bonus points per obstacle dodged
- Level advances at config-driven `score_to_advance` threshold

### Target Rotation

- Two actions: `jump` and `duck`
- After each successful dodge, `generateTargets(['jump', 'duck'], noteRange, complexity, whiteKeysOnly)` assigns new notes
- `useStaffMatching` handles match detection and fires `jump`/`duck` callbacks

## State Machine

```
IDLE → STARTING (countdown 3-2-1-GO) → PLAYING → GAME_OVER → IDLE
```

Identical to Tetris. `useAutoGameLifecycle` handles auto-start on mount and auto-deactivate when phase returns to IDLE.

## Visual Style

- **Stick figure:** SVG `<line>` and `<circle>` elements. Monochrome, matches ActionStaff aesthetic.
- **Ground:** Horizontal line with dashed pattern, `background-position` animated for scroll effect.
- **Obstacles:** Simple filled rectangles. Low blocks darker, high bars slightly lighter for distinction.
- **Health bar:** Vertical strip on far left. Gold active notches, red when <=25% health.
- **Score:** Top-left numeric display. Level name below it.
- **Overlay:** Centered text with backdrop blur (same pattern as TetrisOverlay).

## Level Config (piano.yml)

```yaml
side-scroller:
  activation:
    notes: [33, 105]
    window_ms: 300
  health: 28
  damage_per_hit: 2
  heal_per_dodge: 1
  invincibility_ms: 1000
  jump_duration_ms: 500
  levels:
    # --- White keys, treble clef (gentle intro) ---
    - name: "Easy Run"
      scroll_speed: 2
      obstacle_interval_ms: 3000
      note_range: [60, 72]
      complexity: single
      white_keys_only: true
      target_rotation: dodge
      score_to_advance: 400

    - name: "Warming Up"
      scroll_speed: 2.5
      obstacle_interval_ms: 2500
      note_range: [60, 72]
      complexity: single
      white_keys_only: true
      target_rotation: dodge
      score_to_advance: 600

    # --- Add sharps/flats ---
    - name: "Sharp Turn"
      scroll_speed: 2.5
      obstacle_interval_ms: 2500
      note_range: [60, 72]
      complexity: single
      target_rotation: dodge
      score_to_advance: 700

    # --- Bass clef ---
    - name: "Low Road"
      scroll_speed: 3
      obstacle_interval_ms: 2200
      note_range: [48, 60]
      complexity: single
      target_rotation: dodge
      score_to_advance: 800

    # --- Full range ---
    - name: "Wide Open"
      scroll_speed: 3
      obstacle_interval_ms: 2000
      note_range: [48, 84]
      complexity: single
      target_rotation: dodge
      score_to_advance: 900

    # --- Dyads ---
    - name: "Double Up"
      scroll_speed: 3
      obstacle_interval_ms: 2500
      note_range: [60, 72]
      complexity: dyad
      white_keys_only: true
      target_rotation: dodge
      score_to_advance: 1000

    - name: "Dyad Dash"
      scroll_speed: 3.5
      obstacle_interval_ms: 2200
      note_range: [48, 84]
      complexity: dyad
      target_rotation: dodge
      score_to_advance: 1200

    # --- Triads ---
    - name: "Triad Trail"
      scroll_speed: 3.5
      obstacle_interval_ms: 2500
      note_range: [60, 72]
      complexity: triad
      white_keys_only: true
      target_rotation: dodge
      score_to_advance: 1400

    - name: "Full Chord"
      scroll_speed: 4
      obstacle_interval_ms: 2000
      note_range: [48, 84]
      complexity: triad
      target_rotation: dodge
      score_to_advance: 1800

    # --- Speed finale ---
    - name: "Sprint!"
      scroll_speed: 7
      obstacle_interval_ms: 1000
      note_range: [48, 84]
      complexity: triad
      target_rotation: dodge
      score_to_advance: 3000
```

## Engine (Pure Functions)

`sideScrollerEngine.js` exports:

- `createInitialWorld()` — returns `{ obstacles: [], worldPos: 0, score: 0, health, playerState: 'running', playerY: 0, jumpT: 0, invincibleUntil: 0, dodgeCount: 0 }`
- `spawnObstacle(world, type)` — adds obstacle at right edge with bounding box
- `tickWorld(world, dt, scrollSpeed)` — advances `worldPos`, moves obstacles left, increments score, removes off-screen obstacles
- `applyJump(world, jumpDurationMs)` — initiates jump arc if on ground
- `applyDuck(world, ducking)` — sets/unsets duck state, adjusts hitbox
- `updateJump(world, dt, jumpDurationMs)` — updates Y position along parabolic arc
- `checkCollisions(world)` — returns list of colliding obstacles
- `applyDamage(world, damagePerHit, invincibilityMs, now)` — reduces health, sets invincibility timer
- `applyHeal(world, healPerDodge)` — +1 health when obstacle dodged
- `evaluateLevel(world, levelConfig)` — returns `'advance'` | `'fail'` | `null`
