import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import {
  STALE_NOTE_MS,
  findLastActive,
  closeNote,
  trimHistory,
  handleNoteOn,
  handleNoteOff,
  parseMidiMessage,
  SUSTAIN_CONTROLLER,
  isSustainDown,
} from '../noteHistory.js';

const STORAGE_KEY = 'piano-kiosk-midi-input-id';

// Dev keyboard mapping: number row keys → MIDI notes (C4–G5), localhost only.
const DEV_KEY_MAP = {
  '1': 60, '2': 62, '3': 64, '4': 65, '5': 67,
  '6': 69, '7': 71, '8': 72, '9': 74, '0': 76,
  '-': 77, '=': 79,
};

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-webmidi-ble' });
  return _logger;
}

/**
 * useWebMidiBLE — the piano kiosk's single MIDI authority over Web MIDI (BLE).
 *
 * The tablet is paired with the electric piano over Bluetooth-MIDI; the browser
 * reads it via navigator.requestMIDIAccess(). Bidirectional:
 *   - note-in    → visualize / score / record (same surface as useMidiSubscription)
 *   - Program Change out → timbre control
 *   - note-out / scheduleNotes → studio playback (the piano sounds it)
 *
 * Returns the input surface plus connection state and output senders. BLE pairing
 * itself is an OS concern; the browser only sees already-paired ports, so the
 * shell shows a connect-gate when status !== 'connected'.
 *
 * @param {{ preferredInputName?: string }} [opts]
 */
