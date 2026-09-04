import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'piano-bridge-notes' }));

const DEFAULT_URL = 'ws://localhost:8770';

// Grace before a never-connected socket is declared `unavailable`. On a kiosk
// tablet reboot the native piano-bridge APK's WS server can take a few seconds
// to come up AFTER the WebView (and this hook) load. Falling back to Web MIDI
// during that window is the boot-race hazard: if the browser grabs the Web MIDI
// input first, it wins the single-connection BLE race and starves the APK, so
// the bridge broadcasts no notes. Holding output-only for this window lets the
// APK reliably win BLE. A genuine non-kiosk client (no bridge at all) waits this
// once, then falls back — imperceptible behind the "connecting" gate.
const UNAVAILABLE_GRACE_MS = 8000;

// Reconnect ceiling once a client has been judged bridge-less. A browser that
// has NEVER opened the socket and is past the grace window almost certainly has
// no bridge at all (a laptop with the piano page open), and nothing it can do
// will conjure one — the APK is not going to appear on that machine. Retrying
// such a client every 5s forever produced 1,018 `bridge.socket-error` rows an
// hour in production, at ERROR level, from roughly one open tab: enough to
// crowd real errors out of the log store's retention window.
// A client that HAS connected keeps the fast ceiling, because that is the
// kiosk-tablet case where the APK restarts and must be picked straight back up.
const RECONNECT_CEILING_MS = 5000;
const RECONNECT_CEILING_BRIDGELESS_MS = 60000;

// Consecutive speakerOk:false heartbeats (each ~1s, per the bridge APK) required
// before flipping speakerConnected to false. A single true instantly recovers —
// only the disconnected direction needs debouncing against a transient blip.
const SPEAKER_HYSTERESIS = 3;

/**
 * usePianoBridgeNotes — consumes note.on/note.off frames broadcast by the
 * native piano-bridge APK (the BLE-MIDI reader) over a local WebSocket. The
 * browser no longer opens the Web MIDI INPUT itself (see useWebMidiBLE's
 * acquireInput:false) because a second BLE consumer fights the APK for the
 * single connection; this hook is the replacement note-in path.
 *
 * Lifecycle mirrors the deleted usePianoVoiceBridge (open/onmessage/onclose +
 * exponential backoff reconnect), extended to decode note.on/note.off frames
 * (the prior client only handled status/error).
 *
 * `unavailable` reports that no bridge exists on this client (a non-kiosk
 * browser — e.g. a laptop with a MIDI keyboard — where nothing listens on
 * ws://localhost:8770). It becomes true only after the socket has failed to
 * open at least twice AND has never once opened, so a real bridge that is
 * merely slow/flapping on the first attempt is NOT misread as absent
 * (bridge-first grace). Consumers use it to fall back to Web MIDI input.
 *
 * @param {{ url?: string, enabled?: boolean, onNote?: (type: 'note_on'|'note_off', note: number, velocity: number) => void }} [opts]
 */
