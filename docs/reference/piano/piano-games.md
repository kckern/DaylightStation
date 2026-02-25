# Piano Games Architecture

Reference for the DaylightStation piano game system — MIDI-driven games layered on the piano visualizer. Currently supports three game modes: Rhythm (falling-note accuracy game with invaders/hero modes), Tetris (block-stacking controlled by musical note matching), and Flashcards (untimed note-reading trainer).

---

## System Overview

The piano game system lets users play games using a MIDI keyboard. Players press specific notes (displayed as music notation on staves or as falling note bars) to trigger game actions. A shared activation layer detects combo keypresses to launch games, and a config-driven level system controls difficulty progression.

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
│  usePianoConfig() → gamesConfig             │               │
│  useSessionTracking() → sessionDuration     │               │
│  useInactivityTimer() → countdown/close     │               │
│                                              ▼               │
│  ┌──────────────────────────────────────────────┐           │
│  │ useGameActivation(activeNotes, gamesConfig)  │           │
│  │  - Combo detection (e.g. G1+G7)              │           │
│  │  - URL auto-activate (/office/piano/:gameId) │           │
│  │  - Dev shortcut (backtick key)               │           │
│  └──────────────┬───────────────────────────────┘           │
│                 │ activeGameId                               │
│                 ▼                                            │
│  ┌───────────────────────────────────┐                      │
│  │ if rhythm     → RhythmOverlay     │  (waterfall layout)  │
│  │ if tetris     → PianoTetris       │  (replace layout)    │
│  │ if flashcards → PianoFlashcards   │  (replace layout)    │
│  │ else          → NoteWaterfall     │                      │
│  └───────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Game Activation

**Hook:** `useGameActivation.js`

All games (including rhythm) use `useGameActivation` for activation. Games are activated by holding a chord of MIDI notes simultaneously within a time window.

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
  rhythm:
    activation:
      notes: [30, 102]    # F#1 + F#7
      window_ms: 300
  tetris:
    activation:
      notes: [31, 103]    # G1 + G7
      window_ms: 300
  flashcards:
    activation:
      notes: [29, 101]    # F1 + F7
      window_ms: 300
```

**Route setup (main.jsx):**
```
/office/piano/:gameId  →  OfficeApp(initialGame) → PianoVisualizer → useGameActivation
/office/piano          →  same, no auto-activate
```

---

## PianoVisualizer (Layout Compositor)

**File:** `PianoVisualizer.jsx`

PianoVisualizer is a pure layout composition component. It does not contain game logic directly. Instead, it delegates to extracted hooks for config, session tracking, inactivity detection, and game activation.

**Hook composition:**
- `usePianoConfig()` — loads device/app config, fires HA scripts on open/close
- `useMidiSubscription()` — MIDI input (activeNotes, noteHistory, sustainPedal)
- `useGameActivation()` — detects combo presses, returns `activeGameId`
- `useRhythmGame()` — rhythm game state (only active when rhythm is selected)
- `useInactivityTimer()` — grace period + countdown → auto-close
- `useSessionTracking()` — session duration timer

**Rendering modes:**
- **No game active:** Waterfall visualization + chord staff + keyboard + session timer
- **Rhythm game:** Waterfall + falling notes + health meter + RhythmOverlay + keyboard
- **Fullscreen game (tetris/flashcards):** Lazy-loaded via `gameRegistry.js` LazyComponent, rendered in a fullscreen overlay. Receives `activeNotes`, `gameConfig`, and `onDeactivate` props.

---

## Game Registry

**File:** `gameRegistry.js`

Maps game IDs to their component loaders, layout modes, and lazy React components.

```js
{
  rhythm:     { component, hook, layout: 'waterfall' },
  tetris:     { component, hook, layout: 'replace', LazyComponent },
  flashcards: { component, hook, layout: 'replace', LazyComponent },
}
```

**Layout modes:**
- `waterfall` — game overlays on top of the existing waterfall view (rhythm)
- `replace` — game takes over the entire PianoVisualizer viewport (tetris, flashcards)

**Fullscreen games** (layout: `replace`) have a `LazyComponent` entry — a `React.lazy()` wrapper used by PianoVisualizer to render them inside a `<Suspense>` boundary.

**Config prop naming:** All fullscreen games receive their config as `gameConfig` (not game-specific names like `tetrisConfig`). PianoVisualizer passes `gamesConfig[activeGameId]` as the `gameConfig` prop.

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
| `PianoTetris/components/TetrisBoard.jsx` | Grid renderer with piece colors |
| `PianoTetris/components/TetrisBoard.scss` | Board styles |
| `PianoTetris/components/TetrisOverlay.jsx` | Countdown and game-over screens |
| `PianoTetris/components/TetrisOverlay.scss` | Overlay styles |

### Game State Machine

```
IDLE ──[startGame()]──▶ STARTING ──[3-2-1-GO]──▶ PLAYING ──[blocked spawn]──▶ GAME_OVER
 ▲                                                                               │
 └───────────────────────────────[5s display]─────────────────────────────────────┘
