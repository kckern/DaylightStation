# Piano Chess: freeze the ladder inside a game, and show the child what he played

**Date:** 2026-09-11
**Status:** design, validated with the owner
**Trigger:** a live Piano Chess session, 21:01–21:16, learner `other-learner`

---

## 1. What happened

Prod logs for the session (VictoriaLogs, `context.app:piano`, client `SM-T590`
FKB kiosk):

| Signal | Count |
|---|---|
| `chess.rejected`, reason `unrecognised_chord` | 69 |
| `chess.move` (7 of them the player's) | 14 |

Every single refusal was `unrecognised_chord` — the played notes named no square
at all. The refusals cluster and worsen as the game runs: ply 0 → 2, **ply 2 →
24 refusals in 35 seconds**, ply 4 → 12, ply 10 → 11, ply 12 → 11.

`chord.identify.aggregated` shows what was happening between them. At 21:02 the
window holds recognisable shapes (C ×66, G ×9, F ×11). By 21:04 the same window
holds 453 `__other__` names, 73 power chords, 43 add9, 21 minor7. That is not
reading, that is a hand searching the keyboard.

There were **no `addressing.rung-changed` events**, so `useAddressingLadder` was
not the mover. The escalation came from the household-managed path.

## 2. Why

`data/household/piano/config.yml`:

```yaml
gameAddressing:
  turnEscalation: { enabled: true, everyCompletedMoves: 1, offsetPerStep: 1 }
  users:
    other-learner: { enabled: true, vocabulary: staff, startStage: 0 }
```

`managedAddressing.js` walks an eight-stage staff path and adds **one stage per
completed player move**. The last two stages are rung 7 + `dyad` and rung 7 +
`triad`. Rung 7 is tier 4 (F major, so accidentals), both axes `shuffled`, and
`shuffle: each_turn` — the map is re-dealt every turn.

So the game opens on rung 2 (treble-only, one octave of naturals, sequential,
stable) and by the sixth move is asking for dyads on a chromatic board that
reshuffles every turn; by the seventh, triads. Four to six notes per square, and
the square's identity changes before the next attempt. The board in the
screenshot reads `A–E/D#–A#`: a treble fifth over a bass fifth.

Nothing the child learned in the first two minutes was still true at minute six.

## 3. Four problems

1. **Difficulty moves under the player inside a game.** The ramp is the right
   idea in the wrong place.
2. **No feedback while hunting.** The board answers only "yes" or "that chord is
   not on the board". Walking up the scale toward a note returns nothing.
3. **A multi-note address is all-or-nothing.** A correct right hand is discarded
   and re-guessed because nothing says it was correct.
4. **The engraving is unstable and wrong** — enough that a card cannot be
   recognised twice.

---

## 4. Design

### 4.1 Difficulty is decided once per game and frozen

`turnEscalation` is deleted — from `managedAddressingAt`, from the config, and
from every caller.

```js
managedAddressingAt(raw, { learnerId, completedGames })   // completedPlayerMoves gone
```

All three games (`PianoChessGame`, `PianoCheckers`, `PianoConnectFour`) drop
their `completedPlayerMoves` computation and the `useMemo` dependency that made
the resolved scheme recompute on every move.

This removes a second defect for free: `PianoCheckers` computed
`completedPlayerMoves` by calling `replayGame` once per move *inside a reduce*,
on every render — an O(n²) full-game replay per frame, the same shape as the
per-frame protocol sync recorded in `docs/_wip/bugs/2026-09-11-piano-game-jank-per-frame-protocol-sync.md`.

### 4.2 The path is texture × material; cadence is its own switch

The owner's sequencing, stated directly:

| Game | Texture | Material | Tier |
|---|---|---|---|
| 1 | single | naturals | 2 |
| 2 | single | + sharps/flats | 3 |
| 3 | dyad | naturals | 2 |
| 4 | dyad | + sharps/flats | 3 |
| 5 | triad | naturals | 2 |
| 6 | triad | + sharps/flats | 3 |

```js
const PATHS = Object.freeze({
  staff: Object.freeze([
    { tier: 2, texture: 'single' }, { tier: 3, texture: 'single' },
    { tier: 2, texture: 'dyad'   }, { tier: 3, texture: 'dyad'   },
    { tier: 2, texture: 'triad'  }, { tier: 3, texture: 'triad'  },
  ]),
  chords: Object.freeze([8, 9, 10, 11, 12, 13].map((rung) => ({ rung }))),
});
```

The staff path no longer borrows `ADDRESSING_RUNGS`: a rung bundles vocabulary,
tier, order AND cadence, and bundling is exactly what made "harder" mean six
things at once. `clefs: 'grand'` throughout — both hands, which is the shape of
the board.

Cadence becomes a separate, stable config key applied to whatever stage is in
force:

```yaml
gameAddressing:
  cadence:
    order: shuffled       # sequential | reverse | shuffled  (axis layout)
    shuffle: each_turn    # never | each_game | each_turn    (when it re-deals)
```

Shuffling every turn is fine from game 1 and stays on for the whole ladder. When
`cadence` is stated it overrides the path entry's own order/shuffle, for both
vocabularies.

### 4.3 Shapes are built diatonically, not by semitones

`ergonomicStaffShape` currently builds a dyad as `[0, 7]` semitones and a triad
as `[0, 4, 7]`. Two consequences:

- On the bass naturals axis, B2 becomes B2+E♭2. **"Dyads, naturals only" is not
  reachable** with the current construction.
- On tier 4 the triad is a *major* triad by semitones, so an "F major" axis
  sprouts F♯ and C♯ that are not in the key.

Replaced by a shape built from the axis's **own pitch material**, by index:

```
slot i, stacking up  ->  pool[i], pool[i+2], pool[i+4]      (dyad: i, i+4)
slot i, stacking down ->  pool[i], pool[i-2], pool[i-4]     (dyad: i, i-4)
```

Out-of-range indices wrap by ±12 semitones. Every note of every shape is
therefore drawn from the tier's own set by construction: a naturals tier yields
naturals-only dyads and triads, and tier 3's single accidental stays the only
accidental on the board. Interval size varies with the scale degree, which is
the reading skill, not a defect.

Verified against `validateStaffScheme`'s constraints: shapes stay within a
perfect fifth, treble and bass registers stay disjoint (treble stacks up from
its pool's floor, bass stacks down from its ceiling), and no two slots on an
axis produce the same shape.

### 4.4 Ghost notes on every card and every staff

`SvgStaffRenderer` already accepts `activeNotes` and draws ghosts. Nothing has
ever passed it — `StaffNoteLabel` renders `<SvgStaffRenderer targetPitches={…} />`
and stops there. The plumbing is one prop deep.

- `StaffNoteLabel` gains `held` and forwards it. `SvgStaffRenderer.activeNotes`
  widens from `Map` to `Map | Set | number[]`.
- Config: `feedback.ghost_notes` → `cues.ghostNotes`, defaulting **on** (`!== false`,
  matching every other cue flag).
- Ghosts get a visible treatment. Today they are `fill rgba(0,0,0,0.15)` at
  `opacity 0.5` — about 7% black, invisible on a paper card — and they are drawn
  with no ledger lines, so a ghost off the staff cannot be located. New
  treatment: hollow notehead, `stroke rgba(0,0,0,0.45)`, dashed, no fill, with
  ledger lines at the same weight. Pencil next to ink.
- The existing in-range clamp (`position < -3 || > 11` skipped) stays. That is
  the owner's "if it's in range".

**Performance.** `PianoChessGame.jsx:694` carries an explicit warning: rim labels
rebuilt per render defeat `ChessBoard`'s memo and reconcile all 64 squares on
every note event. Feeding 16 rim cards raw `activeNotes` would reintroduce
exactly that. So the held set is split at the scheme's boundary
(`splitFor(liveScheme)`) and each side is handed only its own notes:

```js
const { heldTreble, heldBass } = splitHeld(heldNotes, liveScheme);   // EMPTY_ARRAY when empty
const fileLabels = useMemo(… heldTreble …, [reading, liveScheme, heldTreble]);
const rankLabels = useMemo(… heldBass   …, [reading, liveScheme, heldBass]);
```

Holding a left-hand note leaves all eight treble cards on a stable
`EMPTY_ARRAY`, so they do not reconcile at all.

### 4.5 Per-hand lock

New export in `staffAddress.js`:

```js
staffAxisMatch(heldNotes, scheme)
// -> { file: index|null, rank: index|null, fileComplete, rankComplete, extra: number[] }
```

The held set is split at the boundary; each side is compared against its axis's
tokens. A side that exactly names a slot is *complete*.

- A complete side turns its rim card green — `chess-staff-label--locked`, green
  border and glow — and it stays lit while the other hand is worked, because the
  player is still physically holding it.
- `chordReadoutModel.readingFor` gains a `half` state so the readout says which
  hand landed ("Right hand: F. Now the left.") instead of `partial`.

### 4.6 Two matching bugs that fed the refusal storm

**`chordCursor.minNotesFor` is hardcoded to 2 for every staff scheme.** A dyad
address needs 4 notes and a triad 6. `chessAddressingModel.js` already has the
correct implementation, computed from the token lengths — but `advanceCursor`
imports the wrong one. Consequence: release after playing a correct 2-note right
hand and the cursor commits a 2-note address, fails to resolve it, and fires
`unrecognised_chord`. **The child is refused for doing precisely what 4.5 is
meant to encourage.**

Fix: one implementation, in `staffAddress.js`, imported by both. And releasing a
complete half with nothing extra held is a no-op with the half still lit — never
a refusal.

**`identifyStaffAddress` demands an exact MIDI set match in dyad/triad mode**
(`expected.join(',') !== held`), while single-note mode matches forgivingly by
letter across octaves via `axisIndex`. The right notes an octave off are
rejected in one mode and accepted in the other. Fix: match by pitch-class set
within each side of the boundary, keeping the exact-set comparison as the fast
path. The boundary split already prevents a treble shape from being confused
with a bass one.

### 4.7 Engraving

**Spelling is random.** `model/pitch.js`:

```js
const isSharp = Math.random() < 0.5;
```

The spelling decides the staff *position* (sharps spell from the natural below,
flats from the natural above). Verified by calling `getStaffPosition` twice on
the same MIDI note: note 51 returns `position 4, isSharp` on one call and
`position 5, isFlat` on the next. The same card renders at a different height
frame to frame, and one note of a dyad comes out flat while its partner comes
out sharp. **A card that cannot be recognised twice cannot be learned.**

Fix, in two parts:
- The default stops being random and becomes a fixed table — flats for B♭(10),
  E♭(3), A♭(8), D♭(1), sharp for F♯(6), i.e. flat-side by default, which is what
  the tier material uses.
- `StaffNoteLabel` plumbs an explicit `accidental` derived from the scheme's
  material, so a key-consistent board spells consistently.

This is shared code: `SvgSequenceStaff`, the side-scroller and the Tetris action
staves all get the fix.

**Flats have no hole.** `FlatShape` draws the bowl as a single filled path —
`M -6.5 -6.75 C 2.5 -10.25, 6.5 -0.25, -6.5 6.75 Z` — with no counter. Redrawn
as outer bowl plus inner counter with `fill-rule="evenodd"`.

**Accidentals are drawn on top of the clef.** Noteheads sit at `baseX = 65`; the
accidental column lands at `65 - 9 - 3 - 5.5 ≈ 47`, and the stagger pushes a
second accidental to `≈ 34`. The clef occupies `x = 2 … 2 + lineSpacing*3 = 44`.
Any two-accidental card collides. Fix: compute the group's required left edge
first and, when it falls left of `CLEF_RIGHT + 2`, shift the whole note group
right rather than clamping accidentals on top of each other.

---

## 5. Files

| File | Change |
|---|---|
| `game-platform/addressing/managedAddressing.js` | drop `turnEscalation` + `completedPlayerMoves`; new staff path; cadence override |
| `game-platform/addressing/buildScheme.js` | `ergonomicStaffShape` → diatonic, pool-indexed |
| `game-platform/addressing/dimensions.js` | cadence defaults; path no longer borrows rungs for staff |
| `PianoChessGame/PianoChessGame.jsx` | drop `completedPlayerMoves`; split held notes; pass `held`/`locked` to labels |
| `PianoCheckers/PianoCheckers.jsx`, `PianoConnectFour/PianoConnectFour.jsx` | drop `completedPlayerMoves` (kills the O(n²) replay) |
| `PianoChessGame/staffAddress.js` | `staffAxisMatch`; canonical `minNotesFor`; pitch-class matching for multi-note tokens |
| `PianoChessGame/chordCursor.js` | import the real `minNotesFor`; complete-half release is a no-op |
| `PianoChessGame/chordReadoutModel.js` | `half` state |
| `PianoChessGame/chessCues.js` | `ghost_notes` → `ghostNotes` |
| `game-platform/families/addressed-board/StaffNoteLabel.jsx` (+ `.scss`) | `held`, `locked`, `accidental` props; locked treatment |
| `MusicNotation/renderers/SvgStaffRenderer.jsx` | accept Map/Set/array; visible ghosts with ledger lines; clef-aware accidental placement |
| `MusicNotation/renderers/staffGlyphs.jsx` | `FlatShape` counter |
| `MusicNotation/model/pitch.js` | deterministic `spellAccidental` |
| `data/household/piano/config.yml` | `turnEscalation` removed, `cadence` added |

## 6. Tests

- `managedAddressing.test.js` — stage is a pure function of `completedGames`;
  no input named `completedPlayerMoves` exists; cadence overrides the path.
- `buildScheme.test.js` — every note of every dyad/triad on a naturals tier is a
  natural; tier-3 boards contain exactly its one accidental; all schemes pass
  `validateStaffScheme`.
- `pitch.test.js` — `getStaffPosition(51)` returns the same position and the
  same spelling on 100 consecutive calls.
- `staffAddress.test.js` — `staffAxisMatch` on half a dyad; octave-displaced
  dyads resolve; `minNotesFor` is 4 for dyad/dyad and 6 for triad/triad.
- `chordCursor.test.js` — releasing a complete half emits no commit and no
  refusal.
- `StaffNoteLabel.test.jsx` — ghosts render when `held` is passed, are omitted
  when `cues.ghostNotes` is off, and are skipped out of range.
- Regression from the session: replay Other Learner's held-note sequence at each stage
  and assert the rejection rate is not what the logs recorded.

## 7. Out of scope

`useAddressingLadder`'s accuracy/fluency promotion stays as it is. It writes
`unlocked_through` and moves mid-game by design, but it never fired in this
session and it is a second ladder that deserves its own decision. Noted, not
touched here.
