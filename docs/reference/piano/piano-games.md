# Piano Games Architecture

Reference for the DaylightStation piano game system — MIDI-driven games layered on the piano visualizer. The kiosk Games picker includes Piano Hero, Space Invaders, Tetris, Flashcards, Side Scroller, Piano Chess, and the YAML-driven Card Game.

---

## Card Game

Card Game is the YAML-defined, Pokémon-themed tactical card battle at
`/piano/games/card-game`. It is a persistent one-screen campaign with separate Home,
Pokédex, Trainer, campaign-decision, and focused battle surfaces. A seeded route draws one
unique opponent from each of five authored difficulty tiers, preferring unseen Pokémon.
The complete route and four-opponent themed gym are pinned in session state, so resume and
retry never redraw them; replay starts a new seed.

The player chooses an owned partner, sees the opponent's intent, and commits one of three
compact piano move cards. A fourth move unlocks after the first route battle and a charged,
one-use fifth finisher appears in the gym. Performance quality determines a direct,
partial, or missed effect. Recruitment follows route battles two and four, then a gym-entry
decision heals the roster before the four-part gym challenge. Future route identities stay
concealed until their encounters begin.

The presentation is character-first rather than dashboard-first. Home is anchored by the
current partner and next gym, with daily/weekly progress reduced to compact supporting
cards. Partner selection uses large Pokémon art. Battle keeps both combatants and health
visible, represents the route with icons, and limits each move card to its name, skill,
keyboard shortcut, and numeric effects. Primary labels are sized for the kiosk viewport;
secondary metadata never carries the action by itself. The battle surface owns move/skill
context, while the piano provider owns the exercise name and tempo, so an active challenge
has one two-line heading instead of stacked duplicate instructions.

Minor post-battle rewards are consolidated into one research report. Catch, badge,
evolution/mastery, and trainer-unlock ceremonies are persisted before presentation and
queued one at a time. Save & Exit suspends the active session and refunds an in-progress
piano challenge instead of abandoning campaign progress.

Longitudinal progress is rebuilt from authoritative session history: Pokédex states,
partner bonds, best scores in four skill families, trainer XP/level, badges, daily research,
weekly stamps/tickets, streak/rest tokens, and applied milestones. Guest sessions can
demonstrate the full battle flow but are excluded from durable campaign rewards.

The ownership boundary is strict:

- `shared/gaming/definitions/card-game.yml` contains combat content and a semantic
  curriculum request. It pins tier pools, the gym roster, Pokédex metadata, and
  media-relative SVG paths; it contains no MIDI numbers or ABC.
- Pokémon SVGs are loaded through `/api/v1/proxy/media/stream/*`, rooted at the configured
  media directory, so the game does not copy the 1,025-entry corpus into the frontend.
- `BankChallengePolicy` chooses the exercise from the
  [exercise bank](./exercise-bank.md) and materializes the musical prompt. It
  replaced `PianoScaleChallengePolicy`, whose whole curriculum was nineteen
  hardcoded items — four major scales, six chords, three arpeggios, three
  patterns — which was also the game's ceiling. Selection is now a query: the
  challenge kind maps to bank forms (`chord` to chords, `timed-pattern` to
  figures *and* runs), bounded by a level estimated from attempt history, so a
  kind draws from hundreds of levelled instances rather than an array index. The
  old policy remains as the fallback for a kiosk with no content mount.
- The adaptive behaviour is unchanged and deliberate: fewest attempts first, then
  weakest average, rotating through the equally-stale head so a session does not
  serve the same exercise twice running. An empty level band widens rather than
  fails — no material is a worse answer than slightly-easy material.
- A chord prompt carries its pitch-class set and expected bass, not just an
  ordered `expected_midi`: held-set material is judged on what is down at once,
  and a sequence array cannot express that.
- The provider renders the staff from the prepared prompt and sends held chords,
  ordered sequences, timing observations, and the prepared requirement through
  `performance/assessmentSession.js`. It persists completed/interrupted attempts
  and terminates on timeout or MIDI disconnect.
- The Gaming authority persists every lifecycle boundary, route/gym draw, health,
  recruitment choice, finisher use, queued ceremony, suspension, explicit abandonment,
  and stale-session recovery.
