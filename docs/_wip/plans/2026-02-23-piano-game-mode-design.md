# Piano Game Mode Design

## Overview

A Guitar Hero-style game mode for the existing Piano Visualizer. Notes fall down toward the keyboard; the player must hit them within timing windows to score points. Levels are fully configurable in `piano.yml` with algorithmic note generation, progressive difficulty, and combo scoring.

## Activation

Game mode is toggled by a configurable simultaneous-note combination (e.g., first and last black keys on the keyboard). The same combo exits game mode mid-game.

```yaml
game:
  activation:
    notes: [22, 108]    # A#0 + C8
    window_ms: 300       # Max time between the two presses
```

The activation detector watches `activeNotes` — when all configured notes are held within the time window, game mode toggles. During game play, the activation combo is checked on every `note_on` event; matching toggles back to free-play mode.

## State Machine

```
IDLE → (activation combo) → STARTING → (3-2-1 countdown) → PLAYING
                                                              ↓
                                                         LEVEL_COMPLETE → next level → PLAYING
                                                              ↓                            ↓
                                                           VICTORY                    LEVEL_FAILED
                                                              ↓                            ↓
                                                           IDLE                    (retry same level)
```

- **IDLE:** Free-play mode. Activation combo listened for.
- **STARTING:** 3-2-1-GO countdown overlay. No notes generated yet.
- **PLAYING:** Notes falling, hit detection active, score updating.
- **LEVEL_COMPLETE:** Banner shown for 3s with level stats. Auto-advances to next level.
- **LEVEL_FAILED:** "Try Again!" banner for 3s. Restarts the same level.
- **VICTORY:** All levels complete. Final score, accuracy, max combo shown. Fades back to IDLE.

## YAML Configuration

Located at `data/household/config/piano.yml` under the `game:` key.

### Timing Windows

```yaml
game:
  timing:
    perfect_ms: 80       # ±80ms from target = Perfect
    good_ms: 200         # ±200ms from target = Good
    miss_threshold_ms: 400  # Beyond this = Miss (note passed)
```

### Scoring

```yaml
game:
  scoring:
    perfect_points: 100
    good_points: 50
    miss_penalty: 0         # Misses don't subtract points, just break combo
    combo_multiplier: 0.1   # Each consecutive hit adds 10% bonus (combo 5 = 1.5x)
```

### Level Definitions

Levels are ordered arrays. The player progresses through them sequentially.

```yaml
game:
  levels:
    - name: "White Keys"
      notes: [60, 62, 64, 65, 67]        # C4 D4 E4 F4 G4
      bpm: 60
      notes_per_beat: 1                    # One note per beat
      simultaneous: 1                      # Single notes only
      points_to_advance: 500
      max_misses: 10

    - name: "Full Octave"
      notes: [60, 62, 64, 65, 67, 69, 71] # C4 major scale
      bpm: 80
      notes_per_beat: 1
      simultaneous: 1
      points_to_advance: 1000
      max_misses: 8

    - name: "Two Hands"
      notes: [48, 50, 52, 53, 55, 60, 62, 64, 65, 67]
      bpm: 70
      notes_per_beat: 1
      simultaneous: 2                      # Up to 2 simultaneous notes
      points_to_advance: 1500
      max_misses: 8

    - name: "Black Keys"
      notes: [61, 63, 66, 68, 70]         # C#4 D#4 F#4 G#4 A#4
      bpm: 60
      notes_per_beat: 1
      simultaneous: 1
      points_to_advance: 800
      max_misses: 10

    - name: "Chords"
      notes: [60, 62, 64, 65, 67, 69, 71]
      bpm: 50
      notes_per_beat: 0.5                  # One note every 2 beats
      simultaneous: 3                      # Triads
      chord_mode: true                     # Generate musically valid chords
      points_to_advance: 2000
      max_misses: 6
```

**Level config fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name shown in the UI |
| `notes` | number[] | MIDI note pool for random selection |
| `bpm` | number | Beats per minute (controls fall speed and spawn rate) |
| `notes_per_beat` | number | Notes spawned per beat (0.5 = every 2 beats) |
| `simultaneous` | number | Max notes spawned at same time (1=single, 2=intervals, 3=triads) |
| `chord_mode` | boolean | When true with simultaneous>1, picks musically valid intervals |
| `points_to_advance` | number | Score threshold to complete the level |
| `max_misses` | number | Miss limit before level failure |

## Note Generation

Runs on a `setInterval` during PLAYING state.

- **Spawn interval:** `(60000 / bpm) / notes_per_beat` ms
- **Note selection:** Random from the level's `notes[]` pool
- **Simultaneous > 1:** Pick N distinct notes. If `chord_mode: true`, pick a root and build a triad (root + major/minor 3rd + 5th, constrained to available notes)
- **Fall duration:** Derived from BPM. Slower BPM = longer fall = more visual warning. Roughly 2-3 seconds.
- **Each spawned note:** `{ id, notes: [pitch, ...], targetTime: now + fallDuration, state: 'falling' }`

### Chord Generation (chord_mode)

Given a root note and the level's note pool:
1. Find candidates for a 3rd (3-4 semitones above root, constrained to pool)
2. Find candidates for a 5th (7 semitones above root, constrained to pool)
3. If a valid triad exists, use it. Otherwise, fall back to random distinct notes.

## Hit Detection

### On `note_on` Event

