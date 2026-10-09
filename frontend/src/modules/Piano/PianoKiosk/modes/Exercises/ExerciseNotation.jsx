import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AbcRenderer } from '../../../../MusicNotation/renderers/AbcRenderer.jsx';
import { SvgSequenceStaff, sequenceStaffViewBox } from '../../../../MusicNotation/renderers/SvgSequenceStaff.jsx';
import { handForPitch, instanceToAbc } from './exerciseAbc.js';
import { getStaffPositionOnClef } from '../../../../MusicNotation/model/pitch.js';
import { attemptUnderWay, partitionHeldPitches } from '../../../../MusicNotation/model/heldPitch.js';
import {
  SharpShape, FlatShape, ledgerLineYs,
  ACCIDENTAL_WIDTH, ACCIDENTAL_GAP, NOTEHEAD_RX, NOTEHEAD_RY,
} from '../../../../MusicNotation/renderers/staffGlyphs.jsx';
import { placeGhosts, stemDirection } from './ghostEngraving.js';
import {
  accidentalForKey, clefForInstance, eventsToStaffNotes, instanceKeySignature,
} from './runPresentation.js';

const FEEDBACK = ['exercise-note-done', 'exercise-note-next', 'exercise-note-wrong', 'exercise-note-todo', 'exercise-note-hit',
  'exercise-note-early', 'exercise-note-late', 'exercise-note-unplayed', 'exercise-note-at-cursor'];
/** A recorded verdict state → the notehead class a judged (timed) run paints. */
const VERDICT_CLASS = Object.freeze({
  hit: 'exercise-note-hit', early: 'exercise-note-early', late: 'exercise-note-late',
  lapsed: 'exercise-note-unplayed', miss: 'exercise-note-unplayed',
});
const DRIFT_TICK = Object.freeze({ early: '\u25C2', late: '\u25B8' });
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Lane geometry, in glyph units (multiplied by `scale` at draw time).
 *
 * THE LANE FRAMES THE COLUMN. It is centred on the notehead being read and
 * widens only as far as it must to contain whatever the ghost engraving adds to
 * that column (a flipped head and its accidental) — see `ghostEngraving.js`.
 *
 * This used to be the opposite rule: "nothing may be drawn inside the lane that
 * is not the note being read", with the ghost measured out from the lane's
 * right edge (6c4073c14f / 61a86825d5). That kept the ghost off the target
 * head, but it floated the wrong note beside the column, lower, with no stem,
 * touching nothing. The owner's engraving requirement wins: notes on the same
 * beat are one chord on one stem, and a second flips to the other side of the
 * stem. The ghost is the same column, so the lane that frames the column
 * frames the ghost too.
 */
const LANE_HALF_WIDTH = 18;
/** Air between the lane's frame and the outermost ghost ink. */
const LANE_PAD = 3;
/** How far a ledger line reaches past a head, in glyph units. */
const LEDGER_REACH = 5;

/** The column the cursor is on: its heads (root space), stem and measured head half-width. */
function measureColumn(note, { bottom, spacing }) {
  const els = note.els.filter(Boolean);
  const heads = els.flatMap(el => [...el.querySelectorAll('.abcjs-notehead')]).map((el) => {
    const b = rootBox(el);
    return { position: Math.round((bottom - (b.y + b.height / 2)) / (spacing / 2)), cx: b.x + b.width / 2, y: b.y + b.height / 2, half: b.width / 2 };
  });
  const stemEl = els.map(el => el.querySelector('.abcjs-stem')).find(Boolean);
  let stem = null;
  if (stemEl) {
    const b = rootBox(stemEl);
    stem = { x: b.x + b.width / 2, halfWidth: b.width / 2, top: b.y, bottom: b.y + b.height };
    stem.dir = stemDirection(stem, heads.map(h => h.y));
  }
  const half = heads.length ? Math.max(...heads.map(h => h.half)) : null;
  return { heads, stem, half };
}

/**
 * An element's bounding box mapped into THE SVG ROOT'S OWN USER SPACE — the
 * space the portalled feedback group draws in. Falls back to the raw box when
 * there is no CTM (jsdom, or a detached node), where there is no transform to
 * correct for anyway.
 *
 * THIS IS NOT `getCTM()`. That returns the element -> VIEWPORT matrix, which
 * INCLUDES the viewBox transform — CSS-pixel-like coordinates — while the lane
 * rect below is a child of the `<svg>` whose `x`/`y` are in user units that the
 * viewBox then scales. `AbcRenderer`'s `fitContent` rewrites the viewBox to hug
 * the engraving, so the two spaces differ by exactly that scale. Measured on
 * the material the bank actually ships: 4.1x on a one-hand scale, which wrote
 * the lane at x=406 inside a viewBox 302 wide — off the page entirely, so a
 * timed run told a child to follow a cursor that was not on screen; and 2.1x on
 * a grand staff, which put the treble lane over the bass stave and the bass
 * lane off the bottom edge.
 *
 * Composing the root's screen matrix inverse with the element's cancels the
 * viewBox and leaves only the transforms BETWEEN them — the correction this was
 * reaching for, and the mapping `ScorePassage` already uses for the one cursor
 * surface that was never wrong.
 */