- `shared/gaming/campaignProgress.mjs` folds completed, abandoned, and active sessions into
  the public campaign projection without making presentation state authoritative.
- `journeySfx.js` owns the semantic Web Audio cue catalog. Views emit stable event IDs;
  sounds never participate in reducer decisions.

### Practice evidence

Every attempt is written to the piano ledger at
`data/users/{userId}/apps/piano/attempts/{YYYY-MM-DD}/{attempt_id}.yml`, carrying the full
prompt, the dimensional metrics, and both policy versions — so a record stays readable after
the grading rules move on. Records are write-once. An attempt that ends by teardown rather
than by playing (the player closes the kiosk mid-exercise) is recorded as `aborted` with
`metrics.reason: disposed`; the adaptive policy scores only completed attempts, so abandoned
evidence is diagnostic without skewing what gets served next.

Completed bank-backed game attempts also carry the same assessment evidence as
the Exercises runner: `purpose: challenge`, stable `prompt.exercise_id`,
criterion vector, optional pace gate, diagnostics, rubric version, and verdict.
That makes a game a presentation of an exercise, not a separate progress silo.
A qualifying card-game or activity performance can therefore satisfy a Hanon
step, a teacher-assigned track, or a video exit checkpoint; free practice cannot.

Only input stamped after the attempt starts is graded. A key struck during the prepare→start
gap is counted in `metrics.staleInputsIgnored` and logged as
`piano.challenge.pre-start-input-ignored` — a nonzero count means the player was noodling
over the card animation, not that they played badly.

### Live readiness check

Run the end-to-end verifier against the deployed PianoKiosk route:

```bash
npm run piano:card-game:verify
```

The verifier in `cli/piano-card-game.cli.mjs` rejects stale definitions, validates all five
tier pools and four gym assets, opens the route at 1280×800, completes server-selected
Scale, Chord, Arpeggio, and Rhythm prompts through the kiosk MIDI bridge, and plays the
campaign through its queued decisions and ceremonies. It also verifies the Home, partner,
and battle surfaces do not scroll or place controls outside the viewport. Use `--headed`,
`--json`, or `--screenshot /tmp/card-game.png` when diagnosing a deployment.

The engineering pilot is test-ready, but the product decision remains field-gated. A
supervised pilot must still determine whether players understand the loop, enjoy it, and
want to replay before this pattern is generalized to more games.

---

## System Overview

The piano game system lets users play games using a MIDI keyboard. Players press specific notes (displayed as music notation on staves or as falling note bars) to trigger game actions. A shared activation layer detects combo keypresses to launch games, and a config-driven level system controls difficulty progression.

### Shared judgement and grading

Musical assessment is not a game-engine responsibility. Games call the same
parameterized [performance assessment service](./performance-assessment.md) as
Exercises and Sheet Music, then project its events and result into their own
mechanics:

| Game | Shared service use | Game-owned behavior | Advancement evidence |
|---|---|---|---|
| Piano Hero | timed target matching, misses, timing criteria, portable run result | points, combo, highway effects | in memory by default |
| Space Invaders | timed target matching and common level criteria | lasers, health, points, combo | in memory by default |
| Flashcards | exact-MIDI and pitch-class held matching; common session result | card score, level ladder, rolling accuracy | in memory by default |
| Battle Stadium | held chords or ordered cursor, timing dimensions, rubric and pace gate | move strength, damage, campaign flow | bank-backed challenges persist to the piano ledger |
| Tetris | exact-MIDI held command recognition | movement, rotations, line score, repeat timing | none |
| Side Scroller | reuses Tetris's shared held-command hook | running/jumping and game score | none |
| Piano Chess | none; chord addresses are controller input, not a performance expectation | square selection and chess state | none |

Hero points, Space Invaders health, Flashcard points, card-game damage, and
Tetris/Side Scroller scores remain deliberately local projections. Only the
common musical criteria, gates, diagnostics, rubric identity, and verdict are
portable. Ordinary game sessions never unlock a curriculum implicitly; a game
must be launched with a persistent user and a stable bank requirement before
its result is eligible evidence.

