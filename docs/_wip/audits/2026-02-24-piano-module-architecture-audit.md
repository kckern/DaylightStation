# Piano Module Architecture Audit

**Date:** 2026-02-24
**Scope:** `frontend/src/modules/Piano/` — all files, components, hooks, engines
**Config:** `data/household/config/piano.yml`
**Reference:** `docs/reference/piano/piano-games.md`

---

## Summary

The Piano module is a well-structured multi-game system (Rhythm, Tetris, Flashcards) with good foundational patterns — pure engine functions separated from React hooks, shared visual components, config-driven levels, and a game registry. However, organic growth has introduced significant DRY violations, an under-utilized registry, parallel activation systems, a god component, and inconsistent encapsulation. This audit flags the top violations and recommends targeted refactors.

---

## Severity Legend

| Severity | Meaning |
|----------|---------|
| **P0** | Active bug risk or correctness issue |
| **P1** | Clear architectural violation — should fix |
| **P2** | Code smell — fix when touching nearby code |
| **P3** | Minor improvement — nice to have |

---

## V1 — Registry Exists But Isn't Used for Rendering [P1: SSoT, Encapsulation]

**Location:** `gameRegistry.js`, `PianoVisualizer.jsx:357-374`

The `GAME_REGISTRY` defines lazy-loadable `component` and `hook` entries for each game, but `PianoVisualizer.jsx` ignores them entirely. Instead it uses static imports and hardcoded string checks:

```jsx
// PianoVisualizer.jsx — hardcoded game switching
{activation.activeGameId === 'tetris' && (
  <PianoTetris ... />
)}
{activation.activeGameId === 'flashcards' && (
  <PianoFlashcards ... />
)}
```

The registry's `component()` and `hook()` lazy loaders are never called. Only `layout` is read (via `getGameEntry`). Adding a new game requires editing both the registry **and** PianoVisualizer — defeating the registry's purpose.

**Recommendation:** Use `React.lazy()` with the registry's `component()` loaders to render games dynamically. PianoVisualizer should not import or name-check individual games.

---

## V2 — Parallel Activation Systems [P1: SSoT, Separation of Concerns]

**Location:** `useGameMode.js:95-148`, `useGameActivation.js`

Two independent activation systems coexist:

| System | Used By | Config Path |
|--------|---------|-------------|
| `useGameActivation` | Tetris, Flashcards | `games.{id}.activation` |
| `useGameMode` (inline) | Rhythm game | `game.activation` |

`useGameMode.js` contains its own combo detection (lines 95-119) and dev-shortcut handler (lines 123-148) that duplicate logic now centralized in `useGameActivation.js`. The rhythm game's config lives under `game.activation` while the multi-game registry uses `games.rhythm.activation` — two sources of truth for the same concept.

**Recommendation:** Migrate the rhythm game to use `useGameActivation` like Tetris and Flashcards. Consolidate `game.activation` into `games.rhythm.activation` in `piano.yml`.

---

## V3 — Keyboard Range Calculation Duplicated 3x [P1: DRY]

**Locations:**
- `PianoVisualizer.jsx:60-83` (rhythm game)
- `PianoTetris.jsx:46-68` (tetris)
- `PianoFlashcards.jsx:41-56` (flashcards)

All three perform the same algorithm: pad `note_range` by ~1/3, ensure minimum 2-octave span, clamp to `[21, 108]`. The implementations differ only in minor details (e.g., `Math.round(span / 3)` vs `Math.max(4, Math.round(span / 3))`).

**Recommendation:** Extract a shared `computeKeyboardRange(noteRange, options?)` function to `noteUtils.js` (or a new `keyboardRange.js`). All three consumers import and call it.

---

## V4 — PianoKeyboard Reimplements noteUtils [P1: DRY, SSoT]

**Location:** `components/PianoKeyboard.jsx:4-14` vs `noteUtils.js`

PianoKeyboard locally redefines:
- `WHITE_KEY_NOTES` — identical to `noteUtils.js:5`
- `isWhiteKey()` — identical to `noteUtils.js:6`
- `NOTE_NAMES` — identical to `noteUtils.js:58`
- `getNoteLabel()` — functionally identical to `noteUtils.getNoteName()`

