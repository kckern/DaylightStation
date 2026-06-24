# Studio staff: brace and left barline render not-black

- **Source:** voice feedback `piano/20260624191207_Q6HVNw` · route `/piano/studio` · reported 2026-06-24
- **Audio:** `media/audio/feedback/piano/20260624191207_Q6HVNw.webm`
- **Type:** bug
- **Area:** Piano · Studio (Play tab staff) / MusicNotation

## What the user said
> On the studio mode, the staff is on the top left, which is fine, but the left side
> of the brace is not black. The left bar is also not black. It looks like we have
> some weird styling going on there.

## Problem / opportunity
On the Studio Play tab the grand-staff card renders the **brace** (the curly grand-
staff connector) and the **left barline** in a non-black colour, so they look washed
out / mis-styled against the white-paper card. Everything else on the staff reads
black; only the brace + left bar are off.

## Desired outcome
The brace and the left/system barline render solid black like the rest of the
notation, with no stray colour leaking from a CSS rule.

## Actionable tasks
- [ ] Inspect the abcjs-rendered SVG for the brace + system barline; find why their
      `stroke`/`fill` isn't black (likely a `currentColor`/inherited colour from the
      staff card, or an abcjs class our SCSS tints).
- [ ] Force black on those notation elements (or set the SVG colour at the container).
- [ ] Verify in both Studio Play and the playback view (same staff component).

## Acceptance criteria
- The grand-staff brace and left barline are visually black on the white card.

## Where to look
- `frontend/src/modules/MusicNotation/renderers/AbcRenderer.jsx` (abcjs render +
  `add_classes`) and `frontend/src/modules/Piano/components/CurrentChordStaff.jsx`.
- `frontend/src/Apps/PianoApp.scss` — `.piano-studio-play__staff` / `.current-chord-staff`
  (the white-paper card; check for an inherited `color`).

## Context / evidence
Pure visual/styling bug; no log evidence needed.
