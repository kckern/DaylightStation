// useFitnessBluetooth — the fitness host's Bluetooth state and bus actions,
// handed to the Bluetooth screen (BluetoothScreen) as one `bluetooth` object:
// inventory, nearby search, pairing by address, forget. FitnessContext routes
// the bus messages in BT_TOPICS to handleMessage and calls noteHealth on each
// fitness.transport.health (how a silent search tells an old satellite from a
// dead one).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import {
  ADDRESS_PAIR_MS, PAIR_WINDOW_MS, SCAN_ANSWER_MS, SCAN_WINDOW_MS,
  buildInventoryRequest, buildPairRequest, buildRemoveRequest, buildScanRequest,
  mergePairingProgress, mergeScanProgress, scanSilenceReason,
} from './fitnessBtActions.js';

export const BT_TOPICS = ['bt_inventory', 'bt.pair.progress', 'bt.remove.result', 'bt.scan.progress'];
const PAIR_ANSWER_MS = 15000;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'fitness-bluetooth' });
  return _logger;
}

export function useFitnessBluetooth({ send }) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const seq = useRef(0);
  const lastHealthAt = useRef(0);
  const timers = useRef(new Set());
  const [inventory, setInventory] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [forgetResult, setForgetResult] = useState(null);
  const [scan, setScan] = useState(null);
  const scanRef = useRef(null);
  scanRef.current = scan;

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  // These read refs only, so the [] callbacks below never go stale.
  const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${++seq.current}`;
  const post = (msg) => {
    try { sendRef.current?.(msg); }
    catch (err) { logger().warn('fitness.bt.send-failed', { topic: msg.topic, error: err?.message }); }
  };
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.current.delete(t); fn(); }, ms);
    timers.current.add(t);
  };

  const handleMessage = useCallback((data) => {
    switch (data?.topic) {
      case 'bt_inventory':
        setInventory(Array.isArray(data.devices) ? data.devices : []);
        return true;
      case 'bt.pair.progress':
        logger().info('fitness.bt.pair-progress', {
          requestId: data.requestId, phase: data.phase, address: data.device?.address, controllerId: data.controllerId,
          attempt: data.attempt, reason: data.reason, code: data.code, message: data.message, mode: data.mode,
        });
        setPairing((cur) => {
          const next = mergePairingProgress(cur, data);
          if (next.satelliteOutdated && !cur?.satelliteOutdated) {
            logger().warn('fitness.bt.satellite-outdated', { requestId: data.requestId, phase: data.phase, requestedMode: cur?.mode });
          }
          return next;
        });
        return true;
      case 'bt.remove.result':
        logger().info('fitness.bt.remove-result', { address: data.address, success: data.success, error: data.error });
        setForgetResult({ address: data.address, success: !!data.success, error: data.error || null });
        return true;
      case 'bt.scan.progress':
        if (data.phase === 'nearby') {
          logger().sampled?.('fitness.bt.scan-nearby', {
            requestId: data.requestId, count: Array.isArray(data.devices) ? data.devices.length : 0,
          }, { maxPerMinute: 6, aggregate: true });
        } else {
          logger().info('fitness.bt.scan-progress', { requestId: data.requestId, phase: data.phase, reason: data.reason, message: data.message });
        }
        setScan((cur) => mergeScanProgress(cur, data, Date.now()));
        return true;
      default:
        return false;
    }
  }, []);

  const noteHealth = useCallback(() => { lastHealthAt.current = Date.now(); }, []);

  const requestInventory = useCallback(() => {
    const requestId = nextId('inv');
    post(buildInventoryRequest({ requestId }));
    logger().debug('fitness.bt.inventory-request', { requestId });
  }, []);

  const startScan = useCallback(({ durationMs = SCAN_WINDOW_MS } = {}) => {
    const requestId = nextId('scan');
    const next = { phase: 'starting', requestId, optimistic: true, devices: [], endsAt: null, reason: null };
    scanRef.current = next;
    setScan(next);
    post(buildScanRequest({ requestId, action: 'start', durationMs }));
    logger().info('fitness.bt.scan-request', { requestId, durationMs });
    // A current satellite answers within a second with `scanning`. Silence
    // from a live satellite means it predates searches.
    later(() => {
      setScan((cur) => {
        if (!cur || cur.requestId !== requestId || !cur.optimistic) return cur;
        const reason = scanSilenceReason({ lastHealthAt: lastHealthAt.current, now: Date.now() });
        logger().warn('fitness.bt.scan-no-response', { requestId, reason });
        return { ...cur, phase: 'done', optimistic: false, reason, devices: [] };
      });
    }, SCAN_ANSWER_MS);
    return requestId;
  }, []);

  const stopScan = useCallback((reason = 'user') => {
    const cur = scanRef.current;
    if (!cur || cur.phase === 'done' || cur.phase === 'stopping') return;
    post(buildScanRequest({ requestId: cur.requestId, action: 'stop' }));
    logger().info('fitness.bt.scan-stop', { requestId: cur.requestId, reason });
    const next = { ...cur, phase: 'stopping' };
    scanRef.current = next;
    setScan(next);
  }, []);

  const pairController = useCallback(({ targets = [], controllerId = null, durationMs = PAIR_WINDOW_MS, mode = 'repair', address } = {}) => {
    const requestId = nextId('pair');
    setPairing({ phase: 'scanning', durationMs, requestId, optimistic: true, mode, ...(address ? { device: { address: String(address).toUpperCase() } } : {}) });
    post(buildPairRequest({ requestId, durationMs, targets, mode, address }));
    logger().info('fitness.bt.pair-request', { requestId, durationMs, controllerId, mode, address: address || null, targets: targets.length });
    // The garage box answers within a second with its own `scanning`. Silence
    // means it is offline: say so instead of spinning forever.
    later(() => {
      setPairing((cur) => {
        if (!cur || cur.requestId !== requestId || !cur.optimistic) return cur;
        logger().warn('fitness.bt.pair-no-response', { requestId, mode: cur.mode });
        return { phase: 'done', paired: [], reason: 'no-response', requestId, mode: cur.mode, device: cur.device };
      });
    }, PAIR_ANSWER_MS);
    return requestId;
  }, []);

  const pairAddress = useCallback(({ address, controllerId = null, label = null, pin = null }) => pairController({
    mode: 'address', address, controllerId, durationMs: ADDRESS_PAIR_MS,
    targets: [{ id: controllerId, label, ...(pin ? { pin } : {}) }],
  }), [pairController]);

  const forget = useCallback((address) => {
    setForgetResult(null);
    const requestId = nextId('forget');
    post(buildRemoveRequest({ requestId, address }));
    logger().info('fitness.bt.remove-request', { requestId, address });
    return requestId;
  }, []);

  const bluetooth = useMemo(() => ({
    inventory, scan, pairing, forgetResult, requestInventory, startScan, stopScan, pairAddress, forget,
  }), [inventory, scan, pairing, forgetResult, requestInventory, startScan, stopScan, pairAddress, forget]);

  return { bluetooth, handleMessage, noteHealth, pairController };
}