### High-Level Architecture

```
PianoMidiContext ── activeNotes + noteHistory ──▶ Games route
                                                     │
                                      /piano/games/:gameId
                                                     │
                                                     ▼
                                                GameHost
                                                     │
                                      gameRegistry lazy entry
                                                     │
                                                     ▼
       Battle Stadium | Space Invaders | Tetris | Flashcards
       Piano Hero | Side Scroller | Piano Chess
                                                     │
                                                     ▼
                                    assessmentSession as needed
```

---

## Game Activation

**Hook:** `useGameActivation.js`

The kiosk's primary `/piano/games` flow uses routed tiles and `GameHost`.
`useGameActivation` remains for the standalone `PianoVisualizer` screen widget,
where a configured held chord or `initialGame` can activate a registry entry.
Activation chords are controller input and intentionally bypass assessment.

| Mechanism | Details |
|-----------|---------|
| Combo detection | All notes in `activation.notes` held within `window_ms` |
| Toggle | Same combo re-pressed while active → deactivate |
| Cooldown | 2-second cooldown prevents rapid re-triggering |
| Initial activation | the embedding screen may pass an `initialGame` id |
| Dev shortcut | Backtick key cycles through games (localhost only) |

**Config (piano.yml):**
```yaml
games:
  space-invaders:
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

---

## PianoVisualizer (Layout Compositor)

**File:** `PianoVisualizer.jsx`

PianoVisualizer is a pure layout composition component. It does not contain game logic directly. Instead, it delegates to extracted hooks for config, session tracking, inactivity detection, and game activation.

**Hook composition:**
- `usePianoConfig()` — loads device/app config, fires HA scripts on open/close
- `useMidiSubscription()` — MIDI input (activeNotes, noteHistory, sustainPedal)
- `useGameActivation()` — detects combo presses, returns `activeGameId`
- `useInactivityTimer()` — grace period + countdown → auto-close
- `useSessionTracking()` — session duration timer

**Rendering modes:**
- **No game active:** Waterfall visualization + chord staff + keyboard + session timer
- **Registry game active:** Lazy-loaded `replace` component rendered fullscreen;
  receives `activeNotes`, `noteHistory`, `gameConfig`, and `onDeactivate`.

---

## Game Registry

**File:** `gameRegistry.js`

Maps game IDs to their component loaders, layout modes, and lazy React components.

```js
{
  'card-game':     { layout: 'replace', LazyComponent },
  'space-invaders':{ layout: 'replace', LazyComponent },
  tetris:          { layout: 'replace', LazyComponent },
  flashcards:      { layout: 'replace', LazyComponent },
  hero:            { layout: 'replace', LazyComponent },
  'side-scroller': { layout: 'replace', LazyComponent },
  chess:           { layout: 'replace', LazyComponent },
}
```

Every current game uses `replace` and has a `LazyComponent` entry used by the
kiosk host and standalone visualizer inside a Suspense boundary.

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

`useStaffMatching` delegates the exact-MIDI held-set decision to
`performance/assessmentSession.js`; Side Scroller reuses the same hook. The
hook still owns command semantics such as hold-to-repeat and single-fire. These
matches are controller actions, not Flashcards and not graded attempts.

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

## Side Scroller

Side Scroller is a separate game engine, not a Flashcard wrapper. Its
`useSideScrollerGame.js` hook reuses Tetris's `useStaffMatching` command layer,
which in turn delegates exact-MIDI held-set recognition to
`performance/assessmentSession.js`. The shared layer answers only whether the
authored command notes are currently held; Side Scroller retains its own target
rotation, action lifecycle, physics, obstacles, score, sounds, and level
progression. Ordinary play produces no assessment verdict or curriculum
evidence.

---

## Piano Flashcards

Untimed note-reading trainer with two card types: **staff cards** (notes shown on a staff; player presses the matching MIDI keys) and **chord-spelling cards** (card shows a chord symbol like `Dm` or `G7`; player plays the notes that spell it). Progressive difficulty mirrors the Tetris level structure.

### Component Tree

```
PianoFlashcards
├── ActionStaff            (staff cards — large centered card showing target note(s))
├── ChordCard              (chord cards — live grand staff + chord symbol + spelled-out name)
│   └── ChordStaffRenderer (shared MusicNotation — renders currently-held notes)
├── LevelPicker            (modal level menu, opened from the level block)
├── AttemptHistory         (green/red dots + accuracy %)
└── PianoKeyboard          (visual keyboard with highlighted targets)
```

The chord card face has three stacked elements: a grand staff that starts **empty** and live-renders whatever the player is holding, the tab-style symbol big (`Dm`), and the spelled-out name small and light ("D minor").

### File Inventory

| File | Purpose |
|------|---------|
| `PianoFlashcards/PianoFlashcards.jsx` | Main layout: 3-column (stats | card | history) + keyboard |
| `PianoFlashcards/PianoFlashcards.scss` | Layout styles and animations |
| `PianoFlashcards/useFlashcardGame.js` | Game state machine: phase, score, level, card lifecycle |
| `PianoFlashcards/flashcardEngine.js` | Pure functions: card generation, match evaluation (staff + chord), start-level resolution |
| `PianoFlashcards/flashcardEngine.test.js` | Vitest tests for engine functions |
| `PianoFlashcards/components/AttemptHistory.jsx` | Rolling attempt dots + accuracy display |
| `PianoFlashcards/components/ChordCard.jsx` | Chord card face: live staff + symbol + long name |
| `PianoFlashcards/components/LevelPicker.jsx` | Modal level menu (jump to any level) |
| `PianoFlashcards/useFlashcardGame.test.js` | Hook tests: rearm guard, wrong-bass miss, level select |

PianoFlashcards uses `useAutoGameLifecycle` for mount auto-start and auto-deactivate on completion.

### Game State Machine

```
IDLE ──[startGame()]──▶ PLAYING ──[level 8 threshold]──▶ COMPLETE
 ▲                                                           │
 └──────────────────────[5s display]─────────────────────────┘
