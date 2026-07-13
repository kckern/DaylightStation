import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import {
  parseMidiMessage,
  SUSTAIN_CONTROLLER,
  isSustainDown,
} from '../noteHistory.js';
import { createNoteStore } from './noteStore.js';

const STORAGE_KEY = 'piano-kiosk-midi-input-id';

// A BLE-MIDI port stays in access.inputs/outputs after a flap with state
// 'disconnected' (truthy but dead), and delivery can die while onmidimessage is
// still set. Health must be judged by the port's `state`, NOT object truthiness
// or handler-property identity. `undefined` state (older stacks / test mocks) is
// treated as connected for backward compatibility — only an explicit
// 'disconnected' counts as dead.
const isConnected = (port) => !!port && port.state !== 'disconnected';

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
  // MIDI OUT link health. On BLE the output port often enumerates a beat AFTER
  // the input, so this is tracked separately and re-checked on every statechange
  // + by a watchdog — a null output means on-screen sound changes can't reach the
  // piano. Reactive (state) so the UI can show/reset a broken link.
  const [outputName, setOutputName] = useState(null);
  // Output link HEALTH, tracked by port.state (not name!=null). A BLE flap leaves
  // the port object present with state 'disconnected', so truthiness lies.
  const [outputHealthy, setOutputHealthy] = useState(false);

  // Live-note state (activeNotes/noteHistory/sustainPedal/isPlaying) lives in an
  // external store, NOT React state, so a note event re-renders only
  // usePianoMidiNotes() subscribers — not every usePianoMidi() consumer
  // (2026-07-06 decoupling audit R1).
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createNoteStore();

  const accessRef = useRef(null);
  const inputRef = useRef(null);
  const outputRef = useRef(null);
  // Mirror the reactive output name/health so syncOutput (called every 2s by the
  // watchdog) only calls setState when a value actually changed — no churn.
  const outputNameRef = useRef(null);
  const outputHealthyRef = useRef(false);
  // Coalesces the BLE statechange STORM (a reconnect fires ~14 statechange events
  // in one second as the port renegotiates) into a single rebind — see connect().
  const rebindTimerRef = useRef(null);

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
    const time = Date.now();
    storeRef.current.noteOn(note, velocity, time);
    emit({ type: 'note_on', note, velocity, time });
  }, [emit]);

  const applyNoteOff = useCallback((note) => {
    const time = Date.now();
    storeRef.current.noteOff(note, time);
    emit({ type: 'note_off', note, velocity: 0, time });
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
      storeRef.current.sustain(isSustainDown(parsed.value));
    }
  }, [applyNoteOn, applyNoteOff, emitRaw]);

  const pickInput = useCallback((access) => {
    const all = [...access.inputs.values()];
    // Prefer CONNECTED inputs so a stale disconnected port left in the map (same
    // id/name) is never bound over the live one. Fall back to all only if the
    // stack reports no state (undefined) so mocks/older stacks still work.
    const connected = all.filter(isConnected);
    const pool = connected.length ? connected : all;
    if (pool.length === 0) return null;
    const savedId = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || null;
    return (
      pool.find((i) => i.id === savedId) ||
      (preferredInputName &&
        pool.find((i) => (i.name || '').toLowerCase().includes(preferredInputName.toLowerCase()))) ||
      pool[0]
    );
  }, [preferredInputName]);

  // Sync the MIDI OUT port + its reactive health from the current access. Picks a
  // CONNECTED output (never a stale disconnected one), and tracks health by
  // port.state — so `outputConnected` reflects the real link, not mere presence.
  // Idempotent and cheap (only setState on change) so it runs on every statechange
  // AND every watchdog tick, which is what makes a late/flapping output reliably
  // attach and a dropped one reliably show as broken. Returns the bound output.
  const syncOutput = useCallback((access) => {
    const all = access ? [...access.outputs.values()] : [];
    const connected = all.filter(isConnected);
    const out = (connected.length ? connected : all)[0] || null;
    const healthy = isConnected(out);
    outputRef.current = out;
    const name = out ? (out.name || out.id) : null;
    if (name !== outputNameRef.current) { outputNameRef.current = name; setOutputName(name); }
    if (healthy !== outputHealthyRef.current) {
      outputHealthyRef.current = healthy;
      setOutputHealthy(healthy);
      logger().info('midi.output-bound', { hasOutput: !!out, healthy, name });
    }
    return out;
  }, []);

  // Re-arm an input port: clear then re-assign our handler and re-open the port
  // so a flapped BLE-MIDI input re-subscribes at the NATIVE layer. The null→set
  // gap is synchronous (JS is single-threaded between these lines) so it can't
  // drop an inbound message. open() can reject on a mid-flap port — swallow it;
  // the next statechange / watchdog retries.
  const armInput = useCallback((input) => {
    try { input.onmidimessage = null; } catch { /* ignore */ }
    input.onmidimessage = handleRawMidi;
    try { const p = input.open?.(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
  }, [handleRawMidi]);

  // Bind the input. `force` (a statechange-driven rebind) re-arms the input even
  // when it's the same object — see the guard below.
  const bindInput = useCallback((access, { force = false } = {}) => {
    // Output is bound INDEPENDENTLY of the input and FIRST — a present output must
    // attach even when the input is missing/late (the old code returned on
    // no-input before ever touching the output → "neither works").
    syncOutput(access);

    const input = pickInput(access);
    if (!input) {
      if (inputRef.current) { try { inputRef.current.onmidimessage = null; } catch { /* ignore */ } }
      inputRef.current = null;
      setInputName(null);
      setStatus('no-input');
      logger().warn('midi.no-input', {});
      return;
    }
    // Fast idempotent path for REDUNDANT (non-statechange) calls: same input, our
    // handler still attached, AND the port still reports connected → nothing to do
    // (output already synced above). NOT taken on a statechange-driven rebind
    // (force), nor when the port flapped disconnected: a BLE reconnect can sever
    // Chromium's native delivery while LEAVING onmidimessage set, so the handler
    // merely *looking* bound is no proof the port still delivers.
    if (!force && inputRef.current === input && input.onmidimessage === handleRawMidi && isConnected(input)) {
      return;
    }
    if (inputRef.current && inputRef.current !== input) {
      try { inputRef.current.onmidimessage = null; } catch { /* ignore */ }
    }
    armInput(input);
    inputRef.current = input;
    setInputName(input.name || input.id);
    setStatus('connected');
    try { localStorage?.setItem(STORAGE_KEY, input.id); } catch { /* ignore */ }
    logger().info('midi.input-bound', { name: input.name, forced: force, hasOutput: !!outputRef.current });
  }, [pickInput, armInput, syncOutput, handleRawMidi]);

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
        // Debounce: a BLE (re)connect emits a burst of statechange events as the
        // port renegotiates (observed ~14 in one second). Binding on each one
        // stormed ~14 rebinds AND toggled outputConnected repeatedly, so the
        // downstream recovery re-assert (PianoSound/Mix) thrashed too. Coalesce to
        // ONE rebind after the burst settles → a single clean false→true edge.
        if (rebindTimerRef.current) clearTimeout(rebindTimerRef.current);
        rebindTimerRef.current = setTimeout(() => {
          rebindTimerRef.current = null;
          // force: a statechange means the port (re)connected — re-arm the input's
          // native subscription, don't trust the surviving onmidimessage property.
          bindInput(access, { force: true });
        }, 200);
      };
      bindInput(access); // initial bind is synchronous — fast first connect
    } catch (err) {
      setStatus('denied');
      logger().error('midi.denied', { error: err?.message });
    }
  }, [bindInput]);

  // Manual recover: drop the current bindings and re-request MIDI access from
  // scratch, so a broken/half link (e.g. input bound but output missing) is
  // fully re-scanned. Clearing the refs first defeats bindInput's idempotency
  // short-circuit so the input + output both re-attach.
  const resetLink = useCallback(async () => {
    logger().info('midi.reset-link', { hadOutput: !!outputRef.current });
    if (rebindTimerRef.current) { clearTimeout(rebindTimerRef.current); rebindTimerRef.current = null; }
    if (inputRef.current) { try { inputRef.current.onmidimessage = null; } catch { /* ignore */ } }
    inputRef.current = null;
    outputRef.current = null;
    outputNameRef.current = null;
    outputHealthyRef.current = false;
    setOutputName(null);
    setOutputHealthy(false);
    await connect();
  }, [connect]);

  // Clear any pending debounced rebind on unmount so it can't fire into a torn-down hook.
  useEffect(() => () => {
    if (rebindTimerRef.current) { clearTimeout(rebindTimerRef.current); rebindTimerRef.current = null; }
  }, []);

  // Watchdog / auto-recover. Runs whenever we hold MIDI access — NOT gated on
  // status==='connected', because the failure this recovers from (input missing or
  // flapped) is exactly what puts status in 'no-input'; gating there froze all
  // recovery. Every 2s it re-syncs BOTH halves from the live access, independently:
  //   • output: syncOutput re-picks a connected port + refreshes health (a dropped
  //     output shows broken; a late/reconnected one re-attaches).
  //   • input: if none is bound or the bound port isn't connected, re-bind (force)
  //     from access; else if our handler fell off, re-arm. This heals the input's
  //     own analogue of the output flap, so it never wedges "connected but silent".
  useEffect(() => {
    const t = setInterval(() => {
      const access = accessRef.current;
      if (!access) return;
      syncOutput(access);
      const inp = inputRef.current;
      if (!inp || !isConnected(inp)) {
        bindInput(access, { force: true });
        return;
      }
      if (inp.onmidimessage !== handleRawMidi) {
        armInput(inp);
        logger().info('midi.input-rearmed-watchdog', { name: inp.name });
      }
    }, 2000);
    return () => clearInterval(t);
  }, [syncOutput, bindInput, armInput, handleRawMidi]);

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
  // CONTRACT (Producer transport): stop/pause must never rely on a lone
  // terminal sendNoteOff — the BLE one-turn-late bug can swallow it; transports
  // silence via router.panic(), which routes CC123 through the flushed
  // sendPanic path instead.
  const sendNoteOff = useCallback((note, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    out.send([0x80 | (channel & 0x0f), note & 0x7f, 0]);
    return true;
  }, []);

  /**
   * Timestamped note senders — the audio plane of the score transport. `atMs` is
   * an absolute performance.now()-domain time; Chromium queues the message in the
   * browser-process MIDI service and dispatches it on schedule regardless of
   * main-thread jank (the whole point — see the 2026-07-06 decoupling audit T2).
   * Deliberately NO applyNoteOn/applyNoteOff: scheduled notes must not light the
   * keyboard ahead of when they sound; visuals fire separately at due time.
   */
  const sendNoteAt = useCallback((note, velocity = 80, atMs, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    out.send([0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f], atMs);
    return true;
  }, []);

  const sendNoteOffAt = useCallback((note, atMs, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    out.send([0x80 | (channel & 0x0f), note & 0x7f, 0], atMs);
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
      storeRef.current.sweepStale(Date.now());
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
    // MIDI OUT link health + manual recover. `outputConnected` false means
    // on-screen sound changes can't reach the piano; `resetLink()` re-scans.
    outputName,
    outputConnected: outputHealthy,
    resetLink,
    // Live-note store (activeNotes/noteHistory/sustainPedal/isPlaying). Read via
    // usePianoMidiNotes() so only note-reading leaves re-render per note; this
    // surface stays identity-stable across note traffic (2026-07-06 audit R1).
    notes: storeRef.current,
    connect,
    sendProgramChange,
    sendVoice,
    sendLocalControl,
    sendControlChange,
    sendPanic,
    sendNote,
    sendNoteOff,
    sendNoteAt,
    sendNoteOffAt,
    scheduleNotes,
    subscribe,
    subscribeRaw,
    pressNote,
    releaseNote,
  }), [status, inputName, outputName, outputHealthy, resetLink, connect, sendProgramChange, sendVoice, sendLocalControl, sendControlChange, sendPanic, sendNote, sendNoteOff, sendNoteAt, sendNoteOffAt, scheduleNotes, subscribe, subscribeRaw, pressNote, releaseNote]);
}

export default useWebMidiBLE;