```
For each note_on(pitch):
  Find the oldest falling note group containing this pitch, still in 'falling' state
  Calculate delta = abs(now - targetTime)

  if delta <= perfect_ms  → tag note as 'perfect'
  if delta <= good_ms     → tag note as 'good'
  else                    → no match (too early or wrong note)

  For simultaneous > 1 (chords):
    All notes in the group must be hit within the timing window
    Partial hits don't count — the whole group is evaluated when
    either all notes are hit or the miss threshold passes
```

### On Animation Tick (Miss Detection)

```
For each falling note group in 'falling' state:
  if now > targetTime + miss_threshold_ms:
    Tag entire group as 'missed'
    Reset combo to 0
    Increment miss counter
    if misses >= max_misses → LEVEL_FAILED
```

### Scoring

```
points = base_points × (1 + combo × combo_multiplier)

Example at combo 10, perfect hit:
  100 × (1 + 10 × 0.1) = 100 × 2.0 = 200 points
```

### Edge Cases

- Extra notes played that don't match any falling note: ignored (no penalty for noodling)
- Notes played way too early (before any note is in the timing window): ignored
- Sustain pedal: no effect on game mechanics

## Visual Integration

### Layout (Overlay Approach)

The existing PianoVisualizer layout is preserved. Game mode swaps content within the same containers:

**Header area:**
- **Left:** Score + combo counter (replaces session timer)
- **Center:** Level name + progress bar toward `points_to_advance` (replaces chord staff)
- **Right:** Miss counter, e.g., "3/10" (new element)

**Waterfall area:**
- Game notes fall **downward** toward the keyboard (opposite of free-play rising notes)
- A horizontal **hit line** glows just above the keyboard boundary
- Notes are colored by their pitch hue (same as existing waterfall)
- Hit feedback: green burst (Perfect), yellow (Good), red X (Miss)

**Keyboard:**
- Unchanged. Active notes still light up on press.
- Target notes get a subtle glow/pulse on their keys as the falling note approaches

**Overlays (new `GameOverlay` component):**
- 3-2-1-GO countdown (centered, large)
- "Level Complete!" banner with stats (auto-dismiss 3s)
- "Try Again!" banner (auto-dismiss 3s)
- Victory screen with final score, max combo, accuracy %
- Combo badge: appears at combo > 5, scales with streak, shatters on miss

### CSS Approach

Game mode styles scoped under `.game-mode` class on `.piano-visualizer`:
- Waterfall game notes in `NoteWaterfall.scss` (falling direction, hit line, feedback)
- Overlay styles in new `GameOverlay.scss`
- No new animation issues: existing waterfall uses `setInterval` ticks (not CSS animations), which is compatible with TVApp's CSS animation kill

## File Structure

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/modules/Piano/useGameMode.js` | Game engine hook: state machine, note generator, hit detector, activation detector, combo tracker |
| `frontend/src/modules/Piano/components/GameOverlay.jsx` | Score display, level progress, miss counter, countdown, banners, victory screen |
| `frontend/src/modules/Piano/components/GameOverlay.scss` | Styles for all game overlay elements |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/modules/Piano/PianoVisualizer.jsx` | Load piano.yml config, integrate `useGameMode`, pass `gameMode` prop to children, conditional header rendering |
| `frontend/src/modules/Piano/components/NoteWaterfall.jsx` | Accept `gameMode` prop, render falling target notes alongside rising played notes, hit line, hit/miss feedback |
| `frontend/src/modules/Piano/components/NoteWaterfall.scss` | Falling note styles, hit line glow, Perfect/Good/Miss feedback animations |
| `data/household/config/piano.yml` | Add `game:` configuration section |

### Unchanged Files

| File | Reason |
|------|--------|
| `useMidiSubscription.js` | Game hook consumes its output, no changes needed |
| `PianoKeyboard.jsx` | Already shows active notes; no game-specific logic |
| `CurrentChordStaff.jsx` | Hidden during game mode via conditional rendering |
| Backend | Game is entirely frontend; same MIDI WebSocket events |

## Data Flow

```
WebSocket (MIDI)
      ↓
useMidiSubscription()
      ↓
  activeNotes, noteHistory
      ↓                    ↓
useGameMode(              (free-play waterfall
  activeNotes,             still works normally)
  noteHistory,
  gameConfig
)
      ↓
{
  isGameMode,
  gameState,
  currentLevel,
  fallingNotes,
  score: { points, combo, maxCombo, perfects, goods, misses },
  countdown,
  levelProgress: { pointsEarned, pointsNeeded, missesUsed, missesAllowed }
}
      ↓
PianoVisualizer
  ├── GameOverlay (score, level, banners)
  ├── NoteWaterfall (gameMode: fallingNotes + hit feedback)
  └── PianoKeyboard (unchanged)
```

## Config Loading

`PianoVisualizer` already fetches device config on mount. Piano game config loads via:

```js
const pianoConfig = await DaylightAPI('api/v1/admin/apps/piano/config');
const gameConfig = pianoConfig?.parsed?.game ?? null;
```

If `gameConfig` is `null` (no `game:` section in YAML), game mode is unavailable — activation combo is not listened for.

## Implementation Notes

- The `useGameMode` hook should be pure logic with no DOM concerns — all rendering happens in existing components via props
- Fall duration should be calculated so the note is visible for ~2.5 seconds before reaching the hit line, regardless of BPM
- The note generator should avoid repeating the same note consecutively when possible
- Combo display should use Web Animations API (not CSS transitions) per TVApp compatibility requirement
- All game events should use the structured logging framework (`getLogger().child({ component: 'piano-game' })`)
