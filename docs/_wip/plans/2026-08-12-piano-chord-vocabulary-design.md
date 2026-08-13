# Shared Piano Chord Vocabulary — Design

**Date:** 2026-08-12
**Status:** Design agreed, not implemented
**Motivation:** PianoTetris command cards generate musically incoherent dyads and triads, many of them unplayable with one hand.

---

## Problem

`useStaffMatching.js`'s `pickChordCluster` picks a random unused anchor pitch, then draws the remaining notes uniformly at random from the octave above it. The only musical constraint in the whole path is `MAX_CHORD_SPAN_SEMITONES = 12`.

Measured over 4000 generated boards (6 staves each) using the real generator:

| Stage | Finding |
|---|---|
| Dyads, white-key | 21.7% are seconds, 14.0% are sevenths or the tritone, 20.5% span more than a major sixth |
| Triads, white-key | **74.7% are not a recognizable chord** in any inversion; 19.8% contain the same note name twice; 38.7% span more than 9 semitones; 12.5% are tight clusters |
| Triads, chromatic | 80.9% unrecognizable |

Representative output: `C3+F3+B3`, `A3+D4+E4`, `F3+B3+F4`, `G5+G#5+A5`, `C#4+D4+G#4`.

The white-keys-only stage keeps everything accidentally in C major. That guardrail disappears entirely once accidentals unlock — nothing then keeps the notes in any key.

## Existing vocabularies

Five chord tables exist, none shared:

| Location | Contents | Exported |
|---|---|---|
| `frontend/src/modules/Piano/theory/chordNaming.js:32` `TEMPLATES` | 28 qualities, triads→9ths, with labels and scale degrees | no |
| `shared/music/consonance.mjs:42` `CHORD_TEMPLATES` | 18 root-relative pitch-class sets, loop-stacking gate | yes |
| `frontend/src/modules/Piano/PianoChessGame/chordAddress.js:31` `CHORD_QUALITIES` | 11 qualities with intervals + symbols | yes |
| `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js:47` `CHORD_QUALITIES` | 12 qualities with intervals + suffix + long name | yes |
| `shared/music/chords.mjs` `parseChordSymbol` | symbol → root + coarse quality, no intervals | yes |

The flashcard table's own comment says "Interval templates match theory/chordNaming.js" — the duplication is known and undocumented anywhere central.

**One voicing function already exists**: `flashcardEngine.js:164` `rootPositionVoicing(card, baseMidi)` maps (root, quality) → MIDI pitches, consumed at `PianoFlashcards.jsx:89`. It is `baseMidi + root + interval` — root position only, no inversion control, and no range clamp, so a high root pushes the chord out of any intended window. `voiceChord` supersedes it rather than duplicating it; see Migration.

Checked deliberately: **no two tables define the same quality with different intervals** (`dominant7` / `seventh` / `dom7` are all `[0,4,7,10]`; `add2` / `add9` are both `[0,2,4,7]`), so a union is feasible without changing anyone's behavior.

## Decisions

1. **Shared SSOT, consumers keep their metadata.** A new shared module owns interval sets; `chordNaming.js` and `chordAddress.js` source intervals from it while keeping their own labels, degrees and board scheme. `consonance.mjs` is left alone — subset semantics, different job.
2. **Extend the ladder, root position before inversions.** Additive thresholds as today, with new rungs for inversions and 7th chords.
3. **Key per game, rotating with the ramp.** Accidentals arrive as a key signature, not as random chromatic notes.
4. **Close voicing only** (decided without discussion — it is the obvious default). Chord tones stacked adjacently bounds every chord at **11 semitones** in any inversion, so no separate span cap or rejection loop is needed. (An earlier draft claimed 9 for triads; that is false for sus chords — sus2 1st inversion `D4-G4-C5` and sus4 2nd inversion both span 10. It happens not to matter in-game, because degree-built generation never emits sus chords, but the bound to state is 11.)

---

## Architecture

### `shared/music/chordVocabulary.mjs` (new)

Pure, no DOM, no React — same constraints as its `shared/music/` siblings, importable from frontend and backend.

**`QUALITIES`** — frozen table keyed by quality name, each `{ intervals, symbol, name, size }`. `intervals` are semitones above root, the shape every current table already uses. Contents are the union of what all four interval-bearing consumers need:

| Group | Qualities |
|---|---|
| Triads | major `[0,4,7]`, minor `[0,3,7]`, diminished `[0,3,6]`, augmented `[0,4,8]`, sus2 `[0,2,7]`, sus4 `[0,5,7]` |
| Added-tone | **add2/add9 `[0,2,4,7]`**, add6/sixth `[0,4,7,9]`, minor6 `[0,3,7,9]` |
| 7ths | maj7 `[0,4,7,11]`, dom7 `[0,4,7,10]`, min7 `[0,3,7,10]`, min7♭5 `[0,3,6,10]`, dim7 `[0,3,6,9]` |
| 9ths | dom9 `[0,2,4,7,10]`, maj9 `[0,2,4,7,11]`, min9 `[0,2,3,7,10]` |
| Dyad | power `[0,7]` |

