# The piano grid: addressing, permutations, and difficulty

Every addressed-board game — Chess, Checkers, Connect Four, and whatever comes next — asks the
player the same question in a different costume: **"which key means which place on the board?"**

That question has a surprising number of independent answers, and each one is a real teaching
decision. This document maps all of them, so that each becomes a named knob rather than a constant
buried in a game's source. The goal is stated plainly:

> Addressing difficulty is a **separate axis from opponent strength**. A child who reads well should
> be able to play a hard opponent on easy addressing, and a child who plays chess well should be
> able to grind a weak opponent on hard addressing. Today those two are tangled — the chess ladder
> moves the engine's skill and never touches the notes.

Mechanics of each game live in [piano-games.md](piano-games.md). Chrome and layout live in
[piano-game-platform.md](piano-game-platform.md). This document is only about **the map from keys
to squares**.

---

## 1. The geometry: what a grid game actually has

A grid game has up to two addressable axes and up to four rails to name them on.

| Game | X axis | Y axis | Address is | Rails drawn |
|---|---|---|---|---|
| **Connect Four** | 7 columns | — (gravity picks the row) | one note **or** one triad | top only |
| **Checkers** | 8 files | 8 ranks (32 dark squares legal) | file note **+** rank note | top (files) + left (ranks) |
| **Chess** | 8 files | 8 ranks | file **+** rank, twice (from, to) | bottom (files) + left (ranks), drawn on the board's own rim |
| *Battleship (future)* | 10 columns | 10 rows | column + row | two boards, rails on each |

Three things vary and are worth naming as layout config rather than per-game CSS:

- **`axes`** — `1` (Connect Four) or `2` (Chess, Checkers).
- **`rail placement`** — `top` / `bottom` for X, `left` / `right` for Y. Chess draws its X rail at
  the **bottom** because the file letters live under the board on every chessboard ever printed;
  Checkers and Connect Four draw X at the **top** because the player is dropping/reaching downward
  into the grid. Both are correct for their game and neither should be hard-coded in a shared
  component.
- **`rail inset`** — a rail must line up with the *playable cells*, not the board element. Checkers'
  file rail has to clear the rank rail, the wooden frame and the brass lip; the current fix puts
  both rails inside the board's own CSS grid so alignment is structural rather than arithmetic.

Everything below is about what goes **in** those rails.

---

## 2. The fork tree

```
                            ┌─ VOCABULARY ─┐
                            │              │
                        STAFF            CHORD
                          │                │
              ┌───────────┴──────┐         ├── roots: which 8 pitch classes name the X axis
              │                  │         └── qualities: which 8 chord types name the Y axis
         which CLEF          how many
       per axis (X/Y)      NOTES per address
              │                  │
      treble / bass /        1 (Connect Four)
      grand (X treble,       2 (Chess, Checkers — one per axis)
        Y bass)              3+ (chord mode)
              │
        PITCH MATERIAL ── naturals only │ + one accidental │ diatonic in key │ full chromatic
              │
          ORDERING ── sequential │ reverse │ shuffled
              │
      SHUFFLE CADENCE ── never │ each game │ each turn
              │
        INVERSIONS ── any │ root position │ named (Cm/G)   ← chord vocabulary only
```

Seven independent dimensions, chosen **per axis** where it makes sense. They multiply.

---

## 3. Dimension by dimension

### 3.1 Vocabulary — `addressing`

The first fork, and the only one that changes what skill is being drilled.

| Value | The player must | Implemented in |
|---|---|---|
| `staff` | **Read** a note on a staff and find that key | `staffAddress.js` — `DEFAULT_STAFF_SCHEME` |
| `chords` | **Spell** a chord from a symbol (`Am7`) | `chordAddress.js` — `DEFAULT_CHORD_SCHEME` |
| `names` | Read a letter name (`C4`) — the pre-literate rung | `AddressRail` supports it; no game selects it yet |

An address rail must render the resolved vocabulary, not merely the axis material. In particular,
Connect Four prints chord roots in `chords` mode and engraves pitches only in `staff` mode; chord
strings are never valid input to the MIDI staff renderer.

