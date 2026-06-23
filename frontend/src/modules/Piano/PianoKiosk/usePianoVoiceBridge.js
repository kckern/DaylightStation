import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'piano-voice-bridge' }));

const DEFAULT_URL = 'ws://localhost:8770';

/**
 * usePianoVoiceBridge — control channel to the native rendered-voice APK.
 * Browser stays the config authority: loadPreset() ships a fully-resolved spec.
 */
export function usePianoVoiceBridge({ url = DEFAULT_URL, enabled = true } = {}) {
  const [status, setStatus] = useState({ link: 'idle', engine: 'stopped', preset: null });
  const wsRef = useRef(null);
  const retryRef = useRef(0);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) { logger().warn('bridge.send-no-link', { type: msg.type }); return false; }
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let closed = false;
    let timer = null;
    const open = () => {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => { retryRef.current = 0; setStatus((s) => ({ ...s, link: 'connected' })); logger().info('bridge.open', { url }); };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'status') setStatus((s) => ({ ...s, engine: m.engine ?? s.engine, preset: m.preset ?? s.preset }));
          else if (m.type === 'error') logger().error('bridge.remote-error', { code: m.code, msg: m.msg });
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (closed) { setStatus((s) => ({ ...s, link: 'closed' })); return; }
        setStatus((s) => ({ ...s, link: 'reconnecting' }));
        const delay = Math.min(5000, 250 * 2 ** retryRef.current++);
        timer = setTimeout(open, delay);
      };
    };
    open();
    return () => { closed = true; if (timer) clearTimeout(timer); wsRef.current?.close?.(); };
  }, [url, enabled]);

  const loadPreset = useCallback((spec) => {
    send({ type: 'engine.start' });
    return send({ type: 'preset.load', spec });
  }, [send]);
  const setParam = useCallback((pathStr, value) => send({ type: 'param.set', path: pathStr, value }), [send]);
  const panic = useCallback(() => send({ type: 'panic' }), [send]);
  const stop = useCallback(() => send({ type: 'engine.stop' }), [send]);

  return useMemo(() => ({ status, loadPreset, setParam, panic, stop }), [status, loadPreset, setParam, panic, stop]);
}

export default usePianoVoiceBridge;
