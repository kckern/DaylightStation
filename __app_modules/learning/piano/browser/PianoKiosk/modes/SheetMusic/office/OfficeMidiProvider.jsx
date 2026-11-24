import { useCallback, useMemo, useRef } from 'react';
import PianoMidiContext from '../../../PianoMidiContext.jsx';

const NO_OP = () => {};
const NO_UNSUBSCRIBE = () => () => {};
const EMPTY = new Map();

/**
 * Which held notes Learn may see, given the keys the strip has claimed.
 *
 * A claimed key never reaches the music, and neither does a key that was struck
 * WHILE claimed and is still down: when the strip lets go of its keys (a take
 * begins) a finger still resting on one must not arrive as a fresh note.
 * `sticky` is that set, carried between calls and pruned as keys come up.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure rule is exported for its own tests
export function visibleNotes(activeNotes, claimed, sticky) {
  const live = activeNotes instanceof Map ? activeNotes : EMPTY;
  for (const note of [...sticky]) if (!live.has(note)) sticky.delete(note);
  if (!claimed?.size && !sticky.size) return live;
  const visible = new Map();
  for (const [note, value] of live) {
    if (claimed?.has(note)) { sticky.add(note); continue; }
    if (sticky.has(note)) continue;
    visible.set(note, value);
  }
  return visible;
}

/**
 * The kiosk MIDI contract (PianoMidiContext) over the office screen's own note
 * stream, so the tablet's Learn runs here unchanged.
 *
 * Notes come in over the WebSocket (`useMidiSubscription`): the held-note map,
 * the note-event tap and the pedal tap (`subscribeRaw`) are passed through; the
 * strip's claimed keys are taken out of all three. The office piano has no note
 * OUTPUT, so every send is a no-op and `outputConnected` is false — which is
 * what hides Listen.
 */
export default function OfficeMidiProvider({ activeNotes, subscribe, subscribeRaw, claimed = null, children }) {
  const stickyRef = useRef(new Set());
  const claimedRef = useRef(claimed);
  claimedRef.current = claimed;
  const notesVisible = useMemo(() => visibleNotes(activeNotes, claimed, stickyRef.current), [activeNotes, claimed]);
  const snapshot = useMemo(() => ({
    activeNotes: notesVisible, noteHistory: [], sustainPedal: false, isPlaying: notesVisible.size > 0,
  }), [notesVisible]);
  // The provider re-renders with each new snapshot, which is how consumers of
  // `usePianoMidiNotes` see it; there is no separate store to subscribe to.
  const notes = useMemo(() => ({ getSnapshot: () => snapshot, subscribe: NO_UNSUBSCRIBE }), [snapshot]);
  const filteredSubscribe = useCallback((fn) => {
    if (typeof subscribe !== 'function') return () => {};
    return subscribe((event) => {
      const note = event?.note;
      if (claimedRef.current?.has(note) || stickyRef.current.has(note)) return;
      fn(event);
    });
  }, [subscribe]);
  const value = useMemo(() => ({
    connected: true,
    status: 'connected',
    notes,
    subscribe: filteredSubscribe,
    subscribeRaw: typeof subscribeRaw === 'function' ? subscribeRaw : NO_UNSUBSCRIBE,
    outputConnected: false,
    midiHealth: { in: 'bridge', out: 'down', healthy: false },
    sendNoteAt: NO_OP, sendNoteOffAt: NO_OP, sendPanic: NO_OP, releaseNote: NO_OP,
    sendNote: NO_OP, sendVoice: NO_OP, sendControlChange: NO_OP, sendLocalControl: NO_OP, sendSysex: NO_OP,
  }), [notes, filteredSubscribe, subscribeRaw]);
  return <PianoMidiContext.Provider value={value}>{children}</PianoMidiContext.Provider>;
}