These are **not** difficulty levels of each other. A child who reads both clefs but cannot spell a
seventh chord is locked out of `chords` for years, and a child who has learned chord shapes by hand
may not read at all. They are two vocabularies for the same 64 squares, and the rest of the game —
narrowing, hover, pick-up, destination badges, the game record — works identically under either.

Chess currently defaults to `chords`; Checkers and Connect Four are `staff`-only. Chess's
`addressing` key already exists in `config/chess.yml` and is per-user overridable.

### 3.2 Clef assignment (staff vocabulary only)

Which staff each axis is read on.

| Value | X axis (files/columns) | Y axis (ranks/rows) | Note |
|---|---|---|---|
| `grand` **(current default)** | treble, C4→C5 | bass, B2→B3 | Right hand picks the column, left hand picks the row — the split is middle C, the boundary a reader already knows |
| `treble-only` | treble low | treble high | For a player who has not met the bass clef |
| `bass-only` | bass low | bass high | Left-hand drill |
| `inverted` | bass | treble | Deliberately awkward; a real drill for a player who always leads with the right hand |

The current implementation hard-codes `grand` via `SPLIT_MIDI = 60` and two frozen arrays. The split
is the whole contract: *everything at or above middle C selects a file, everything below selects a
rank.* Making the clef pair configurable means making that split a derived value, not a constant.

### 3.3 Cardinality — notes per address

| Value | Meaning | Used by |
|---|---|---|
| 1 | a single note names a cell | Connect Four (`input_mode: notes`) |
| 2 | one note per axis, played together | Chess `staff`, Checkers |
| 3–4 | a chord names a cell | Chess `chords`, Connect Four (`input_mode: chords`) |

**Reachability is a non-issue by construction, and it is worth understanding why**, because the
question comes up every time. Matching is on the **pitch-class set** (`identifyChord`), so voicing,
octave and doubling are free and inversions cost nothing. `add9` is defined as `[0, 4, 7, 14]` — a
major ninth on paper — but the player may voice it inside a single octave and it still matches. The
game never demands a specific stretch.

What *is* constrained is the vocabulary, and `validateChordScheme` enforces four rules:

1. **Distinctness.** Eight roots must be eight distinct pitch classes; eight qualities must be
   distinct. 64 squares, 64 chords, no leftovers.
2. **No pitch-class collisions.** Three seductive qualities are banned outright because they make
   two squares literally the same notes:
   - *augmented* is symmetric — C-aug and E-aug are one chord, and any eight distinct roots must
     contain a major-third pair, so an augmented rank is always ambiguous;
   - *sus2 / sus4* are inversions of each other — C-sus2 and G-sus4 are the same three notes;
   - *add6 / minor7* are one chord — C6 and Am7 are both C-E-G-A, and eight distinct roots must
     contain a minor-third pair (only six pitch classes can avoid one).
3. **Gesture safety.** Help is asked for with runs of adjacent semitones (3 = show moves, 4 = best
   move, 5 = replay). A quality containing a 3- or 4-semitone run would collide with those gestures,
   so it is rejected rather than silently disabling help.
4. **No label ambiguity.** Two qualities sharing a printed label are worse than two that *are* the
   same: the board looks legible and lies.

Any new vocabulary — a ninth quality, a chromatic root set — has to pass all four.

### 3.4 Pitch material — the difficulty knob nobody has turned yet

This is the layer the current code does not have, and the one the request identifies correctly.

| Tier | Staff axis material | Chord root material |
|---|---|---|
| 0 | one hand, 5 naturals (C–G) | 3 roots: C, F, G |
| 1 | one octave of naturals | 5 white roots |
| 2 **(current)** | one octave of naturals, both clefs | 7 white roots + **B♭** |
| 3 | naturals + one accidental per axis | white roots + 1–2 black roots |
| 4 | diatonic in a rotating key (F, G, D…) | roots diatonic to a key, including its accidental |
| 5 | full chromatic | any 8 of 12 roots, black roots included |

The **B♭ is not an ornament** — it is forced. The chord scheme needs eight distinct roots and the
alphabet only supplies seven letters before repeating C, so file `h` takes the one flat in the set.
`chordAddress.js` calls that exception "the whole trick to learning it", and it is the natural hinge
into tier 3: once a player has accepted one black root, adding a second is a small step rather than a
new concept.

