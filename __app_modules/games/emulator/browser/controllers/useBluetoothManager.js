import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { createBluetoothClient } from '../input/bluetoothClient.js';

const POLL_MS = 1000;
// One dropped read on Shield Wi-Fi must not disable every button (and drop
// the remote's focus); only a run of failures makes the view stale.
const STALE_AFTER_FAILURES = 3;

/**
 * Polls the bridge once a second and exposes a promise API the controller
 * flows are written against:
 *   command(action, body)          → resolves with the time the bridge accepted it
 *   waitFor(predicate, ms, opts)   → resolves with the first matching snapshot
 *                                    read AFTER `opts.after` (ms timestamp), so a
 *                                    snapshot fetched before a command landed can
 *                                    never satisfy a wait on its outcome.
 * State is only ever what the bridge observed; nothing is inferred from a 202.
 */
export function useBluetoothManager({ deviceId, client: injected }) {
  const client = useMemo(() => injected || createBluetoothClient({ deviceId }), [deviceId, injected]);
  const logger = useMemo(() => getLogger().child({ component: 'bluetooth-manager' }), []);
  const [snapshot, setSnapshot] = useState({ state: null, fresh: false, readError: null });
  const latest = useRef({ state: null, readAt: 0, fresh: false });
  const waiters = useRef(new Set());

  useEffect(() => {
    const abort = new AbortController();
    let timer;
    let failures = 0;
    latest.current = { state: null, readAt: 0, fresh: false };
    logger.info('bluetooth-manager.open', { deviceId });
    const notify = () => { for (const w of [...waiters.current]) w.check(); };
    const poll = async () => {
      const startedAt = Date.now();
      try {
        const state = await client.state({ signal: abort.signal });
        if (abort.signal.aborted) return;
        failures = 0;
        latest.current = { state, readAt: startedAt, fresh: true };
        setSnapshot({ state, fresh: true, readError: null });
      } catch (error) {
        if (abort.signal.aborted) return;
        failures += 1;
        if (failures >= STALE_AFTER_FAILURES || !latest.current.state) {
          latest.current = { ...latest.current, fresh: false };
          setSnapshot((prev) => ({ ...prev, fresh: false, readError: error.message || 'Could not read controller status.' }));
        }
        logger.sampled('bluetooth-manager.read-failed', { deviceId, error: error.message }, { maxPerMinute: 4, aggregate: true });
      } finally {
        if (!abort.signal.aborted) { notify(); timer = setTimeout(poll, POLL_MS); }
      }
    };
    poll();
    return () => {
      abort.abort(); clearTimeout(timer);
      for (const w of [...waiters.current]) w.cancel();
      logger.info('bluetooth-manager.close', { deviceId });
    };
  }, [client, deviceId, logger]);

  const api = useMemo(() => ({
    current: () => latest.current.state,
    async command(action, body = {}) {
      logger.info('bluetooth-manager.command', { deviceId, action });
      try {
        await client.command(action, body);
      } catch (error) {
        logger.warn('bluetooth-manager.command-failed', { deviceId, action, error: error.message });
        throw error;
      }
      return Date.now();
    },
    waitFor(predicate, timeoutMs, { after = 0, signal } = {}) {
      return new Promise((resolve, reject) => {
        const waiter = {
          check() {
            const { state, readAt, fresh } = latest.current;
            if (!fresh || !state || readAt < after) return;
            let hit;
            try { hit = predicate(state); } catch (error) { done(); reject(error); return; }
            if (hit) { done(); resolve(state); }
          },
          cancel() { done(); reject(Object.assign(new Error('Stopped'), { name: 'AbortError' })); },
        };
        const timer = setTimeout(() => { done(); reject(Object.assign(new Error('Timed out'), { name: 'TimeoutError' })); }, timeoutMs);
        const onAbort = () => waiter.cancel();
        function done() { clearTimeout(timer); waiters.current.delete(waiter); signal?.removeEventListener('abort', onAbort); }
        if (signal?.aborted) { waiter.cancel(); return; }
        signal?.addEventListener('abort', onAbort, { once: true });
        waiters.current.add(waiter);
        waiter.check();
      });
    },
  }), [client, deviceId, logger]);

  return { ...snapshot, api };
}
