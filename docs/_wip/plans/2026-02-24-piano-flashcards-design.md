# Piano Flashcards — Design Doc

A flashcard-style game for training note reading on a MIDI keyboard. Untimed, accuracy-focused, with progressive difficulty mirroring the Piano Tetris level structure.

---

## Gameplay Loop

A card appears showing one or more notes on a musical staff (reusing `ActionStaff`). The player presses the matching MIDI key(s).

**On correct:** Card flashes green, score increments (+10), next card appears after ~300ms delay.

**On wrong key:** Card flashes red. The wrong key is highlighted on the keyboard. The card stays — player keeps trying until correct. No score penalty, but the attempt is marked as a miss. Points only awarded on first-try correct answers.

**Chord tolerance (dyads/triads):** When the first correct note is pressed, a roll window opens (300ms, configurable via `chord_window_ms`). All target notes must be held within that window. Wrong notes or timeout resets the window. This accommodates players who roll chords rather than pressing all keys simultaneously.

**Matching logic:** Reuses `isActionMatched` concept from `useStaffMatching` — all target pitches must be present in `activeNotes`.

---

## Difficulty Levels

Each complexity tier follows a three-step ramp: white narrow → chromatic narrow → chromatic wide. One new concept per level.

| Level | Complexity | Range | Keys | New concept | Score to advance |
|-------|-----------|-------|------|-------------|-----------------|
| 0 | Single | C4-C5 | White | Basics | 100 |
| 1 | Single | C4-C5 | Chromatic | + sharps/flats | 120 |
| 2 | Single | C3-C6 | Chromatic | + wide range | 140 |
| 3 | Dyad | C4-C5 | White | + two notes | 160 |
| 4 | Dyad | C4-C5 | Chromatic | + sharps | 180 |
| 5 | Dyad | C3-C6 | Chromatic | + wide | 200 |
| 6 | Triad | C4-C5 | White | + three notes | 220 |
| 7 | Triad | C4-C5 | Chromatic | + sharps | 240 |
| 8 | Triad | C3-C6 | Chromatic | + wide | 260 |

Target generation reuses `generateTargets()` from `useStaffMatching.js`. A new card is generated per round (no pre-built deck). Level advances when score >= threshold; score resets on level-up. No level-down mechanic.

---

## Layout

Three-column layout matching the Tetris structure:

```
┌──────────────┬──────────────────────┬──────────────┐
│  LEFT STATS  │     CENTER CARD      │ RIGHT STATS  │
│              │                      │              │
│  Level: 3    │   ┌──────────────┐   │  ● ● ● ○ ●  │
│  Dyads       │   │  ActionStaff │   │  ● ○ ● ● ●  │
│              │   │  (large)     │   │  ● ● ● ● ○  │
│  Score: 340  │   └──────────────┘   │  ● ● ○ ● ●  │
│  Next: 500   │                      │              │
│  ████████░░  │                      │  85% acc     │
│  (progress)  │                      │              │
├──────────────┴──────────────────────┴──────────────┤
│                 PianoKeyboard                      │
│  (range from current level, targets highlighted)   │
└────────────────────────────────────────────────────┘
```

**Left column:** Current level number + label, score / points needed, progress bar.

**Center:** Single `ActionStaff` rendered large. Hit/miss flash feedback (green pulse / red shake).

**Right column:** Recent attempt history as dots (green = first try, red = missed), rolling accuracy percentage.

**Bottom:** `PianoKeyboard` with range matching current level. Target notes highlighted, wrong presses briefly flash red.

---

## Game State Machine

```
IDLE ──[startGame()]──▶ PLAYING ──[level 8 threshold]──▶ COMPLETE
 ▲                                                           │
 └──────────────────────[5s display]─────────────────────────┘
```

No countdown phase — no time pressure means no need for a 3-2-1 start.

**State shape:**

```js
{
  phase,           // IDLE | PLAYING | COMPLETE
  level,           // 0-8
  score,           // current score in this level
  scoreNeeded,     // threshold for current level
  currentCard,     // { pitches: [60, 64] }
  cardStatus,      // null | 'hit' | 'miss'
  attempts,        // [{ hit: true }, { hit: false }, ...] rolling history
  accuracy,        // computed from attempts
}
```

**Card lifecycle:**

