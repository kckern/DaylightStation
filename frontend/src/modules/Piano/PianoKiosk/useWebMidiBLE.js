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

// Monotonic counter across ALL outbound control messages, so logs reveal the
// exact send ORDER + timing — the key signal for the "settings respond one turn
// late" bug (a control sent at seq N only taking audible effect when seq N+1 is
// sent). See docs/_wip/bugs/2026-06-26-piano-midi-settings-one-turn-late.md.
let _outSeq = 0;
const hex = (bytes) => bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join(' ');

/**
 * Transmit an outbound control message AND log it uniformly at info with a
 * sequence number, hi-res timestamp, raw bytes, and the output port's live
 * connection/state. Web MIDI send() is fire-and-forget (no completion event),
 * so conn/state at send time is the best proxy we have for "did the BLE link
 * actually flush this, or buffer it?". Notes are intentionally NOT routed here
 * (too high-frequency); this is for low-rate control sends only.
 */
function emitOut(out, bytes, event, extra = {}) {
  const seq = ++_outSeq;
  const t = (typeof performance !== 'undefined' && performance.now) ? Math.round(performance.now()) : Date.now();
  out.send(bytes);
  logger().info(event, { seq, t, bytes: hex(bytes), conn: out.connection, state: out.state, ...extra });
  return true;
}

// Delay (ms) before the trailing flush re-send. Must exceed one BLE connection
// interval (~7.5–30ms on Android) so the flush lands in a SEPARATE BLE packet
// rather than batching with the original in the same write.
const BLE_FLUSH_MS = 30;

/**
 * BLE-MIDI one-turn-late fix. The diagnostic logs proved the Program Change byte
 * we send already matches the just-selected voice (no stale-closure bug), yet the
 * piano sounds the PREVIOUS voice until the next interaction. The cause is the
 * peripheral: it defers the LAST message in a burst until the next BLE packet
 * arrives, so a Program Change sent on its own never lands on its own turn.
 *
 * Re-send the same PC ~one connection-interval later: the duplicate's packet
 * flushes the original through (voice now lands on THIS selection), and because a
 * Program Change is idempotent the repeat is harmless if the peripheral didn't
 * actually buffer. Scheduled (not same-tick) so it's a distinct BLE packet.
 */