The staff scheme's octave is likewise contiguous by design — bass B2→B3 and treble C4→C5 with no gap,
so no note within reach belongs to neither axis. Any tier that widens the material has to preserve
that property or a played note lands nowhere and the game looks dead.

### 3.5 Ordering — sequential or shuffled

| Value | Effect |
|---|---|
| `sequential` **(current default)** | X reads C D E F G A B C left to right; Y climbs. A scale, which is the thing being learnt. |
| `reverse` | The same scale read downward. |
| `shuffled` | The same vocabulary, dealt to different positions. |

`reverse` earns its own value rather than being a special case of `shuffled`, because it is a
materially gentler step and drills something specific. A player who has internalised "left is low"
reads a descending axis with real effort the first few times — but every **interval** is still where
it was, so the structure they have learned still helps them. A shuffle throws that away entirely.
Putting `reverse` between `sequential` and `shuffled` on the ladder is the difference between a step
and a cliff.

It is also per-axis: reversing the file rail while the rank rail climbs is a legitimate and quite
hard drill, and nothing prevents it.

Shuffling is what stops the board from being memorised. With a fixed scheme a player learns "e2 is
the square my king's pawn is on" and stops reading entirely; re-dealt, the only way to find a piece
is to read the rim and work out what to play. The vocabulary never changes — only where each item
sits — so the drill stays inside what the player already knows.

`shuffleChordScheme` draws the two axes from **independent** seeds (`seed` and `seed + 0x9E3779B9`)
so the axes do not move together. A permutation can never introduce ambiguity: collisions depend on
*which* roots and qualities are in play, not their order, so a collision-free scheme stays
collision-free however it is dealt.

### 3.6 Shuffle cadence

| Value | Effect | Where |
|---|---|---|
| `never` | one fixed layout forever | all three games' default |
| `each_game` | re-deal on restart | Checkers, Connect Four |
| `each_turn` | re-deal between turns | Chess |

`each_turn` is materially harder than `each_game` and deserves its own rung. It also demands the
"the map moved" notice — loud for a beat, then a standing reminder — or the player spells yesterday's
square. Chess has that (`piano-chess__redeal`); the other two would need it before enabling
`each_turn`.

### 3.7 Inversions — how much the bass note matters

Chord vocabulary only. A two-note staff address has no inversion to have an opinion about, and the
resolver reports `any` there whatever was configured (while keeping the player's setting, so
switching back to chords restores it).

| Value | The player must | What it drills |
|---|---|---|
| `any` **(current behaviour)** | Play the right notes, in any voicing | The chord as a set |
| `root` | Put the named root lowest | Knowing *which* note is the root, not just the shape |
| `named` | Play the inversion the rim names — `Cm/G` | The full slash-chord vocabulary |

This dimension exists because the current floor hides a whole skill. Matching is on the pitch-class
**set** (`identifyChord`), so C-E-G, E-G-C and G-C-E all address the same square and an inversion
costs nothing. That is the right floor — it is what makes reachability a non-issue (§3.3) — but it
means a player can grab whichever shape is nearest their hand and never once decide which note is
the root.

`root` is the first real step: the player has to work out the root and put it under their thumb.
`named` is the full vocabulary: the address becomes **(root, quality, bass)**, the rim prints
`Cm/G`, and the player places a specific note in the bass.

Two consequences worth stating:

- **`named` interacts with collisions.** The bass note is already the tiebreak `identifyChord` uses
  when a pitch-class set is ambiguous. Under `named` the bass is *load-bearing* rather than a
  tiebreak, which means a scheme with an ambiguous pair becomes *less* ambiguous, not more — the
  inversion disambiguates it. It never makes validation stricter.
- **`named` triples the vocabulary a rim must print.** A triad has three inversions, a seventh has
  four. Where the rail has room for `Am7` it may not have room for `Am7/G`, and the rung should not
  be reachable on a game whose rail cannot print it.

### 3.8 Axis independence

A dimension that is currently implicit: **the two axes need not agree.** Nothing prevents

- X = staff naturals, Y = chord qualities *(this is exactly what Chess's `chords` mode already is:
  X is a root **name**, Y is a chord **quality**)*
- X shuffled every turn, Y fixed
- X reversed, Y sequential
- X tier 2, Y tier 4

