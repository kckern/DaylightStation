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
// that resets the line, and the newest column's promotion from a provisional quarter
// to a half once it has been held long enough. The second is why it is 80ms and not
// the 250ms the idle sweep alone used to run at — a quarter of a second late is
// visible on a note you are watching yourself hold.
//
// It cannot cost an idle re-render: clearIfIdle returns the same flow when there is
// nothing to clear, and the duration sync returns the same array when nothing has
// changed, so React bails out of both.
const PROVISIONAL_TICK_MS = 80;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'current-chord-staff' });
  return _logger;
}

/**
 * Live grand staff of what is being played.
 *
 * Notes read left to right, like typing: each new strike lands to the right of the
 * last, while notes struck together (within a hand's roll, see noteFlow GAP_MS /
 * SPAN_MAX_MS) stack into one column. A rolled chord is one column carrying its
 * arrivals; the staff reads each hand's roll from them. After a pause the next strike starts a fresh line, and an abandoned line
 * is wiped after STALE_CLEAR_MS.
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
 * Spelling: only the newest column follows the live key; closed columns keep the
 * spelling they were given so a key change never rewrites notes already on the page.
 *
 * Key signature: when a `detectedKey` prop is supplied (TheoryPanel passes the shared
 * key so the circle + staff agree), it wins. Otherwise the component falls back to
 * its own rolling detection via useDetectedKey — preserving the standalone behavior.
 *
 * @param {Map} activeNotes - live MIDI surface (Map<midi, data>)
 * @param {string} [detectedKey] - externally-owned key; overrides internal detection
 */
export function CurrentChordStaff({ activeNotes, detectedKey }) {
  const [flow, setFlow] = useState(emptyFlow);
  const [durations, setDurations] = useState([]);
  const prevStampsRef = useRef(new Map());

  // The tick needs the current flow and the current key-down surface, but must not be
  // torn down and rebuilt on every note — hence refs rather than effect deps.
  const flowRef = useRef(flow);
  flowRef.current = flow;

  // Always run the hook (Rules of Hooks); the prop takes precedence when present.
  const internalKey = useDetectedKey(activeNotes);
  const keySig = detectedKey ?? internalKey;

  // Same array identity when nothing changed, so a held note doesn't re-render the
  // staff eighty times a second waiting to become a half.
  const syncDurations = useCallback(() => {
    const next = flowDurations(flowRef.current, Date.now());
    setDurations((prev) => (
      prev.length === next.length && prev.every((d, i) => d === next[i]) ? prev : next
    ));
  }, []);

  // The next flow is computed from flowRef and then stored (ref first, so a second
  // effect in the same batch builds on it), rather than inside a setFlow updater: the
  // column-closed log must not fire from an updater, which React may run twice.
  const commit = useCallback((next) => {
    if (next === flowRef.current) return;
    flowRef.current = next;
    setFlow(next);
  }, []);

  useEffect(() => {
    const now = Date.now();
    const { onsets, at, released, next } = diffNoteSurface(prevStampsRef.current, activeNotes, now);
    prevStampsRef.current = next;
    if (onsets.length === 0 && !released) return;

    let flow2 = flowRef.current;
    if (onsets.length) {
      const before = flow2.columns[flow2.columns.length - 1];
      flow2 = pushOnsets(flow2, onsets, at, { held: activeNotes });
      const after = flow2.columns[flow2.columns.length - 1];
      if (before && after && after.startedAt !== before.startedAt) {
        // `before` was just closed; its stored duration is now the IOI judgement.
        const closed = flow2.columns.find((c) => c.startedAt === before.startedAt);
        if (closed) {
          // The strokes the staff draws for it, per hand — what the player sees.
          const rolls = columnRolls(closed);
          logger().sampled('chord-staff.column-closed', {
            notes: closed.midis,
            spanMs: closed.lastOnsetAt - closed.startedAt,
            trebleRoll: rolls.treble,
            bassRoll: rolls.bass,
            duration: closed.duration,
          }, { maxPerMinute: 20, aggregate: true });
        }
      }
    }
    commit(pushReleases(flow2, now, activeNotes));
  }, [activeNotes, commit]);

  // A new column closes the previous one and fixes its duration, so the durations have
  // to be re-read whenever the flow changes, not only on the tick.
  useEffect(() => { syncDurations(); }, [flow, syncDurations]);

  useEffect(() => {
    const id = setInterval(() => {
      commit(clearIfIdle(flowRef.current, Date.now()));
      syncDurations();
    }, PROVISIONAL_TICK_MS);
    return () => clearInterval(id);
  }, [syncDurations, commit]);

  // Each column is spelled AS A CHORD (see identifyChord), so the staff and the chord
  // plaque can only ever show the same reading, and the key signature beside them.
  const columns = useMemo(
    () => buildRenderColumns(flow, durations, keySig),
    [flow, keySig, durations],
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
