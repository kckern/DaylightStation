# PianoTetris — line-driven musical progression

**Date:** 2026-06-02
**Status:** Implemented
**Touches:** `frontend/src/modules/Piano/PianoTetris/`

## Problem

PianoTetris difficulty is meant to ramp (treble → bass clef → dyads → triads →
accidentals), and the config already described that ramp via the `levels` array.
But musical complexity was gated by `level = Math.floor(linesCleared / 10)`, so:

| Feature | Old gate | Lines needed |
|---------|----------|--------------|
| Bass clef | level 2 | 20 lines |
| Dyads | level 3 | 30 lines |
| Triads | level 6 | 60 lines |
| Max | level 9 | 90 lines |

In a normal game you rarely clear 10 lines, so play stayed at level 0 forever
(single notes, C4–C5, white keys, treble). The ramp was effectively unreachable.

## Goal

Make musical complexity escalate on **single-digit cumulative lines cleared**,
with each tier *adding* to the pool of possibilities rather than replacing it.

Thresholds (cumulative lines cleared in the current game; resets each game):

| Lines | Unlocks |
|-------|---------|
| 0–1 | Treble clef, single notes, white keys (baseline) |
| 2+ | Note range extends below C4 → **bass-clef** staves appear |
| 3+ | **Dyads** join the chord-size pool |
| 5+ | **Triads** join the chord-size pool |
| 7+ | **Sharps/flats** (accidentals) enabled |

## Key decisions

- **Additive, not forced.** Once a chord size unlocks, it is *added* to the pool
  of possible sizes. Each of the 6 staves is then independently a random pick
  from the unlocked sizes. A board at 5+ lines is a random blend (e.g. mostly
  singles with a couple triads) — never a uniform wall of the newest size.
- **Configurable with hardcoded fallback.** Thresholds and ranges live in
  `piano.yml` under `games.tetris.progression`; any omitted field falls back to
  the hardcoded `DEFAULT_PROGRESSION`. The feature works with zero config change.
- **Gravity ramp untouched.** Fall speed stays on its own independent ramp
  (`levels[floor(lines/10)].gravity_ms`). Musical complexity and speed are two
  orthogonal difficulty axes. The per-level `note_range` / `complexity` /
  `white_keys_only` fields are now **dead for tetris** — only `gravity_ms` (and
  the `target_rotation` / `target_change_ms` timing fields) are still read.
- **Keyboard follows the active range.** The on-screen keyboard widens when bass
  clef unlocks, driven by the hook's new `activeNoteRange`.

## Config

```yaml
games:
  tetris:
    progression:                                    # optional — these are the defaults
      thresholds: { treble: 1, bass: 2, dyad: 3, triad: 5, accidentals: 7 }
      treble_range: [60, 81]   # C4–A5  (entirely treble; baseline)
      bass_range:   [48, 81]   # C3–A5  (low notes <C4 render in bass clef)
    levels:                    # unchanged — now only gravity_ms / rotation fields are read
      - { gravity_ms: 1200 }
      - { gravity_ms: 1000 }
      ...
```

`treble` threshold is the always-on baseline (the treble range is used whenever
lines < `bass`); it is included for completeness/tuning.

## Implementation

Pure functions (TDD) in `useStaffMatching.js`:

- `DEFAULT_PROGRESSION` — hardcoded fallback (thresholds + ranges).
- `computeProgression(linesCleared, config?)` → `{ noteRange, unlockedChordSizes, whiteKeysOnly }`.
  Merges partial config over defaults.
- `assignChordSizes(unlockedSizes, numStaves)` → per-staff random pick from the
  unlocked pool (the additive mix).
- `generateTargets(noteRange, complexity, whiteKeysOnly)` — generalized to accept
  a **per-staff count array** in addition to the legacy `'single'|'dyad'|'triad'`
  string. Sequential slicing from a shuffled note pool preserves the
  "no two staves share a note" guarantee; falls back to singles when the pool is
  too small for the requested chords.

Hook wiring in `useTetrisGame.js`:

- `regenerateTargets(linesCleared)` now computes the progression and feeds a
  random per-staff size array into `generateTargets`; stores `activeNoteRange`.
- All regeneration call sites (per-piece spawn, timer rotation, match rotation,
  initial PLAYING) pass the current `gameState.linesCleared`.
- New `activeNoteRange` is returned and reset on deactivate / game-over.

`PianoTetris.jsx`: keyboard range derives from `game.activeNoteRange` (falling
back to the level's `note_range`, then C4–C5).

## Tests

`useStaffMatching.test.js` — `computeProgression` threshold boundaries (1/2/3/5/7)
+ custom-config override + partial-merge; `assignChordSizes` additive-mix
semantics (only unlocked sizes, every unlocked size reachable); `generateTargets`
per-staff size array + no-duplicate guarantee. All existing tetris tests
unchanged and green (197 Piano tests pass).
