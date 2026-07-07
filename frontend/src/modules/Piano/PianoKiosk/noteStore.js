// noteStore.js — external store for high-churn live-note state (activeNotes,
// noteHistory, sustain). Kept OUT of React state so a note-on/off re-renders
// only useSyncExternalStore subscribers (the keyboard, the waterfall, the
// monitor) instead of every usePianoMidi() consumer in the kiosk
// (2026-07-06 decoupling audit R1). Snapshots are immutable-per-change, as
// useSyncExternalStore requires.
//
// Behavior mirrors useWebMidiBLE.js's volatile-state logic EXACTLY so the later
// rewire is a no-behavior-change swap:
//   - noteOn   ← applyNoteOn      (useWebMidiBLE.js:134-139)
//   - noteOff  ← applyNoteOff     (useWebMidiBLE.js:141-154)
//   - sustain  ← handleRawMidi CC64 branch (useWebMidiBLE.js:175-177)
//   - sweepStale ← 2s cleanup effect (useWebMidiBLE.js:363-386)

import {
  STALE_NOTE_MS, findLastActive, closeNote, trimHistory,
  handleNoteOn,
} from '../noteHistory.js';

export function createNoteStore() {
  let snapshot = { activeNotes: new Map(), sustainPedal: false, noteHistory: [], isPlaying: false };
  const listeners = new Set();

  const commit = (patch) => {
    const activeNotes = patch.activeNotes ?? snapshot.activeNotes;
    snapshot = { ...snapshot, ...patch, activeNotes, isPlaying: activeNotes.size > 0 };
    for (const fn of listeners) { try { fn(); } catch { /* a bad listener must not break input */ } }
  };

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => snapshot,

    // Mirrors applyNoteOn: set the active note, append/retrigger history.
    noteOn(note, velocity, time) {
      commit({
        activeNotes: new Map(snapshot.activeNotes).set(note, { velocity, timestamp: time }),
        noteHistory: handleNoteOn(snapshot.noteHistory, note, velocity, time),
      });
    },

    // Mirrors applyNoteOff: no-op guards match the hook (absent note / no open
    // history entry each leave their slice untouched); commit only on real change.
    noteOff(note, time) {
      const patch = {};
      if (snapshot.activeNotes.has(note)) {
        const next = new Map(snapshot.activeNotes);
        next.delete(note);
        patch.activeNotes = next;
      }
      const idx = findLastActive(snapshot.noteHistory, note);
      if (idx >= 0) patch.noteHistory = closeNote(snapshot.noteHistory, idx, time);
      if (Object.keys(patch).length) commit(patch);
    },

    // Mirrors the CC64 branch: set sustain state. Guarded so an unchanged value
    // doesn't churn a snapshot (React setState of an equal primitive is a no-op).
    sustain(down) { if (down !== snapshot.sustainPedal) commit({ sustainPedal: down }); },

    /**
     * Close lost notes / trim display history (2s cleanup effect). Notifies only
     * on real change, matching the hook's changed-flag + reference-equality guards.
     */
    sweepStale(now, staleMs = STALE_NOTE_MS) {
      let activeChanged = false;
      const nextActive = new Map(snapshot.activeNotes);
      for (const [note, { timestamp }] of snapshot.activeNotes) {
        if (now - timestamp > staleMs) { nextActive.delete(note); activeChanged = true; }
      }
      let history = snapshot.noteHistory;
      for (let i = history.length - 1; i >= 0; i--) {
        if (!history[i].endTime && now - history[i].startTime > staleMs) history = closeNote(history, i, now);
      }
      const trimmed = trimHistory(history, now);
      const historyChanged = trimmed.length !== snapshot.noteHistory.length || history !== snapshot.noteHistory;
      if (!activeChanged && !historyChanged) return;
      commit({
        ...(activeChanged ? { activeNotes: nextActive } : {}),
        ...(historyChanged ? { noteHistory: trimmed } : {}),
      });
    },
  };
}

export default createNoteStore;
