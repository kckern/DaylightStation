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

Four chord tables exist, none shared, all running identification (pitches → name):

| Location | Contents | Exported |
|---|---|---|
| `frontend/src/modules/Piano/theory/chordNaming.js:32` `TEMPLATES` | 25 qualities, triads→9ths, with labels and scale degrees | no |
| `shared/music/consonance.mjs:42` `CHORD_TEMPLATES` | 18 root-relative pitch-class sets, loop-stacking gate | yes |
| `frontend/src/modules/Piano/PianoChessGame/chordAddress.js:31` `CHORD_QUALITIES` | 11 qualities with intervals + symbols | yes |
| `shared/music/chords.mjs` `parseChordSymbol` | symbol → root + coarse quality, no intervals | yes |

Nothing runs the inverse direction. `chordPitchClasses` yields `{0, 4, 7}`; turning that into `C4+E4+G4` rather than `C4+E5+G3`, voiced under one hand, does not exist anywhere.

## Decisions

1. **Shared SSOT, consumers keep their metadata.** A new shared module owns interval sets; `chordNaming.js` and `chordAddress.js` source intervals from it while keeping their own labels, degrees and board scheme. `consonance.mjs` is left alone — subset semantics, different job.
2. **Extend the ladder, root position before inversions.** Additive thresholds as today, with new rungs for inversions and 7th chords.
3. **Key per game, rotating with the ramp.** Accidentals arrive as a key signature, not as random chromatic notes.
4. **Close voicing only** (decided without discussion — it is the obvious default). Chord tones stacked adjacently bounds a triad at 9 semitones and a 7th at 11 by construction, so no separate span cap or rejection loop is needed.

---

## Architecture

### `shared/music/chordVocabulary.mjs` (new)

Pure, no DOM, no React — same constraints as its `shared/music/` siblings, importable from frontend and backend.

**`QUALITIES`** — frozen table keyed by quality name, each `{ intervals, symbol, name, size }`. `intervals` are semitones above root, the shape all three current tables already use. Contents are the union of what consumers need: triads (major, minor, diminished, augmented, sus2, sus4), sixths, and the 7th family (maj7, dom7, min7, min7♭5, dim7).

**`DYAD_INTERVALS`** — consonant-interval whitelist that exists nowhere today: m3, M3, P4, P5, m6, M6, octave. Seconds, sevenths and the tritone are excluded by omission.

**`voiceChord(rootPc, quality, { range, inversion, rng })`** — the missing inverse. Returns ascending MIDI pitches in close voicing within `range`.

### Migration

Intervals-only and mechanical. Neither consumer's table *contents* move, so the chess board addressing and the naming tiers cannot drift:

- `chordNaming.js` keeps its `TEMPLATES` rows — it needs `label` and `degrees`, and its 9th / ♯11 entries are naming-only — but sources `intervals` from `QUALITIES`.
- `chordAddress.js` keeps `DEFAULT_CHORD_SCHEME` and its 11-quality selection, sourcing intervals the same way.

---

## Card generation

`computeProgression(linesCleared, config)` gains rungs and returns a key:

```
thresholds: { treble: 1, bass: 2, dyad: 3, triad: 5,
              inversions: 7, sevenths: 9, accidentals: 11 }
→ { noteRange, unlockedSizes, allowInversions, key }
```

| Lines | Unlocks | Example card |
|---|---|---|
| 0 | single notes, treble, white keys | `G4` |
| 2 | bass clef range opens | `F3` |
| 3 | consonant dyads | `C4+E4` |
| 5 | root-position triads | `C4+E4+G4` |
| 7 | inversions | `E4+G4+C5` |
| 9 | 7th chords | `C4+E4+G4+B4` |
| 11 | accidentals (non-C keys) | `F#4+A4+C#5` |

Below the `accidentals` rung, `key` is C major — reproducing today's white-keys-only behavior as a consequence of the key rather than a separate flag. At and above it, the game draws a key per game from a widening circle-of-fifths window, reusing `Piano/theory/circleOfFifths.js`.

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

This is a latent bug today, not a new one: the existing fallback path already permits cross-staff pitch reuse when the pool is tight, so a subset pair can already reach the board.

**Rejected alternative:** dropping `allowExtras` for exact matching. A sustain pedal or a ringing note would then block every card.

---

## Testing

**Round-trip property (the important one).** For every quality × 12 roots × every inversion, `voiceChord` output fed to `identifyChord` must return the same root and quality. This proves the generator and the namer agree, and is what makes the shared table meaningful rather than decorative.

**Board property tests**, at each progression rung:
- the anti-subset invariant holds
- every pitch is diatonic to the key
- every pitch lies inside `noteRange`
- no card spans more than 11 semitones
- zero unnameable triads (replacing the 74.7% measured today)

**Migration guard.** `chordNaming.test.js` and the chess `chordAddress` tests (`chordBoard`, `findChordCollisions`) must pass **unchanged**. If intervals-only sourcing is behavior-preserving, they will.

---

## Rollout

- `piano.yml` gains the new thresholds; old keys keep working.
- Remove the dead `levels[].complexity` / `note_range` / `white_keys_only` fields — they have not driven card generation since the progression model landed, and their comments actively mislead (`"Lvl 4: Dyads with full chromatic"` describes behavior that no longer happens).
- Deploy requires an image rebuild. `git pull` plus `docker restart` ships nothing here.

### Blocker to clear before coding

Local `main` is 18 commits behind `origin/main`, and the homeserver deploy tree moved twice during the design conversation (now at `eaf9865fe`, a chess UI commit). Chess is under active development and this change touches `chordAddress.js`. Sync first per `CLAUDE.local.md`, then branch.

---

## Out of scope

- **Key signature rendering.** `SvgStaffRenderer` takes only `targetPitches` / `activeNotes` / `matched` and draws per-note accidentals; it has no key-signature support. A G major chord will render with an inline `F♯`, which is correct if not idiomatic. Adding a key signature to the staff is a separate, additive change.
- `consonance.mjs` migration — deliberately excluded, see Decisions.
