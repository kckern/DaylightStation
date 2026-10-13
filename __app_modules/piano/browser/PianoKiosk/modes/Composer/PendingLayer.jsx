// PendingLayer.jsx — the "wet ink" overlay (spec §2.1).
//
// OSMD re-engraves the whole score on every edit (it has no incremental API and
// clears its host with innerHTML=''), so the staff visibly tears down per
// keypress. This layer paints notes the kid JUST entered as lightweight SVG on
// top of the settled engraving, so "press a key → see a note" never waits on a
// re-engrave. The notes dry into real notation at the next settle, at which
// point wetInk.js's pendingAppendDiff returns no pending notes and this renders
// nothing.
//
// Glyphs are hand-drawn SVG, never Unicode music characters — U+266F/U+266D and
// the U+1D15x note glyphs render as tofu in the kiosk's browser. Same rule and
// reason as DurationPalette.jsx.
//
// Everything is ONE <svg> with many children rather than an element per note:
// the layer redraws on every keypress, and one node with N shapes costs the
// browser a single style/layout pass, where N absolutely-positioned elements
// cost N. It also lets every glyph share the layout extract's pixel coordinate
// space directly, so no per-note transform arithmetic is needed.

import { WetNoteGlyph } from './wetGlyphs.jsx';
import {
  WET_ADVANCE_UNITS, WET_RX_UNITS, MIDDLE_LINE, staffPositionOf, stemDirectionFor,
} from './wetGlyphGeometry.js';
import { simultaneityRuns } from './pendingLayerModel.js';

export function PendingLayer({ staves, anchorX, anchorSystem = 0, pending = [], clef }) {
  const staff = staves?.[anchorSystem];
  if (!staff || !pending.length) return null;

  const { top, right, lineSpacing } = staff;
  const half = lineSpacing / 2;
  // `top` is the TOP line; five lines with four gaps put the bottom line 4 spaces down.
  const bottomLineY = top + lineSpacing * 4;
  const yFor = (position) => bottomLineY - position * half;

  const rx = lineSpacing * WET_RX_UNITS;
  const advance = lineSpacing * WET_ADVANCE_UNITS;
  // Clamp on the notehead's right EDGE, not its centre, so wet ink never spills
  // past the end of the system into the margin.
  const maxX = right - rx;

  const glyphs = [];

  // One stem direction per simultaneity, decided by the member farthest from the
  // middle line. Rests carry no pitch, so they contribute no position.
  const stemDirections = new Map();
  simultaneityRuns(pending).forEach((run) => {
    const positions = run
      .filter((i) => !pending[i]?.rest && pending[i]?.pitch)
      .map((i) => staffPositionOf(pending[i].pitch, clef));
    if (!positions.length) return;
    const dir = stemDirectionFor(positions);
    run.forEach((i) => stemDirections.set(i, dir));
  });

  pending.forEach((n, i) => {
    const x = Math.min(anchorX + i * advance, maxX);
    const key = `wet-${i}`;

    if (n.rest) {
      // A neutral block parked on the middle line — deliberately not a real rest
      // glyph (a proper set is a later task), just something unmistakably not a
      // notehead so the kid sees the beat register.
      const w = lineSpacing * 0.9;
      const h = lineSpacing;
      glyphs.push(
        <rect
          key={key}
          className="composer-wet-note__rest"
          x={x - w / 2}
          y={yFor(MIDDLE_LINE) - h / 2}
          width={w}
          height={h}
          rx={lineSpacing * 0.12}
          fill="currentColor"
        />
      );
      return;
    }

    glyphs.push(
      <WetNoteGlyph
        key={key}
        x={x}
        staff={staff}
        clef={clef}
        pitch={n.pitch}
        type={n.type}
        dots={n.dots}
        stemDirection={stemDirections.get(i) || null}
      />
    );
  });

  return (
    <svg className="composer-wet-note" aria-hidden="true">
      {glyphs}
    </svg>
  );
}

export default PendingLayer;
