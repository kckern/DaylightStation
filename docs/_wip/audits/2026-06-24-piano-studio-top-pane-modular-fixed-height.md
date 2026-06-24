# Studio top pane: modular, fixed-height, centered, with margins (shrink waterfall)

- **Source:** voice feedback `piano/20260624191207_Q6HVNw` · route `/piano/studio` · reported 2026-06-24
- **Audio:** `media/audio/feedback/piano/20260624191207_Q6HVNw.webm`
- **Type:** improvement
- **Area:** Piano · Studio Play layout

## What the user said
> If that's the only one there, it should be centered. I want to make that studio top
> thing modular. It should also be fixed height. Sometimes when there's a staff with a
> stem that digs down, it gets cut off. Let's make sure the top has adequate margins…
> make it a little taller. The waterfall doesn't need to be quite so high — shrink the
> waterfall, increase the top bar that has the staff, give plenty of top and bottom
> margins, and fix the height so that notes can go high and low and not mess things up.
> Have it centered by default…

## Problem / opportunity
The Studio Play top pane (the staff card) currently sizes to content, so tall stems /
ledger-line notes get **clipped**, and the waterfall takes more vertical space than it
needs. The user wants the top pane to be a **modular, fixed-height** region that
comfortably fits notes that go high and low, centered, with generous top/bottom
margins — and the waterfall shrunk to give it room.

## Desired outcome
- The staff/top pane is a **fixed-height** module (taller than today) with adequate
  top + bottom margin so no stem/ledger note is ever clipped.
- Its single staff is **centered by default**.
- The **waterfall is shorter**; the freed space goes to the top pane.
- "Modular" — the top pane is a self-contained component whose contents can be swapped
  (sets up the triptych in the sibling doc). See
  `docs/_wip/audits/2026-06-24-piano-studio-theory-triptych-circle-of-fifths-chord-naming.md`.

## Actionable tasks
- [ ] Give `.piano-studio-play__staff` a fixed height (vertical room for high/low
      notes) + top/bottom margins; stop content-sizing it.
- [ ] Reduce the waterfall's flex share accordingly.
- [ ] Center the staff within the pane.
- [ ] Extract the top pane into a modular component (props-driven content) so the
      triptych layout can drop in.

## Acceptance criteria
- Notes with long stems / ledger lines are never clipped at the top pane edges.
- Single staff is visually centered; the layout is staff-pane (taller) → waterfall
  (shorter) → keyboard.

## Where to look
- `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx` and the
  `.piano-studio-play` / `__staff` / `__waterfall` rules in `frontend/src/Apps/PianoApp.scss`.

## Context / evidence
N/A (layout/UX).