```

PianoTetris uses `useAutoGameLifecycle` for mount auto-start and auto-deactivate on game-over.

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

10 levels configured in `piano.yml` under `games.tetris.levels`, organized in 3 complexity tiers. Speed resets when a new tier is introduced to give practice time.

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

## Piano Flashcards

Untimed note-reading trainer. Shows notes on a staff; player presses the matching MIDI key(s). Progressive difficulty mirrors the Tetris level structure.

### Component Tree

```
PianoFlashcards
├── ActionStaff            (shared — large centered card showing target note(s))
├── AttemptHistory         (green/red dots + accuracy %)
└── PianoKeyboard          (visual keyboard with highlighted targets)
```

### File Inventory

| File | Purpose |
|------|---------|
| `PianoFlashcards/PianoFlashcards.jsx` | Main layout: 3-column (stats | card | history) + keyboard |
| `PianoFlashcards/PianoFlashcards.scss` | Layout styles and animations |
| `PianoFlashcards/useFlashcardGame.js` | Game state machine: phase, score, level, card lifecycle |
| `PianoFlashcards/flashcardEngine.js` | Pure functions: card generation, match evaluation |
| `PianoFlashcards/flashcardEngine.test.js` | Vitest tests for engine functions |
| `PianoFlashcards/components/AttemptHistory.jsx` | Rolling attempt dots + accuracy display |

PianoFlashcards uses `useAutoGameLifecycle` for mount auto-start and auto-deactivate on completion.

### Game State Machine

```
IDLE ──[startGame()]──▶ PLAYING ──[level 8 threshold]──▶ COMPLETE
 ▲                                                           │
 └──────────────────────[5s display]─────────────────────────┘
```

**`useFlashcardGame` returns:**
- `phase` — `IDLE | PLAYING | COMPLETE`
- `level`, `score`, `scoreNeeded`, `levelConfig`
- `currentCard` — `{ pitches: number[] }`
- `cardStatus` — `null | 'hit' | 'miss'`
- `attempts` — `[{ hit: boolean }]` rolling history
- `accuracy` — percentage from last 20 attempts
- `startGame()`, `deactivate()`

### Match Evaluation

| Result | Condition | Effect |
|--------|-----------|--------|
| `correct` | All target pitches held | Score +10, next card after 400ms |
| `wrong` | Non-target note pressed (chord incomplete) | Red flash, card stays, marked as failed |
| `partial` | Some targets held, no wrong notes | No feedback — player is rolling a chord |
| `idle` | No notes pressed | No feedback |

Chord tolerance: players can roll chords (press notes sequentially while holding). As long as only target notes are pressed, the match stays `partial` until all notes are held.

### 9 Difficulty Levels

| Level | Complexity | Range | Keys | Score to advance |
|-------|-----------|-------|------|-----------------|
| 0 | Single | C4-C5 | White | 100 |
| 1 | Single | C4-C5 | Chromatic | 120 |
| 2 | Single | C3-C6 | Chromatic | 140 |
| 3 | Dyad | C4-C5 | White | 160 |
| 4 | Dyad | C4-C5 | Chromatic | 180 |
| 5 | Dyad | C3-C6 | Chromatic | 200 |
| 6 | Triad | C4-C5 | White | 220 |
| 7 | Triad | C4-C5 | Chromatic | 240 |
| 8 | Triad | C3-C6 | Chromatic | 260 |

Each complexity tier ramps: white narrow → chromatic narrow → chromatic wide. One new concept per level.

### Testing

| File | Framework | Coverage |
|------|-----------|----------|
| `flashcardEngine.test.js` | Vitest | 14 tests: card generation, match evaluation |

---

## Rhythm Game

Falling-note accuracy game with two modes: "invaders" (any visible note is hittable, timing doesn't matter) and "hero" (timing windows determine hit quality). Health meter provides life-based difficulty gating.

### Component Tree

```
PianoVisualizer
├── NoteWaterfall          (displays falling notes when rhythm game is active)
├── Life meter             (Mega Man-style health bar, 28 notches)
├── RhythmOverlay          (countdown, level complete/failed, victory screens)
└── PianoKeyboard          (visual keyboard with target/wrong note highlighting)
```

### File Inventory

| File | Purpose |
|------|---------|
| `useRhythmGame.js` | Game state machine: spawning, hit detection, scoring, level progression |
| `rhythmEngine.js` | Pure functions: state factory, note generation, hit detection, scoring, level eval |
| `components/RhythmOverlay.jsx` | Overlay UI: countdown 3-2-1-GO, level banners, victory screen |
| `components/RhythmOverlay.scss` | Overlay styles |

### Game State Machine

```
IDLE ──[startGame()]──▶ STARTING ──[3-2-1-GO]──▶ PLAYING
                                                    │
                                          ┌─────────┼──────────┐
                                          ▼         ▼          ▼
                                   LEVEL_COMPLETE LEVEL_FAILED VICTORY
                                          │         │          │
                                          ▼         ▼          ▼
                                      [next level] [retry/    [8s → IDLE]
                                                    exit]