function flushOut(out, bytes) {
  setTimeout(() => {
    try {
      out.send(bytes);
      logger().debug('midi.out.flush', { bytes: hex(bytes), conn: out.connection, state: out.state });
    } catch { /* port may have closed between send and flush — fire-and-forget */ }
  }, BLE_FLUSH_MS);
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

  // Raw-message tap for the MIDI monitor: every inbound message (note/CC/PC/…)
  // as { data: Uint8Array, time }. Separate from the note-only `subscribe` above
  // so the studio recorder never sees non-note traffic.
  const rawListenersRef = useRef(new Set());
  const emitRaw = useCallback((bytes) => {
    if (rawListenersRef.current.size === 0) return;
    const evt = { data: bytes, time: Date.now() };
    for (const fn of rawListenersRef.current) {
      try { fn(evt); } catch { /* a bad listener must not break input */ }
    }
  }, []);
  const subscribeRaw = useCallback((fn) => {
    rawListenersRef.current.add(fn);
    return () => rawListenersRef.current.delete(fn);
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
    emitRaw(event.data); // feed the monitor everything, before note-only parsing
    const parsed = parseMidiMessage(event.data);
    if (!parsed) return;
    if (parsed.type === 'note_on') applyNoteOn(parsed.note, parsed.velocity);
    else if (parsed.type === 'note_off') applyNoteOff(parsed.note);
    else if (parsed.type === 'control' && parsed.controller === SUSTAIN_CONTROLLER) {
      setSustainPedal(isSustainDown(parsed.value));
    }
  }, [applyNoteOn, applyNoteOff, emitRaw]);

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
    // Idempotent: a chattery BLE link fires repeated statechange events for the
    // same, still-present port. Re-binding each one storms re-renders on the
    // tablet, so bail when already bound to this exact input with this handler.
    if (inputRef.current === input && input.onmidimessage === handleRawMidi) {
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
    const bytes = [0xc0 | (channel & 0x0f), program & 0x7f];
    emitOut(out, bytes, 'midi.out.program', { program, channel });
    flushOut(out, bytes); // re-send to push the PC through BLE (one-turn-late fix)
    return true;
  }, []);

  // Local Control (CC 122): false silences the piano's onboard voice so a
  // rendered instrument (APK) is the only sound; true restores onboard sound.
  const sendLocalControl = useCallback((on, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    return emitOut(out, [0xb0 | (channel & 0x0f), 122, on ? 127 : 0], 'midi.out.local-control', { on, channel });
  }, []);

  // Select a voice: optional Bank Select (MSB+LSB) then Program Change. Bank 0
  // sends a plain PC (the 128 GM voices); a non-zero bank reaches the device's
  // extra banks (e.g. the Suzuki Asian-folk voices). Each message is logged with
  // its own seq/timestamp so the send ORDER is visible when diagnosing the
  // one-turn-late bug.
  const sendVoice = useCallback((program, bank = 0, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    if (bank) {
      emitOut(out, [0xb0 | (channel & 0x0f), 0, bank & 0x7f], 'midi.out.bank-msb', { bank, channel });
      emitOut(out, [0xb0 | (channel & 0x0f), 32, 0], 'midi.out.bank-lsb', { channel });
    }
    const bytes = [0xc0 | (channel & 0x0f), program & 0x7f];
    emitOut(out, bytes, 'midi.out.voice', { program, bank, channel });
    flushOut(out, bytes); // re-send to push the PC through BLE (one-turn-late fix)
    return true;
  }, []);

  // General Control Change out (effects like reverb/chorus, and the monitor's
  // fireable outputs). Flushed like Program Change: the BLE-MIDI peripheral
  // defers the last message in a burst until the next packet, so a lone reverb/
  // chorus CC never lands on its own turn — an acoustic probe confirmed CC 91/93
  // only take effect once re-sent. See the one-turn-late bug doc.
  const sendControlChange = useCallback((controller, value, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    const bytes = [0xb0 | (channel & 0x0f), controller & 0x7f, value & 0x7f];
    emitOut(out, bytes, 'midi.out.cc', { controller, value, channel });
    flushOut(out, bytes); // re-send to push the CC through BLE (one-turn-late fix)
    return true;
  }, []);

  // Panic: silence stuck notes (All Sound Off + All Notes Off on channel 1).
  const sendPanic = useCallback((channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    out.send([0xb0 | (channel & 0x0f), 120, 0]); // All Sound Off
    out.send([0xb0 | (channel & 0x0f), 123, 0]); // All Notes Off
    logger().info('midi.out.panic', { channel });
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

  // Independent channel-aware note-off, pairing with a duration-less sendNote:
  // the Producer's onboard voice tier holds notes for arbitrary lengths (loop
  // playback), so it can't use sendNote's schedule-the-off-up-front durationMs.
  const sendNoteOff = useCallback((note, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    out.send([0x80 | (channel & 0x0f), note & 0x7f, 0]);
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
    sendVoice,
    sendLocalControl,
    sendControlChange,
    sendPanic,
    sendNote,
    sendNoteOff,
    scheduleNotes,
    subscribe,
    subscribeRaw,
    pressNote,
    releaseNote,
  }), [status, inputName, activeNotes, sustainPedal, noteHistory, connect, sendProgramChange, sendVoice, sendLocalControl, sendControlChange, sendPanic, sendNote, sendNoteOff, scheduleNotes, subscribe, subscribeRaw, pressNote, releaseNote]);
}

export default useWebMidiBLE;