`add2` is not optional: `DEFAULT_CHORD_SCHEME` (`chordAddress.js:68`) lists it as a live quality on the chess board, so omitting it makes the chess migration impossible. The 9ths are there for the flashcard table, which uses all three.

**Staying local to `chordNaming.js`** — naming-only rows with no other consumer: `major7sharp11`, `addSharp11`, `six9`, `minorMajor7`, `augmented7`, `dominant7b5`, `dominant7sus4`, `add4`, `minorAdd4`, `minorAdd9`.

**`DYAD_INTERVALS`** — consonant-interval whitelist that exists nowhere today: m3, M3, P4, P5, m6, M6, octave. Seconds, sevenths and the tritone are excluded by omission.

**`voiceChord(rootPc, quality, { range, inversion, rng })`** — the missing inverse. Returns ascending MIDI pitches in close voicing within `range`.

### Migration

Intervals-only and mechanical. No consumer's table *contents* move, so the chess board addressing and the naming tiers cannot drift:

- `chordNaming.js` keeps its `TEMPLATES` rows — it needs `label` and `degrees` — but sources `intervals` from `QUALITIES` for every row that has a shared entry.
- `chordAddress.js` keeps `DEFAULT_CHORD_SCHEME` and its 11-quality selection, sourcing intervals the same way.
- `flashcardEngine.js` keeps `suffix` / `longName` and sources intervals the same way. Its `rootPositionVoicing` is **retired** in favour of `voiceChord(root, quality, { range, inversion: 0 })`, which is a superset of its behavior — this is the one call-site change in the migration, and `PianoFlashcards.jsx:89` is its only consumer.

---

## Card generation

### The ramp axis has to change

Lines cleared is the wrong accumulator. Measured from a full day of prod telemetry (6 games, captured before the container restart wiped it):

| Game | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Lines cleared | 0 | 1 | 0 | 0 | **5** | 0 |
| Pieces placed | 10 | 19 | 8 | 3 | 14 | 4 |

Four of six games cleared **zero** lines. The existing top rung (accidentals at 7) has never been reached by anyone. Hanging new headline features off 9 and 11 lines would make them dead code.

Clearing a line is a *skill outcome* a beginner rarely achieves; placing a piece accumulates steadily regardless. So the ramp moves to **pieces placed**, calibrated to the observed 3–19 per game:

`computeProgression(piecesPlaced, config)` returns `{ noteRange, unlockedSizes, allowInversions, key }`.

| Pieces | Unlocks | Example card |
|---|---|---|
| 0 | single notes, treble, C major | `G4` |
| 3 | bass clef range opens | `F3` |
| 5 | consonant dyads | `C4+E4` |
| 8 | root-position triads | `C4+E4+G4` |
| 12 | inversions | `E4+G4+C5` |
| 16 | 7th chords | `C4+E4+G4+B4` |
| 22 | other keys (accidentals) | `F#4+A4+C#5` |

Under these, game 2 (19 pieces) would have reached 7th chords and game 5 (14 pieces) inversions — instead of both topping out at singles and one lone triad rung. `tetris.lines-cleared` keeps driving score and level; only the musical ramp moves axis.

n=6 is a thin sample. See Rollout — the telemetry needs somewhere durable to land before these numbers are treated as settled.

Below the top rung, `key` is C major — reproducing today's white-keys-only behavior as a consequence of the key rather than a separate flag. At and above it, the game draws a key per game from a widening circle-of-fifths window, reusing `Piano/theory/circleOfFifths.js`.

Per staff, replacing `pickChordCluster` entirely:

- **Size 1** — a diatonic scale degree in range.
- **Size 2** — a scale degree plus a `DYAD_INTERVALS` partner that is also diatonic to the key; non-diatonic candidates are filtered, not resampled blindly.
- **Size 3 / 4** — a scale degree as root, with the quality **the key gives at that degree** (I major, ii minor, vii° diminished, V7…). Diatonic correctness falls out of the key rather than needing a filter, and the player meets minor and diminished chords in their natural habitat.
- **Inversion** — 0 while the inversions rung is locked; otherwise random within the chord's size.
- **`voiceChord`** places it in `noteRange`.

`assignChordSizes` is unchanged. The additive-pool behavior — six staves each drawing independently from unlocked sizes, so a board is a mix rather than a wall of the newest size — is right and stays.

---

## The subset hazard

Matching runs `classifyHeldNotes(..., { allowExtras: true })`: a card fires when the held notes are a **superset** of its targets.

Today that is safe by accident. `pickChordCluster` marks every chosen pitch `used`, so all six staves are pitch-disjoint, and disjoint sets cannot be subsets of one another.

Diatonic chords break the guarantee. Chords in a key deliberately share tones — C major and E minor share E and G; the dyad C+E is a subset of the C major triad. The arithmetic also fails: at the sevenths rung six staves need up to 24 distinct pitches, but a diatonic key across MIDI 48–81 offers roughly 20. The old rule would fall through to `pickChordCluster`'s reuse-allowed fallback and start emitting subset pairs — one press firing two actions.

Disjointness is therefore replaced by the invariant that actually matters:

> **No card's pitch set may be a subset of any other card's on the same board.**

