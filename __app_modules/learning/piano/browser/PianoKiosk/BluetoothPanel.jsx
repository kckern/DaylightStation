import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import TransportButton from './transport/TransportButton.jsx';
import { createBluetoothClient } from './bluetoothClient.js';

const PAGE_SIZE = 4;
const errorText = (error) => typeof error === 'string' ? error : error?.error || error?.message || null;
const connectedTo = (device, profile) => device?.connected && (device.profiles || []).includes(profile);
const settled = (pending, state) => {
  const device = state.devices.find((item) => item.address === pending.address);
  if (pending.action === 'power') return state.adapter.enabled === pending.enabled;
  if (pending.action === 'scan') return state.adapter.discovering;
  if (pending.action === 'scan/stop') return !state.adapter.discovering;
  if (pending.action === 'pair') return device?.bond === 'bonded';
  if (pending.action === 'unpair') return !device || device.bond === 'none';
  if (pending.action === 'connect') return connectedTo(device, pending.profile);
  if (pending.action === 'disconnect') return !connectedTo(device, pending.profile);
  if (pending.action === 'pairing') return !state.pairing || device?.bond === 'bonded';
  return false;
};

function DeviceList({ title, devices, selected, onSelect }) {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(devices.length / PAGE_SIZE) - 1);
  const visiblePage = Math.min(page, lastPage);
  return <div className="piano-bluetooth__list" role="group" aria-label={title}>
    <strong>{title} ({devices.length})</strong>
    {devices.length === 0 && <p className="piano-settings__note">None found</p>}
    <div className="piano-bluetooth__devices">
      {devices.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE).map((device) => <button type="button" key={device.address}
        className={`piano-bluetooth__device${device.address === selected ? ' is-selected' : ''}`}
        aria-pressed={device.address === selected} onClick={() => onSelect(device.address)}>
        <strong>{device.name || 'Unnamed device'}</strong><small>{device.address}</small>
        <span>{device.bond === 'bonding' ? 'Pairing…' : device.connected ? `Connected${device.profiles?.length ? `: ${device.profiles.join(', ')}` : ''}` : device.bond === 'bonded' ? 'Paired · not connected' : 'Not paired'}</span>
      </button>)}
    </div>
    {lastPage > 0 && <div className="piano-bluetooth__pages">
      <TransportButton label="Previous" ariaLabel={`Previous ${title.toLowerCase()}`} disabled={visiblePage === 0} onPress={() => setPage(visiblePage - 1)} />
      <span>{visiblePage + 1} / {lastPage + 1}</span>
      <TransportButton label="Next" ariaLabel={`Next ${title.toLowerCase()}`} disabled={visiblePage === lastPage} onPress={() => setPage(visiblePage + 1)} />
    </div>}
  </div>;
}

