import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChordStaffRenderer } from '../../MusicNotation/renderers/ChordStaffRenderer.jsx';
import {
  emptyFlow, pushOnsets, clearIfIdle, flowColumns, flowDurations,
} from '../../MusicNotation/model/noteFlow.js';
import { identifyChord } from '../theory/chordNaming.js';
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

/**
 * Live grand staff of what is being played.
 *
 * Notes read left to right, like typing: each new strike lands to the right of the
 * last, while notes struck together stack into one column. After IDLE_CLEAR_MS of
 * silence — or, if you are still holding a key, a while longer — the line resets.
 *
 * RHYTHM, such as it is: each column draws as an eighth, a quarter, or a half,
 * decided in model/noteFlow.js by how its gap to the next strike compares with how
 * you have been playing over the last few seconds. There is still no meter, no
 * barline, no tempo, and nothing is quantised — play the same phrase twice as fast
 * and it engraves identically, because every judgement is a ratio.
 *
 * The flow is driven by ONSETS, not by which keys are currently down: a note stays on
 * the staff after you release it, until it scrolls off or the line resets. Key-down
 * state is still read, for two narrower jobs — deciding whether a new onset joins the
 * open column (a chord's notes are still held when the next lands; a run's are not)
 * and holding off the idle reset while you sit on a final chord.
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
  const lastActiveNotesRef = useRef(new Set());

  // The tick needs the current flow and the current key-down surface, but must not be
  // torn down and rebuilt on every note — hence refs rather than effect deps.
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const heldRef = useRef(activeNotes);
  heldRef.current = activeNotes;

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

  // Onsets only: a key going DOWN adds to the flow, a key coming up changes nothing.
  useEffect(() => {
    const current = new Set(activeNotes.keys());
    const previous = lastActiveNotesRef.current;
    lastActiveNotesRef.current = current;

    const onsets = [...current].filter((note) => !previous.has(note));
    if (onsets.length === 0) return;

    // Group by the timestamp the note ARRIVED with rather than by when React got round
    // to running this effect. Note what that stamp is and is not: useMidiSubscription
    // takes Date.now() when the browser handles the WebSocket message, so it carries
    // the piano → Jamcorder → backend → WS latency and is NOT a device-side capture
    // time. It is still the better of the two available clocks — it has per-message
    // granularity, where effect time can collapse notes that were milliseconds apart
    // into one identical Date.now() through React batching. Earliest of the batch, so
    // the column is anchored to the first key of the gesture.
    const stamps = onsets.map((note) => activeNotes.get(note)?.timestamp).filter(Number.isFinite);
    const at = stamps.length ? Math.min(...stamps) : Date.now();
    // `held` is the surface as it stands NOW — after any release that came with this
    // batch — which is what makes "are the open column's notes still down" answerable.
    setFlow((prev) => pushOnsets(prev, onsets, at, { held: activeNotes }));
  }, [activeNotes]);

  // A new column closes the previous one and fixes its duration, so the durations have
  // to be re-read whenever the flow changes, not only on the tick.
  useEffect(() => { syncDurations(); }, [flow, syncDurations]);

  useEffect(() => {
    const id = setInterval(() => {
      setFlow((prev) => clearIfIdle(prev, Date.now(), { held: heldRef.current }));
      syncDurations();
    }, PROVISIONAL_TICK_MS);
    return () => clearInterval(id);
  }, [syncDurations]);

  // Each column is spelled AS A CHORD, not note by note: identifyChord returns both the
  // name and the letters its tones should be written with, so the staff and the chord
  // plaque can only ever show the same reading. Note-by-note spelling drew G♯ minor as
  // A♭–B–E♭ — letters that stack in no triad — under a plaque reading "G♯ minor".
  const columns = useMemo(
    () => flowColumns(flow).map((midis, i) => ({
      midis,
      spelling: identifyChord(midis, keySig).spelling,
      duration: durations[i] ?? 'q',
    })),
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
