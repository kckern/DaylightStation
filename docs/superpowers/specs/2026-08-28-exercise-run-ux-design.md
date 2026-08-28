# ExerciseRun UX Redesign — Tiers, a Graded Repertoire, and an Ask a Child Can Read

**Date:** 2026-08-28
**Trigger:** first real use of the match gate produced an unreadable screen —
`docs/_wip/bugs/2026-08-28-match-gate-challenge-is-unreadable.md` enumerates 14 issues.
**Decisions settled with the user:** staff-first as the general rule, with keyboard-only
tiers below it for pre-readers; one context-aware surface (no gate fork); surface AND
first-ask/ladder fixed together; material config-driven with one built-in fallback.

---

## The problem, in one line

`ExerciseRun` was designed for a child who chose an exercise and knows what it is; the
gate drops it in front of a child who chose chess. The first real gate served a cold,
metronome-timed exotic dyad on a grand staff with an empty bass clef, a bare "F" in the
corner, copy promising criteria it never showed, and no statement anywhere of why the
screen existed.

## The organizing idea

**Difficulty selects a presentation tier, not just a grading policy.** The rung decides
what the screen *is*:

| Tier | Screen | Ask shape | Timing | Grading |
|---|---|---|---|---|
| 0 — Keys | No staff. Large keyboard, lit keys | one note → dyad → triad | free | completeness only; unfailable floor lives here (D9) |
| 1 — Keys + staff | Keyboard primary; small single staff above as reinforcement | dyad / triad / 3–5-note run | free | completeness only |
| 2 — Staff | Single staff primary, correct clef; keyboard strip confirms | one-hand scale, one octave | free | completeness only |
| 3 — Timed | Tier 2 plus metronome count-in | scale/run at tempo | cued | completeness + cleanliness ≥ threshold + placement |

The five phantom ladder axes (`hands/span/difficulty/direction/timing`, four of which
never reached the engine) are **deleted**. The rung becomes `{ level }`, an index into a
config-driven repertoire; the repertoire entry names its tier. Every degrade changes
something a child can see or feel — that is the test of the ladder, literally (see
Testing).

## The repertoire (config-driven)

`gameGate.repertoire` in the household piano config is an ordered list of levels, easiest
first. Each level: a tier, a grading block, and a set of material specs the picker
rotates among so consecutive gates differ. The shipped default config expresses:

- **L1** — C major scale, RH, one octave (8 notes)
- **L2** — G, D, F major RH (one accidental)
- **L3** — A, E, B♭, E♭ RH (2–3 accidentals)
- **L4** — minors and remaining keys, RH
- **L5** — hands together, easy keys
- **L6** — warm-up figures (five-note do-re-mi-fa-sol-fa-mi-re-do shapes, the vocal
  warm-up patterns), RH then both hands
- **L7** — cued at tempo; cleanliness starts counting (same scale, now ≥ 80% clean)

Below L1 sit the keyboard tiers (single note → dyad → triad), reachable by degrade and
usable as a per-child starting level for a preschooler.

Sketch of the config shape (the plan pins the exact schema):

```yaml
gameGate:
  enabled: false
  retriesBeforeDegrade: 3
  climbAfterCleanPasses: 3
  users:
    kckern: { enabled: true, games: [chess], startLevel: L2 }
    miles:  { enabled: true, startLevel: keys-1 }   # a preschooler starts at lit keys
  repertoire:
    - id: keys-1
      tier: 0
      material: [{ kind: keys, notes: 1 }]
    - id: keys-2
      tier: 0
      material: [{ kind: keys, notes: 2 }]
    - id: L1
      tier: 2
      material: [{ kind: exercise, collection: scales, roots: [C], hands: right, octaves: 1 }]
    - id: L2
      tier: 2
      material: [{ kind: exercise, collection: scales, roots: [G, D, F], hands: right, octaves: 1 }]
    # … L3–L6 …
    - id: L7
      tier: 3
      grading: { cleanliness: 0.8 }
      material:
        - { kind: exercise, collection: scales, roots: [C, G, D, F], hands: right, cued: true }
        - { kind: score, source: fur-elise, measures: [1, 4] }   # four bars of real music
```

**Material kinds are an extensible seam.** `kind` is the discriminator, three kinds in
this design, more later without schema change:

- `keys` — lit-keyboard asks (tiers 0–1): note count, together-vs-sequence.
- `exercise` — exercise-bank instances (scales, arpeggios, drills), selected by
  collection/roots/hands/octaves.