These should be imports from `noteUtils.js`, which already exports all of them.

**Recommendation:** Delete local definitions, import from `../noteUtils.js`.

---

## V5 — Fisher-Yates Shuffle Duplicated [P2: DRY]

**Locations:**
- `PianoTetris/useStaffMatching.js:20-26`
- `PianoFlashcards/flashcardEngine.js:6-12`

Identical `shuffle()` implementations copy-pasted between files.

**Recommendation:** Extract to `noteUtils.js` (or a new `arrayUtils.js`) and import.

---

## V6 — Pitch Generation Logic Duplicated [P2: DRY]

**Locations:**
- `useStaffMatching.js:generateTargets()` (lines 36-67)
- `flashcardEngine.js:generateCardPitches()` (lines 22-38)

Both functions:
1. Build an available-notes array from a MIDI range
2. Filter by `whiteKeysOnly`
3. Shuffle
4. Slice by complexity count (`single=1, dyad=2, triad=3`)

`generateTargets` additionally assigns pitches to named actions (6 groups), while `generateCardPitches` returns a single group. The core "build pool → filter → shuffle → slice" logic is identical.

**Recommendation:** Extract a shared `buildNotePool(noteRange, whiteKeysOnly)` and `pickPitches(pool, count)` to a shared utility. Both generators call these, adding their own grouping logic on top.

---

## V7 — PianoVisualizer Is a God Component [P1: Separation of Concerns]

**Location:** `PianoVisualizer.jsx` (380 lines, 10+ responsibilities)

This single component handles:
1. MIDI subscription lifecycle
2. Device config API fetch
3. Piano app config API fetch
4. Home Assistant script execution (on_open/on_close)
5. Inactivity detection with grace period + countdown
6. Session duration tracking
7. Placeholder delay timing
8. Game activation orchestration
9. Rhythm game state (via `useGameMode`)
10. Fullscreen game rendering (Tetris/Flashcards)
11. Screen flash effects
12. Session summary overlay

**Recommendation:** Extract into focused hooks:
- `usePianoConfig()` — fetches device/game configs, triggers HA scripts
- `useInactivityTimer(activeNotes, noteHistory)` — grace period + countdown
- `useSessionTracking(noteHistory)` — duration, note count

This would reduce PianoVisualizer to ~100 lines of layout composition.

---

## V8 — Misleading File Names [P2: Encapsulation]

| File | Name Implies | Actually Is |
|------|-------------|-------------|
| `gameEngine.js` | Shared game engine | Rhythm game engine only |
| `GameOverlay.jsx` | Shared game overlay | Rhythm game overlay only (countdown, level complete, victory, combo badges) |
| `useGameMode.js` | Generic game mode hook | Rhythm game state machine |

New developers would expect these to be shared infrastructure. Tetris has its own clearly-named `tetrisEngine.js` and `TetrisOverlay.jsx`.

**Recommendation:** Rename to `rhythmEngine.js`, `RhythmOverlay.jsx`, `useRhythmGame.js` — or move them under a `PianoRhythm/` subdirectory to match the pattern established by `PianoTetris/` and `PianoFlashcards/`.

---

## V9 — Auto-Start + Auto-Deactivate Pattern Duplicated [P2: DRY]

**Locations:**
- `PianoTetris.jsx:26-41`
- `PianoFlashcards.jsx:23-38`

Both components contain nearly identical logic:
1. Auto-start on mount when phase is IDLE
2. Track previous phase via a ref-as-mutable-object (using `useMemo` as a ref factory — itself a minor anti-pattern)
3. Auto-deactivate when phase transitions back to IDLE after completion

**Recommendation:** Extract a `useAutoGameLifecycle(phase, startGame, onDeactivate)` hook. Both games call it with their specific phase/callbacks.

---

## V10 — Raw `console.*` in PianoVisualizer [P1: Logging Violation]

**Location:** `PianoVisualizer.jsx:133, 136`

