import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AbcRenderer } from '../../../../MusicNotation/renderers/AbcRenderer.jsx';
import { SvgSequenceStaff, sequenceStaffViewBox } from '../../../../MusicNotation/renderers/SvgSequenceStaff.jsx';
import { instanceToAbc } from './exerciseAbc.js';
import { getStaffPositionOnClef } from '../../../../MusicNotation/model/pitch.js';
import {
  SharpShape, FlatShape, ledgerLineYs,
  ACCIDENTAL_WIDTH, ACCIDENTAL_GAP, NOTEHEAD_RX, NOTEHEAD_RY,
} from '../../../../MusicNotation/renderers/staffGlyphs.jsx';
import {
  accidentalForKey, clefForInstance, eventsToStaffNotes, instanceKeySignature,
} from './runPresentation.js';

const FEEDBACK = ['exercise-note-done', 'exercise-note-next', 'exercise-note-wrong', 'exercise-note-todo', 'exercise-note-hit'];
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Lane and ghost geometry, in glyph units (multiplied by `scale` at draw time).
 *
 * The lane is CENTRED ON THE NOTEHEAD — that is its whole job, and nothing may
 * be drawn inside it that is not the note being read. Everything about the
 * ghost is therefore derived from the lane's right edge outward, so a ghost can
 * never re-enter the lane no matter how the numbers are tuned later. The
 * previous hard-coded offsets put the ghost's head 7 units past the lane edge
 * and its accidental 1.5 units from the lane's CENTRE — i.e. stamped on top of
 * the very notehead the lane exists to show.
 */
const LANE_HALF_WIDTH = 18;
/** Air between the lane edge and whatever the ghost puts next to it. */
const GHOST_GUTTER = 4;

/**
 * An element's bounding box mapped into the nearest viewport's user space —
 * the space the portalled feedback group is drawn in. Falls back to the raw
 * box when there is no CTM (jsdom, or a detached node), which is also the
 * pre-existing behaviour, so nothing regresses where transforms are absent.
 */
function rootBox(element) {
  const box = element.getBBox();
  const m = typeof element.getCTM === 'function' ? element.getCTM() : null;
  if (!m) return box;
  // Axis-aligned in practice (abcjs only ever translates and scales), so the
  // two corners are enough; a rotation would need all four.
  const x1 = m.a * box.x + m.c * box.y + m.e;
  const y1 = m.b * box.x + m.d * box.y + m.f;
  const x2 = m.a * (box.x + box.width) + m.c * (box.y + box.height) + m.e;
  const y2 = m.b * (box.x + box.width) + m.d * (box.y + box.height) + m.f;
  return {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
  };
}