/** Owns polling/discovery for this view; leaving always stays inside the kiosk. */
export default function BluetoothPanel({ onBack }) {
  const client = useMemo(() => createBluetoothClient(), []);
  const logger = useMemo(() => getLogger().child({ component: 'piano-bluetooth' }), []);
  const [state, setState] = useState(null);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState(null);
  const [readError, setReadError] = useState(null);
  const panel = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Reading Bluetooth status…');
  const [selected, setSelected] = useState(null);
  const [forget, setForget] = useState(null);
  const [pin, setPin] = useState('');
  const [now, setNow] = useState(Date.now());
  const session = useRef(null);
  const pending = useRef(null);
  const scanRequested = useRef(false);
  const latestState = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    let timer;
    let signature;
    logger.info('piano.bluetooth.open', {});
    panel.current?.querySelector('[data-autofocus]')?.focus();
    const poll = async () => {
      try {
        const next = await client.state({ signal: controller.signal });
        if (controller.signal.aborted) return;
        latestState.current = next;
        setState(next); setFresh(true); setNow(Date.now());
        setReadError(null);
        const status = JSON.stringify({ enabled: next.adapter.enabled, discovering: next.adapter.discovering, devices: next.devices.map(({ address, bond, connected, profiles }) => ({ address, bond, connected, profiles })), pairing: next.pairing?.variant });
        if (status !== signature) { logger.info('piano.bluetooth.state', { enabled: next.adapter.enabled, discovering: next.adapter.discovering, devices: next.devices.length, pairing: next.pairing?.variant || null }); signature = status; }
        if (pending.current && settled(pending.current, next)) {
          logger.info('piano.bluetooth.observed', { action: pending.current.action });
          pending.current = null; setMessage('Tablet status updated.');
        } else if (pending.current && Date.now() >= pending.current.deadline) {
          logger.warn('piano.bluetooth.wait-timeout', { action: pending.current.action });
          pending.current = null; setMessage('No completed change reported yet. Check the device and try again.');
        } else if (!pending.current) setMessage('');
      } catch (failure) {
        if (controller.signal.aborted) return;
        setFresh(false); setReadError(failure.message || 'Couldn’t read Bluetooth status.');
        logger.warn('piano.bluetooth.read-failed', { code: failure.code || 'request_failed' });
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
      }
    };
    poll();
    return () => {
      controller.abort(); clearTimeout(timer);
      session.current = null;
      logger.info('piano.bluetooth.close', {});
      // Stop even if a scan command was accepted but the next state read has not arrived.
      if (scanRequested.current || latestState.current?.adapter.discovering) {
        client.command('scan/stop').catch((failure) => logger.warn('piano.bluetooth.cleanup-failed', { code: failure.code || 'request_failed' }));
      }
    };
  }, [client, logger]);

  const pairing = state?.pairing;
  useEffect(() => { setPin(''); }, [pairing?.address, pairing?.variant, pairing?.expiresAtMs]);
  const command = useCallback(async (action, body = {}) => {
    const controller = session.current;
    if (!controller || controller.signal.aborted || busy) return;
    setBusy(true); setError(null);
    logger.info('piano.bluetooth.command', { action, address: body.address, profile: body.profile });
    if (action === 'scan') scanRequested.current = true;
    try {
      await client.command(action, body, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (action === 'scan/stop') scanRequested.current = false;
      // Deliberately retain only non-secret fields. PINs never enter logs/pending state.
      pending.current = { action, address: body.address, profile: body.profile, enabled: body.enabled, deadline: Date.now() + 30000 };
      setMessage('Request accepted. Waiting for tablet status…');
      logger.info('piano.bluetooth.accepted', { action });
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure.message || 'Bluetooth action failed.');
      logger.warn('piano.bluetooth.command-failed', { action, code: failure.code || 'request_failed' });
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setPin(''); }
    }
  }, [busy, client, logger]);

  const adapter = state?.adapter;
  const capabilities = state?.capabilities || {};
  const enabled = fresh && adapter?.supported && adapter.enabled;
  const disabled = busy || !enabled;
  const devices = state?.devices || [];
  const current = devices.find((device) => device.address === selected) || devices[0];
  const expired = pairing?.expiresAtMs > 0 && now >= pairing.expiresAtMs;
  const variant = pairing?.variant;
  const confirmation = variant === 'confirm' || variant === 'consent';
  const pairingError = errorText(pairing?.error);
  const displayedError = readError || error || errorText(state?.lastError) || pairingError;

  return <section ref={panel} className="piano-bluetooth" aria-label="Bluetooth devices">
    <div className="piano-bluetooth__toolbar">
      <TransportButton icon="back" label="Back to maintenance" onPress={onBack} data-autofocus />
      <strong>{!adapter ? 'Bluetooth status unavailable' : !adapter.supported ? 'Bluetooth unavailable' : adapter.enabled ? 'Bluetooth on' : 'Bluetooth off'}</strong>
      {adapter?.name && <span className="piano-settings__note">{adapter.name}</span>}
      <TransportButton label={adapter?.enabled ? 'Turn Bluetooth off' : 'Turn Bluetooth on'} disabled={busy || !fresh || !adapter?.supported} onPress={() => command('power', { enabled: !adapter.enabled })} />
      <TransportButton label={adapter?.discovering ? 'Stop scan' : 'Scan for devices'} disabled={disabled || (!adapter?.discovering && !capabilities.scan)} onPress={() => command(adapter.discovering ? 'scan/stop' : 'scan', adapter.discovering ? {} : { durationMs: 12000 })} />
    </div>
    <div className="piano-bluetooth__messages">
      {displayedError ? <p role="alert" className="piano-bluetooth__error">{displayedError}</p> : <p role="status">{adapter?.discovering ? 'Scanning…' : message || 'Choose a device. Put nearby devices in pairing mode to find them.'}</p>}
    </div>
    <div className="piano-bluetooth__body">
      <DeviceList title="Paired devices" devices={devices.filter((device) => device.bond === 'bonded')} selected={current?.address} onSelect={(address) => { setSelected(address); setForget(null); }} />
      <DeviceList title="Nearby devices" devices={devices.filter((device) => device.bond !== 'bonded')} selected={current?.address} onSelect={(address) => { setSelected(address); setForget(null); }} />
      <div className="piano-bluetooth__detail">
        {current ? <>
          <strong>{current.name || 'Unnamed device'}</strong><small>{current.address} · {current.type || 'Bluetooth'}</small>
          <p>{current.bond === 'bonding' ? 'Pairing…' : current.bond === 'bonded' ? 'Paired' : 'Not paired'} · {current.connected ? 'Device connected' : <span>Not connected</span>}</p>
          <div className="piano-bluetooth__roles">{['audio', 'midi'].map((profile) => {
            const connected = connectedTo(current, profile);
            // BLE MIDI can connect without a bond; A2DP audio requires pairing.
            const needsBond = profile === 'audio' && current.bond !== 'bonded';
            return <TransportButton key={profile} label={`${connected ? 'Disconnect' : 'Connect'} ${profile === 'midi' ? 'MIDI' : 'audio'}`} disabled={disabled || !capabilities[profile] || needsBond} onPress={() => command(connected ? 'disconnect' : 'connect', { address: current.address, profile })} />;
          })}</div>
          {current.bond !== 'bonded' ? <TransportButton label={current.bond === 'bonding' ? 'Pairing…' : 'Pair'} disabled={disabled || !capabilities.pair || current.bond === 'bonding'} onPress={() => command('pair', { address: current.address })} /> : <>
            {forget === current.address ? <div className="piano-bluetooth__forget" role="group" aria-label="Confirm forget device">
              <p>Forget {current.name || current.address}? Pair it again before reconnecting.</p>
              <TransportButton emphasis="danger" label="Confirm forget" disabled={disabled || !capabilities.unpair} onPress={() => { setForget(null); command('unpair', { address: current.address }); }} />
              <TransportButton label="Cancel" onPress={() => setForget(null)} />
            </div> : <TransportButton emphasis="danger" label="Forget" disabled={disabled || !capabilities.unpair} onPress={() => setForget(current.address)} />}
          </>}
          {!capabilities.audio && <p className="piano-settings__note">Audio controls unavailable on this tablet.</p>}
          {!capabilities.midi && <p className="piano-settings__note">MIDI controls unavailable on this tablet.</p>}
        </> : <p>Select a paired or nearby device.</p>}
        {pairing && <div className="piano-bluetooth__pairing" role="group" aria-label="Pairing request">
          <strong>Pairing: {pairing.name || pairing.address}</strong>
          {expired ? <p>Pairing request expired. Start pairing again.</p> : <>
            {variant === 'pin' ? <>
              <label>Pairing PIN<input aria-label="Pairing PIN" type="password" value={pin} maxLength={16} autoComplete="off" onChange={(event) => setPin(event.target.value)} /></label>
              <TransportButton label="Send PIN" disabled={disabled || !capabilities.pin || !pin.length} onPress={() => command('pairing', { address: pairing.address, accept: true, pin })} />
              {!capabilities.pin && <p>This tablet cannot submit a pairing PIN.</p>}
            </> : confirmation || variant === 'display' ? <>
              {pairing.passkey != null && <output className="piano-bluetooth__passkey">{String(pairing.passkey).padStart(6, '0')}</output>}
              {variant === 'display' ? <p>Enter this code on {pairing.name || 'the device'}.</p> : <>
                <p>{variant === 'confirm' ? 'Do the codes match on both devices?' : 'Allow this device to pair?'}</p>
                {!capabilities.confirm && <p className="piano-bluetooth__error">This tablet cannot confirm pairing through Android. Confirmation capability is unavailable.</p>}
                <TransportButton label="Confirm pairing" disabled={disabled || !capabilities.confirm} onPress={() => command('pairing', { address: pairing.address, accept: true })} />
              </>}
            </> : <p>Pairing… Waiting for the device.</p>}
            <TransportButton label="Reject pairing" disabled={busy || !fresh} onPress={() => command('pairing', { address: pairing.address, accept: false })} />
          </>}
        </div>}
      </div>
    </div>
  </section>;
}
