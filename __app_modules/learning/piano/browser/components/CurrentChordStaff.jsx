import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChordStaffRenderer } from "../../../../../__capabilities/music-notation/browser/renderers/ChordStaffRenderer.jsx";
import {
  emptyFlow, pushOnsets, pushReleases, clearIfIdle, flowDurations, columnRolls,
} from "../../../../../__capabilities/music-notation/browser/model/noteFlow.js";
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { diffNoteSurface, buildRenderColumns } from './liveStaffColumns.js';
import { useDetectedKey } from './useDetectedKey.js';
import './CurrentChordStaff.scss';

// Music-theory model (key signatures, key detection, hand split, note flow, rhythm)
// lives in the shared MusicNotation framework. CurrentChordStaff keeps the live-input
// concerns — watching the MIDI surface for onsets, ageing the flow out — and delegates
// key detection to the shared useDetectedKey hook and rendering to ChordStaffRenderer.

// How often the staff re-examines the clock. Two jobs ride this tick: the idle sweep
// that resets the line, and the newest column's growth from a provisional eighth to a
// quarter, then a half, as it is held long enough. The second is why it is 80ms and not
// the 250ms the idle sweep alone used to run at — a quarter of a second late is
// visible on a note you are watching yourself hold.
//
// It cannot cost an idle re-render: clearIfIdle and pushReleases return the same flow
// when there is nothing to do, and flowDurations hands back the previous array when no
// duration moved, so commit() never sets state.
const PROVISIONAL_TICK_MS = 80;

const NOTHING_HELD = new Map();
const emptyView = () => ({ flow: emptyFlow(), durations: [] });

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'current-chord-staff' });
  return _logger;
}

/**
 * pushReleases, logging any legato split it made — the one release-side change that
 * reshapes columns already drawn. A split piece is a column whose start the flow did
 * not have before (the earlier piece keeps the merged column's start).
 */
function settle(flow, now, held) {
  const next = pushReleases(flow, now, held);
  if (next === flow) return next;
  const known = new Set(flow.columns.map((c) => c.startedAt));
  next.columns.forEach((c, i) => {
    if (known.has(c.startedAt)) return;
    const prev = next.columns[i - 1];
    logger().sampled('chord-staff.legato-split', {
      notes: prev?.midis ?? [],
      next: c.midis,
      stepMs: prev ? c.startedAt - prev.startedAt : null,
    }, { maxPerMinute: 20, aggregate: true, level: 'debug' });
  });
  return next;
}

/**
 * Live grand staff of what is being played.
 *
 * Notes read left to right, like typing: each new strike lands to the right of the
 * last, while notes struck together (within a hand's roll, see noteFlow GAP_MS /
 * SPAN_MAX_MS) stack into one column. A rolled chord is one column carrying its
 * arrivals; the staff reads each hand's roll from them. After a pause the next
 * strike starts a fresh line, and an abandoned line is wiped after STALE_CLEAR_MS.
 *
 * RHYTHM, such as it is: each column draws as an eighth, a quarter, or a half,
 * decided in model/noteFlow.js by how its gap to the next strike compares with the
 * last few seconds of playing, and by how long a chord is held. No meter, no barline,
 * nothing quantised.
 *
 * The flow is driven by what the surface DOES, diffed per key with its timestamp: a
 * key going down is an onset, a re-strike of a key still held is an onset too (its
 * timestamp changes), and a key coming up releases the columns it was holding. A note
 * stays on the staff after release until it scrolls off or the line resets.
 *
 * Spelling: every column is spelled in the CURRENT key, so the letters drawn always
 * agree with the key signature beside them; a key change re-spells the whole line
 * (see buildRenderColumns).
 *
 * Key signature: when a `detectedKey` prop is supplied (TheoryPanel passes the shared
 * key so the circle + staff agree), it wins. Otherwise the component falls back to
 * its own rolling detection via useDetectedKey — preserving the standalone behavior.
 *
 * @param {Map} activeNotes - live MIDI surface (Map<midi, data>)
 * @param {string} [detectedKey] - externally-owned key; overrides internal detection
 */