```js
console.debug('[Piano] HA on_open script executed')
console.warn('[Piano] HA on_open script failed:', err.message)
console.warn('[Piano] Config load failed ...', err.message)
```

Per CLAUDE.md: "Never use raw `console.log`, `console.debug`, `console.warn`, or `console.error` for diagnostic logging."

**Recommendation:** Replace with `getChildLogger({ component: 'piano-visualizer' })`.

---

## V11 — useFlashcardGame Has No Logging [P2: Observability]

**Location:** `PianoFlashcards/useFlashcardGame.js`

Unlike `useTetrisGame.js` and `useGameMode.js`, which both use `getChildLogger` for structured logging at key lifecycle points (game start, level up, game over, etc.), `useFlashcardGame.js` has zero logging.

Per CLAUDE.md: "New features must ship with logging."

**Recommendation:** Add structured logging for: game start, card hit/miss, level advance, game complete.

---

## V12 — `TOTAL_HEALTH` Leaked Across Boundaries [P2: Encapsulation]

**Location:** `PianoVisualizer.jsx:11` imports `TOTAL_HEALTH` from `gameEngine.js`

The visualizer imports a rhythm-game-specific constant to render the life meter (line 314). This couples the generic visualizer to rhythm game internals.

**Recommendation:** The life meter rendering should be part of the rhythm game's own overlay/component, not the shared visualizer. Or, expose it as a `game.totalHealth` property from `useGameMode`.

---

## V13 — Game Config Prop Naming Inconsistent [P3: Convention]

| Component | Prop Name | Source |
|-----------|-----------|--------|
| `PianoTetris` | `tetrisConfig` | `gamesConfig.tetris` |
| `PianoFlashcards` | `flashcardsConfig` | `gamesConfig.flashcards` |
| `useGameMode` | `gameConfig` | `pianoAppConfig.game` |

Each game uses a different prop name for the same concept. A consistent `gameConfig` or `config` prop would simplify the interface contract.

**Recommendation:** Standardize to `gameConfig` across all games.

---

## V14 — `useMemo` Used as Ref Factory [P3: Anti-pattern]

**Locations:**
- `PianoFlashcards.jsx:31` — `const phaseRef = useMemo(() => ({ prev: game.phase }), [])`
- `PianoTetris.jsx:34` — `const prevPhase = useMemo(() => ({ current: game.phase }), [])`

Using `useMemo` with an empty dependency array as a `useRef` substitute is non-idiomatic. React does not guarantee `useMemo` memoization across renders (it's a performance optimization, not a semantic guarantee). `useRef` is the correct tool for mutable instance state.

**Recommendation:** Replace with `useRef`.

---

## Positive Patterns (Keep These)

| Pattern | Where | Why It's Good |
|---------|-------|---------------|
| Pure engine / React hook separation | tetrisEngine, flashcardEngine, gameEngine | Testable, portable logic isolated from React |
| Config-driven levels | piano.yml | Single file controls all difficulty progression |
| Shared ActionStaff component | Used by Tetris (6x) and Flashcards (1x) | True component reuse across games |
| Shared PianoKeyboard | Used by all 3 game modes + free play | Well-parameterized shared component |
| Comprehensive engine tests | tetrisEngine.test.js (70+), flashcardEngine.test.js (14), useStaffMatching.test.js | Pure function testing with good coverage |
| gameRegistry.js concept | Registry pattern for game discovery | Right pattern, just needs to be fully utilized |

---

## Recommended Refactor Priority

| Priority | Violations | Effort | Impact |
|----------|-----------|--------|--------|
| **Do first** | V1 (registry), V2 (activation), V10 (logging) | Medium | Eliminates dual systems, enforces standards |
| **Do second** | V3 (range calc), V4 (noteUtils), V7 (god component) | Medium | Major DRY + readability improvement |
| **Do third** | V5 (shuffle), V6 (pitch gen), V8 (naming), V9 (lifecycle) | Low-Med | Cleanup + discoverability |
| **Do last** | V11 (flashcard logging), V12 (health leak), V13 (props), V14 (useMemo) | Low | Polish |
