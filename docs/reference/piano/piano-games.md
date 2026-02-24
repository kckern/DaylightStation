# Piano Games Architecture

Reference for the DaylightStation piano game system — MIDI-driven games layered on the piano visualizer. Currently supports Tetris (block-stacking controlled by musical note matching).

---

## System Overview

The piano game system lets users play games using a MIDI keyboard. Players press specific notes (displayed as music notation on staves) to trigger game actions like moving or rotating pieces. A shared activation layer detects combo keypresses to launch games, and a config-driven level system controls difficulty progression.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MIDI INPUT                              │
│  ┌───────────┐                                              │
│  │ USB MIDI   │──── useMidiSubscription() ──┐               │
│  │ Keyboard   │     activeNotes: Map        │               │
│  └───────────┘                              │               │
└─────────────────────────────────────────────┼───────────────┘
                                              │
┌─────────────────────────────────────────────┼───────────────┐
│                  PIANO VISUALIZER            │               │
│                                              ▼               │
│  ┌──────────────────────────────────────────────┐           │
│  │ useGameActivation(activeNotes, gamesConfig)  │           │
│  │  - Combo detection (e.g. G1+G7)              │           │
│  │  - URL auto-activate (/office/piano/:gameId) │           │
│  │  - Dev shortcut (backtick key)               │           │
│  └──────────────┬───────────────────────────────┘           │
│                 │ activeGameId                               │
│                 ▼                                            │
│  ┌─────────────────────────┐                                │
│  │ if tetris → PianoTetris │                                │
│  │ if rhythm → GameOverlay │                                │
│  │ else → NoteWaterfall    │                                │
│  └─────────────────────────┘                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Game Activation

**Hook:** `useGameActivation.js`

Games are activated by holding a chord of MIDI notes simultaneously within a time window.

| Mechanism | Details |
|-----------|---------|
| Combo detection | All notes in `activation.notes` held within `window_ms` |
| Toggle | Same combo re-pressed while active → deactivate |
| Cooldown | 2-second cooldown prevents rapid re-triggering |
| URL activation | `/office/piano/:gameId` auto-activates on mount |
| Dev shortcut | Backtick key cycles through games (localhost only) |

**Config (piano.yml):**
```yaml
games:
  tetris:
    activation:
      notes: [31, 103]    # G1 + G7
      window_ms: 300
```

**Route setup (main.jsx):**
```
/office/piano/:gameId  →  OfficeApp(initialGame) → PianoVisualizer → useGameActivation
/office/piano          →  same, no auto-activate
```

---

## Piano Tetris

### Component Tree

```
PianoTetris
├── ActionStaff ×6          (musical notation for each action)
│   ├── lines-svg           (staff lines, stretched full width)
│   └── notation-svg        (clef + note, proportionally scaled)
├── TetrisBoard             (20×10 grid with current/ghost/locked pieces)
├── TetrisOverlay           (countdown 3-2-1-GO, game over screen)
└── PianoKeyboard           (visual keyboard with highlighted targets)
```

### File Inventory

| File | Purpose |
|------|---------|
| `PianoTetris/PianoTetris.jsx` | Main layout: 6 staves + board + keyboard |
| `PianoTetris/PianoTetris.scss` | Flex layout, score/lines display |
| `PianoTetris/useTetrisGame.js` | Game state machine, gravity, locking, levels |
| `PianoTetris/tetrisEngine.js` | Pure functions: board ops, collision, rotation, scoring |
| `PianoTetris/useStaffMatching.js` | MIDI → action matching with hold-to-repeat |
| `PianoTetris/components/ActionStaff.jsx` | SVG staff with clef, target note, ghost notes |
| `PianoTetris/components/TetrisBoard.jsx` | Grid renderer with piece colors |
| `PianoTetris/components/TetrisOverlay.jsx` | Countdown and game-over screens |

### Game State Machine

```
IDLE ──[startGame()]──▶ STARTING ──[3-2-1-GO]──▶ PLAYING ──[blocked spawn]──▶ GAME_OVER
 ▲                                                                               │
 └───────────────────────────────[5s display]─────────────────────────────────────┘
```

**`useTetrisGame` returns:**
- `phase` — `IDLE | STARTING | PLAYING | GAME_OVER`
- `board` — 20×10 grid of `null | { type }` cells
- `currentPiece`, `ghostPiece`, `nextPiece`, `heldPiece`
- `score`, `linesCleared`, `level`
- `targets` — `{ moveLeft: [60], moveRight: [64], ... }`
- `matchedActions` — `Set<string>` of currently matched actions
- `startGame()`, `deactivate()`

### 6 Actions

| Action | Icon | Position | Description |
|--------|------|----------|-------------|
| moveLeft | CaretLeftFilled | Left column | Move piece left |
| rotateCCW | Rotate | Left column | Rotate counter-clockwise |
| hold | Replace | Left column | Swap piece with hold slot |
| moveRight | CaretRightFilled | Right column | Move piece right |
| rotateCW | RotateClockwise | Right column | Rotate clockwise |
| hardDrop | ArrowBigDownLine | Right column | Instant drop |

### Staff Matching

**Hook:** `useStaffMatching.js`

Each action has target pitches. When the player holds all target pitches simultaneously, the action fires.