export default function ExerciseNotation({ instance, eventIndex = 0, activeNotes = null, complete = false, preview = false }) {
  const staffRef = useRef([]);
  const [decoration, setDecoration] = useState(null);
  const abc = useMemo(() => instanceToAbc(instance), [instance]);
  const paint = useCallback(() => {
    const lanes = [];
    let host = null;
    for (const [staffIndex, staff] of staffRef.current.entries()) {
      staff.forEach((note, pitchedIndex) => {
        const index = note.eventIndex ?? pitchedIndex;
        const pitches = instance.events[index]?.notes ?? [];
        const hand = staffIndex === 0 ? 'right' : 'left';
        // Match exerciseAbc.notesFor: an explicit matching hand wins; a lone
        // handless pitch joins its register's hand when both staves exist.
        const renderedPitch = staffRef.current.length < 2 ? pitches[0]
          : pitches.find(p => p.hand === hand)
            ?? (pitches.length === 1 && !pitches[0].hand
              && (pitches[0].midi < 60 ? 'left' : 'right') === hand ? pitches[0] : null);
        const target = note.midi ?? renderedPitch?.midi;
        const current = !complete && index === eventIndex;
        const attempting = current && Boolean(activeNotes?.size);
        note.els.forEach((element) => {
          element.classList.remove(...FEEDBACK);
          if (preview) return;
          if (complete || index < eventIndex) element.classList.add('exercise-note-done');
          else if (current) element.classList.add(attempting
            ? activeNotes.has(target) ? 'exercise-note-hit' : 'exercise-note-wrong'
            : 'exercise-note-next');
          else element.classList.add('exercise-note-todo');
        });
        if (!current || preview) return;
        const svg = note.els[0]?.closest('svg');
        const head = note.els[0]?.querySelector('.abcjs-notehead');
        const stave = svg?.querySelectorAll('.abcjs-staff')[staffIndex];
        if (!head || !stave || typeof head.getBBox !== 'function') return;
        host = svg.querySelector('.exercise-notation__feedback');
        if (!host) {
          host = document.createElementNS(SVG_NS, 'g');
          host.setAttribute('class', 'exercise-notation__feedback');
          host.setAttribute('pointer-events', 'none');
          svg.insertBefore(host, svg.firstChild);
        }
        // MEASURE IN THE ROOT'S SPACE, NOT THE NOTEHEAD'S. `getBBox()` reports
        // an element's box in its OWN user space, before any ancestor
        // transform; the cursor rect is portalled into a group at the svg root.
        // When abcjs wraps a stave in a transformed group those two spaces are
        // not the same, and the lane lands beside the note it is supposed to be
        // centred on. `getCTM()` is the element -> nearest-viewport matrix, so
        // mapping the box through it puts every measurement below in the same
        // space the rect is drawn in.
        const box = rootBox(head);
        const lines = [...stave.querySelectorAll('path')].map(path => rootBox(path).y).sort((a, b) => a - b);
        const spacing = lines.length >= 2 ? lines[1] - lines[0] : 7.75;
        const scale = spacing / 14;
        const clef = staffRef.current.length > 1 ? (staffIndex === 0 ? 'treble' : 'bass') : clefForInstance(instance);
        const accidental = accidentalForKey(instanceKeySignature(instance));
        const x = box.x + box.width / 2;
        const bottom = lines.at(-1) + 0.35;
        const targets = new Set(pitches.map(p => p.midi));
        const ghosts = attempting ? [...activeNotes.keys()].filter(midi => !targets.has(midi)).map(midi => ({
          midi, ...getStaffPositionOnClef(midi, clef, accidental),
        })) : [];
        const y = Math.min(lines[0] - spacing, box.y - 4 * scale);
        // Keep ledger-line notes inside the same lane, including abcjs's
        // slightly taller noteheads at the bottom edge of the stave.
        const height = Math.max(84 * scale, box.y + box.height + 4 * scale - y);
        lanes.push({ x, y, height, bottom, scale, spacing, ghosts });
      });
    }
    setDecoration(host && lanes.length ? { host, lanes } : null);
  }, [activeNotes, complete, eventIndex, instance, preview]);
  useEffect(paint, [paint]);
  const rendered = useCallback((_tune, staffNotes) => { staffRef.current = staffNotes; paint(); }, [paint]);
  // instanceToAbc returns '' for material this module has no business drawing
  // (ordering:'any' — that plays through KeysAsk/SvgSequenceStaff instead).
  // AbcRenderer given abc="" still mounts a real, empty-tune SVG; render
  // nothing rather than that hairline artifact.
  if (!abc) return null;
  return <><AbcRenderer abc={abc} scale={preview ? 0.72 : 1} singleLine={!preview} fitContent onRender={rendered} />
    {decoration && createPortal(decoration.lanes.map((lane, index) => <g key={index}>
      {/* Same lane geometry and yellow treatment as the original sequence
          cursor (39cf60b81), scaled to this engraving's staff spacing. */}
      <rect className="exercise-notation__cursor" x={lane.x - LANE_HALF_WIDTH * lane.scale} y={lane.y}
        width={LANE_HALF_WIDTH * 2 * lane.scale} height={lane.height} rx={4 * lane.scale} />
      {lane.ghosts.map(ghost => {
        // Everything here is measured OUT FROM the lane's right edge, so the
        // ghost sits beside the note being read rather than on top of it. An
        // accidental claims the first slot; without one the head moves in to
        // close the gap, which keeps the annotation tight to its note.
        const laneEdge = lane.x + LANE_HALF_WIDTH * lane.scale;
        const hasAccidental = ghost.isSharp || ghost.isFlat;
        const accX = laneEdge + (GHOST_GUTTER + ACCIDENTAL_WIDTH / 2) * lane.scale;
        const x = hasAccidental
          ? accX + (ACCIDENTAL_WIDTH / 2 + ACCIDENTAL_GAP + NOTEHEAD_RX) * lane.scale
          : laneEdge + (GHOST_GUTTER + NOTEHEAD_RX) * lane.scale;
        const y = lane.bottom - ghost.position * lane.spacing / 2;
        return <g className="exercise-notation__ghost" key={ghost.midi}>
          {ledgerLineYs(ghost.position, lane.bottom, lane.spacing / 2).map(ly =>
            <line key={ly} x1={x - (NOTEHEAD_RX + 5) * lane.scale} x2={x + (NOTEHEAD_RX + 5) * lane.scale}
              y1={ly} y2={ly} />)}
          <ellipse data-midi={ghost.midi} cx={x} cy={y} rx={NOTEHEAD_RX * lane.scale} ry={NOTEHEAD_RY * lane.scale}
            transform={`rotate(-12, ${x}, ${y})`} />
          {hasAccidental && <g transform={`translate(${accX}, ${y}) scale(${lane.scale})`}>
            {ghost.isSharp ? <SharpShape /> : <FlatShape />}
          </g>}
        </g>;
      })}
    </g>), decoration.host)}
  </>;
}

/**
 * The exercise browser's preview card — what an instance LOOKS like, before
 * anybody plays it.
 *
 * The card mounted `ExerciseNotation` alone, and `instanceToAbc` answers `''`
 * for `ordering: 'any'`, so the component rendered `null` and the card was
 * blank for every one of the 1,128 unordered instances the bank publishes:
 * `chords/*`, `intervals/all`, `notes/single`. Those had no notation anywhere —
 * the run stage draws them as lit keys, and the browser drew nothing at all,
 * which reads as an exercise with no music in it.
 *
 * `SvgSequenceStaff` is the renderer that CAN draw them: an unordered ask is
 * one simultaneity, and it takes exactly that as a single `{ midis: [...] }`
 * column. There is no cursor on a preview — `cursorIndex: -1` puts every column
 * in the `todo` state and draws no cursor rect — because nothing is being
 * played yet, and a "next note" marker on a card would be a promise the card
 * cannot keep. Ordered material keeps the ABC path it already had.
 */
export function ExercisePreview({ instance }) {
  const staffNotes = useMemo(
    () => (instance?.ordering === 'any' ? eventsToStaffNotes(instance.events) : null),
    [instance],
  );
  // Ordered material keeps the card it already had, props and all — this
  // component exists to fill a hole, not to restyle what was already drawn.
  if (!staffNotes) return <ExerciseNotation instance={instance} />;
  if (!staffNotes.length) return null;
  const viewBox = sequenceStaffViewBox(staffNotes.length);
  return (
    <div
      className="piano-exercises__preview-staff"
      style={{ '--staff-aspect': viewBox.width / viewBox.height }}
    >
      <SvgSequenceStaff
        notes={staffNotes}
        cursorIndex={-1}
        clef={clefForInstance(instance)}
        accidental={accidentalForKey(instanceKeySignature(instance))}
      />
    </div>
  );
}