```

**Failure modes:**
- `max_misses` exceeded → retry same level (3s banner)
- `health` depleted → exit game entirely (3s banner)

### Rhythm Engine

**File:** `rhythmEngine.js` — all pure functions.

| Function | Purpose |
|----------|---------|
| `createInitialState()` | Factory for IDLE state |
| `resetForLevel(state, levelIndex)` | Reset score/health for new level |
| `isActivationComboHeld(activeNotes, comboNotes, windowMs)` | Check if activation chord is held |
| `generatePitches(level, lastPitches)` | Generate note/chord for current level |
| `getFallDuration(level)` | Get fall duration (ms) for a level |
| `maybeSpawnNote(state, level, now)` | Spawn a new falling note if timing allows |
| `processHit(state, pitch, now, timingConfig, mode)` | Evaluate hit quality (invaders vs hero) |
| `applyScore(score, hitQuality, scoringConfig)` | Compute points with combo multiplier |
| `processMisses(state, now, missThresholdMs)` | Tag missed notes, reset combo |
| `cleanupResolvedNotes(state, now)` | Remove old hit/missed notes from display |
| `evaluateLevel(score, levelConfig, health)` | Check for advance/fail conditions |

### Config Structure

All rhythm config lives under `games.rhythm` in `piano.yml`:

```yaml
games:
  rhythm:
    activation:
      notes: [30, 102]
      window_ms: 300
    timing:
      perfect_ms: 80
      good_ms: 200
      miss_threshold_ms: 400
    scoring:
      perfect_points: 100
      good_points: 50
      miss_penalty: 0
      combo_multiplier: 0.1
    levels:
      - name: "Three Keys"
        notes: [60, 62, 64]
        range: [60, 72]
        fall_duration_ms: 15000
        spawn_delay_ms: 1500
        max_visible: 1
        simultaneous: 1
        sequential: true
        mode: invaders
        points_to_advance: 22000
        max_misses: 30
      # ... more levels
