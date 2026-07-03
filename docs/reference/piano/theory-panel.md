# Theory Panel

The **TheoryPanel** is the shared music-theory composite shown alongside the piano
kiosk's Studio and Videos modes: a circle of fifths, a live "current chord" grand
staff, and a chord-name plaque, all reading from the same live MIDI surface.

- Component: `frontend/src/modules/Piano/components/TheoryPanel.jsx` (+ `TheoryPanel.scss`)
- Regression test: `tests/live/flow/piano/piano-theory-panel.runtime.test.mjs`

## One component, two layouts

`<TheoryPanel activeNotes={...} layout="row" | "column" />`

| Layout | Orientation | Used by |
|--------|-------------|---------|
| `row` (default) | circle · staff · chord, horizontal | Studio Play + Playback top pane (`StudioPlay.jsx`, `StudioPlayback.jsx`, inside `StudioTopPane`) |
| `column` | circle / staff / chord, vertical | Videos lecture-player sidebar (`PianoVideoPlayer.jsx`) |

It replaced two hand-rolled composites (`StudioTriptych`, `PianoChordColumn`) that
wired the same three children with divergent, per-consumer layout plumbing.

The three children are unchanged and reused as-is:
`CircleOfFifths`, `CurrentChordStaff` (→ `ChordStaffRenderer`), `ChordNamePanel`.

## The sizing contract (why the staff can't balloon)

The live staff is a VexFlow SVG (`renderers/chordStaff.js` via `ChordStaffRenderer.jsx`).
An SVG with `height:100%` and no definite-height ancestor falls back to its **viewBox
intrinsic aspect** — historically ballooning to ~2653px tall inside a 256px card and
shoving the circle and chord plaque out of the clipped pane (only high-note stems
peeked in). The fix makes the staff physically unable to drive layout:

1. **The renderer host owns its box** (`ChordStaffRenderer.scss`): `.chord-staff` is a
   normal block that fills its container; the `<svg>` is `position:absolute; inset:0`.
   A container that fails to size the host yields a small/empty staff — **never** a
   viewport-height balloon.
2. **The engraving FILLS its box** (`computeChordStaffLayout` in `chordStaff.js`): a
   `ResizeObserver` in `ChordStaffRenderer.jsx` measures the host's real box aspect
   (bucketed to 0.05 to avoid re-render thrash) and sizes the stave width to match,
   so the viewBox aspect equals the box aspect and the staff lines span the full
   width with **no side gutters**. Floored at the content minimum for narrow slots;
   **no upper cap** — the stave is fixed to the box width regardless of the chord, so
   it never jumps as you play and always leaves room for the clef + key signature +
   notes. Content flows from the LEFT (clef → key signature → chord); anything that
   overruns the fixed width is trimmed by the host's `overflow`.
3. **The panel provides definite heights** (`TheoryPanel.scss`): flexbox only, every
   slot carries `min-width/height: 0` so percentage chains resolve. In `column` layout
   the staff slot is given a bounded, definite height (it must not flex-grab the whole
   sidebar — a single chord shouldn't be 600px tall).

**Consequence for new consumers:** just drop `<TheoryPanel>` into a sized box. You do
not need to reconstruct a definite-height ancestor chain — the renderer owns that now.

## Guardrail

`piano-theory-panel.runtime.test.mjs` measures real `getBoundingClientRect` boxes on
`/piano/studio` and fails if the circle, staff, or chord plaque escapes the top-pane
box — at rest and while a high note is held (the exact regression trigger). It also
asserts the staff viewBox is landscape, proving the aspect-fill ResizeObserver is live.
Run it against a specific dev server with `BASE_URL=http://localhost:<port> npx
playwright test tests/live/flow/piano/piano-theory-panel.runtime.test.mjs`.