1. `generateTargets()` creates a card using current level's complexity/range/keys
2. Player presses notes → `useChordMatcher` evaluates
3. Match → `cardStatus = 'hit'`, score += 10, 300ms delay, next card
4. Wrong note → `cardStatus = 'miss'`, brief red flash, card stays, marked failed
5. Correct after miss → card clears, next card, 0 points

**Level transitions:** Score >= threshold → level++, score resets, new card generated. Level 8 threshold reached → phase = COMPLETE.

---

## Component Architecture

### New files

```
PianoFlashcards/
├── PianoFlashcards.jsx        Main layout (3-column + keyboard)
├── PianoFlashcards.scss       Styles
├── useFlashcardGame.js        Game state machine
└── components/
    └── AttemptHistory.jsx     Green/red dot grid + accuracy %
```

### Shared abstractions to extract

Move `ActionStaff` up from `PianoTetris/components/` to `Piano/components/` since both games use it.

```
Piano/
├── components/
│   ├── ActionStaff.jsx          ← moved from PianoTetris/components/
│   ├── NoteMatchFeedback.jsx    ← NEW: hit/miss flash overlay
│   └── PianoKeyboard.jsx        (already here)
├── hooks/
│   └── useChordMatcher.js       ← NEW: chord matching with roll tolerance
```

**`useChordMatcher`** — Extracted from `useStaffMatching` matching logic + roll window:
- Input: `activeNotes`, `targetPitches[]`, `windowMs`
- Output: `{ matched, partial, wrongNote }`
- Reusable by both Tetris (refactor `useStaffMatching` to consume it) and Flashcards

**`NoteMatchFeedback`** — Takes a `status` (null / 'hit' / 'miss') and renders the appropriate flash animation. Extracted from waterfall hit/miss visuals.

**Tetris refactor:** `useStaffMatching` updated to use `useChordMatcher` internally. No behavior change for Tetris.

---

## Config & Integration

### piano.yml

```yaml
games:
  flashcards:
    activation:
      notes: [33, 105]    # A1 + A7
      window_ms: 300
    chord_window_ms: 300
    score_per_card: 10
    levels:
      - complexity: single
        note_range: [60, 72]
        white_keys_only: true
        score_to_advance: 100
      - complexity: single
        note_range: [60, 72]
        white_keys_only: false
        score_to_advance: 120
      - complexity: single
        note_range: [48, 84]
        white_keys_only: false
        score_to_advance: 140
      - complexity: dyad
        note_range: [60, 72]
        white_keys_only: true
        score_to_advance: 160
      - complexity: dyad
        note_range: [60, 72]
        white_keys_only: false
        score_to_advance: 180
      - complexity: dyad
        note_range: [48, 84]
        white_keys_only: false
        score_to_advance: 200
      - complexity: triad
        note_range: [60, 72]
        white_keys_only: true
        score_to_advance: 220
      - complexity: triad
        note_range: [60, 72]
        white_keys_only: false
        score_to_advance: 240
      - complexity: triad
        note_range: [48, 84]
        white_keys_only: false
        score_to_advance: 260
```

### Game registry (gameRegistry.js)

```js
flashcards: {
  component: () => import('./PianoFlashcards/PianoFlashcards'),
  hook: () => import('./PianoFlashcards/useFlashcardGame'),
  layout: 'replace',
}
```

### PianoVisualizer generalization

Replace hardcoded `isTetrisGame` check with registry-driven logic:

```js
const isFullscreenGame = getGameEntry(activeGameId)?.layout === 'replace';
```

Render the active game's component dynamically instead of the hardcoded Tetris branch. Benefits future games too.

### Route

`/office/piano/flashcards` auto-activates via existing `initialGame` prop. No routing changes needed.

---

## Reused Components Summary

| Component | Source | Modifications |
|-----------|--------|--------------|
| `ActionStaff` | PianoTetris | Move to shared `Piano/components/`, no API changes |
| `PianoKeyboard` | Piano/components | None — same props |
| `generateTargets()` | useStaffMatching | None — already a pure function |
| `isActionMatched()` | useStaffMatching | Wrapped by new `useChordMatcher` with roll tolerance |
| Hit/miss feedback | NoteWaterfall | Extracted to `NoteMatchFeedback` component |
