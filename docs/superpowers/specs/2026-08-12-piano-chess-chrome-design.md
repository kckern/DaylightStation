# Piano Chess — Board Chrome and Interaction — Design

**Date:** 2026-08-12
**Status:** Approved, not yet implemented.
**Surface:** `/piano/games/chess` (`frontend/src/modules/Piano/PianoChessGame/`, `frontend/src/modules/Chess/`)
**Follows:** `docs/superpowers/specs/2026-08-11-piano-chess-ux-design.md` (the engine, config and settings panel it builds on)

## Problem

The chess screen works and reads badly. Three things are wrong with it.

**The board crowds out the instrument.** The keyboard along the bottom is decorative: it mirrors
held notes at 4.5–7rem with labels off, so a player cannot see what they are spelling. The board
meanwhile sizes itself off viewport units inside a canvas that is scaled, which is what ran it off
the bottom of a 1920×1080 screen.

**The board says too much at once.** It carries eleven meanings — crosshair lines, cursor,
selected, destination dots, movable-piece outlines, last move, marked, check, refusal, ghost, and
whose turn — and nearly all of them are drawn as an inset box-shadow in the same brass. They cannot
stack and they cannot be told apart.

**Help is a setting, not a request.** Legality cues are configured (`off` / `after-mistake` /
`always`), so the answer to the question the game is asking can be left permanently switched on. A
beginner needs help available; nobody needs it volunteered.

And a fourth thing, found while auditing the first: the rank axis applies `text-transform:
uppercase` to a label stored as lowercase `m`, so the minor rank is labelled `M` — which in chord
notation means **major** — sitting directly below the rank that actually is major.

## Decisions

1. **Layout: two zones.** Board above, instrument below, one slim reference rail. The left rail is
   deleted.
2. **Lighting: four channels**, each answering a different question — light, outline, marks, colour.
3. **Candidates narrow as you spell**, rather than nothing appearing until a chord resolves.
4. **Hints are gestures**: three adjacent semitones for legal moves, four for the best move.
5. **Each finished game writes a record** of moves, hints and best-moves taken.
6. **`ChordNamePanel` is reused** to name what the player actually played.

## Layout

The root grid becomes two rows: stage, then instrument.