```

**`useFlashcardGame(activeNotes, config, currentUser)` returns:**
- `phase` — `IDLE | PLAYING | COMPLETE`
- `level`, `score`, `scoreNeeded`, `levelConfig`
- `currentCard` — staff: `{ pitches: number[] }`; chord: `{ type: 'chord', root, rootName, quality, suffix, label, pitchClasses }`
- `cardStatus` — `null | 'hit' | 'miss'`
- `attempts` — `[{ hit: boolean }]` rolling history
- `accuracy` — percentage from last 20 attempts
- `assessment` — common completeness/cleanliness result for the current session
- `startGame()`, `deactivate()`

### Per-User Start Level & Level Picker

Start-level resolution, highest priority first:

1. **Saved preference** — the level last picked in the in-game level menu, stored per-user (`flashcardsLevel` in the piano preferences blob, `PUT /api/v1/piano/users/:id/preferences`).
2. **`games.flashcards.user_start_levels`** in `piano.yml` — maps a kiosk user id to a level **name**.
3. Level 0.

Tapping the level block (left stats column) opens the **LevelPicker** — a modal listing every level (Notes and Chords alike); anyone can jump anywhere. Picking a level resets the score, deals a fresh card, and saves the choice as that user's new starting level. The kiosk's `GameHost` passes `currentUser` from the piano user context; mounts without the context (visualizer overlay) get default levels and no persistence.

```yaml
games:
  flashcards:
    user_start_levels:
      kckern: "Just C"