export function useWebMidiBLE({ preferredInputName } = {}) {
  const [status, setStatus] = useState('idle'); // idle | requesting | connected | no-input | unsupported | denied
  const [inputName, setInputName] = useState(null);
  const [activeNotes, setActiveNotes] = useState(new Map());
  const [sustainPedal, setSustainPedal] = useState(false);
  const [noteHistory, setNoteHistory] = useState([]);

  const accessRef = useRef(null);
  const inputRef = useRef(null);
  const outputRef = useRef(null);

  // Raw note-event tap — lets the studio recorder capture a full take regardless
  // of noteHistory's 8s display trim. Listeners get {type, note, velocity, time}.
  const listenersRef = useRef(new Set());
  const emit = useCallback((evt) => {
    for (const fn of listenersRef.current) {
      try { fn(evt); } catch { /* a bad listener must not break input */ }
    }
  }, []);
  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const applyNoteOn = useCallback((note, velocity) => {
    const startTime = Date.now();
    setActiveNotes((prev) => new Map(prev).set(note, { velocity, timestamp: startTime }));
    setNoteHistory((prev) => handleNoteOn(prev, note, velocity, startTime));
    emit({ type: 'note_on', note, velocity, time: startTime });
  }, [emit]);

  const applyNoteOff = useCallback((note) => {
    const endTime = Date.now();
    setActiveNotes((prev) => {
      if (!prev.has(note)) return prev;
      const next = new Map(prev);
      next.delete(note);
      return next;
    });
    setNoteHistory((prev) => {
      const idx = findLastActive(prev, note);
      return idx < 0 ? prev : closeNote(prev, idx, endTime);
    });
    emit({ type: 'note_off', note, velocity: 0, time: endTime });
  }, [emit]);

  // On-screen (touch/click) keyboard injection. Routes through the same internal
  // handlers as hardware MIDI + the dev-key fallback, so a tapped key flows into
  // activeNotes/noteHistory for every consumer. Also echoes to the MIDI output
  // (if a piano/synth is connected) so the note sounds.
  const pressNote = useCallback((note, velocity = 90) => {
    applyNoteOn(note, velocity);
    outputRef.current?.send?.([0x90, note & 0x7f, velocity & 0x7f]);
  }, [applyNoteOn]);
  const releaseNote = useCallback((note) => {
    applyNoteOff(note);
    outputRef.current?.send?.([0x80, note & 0x7f, 0]);
  }, [applyNoteOff]);

  const handleRawMidi = useCallback((event) => {
    const parsed = parseMidiMessage(event.data);
    if (!parsed) return;
    if (parsed.type === 'note_on') applyNoteOn(parsed.note, parsed.velocity);
    else if (parsed.type === 'note_off') applyNoteOff(parsed.note);
    else if (parsed.type === 'control' && parsed.controller === SUSTAIN_CONTROLLER) {
      setSustainPedal(isSustainDown(parsed.value));
    }
  }, [applyNoteOn, applyNoteOff]);

  const pickInput = useCallback((access) => {
    const inputs = [...access.inputs.values()];
    if (inputs.length === 0) return null;
    const savedId = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || null;
    return (
      inputs.find((i) => i.id === savedId) ||
      (preferredInputName &&
        inputs.find((i) => (i.name || '').toLowerCase().includes(preferredInputName.toLowerCase()))) ||
      inputs[0]
    );
  }, [preferredInputName]);

  const bindInput = useCallback((access) => {
    const input = pickInput(access);
    if (!input) {
      inputRef.current = null;
      setInputName(null);
      setStatus('no-input');
      logger().warn('midi.no-input', {});
      return;
    }
    if (inputRef.current && inputRef.current !== input) {
      inputRef.current.onmidimessage = null;
    }
    input.onmidimessage = handleRawMidi;
    inputRef.current = input;
    outputRef.current = [...access.outputs.values()][0] || null;
    setInputName(input.name || input.id);
    setStatus('connected');
    try { localStorage?.setItem(STORAGE_KEY, input.id); } catch { /* ignore */ }
    logger().info('midi.input-bound', { name: input.name, hasOutput: !!outputRef.current });
  }, [pickInput, handleRawMidi]);

  const connect = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      setStatus('unsupported');
      logger().warn('midi.unsupported', {});
      return;
    }
    setStatus('requesting');
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      accessRef.current = access;
      logger().info('midi.access-granted', {
        inputs: access.inputs.size, outputs: access.outputs.size,
      });
      access.onstatechange = (e) => {
        logger().info('midi.statechange', { port: e.port?.name, state: e.port?.state });
        bindInput(access);
      };
      bindInput(access);
    } catch (err) {
      setStatus('denied');
      logger().error('midi.denied', { error: err?.message });
    }
  }, [bindInput]);

  // ── Outbound (timbre + studio playback) ──────────────────────────────
  const sendProgramChange = useCallback((program, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    out.send([0xc0 | (channel & 0x0f), program & 0x7f]);
    logger().debug('midi.out.program', { program, channel });
    return true;
  }, []);

  // Local Control (CC 122): false silences the piano's onboard voice so a
  // rendered instrument (APK) is the only sound; true restores onboard sound.
  const sendLocalControl = useCallback((on, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    out.send([0xb0 | (channel & 0x0f), 122, on ? 127 : 0]);
    logger().info('midi.out.local-control', { on, channel });
    return true;
  }, []);

  const sendNote = useCallback((note, velocity = 80, channel = 0, durationMs = null) => {
    const out = outputRef.current;
    if (!out) return false;
    out.send([0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f]);
    if (durationMs != null) {
      out.send([0x80 | (channel & 0x0f), note & 0x7f, 0], (performance?.now?.() ?? 0) + durationMs);
    }
    return true;
  }, []);

  /** Schedule an array of {t, type:'note_on'|'note_off', note, velocity} events (t in ms from now). */
  const scheduleNotes = useCallback((events, channel = 0) => {
    const out = outputRef.current;
    if (!out || !events?.length) return false;
    const base = performance?.now?.() ?? 0;
    for (const e of events) {
      const status = e.type === 'note_off' ? 0x80 : 0x90;
      out.send([status | (channel & 0x0f), e.note & 0x7f, (e.velocity ?? 0) & 0x7f], base + (e.t ?? 0));
    }
    logger().info('midi.out.schedule', { count: events.length });
    return true;
  }, []);

  // Periodic cleanup of stale active notes / trim history (lost note-offs).
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActiveNotes((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [note, { timestamp }] of prev) {
          if (now - timestamp > STALE_NOTE_MS) { next.delete(note); changed = true; }
        }
        return changed ? next : prev;
      });
      setNoteHistory((prev) => {
        let history = prev;
        for (let i = history.length - 1; i >= 0; i--) {
          if (!history[i].endTime && now - history[i].startTime > STALE_NOTE_MS) {
            history = closeNote(history, i, now);
          }
        }
        const trimmed = trimHistory(history, now);
        return trimmed.length !== prev.length || history !== prev ? trimmed : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Dev keyboard fallback (localhost only) — testable without hardware.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname !== 'localhost') return;
    const pressed = new Set();
    const down = (e) => {
      const note = DEV_KEY_MAP[e.key];
      if (!note || pressed.has(e.key)) return;
      e.preventDefault();
      pressed.add(e.key);
      applyNoteOn(note, 80);
    };
    const up = (e) => {
      const note = DEV_KEY_MAP[e.key];
      if (!note) return;
      e.preventDefault();
      pressed.delete(e.key);
      applyNoteOff(note);
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [applyNoteOn, applyNoteOff]);

  return useMemo(() => ({
    status,
    inputName,
    connected: status === 'connected',
    activeNotes,
    sustainPedal,
    noteHistory,
    isPlaying: activeNotes.size > 0,
    connect,
    sendProgramChange,
    sendLocalControl,
    sendNote,
    scheduleNotes,
    subscribe,
    pressNote,
    releaseNote,
  }), [status, inputName, activeNotes, sustainPedal, noteHistory, connect, sendProgramChange, sendLocalControl, sendNote, scheduleNotes, subscribe, pressNote, releaseNote]);
}

export default useWebMidiBLE;
