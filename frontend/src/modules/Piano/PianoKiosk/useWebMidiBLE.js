import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import {
  parseMidiMessage,
  SUSTAIN_CONTROLLER,
  isSustainDown,
} from '../noteHistory.js';
import { createNoteStore } from './noteStore.js';
import { bridgeSendMidi, bridgeSendMidiAt, bridgeOutUp } from './bridgeMidiOut.js';

const STORAGE_KEY = 'piano-kiosk-midi-input-id';

// A Web MIDI port is live only when its BLE `state` is not 'disconnected'. A flap
// leaves ports truthy-but-dead (state:'disconnected' yet still enumerated), so
// truthiness is not liveness. `undefined` state → treated as connected, so old
// stacks and test mocks that omit `state` behave as before.
export function isPortConnected(port) {
  return !!port && port.state !== 'disconnected';
}

// Stronger than isPortConnected: is the port actually able to DELIVER?
// `state` describes the DEVICE (is it present on the BLE link); `connection`
// describes OUR handle to it. The 2026-08-22 one-way outage sat in the gap
// between them — the JamCorder was present and enumerated, but our handle was
// stuck at connection:'pending', so every send() vanished (the JamCorder's
// `ble.in` counter stayed at 0 and Android's `dumpsys midi` read
// `mInputPortOpen=[false]`) while every health check read healthy.
// 'closed' is NOT a fault: it is the normal pre-send state, since Web MIDI opens
// a port implicitly on the first send().
export function isPortDelivering(port) {
  return isPortConnected(port) && port.connection !== 'pending';
}

// OUT auto-recover thresholds. The watchdog ticks every 2s, so this waits ~6s of
// sustained failure before escalating — long enough to ride out the statechange
// burst a BLE reconnect emits, short enough that nobody is left playing into a
// dead link. The cooldown is the important half: a permanently dead port (the
// JamCorder unplugged, say) must not re-acquire MIDI access every few seconds.
// Unbounded recovery churn is what got an earlier auto-recovery attempt reverted
// for flapping the APK's BLE link (fda53ea6b), so the ceiling here is deliberate.
const OUT_FAIL_TICKS_BEFORE_RESET = 3;
const OUT_RESET_COOLDOWN_MS = 5 * 60 * 1000;

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
  // Bridge-first (2026-08-23): the APK write path is the only OUT segment with a
  // delivery verdict (the piano's echo). The Web MIDI handle — which can go
  // zombie with no witness — is the fallback, not the default.
  if (bridgeSendMidi(bytes)) {
    logger().info(event, { seq, t, bytes: hex(bytes), via: 'bridge', ...extra });
    return true;
  }
  if (!out) return false;
  out.send(bytes);
  logger().info(event, { seq, t, bytes: hex(bytes), via: 'webmidi', conn: out.connection, state: out.state, ...extra });
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
      // Same one-turn-late peripheral regardless of which side writes the BLE
      // link, so the flush duplicate follows the same bridge-first routing.
      if (bridgeSendMidi(bytes)) {
        logger().debug('midi.out.flush', { bytes: hex(bytes), via: 'bridge' });
        return;
      }
      if (!out) return;
      out.send(bytes);
      logger().debug('midi.out.flush', { bytes: hex(bytes), via: 'webmidi', conn: out.connection, state: out.state });
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
 * @param {{ preferredInputName?: string, acquireInput?: boolean }} [opts]
 *   acquireInput (default true): when false, the hook binds MIDI OUTPUT only
 *   and never arms a Web MIDI input. Used when a native bridge (the
 *   piano-bridge APK) is the sole BLE-MIDI reader — a second Web MIDI input
 *   subscription fights it for the single BLE connection. Notes then arrive
 *   via feedNote() (see usePianoBridgeNotes) instead of handleRawMidi.
 */
