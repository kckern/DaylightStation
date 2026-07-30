// LearnInkLayer.jsx — user input rendered as wet ink at the cursor column (wave-3 D).
//
// Learn optimizes for READING: the keyboard shows nothing, so when a wrong note
// lands the only feedback used to be a red shake on the cursor — which says "no"
// without ever saying WHAT you played. This layer answers that: a wrong note
// draws a red notehead AT THE PLAYED PITCH, on the staff, spelled from the
// SOUNDING key, right beside the note that was expected. Hits flash; the machine
// states (Learn rows 1/3, where nothing is gated) ink neutrally so free play
// still leaves a trace.
//
// Everything is ONE <svg> with many children — PendingLayer's jank discipline:
// the layer redraws on every keypress, and one node with N shapes costs a single
// style/layout pass where N absolutely-positioned elements cost N. It also puts
// every glyph in the layout extract's own pixel coordinate space, so there is no
// per-note transform arithmetic and never a re-engrave.
//
// Glyphs are hand-drawn SVG (WetNoteGlyph), never Unicode music characters — the
// U+266x/U+1D15x glyphs render as tofu in the kiosk's browser.
//
// Pure by construction: the PARENT owns ink lifecycle (append on note_on, timed
// removal). This component has no state and no timers.

import { WetNoteGlyph } from '../Composer/wetGlyphs.jsx';
import { spellMidi } from '../../../../MusicNotation/model/spellMidi.js';

/**
 * @param {Object} p
 * @param {Array<{id:number, midi:number, staff:number, system:number, x:number,
 *   kind:'wrong'|'hit'|'neutral'}>} p.inks - live ink marks, parent-owned.
 * @param {Array<{system:number, staff:number, top:number, left:number,
 *   right:number, lineSpacing:number}>} p.staffBoxes - per-staff geometry (Task 5).
 * @param {Object} p.clefs - 0-based staff id → { sign }. Derived from
 *   `parsed.parts[0].clefs`, which is keyed by 1-based MusicXML staff NUMBER, so
 *   the caller shifts (`clefs[staff + 1]`) before handing it over.
 * @param {number} p.keyFifths - the SOUNDING key signature (soundingFifths of the
 *   written key + transpose), so a transposed piece spells on its heard grid.
 */
export default function LearnInkLayer({ inks = [], staffBoxes = [], clefs = {}, keyFifths = 0 }) {
  if (!inks.length || !staffBoxes.length) return null;

  const glyphs = [];
  for (const ink of inks) {
    const staff = staffBoxes.find((b) => b.system === ink.system && b.staff === ink.staff);
    if (!staff) continue; // geometry not reported (mid re-engrave) — skip, don't guess
    glyphs.push(
      <g key={ink.id} className={`piano-learn-ink__note is-${ink.kind}`}>
        <WetNoteGlyph
          x={ink.x}
          staff={staff}
          // A struck note has no duration — always a filled head with a stem.
          type="quarter"
          // Staff 1 is the lower staff on a grand staff (activeParts.js convention),
          // so bass is the honest fallback when the parse reported no clef.
          clef={clefs[ink.staff] || { sign: ink.staff >= 1 ? 'F' : 'G' }}
          pitch={spellMidi(ink.midi, keyFifths)}
          classPrefix="piano-learn-ink"
        />
      </g>,
    );
  }
  if (!glyphs.length) return null;

  return (
    <svg className="piano-learn-ink" aria-hidden="true">
      {glyphs}
    </svg>
  );
}
