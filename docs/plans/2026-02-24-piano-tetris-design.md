# Piano Tetris — Design Document

**Date:** 2026-02-24
**Status:** Design complete, ready for implementation planning

## Overview

A Tetris game controlled by piano, launched from the existing PianoVisualizer via a unique activation key combo. The player controls Tetris piece movement and rotation by sight-reading notes on musical staves and playing them on the piano. No penalty for wrong notes — failure to match simply means loss of piece control, which impacts the Tetris board naturally.

## Architecture

### Module Structure

New module at `frontend/src/modules/Piano/PianoTetris/`:

```
PianoTetris/
├── PianoTetris.jsx          # Main layout (staves + board + keyboard)
├── PianoTetris.scss         # Styles
├── useTetrisGame.js         # State machine (piece spawning, gravity, line clears)
├── tetrisEngine.js          # Pure functions (collision, rotation, line detection)
├── useStaffMatching.js      # Matches MIDI input against target notes per staff
├── components/
│   ├── TetrisBoard.jsx      # 10x20 grid renderer
│   ├── ActionStaff.jsx      # Single staff: clef, target note, match indicator, SVG icon
│   └── TetrisOverlay.jsx    # Countdown, game over, score display
```

### Shared Dependencies

From existing Piano module:
- `useMidiSubscription` — MIDI input (activeNotes, noteHistory)
- `noteUtils.js` — note positioning for keyboard
- `PianoKeyboard` component — bottom keyboard display

## Game Registry (Refactor)

### Purpose

Replace hardcoded game mode detection in PianoVisualizer with a config-driven registry, enabling future games to be added by simply adding YAML config and registering a component.

### Config (`piano.yml`)

```yaml
games:
  rhythm:
    activation:
      notes: [30, 102]     # F#1 + F#7
      window_ms: 300
    # ...existing rhythm game config...

  tetris:
    activation:
      notes: [31, 103]     # G1 + G7
      window_ms: 300
    levels:
      - { gravity_ms: 1000, complexity: 'single', note_range: [60, 72] }
      - { gravity_ms: 800, complexity: 'single', note_range: [55, 76] }
      - { gravity_ms: 600, complexity: 'dyad', note_range: [48, 84] }
      # ...etc
```

### Registry (`gameRegistry.js`)

```js
const GAME_REGISTRY = {
  rhythm: {
    component: () => import('./components/GameOverlay'),
    hook: () => import('./useGameMode'),
    layout: 'waterfall',  // keeps waterfall, overlays on top
  },
  tetris: {
    component: () => import('./PianoTetris/PianoTetris'),
    hook: () => import('./PianoTetris/useTetrisGame'),
    layout: 'replace',    // replaces waterfall entirely
  },
};
```

### Shared Activation Hook (`useGameActivation`)

Replaces activation detection currently in `useGameMode`:
- Reads `games` config from YAML
- Watches `activeNotes` for any game's activation combo
- Returns `{ activeGameId, gameConfig, deactivate }`
- Ignores combos while another game is active
- Handles cooldown logic (currently duplicated)

### PianoVisualizer Integration

```jsx
const { activeGameId, gameConfig, deactivate } = useGameActivation(activeNotes, config);
// activeGameId: null -> waterfall, 'rhythm' -> existing game, 'tetris' -> PianoTetris
```

## Screen Layout

```
+----------------------------------------------+
|  +-------+                      +-------+    |
|  |  <-   |                      |  ->   |    |
|  | Move  |    +-----------+     | Move  |    |
|  | Left  |    |           |     | Right |    |
|  +-------+    |  TETRIS   |     +-------+    |
|               |  BOARD    |                  |
|  +-------+    |  (10x20)  |     +-------+    |
|  |  CCW  |    |           |     |  CW   |    |
|  | Rot   |    +-----------+     | Rot   |    |
|  | Left  |                      | Right |    |
|  +-------+                      +-------+    |
+----------------------------------------------+
|          PIANO KEYBOARD                      |
+----------------------------------------------+
```

- **Top row:** Move Left (left side), Move Right (right side) — spatially intuitive
- **Bottom row:** Rotate CCW (left side), Rotate CW (right side) — matches rotational direction
- **Center:** Standard 10x20 Tetris board with ghost piece and next-piece preview
- **Bottom:** PianoKeyboard component showing active notes

## State Machine

### Phases

```
IDLE -> STARTING (3-2-1-GO) -> PLAYING -> GAME_OVER -> IDLE
```

No level advancement like the rhythm game. Tetris ramps naturally via gravity speed. Musical complexity ramps independently via config.

### Game State Shape

```js
{
  phase: 'IDLE' | 'STARTING' | 'PLAYING' | 'GAME_OVER',
  board: [],           // 20x10 grid of filled cells
  currentPiece: {
    type: 'T',         // I, O, T, S, Z, J, L
    rotation: 0,       // 0-3
    x: 4, y: 0,
  },
  nextPiece: 'L',
  score: 0,
  linesCleared: 0,
  level: 0,            // drives gravity speed + musical complexity
  countdown: null,
}
```

### Gravity

- Piece drops one row on interval, starting at ~1000ms
- Speeds up every 10 lines cleared
- Lock delay: ~500ms after piece can't drop further (allows last-second moves)
- When locked, next piece spawns immediately

### Scoring (NES-style)

| Lines | Points |
|-------|--------|
| 1 (Single) | 100 x level |
| 2 (Double) | 300 x level |
| 3 (Triple) | 500 x level |
| 4 (Tetris) | 800 x level |

### Game Over

When a new piece spawns and immediately collides (board topped out). Shows overlay with final score, lines cleared, level reached. Dismisses after a few seconds back to regular visualizer.

## Staff Matching System

### ActionStaff Component

Each staff displays:
- **SVG icon** above the staff showing the action (arrow for move, curved arrow for rotate)
- **5-line musical staff** with appropriate clef (bass/treble based on note range)
- **Target noteheads:** solid noteheads at correct staff position, always visible
- **Match indicator:** noteheads glow green when player plays matching pitch
- **Icon pulses bright** when action fires; stays lit during hold-to-repeat

### useStaffMatching Hook

Manages 4 action channels:
- Each has `targetPitches` (1-3 notes depending on complexity level)
- Compares `activeNotes` against each staff's target
- When all pitches in a target are held, action fires
- Hold-to-repeat: 200ms initial delay, then 100ms repeat interval
- On release, repeat stops immediately

### Target Rotation

Configurable per difficulty:
- `piece` — targets change when a new Tetris piece spawns
- `timer` — targets change on interval (`target_change_ms`)
- `match` — targets change after each successful match

4 targets are randomly selected from `note_range`, no two staves share the same note/chord.

## Difficulty Progression

All axes are configurable per level in YAML:

| Axis | Easy | Hard |
|------|------|------|
| Note complexity | Single notes, small range (C4-C5) | Triads, wide range |
| Target rotation | Change on new piece only | Change on timer mid-piece |
| Tetris gravity | ~1000ms per row | Classic NES speed ramp |
| Number of actions | Could start with 2 (just L/R) | All 4 actions |

Level increments every 10 lines cleared. Each level increase:
1. Gravity speeds up
2. Musical complexity can ramp per config (wider range, dyads -> triads)

## Exit Behavior

- Game over overlay dismisses after a few seconds -> returns to regular visualizer
- Re-pressing activation combo during play -> exits immediately to visualizer
- Inactivity timer in PianoVisualizer pauses during Tetris (same as rhythm game)
