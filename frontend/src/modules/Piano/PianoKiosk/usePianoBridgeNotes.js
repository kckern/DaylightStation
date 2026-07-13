import { useState, useEffect, useRef, useMemo } from 'react';
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
          }
          // other frame types (ready/status) are ignored here.
        } catch {
          // malformed frame — ignore, never let the socket die on bad JSON.
        }
      };

      ws.onerror = () => {
        logger().error('bridge.socket-error', { url });
      };

      ws.onclose = (e) => {
        wsRef.current = null;
        const willReconnect = !closed;
        // A close BEFORE ever opening counts toward "no bridge here" — but a
        // close after a successful open is a normal drop (bridge exists), so
        // don't let it push the client into Web-MIDI fallback.
        if (!everConnectedRef.current) setFailCount((n) => n + 1);
        logger().warn('bridge.closed', { url, code: e?.code, reason: e?.reason, willReconnect });
        if (closed) { setLink('closed'); return; }
        setLink('reconnecting');
        const delay = Math.min(5000, 250 * 2 ** retryRef.current++);
        logger().info('bridge.reconnect-scheduled', { url, attempt: retryRef.current, delayMs: delay });
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
    const t = setTimeout(() => setGraceExpired(true), UNAVAILABLE_GRACE_MS);
    return () => clearTimeout(t);
  }, [enabled]);

  const unavailable = !everConnected && failCount >= 2 && graceExpired;
  return useMemo(() => ({ link, unavailable }), [link, unavailable]);
}

export default usePianoBridgeNotes;
