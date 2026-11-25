import { useCallback, useMemo, useRef } from 'react';
import PianoMidiContext from '../../../PianoMidiContext.jsx';

const NO_OP = () => {};
const NO_UNSUBSCRIBE = () => () => {};
const EMPTY = new Map();

/** Every key: the menu is open and the music is paused. */
const ALL_KEYS = Object.freeze({ size: Infinity, has: () => true });

/**
 * The keys that are not music right now. The board's two edge keys never are —
 * holding them together opens the menu, so they must not arrive in a take, at
 * its start or in the middle of it. While the menu is open, no key is.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure rule is exported for its own tests
export function musicClaim({ menuOpen = false, edges = [] } = {}) {
  return menuOpen ? ALL_KEYS : new Set(edges.filter((note) => Number.isFinite(note)));
}

/**
 * Which held notes Learn may see, given the keys claimed away from the music.
 *
 * A claimed key never reaches the music, and neither does a key that was struck
 * WHILE claimed and is still down: when the menu closes and gives the keys back,
 * a finger still resting on one must not arrive as a fresh note.
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
 * claimed keys (`musicClaim`: the edge keys, or every key while the menu is
 * open) are taken out of the held notes and the note events. The office piano has no note
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
  // A pedal arms a take too: while the menu is open it is not music either.
  const filteredRaw = useCallback((fn) => {
    if (typeof subscribeRaw !== 'function') return () => {};
    return subscribeRaw((event) => { if (claimedRef.current !== ALL_KEYS) fn(event); });
  }, [subscribeRaw]);
  const value = useMemo(() => ({
    connected: true,
    status: 'connected',
    notes,
    subscribe: filteredSubscribe,
    subscribeRaw: filteredRaw,
    outputConnected: false,
    midiHealth: { in: 'bridge', out: 'down', healthy: false },
    sendNoteAt: NO_OP, sendNoteOffAt: NO_OP, sendPanic: NO_OP, releaseNote: NO_OP,
    sendNote: NO_OP, sendVoice: NO_OP, sendControlChange: NO_OP, sendLocalControl: NO_OP, sendSysex: NO_OP,
  }), [notes, filteredSubscribe, filteredRaw]);
  return <PianoMidiContext.Provider value={value}>{children}</PianoMidiContext.Provider>;
}
