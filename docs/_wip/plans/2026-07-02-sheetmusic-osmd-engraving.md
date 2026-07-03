# Sheet Music: OSMD-backed engraving (design)

**Date:** 2026-07-02
**Status:** shipped (verified live on Fur Elise: beams, ties, stems, fingerings, dynamics, both flows, cursor alignment)

## Problem

The piano kiosk's sheet-music view (`ScorePlayer` → `MusicXmlRenderer` → `vexflowRender.js`)
draws bare VexFlow `StaveNote`s: no beams, ties, slurs, key signatures, stem logic, or
multi-voice support. Scores read like "cheap MIDI rendering," not engraved sheet music.
Goal: near-perfect engraving parity with the source MusicXML.

## Decision

Adopt **OpenSheetMusicDisplay (OSMD)** as the engraving engine, hidden behind the existing
`MusicXmlRenderer` component contract. Rejected alternatives: Verovio (heavier WASM; only
needed if OSMD quality is insufficient) and extending the custom VexFlow renderer
(re-implements years of engraving edge cases).

## Architecture

- `MusicXmlRenderer.jsx` keeps its props: `musicXml`, `flow`, `scale`, `onLayout`, `children`.
  Consumers (`ScorePlayer`) are unchanged except where noted.
- New `renderers/osmdRender.js` — the only file importing `opensheetmusicdisplay`
  (lazy `import()` so the kiosk bundle stays lean).
  - `load(xml)` → `osmd.Zoom = scale` → `render()`.
  - Options: `backend: 'svg'`, `autoResize: false` (we keep the existing ResizeObserver),
    `drawTitle/Composer/PartNames: false` (ScorePlayer owns the title block).
  - `flow: 'horizontal'` → `renderSingleHorizontalStaffline: true`; `wrapped` → default.
- **Events for the Follow cursor:** after render, iterate OSMD's internal cursor start→end;
  per step take the top non-rest, non-grace, non-tie-continuation note of the top staff;
  emit `{midi: halfTone+12, onsetQuarter: timestamp*4, x, top, bottom}` from the cursor
  element's on-screen geometry. Then reset + hide OSMD's cursor — the custom green overlay
  div in ScorePlayer (wrong-flash, tap-to-seek) stays as-is.
- `parseMusicXml.js` remains for the metadata header (title, composer, key, tempo, measures).
- `vexflowRender.js` is no longer used by this path (other renderers untouched); delete once
  the swap is verified.

## Testing / verification

- Pure helpers (note filtering, midi mapping) unit-tested; OSMD itself is not run under
  jsdom (needs real text measurement).
- Consumers' tests already mock `MusicXmlRenderer`; they stay green.
- Live verification: render Fur Elise (super easy) on the dev server, screenshot, and
  visually check beams/ties/stems/key signature against the MusicXML.