- `score` — **a passage from real sheet music**: a MusicXML source from the SheetMusic
  library plus a measure range. The assessment engine already accepts a compiled score
  expectation (`compileScoreExpectation`; the D10 seam anticipated exactly this — its
  `score-material-phase-2` refusal is what this design retires). Rendering reuses the
  sheet-music renderer rather than the exercise ABC path, so the child sees the same
  engraving the piece has in SheetMusic mode.

A repertoire level may mix kinds — a high level can hold both a hands-together scale and
four bars of the current study piece.

**Fallback:** one level is built into the code — C major scale, RH, free, completeness
only (the L1 ask). It is used when the config carries no usable repertoire (absent,
malformed, empty). If even the bank fetch fails, the existing fail-open path
(`gate.unavailable`) already grants the match; nothing here changes that.

**Rotation:** the gate remembers the last-served material id alongside the rung in the
same localStorage state and avoids serving it twice running within a level.

**Grading:** completeness-only through tier 2 — the child contract is one sentence:
*"Play all the notes, in order. Wrong ones don't count against you."* This is the D9
floor rubric promoted to the default ask; wrong notes are recorded, never disqualifying.
Cleanliness and placement enter only where a level's `grading` block says so (L7).
`passScore` disappears from the default path: completeness-graded levels pass on
`verdict.passed` exactly as the floor does today, so `runPassed`'s existing contract is
unchanged. Score-thresholded levels keep the existing `passScore` mechanism.

## The ask model, phase by phase

- **Arrive.** One screen, three lines of hierarchy: the bargain (host-supplied framing —
  gate: *"Play this to start Chess"*; program: *"Pass this to finish [step name]"*;
  practice: the exercise title), the plain-words ask (*"C major scale, right hand"* /
  *"Play these two notes together"* / *"Press the lit key"*), and the material itself,
  visible in full before anything starts. Together-vs-in-order is answered before the
  child can wonder.
- **Start.** The two timing modes are two different experiences, and both start from
  the piano, not from a touch button:
  - **Free:** auto-arm — the first correct note starts the attempt. No button, no
    ceremony. There is no beat and no on-beat grading; the only question is whether the
    child gets through the notes.
  - **Cued:** *"Press any key to start."* Any key press starts a **one-measure metronome
    count-in** with a visible countdown, then the child plays what is on the staff
    exactly as written, and on-beat placement is graded. The copy says what will happen
    before it happens.
  The "tempo and pass criteria are fixed for this run" line is deleted, along with the
  "Begin challenge" button.
- **Running.** Existing mechanics: staff cursor advances, wrong key lights red on the
  strip, status line persists. Tier 0–1: the lit keys themselves are the cursor.
- **Done.** Pass → player-driven Continue (unchanged; good news is read first). Fail →
  the gate host owns the panel (already built, `hostOwnsFailure`); practice keeps its
  own result panel. Tiers 0–1 never mention percentages.

## Notation correctness

- **Exercise notation never routes through the live-keyboard renderer again.**
  `generateAbc` (grand staff, both clefs always) returns to being the live-visualiser
  only. Sequential single-hand material already renders correctly through the
  single-voice path (one staff, clef by hand) — L1–L6 RH material gets that for free.
- `ordering: any` material (dyads/triads) renders as **lit keys** at tiers 0–1, no staff.
  At tier 1 a small single staff may sit above; its clef comes from `instance.staff`
  (currently set in the bank and read by nothing) or is derived from the pitch range.
- Hands-together material (L5+) uses the existing two-voice melody path
  (`generateMelodyAbc`), which is already correct for that case.

## Engraving accountability

The deeper failure behind the bass-clef bug is that the engraving layer is blind to its
own output — nothing anywhere checks what actually renders. These rules become checked
properties, not conventions:

1. **Clef is chosen, never defaulted.** Order of authority: the material's declared
   `staff` key, then the hand it is played by, then the pitch range (notes sitting
   mostly below middle C → bass, above → treble). A staff with no notes on it never
   renders. *(AMENDED BY REVIEW — this line originally read hand → `staff` → pitch.
   Task 7 ruled `staff` first: the exercise bank defines it as a re-notate-only axis
   explicitly independent of `hand`, so a left hand authored to read treble must get
   the treble the author asked for. Both engraving surfaces —
   `exerciseAbc.instanceToAbc` and `runPresentation.clefForInstance` — are
   staff-first.)*
2. **Staff count equals hands in use.** One hand, one staff. Two staves only for
   genuinely two-hand material.