```

### Match Evaluation

Both card types delegate judgement to the held matcher in
`performance/assessmentSession.js`; the card engine supplies different
equivalence and bass policies while retaining its existing score and rearm
lifecycle.

Staff cards (`evaluateMatch` — exact pitches):

| Result | Condition | Effect |
|--------|-----------|--------|
| `correct` | All target pitches held | Score +10, next card after 400ms |
| `wrong` | Non-target note pressed (chord incomplete) | Red flash, card stays, marked as failed |
| `partial` | Some targets held, no wrong notes | No feedback — player is rolling a chord |
| `idle` | No notes pressed | No feedback |

Chord-spelling cards (`evaluateChordMatch` — octave-free, root-sensitive):

| Result | Condition |
|--------|-----------|
| `correct` | Held pitch classes exactly equal the chord's tones (doubling OK, no extras) AND the lowest held note is the root |
| `wrong` | Any non-chord-tone held, or a complete chord over the wrong bass (`Cm/Eb` is not `Cm`) |
| `partial` | Proper subset of chord tones, no extras |

On a chord-card hit the keyboard highlights a root-position voicing near C4 (`rootPositionVoicing`). Chord tolerance: players can roll chords (press notes sequentially while holding); the match stays `partial` until complete.

**Carryover guard (`awaitRelease`):** a freshly dealt card is not judged until all notes are released. Without this, holding a correct chord through the 400ms advance would instantly fail the next card against the previous card's notes.

**Telemetry:** `card-shown`, `card-hit` (with `held` + `firstTry`), and `card-miss` (with `held` + `reason: wrong-note | wrong-bass`) are all `info`-level and ship to the backend, alongside `game-started {startLevel}`, `level-select`, `level-advance`, and `game-complete`.

### 18 Difficulty Levels

Staff-reading ladder (levels 0–8):

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

Chord-spelling ladder (levels 9–17, `card_type: chord`). Difficulty ramps by **which roots are in play** — qualities stay mixed within every level so no level drills a single chord shape. Each level declares `roots:` (note names, sharps or flats; omitted = all 12) and `qualities:`:

| Level | Name | Roots | Qualities | Score to advance |
|-------|------|-------|-----------|-----------------|
| 9 | Just C | C | major, minor, 7 | 100 |
| 10 | C F G | C, F, G | major, minor, 7 | 120 |
| 11 | Around the Campfire | C, F, G, D, A | + sus2, sus4 | 140 |
| 12 | White Roots | all naturals | major, minor, 7, sus2, sus4 | 160 |
| 13 | Shady Characters | all naturals | + diminished, augmented | 180 |
| 14 | Sevenths Deepen | all naturals | + maj7, m7 | 200 |
| 15 | Black Keys | C# D# F# G# A# | major, minor, 7 | 200 |
| 16 | Full Palette | all 12 | maj/min/dim/aug/sus/7ths | 220 |
| 17 | Ninths & Beyond | all 12 | + 9, maj9, m9 | 240 |

Quality vocabulary (`CHORD_QUALITIES`): major ``, minor `m`, diminished `°`, augmented `+`, sus2/sus4, dominant7 `7`, major7 `maj7`, minor7 `m7`, dominant9 `9`, major9 `maj9`, minor9 `m9` — interval templates match `theory/chordNaming.js`; each also carries a spelled-out `longName` ("dominant 7th") for the card's small line.

### Testing

| File | Framework | Coverage |
|------|-----------|----------|
| `flashcardEngine.test.js` | Vitest | 35 tests: card generation (staff + chord, roots filter), match evaluation (both types), miss reasons, voicing, start-level resolution |
| `useFlashcardGame.test.js` | Vitest | 5 tests: per-user start, scoring, wrong-bass miss, carryover rearm guard, level select |

---

## Piano Hero

Piano Hero turns the kiosk's configured Sheet Music library into a falling-note
timing game. Its first chart source is MusicXML (`.musicxml` and `.mxl`); Studio
takes are deliberately not part of the initial picker, but can be added later as
another source without changing the timing engine.

### Flow

1. `/piano/games` exposes the registered `hero` tile as **Piano Hero**.
2. The song picker resolves the same `sheetmusic.collections` config and generic
   content-list endpoints as Sheet Music, filtering the results to MusicXML.
3. Selecting a song fetches raw XML through
   `api/v1/proxy/media/stream/:encodedPath` (`.mxl` is decompressed by the
   backend, exactly as in Sheet Music).
4. `parseMusicXml` creates the shared renderer-independent score model.
5. The shared performance target compiler groups simultaneous onsets into chord
   targets and converts quarter-note time to milliseconds using the complete
   MusicXML tempo map.
6. A timed `assessmentSession` instance matches live note-on events to the
   nearest target. Chords resolve only when every pitch is struck; Hero adapts
   the same events into its own points and combo rules and exposes the portable
   musical result separately.

The white strike line is active feedback, not only a boundary marker. While the
metronome is enabled it gives a brief score-aligned pulse on every click (with a
stronger downbeat); resolved targets add a lane-local white/teal spark for hits
or a red fractured flash for misses. These effects use the same elapsed score
clock as target judging, so changing the selected tempo keeps sound, targets,
and the threshold pulse phase-locked.

### Timing and scoring

| Result | Window | Base score |
|--------|--------|------------|
| Perfect | ±90 ms | 1000 |
| Good | ±220 ms (outside Perfect) | 600 |
| Miss | target expires after +420 ms | 0 |

Every ten consecutive resolved targets raises the score multiplier by 0.25,
capped at 2×. A wrong key or expired target resets the streak. Tied
continuations are excluded from the attack chart: only the original tie start
becomes a falling target.

### Files

| File | Purpose |
|------|---------|
| `PianoHeroGame/PianoHeroGame.jsx` | MusicXML picker, loading, highway, keyboard, and results UI |
| `performance/performanceTargets.js` | Shared tempo-resolved score-to-target compiler |
| `performance/assessmentSession.js` | Public parameterized matcher, observation, criteria, and verdict service shared with Polish and the other assessment consumers |
| `performance/performanceJudge.js` | Internal timed target-matching primitive |
| [performance-assessment.md](./performance-assessment.md) | Overview of the shared performance service (grading, matching, spans) |
| `PianoHeroGame/heroChart.js` | Hero chart metadata and points/combo adapter |
| `PianoHeroGame/usePianoHeroGame.js` | MIDI subscription and timed run lifecycle |
| `PianoHeroGame/PianoHeroGame.scss` | Picker, highway, HUD, notes, and results styling |

---

## Piano Chess

Chess played by chords: every square is a chord (file = root, rank = quality), and a move
is the two chords that perform it, played in order. Nothing is pointer-driven — the
instrument is the controller.

### Opponent: server engine with a local fallback

The opponent is served by the backend — a Stockfish WASM engine behind
`POST /api/v1/chess/move` — with the bundled heuristic engine as a local fallback. Every
request carries the position, the active rung, and a per-game id; on any transport or
engine failure the client falls back to the bundled engine so the game never blocks on
the network. The reply is delayed by `opponent_delay_ms` so it reads as a reply, not a
flicker.

### The config pair

Configuration is two layers merged server-side, household defaults under a per-user
override:

| Layer | File |
|-------|------|
| Household defaults | `data/household/config/chess.yml` |
| Per-user override | `data/users/{userId}/apps/chess/config.yml` |

`GET /api/v1/chess/config?user={id}` serves the merge; `PUT` the same path writes a
sparse patch into the user's own layer only. Guests never reach the per-user endpoints —
their changes apply for the session and evaporate. Scalar keys and the `rungs` ladder
replace wholesale (a half-merged ladder is never what anyone means); only the `feedback`
block merges key-by-key.

### The ladder

`rungs` is an ordered list of opponent strengths. Each rung sets either `skill`
(Stockfish Skill Level 0–20 — the engine plays full strength then intentionally errs,
more at low values) or `elo` (UCI_LimitStrength targeting a rating), plus `movetime_ms`.
The shipped ladder:

| Rung | Strength |
|------|----------|
| `first-moves` | skill 0 |
| `learner` | skill 3 |
| `steady` | skill 8 |
| `sharp` | skill 14 |
| `ruthless` | elo 1800 |

`default_rung` names the rung a game starts on. An unknown rung id resolves to the
middle of the ladder rather than failing.

### The two-zone screen

The screen is two zones. The **game zone** holds the board and one rail: the shared
context rail (the way back), whose turn it is, the active rung, the prompt line, the
cancel / play-again button, the move log, and captured material. The **instrument
zone** sits below: a chord-name plaque (eyebrow "Playing") that names whatever is
sounding even when it is not a square, the chess read-out saying what the game heard
and which square it points to, and the keyboard itself with note labels. The plaque
lingers half a second after release — a move commits on release, so it confirms what
was just played. Nothing on the screen sizes itself off viewport units: the kiosk is
laid out at a fixed design size and scaled, so everything measures its own container.

### The board's four channels

Each visual channel answers one question, so they coexist without competing:

| Channel | Question | Used for |
|---------|----------|----------|
| Light (square brightness) | What are my hands doing now? | Candidate squares glow faintly; the resolved square is bright; the ghost piece previews the landing |
| Outline (border) | Where am I in this move? | Marching ants = the piece in hand; dashed = the last move |
| Marks (dots, rings, badges) | What can this move do? | Destination dots and chord badges while a piece is held; legal-move marks and the best-move ring when a gesture asks |
| Colour (wash) | Is something wrong? | Check; the refused-square flash |

### Hover, pick up, drop

Naming a square and committing to it are different acts. One played chord **hovers** —
it lights the square, previews a ghost piece, and commits nothing, so a player can try
a chord and see where it lands. The **same square played twice** within a short window
picks the piece up; the pick-up fires on recognition, while the fingers are still down,
and that chord's own release is swallowed so it cannot double as a drop. **Dropping**
takes only one play, because a held piece can reach only a handful of lit, labelled
squares and intent is already declared. An octave (or Esc) puts the piece back.

The square whose piece is in the air wears an animated marching-ants border — a child
element, not the square's `::before`, which the best-move ring already owns (the piece
in hand can also be the engine's suggestion). While a piece is held, exploring is never
punished: a chord for an unreachable square hovers silently rather than flashing a
refusal.

### Destination labels

The moment a piece is picked up, every square it can legally reach prints the chord
that addresses it in a corner badge — the answer to the question the pick-up just
asked. Without them the player must read a root off one rim, a quality off the other,
and intersect them mentally while holding a piece; in a real session that produced
zero completed moves. The corner placement (with a stacking level above the piece
artwork) keeps the badge clear of the occupant on capture squares, and the badge sizes
itself off the board's own size token, never the viewport.

The labels are **not help and are never charged to the game record**: the deliberate
double-play that lifted the piece was the request. The record counts only the two
gestures that ask for more — legal-move marks and the best move. Config can turn the
labels off (`feedback.show_destination_labels: false`; absent means on) for players
who want the rim-intersection drill back.

### Narrowing

A square is a candidate while its chord's pitch classes contain every pitch class
currently held. One note lights a scatter (a note is the root of one chord and the
third of another); each added note contracts the set. A completed triad leaves the
triad plus its extensions on the same file — the single bright square comes from the
settle-window cursor, not from the candidate set reaching one. An empty candidate set
means no square can contain these notes, and the read-out says "not a square" at once
instead of waiting out the settle window.

### Hint gestures

Help is asked for at the keys and never volunteered — there is no hint setting, and a
refusal flashes and explains but reveals nothing. A gesture is a shape no chord on the
board can be: a run of adjacent semitones (the same trick as the octave for
"take it back"; a two-note semitone pair is a legitimate partial chord and triggers
nothing).

- **Three adjacent semitones** — show legal moves: the destinations of the piece being
  held, or which pieces can move when none is held.
- **Four adjacent semitones** — ring the best move on its origin and destination. The
  server is asked at full strength (`ruthless`) regardless of the rung being played — a
  hint only as strong as a beginner's opponent is not a hint.

A recognised cluster is never chord input: narrowing is suppressed while it is down,
and its release neither commits a move nor draws a refusal. The gesture is
tap-and-release; the marks persist until the player's next move completes, so the tally
counts moves-with-help, not presses.

### The game record

Each finished game posts one record to `POST /api/v1/chess/games?user={id}`, stored
under the player's own data. It holds facts, never a score: result, outcome, move
count, hints used, best moves used, the rung, and duration. Guests are not recorded —
they never reach the per-user endpoints.

### Refusal loudness

`feedback.flash_rejected` and `feedback.toast` control how loudly a refusal is
announced (the red flash on the refused square, the sentence saying what was wrong);
`feedback.show_destination_labels` controls the chord badges on a held piece's
reachable squares. All live in YAML only, default on, and turn off only on explicit
`false`. The YAML is snake_case; the translation to the component's camelCase cue
flags happens in one place and nowhere else. A stale `hint_level` in a saved override
is ignored — it selects behaviour that no longer exists.

### In-game settings

The Settings button on the rail opens a panel of discrete tap targets (no sliders): the
rung ladder, the chord-map shuffle, the destination-label toggle (Show chords / Hide
chords), and the opponent delay (300/700/1200 ms). Every tap
applies immediately and, for a signed-in player, saves a sparse patch to their own
override layer. The shuffle toggle takes effect on the next game — the chord map is
dealt when a game is created, and a mid-game re-deal would rearrange the board under
the player.

---

## Space Invaders

Falling-note game with two level policies: `invaders` (any visible matching
target is hittable) and `hero` (timing windows determine hit quality). A health
meter and miss limits drive the game progression, while the common assessment
result separately reports completeness, cleanliness, and placement.

### Component Tree

```
SpaceInvadersGame
├── Falling-note field     (targets and fired lasers)
├── Life meter             (Mega Man-style health bar, 28 notches)
├── SpaceInvadersOverlay   (countdown, level complete/failed, victory screens)
└── PianoKeyboard          (visual keyboard with target/wrong note highlighting)
```

### File Inventory

| File | Purpose |
|------|---------|
| `PianoSpaceInvaders/SpaceInvadersGame.jsx` | Fullscreen game surface |
| `PianoSpaceInvaders/useSpaceInvadersGame.js` | Game state machine: spawning, lasers, health, scoring, and level progression |
| `PianoSpaceInvaders/spaceInvadersEngine.js` | Pure game engine plus adapters to the common timed assessment service |
| `PianoSpaceInvaders/components/SpaceInvadersOverlay.jsx` | Countdown, level banners, failure, and victory UI |

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

### Space Invaders Engine

**File:** `PianoSpaceInvaders/spaceInvadersEngine.js` — pure game functions.

| Function | Purpose |
|----------|---------|
| `createInitialState()` | Factory for IDLE state |
| `resetForLevel(state, levelIndex)` | Reset score/health for new level |
| `isActivationComboHeld(activeNotes, comboNotes, windowMs)` | Check if activation chord is held |
| `generatePitches(level, lastPitches)` | Generate note/chord for current level |
| `getFallDuration(level)` | Get fall duration (ms) for a level |
| `maybeSpawnNote(state, level, now)` | Spawn a new falling note if timing allows |
| `processHit(state, pitch, now, timingConfig, mode)` | Adapt a falling target through the common timed matcher |
| `applyScore(score, hitQuality, scoringConfig)` | Compute points with combo multiplier |
| `processMisses(state, now, missThresholdMs)` | Tag missed notes, reset combo |
| `cleanupResolvedNotes(state, now)` | Remove old hit/missed notes from display |
| `evaluateLevel(score, levelConfig, health)` | Check for advance/fail conditions |
| `assessSpaceInvaders(score)` | Produce the common musical criteria/verdict without replacing game points or health |

### Config Structure

Space Invaders config lives under `games.space-invaders` in `piano.yml`:

```yaml
games:
  space-invaders:
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

### spaceInvadersEngine.js

| Export | Used By |
|--------|---------|
| `isActivationComboHeld()` | useGameActivation |
| `createInitialState()`, `resetForLevel()`, etc. | useSpaceInvadersGame |
| timed judgement and `assessSpaceInvaders()` | common assessment service / Space Invaders projection |

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
PianoMidiContext / useMidiSubscription
  ├── activeNotes: Map<note, {velocity, timestamp}>
  └── noteHistory: timestamped note-on/off entries
  │
  ▼
GameHost or standalone PianoVisualizer
  │
  ▼
gameRegistry LazyComponent + gameConfig
  │
  ├──▶ Hero / Space Invaders / Flashcards / Battle Stadium
  │      ├── assessmentSession → musical events + portable result
  │      └── local game engine → points, combo, health, damage, effects
  │
  ├──▶ Tetris / Side Scroller
  │      ├── shared held classifier → command match only
  │      └── local game engine → movement, physics, score, levels
  │
  └──▶ Piano Chess
         └── chord-address interpreter → square command (not assessment)
```