export function usePianoBridgeNotes({ url = DEFAULT_URL, enabled = true, onNote } = {}) {
  const [link, setLink] = useState('idle'); // idle | connecting | connected | reconnecting | closed
  // everConnected: has the socket ever opened? failCount: closes/errors before
  // any open. Both drive `unavailable` (state so it's reactive for consumers).
  const [everConnected, setEverConnected] = useState(false);
  const [failCount, setFailCount] = useState(0);
  // graceExpired: the UNAVAILABLE_GRACE_MS window has elapsed. Gates `unavailable`
  // so an early burst of connect failures (APK WS server still starting after a
  // tablet reboot) can't prematurely flip the client into Web-MIDI fallback.
  const [graceExpired, setGraceExpired] = useState(false);
  // Mirrored as a ref because the socket callbacks below are created once per
  // `open()` and would otherwise close over the value as it was when that
  // socket was created — which is always `false` for the very first socket,
  // i.e. exactly the retries we need to quieten.
  const graceExpiredRef = useRef(false);
  // speakerConnected: whether the Bluetooth speaker the bridge APK talks to is
  // up, per the last few status heartbeats. Defaults true (non-kiosk clients
  // with no bridge never receive status frames, so they never flip it).
  const [speakerConnected, setSpeakerConnected] = useState(true);
  const speakerFalseRunRef = useRef(0);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const everConnectedRef = useRef(false);
  const onNoteRef = useRef(onNote);
  onNoteRef.current = onNote;

  useEffect(() => {
    if (!enabled) return undefined;
    let closed = false;
    let timer = null;

    const open = () => {
      setLink((s) => (s === 'idle' ? 'connecting' : s));
      logger().info('bridge.connecting', { url, attempt: retryRef.current });
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        const attempts = retryRef.current;
        retryRef.current = 0;
        everConnectedRef.current = true;
        setEverConnected(true);
        setLink('connected');
        logger().info('bridge.open', { url, attempts });
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'note.on') {
            onNoteRef.current?.('note_on', msg.note, msg.velocity ?? 0);
          } else if (msg.type === 'note.off') {
            onNoteRef.current?.('note_off', msg.note, 0);
          } else if (msg.type === 'status' && 'speakerOk' in msg) {
            if (msg.speakerOk) {
              speakerFalseRunRef.current = 0;
              setSpeakerConnected(true);
            } else {
              speakerFalseRunRef.current += 1;
              if (speakerFalseRunRef.current >= SPEAKER_HYSTERESIS) setSpeakerConnected(false);
            }
          }
          // other frame types (ready) are ignored here.
        } catch {
          // malformed frame — ignore, never let the socket die on bad JSON.
        }
      };

      ws.onerror = () => {
        // `error` only while a bridge is still plausibly there: either it has
        // worked before (a real drop worth alerting on) or we are inside the
        // grace window. A client already judged bridge-less is not failing —
        // it is correctly using Web MIDI, and its socket error is the expected
        // steady state, so it drops to debug and is sampled rather than
        // reported once per retry forever.
        if (everConnectedRef.current || !graceExpiredRef.current) {
          logger().error('bridge.socket-error', { url });
        } else {
          logger().sampled('bridge.socket-error.bridgeless', { url }, { maxPerMinute: 1, aggregate: true });
        }
      };

      ws.onclose = (e) => {
        wsRef.current = null;
        const willReconnect = !closed;
        // A close BEFORE ever opening counts toward "no bridge here" — but a
        // close after a successful open is a normal drop (bridge exists), so
        // don't let it push the client into Web-MIDI fallback.
        if (!everConnectedRef.current) setFailCount((n) => n + 1);
        if (everConnectedRef.current || !graceExpiredRef.current) {
          logger().warn('bridge.closed', { url, code: e?.code, reason: e?.reason, willReconnect });
        } else {
          logger().sampled('bridge.closed.bridgeless', { url, code: e?.code, willReconnect }, { maxPerMinute: 1, aggregate: true });
        }
        if (closed) { setLink('closed'); return; }
        setLink('reconnecting');
        const ceiling = (everConnectedRef.current || !graceExpiredRef.current)
          ? RECONNECT_CEILING_MS
          : RECONNECT_CEILING_BRIDGELESS_MS;
        const delay = Math.min(ceiling, 250 * 2 ** retryRef.current++);
        if (everConnectedRef.current || !graceExpiredRef.current) {
          logger().info('bridge.reconnect-scheduled', { url, attempt: retryRef.current, delayMs: delay });
        } else {
          logger().sampled('bridge.reconnect-scheduled.bridgeless', { url, delayMs: delay }, { maxPerMinute: 1, aggregate: true });
        }
        timer = setTimeout(open, delay);
      };
    };

    open();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close?.();
    };
  }, [url, enabled]);

  // Arm the grace timer once per enabled mount. If the socket connects within
  // the window, everConnected short-circuits `unavailable` regardless.
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(() => { graceExpiredRef.current = true; setGraceExpired(true); }, UNAVAILABLE_GRACE_MS);
    return () => clearTimeout(t);
  }, [enabled]);

  const unavailable = !everConnected && failCount >= 2 && graceExpired;

  /**
   * Send raw MIDI (in practice: SysEx) to the piano through the APK's `midi.raw`
   * command. This is the ONLY route SysEx has — the FKB WebView is permanently
   * denied Web MIDI SysEx (NotAllowedError on {sysex:true}, verified on Chrome
   * 151), so effect-type changes cannot originate in the browser's own MIDI
   * output no matter how healthy that link is.
   *
   * Returns false when the socket isn't open, so callers can fall back to CC
   * rather than assume delivery. Fire-and-forget beyond that: the piano has no
   * read-back, which is also why `repeat` exists (the JamCorder occasionally
   * drops a BLE→DIN SysEx; re-sending is the documented mitigation).
   */
  const sendSysex = useCallback((bytes, repeat = 1) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    if (!Array.isArray(bytes) || bytes.length === 0) return false;
    try {
      ws.send(JSON.stringify({ type: 'midi.raw', bytes, repeat }));
      return true;
    } catch {
      return false;
    }
  }, []);

  return useMemo(
    () => ({ link, unavailable, speakerConnected, sendSysex }),
    [link, unavailable, speakerConnected, sendSysex],
  );
}

export default usePianoBridgeNotes;
