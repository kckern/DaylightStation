import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { bridgeHostPlausible } from './bridgeHost.js';
import { TAP_URL, chunkBytes, splitMessages, newChunks, voiceChanges, dedupeChanges } from './bridgeMidiTap.js';

const MAX_CHANGES = 8;

/**
 * Poll the bridge's raw MIDI-in tap while `enabled`, and surface voice changes
 * the KEYBOARD sends (a panel button press). See bridgeMidiTap.js for why this
 * is the only place the kiosk can see them.
 *
 * @returns {{ state: 'off'|'unavailable'|'listening'|'error', changes: {ch,msb,lsb,pc,at}[], clear: () => void }}
 */
export function useBridgeMidiTap({ enabled, intervalMs = 400, fetchImpl } = {}) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-midi-tap' }), []);
  const [state, setState] = useState('off');
  const [changes, setChanges] = useState([]);
  const memo = useRef({ total: null, status: { status: 0 }, banks: {}, last: null });

  useEffect(() => {
    if (!enabled) { setState('off'); return undefined; }
    if (!fetchImpl && !bridgeHostPlausible()) {
      setState('unavailable');
      logger.info('piano.midi-tap.unavailable', { reason: 'no-bridge-host' });
      return undefined;
    }
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    memo.current = { total: null, status: { status: 0 }, banks: {}, last: null };
    let stopped = false;
    let failures = 0;
    let timer = null;
    logger.info('piano.midi-tap.start', { intervalMs });

    const poll = async () => {
      try {
        const res = await doFetch(TAP_URL, { cache: 'no-store' });
        const body = await res.json();
        if (stopped) return;
        const { total, lines } = newChunks(body?.tap, memo.current.total);
        memo.current.total = total;
        const msgs = lines.flatMap((line) => splitMessages(chunkBytes(line), memo.current.status));
        const { changes: fresh, last } = dedupeChanges(voiceChanges(msgs, memo.current.banks), memo.current.last);
        memo.current.last = last;
        if (fresh.length) {
          for (const c of fresh) logger.info('piano.midi-tap.voice-change', { ch: c.ch, msb: c.msb, lsb: c.lsb, pc: c.pc });
          setChanges((prev) => [...fresh.reverse(), ...prev].slice(0, MAX_CHANGES));
        }
        if (failures > 0) logger.info('piano.midi-tap.recovered', { failures });
        failures = 0;
        setState('listening');
      } catch (error) {
        if (stopped) return;
        failures += 1;
        if (failures === 1 || failures % 25 === 0) logger.warn('piano.midi-tap.poll-failed', { failures, error: error?.message });
        setState('error');
      } finally {
        if (!stopped) timer = setTimeout(poll, intervalMs);
      }
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info('piano.midi-tap.stop', {});
    };
  }, [enabled, intervalMs, fetchImpl, logger]);

  const clear = useMemo(() => () => setChanges([]), []);
  return { state, changes, clear };
}

export default useBridgeMidiTap;