```

### Level Modes

| Mode | Hit Detection | Use Case |
|------|--------------|----------|
| `invaders` | Any visible falling note matching the pitch counts as a hit. Timing is irrelevant. | Early levels — learn the keys |
| `hero` | Timing windows apply: perfect (±80ms), good (±200ms), miss (>400ms) | Later levels — rhythm accuracy |

### Health System

- 28 notches (Mega Man-style life meter)
- Correct hit: +1 health (capped at 28)
- Wrong press: escalating penalty (1st=1, 2nd=3, 3rd=5, 4th+=7 per streak)
- Correct hit resets wrong streak to 0
- Health reaching 0 exits the game entirely

---

## Shared Utilities

### noteUtils.js

| Export | Signature | Description |
|--------|-----------|-------------|
| `getNoteName(note)` | `(number) → string` | MIDI note to name (e.g. 60 → "C4") |
| `isWhiteKey(note)` | `(number) → boolean` | True if note is a white key |
| `getNoteHue(note, start, end)` | `(number, number, number) → number` | Color hue 0-280 by pitch position |
| `getNotePosition(note, start, end)` | `(number, number, number) → number` | Horizontal % position on keyboard |
| `getNoteWidth(note, start, end, compact)` | `(number, number, number, boolean) → number` | Width % for note bar |
| `shuffle(arr)` | `(any[]) → any[]` | Fisher-Yates in-place shuffle |
| `buildNotePool(noteRange, whiteKeysOnly)` | `([number, number], boolean) → number[]` | Build array of MIDI notes in range, optionally white-only |
| `computeKeyboardRange(noteRange)` | `([number, number] \| null) → { startNote, endNote }` | Compute display range with 1/3 padding, 2-octave minimum, clamped to [21, 108] |

### rhythmEngine.js

| Export | Used By |
|--------|---------|
| `isActivationComboHeld()` | useGameActivation |
| `createInitialState()`, `resetForLevel()`, etc. | useRhythmGame |

### Other Shared Files

| File | Exports | Used By |
|------|---------|---------|
| `gameRegistry.js` | `getGameEntry()`, `getGameIds()`, `GAME_REGISTRY` | PianoVisualizer |
| `useMidiSubscription.js` | `activeNotes` Map, `noteHistory`, `sustainPedal`, `sessionInfo` | PianoVisualizer |

---

## Shared Hooks

### usePianoConfig()

**File:** `usePianoConfig.js`

Loads piano configuration from the backend on mount. Fetches device config (`/api/v1/device/config`) for HA script references and app config (`/api/v1/admin/apps/piano/config`) for the `games` section. Fires Home Assistant `on_open` script on mount and `on_close` script on unmount.

**Returns:** `{ gamesConfig }` — the parsed `games` section from `piano.yml`, or `null` if unavailable.

### useInactivityTimer(activeNotes, noteHistory, isAnyGame, onClose)

**File:** `useInactivityTimer.js`

Detects piano inactivity and triggers `onClose` after a grace period + countdown. Suppressed when any game mode is active (`isAnyGame = true`).

- **Grace period:** 10 seconds after last note release
- **Countdown:** 30 seconds with visual progress bar
- **Returns:** `{ inactivityState: 'active' | 'countdown', countdownProgress: number }`

### useSessionTracking(noteHistory)

**File:** `useSessionTracking.js`

Tracks piano session duration. Starts timing when the first note is played and updates every second.

**Returns:** `{ sessionDuration: number }` (seconds)

### useAutoGameLifecycle(phase, startGame, onDeactivate, logger, gameName)

**File:** `useAutoGameLifecycle.js`

Shared lifecycle hook used by fullscreen games (Tetris, Flashcards). Handles two behaviors:

1. **Auto-start on mount:** If the game phase is `IDLE` when the component mounts, calls `startGame()` immediately.
2. **Auto-deactivate:** When phase transitions from a non-IDLE state back to `IDLE` (e.g., after game-over display), calls `onDeactivate()` to exit the game.

Used by `PianoTetris` and `PianoFlashcards` to avoid duplicating mount/exit logic.

---

## Data Flow Summary

```
MIDI Keyboard
  │
  ▼
useMidiSubscription → activeNotes: Map<note, {velocity, timestamp}>
  │
  ├──▶ usePianoConfig → gamesConfig
  │
  ├──▶ useGameActivation → activeGameId ('rhythm' | 'tetris' | 'flashcards' | null)
  │
  ├──▶ useRhythmGame (when rhythm active)
  │      ├──▶ rhythmEngine (pure functions: spawning, hit detection, scoring)
  │      └── returns game state (fallingNotes, score, health, level)
  │
  ├──▶ useInactivityTimer → inactivityState, countdownProgress
  │
  ├──▶ useSessionTracking → sessionDuration
  │
  ├──▶ PianoVisualizer (layout composition)
  │      ├── NoteWaterfall (note history + optional falling notes)
  │      ├── PianoKeyboard (visual reference + targets + wrong notes)
  │      ├── RhythmOverlay (countdown / level banners / victory)
  │      ├── CurrentChordStaff (when no game active)
  │      └── Life meter (when rhythm game active)
  │
  ├──▶ PianoTetris (fullscreen, lazy-loaded via gameRegistry)
  │      ├── useTetrisGame → game state
  │      ├── useAutoGameLifecycle → auto-start/deactivate
  │      ├── useStaffMatching → matchedActions
  │      ├── ActionStaff ×6 (targets + ghost notes from activeNotes)
  │      ├── TetrisBoard (board + currentPiece + ghostPiece)
  │      ├── TetrisOverlay (countdown / game over)
  │      └── PianoKeyboard (visual reference)
  │
  └──▶ PianoFlashcards (fullscreen, lazy-loaded via gameRegistry)
         ├── useFlashcardGame → game state
         ├── useAutoGameLifecycle → auto-start/deactivate
         ├── ActionStaff ×1 (large centered target card)
         ├── AttemptHistory (rolling dots + accuracy %)
         └── PianoKeyboard (highlighted targets)
```