**The left rail is deleted.** Its "FROM / TO" slots duplicated what the board and the read-out
already show. Its two survivors move to the right rail: the prompt line ("Play the chord of the
piece you want to move") and the cancel affordance ("Put it back" / "Play again"). The cancel button
must remain visible — the octave gesture and Esc are alternates, never the only way out.

**The right rail keeps** the shared context rail, the turn line, the rung badge, the move list and
the captures.

**The instrument is a real zone**, not a garnish: the read-outs sit directly above a keyboard tall
enough to label every white key rather than only the C's, with held notes lit.

**Nothing in this component sizes itself off `vh` or `vw`.** `PianoDesignScale` lays the kiosk out
at a fixed design size and scales the whole canvas, so viewport units measure the physical screen
while the layout only ever gets the design box. Both the board and the keyboard are sized in
container-query units against the boxes they actually occupy.

## The board's four channels

Each channel answers one question, so they coexist without competing.

| Channel | Question it answers | Used for |
|---|---|---|
| **Light** (square brightness) | What are my hands doing *now*? | Candidates glow faintly; the resolved square is bright |
| **Outline** (border) | Where am I in this move? | Solid = the piece picked up; dashed = the last move |
| **Marks** (dots, rings laid on top) | What did I *ask* to see? | Dots = legal destinations; ring = the best move |
| **Colour** (wash) | Is something wrong? | Check; refusal |

The **ghost preview** — the translucent piece on the square you are aiming at — belongs to the light
channel: it is live intent, not committed state, and it clears the moment the chord does.

**Deleted:** the movable-piece source outlines (now a hint you ask for), the unused `marked` state,
and the full-width crosshair lines — once candidates narrow, the lit bands *are* the file and the
rank.

**Also deleted: the automatic reveal after a refusal.** Legality cues currently appear once a chord
is refused and stay until the next move lands. That is still the board volunteering the answer, just
later, and the player asked for help to be asked for. A refusal now flashes the square (colour
channel) and says why, and nothing else appears unless a gesture requests it.

Because hints are their own channel, "no help up front" is not a setting anyone can leave on. It is
the resting state of the board: the marks channel is simply empty until asked.

## Narrowing

A square is a **candidate** while its chord's pitch-class set contains every pitch class currently
held. Formally: `candidate(square) ⟺ heldPitchClasses ⊆ chordPitchClasses(square)`.

One note down usually lights a scatter across several files and ranks, because a note can be the
root of one chord and the third of another. The set contracts with each note added, and it only ever
contracts: adding a note must never light a square that was dark. That monotonicity is the property
the whole idea rests on, and it is asserted by test.

**A completed triad does not leave exactly one candidate**, and it should not. C-E-G is contained by
C major *and* by C's extensions — add2, seventh, add6, major7 — so five squares stay lit, all on the
same file. That reads correctly on the board: the file you are rooted on is live, you are at the
major rank, and adding one more note would take you to one of the others. The **cursor** — the
single bright square — comes from the addresser's own resolution of what you are playing now, not
from the candidate set having shrunk to one.

When the candidate set is empty, nothing is lit and the read-out says so at once, rather than
waiting out the settle window before admitting it.

This is a live, per-note computation and it replaces the settle-gated ambiguity that made a valid
chord read as unrecognised for 140ms.

## Hints as gestures

A gesture must be a shape that can never be a square. The existing "take it back" gesture is an
octave, chosen for exactly that reason.

- **Three adjacent semitones** — show legal moves: the destinations of the piece being held, or
  which pieces can move if none is held.
- **Four adjacent semitones** — show the best move, drawn as a ring on both its origin and its
  destination.

Semitone clusters are safe because no chord in the current vocabulary contains three consecutive
pitch classes. (A major-seventh chord does contain one semitone pair — its root and seventh — so a
*two*-note cluster is a legitimate partial chord and must not trigger anything.) That safety is a
property of the vocabulary, not a law, so `validateChordScheme` gains a check for it: a scheme whose
chords can contain a gesture shape is rejected, the same way a scheme with colliding squares is.
This matters immediately, because the next spec expands the vocabulary.

**Gesture recognition runs before square matching**, and a recognised cluster is never treated as
chord input. While the cluster is physically down, narrowing is suppressed; the requested marks then
persist after release, until the player's next move completes.

**Best move is asked of the server at full strength**, regardless of the rung being played. A hint
that is only as good as a beginner's opponent is not a hint.

**The gesture is tap-and-release, not hold.** The hint stays until the player's next move completes,
then clears. Holding would occupy the hands at exactly the moment the player wants to spell a chord,
and clearing on move-completion means the tally counts moves-with-help rather than button presses,
so mashing the cluster cannot inflate it.

**The `hint_level` control is removed** from the settings panel, and the key is dropped from
`chess.yml`. An existing user override carrying it is ignored rather than migrated — it selects
behaviour that no longer exists. `flash_rejected` and `toast` are unaffected: they answer how loudly
a refusal is announced, which is a different question.

## Scoring

Each finished game writes one record under `users/{id}/apps/chess/games/`, holding the date, the
rung played, the result, the move count, hints used, best-moves used, and duration.

The end screen reads it back as facts — "won in 24 moves, 3 hints, 1 best move" — and never
compresses them into a single number. A composite score invites optimising the number instead of the
chess, and it would have to decide how many hints a win is worth, which is a judgement the record
does not need to make.

Guests play normally and persist nothing, consistent with every other per-user path in the kiosk.

## Reusing ChordNamePanel

`frontend/src/modules/Piano/components/ChordNamePanel.jsx` joins the instrument zone.

There are now two functions named `identifyChord` on this screen, and the boundary between them is
load-bearing:

- **`theory/chordNaming.js` — the namer.** "What chord is this?" Answers for *any* set of notes,
  returning root, quality, inversion, bass and a display name. Inversion-aware, key-aware, pure and
  unit-tested.
- **`PianoChessGame/chordAddress.js` — the addresser.** "Which square is this?" Answers only for the
  64 chords on the board.

They are complementary and must never be merged. The panel says what you played; the chess read-out
says where it points, or that it points nowhere.

This turns the dead end into an answer: playing something that is not a square currently yields only
"not a square on this board", which teaches a learner nothing. With the panel beside it they see
"D minor 7" *and* that the board has no such square.

Two adjustments the reuse requires:

- `ChordNamePanel` hardcodes its eyebrow to "Chord". It gains an optional label prop so it can sit
  legibly beside a square read-out.
- Its `useStableChord` settle-and-linger supersedes the `cursorResolved` flag currently hand-rolled
  in `PianoChessGame`. The 500ms release linger is kept deliberately: a move commits *on release*,
  so the plaque still naming the chord for half a second afterwards confirms what was played instead
  of blanking at the moment it mattered.

## The rank-axis label fix

`text-transform: uppercase` comes off `.chess-board__axis-label`. Labels render as stored — `maj`,
`m`, `sus4`, `add2`, `7`, `6`, `maj7`, `dim` — because case *is* the notation, and abbreviations are
kept for space rather than spelled out.

`validateChordScheme` gains a check for ambiguous labels, alongside its existing check for colliding
chords. Today it verifies that no two squares are the same notes; it does not verify that no two
ranks read as the same thing to a musician. That gap is why a rank meaning minor could be labelled
with the symbol for major.

## Testing

- **Narrowing** is a pure function from held pitch classes to candidate squares: one note lights
  many, each note narrows, the full chord leaves exactly one, an impossible set leaves none.
- **Gesture recognition** is pure: three and four adjacent semitones are recognised; a two-note
  semitone pair is not (it is a legitimate maj7 fragment); no gesture shape matches any square; the
  octave escape still wins where it applies.
- **The validator** rejects a scheme whose chords could contain a gesture shape, and rejects a
  scheme whose rank labels are ambiguous — both asserted with a scheme that violates each.
- **No cue appears unbidden**: after a refusal, the board flashes and explains, and no legality
  marks appear until a gesture asks for them.
- **Hint counting** increments once per move-with-help, not per press — asserted by pressing the
  cluster repeatedly within one move.
- **The game record** is written on a finished game with the asserted shape, and is not written for
  a guest.
- **The axis** renders lowercase `m` — the regression that prompted this work.
- Existing chess suites continue to pass unchanged.

Tests must be able to fail. Prior waves of this work shipped one test asserting on a React warning
that no longer exists and another using a FEN that lacked the piece it named; both passed against
broken code.

## Scope

**In:** the two-zone layout, the four-channel lighting, narrowing, the two hint gestures and the
best-move request, the per-game record and end screen, the `ChordNamePanel` reuse, the label fix and
the validator check, and the removal of the `hint_level` control and key.

**Out:** the addressing vocabulary itself. That is the next spec, and it now has two levels to
design, one below the current board and one above it.

**Below — a reading level, for players who cannot yet spell chords.** The rank axis is a bass-clef
note and the file axis is a treble-clef note, so a square is addressed by playing two notes, one in
each hand, read off notation drawn on the rim rather than named in text. A beginner who can read
both clefs can play chess before they can spell a single chord. Notes toward that design:

- The axes stop being text and start being notation. `components/ActionStaff.jsx` — what
  PianoFlashcards already uses — is the reusable piece.
- Addressing stops being pitch-class matching. A square is an ordered pair (bass note, treble note),
  so which note is *lower* is the whole point, exactly as it is for the inversion work.
- Two-note addressing does not collide with the hint gestures, which need three or four adjacent
  semitones. The octave escape must be re-checked, though: two notes an octave apart are a
  legitimate (bass, treble) pair as well as the take-it-back gesture.

**Above — inversions as distinct squares**, graded by difficulty and calibrated per user. Cheaper
than first thought: `chordNaming.js` already computes inversion from the bass and already resolves
the sus2/sus4 ambiguity that blocks an inversion-free board, so that work extends the existing namer
rather than building bass-aware matching from nothing.

Together these make the vocabulary a ladder — read two notes, spell triads, spell inversions — which
is the axis the per-user calibration should move along.
