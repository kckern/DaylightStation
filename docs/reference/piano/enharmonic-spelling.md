# Enharmonic Spelling

**Module:** `frontend/src/modules/MusicNotation/model/spelling.js`
**Consumers:** the live grand staff, the chord-name plaque, the flashcard engine
**Status:** implemented, unit-tested, reviewed and revised, not yet verified on the kiosk

How the app decides whether a black key is called **B♭** or **A♯**.

---

## 1. Problem

`chordNaming.js` held a single hardcoded table:

```js
const PITCH_CLASS_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
```

Sharp-only, no key input, used for both chord roots and slash basses. Pitch class 10
was therefore *always* "A#".

Two defects followed:

- **Wrong by convention.** B♭ major needs 2 flats. A♯ major needs 10 sharps and a
  double-sharp third (A♯–C𝄪–E♯), and is essentially never written. The panel was
  printing the rare spelling for one of the most common roots in music.
- **Self-contradiction.** The staff spelled key-aware (`midiToVexKey` used flats in flat
  keys) while the plaque did not. Playing a B♭ triad in F major drew **B♭ D F** on the
  staff and printed **"A# major"** on the plaque, in the same component, inches apart.

## 2. Background: what spelling actually encodes

A pitch class is a sound; a note name is notation. Twelve pitch classes, twenty-one
usable names (7 letters × ♭/♮/♯, before double accidentals). In equal temperament B♭ and
A♯ are the same key, so the choice carries no acoustic information — it encodes
*function*: which degree of the key the note is, and which way it leans.

Five inputs govern it in practice, roughly in order of force.

**2.1 Chords must alternate letters.** A tertian chord is a stack of thirds, so it uses
every other letter, once each.

| | root | 3rd | 5th | letters |
|---|---|---|---|---|
| B♭ major | B♭ | D | F | B–D–F |
| A♯ major | A♯ | **C𝄪** | E♯ | A–C–E |

Both alternate correctly; A♯ needs a double sharp. The tiebreaker is accidental
parsimony, and B♭ wins outright. Note the rule is quality-sensitive — A♯ *minor* is
A♯–C♯–E♯ with no double sharps and is legitimately spellable.

**2.2 Key context.** Inside a key the scale degree fixes the letter. In F major the IV
chord is B♭, because the 4th degree of the F scale is B♭; calling it A♯ would put two
B-ish letters in the scale and none on B. In B major, A♯ is the leading tone. Same
sound, opposite spelling, decided entirely by surroundings.

**2.3 Key-signature economy.** Absent local context, convention picks whichever spelling
implies the simpler key signature. That one rule reproduces the standard answers:

| pc | major | minor |
|---|---|---|
| 1 | **D♭** (5♭) over C♯ (7♯) | **C♯m** (4♯) over D♭m (8♭) |
| 3 | **E♭** (3♭) over D♯ (9♯) | E♭m (6♭) / D♯m (6♯) — tie |
| 6 | F♯ (6♯) / G♭ (6♭) — tie | **F♯m** (3♯) over G♭m (9♭) |
| 8 | **A♭** (4♭) over G♯ (8♯) | **G♯m** (5♯) over A♭m (7♭) |
| 10 | **B♭** (2♭) over A♯ (10♯) | **B♭m** (5♭) over A♯m (7♯) |

Row 10 is the most lopsided in the table, which is why the original defect was so
visible.

**2.4 Quality flips the answer.** Rows 1 and 8 above: the same black key is **A♭ major**
but **G♯ minor**, **D♭ major** but **C♯ minor**. A table indexed by pitch class alone
cannot be right.

**2.5 Voice leading and idiom.** Weaker but real: sharps tend to resolve upward and
flats downward (a rising chromatic line is A♯→B, a falling one B♭→A). Genre leans too —
flat keys dominate jazz, blues, hymnody and wind band; sharp keys dominate guitar-driven
rock.

## 3. Available inputs

| Input | Available? | Notes |
|---|---|---|
| Detected key | **Yes** | `useDetectedKey` — rolling 30-note / 10s buffer, already fed to the circle and staff |
| Chord quality | **Yes** | `identifyChord` returns it |
| Recent history | **Yes** | the note flow retains the last 8 columns |
| Following note | **No** | a live display doesn't know what comes next |

Voice leading (2.5) needs the note *after* the one being spelled, so it is out of scope.
Everything else is reachable.

## 4. Decision

A chord is spelled as a unit; its ROOT (and any lone note) is spelled by three tiers,
strongest signal first, the first that applies winning.

### Tier 0 — a chord is spelled as a UNIT

Tiers 1–3 pick the root. The rest of the chord does **not** go through them, because
spelling notes one at a time cannot honour the strongest rule in §2.1 — per-note spelling
produced G♯ minor as **A♭–B–E♭**, three letters that stack in no triad, under a plaque
reading "G♯ minor".

