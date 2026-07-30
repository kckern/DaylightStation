import { useEffect, useMemo, useRef, useState } from 'react';
import { ChordStaffRenderer } from '../../MusicNotation/renderers/ChordStaffRenderer.jsx';
import { emptyFlow, pushOnsets, clearIfIdle, flowColumns, IDLE_CLEAR_MS } from '../../MusicNotation/model/noteFlow.js';
import { identifyChord } from '../theory/chordNaming.js';
import { useDetectedKey } from './useDetectedKey.js';
import './CurrentChordStaff.scss';

// Music-theory model (key signatures, key detection, hand split, note flow) lives in
// the shared MusicNotation framework. CurrentChordStaff keeps the live-input concerns
// — watching the MIDI surface for onsets, ageing the flow out — and delegates key
// detection to the shared useDetectedKey hook and rendering to ChordStaffRenderer.

// How often the idle sweep checks whether the flow should reset. The flow itself is
// event-driven; this only exists so the staff clears on its own after you stop.
const IDLE_TICK_MS = 250;

/**
 * Live grand staff of what is being played.
 *
 * Notes read left to right, like typing: each new strike lands to the right of the
 * last, while notes struck together stack into one column (see model/noteFlow.js for
 * the simultaneity window). This is order, not rhythm — nothing is quantised and no
 * duration is implied. After IDLE_CLEAR_MS of silence the line resets to the left.
 *
 * The flow is driven by ONSETS, not by which keys are currently down: a note stays on
 * the staff after you release it, until it scrolls off or the line resets. That
 * replaces the old note-decay/peak-chord scheme, which existed to stop a chord
 * crumbling as fingers lifted unevenly — a problem the flow doesn't have, because a
 * column is fixed the moment it is struck.
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
  const lastActiveNotesRef = useRef(new Set());

  // Always run the hook (Rules of Hooks); the prop takes precedence when present.
  const internalKey = useDetectedKey(activeNotes);
  const keySig = detectedKey ?? internalKey;

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
    setFlow((prev) => pushOnsets(prev, onsets, at));
  }, [activeNotes]);

  // Reset the line once the keyboard has been quiet. clearIfIdle returns the same
  // object when there is nothing to do, so an idle staff never re-renders.
  useEffect(() => {
    const id = setInterval(() => {
      setFlow((prev) => clearIfIdle(prev, Date.now()));
    }, IDLE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Each column is spelled AS A CHORD, not note by note: identifyChord returns both the
  // name and the letters its tones should be written with, so the staff and the chord
  // plaque can only ever show the same reading. Note-by-note spelling drew G♯ minor as
  // A♭–B–E♭ — letters that stack in no triad — under a plaque reading "G♯ minor".
  const columns = useMemo(
    () => flowColumns(flow).map((midis) => ({
      midis,
      spelling: identifyChord(midis, keySig).spelling,
    })),
    [flow, keySig],
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

export { IDLE_CLEAR_MS };
export default CurrentChordStaff;