function rootBox(element) {
  const box = element.getBBox();
  const svg = element.ownerSVGElement;
  const root = svg && typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  const own = typeof element.getScreenCTM === 'function' ? element.getScreenCTM() : null;
  const m = root && own ? root.inverse().multiply(own) : null;
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


/**
 * @param {Map<number, Map<number, object>>|null} [verdicts] A timed run's
 *   RECORDED verdicts (`performance/timedVerdicts.js`), keyed by event index
 *   then midi. When present the staff judges nothing: every notehead takes its
 *   verdict's colour (hit green, early/late amber with a ◂/▸ tick, lapsed/miss
 *   grey), a recorded wrong pitch draws a red ghost beside the event it was
 *   charged to, and `activeNotes` colours nothing. Absent, unchanged.
 * @param {boolean} [windowOpen] Timed runs: lights the cursor lane while the
 *   current event's window is open and dims it between windows.
 */
export default function ExerciseNotation({ instance, eventIndex = 0, activeNotes = null, complete = false, preview = false, verdicts = null, windowOpen = undefined }) {
  const judged = verdicts instanceof Map;
  /**
   * When the cursor reached the current event — the other half of the ghost
   * rule. Stamped during render rather than from an effect, and only when the
   * index actually moves, so a re-render caused by a key going down cannot
   * shift the clock and turn a real mistake into a sustain.
   */
  const cursorArrivalRef = useRef({ index: null, at: 0 });
  if (cursorArrivalRef.current.index !== eventIndex) {
    cursorArrivalRef.current = { index: eventIndex, at: Date.now() };
  }
  const cursorArrivedAt = cursorArrivalRef.current.at;
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
        const targets = new Set(pitches.map(p => p.midi));
        // AN ATTEMPT AT THIS NOTE NEEDS A KEY PLAYED AT THIS NOTE.
        // This read `Boolean(activeNotes?.size)` — any key down anywhere — which
        // on legato material is true the instant the cursor advances, while the
        // only thing under a finger is the note just played correctly. The new
        // target was not held yet, so it went straight to `exercise-note-wrong`:
        // the next note of a scale turned red before the child had touched it,
        // once per note, all the way up. The ghost layer below already refused
        // that signal; the notehead colour never did, and `SvgSequenceStaff` had
        // been carrying the fix alone since 2026-09-11. One rule, both staves:
        // MusicNotation/model/heldPitch.js.
        const attempting = !judged && current && attemptUnderWay(activeNotes, { cursorArrivedAt, cursorTargets: targets });
        // Judged (timed) runs paint the RECORD: the verdict for this pitch at
        // this event, or plain unplayed ink while nothing is decided yet.
        const recorded = judged ? verdicts.get(index) : null;
        const verdict = recorded?.get(target);
        const verdictClass = verdict ? VERDICT_CLASS[verdict.state] : null;
        const wrongs = judged ? [...(recorded?.values() ?? [])].filter((v) => v.state === 'wrong' && Number.isFinite(v.midi)) : [];
        note.els.forEach((element) => {
          element.classList.remove(...FEEDBACK);
          if (preview) return;
          if (judged) {
            element.classList.add(verdictClass ?? (index === eventIndex ? 'exercise-note-next' : 'exercise-note-todo'));
            // Where the clock cursor is, whatever the record says about it (a
            // lapsed note under the lane is grey, and still the note it marks).
            // A hook for the lane's geometry, carrying no paint of its own.
            if (index === eventIndex) element.classList.add('exercise-note-at-cursor');
          }
          else if (complete || index < eventIndex) element.classList.add('exercise-note-done');
          else if (current) element.classList.add(attempting
            ? activeNotes.has(target) ? 'exercise-note-hit' : 'exercise-note-wrong'
            : 'exercise-note-next');
          else element.classList.add('exercise-note-todo');
        });
        const offbeat = verdict?.state === 'early' || verdict?.state === 'late' ? verdict.state : null;
        const marked = judged && !preview && (offbeat || wrongs.length);
        if (!(current && !preview) && !marked) return;
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
        // A HELD KEY IS NOT AUTOMATICALLY A WRONG ONE. This filtered on
        // membership alone, which on a legato scale draws the note you have
        // just played correctly — and not yet let go of — as a mistake beside
        // the note you are playing now. `partitionHeldPitches` is the shared
        // rule: a ghost needs an ONSET at this entry, which is the same thing
        // the assessor grades on. See MusicNotation/model/heldPitch.js.
        // ONE WRONG NOTE, ONE GHOST, IN ONE PLACE. Both staves of a grand staff
        // are lanes, and each lane was drawing the WHOLE ghost set at its own
        // clef — so a single wrong key appeared twice, once in the treble and
        // once in the bass, at two unrelated heights. MIDI cannot say which
        // hand pressed it, so the ghost goes to the staff whose register holds
        // it: the same middle-C split `exerciseAbc.notesFor` uses to decide
        // which staff a hand-less note is engraved on.
        const onThisStaff = ({ midi }) => staffRef.current.length < 2
          || staffIndex === (handForPitch(midi) === 'left' ? 1 : 0);
        const ghosts = attempting
          ? partitionHeldPitches(activeNotes, { cursorArrivedAt, cursorTargets: targets })
            .ghosts.filter(onThisStaff)
            .map(({ midi }) => ({ midi, ...getStaffPositionOnClef(midi, clef, accidental) }))
          : [];
        const y = Math.min(lines[0] - spacing, box.y - 4 * scale);
        // Keep ledger-line notes inside the same lane, including abcjs's
        // slightly taller noteheads at the bottom edge of the stave.
        const height = Math.max(84 * scale, box.y + box.height + 4 * scale - y);
        const column = measureColumn(note, { bottom, spacing });
        const engrave = (list) => placeGhosts({
          ghosts: list, heads: column.heads, stem: column.stem, bottom, spacing,
          rx: column.half ?? NOTEHEAD_RX * scale,
          accidentalWidth: ACCIDENTAL_WIDTH * scale, accidentalGap: ACCIDENTAL_GAP * scale,
          ledgerReach: LEDGER_REACH * scale, targetMidis: [...targets],
        });
        if (current && !preview) {
          const placed = engrave(ghosts);
          lanes.push({ x, y, height, bottom, scale, spacing, rx: column.half ?? NOTEHEAD_RX * scale, ghosts: placed.ghosts, minX: placed.minX, maxX: placed.maxX });
        }
        if (marked) {
          // Recorded marks, on the event they belong to: an off-beat tick under
          // the notehead, and the wrong pitch as a red ghost engraved into the
          // target's column exactly as the live ghost is.
          lanes.push({
            x, y, height, bottom, scale, spacing, marksOnly: true, rx: column.half ?? NOTEHEAD_RX * scale,
            ...(({ ghosts: g, minX, maxX }) => ({ ghosts: g, minX, maxX }))(engrave(wrongs.filter(onThisStaff).map(({ midi }) => ({ midi, wrong: true, ...getStaffPositionOnClef(midi, clef, accidental) })))),
            tick: offbeat ? { side: offbeat, midi: target, x, y: box.y + box.height + 16 * scale } : null,
          });
        }
      });
    }
    setDecoration(host && lanes.length ? { host, lanes } : null);
  }, [activeNotes, complete, cursorArrivedAt, eventIndex, instance, judged, preview, verdicts]);
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
      {!lane.marksOnly && (() => {
        const pad = LANE_PAD * lane.scale;
        const half = LANE_HALF_WIDTH * lane.scale;
        const left = Math.min(lane.x - half, lane.minX == null ? Infinity : lane.minX - pad);
        const right = Math.max(lane.x + half, lane.maxX == null ? -Infinity : lane.maxX + pad);
        return <rect className={`exercise-notation__cursor${windowOpen === true ? ' is-window-open' : windowOpen === false ? ' is-window-closed' : ''}`} x={left} y={lane.y}
          width={right - left} height={lane.height} rx={4 * lane.scale} />;
      })()}
      {lane.tick && <text className={`exercise-notation__drift exercise-notation__drift--${lane.tick.side}`} data-midi={lane.tick.midi}
        x={lane.tick.x} y={lane.tick.y} textAnchor="middle" fontSize={18 * lane.scale} fill="rgb(180, 110, 0)" stroke="none">{DRIFT_TICK[lane.tick.side]}</text>}
      {lane.ghosts.map(ghost => <g className={`exercise-notation__ghost${ghost.wrong ? ' is-wrong' : ''}${ghost.flipped ? ' is-flipped' : ''}`} key={ghost.midi}>
        {ghost.ledgers.map(l => <line key={l.y} x1={l.x1} x2={l.x2} y1={l.y} y2={l.y} />)}
        {ghost.stemSegment && <line className="exercise-notation__ghost-stem" x1={ghost.stemSegment.x} x2={ghost.stemSegment.x}
          y1={ghost.stemSegment.y1} y2={ghost.stemSegment.y2} strokeWidth={Math.max(ghost.stemSegment.halfWidth * 2, 0.5)} />}
        <ellipse data-midi={ghost.midi} cx={ghost.cx} cy={ghost.cy} rx={lane.rx} ry={NOTEHEAD_RY * lane.scale}
          transform={`rotate(-12, ${ghost.cx}, ${ghost.cy})`} />
        {ghost.accX != null && <g transform={`translate(${ghost.accX}, ${ghost.cy}) scale(${lane.scale})`}>
          {ghost.isSharp ? <SharpShape /> : <FlatShape />}
        </g>}
      </g>)}
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