`spellChord(root, toneDegrees, opts)` gives every other tone the letter its DEGREE
demands — a 3rd is two letters up from the root, a 7th is six — with whatever alteration
makes the pitch right. `identifyChord` returns the resulting map as `chord.spelling`, and
the staff uses it in preference to the per-note tiers.

This is why a chord tone can out-vote the key: the seventh of a C7 is spelled B♭ even in
B major, because C–E–G–A♯ is an augmented sixth, not a dominant seventh.

**Double accidentals are dropped, deliberately.** The honest spelling of a diminished
7th is a ♭♭7 (C dim7 = C–E♭–G♭–B𝄫). Correct, and unreadable on a kiosk a child uses, so
tones needing a double accidental fall back to the per-note tiers and print the familiar
enharmonic (A instead of B𝄫). This display mirrors a keyboard; it is not an engraving
tool.

### Tier 1 — in the key, the key decides

If the pitch class is in the detected key's scale, spell it the way that key spells it.
The seven spellings are **derived from the key name**, not read from a table: a major
scale is fully determined by its tonic — seven consecutive letters, each used once, with
whatever alteration makes each pitch right. That is what produces E♯ for F♯ major and C♭
for G♭ major, spellings no 12-entry pitch-class table can hold. It also means tier 1 does
not depend on `KEY_SIGNATURES.scale`, which had G♭ major's scale byte-identical to D♭'s.

```
F major  → pc 10 is the 4th degree      → B♭
B major  → pc 10 is the leading tone    → A♯
E♭ major → pc 3, 8, 10                  → E♭, A♭, B♭
A major  → pc 1, 6, 8                   → C♯, F♯, G♯
```

This tier fires for the large majority of notes played.

### Tier 2 — chromatic notes lean by scale DEGREE

For a pitch class outside the key, the lean is decided by its interval above the tonic,
not by its absolute pitch class:

| Degree | Reading | Leans |
|---|---|---|
| +1 | ♯1 — chromatic rise into 2 | **sharp** |
| +3 | ♭3 — the blues / borrowed third | **flat** |
| +6 | ♯4 — third of V/V, the most common chromatic note in any major key | **sharp** |
| +8 | ♭6 — borrowed from the parallel minor | **flat** |
| +10 | ♭7 — mixolydian / dominant seventh | **flat** |

Degree-relative is the point of the design, and the reason a simple "prefer flats" fix
was rejected. The same pitch class must spell differently by context:

```
pc 3 in C  → +3  → ♭3  → E♭
pc 3 in A  → +6  → ♯4  → D♯
pc 6 in C  → +6  → ♯4  → F♯
pc 6 in A♭ → +10 → ♭7  → G♭
pc 1 in E♭ → +10 → ♭7  → D♭
```

Any fixed per-pitch-class table, sharp or flat, gets one of each pair wrong.

### Tier 3 — quality breaks the two ties (chord roots only)

Two degrees are ties the degree lean gets wrong, and both are really statements about
which KEY the root implies:

| Degree | Quality | Spelling | Why |
|---|---|---|---|
| +8 | minor | **G♯ minor** | 5 sharps vs A♭ minor's 7 flats, which is never written |
| +1 | major | **D♭ major** | 5 flats vs C♯ major's 7 sharps |

Tier 3 needs a chord to apply to. A **lone note has no quality** and takes the tier-2
lean, so a passing C♯ in C major stays C♯ rather than becoming a D♭. That distinction is
carried by `rootQuality: 'major' | 'minor' | null` — `null` means "just a note", and it
is not the same as major.

Slash basses take no quality of their own: a bass note is a scale degree, not a chord.

## 5. API

```js
spellPitchClass(pc, { keySignature = 'C', rootQuality = null })
  → { letter: 'B', alter: -1 }        // alter: -1 ♭ | 0 ♮ | +1 ♯

spellChord(root, [[semitones, degree], …], opts)
  → Map<pitchClass, { letter, alter }>   // the whole chord, stacked in thirds

spellNoteName(pc, opts)  → 'B♭'       // display form, real ♯/♭ glyphs
accidentalGlyph(alter)   → '♭'
isMinorish(quality)      → true for minor*/diminished* qualities
rootQualityOf(quality)   → 'major' | 'minor' | null   (the single mapping; don't inline it)
```

Chord templates in `chordNaming.js` carry a `degrees` array parallel to `intervals`, so
the speller knows a ♯11 from a ♭5.

`pc` is reduced mod 12, so any integer is safe. An unknown or missing key falls back to
C. Display names use real ♯/♭ glyphs, matching the chord labels that already did
(`'minor 7 ♭5'`).

## 6. Integration