export function useWebMidiBLE({ preferredInputName, acquireInput = true } = {}) {
  const [status, setStatus] = useState('idle'); // idle | requesting | connected | no-input | unsupported | denied
  const [inputName, setInputName] = useState(null);
  // MIDI OUT link health. On BLE the output port often enumerates a beat AFTER
  // the input, so this is tracked separately and re-checked on every statechange
  // + by a watchdog — a null output means on-screen sound changes can't reach the
  // piano. Reactive (state) so the UI can show/reset a broken link.
  const [outputName, setOutputName] = useState(null);
  // Real OUT liveness (see bindOutput): true only when the bound output port's
  // BLE state is actually connected, NOT merely present. Drives the unified MIDI
  // health signal so a silently-dead output surfaces instead of reading healthy.
  const [outputConnected, setOutputConnected] = useState(false);
  // Increments after every completed Web MIDI acquisition attempt. Connection
  // repair requires a generation newer than its starting point, so stale
  // pre-reset `ready` state can never satisfy recovery.
  const [bindingGeneration, setBindingGeneration] = useState(0);

  // Live-note state (activeNotes/noteHistory/sustainPedal/isPlaying) lives in an
  // external store, NOT React state, so a note event re-renders only
  // usePianoMidiNotes() subscribers — not every usePianoMidi() consumer
  // (2026-07-06 decoupling audit R1).
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createNoteStore();

  const accessRef = useRef(null);
  const inputRef = useRef(null);
  const outputRef = useRef(null);
  // OUT auto-recover bookkeeping: consecutive failing watchdog ticks, and when we
  // last escalated to a re-acquire (so the cooldown can bound the churn).
  const outFailTicksRef = useRef(0);
  const lastOutResetRef = useRef(0);
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
  // Bridge-first, like every other OUT path (2026-08-23). These two used a bare
  // `outputRef.current?.send?.()` — no bridge routing and, because of the
  // optional chaining, a SILENT no-op when the handle was missing or zombie.
  // That is why on-screen keys stayed mute while sheet-music playback (already
  // moved to the bridge) sounded fine. emitOut is module-level, so calling it
  // here does not depend on the later sendNote/sendNoteOff declarations.
  const pressNote = useCallback((note, velocity = 90) => {
    applyNoteOn(note, velocity);
    emitOut(outputRef.current, [0x90, note & 0x7f, velocity & 0x7f], 'midi.out.press', { note, velocity });
  }, [applyNoteOn]);
  const releaseNote = useCallback((note) => {
    applyNoteOff(note);
    emitOut(outputRef.current, [0x80, note & 0x7f, 0], 'midi.out.release', { note });
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

  // Bind (or re-bind) the MIDI OUT port from the current access. Idempotent and
  // cheap, so it can run on every statechange — this is what makes a late/flapping
  // output reliably attach instead of only when it happened to be present at the
  // instant the input first bound. Returns the bound output (or null).
  // Health is judged by the port's REAL `state`, not object truthiness: a BLE flap
  // leaves a stale port in access.outputs with state:'disconnected' (truthy but
  // dead). Keeping that port silently swallows OUTPUT — the exact "connected but
  // nothing reaches the piano" failure. So we PREFER a connected output and track
  // `outputConnected` from real state. This state-based judgement is scoped to
  // OUTPUT only — the analogous INPUT change was reverted (a68f14028) for breaking
  // note-in binding; output liveness by state is safe.
  const bindOutput = useCallback((access) => {
    const outs = access ? [...access.outputs.values()] : [];
    const out = outs.find(isPortConnected) || outs[0] || null;
    if (out !== outputRef.current) {
      outputRef.current = out;
      setOutputName(out ? (out.name || out.id) : null);
      logger().info('midi.output-bound', {
        hasOutput: !!out, name: out ? (out.name || out.id) : null, state: out?.state,
      });
    }
    const live = isPortConnected(out);
    setOutputConnected((prev) => (prev === live ? prev : live));
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
    const input = pickInput(access);
    if (!input) {
      inputRef.current = null;
      setInputName(null);
      setStatus('no-input');
      logger().warn('midi.no-input', {});
      return;
    }
    // Fast idempotent path for REDUNDANT (non-statechange) calls: same input, our
    // handler still attached → only re-check the output and bail, so a duplicate
    // initial bind can't churn. NOT taken on a statechange-driven rebind (force):
    // a BLE reconnect can sever Chromium's native MIDI delivery while LEAVING
    // onmidimessage set, so the handler merely *looking* bound is no proof the
    // port still delivers. On force we re-arm below — the input's analogue of the
    // OUTPUT watchdog/rebind. Without it the input wedges "connected but silent"
    // after a flap while the output keeps auto-recovering (the 2026-07-12 input
    // regression: OUT hardening added recovery to the OUT half of this branch but
    // left the IN half short-circuiting).
    if (!force && inputRef.current === input && input.onmidimessage === handleRawMidi) {
      bindOutput(access);
      return;
    }
    if (inputRef.current && inputRef.current !== input) {
      inputRef.current.onmidimessage = null;
    }
    armInput(input);
    inputRef.current = input;
    bindOutput(access);
    setInputName(input.name || input.id);
    setStatus('connected');
    try { localStorage?.setItem(STORAGE_KEY, input.id); } catch { /* ignore */ }
    logger().info('midi.input-bound', { name: input.name, forced: force, hasOutput: !!outputRef.current });
  }, [pickInput, armInput, bindOutput, handleRawMidi]);

  // Bridge mode only: open the MIDI INPUT port WITHOUT arming a note handler, so
  // Chrome attaches to the BLE-MIDI device (which is what makes OUTPUT writes
  // actually traverse the link) while the bridge WS remains the note source. We
  // deliberately null onmidimessage — any inbound notes are ignored here to avoid
  // double-counting the bridge's broadcast. Idempotent: re-holding the same port
  // is harmless. open() can reject on a mid-flap port — swallow it.
  const holdInputForOutput = useCallback((access) => {
    const input = pickInput(access);
    if (!input) return;
    try { input.onmidimessage = null; } catch { /* ignore */ }
    try { const p = input.open?.(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    inputRef.current = input;
  }, [pickInput]);

  // True when the piano-bridge APK is the OUT path AND we are not the note-in
  // path — i.e. the browser needs Web MIDI for nothing at all.
  //
  // 2026-08-26: Android exposes ONE BluetoothGatt for the JamCorder, shared by the
  // APK and Chromium, and it permits one outstanding GATT operation at a time. A
  // Web MIDI acquisition racing a BLE reconnect stalls an operation and blocks the
  // queue behind it, so every ATT Write Command (all MIDI OUT) is silently dropped
  // while notifications (MIDI IN) keep flowing — inbound data doesn't use that
  // queue. That is the one-way outage, and it survived 104 reconnects, a radio
  // bounce, and reboots of BOTH endpoints. Parking Chromium so it held no Web MIDI
  // let the SAME radio bounce recover the link on the first try.
  //
  // So the fix is not another recovery rung: it is to stop being the second GATT
  // client. Since 2026-08-23 nothing here needs Web MIDI — notes arrive over the
  // bridge WebSocket, sends go out through the bridge.
  const bridgeOwnsOut = useCallback(() => !acquireInput && bridgeOutUp(), [acquireInput]);

  // Give back every Web MIDI handle we hold. Closing the PORTS is the part that
  // matters: Android reference-counts the device, so an unclosed port keeps the
  // shared GATT client alive (observed: Chromium holding 9 listeners / 6 device
  // connections to a one-device list, with the same device listed twice).
  const relinquishWebMidi = useCallback(() => {
    const access = accessRef.current;
    const inp = inputRef.current;
    const out = outputRef.current;
    if (!access && !inp && !out) return false;
    if (rebindTimerRef.current) { clearTimeout(rebindTimerRef.current); rebindTimerRef.current = null; }
    try { if (access) access.onstatechange = null; } catch { /* ignore */ }
    if (inp) {
      try { inp.onmidimessage = null; } catch { /* ignore */ }
      try { const p = inp.close?.(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    }
    if (out) {
      try { const p = out.close?.(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    }
    accessRef.current = null;
    inputRef.current = null;
    outputRef.current = null;
    setInputName(null);
    setOutputName(null);
    logger().info('midi.webmidi-released', { reason: 'bridge-owns-out' });
    return true;
  }, []);

  const connect = useCallback(async () => {
    // Bridge owns OUT → never create the second GATT client. Report connected so
    // the provider's idle→connect trigger settles and OUT-gated consumers re-assert.
    if (bridgeOwnsOut()) {
      relinquishWebMidi();
      setStatus('connected');
      setOutputConnected(true);
      setBindingGeneration((generation) => generation + 1);
      logger().info('midi.webmidi-skipped', { reason: 'bridge-owns-out' });
      return { ok: true, via: 'bridge' };
    }
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      setStatus('unsupported');
      logger().warn('midi.unsupported', {});
      return { ok: false, reason: 'unsupported' };
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
          if (!acquireInput) { bindOutput(access); holdInputForOutput(access); return; }
          // force: a statechange means the port (re)connected — re-arm the input's
          // native subscription, don't trust the surviving onmidimessage property.
          bindInput(access, { force: true });
        }, 200);
      };
      if (acquireInput) {
        bindInput(access); // initial bind is synchronous — fast first connect
      } else {
        // Bridge mode: notes come from the piano-bridge APK over WebSocket, so we
        // do NOT listen to the Web MIDI input. BUT we still OPEN it: on this
        // Android/BLE-MIDI stack, opening the OUTPUT port alone does not attach
        // Chrome to the device's write path — verified on-device, the JamCorder's
        // ble.in counter stayed 0 so voice/note OUT never reached the piano.
        // Opening the input port (no handler) attaches the device so OUTPUT
        // actually traverses BLE, while the bridge stays the reliable note-IN path.
        bindOutput(access);
        holdInputForOutput(access);
        setStatus('connected');
        logger().info('midi.output+holdinput-bound', {
          hasOutput: !!outputRef.current, heldInput: !!inputRef.current,
        });
      }
      setBindingGeneration((generation) => generation + 1);
      return { ok: true };
    } catch (err) {
      setStatus('denied');
      logger().error('midi.denied', { error: err?.message });
      setBindingGeneration((generation) => generation + 1);
      return { ok: false, reason: 'denied', error: err?.message };
    }
  }, [bindInput, bindOutput, acquireInput, holdInputForOutput, bridgeOwnsOut, relinquishWebMidi]);

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
    setOutputName(null);
    setInputName(null);
    setOutputConnected(false);
    setStatus('requesting');
    return connect();
  }, [connect]);

  // Clear any pending debounced rebind on unmount so it can't fire into a torn-down hook.
  useEffect(() => () => {
    if (rebindTimerRef.current) { clearTimeout(rebindTimerRef.current); rebindTimerRef.current = null; }
  }, []);

  // Adaptive input management, keyed on acquireInput + status:
  //  - acquireInput TRUE (non-kiosk / bridge-absent): ARM the Web MIDI input so
  //    notes flow over Web MIDI (the note-in path). Handles the false→true flip
  //    when a non-kiosk client's bridge is deemed absent ~1s after connect.
  //  - acquireInput FALSE (kiosk, bridge present): HOLD the input port OPEN with
  //    no handler. This is NOT for notes (the bridge WS supplies those) — it's
  //    what attaches Chrome to the BLE device so MIDI OUTPUT actually delivers.
  //    Re-hold if the port dropped.
  useEffect(() => {
    if (!accessRef.current) return;
    if (!acquireInput) {
      // Ensure the input is held open (no handler) for OUTPUT delivery.
      const inp = inputRef.current;
      if (!inp) { holdInputForOutput(accessRef.current); return; }
      // Flipped true→false (bridge appeared after a Web-MIDI fallback): stop
      // LISTENING so the bridge is the sole note source, but KEEP the port open
      // so OUTPUT keeps delivering. Do NOT close it.
      if (inp.onmidimessage) {
        try { inp.onmidimessage = null; } catch { /* ignore */ }
        setInputName(null);
        logger().info('midi.input-unlistened-hold', { name: inp.name });
      }
      return;
    }
    const inp = inputRef.current;
    if (!inp || inp.onmidimessage !== handleRawMidi) {
      bindInput(accessRef.current);
    }
  }, [acquireInput, status, bindInput, handleRawMidi, holdInputForOutput]);

  // Output watchdog / auto-recover: while connected, if the OUT port is missing
  // (BLE enumerated it late, or it dropped), re-scan the live access for it every
  // 2s so a flapping output re-attaches on its own — no user action needed.
  useEffect(() => {
    if (status !== 'connected') return undefined;
    const t = setInterval(() => {
      // Bridge owns OUT → hold no Web MIDI at all, and police nothing here (the
      // APK's loopback is the OUT verdict). This is also the boot-race catch:
      // bridgeOutUp() only turns true after the first successful probe, which is
      // not a React signal, so a page that grabbed Web MIDI before then gives it
      // back on the next tick rather than keeping the shared GATT client alive.
      if (bridgeOwnsOut()) {
        if (relinquishWebMidi()) setOutputConnected(true);
        return;
      }
      // Re-bind when the output is missing OR not delivering (a stale flapped
      // port, or a handle stuck pending), so a silently-dead output self-heals
      // instead of swallowing sends.
      if (!isPortDelivering(outputRef.current)) {
        if (accessRef.current) bindOutput(accessRef.current);
        // Escalation rung. Re-binding only ever picks from the CURRENT access
        // object, and bindOutput falls back to outs[0] — so when every enumerated
        // port is dead it re-binds the same corpse forever. That is exactly how
        // 2026-08-22 stayed one-way for hours while the watchdog reported healthy.
        // Once the failure persists, re-ACQUIRE access via resetLink() — the same
        // thing the manual OperatorDrawer button does, and the same thing a page
        // reload did to fix it by hand.
        outFailTicksRef.current += 1;
        const now = Date.now();
        if (outFailTicksRef.current >= OUT_FAIL_TICKS_BEFORE_RESET
            && now - lastOutResetRef.current >= OUT_RESET_COOLDOWN_MS) {
          lastOutResetRef.current = now;
          outFailTicksRef.current = 0;
          logger().warn('midi.out-recover-reset', {
            name: outputRef.current?.name ?? null,
            state: outputRef.current?.state ?? null,
            conn: outputRef.current?.connection ?? null,
          });
          // Fire-and-forget: resetLink re-runs connect(), which re-enters this
          // effect through `status`. Swallow rejection so a failed re-acquire
          // just leaves the next tick to try again after the cooldown.
          Promise.resolve(resetLink()).catch(() => {});
          return;
        }
      } else {
        outFailTicksRef.current = 0;
      }
      // Bridge mode (acquireInput:false): we don't LISTEN to the input, but we do
      // keep it HELD OPEN so MIDI OUTPUT keeps delivering over BLE. Re-hold when
      // the port dropped (a flap can null inputRef) OR when the held port is no
      // longer delivering — the ref surviving a flap is not proof the hold still
      // stands, and a null-only guard is the other half of why 2026-08-22 never
      // self-healed: the stale port object outlived its native open.
      if (!acquireInput) {
        if (accessRef.current && !isPortDelivering(inputRef.current)) {
          holdInputForOutput(accessRef.current);
        }
        return;
      }
      // Input insurance: some BLE stacks null onmidimessage on a flap. If our
      // handler fell off the bound input, re-arm it so input never stays silently
      // dead between statechange events (the OUTPUT already self-heals here).
      const inp = inputRef.current;
      if (inp && inp.onmidimessage !== handleRawMidi) {
        armInput(inp);
        logger().info('midi.input-rearmed-watchdog', { name: inp.name });
      }
    }, 2000);
    return () => clearInterval(t);
  }, [status, bindOutput, armInput, handleRawMidi, acquireInput, holdInputForOutput, resetLink,
    bridgeOwnsOut, relinquishWebMidi]);

  // ── Outbound (timbre + studio playback) ──────────────────────────────
  const sendProgramChange = useCallback((program, channel = 0) => {
    const out = outputRef.current;
    if (!out && !bridgeOutUp()) return false;
    const bytes = [0xc0 | (channel & 0x0f), program & 0x7f];
    emitOut(out, bytes, 'midi.out.program', { program, channel });
    flushOut(out, bytes); // re-send to push the PC through BLE (one-turn-late fix)
    return true;
  }, []);

  // Local Control (CC 122): false silences the piano's onboard voice so a
  // rendered instrument (APK) is the only sound; true restores onboard sound.
  const sendLocalControl = useCallback((on, channel = 0) => {
    const out = outputRef.current;
    if (!out && !bridgeOutUp()) return false;
    return emitOut(out, [0xb0 | (channel & 0x0f), 122, on ? 127 : 0], 'midi.out.local-control', { on, channel });
  }, []);

  // Select a voice: optional Bank Select (MSB+LSB) then Program Change. Bank 0
  // sends a plain PC (the 128 GM voices); a non-zero bank reaches the device's
  // extra banks (e.g. the Suzuki Asian-folk voices). Each message is logged with
  // its own seq/timestamp so the send ORDER is visible when diagnosing the
  // one-turn-late bug.
  const sendVoice = useCallback((program, bank = 0, channel = 0) => {
    const out = outputRef.current;
    if (!out && !bridgeOutUp()) return false;
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
    if (!out && !bridgeOutUp()) return false;
    const bytes = [0xb0 | (channel & 0x0f), controller & 0x7f, value & 0x7f];
    emitOut(out, bytes, 'midi.out.cc', { controller, value, channel });
    flushOut(out, bytes); // re-send to push the CC through BLE (one-turn-late fix)
    return true;
  }, []);

  // Panic: silence stuck notes (All Sound Off + All Notes Off on channel 1).
  const sendPanic = useCallback((channel = 0) => {
    const out = outputRef.current;
    if (!out && !bridgeOutUp()) return false;
    const soundOff = [0xb0 | (channel & 0x0f), 120, 0]; // All Sound Off
    const notesOff = [0xb0 | (channel & 0x0f), 123, 0]; // All Notes Off
    if (bridgeSendMidi(soundOff)) {
      bridgeSendMidi(notesOff);
      logger().info('midi.out.panic', { channel, via: 'bridge' });
      return true;
    }
    if (!out) return false;
    out.send(soundOff);
    out.send(notesOff);
    logger().info('midi.out.panic', { channel, via: 'webmidi' });
    return true;
  }, []);

  const sendNote = useCallback((note, velocity = 80, channel = 0, durationMs = null) => {
    const out = outputRef.current;
    const on = [0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f];
    const off = [0x80 | (channel & 0x0f), note & 0x7f, 0];
    // Bridge-first: the loopback-verified write path. The note-off is scheduled
    // client-side here (the bridge has no timestamp queue) — acceptable for the
    // immediate/virtual-key use of sendNote; the timestamped schedule* senders
    // below stay on Web MIDI's browser-process scheduler.
    if (bridgeSendMidi(on)) {
      logger().sampled('midi.out.note', { note, velocity, channel, via: 'bridge' },
        { maxPerMinute: 20, aggregate: true });
      if (durationMs != null) setTimeout(() => bridgeSendMidi(off), durationMs);
      return true;
    }
    if (!out) {
      // Witness the FAILURE too: an unbound output is a silent no-op otherwise.
      logger().sampled('midi.out.note-dropped', { note, reason: 'no-output' }, { maxPerMinute: 10, aggregate: true });
      return false;
    }
    out.send(on);
    // Witness line for the note path. Until 2026-08-23 this was a bare send() —
    // 18 test-tone presses left no trace, so "did it leave the browser" was
    // unanswerable. Sampled: playback is high-frequency; the first few per minute
    // with the handle's real state is what diagnosis needs.
    logger().sampled('midi.out.note', { note, velocity, channel, via: 'webmidi', conn: out.connection, state: out.state },
      { maxPerMinute: 20, aggregate: true });
    if (durationMs != null) {
      out.send(off, (performance?.now?.() ?? 0) + durationMs);
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
    const off = [0x80 | (channel & 0x0f), note & 0x7f, 0];
    if (bridgeSendMidi(off)) return true;
    if (!out) return false;
    out.send(off);
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
  // Bridge-first (2026-08-23 p17): scheduled sends ride the BRIDGE's clock
  // (its process timer, jank-immune like Chromium's MIDI service, but on the
  // loopback-verified write path). Web MIDI's timestamped send() is the
  // fallback. THE HOLE THIS CLOSES: the first bridge-first pass carved these
  // senders out, so score playback kept feeding a zombie Web MIDI handle —
  // noteheads lit, piano silent, and the bare out.send logged NOTHING. Every
  // path out of here now leaves a witness, including total failure.
  const sendNoteAt = useCallback((note, velocity = 80, atMs, channel = 0) => {
    const bytes = [0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f];
    const inMs = (atMs ?? 0) - (performance?.now?.() ?? 0);
    if (bridgeSendMidiAt(bytes, inMs)) {
      logger().sampled('midi.out.note-at', { note, inMs: Math.round(inMs), via: 'bridge' },
        { maxPerMinute: 10, aggregate: true });
      return true;
    }
    const out = outputRef.current;
    if (!out) {
      // LOUD: the audio plane has no path at all — playback will be silent.
      logger().sampled('midi.out.audio-plane-dead', { note, reason: 'no-bridge-no-output' },
        { maxPerMinute: 6, aggregate: true });
      return false;
    }
    out.send(bytes, atMs);
    logger().sampled('midi.out.note-at', { note, via: 'webmidi', conn: out.connection, state: out.state },
      { maxPerMinute: 10, aggregate: true });
    return true;
  }, []);

  const sendNoteOffAt = useCallback((note, atMs, channel = 0) => {
    const bytes = [0x80 | (channel & 0x0f), note & 0x7f, 0];
    const inMs = (atMs ?? 0) - (performance?.now?.() ?? 0);
    if (bridgeSendMidiAt(bytes, inMs)) return true;
    const out = outputRef.current;
    if (!out) return false;
    out.send(bytes, atMs);
    return true;
  }, []);

  /** Schedule an array of {t, type:'note_on'|'note_off', note, velocity} events (t in ms from now). */
  const scheduleNotes = useCallback((events, channel = 0) => {
    if (!events?.length) return false;
    if (bridgeOutUp()) {
      for (const e of events) {
        const status = e.type === 'note_off' ? 0x80 : 0x90;
        bridgeSendMidiAt([status | (channel & 0x0f), e.note & 0x7f, (e.velocity ?? 0) & 0x7f], e.t ?? 0);
      }
      logger().info('midi.out.schedule', { count: events.length, via: 'bridge' });
      return true;
    }
    const out = outputRef.current;
    if (!out) {
      logger().warn('midi.out.audio-plane-dead', { reason: 'no-bridge-no-output', count: events.length });
      return false;
    }
    const base = performance?.now?.() ?? 0;
    for (const e of events) {
      const status = e.type === 'note_off' ? 0x80 : 0x90;
      out.send([status | (channel & 0x0f), e.note & 0x7f, (e.velocity ?? 0) & 0x7f], base + (e.t ?? 0));
    }
    logger().info('midi.out.schedule', { count: events.length, via: 'webmidi' });
    return true;
  }, []);

  // Store-only note feed for an external note source (the piano-bridge WS in
  // acquireInput:false mode — see usePianoBridgeNotes). Updates the SAME note
  // store as hardware MIDI input so every consumer (keyboard, waterfall,
  // monitor) sees it identically, but never echoes to the MIDI output (a
  // bridge-fed note is inbound only, not something we're relaying out).
  const feedNote = useCallback((type, note, velocity) => {
    if (type === 'note_on') applyNoteOn(note, velocity);
    else if (type === 'note_off') applyNoteOff(note);
  }, [applyNoteOn, applyNoteOff]);

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
    outputConnected,
    bindingGeneration,
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
    feedNote,
  }), [status, inputName, outputName, outputConnected, bindingGeneration, resetLink, connect, sendProgramChange, sendVoice, sendLocalControl, sendControlChange, sendPanic, sendNote, sendNoteOff, sendNoteAt, sendNoteOffAt, scheduleNotes, subscribe, subscribeRaw, pressNote, releaseNote, feedNote]);
}

export default useWebMidiBLE;