Chess's own default is already a mixed scheme in disguise, which is the strongest argument for making
the axes independently configurable rather than picking one preset per game.

---

## 4. The permutation space

Counting the reachable, *legal* combinations:

| Dimension | Values | Count |
|---|---|---|
| Vocabulary | staff / chords / names | 3 |
| Clef pair (staff only) | grand / treble / bass / inverted | 4 |
| Cardinality | 1 / 2 / 3–4 | constrained by vocabulary |
| Pitch tier | 0–5 | 6 |
| Ordering | sequential / shuffled | 2 |
| Cadence | never / each_game / each_turn | 3 |
| Per-axis independence | X and Y chosen separately | ×(the above, squared, for tier + ordering) |

Ignoring per-axis independence: `staff (3 clef-relevant) × 6 tiers × 2 orderings × 3 cadences = 108`
staff configurations, plus `6 tiers × 2 × 3 = 36` chord configurations, plus the `names` rung. Call it
**~150 distinct addressing setups per game.**

With independent axes (tier and ordering chosen per axis) that becomes roughly
`6² × 2² × 3 = 432` per vocabulary — which is precisely why this needs to be a small set of *named
rungs* rather than a settings screen with nine dropdowns. Nobody is going to hand-pick from 432.

---

## 5. The configuration surface

**Implemented.** `game-platform/addressing/` resolves it; `DataServicePianoGameRepository` deep-merges
the layers that feed it.

```yaml
addressing:
  # ── the fork ──────────────────────────────────────────────────────────
  vocabulary: staff            # staff | chords | names

  # ── staff only ────────────────────────────────────────────────────────
  clefs: grand                 # grand | treble-only | bass-only | inverted

  # ── per axis, because they genuinely differ ───────────────────────────
  x:
    tier: 2                    # 0-5, see §3.4
    order: sequential          # sequential | reverse | shuffled
  y:
    tier: 2
    order: sequential

  # ── when the map moves ────────────────────────────────────────────────
  shuffle: never               # never | each_game | each_turn

  # ── chords only ───────────────────────────────────────────────────────
  inversions: any              # any | root | named

  # ── the escape hatch: an explicit scheme always wins ──────────────────
  # Validated by validateChordScheme / validateStaffScheme; an invalid
  # scheme is REJECTED and reported, never silently partially applied.
  scheme: null

  ladder:
    unlocked_through: 4        # the highest rung this player has earned
    pinned: null               # or a rung number, to hold a player still
```

### The layers

```
  house default  →  the game's YAML  →  the ladder rung  →  this player
  ADDRESSING_DEFAULTS   config/{game}.yml    ADDRESSING_RUNGS   users/{id}/apps/{game}/config.yml
```

Every layer states **only what it changes**, and every dimension is independently overridable at
every layer. That last clause is the whole requirement and it is enforced in two places:

- **`resolveAddressing`** merges per key, and per axis within `x`/`y`. Setting `x.tier` keeps
  `x.order`, both `y` keys, and every scalar dimension from the layers beneath.
- **`DataServicePianoGameRepository.readConfig` / `writeConfig`** deep-merge rather than spread. This
  was a real defect: a spread replaced a nested block wholesale, so a player overriding one addressing
  dimension silently discarded the household's vocabulary, clefs, cadence and other axis.
  (`mergeChessConfig` had the same defect for its `addressing` block, with the same fix.)

**One dimension is exempt from the rung layer: `vocabulary`.** The ladder is a difficulty ladder,
not a notation switch — a rung may move tiers, ordering, cadence, clefs and inversions, but when
the game's YAML or the player has stated a vocabulary, the rung's is dropped (with a note). A board
configured for chords climbs in chords: wider roots, shuffles, accidentals — never a different
notation because the ladder file says rung 3. A rung's vocabulary applies only when no lower layer
stated one.

`pinned` is the "always keep it sequential, never shuffle, basic root notes" case: an explicit hold
that beats the earned rung, so a player who needs stability gets it regardless of what they have
unlocked.

### What happens to a bad value

Nothing is passed through unexamined, because a board built from a half-applied scheme has squares
that no key can address — which from the player's chair is indistinguishable from a broken game.