Symmetric, so it covers both directions, and it subsumes exact duplicates. Implemented as reject-and-redraw with a bounded retry count, falling back to a smaller size for the offending staff rather than looping.

**Is this reachable today?** The matcher permits it, but it was not observed: 120,000 generated boards (mixed sizes, all-triads at pool 20, and at pool 19) produced **zero** subset pairs. The structural reason is that while any unused pitch remains, the fallback anchor is itself unused, so the fallback chord carries a pitch no other card has; and largest-first ordering places the multi-note chords while the pool is still fresh. So this is a hazard the diatonic generator introduces, not a bug being carried forward — an earlier draft called it "a latent bug today", which overstates what could be demonstrated.

**Rejected alternative:** dropping `allowExtras` for exact matching. A sustain pedal or a ringing note would then block every card.

---

## Testing

**Round-trip property (the important one), as corrected.** The naive form — every quality × 12 roots × *every inversion* must name back identically — is unsatisfiable, and asserting it would contradict the promise to leave `identifyChord` behavior unchanged. `identifyChord` resolves shared pitch-class sets by the bass, which its header documents as deliberate (`chordNaming.js:14-21, 55-61`). Measured against the real namer over the diatonic qualities this generator can emit (7 qualities × 12 roots × every inversion = 300 cases): **228 pass, 72 fail**. All 108 triad cases pass in every inversion. The 72 failures are exactly two ambiguous pairs, both by design:

- `minor7` inversions name as the `sixth` a minor 3rd below — `C-E♭-G-B♭` 1st inversion reads "E♭ 6"
- `minor7♭5` inversions name as `minor6` likewise

So the property splits in two:

1. **Always** — the pitch-class set of `voiceChord(root, quality, …)` equals that quality's set transposed to that root. Unconditional, all qualities, all inversions.
2. **Where the reading is unique** — `identifyChord` returns the same root and quality. The ambiguous pairs above are enumerated as accepted alternate readings rather than excepted silently.

Gameplay impact of the ambiguity is nil: cards are never labelled, and matching is by pitch, so a player reading a min7 1st inversion as "E♭ 6" plays exactly the same keys. It is a test-design constraint, not a playability one.

**Board property tests**, at each progression rung:
- the anti-subset invariant holds
- every pitch is diatonic to the key
- every pitch lies inside `noteRange`
- no card spans more than 11 semitones
- zero unnameable triads (replacing the 74.7% measured today)

**Migration guard.** `chordNaming.test.js`, the chess `chordAddress` tests (`chordBoard`, `findChordCollisions`), and `flashcardEngine.test.js` must pass **unchanged**. If intervals-only sourcing is behavior-preserving, they will.

---

## Rollout

- `piano.yml` gains the new thresholds; old keys keep working.
- Remove `levels[].complexity` / `white_keys_only` — they have not driven card generation since the progression model landed, and their comments actively mislead (`"Lvl 4: Dyads with full chromatic"` describes behavior that no longer happens). Note `levels[].note_range` is **not** unused: `PianoTetris.jsx:32` reads it as the keyboard display range before the first spawn populates `activeNoteRange`. Keep it or move that fallback.
- Deploy requires an image rebuild. `git pull` plus `docker restart` ships nothing here.

### Persist the telemetry first

The thresholds above rest on n=6. They can't be firmed up because **Tetris telemetry does not survive a restart**: `tetris.*` events reach only the container console (the session-file transport requires a `sessionLog` flag these events don't set), so a restart wipes the record. The prod container restarted mid-design and every event analysed here vanished with it; the numbers in this document exist only because they were captured beforehand.

Before treating the ramp as tuned, set `sessionLog` on the Tetris lifecycle events so `tetris.game-over` / `lines-cleared` / `piece-locked` land in `media/logs/piano/`, then read a fortnight of real distributions.

### Sync state

Resolved during review. Local `main`, `origin/main` and the homeserver deploy tree (`0a9f11201`, a merge of `origin/main` ahead of the chess layout deploy) are all level — 0 ahead, 0 behind. An earlier draft said "18 commits behind"; that reading was stale. Chess remains under active development and this change touches `chordAddress.js`, so re-check immediately before branching.

---

## Out of scope

- **Key signature rendering.** `SvgStaffRenderer` takes only `targetPitches` / `activeNotes` / `matched` and draws per-note accidentals; it has no key-signature support. A G major chord will render with an inline `F♯`, which is correct if not idiomatic. Adding a key signature to the staff is a separate, additive change.
- `consonance.mjs` migration — deliberately excluded, see Decisions.

---

## Review record

Adversarially reviewed 2026-08-12 before implementation; verdict fix-first, no blockers. Findings accepted and folded in above: the missed fifth vocabulary and existing `rootPositionVoicing`, the unsatisfiable round-trip property, the `add2` omission that would have broken the chess migration, the overstated "latent bug today", the wrong triad span bound, and the stale sync numbers. The measured statistics in Problem were independently reproduced (74.5–75.0% against the claimed 74.7%). The unreachable-thresholds finding was raised as unverifiable and is verified here from the pre-restart capture — it is the one change of substance rather than correction.