| Consumer | Call | Key source |
|---|---|---|
| Staff (`chordStaff.js`) | `midiToVexKey(m, key, chord.spelling)` | `detectedKey` via `CurrentChordStaff`, which runs `identifyChord` per column |
| Plaque (`chordNaming.js`) | `identifyChord(notes, key)` → root + bass | `detectedKey` via `TheoryPanel` |
| Flashcards (`flashcardEngine.js`) | `spellNoteName` for card labels | none — conventional spelling |

`TheoryPanel` owns the single `useDetectedKey` read and passes it to all three of the
circle, the staff, and the plaque, so they cannot drift apart.

**`midiToVexKey` octave correction.** The octave comes from the pitch, but a spelling can
cross an octave boundary: pitch class 11 spelled C♭ belongs to the octave *above* its B,
and pitch class 0 spelled B♯ to the octave *below*. This is reachable — G♭ major spells
pitch class 11 as C♭ — so the adjustment is live behaviour, not defensive code. (It was
dead until tier 1 learned to derive exotic spellings.)

**Flashcard config parsing is deliberately separate.** `flashcardEngine.js` keeps its own
ASCII name→pitch-class table so `piano.yml` levels can write `roots: [Bb, Eb]` or
`[A#, D#]` and mean the same keys. That table reads YAML; it never spells display text.
The two concerns were previously fused in `PITCH_CLASS_NAMES`, which is why deleting that
export broke the flashcard engine.

## 7. Invariants and test coverage

`model/spelling.test.js` (18 tests) covers each tier, the cross-key degree cases, the
quality split, and mod-12 / unknown-key handling.

`theory/chordNaming.test.js` adds wiring tests plus the invariant that motivated the
work:

> **The plaque and the staff never disagree.** For 5 chord shapes (major, minor,
> diminished, dominant 7, minor 7) × 12 roots × 13 key signatures, the root name printed
> on the plaque equals the note the staff draws for that pitch.

The shapes matter. A first version of this test swept **major triads only** — the one
subset where the quality-sensitive tier-3 rules can never fire — so it passed while the
plaque read "G♯ minor" over a staff drawing A♭–B–E♭. A test that cannot fail on the class
of bug it was written for is worse than no test, because it stops people looking.

A companion test asserts chords spell as a stack of thirds: G♯ minor → G–B–D letters,
D♭ major → D–F–A. Two specific regressions are pinned:

- `name(10, key)` is **B♭** in C, F, B♭, E♭, A♭, D♭, G, D — and **A♯** only in B and F♯.
- A B natural is never spelled B♭ (see §9).

## 8. Rejected alternatives

| Alternative | Why not |
|---|---|
| Flip the table to flats | Breaks the ♯4 — the most common chromatic note in any key. F♯ in C would become G♭, D♯ in A would become E♭. |
| Fixed per-pitch-class table, either polarity | Cannot satisfy pc 3 = E♭ in C and D♯ in A simultaneously. Degree-relative is the minimum that works. |
| Spell from the chord's own intervals | Works for isolated chords, but gives no answer for a single note and ignores the key the player is actually in. |
| Full voice-leading resolution | Needs the following note; a live display doesn't have it. See §9. |
| Leave the plaque sharp, fix only the staff | Preserves the visible self-contradiction, which was half the complaint. |
| Spell each note independently, key-aware | What shipped first. Cannot honour §2.1: G♯ minor came out A♭–B–E♭. The chord has to be spelled as a unit. |
| Pass chord quality down to the staff per note | Fixes the ROOT only; the third and fifth still come from per-note rules, so the letters still fail to alternate. |

## 9. Known limitations

- **No voice-leading.** A chromatic note resolving against its usual direction gets the
  conventional spelling rather than the locally correct one — a descending ♭2 shows as
  ♯1. Fixing this needs the note *after* it. The note flow retains the last 8 columns,
  so the history exists if it becomes worth using.
- **Key detection lags.** `useDetectedKey` needs a few notes before it settles, so the
  first chord of a phrase in a new key may be spelled against the previous one.
- **Ties are resolved by convention, not context.** pc 6 major (F♯/G♭) and pc 3 minor
  (E♭m/D♯m) are genuine 6-vs-6 ties; tier 2 picks one.
- **No double accidentals.** Deliberate, not an oversight — see Tier 0. A diminished 7th
  prints its ♭♭7 as the enharmonic natural.
- **A trap for future edits:** parse accidentals from a spelling *positionally*. The
  letter `b` is itself a `'b'`, so `spelling.includes('b')` marks every B natural as a B
  flat — a bug that shipped briefly and drew spurious ♭ glyphs on the staff.

## 10. Related

- `docs/reference/piano/theory-panel.md` — the panel this lives in, including the fixed
  staff frame and the left-to-right note flow.