3. **Notes sit sensibly in the viewport.** Correct vertical position on the chosen
   clef, readable scale, no far-off-center rendering; ottava markers only when the
   material genuinely leaves the staff, never as a crutch for a wrong clef.
4. **The cursor is legible.** The current note is visibly marked on the staff, advances
   note-by-note as played, and the wrong-note state is visually distinct — for tiers
   0–1 the lit keys are the cursor and the same properties apply to them.
   **Wrong notes are shown, not just flagged:** the note the child actually played
   renders semi-transparently on the staff at its true position, so they can see where
   they are relative to the target even when wrong. The benchmark is the house pattern
   already shipped in `SvgStaffRenderer` (ghost notes at 50% opacity, clef from pitch)
   used by `StaffNoteLabel` and the game action staves.
5. **One engraver per job.** Free-timing asks (tiers 0–2 — no beat, no rhythm values)
   render through a sequence extension of `SvgStaffRenderer`: ordered noteheads on one
   staff, ghosts native. The ABC path serves only cued material, where rhythm engraving
   matters; OSMD serves `score` passages. The live-keyboard grand-staff renderer serves
   nothing in this surface.
6. **Rendered output is the authority.** The Playwright checks (Testing, below) assert
   these on the real rendered DOM — clef glyph present/absent, note elements inside the
   staff's bounding box, cursor class on the expected element — not on the ABC string.
   String-level assertions remain as fast unit guards, but a green ABC string proves
   nothing about what a child sees; that lesson is the origin of this spec.

## Chrome and copy

- Header: Exit · framing line · plain-words ask. The exercise-bank title ("Intervals")
  is no longer a headline anywhere a child is being gated.
- Key chip appears only when a staff is shown, labeled (*"Key of F"*), never a bare
  letter. Meter chip only when cued. BPM chip only when a pace gate exists.
- The framing line is a prop supplied by the host (`framing`), so the gate, a program,
  and practice each say why the screen exists without `ExerciseRun` guessing.

## Ladder mechanics and state

- Rung state becomes `{ levelId, failuresAtLevel, cleanPasses, lastMaterialId }`, still
  per-child in the same localStorage key. The existing corrupt-state machinery
  (structurally-wrong → reset) survives and handles migration from the old five-axis
  shape automatically — an old rung fails validation and resets to the child's starting
  level.
- Degrade after `retriesBeforeDegrade` completed failures (abandonment still never moves
  the ladder); climb after `climbAfterCleanPasses` clean passes. Both move one level.
  Floor = the lowest configured level; if that level is not tier 0/completeness-only,
  the built-in fallback floor (one lit key, unfailable) sits beneath whatever the config
  declares, so D9 cannot be configured away by accident.
- `gate.rung-changed` events carry `{ from: levelId, to: levelId, direction }` — the
  payload shape changes; the reference doc's event table is updated in the same change.

## What does not change

The gate host's state machine (`gatePending`, `matchId`, fail-open on infrastructure,
`no-access` non-granting panel, D12 boundaries in all nine games), the budget meter, the
practice surface's judging, program-step challenges (requirement-driven, untouched), the
persistence/evidence pipeline, and the three terminal states with `onUnavailable`.

## Testing

- **Unit:** repertoire resolution (config → levels, fallback on absent/malformed/empty);
  ladder walk asserting every degrade changes level id — no inert steps by construction;
  rotation-no-immediate-repeat; abc output asserted at string level (exactly one voice,
  expected clef) for representative material of each tier; grading mapping per tier
  (completeness-only passes with wrong notes present — the D9 regression test extends to
  L1; L7 fails below the cleanliness threshold).
- **Visual (Playwright, real compiled SCSS, same harness as `GameGate.measure.test.jsx`):
  ** one scenario per tier asserting the engraving-accountability rules on the rendered
  DOM — staff count (zero at tier 0, one elsewhere, two only for two-hand material),
  clef glyph, notes inside the staff's bounding box, cursor on the expected note, the
  ask line present before any input, and no start button for free asks.
- **Score kind:** a fixture MusicXML passage compiles, renders through the sheet-music
  renderer (not the exercise ABC path), and grades — free (completeness) and cued
  (placement) both.
- **Compat:** existing practice and program-challenge specs pass untouched except where
  copy deliberately changed; those change with the diff, not by loosening.

## Out of scope

`gameLimit` interactions (unchanged), D14 earned minutes, Battle Stadium's rematch, the
office screen, and threading the old axes into the assessment engine (mooted — the axes
are deleted rather than made real).
