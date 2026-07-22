# Chord-Spelling Flashcards + Per-User Start Level — Design

**Date:** 2026-07-22
**Status:** Approved

## Problem

Piano Flashcards only drills staff reading (notes shown on a staff, player plays the
exact pitches). An advanced player (kckern) wants chord-spelling drills — the card
shows a chord *name* (e.g. `Dm`, `G7`) and the player must play the notes that spell
it — and wants their game to start there instead of at the beginner note-reading
levels.

## Decisions (from brainstorm)

- **New card type**, not a re-use of the staff levels: card shows a chord symbol only.
- **Full jazz vocabulary**: major, minor, diminished, augmented, sus2, sus4,
  dominant 7, major 7, minor 7 — laddered easy → mixed.
- **Matching is octave-free but root-sensitive**: correct = held pitch classes
  exactly equal the chord's pitch-class set (doubling allowed, no extras) AND the
  lowest held note is the root. `Cm` played with E♭ in the bass is `Cm/E♭` — wrong.
- **Ladder shape**: chord levels are appended after the existing 9 staff-reading
  levels for everyone; a per-user start-level map lets kckern begin at the first
  chord level. Kids still start at level 0.

## Config (`data/household/config/piano.yml` → `games.flashcards`)

```yaml
user_start_levels:
  kckern: "Major Chords"   # level name; unknown name or user → level 0
levels:
  # ...existing 9 staff-reading levels...
  - name: "Major Chords"
    card_type: chord
    qualities: [major]
    score_to_advance: 140
  # Minor Chords, Major vs Minor, Sus Chords, Dim & Aug, Dominant 7ths,
  # Major & Minor 7ths, Jazz Mix — see piano.yml for the full ladder
```

All 12 roots, sharp-spelled (matches `theory/chordNaming.js` convention). Symbols:
`C`, `Cm`, `C°`, `C+`, `Csus2`, `Csus4`, `C7`, `Cmaj7`, `Cm7`.

## Components

### `flashcardEngine.js` (pure, tested)

- `CHORD_QUALITIES` — interval templates + display suffixes for the nine qualities.
- `generateChordCard(qualities, prevCard)` → `{ type: 'chord', root, quality,
  label, pitchClasses }`; random root 0–11 + random quality from the level's list;
  never repeats the exact previous (root, quality) pair.
- `evaluateChordMatch(activeNotes, card)` → `idle | partial | wrong | correct`
  (same contract as `evaluateMatch`):
  - **wrong** — any held note whose pitch class is not a chord tone, OR all chord
    tones present but bass pitch class ≠ root (the `Cm/E♭` case).
  - **correct** — held pitch-class set == chord pitch-class set and bass == root.
  - **partial** — a proper subset of chord tones, no extras.
- `rootPositionVoicing(card, baseOctaveMidi)` — root-position MIDI pitches from C4
  region, for the post-hit keyboard highlight.

### `useFlashcardGame.js`

- New param `currentUser`; start level resolved by matching
  `config.user_start_levels[currentUser]` against level `name`. Game start AND the
  post-COMPLETE reset both return to that start level.
- `nextCard` branches on `levelConfig.card_type === 'chord'`.
- Match evaluation branches per card type; scoring/advance/attempt logic unchanged.

### `PianoFlashcards.jsx`

- Chord cards render a large chord symbol (small `ChordCard` presentational
  component) instead of `ActionStaff`.
- On hit, keyboard highlights the root-position voicing near C4 via the existing
  `targetNotes` mechanism; wrong-note flash unchanged.
- Keyboard range for chord levels: C3–C6 (`note_range` optional on chord levels).
- Accepts `currentUser` prop.

### `Games.jsx` (GameHost)

- Passes `currentUser` from `usePianoUser()` to the mounted game. Mount points
  without user context (visualizer overlay) pass nothing → level 0, no crash.

## Testing

- `flashcardEngine.test.js`: chord generation (qualities respected, no immediate
  repeats), matching (any octave OK, doubling OK, `Cm/E♭` wrong, extras wrong,
  subsets partial), voicing helper.
- Hook test for start-level resolution (named level, unknown user, no map).

## Out of scope (YAGNI)

Persistent per-user progress, inversion-required levels, flat spellings.

## Revision 2 (2026-07-22, after first live session)

Feedback from the first real attempt drove five changes:

1. **Root-based ladder** replaces the quality-partitioned one. Partitioning by
   chord type meant drilling one shape per level; now difficulty ramps by which
   ROOTS are in play (Just C → C F G → … → all 12) with qualities mixed within
   every level. Levels declare `roots:` (note names; omitted = all 12). Ninth
   qualities (9, maj9, m9) added to the vocabulary.
2. **Carryover guard (`awaitRelease`)** — a new card is not judged until all
   notes are released. Fixes the false red flash: holding the correct chord
   through the 400ms advance failed the next card against the old notes.
3. **Card face redesign** — a grand staff (`ChordStaffRenderer`) that starts
   empty and live-renders held notes, the tab-style symbol big (`Dm`), and the
   spelled-out name small and light ("D minor", via `longName`).
4. **Level picker** — the level block opens a modal listing all levels; picking
   one resets score, deals a fresh card, and persists per-user
   (`flashcardsLevel` preference, which outranks `user_start_levels`).
5. **Telemetry to info** — `card-shown` / `card-hit` / `card-miss` now ship to
   the backend with `held` notes and a miss `reason` (wrong-note | wrong-bass).
