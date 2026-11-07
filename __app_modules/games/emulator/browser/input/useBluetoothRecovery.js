import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { createBluetoothClient } from './bluetoothClient.js';

export function operationSettled(operation, state) {
  const device = state.devices.find(d => d.address === operation.address);
  switch (operation.action) {
    case 'connect': return device?.connected === true && device.profiles?.includes('input');
    case 'disconnect': return device?.connected === false;
    case 'pair': return device?.bond === 'bonded';
    case 'unpair': return !device || device.bond === 'none';
    case 'scan': return state.adapter.discovering;
    case 'scan/stop': return !state.adapter.discovering;
    case 'pairing': return !state.pairing;
    default: return false;
  }
}
export function useBluetoothRecovery({ deviceId }) {
  const client = useMemo(() => createBluetoothClient({ deviceId }), [deviceId]);
  const logger = useMemo(() => getLogger().child({ component: 'arcade-bluetooth' }), []);
  const [state, setState] = useState(null);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState(null);
  const [readError, setReadError] = useState(null);
  const [message, setMessage] = useState('Reading controller status…');
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);
  const scanOwned = useRef(false);
  const session = useRef(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const abort = new AbortController();session.current = abort;
    let timer;
    pending.current = null;scanOwned.current = false;inFlight.current = false;
    setState(null);setFresh(false);setBusy(false);setWaiting(false);setError(null);setReadError(null);
    logger.info('arcade.bluetooth.open', { deviceId });
    const poll = async () => {
      try {
        const next = await client.state({ signal: abort.signal });
        if (abort.signal.aborted) return;
        setState(next);setFresh(true);setReadError(null);
        if (pending.current && operationSettled(pending.current, next)) {
          pending.current = null;setWaiting(false);setMessage('Controller status updated.');
        } else if (pending.current && Date.now() >= pending.current.deadline) {
          pending.current = null;setWaiting(false);setMessage('No completed change reported. Wake the controller and try again.');
        } else if (!pending.current) setMessage(previous => previous === 'Reading controller status…' ? '' : previous);
      } catch (e) {
        if (!abort.signal.aborted) { setFresh(false);setReadError(e.message || 'Could not read controller status.'); }
      } finally { if (!abort.signal.aborted) timer = setTimeout(poll, 1000); }
    };
    poll();
    return () => {
      abort.abort();clearTimeout(timer);session.current = null;
      if (scanOwned.current) client.command('scan/stop').catch(() => logger.warn('arcade.bluetooth.scan-cleanup-failed', { deviceId }));
      logger.info('arcade.bluetooth.close', { deviceId });
    };
  }, [client, deviceId, logger]);
  const command = useCallback(async (action, body = {}) => {
    const abort = session.current;
    if (!abort || abort.signal.aborted || inFlight.current || !fresh || (pending.current && !['pairing', 'scan/stop'].includes(action))) return;
    inFlight.current = true;setBusy(true);setError(null);
    if (action === 'scan') scanOwned.current = true;
    logger.info('arcade.bluetooth.command', { deviceId, action });
    try {
      await client.command(action, body, { signal: abort.signal });
      if (abort.signal.aborted) return;
      pending.current = { action, address: body.address, deadline: Date.now() + 30000 };setWaiting(true);
      if (action === 'scan/stop') scanOwned.current = false;
      setMessage('Request accepted. Waiting for the device to report the change…');
    } catch (e) {
      if (!abort.signal.aborted) { setError('Controller action failed. Refresh status and try again.');setMessage('');logger.warn('arcade.bluetooth.command-failed', { deviceId, action }); }
    } finally { if (!abort.signal.aborted) { inFlight.current = false;setBusy(false); } }
  }, [client, deviceId, fresh, logger]);
  return { state, fresh, error: error || readError, message, busy, waiting, command };
}