- **Immediate fire** on first match
- **Hold-to-repeat** for movement/rotation: 200ms initial delay, then 100ms repeat
- **Single-fire** for hardDrop and hold (no repeat)
- **Release** stops repeat immediately

**Target generation (`generateTargets`):**
- Shuffles notes within the level's `note_range`
- Assigns 1-3 notes per action based on `complexity` (single/dyad/triad)
- Respects `white_keys_only` filter

### Ghost Notes

When the player presses any MIDI note, a faint (50% opacity) note head appears on all 6 staves at the corresponding staff position — for orientation and reference.

- Notes matching a target pitch are not duplicated (only the solid target note shows)
- Notes outside the visible staff range (position -3 to 11) are ignored
- Ghost notes are note heads only (no stem)

### Tetris Engine

**File:** `tetrisEngine.js` — all pure functions, fully tested.

| Function | Purpose |
|----------|---------|
| `createBoard()` | Empty 20×10 grid |
| `movePiece(board, piece, dx, dy)` | Move with collision check |
| `rotatePiece(board, piece, dir)` | Rotate with wall kicks (`[0, +1, -1, +2, -2]`) |
| `hardDrop(board, piece)` | Instant drop, returns distance |
| `getGhostPosition(board, piece)` | Drop preview position |
| `lockPiece(board, piece)` | Write piece to board |
| `clearLines(board)` | Remove full rows, return count |
| `spawnPiece(board, type)` | Spawn at top-center (null = game over) |
| `generateBag()` | Fisher-Yates shuffle of 7 piece types |

**Scoring (NES-style):**
| Lines | Points |
|-------|--------|
| 1 (Single) | 100 × (level + 1) |
| 2 (Double) | 300 × (level + 1) |
| 3 (Triple) | 500 × (level + 1) |
| 4 (Tetris) | 800 × (level + 1) |
| Hard drop | +2 per cell dropped |

**Piece colors (HSL hue):**
I=180 (cyan), O=50 (yellow), T=280 (purple), S=120 (green), Z=0 (red), J=220 (blue), L=30 (orange)

### Difficulty Levels

10 levels configured in `piano.yml`, organized in 3 complexity tiers. Speed resets when a new tier is introduced to give practice time.

| Levels | Complexity | Notes/Action | Speed | Range | Keys |
|--------|-----------|-------------|-------|-------|------|
| 0-2 | Single | 1 | 1200→800ms | C4-C5 | White only |
| 3-5 | Dyad | 2 | 700→500ms | C4-C5 → wider | White → chromatic |
| 6-9 | Triad | 3 | 500→200ms | C3-C6 | Chromatic |

**Per-level config keys:**
- `gravity_ms` — interval between gravity ticks
- `complexity` — `single | dyad | triad`
- `note_range` — `[low, high]` MIDI range
- `white_keys_only` — filter sharps/flats
- `target_rotation` — `piece` (change on spawn) | `timer` (change on interval)
- `target_change_ms` — interval for timer-based target changes

Level advances every 10 lines cleared.

### ActionStaff Rendering

Two-layer SVG approach for full-width staff lines:

1. **Lines SVG** (`preserveAspectRatio="none"`) — 5 staff lines stretch edge-to-edge
2. **Notation SVG** (`preserveAspectRatio="xMidYMid meet"`) — clef + note scale proportionally

**Clef sizing:** Dynamic measurement via `getBBox()` — render at fontSize=200, measure bounding box, compute `translate() scale()` transform to fit target area. Cross-platform consistent (macOS Chrome, Linux Firefox, Android WebView).

**Clef selection:** Treble for notes >= C4, bass for notes < C4.

### Testing

| File | Framework | Coverage |
|------|-----------|----------|
| `tetrisEngine.test.js` | Vitest | 70+ tests: board, collision, rotation, scoring, bags |
| `useStaffMatching.test.js` | Vitest | Target generation, match detection, repeat timing |

**Debug hook (localhost):** `window.__TETRIS_DEBUG__` exposes full game state for inspection.

---

## Shared Utilities

| File | Exports | Used By |
|------|---------|---------|
| `noteUtils.js` | `getNoteName()`, `isWhiteKey()`, `getNoteHue()` | ActionStaff, PianoKeyboard |
| `gameEngine.js` | `isActivationComboHeld()` | useGameActivation |
| `gameRegistry.js` | Game ID → component/hook mapping | PianoVisualizer |
| `useMidiSubscription.js` | `activeNotes` Map, `noteHistory`, `sustainPedal` | PianoVisualizer |

---

## Data Flow Summary

```
MIDI Keyboard
  │
  ▼
useMidiSubscription → activeNotes: Map<note, {velocity, timestamp}>
  │
  ├──▶ useGameActivation → activeGameId ('tetris' | null)
  │
  ├──▶ useTetrisGame
  │      ├──▶ useStaffMatching → matchedActions: Set<string>
  │      │     └── fires onAction('moveLeft') etc.
  │      ├──▶ tetrisEngine (pure functions)
  │      └── returns game state
  │
  ├──▶ PianoTetris (layout)
  │      ├── ActionStaff ×6 (targets + ghost notes from activeNotes)
  │      ├── TetrisBoard (board + currentPiece + ghostPiece)
  │      ├── TetrisOverlay (countdown / game over)
  │      └── PianoKeyboard (visual reference)
  │
  └──▶ PianoKeyboard (highlights active + target notes)
```