| Input | Result |
|---|---|
| `vocabulary: staves` | Dropped, falls through to the layer beneath, reason recorded in `notes` |
| `x: { tier: 99 }` | Dropped with a reason |
| `x: { tier: 0 }` on an 8-wide axis | **Raised** to the lowest tier whose pool fills the axis, with a reason — a five-note pool would leave three files unaddressable |
| `inversions: named` on `vocabulary: staff` | Reported as `any` (a two-note address has no inversion), while the player's setting is preserved under `configured` so switching back to chords restores it |
| An invalid explicit `scheme` | **Refused**, `source: 'rejected-explicit'`, errors returned, a built scheme handed back so the game still runs |

## 6. The addressing ladder

The knobs above compose into rungs. This is the deliverable the request is really after: a
**second ladder, orthogonal to the opponent ladder**, so difficulty can rise on either axis alone.

| Rung | Vocabulary | Material | Ordering | Cadence | Inversions | What it drills |
|---|---|---|---|---|---|---|
| 1 | `names` | tier 0 | sequential | never | — | Where the keys are |
| 2 | `staff` treble-only | tier 1 | sequential | never | — | Reading one clef |
| 3 | `staff` grand | tier 2 | sequential | never | — | Both clefs, hands split |
| 4 | `staff` grand | tier 2 | **reverse** | never | — | The scale read downward — intervals intact |
| 5 | `staff` grand | tier 2 | shuffled | each_game | — | Reading, not memorising |
| 6 | `staff` grand | tier 3 | shuffled | each_game | — | Accidentals |
| 7 | `staff` grand | tier 4 | shuffled | **each_turn** | — | Key signatures, live |
| 8 | `chords` | tier 0 | sequential | never | any | Spelling a triad |
| 9 | `chords` | tier 2 | sequential | never | any | The full vocabulary *(today's chess default)* |
| 10 | `chords` | tier 2 | sequential | never | **root** | Knowing which note is the root |
| 11 | `chords` | tier 2 | shuffled | each_game | root | Spelling, not memorising |
| 12 | `chords` | tier 2 | shuffled | each_game | **named** | Slash chords |
| 13 | `chords` | tier 4 | shuffled | each_turn | named | Everything at once |

A rung is a partial config: it states only what it changes, so anything it leaves out falls through
to the game's YAML and the house default. Every rung is asserted to build a valid scheme
(`resolveAddressing.test.js`), so a rung that names an illegal vocabulary fails the suite rather than
the player.

Promotion should key off **addressing accuracy**, not game results — rejected addresses per move,
time-to-first-correct-address, and how often the rim had to be read. Those are different signals from
"did you win", and conflating them is what makes the current single ladder unable to serve both a
strong reader who is a weak player and the reverse.

Config then reads as a floor and a ceiling per user, exactly like the opponent ladder:

```yaml
addressing:
  ladder:
    unlocked_through: 4        # the highest rung this player has earned
    pinned: null               # or a rung number, to hold a player still
```

`pinned` is the "always keep it sequential, never shuffle, basic root notes" case from the request:
an explicit hold, so a player who needs stability gets it regardless of what they have earned.

---

## 7. Where the code stands today

| Dimension | Status | Lives in |
|---|---|---|
| Vocabulary staff/chords/names | **Resolved from config**, layered | `addressing/dimensions.js`, `resolveAddressing.js` |
| Clef pair | **Implemented** — material per pair, and the axis split is DERIVED from the scheme rather than fixed at middle C | `materialFor`, `splitFor` |
| Cardinality | 1 / 2 / 3–4 | constrained by vocabulary |
| Pitch tier | 0–5 | 6 |
| Ordering | sequential / shuffled | 2 |
| Cadence | never / each_game / each_turn | 3 |
| Per-axis independence | X and Y chosen separately | ×(the above, squared, for tier + ordering) |

Ignoring per-axis independence: `staff (3 clef-relevant) × 6 tiers × 2 orderings × 3 cadences = 108`
staff configurations, plus `6 tiers × 2 × 3 = 36` chord configurations, plus the `names` rung. Call it
**~150 distinct addressing setups per game.**

With independent axes (tier and ordering chosen per axis) that becomes roughly
`6² × 2² × 3 = 432` per vocabulary — which is precisely why this needs to be a small set of *named
rungs* rather than a settings screen with nine dropdowns. Nobody is going to hand-pick from 432.

---

## 5. The configuration surface

**Implemented.** `game-platform/addressing/` resolves it; `DataServicePianoGameRepository` deep-merges
the layers that feed it.

```yaml
addressing:
  # ── the fork ──────────────────────────────────────────────────────────
  vocabulary: staff            # staff | chords | names

  # ── staff only ────────────────────────────────────────────────────────
  clefs: grand                 # grand | treble-only | bass-only | inverted

  # ── per axis, because they genuinely differ ───────────────────────────
  x:
    tier: 2                    # 0-5, see §3.4
    order: sequential          # sequential | reverse | shuffled
  y:
    tier: 2
    order: sequential

  # ── when the map moves ────────────────────────────────────────────────
  shuffle: never               # never | each_game | each_turn

  # ── chords only ───────────────────────────────────────────────────────
  inversions: any              # any | root | named

  # ── the escape hatch: an explicit scheme always wins ──────────────────
  # Validated by validateChordScheme / validateStaffScheme; an invalid
  # scheme is REJECTED and reported, never silently partially applied.
  scheme: null

  ladder:
    unlocked_through: 4        # the highest rung this player has earned
    pinned: null               # or a rung number, to hold a player still
```

### The layers

```
  house default  →  the game's YAML  →  the ladder rung  →  this player
  ADDRESSING_DEFAULTS   config/{game}.yml    ADDRESSING_RUNGS   users/{id}/apps/{game}/config.yml
```

Every layer states **only what it changes**, and every dimension is independently overridable at
every layer. That last clause is the whole requirement and it is enforced in two places:

- **`resolveAddressing`** merges per key, and per axis within `x`/`y`. Setting `x.tier` keeps
  `x.order`, both `y` keys, and every scalar dimension from the layers beneath.
- **`DataServicePianoGameRepository.readConfig` / `writeConfig`** deep-merge rather than spread. This
  was a real defect: a spread replaced a nested block wholesale, so a player overriding one addressing
  dimension silently discarded the household's vocabulary, clefs, cadence and other axis.
  (`mergeChessConfig` had the same defect for its `addressing` block, with the same fix.)

**One dimension is exempt from the rung layer: `vocabulary`.** The ladder is a difficulty ladder,
not a notation switch — a rung may move tiers, ordering, cadence, clefs and inversions, but when
the game's YAML or the player has stated a vocabulary, the rung's is dropped (with a note). A board
configured for chords climbs in chords: wider roots, shuffles, accidentals — never a different
notation because the ladder file says rung 3. A rung's vocabulary applies only when no lower layer
stated one.

`pinned` is the "always keep it sequential, never shuffle, basic root notes" case: an explicit hold
that beats the earned rung, so a player who needs stability gets it regardless of what they have
unlocked.

### What happens to a bad value

Nothing is passed through unexamined, because a board built from a half-applied scheme has squares
that no key can address — which from the player's chair is indistinguishable from a broken game.

| Input | Result |
|---|---|
| `vocabulary: staves` | Dropped, falls through to the layer beneath, reason recorded in `notes` |
| `x: { tier: 99 }` | Dropped with a reason |
| `x: { tier: 0 }` on an 8-wide axis | **Raised** to the lowest tier whose pool fills the axis, with a reason — a five-note pool would leave three files unaddressable |
| `inversions: named` on `vocabulary: staff` | Reported as `any` (a two-note address has no inversion), while the player's setting is preserved under `configured` so switching back to chords restores it |
| An invalid explicit `scheme` | **Refused**, `source: 'rejected-explicit'`, errors returned, a built scheme handed back so the game still runs |

## 6. The addressing ladder

The knobs above compose into rungs. This is the deliverable the request is really after: a
**second ladder, orthogonal to the opponent ladder**, so difficulty can rise on either axis alone.

| Rung | Vocabulary | Material | Ordering | Cadence | Inversions | What it drills |
|---|---|---|---|---|---|---|
| 1 | `names` | tier 0 | sequential | never | — | Where the keys are |
| 2 | `staff` treble-only | tier 1 | sequential | never | — | Reading one clef |
| 3 | `staff` grand | tier 2 | sequential | never | — | Both clefs, hands split |
| 4 | `staff` grand | tier 2 | **reverse** | never | — | The scale read downward — intervals intact |
| 5 | `staff` grand | tier 2 | shuffled | each_game | — | Reading, not memorising |
| 6 | `staff` grand | tier 3 | shuffled | each_game | — | Accidentals |
| 7 | `staff` grand | tier 4 | shuffled | **each_turn** | — | Key signatures, live |
| 8 | `chords` | tier 0 | sequential | never | any | Spelling a triad |
| 9 | `chords` | tier 2 | sequential | never | any | The full vocabulary *(today's chess default)* |
| 10 | `chords` | tier 2 | sequential | never | **root** | Knowing which note is the root |
| 11 | `chords` | tier 2 | shuffled | each_game | root | Spelling, not memorising |
| 12 | `chords` | tier 2 | shuffled | each_game | **named** | Slash chords |
| 13 | `chords` | tier 4 | shuffled | each_turn | named | Everything at once |

A rung is a partial config: it states only what it changes, so anything it leaves out falls through
to the game's YAML and the house default. Every rung is asserted to build a valid scheme
(`resolveAddressing.test.js`), so a rung that names an illegal vocabulary fails the suite rather than
the player.

Promotion should key off **addressing accuracy**, not game results — rejected addresses per move,
time-to-first-correct-address, and how often the rim had to be read. Those are different signals from
"did you win", and conflating them is what makes the current single ladder unable to serve both a
strong reader who is a weak player and the reverse.

Config then reads as a floor and a ceiling per user, exactly like the opponent ladder:

```yaml
addressing:
  ladder:
    unlocked_through: 4        # the highest rung this player has earned
    pinned: null               # or a rung number, to hold a player still
```

`pinned` is the "always keep it sequential, never shuffle, basic root notes" case from the request:
an explicit hold, so a player who needs stability gets it regardless of what they have earned.

---

## 7. Where the code stands today

| Dimension | Status | Lives in |
|---|---|---|
| Vocabulary staff/chords/names | **Resolved from config**, layered | `addressing/dimensions.js`, `resolveAddressing.js` |
| Clef pair | Named and resolvable; the staff builder still emits `grand` material | `dimensions.js` `CLEF_PAIRS` |
| Cardinality | Per-game constant | each game |
| Pitch tier | **Implemented**, 6 tiers per vocabulary, per axis | `STAFF_TIERS`, `CHORD_TIERS` |
| Ordering (incl. `reverse`) | **Implemented**, per axis | `buildScheme.js` `axisValues` |
| Cadence | **Unified** as `addressing.shuffle` | `normalizeAddressing` |
| Inversions | **Enforced at match time** — the required bass is load-bearing, and the rim prints the slash | `requiredBass`, `identifyChord` |
| Per-axis independence | **Implemented** — `x` and `y` are separate blocks, shuffled from separate seeds | `resolveAddressing`, `buildScheme` |
| Validation | **Strong** — collisions, gesture runs, label ambiguity, distinctness, plus tier-fit | `validateChordScheme`, `validateStaffScheme`, `raiseTierToFit` |
| Layered override | **Implemented** front and back; deep-merged at the repository | `resolveAddressing`, `DataServicePianoGameRepository` |
| Addressing ladder | **Defined** (13 rungs, all asserted buildable) with its own promotion signal and a rung picker in settings | `ADDRESSING_RUNGS`, `addressingProgress.js`, `GameStepper` |
| Games consuming it | **Wired** — all three build their schemes through the resolver | `useAddressing`, each game's configured overrides |

### How each game is wired

| Game | Reads | Native explicit fields |
|---|---|---|
| **Checkers** | `useAddressing({ axisSize: 8 })` → file and rank axes | `file_notes`/`rank_notes` as an explicit scheme only when both axes are valid |
| **Connect Four** | `useAddressing({ axisSize: 7 })` → column axis; chord roots re-sorted into scale order | `column_notes` |
| **Chess** | `schemeForAddressing(config, fallback)` → the resolver, built at seed 0 | canonical `addressing` block |

Chess builds at **seed 0** on purpose: it re-deals per turn through its own `shuffleEachTurn`
machinery inside `createChessGameState`, and letting the cadence deal here as well would shuffle an
already-shuffled board. The resolver supplies the material and its layout; chess supplies when it
moves.

Two invariants are pinned by `addressing/wiring.test.js`, because wiring is only safe if the defaults
did not change: the staff defaults reproduce `DEFAULT_STAFF_SCHEME` exactly, the chord defaults
reproduce `DEFAULT_CHORD_SCHEME` exactly, and a chess config that states no vocabulary keeps `chords`
rather than dropping to the house `staff` floor — which would silently re-teach the player a
different skill.

## 8. The promotion signal

Deliberately **not** "did you win". Conflating the two is exactly what makes a single ladder unable to
serve both children this separation exists for: a child can lose every game while addressing every
square first time, and that child should climb the reading ladder while staying on a gentle opponent.

`addressingProgress.js` records the address, not the game:

| Recorded | Why |
|---|---|
| `ok` | did the press name a square |
| `ms` | from the turn starting to the first correct address |
| `railRead` | did the rim have to be consulted |

Promotion needs **accuracy and fluency together**, because either alone is a false read: a player who
is never wrong but takes fifteen seconds a move is spelling it out letter by letter and the next rung
would bury them; a fast player who is wrong half the time is guessing. Defaults are a 20-address
window, 85% accuracy, a 6s median, and a 12-address minimum before any judgement.

Demotion exists and the bar for it is half the promotion bar — a rung that turns out to be too hard
should hand the player back something they can play, and a bad five minutes should not bounce a child
between rungs. The record carries no game result at all, which is what makes the two ladders
genuinely independent.

The settings panel picks a **rung**, not the dimensions: nobody hand-picks from 432 combinations, so
it offers a `GameStepper` over the ladder with a line beneath saying what the rung resolves to, plus
a "stay here" switch for `pinned`. The individual dimensions remain configurable in YAML.

## 9. Where it is live

Every dimension in this document resolves from config, builds a validated scheme, and reaches a
player in all three games.

| Piece | Wired into |
|---|---|
| Scheme resolution | Chess (`schemeForAddressing`), Checkers and Connect Four (`useAddressing`) |
| Re-deal notice | Checkers and Connect Four (`DealNotice`); chess had its own already |
| Reading ladder | All three (`useAddressingLadder`) |
| Rung picker + hold | Chess settings (`GameStepper`) |
| Persistence | `addressing.ladder.unlocked_through`, written through the same deep-merged config path every other setting uses |

**What each game counts as an address**

| Game | Landed | Refused |
|---|---|---|
| Chess | a ply appearing in the history — a chord that named a square and moved a piece | a `rejection` from the game state |
| Checkers | `squareForAddress` returning a square | the source/destination grammar rejecting it |
| Connect Four | a disc landing | a full column |

Chess counts plies rather than `preview` events on purpose: counting previews would measure browsing
on the way to a decision, not addressing.

## 10. Tuning

The promotion thresholds are **configuration, not constants**, because they are first guesses and
want weeks of real play before anyone trusts them. Tuning is a YAML edit at either layer, not a
release:

```yaml
addressing:
  promotion:
    window: 20         # look at the last N addresses
    accuracy: 0.85     # ...and promote at this hit rate
    medianMs: 6000     # ...if the median time to a correct address is under this
    minSamples: 12     # never judge on a handful
```

`data/household/gaming/log/{game}/` is where the evidence to tune them against accumulates.

## 11. Remaining work

Nothing in this document is unimplemented, unwired, or unexercised. The rung control, the reading
ladder, the re-deal notice and the settings sheet are the same on all three boards.

## 12. Managed daily and in-game pressure

`gameAddressing` fixes each learner's vocabulary across Chess, Checkers, and Connect Four while
letting its difficulty rise on two independent axes: completed board games in the current study
day and completed human moves in the current game. Opponent strength remains unrelated. The
managed layer wins over legacy per-game vocabulary settings, so a staff learner never crosses into
chords merely because an old ladder rung did.

Staff pressure ends in dyad and triad address tokens. Each token is validated as one to three
distinct MIDI notes within a perfect fifth, and the two board axes must occupy disjoint registers.
Recognition requires the exact union of the file and rank shapes. This keeps every shape playable
by one hand, correctly placed on its staff, and unambiguous about the selected square. Chess adopts
a new map only at a safe human-turn boundary; the map cannot change underneath a held selection.
