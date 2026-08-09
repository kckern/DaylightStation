# Sheet Music — live input viz on the cursor

**Date:** 2026-08-09
**Status:** approved, awaiting implementation plan
**Area:** `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`

## Problem

The sheet music player shows what the score asks for, but not what the player
is actually doing. Learn alone gives input feedback, and only as a transient:
a wrong note draws a red notehead at the played pitch which fades after
~900ms. Listen registers no MIDI input at all (wave 3 removed it), and Polish
grades measures without ever showing the notes behind the grade.

The result is that in two of the three practice modes a player has no way to
see their own playing against the page, and in the third they only see it when
they get it wrong.

## What we are building

One layer that draws the notes currently being held, in the cursor column, at
the pitch played — green when that pitch is written at the cursor, ghosted
when it is not.

`LearnInkLayer` evolves into this layer rather than a second layer being added
beside it. Two layers would put two glyphs in the same column on every Learn
keypress, which is exactly where the page is already busiest.

## Behaviour

### One mark per key

Each `note_on` creates exactly one mark. Each `note_off` removes it. Marks are
drawn at the played pitch, in the cursor column, spelled from the **sounding**
key so a transposed score still reads correctly, on the staff of the nearest
expected pitch. All of that placement machinery already exists in `pushInk`
and is reused unchanged.

### Three kinds

| Kind | Condition | Appearance |
|------|-----------|------------|
| `match` | the pitch is written at the current step | filled, green |
| `ghost` | not written here, and nothing is grading it | filled, neutral grey, ~30% opacity |
| `wrong` | not written here, and Learn's gate is grading it | filled, red |

`wrong` is the single exception to the held lifecycle: it persists for its
existing TTL after release, because a slip the player has already let go of
still has to be readable. `match` and `ghost` disappear the instant the key
comes up.

This keeps Learn's existing wrong-note ink intact while giving the other modes
a non-judgemental treatment: ghosted where nothing is graded, red where it is.

### What counts as a match

The held pitch appears anywhere in the current step, on **either** staff.

The rule is identical in all three modes. It deliberately ignores the active
hands: the layer answers "is this on the page right now?", not "is this your
job right now?" — which is the only question that still means something in
Listen, where the hand toggles select what the *kiosk* performs rather than
what the player owes.

### Modes

Listen, Learn, and Polish. Not Perform, which has no chrome at all by design.

Listen regaining MIDI input reverses a deliberate wave-3 decision ("no play
along and get lit up layer in Listen"). What returns is strictly read-only:
nothing gates, advances, or grades on it — the layer only draws. Listen still
performs the score itself, and the player is still free to ignore the keyboard
entirely.

Polish grading is untouched. The layer observes the same input the evaluator
already sees and draws it; it feeds nothing back.

### Hollow noteheads retired

A hollow notehead means a half or whole note. `.piano-note-pending` currently
outlines the engraved notehead regardless of that note's real duration, so an
expected-but-unstruck quarter note misreads as a half note.

Pending notes become filled at reduced opacity and keep their pulse. The pulse
is what distinguishes them from the new ghost marks — that, and pending marks
sit exactly on an engraved notehead while ghosts sit wherever the player put
them.

`wetGlyphs.jsx` keeps its hollow rendering: there it is driven by real note
duration (`type === 'half' || type === 'whole'`) and is correct notation.

This item is independently shippable and can land before the rest.

## Design constraints

**One `<svg>`, N children.** Held marks redraw on every key event — more often
than the current fade-based marks. The existing discipline is load-bearing: one
node with N shapes costs a single style/layout pass where N absolutely
positioned elements cost N.

**No re-engrave.** Marks live in the layout extract's pixel coordinate space,
so drawing one never triggers OSMD work.

**Refs, not render closures.** The MIDI subscription is deliberately not
re-established per re-engrave, so every score-derived value it reads comes from
a ref mirror. A closure read goes stale the first time the sheet re-engraves
(zoom, flow, transpose).

**Parent owns lifecycle.** The layer component stays pure — no state, no
timers. `ScorePlayer` owns the held-note set and the `wrong` TTL timers.

## Testing

- **Kind selection** is pure and tested directly: given a step, a held pitch,
  and whether the gate is active, it returns `match` / `ghost` / `wrong`.
- **Held lifecycle**: a `note_on` adds a mark, its `note_off` removes it; a
  `wrong` mark survives its `note_off` until the TTL expires.
- **Mode gating**: the layer mounts in Listen, Learn, and Polish, and not in
  Perform.
- **Match rule ignores active hands**: a left-hand pitch reads `match` during
  right-hand-only practice.
- **No hollow noteheads**: the pending rule carries no `fill: none`, asserted
  against the SCSS source (the existing pattern for style floors, since jsdom
  does not compute the cascade).
- Colour and opacity are visual and cannot be verified in jsdom — assert the
  SCSS source, and check the rendered result in the browser after deploy.

## Out of scope

- Changing what Learn's gate accepts or when it advances.
- Changing Polish's grading or tier banking.
- Any velocity, pedal, or timing visualisation.
- Showing input in Perform.