export function CurrentChordStaff({ activeNotes, detectedKey }) {
  // The flow and its durations are ONE piece of state, computed together in commit():
  // a new column and the duration it draws with arrive in the same render, so one
  // change is one engrave (durations held separately lagged a render, drawing new
  // columns with their neighbours' glyphs for a frame and engraving twice per onset).
  const [view, setView] = useState(emptyView);
  // The tick needs the current view and the current key-down surface, but must not be
  // torn down and rebuilt on every note — hence refs rather than effect deps. Only
  // commit() writes viewRef, so it can never roll back to a stale render's view.
  const viewRef = useRef(view);
  const prevStampsRef = useRef(new Map());
  // The tick reads the key-down surface too (a pending legato split settles on it).
  const activeRef = useRef(activeNotes);
  activeRef.current = activeNotes;

  // Always run the hook (Rules of Hooks); the prop takes precedence when present.
  const internalKey = useDetectedKey(activeNotes);
  const keySig = detectedKey ?? internalKey;

  // The next flow is computed from viewRef and then stored (ref first, so a second
  // effect in the same batch builds on it), rather than inside a setState updater: the
  // logs must not fire from an updater, which React may run twice. Durations are read
  // here too, against the previous array, so a held note waiting to become a half does
  // not re-render the staff every tick: same flow + same durations = no state change.
  const commit = useCallback((nextFlow, now) => {
    const prev = viewRef.current;
    const durations = flowDurations(nextFlow, now, prev.durations);
    if (nextFlow === prev.flow && durations === prev.durations) return;
    const next = { flow: nextFlow, durations };
    viewRef.current = next;
    setView(next);
  }, []);

  useEffect(() => {
    const now = Date.now();
    const { onsets, at, released, next } = diffNoteSurface(prevStampsRef.current, activeNotes, now);
    prevStampsRef.current = next;
    if (onsets.length === 0 && !released) return;

    let flow2 = viewRef.current.flow;
    if (onsets.length) {
      const before = flow2.columns[flow2.columns.length - 1];
      flow2 = pushOnsets(flow2, onsets, at, { held: activeNotes });
      const after = flow2.columns[flow2.columns.length - 1];
      if (before && after && after.startedAt !== before.startedAt) {
        // `before` was just closed; its stored duration is now the IOI judgement.
        const closed = flow2.columns.find((c) => c.startedAt === before.startedAt);
        if (closed) {
          // The strokes the staff draws for it, per hand — what the player sees.
          // Debug: it fires on every column while anyone plays.
          const rolls = columnRolls(closed);
          logger().sampled('chord-staff.column-closed', {
            notes: closed.midis,
            spanMs: closed.lastOnsetAt - closed.startedAt,
            trebleRoll: rolls.treble,
            bassRoll: rolls.bass,
            duration: closed.duration,
          }, { maxPerMinute: 20, aggregate: true, level: 'debug' });
        }
      }
    }
    commit(settle(flow2, now, activeNotes), now);
  }, [activeNotes, commit]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      // pushReleases on the tick as well as on key events: a legato split is only
      // decided once the next key has stayed down past LIFT_TOGETHER_MS, and with no
      // further key event (C then D, D held) it would otherwise wait for the next touch.
      // The tick bounds that wait to LIFT_TOGETHER_MS + PROVISIONAL_TICK_MS. Same object
      // when nothing settles; commit() also re-reads the durations (the newest
      // column's provisional eighth grows to a quarter, then a half, on the clock alone).
      const held = activeRef.current ?? NOTHING_HELD;
      commit(settle(clearIfIdle(viewRef.current.flow, now), now, held), now);
    }, PROVISIONAL_TICK_MS);
    return () => clearInterval(id);
  }, [commit]);

  // Each column is spelled AS A CHORD (see identifyChord), so the staff and the chord
  // plaque can only ever show the same reading, and the key signature beside them.
  const columns = useMemo(
    () => buildRenderColumns(view.flow, view.durations, keySig),
    [view, keySig],
  );

  return (
    <div className="current-chord-staff-wrapper">
      <ChordStaffRenderer
        columns={columns}
        keySignature={keySig}
        className="chord-staff current-chord-staff"
      />
    </div>
  );
}

export default CurrentChordStaff;
