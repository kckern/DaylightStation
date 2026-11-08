import React, { useEffect, useRef, useState } from 'react';
import { useBluetoothRecovery } from './useBluetoothRecovery.js';
import './BluetoothRecoveryPanel.scss';

/** Lifecycle controls share the native API; keyboard/remote works without a gamepad. */
export default function BluetoothRecoveryPanel({ deviceId, onClose }) {
  const { state, fresh, error, message, busy, waiting, command } = useBluetoothRecovery({ deviceId });
  const [forget, setForget] = useState(null);
  const [pinEntry, setPinEntry] = useState({ key: null, value: '' });
  const root = useRef(null);
  const latestClose = useRef(onClose);latestClose.current = onClose;
  const pairing = state?.pairing;
  const pinKey = pairing ? `${pairing.address}:${pairing.expiresAtMs}` : null;
  const pin = pinEntry.key === pinKey ? pinEntry.value : '';
  const setPin = (value) => setPinEntry({ key: pinKey, value });
  useEffect(() => {
    root.current?.querySelector('button')?.focus();
    const key = (event) => {
      const back = ['Escape', 'BrowserBack', 'GoBack', 'GamepadSelect'].includes(event.key) || event.keyCode === 4;
      if (back) { event.preventDefault();event.stopImmediatePropagation();latestClose.current?.();return; }
      if (event.key.startsWith('Arrow')) {
        // Text input keeps its native cursor controls.
        if (event.target?.tagName === 'INPUT' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const controls = [...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
        const current = controls.indexOf(document.activeElement);
        const delta = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
        controls[(current + delta + controls.length) % controls.length]?.focus();
        event.preventDefault();event.stopImmediatePropagation();
      } else if (['Enter', ' ', 'Select', 'GamepadA'].includes(event.key) || event.keyCode === 23) {
        if (event.target?.tagName === 'INPUT') return;
        event.preventDefault();event.stopImmediatePropagation();
        if (!event.repeat) document.activeElement?.click();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  const available = fresh && state?.adapter?.enabled && !busy && !waiting;
  const replyAvailable = fresh && state?.adapter?.enabled && !busy;
  const capabilities = state?.capabilities || {};
  const action = (name, device, extra = {}) => command(name, { address: device.address, ...extra });
  return <div className="bluetooth-recovery" role="dialog" aria-modal="true" aria-label="Controller recovery" ref={root}>
    <div className="bluetooth-recovery__heading"><h2>Controllers</h2><button type="button" onClick={onClose}>Back to games</button></div>
    <p>Turn on your controller. For pairing, hold its pairing button until the light blinks.</p>
    <button type="button" disabled={!(state?.adapter?.discovering ? replyAvailable : available) || !capabilities.scan} onClick={() => command(state.adapter.discovering ? 'scan/stop' : 'scan', { durationMs: 12000 })}>
      {state?.adapter?.discovering ? 'Stop finding controllers' : 'Find controllers'}
    </button>
    {state && !state.adapter.enabled && <p>Bluetooth is unavailable or turned off. Controller recovery needs bridge setup.</p>}
    {error && <p role="alert">{error}</p>}
    {state?.lastError && <p role="alert">{state.lastError}</p>}
    <p role="status" aria-live="polite">{message}</p>
    <ul className="bluetooth-recovery__devices">{(state?.devices || []).map(device => <li key={device.address}>
      <strong>{device.name || 'Unnamed controller'}</strong><small>{device.address}</small>
      <span>{typeof device.connected !== 'boolean' ? 'Connection status unavailable' : device.connected ? 'Connected' : device.bond === 'bonded' ? 'Paired · disconnected' : device.bond === 'bonding' ? 'Pairing…' : 'Not paired'}</span>
      {device.manageable ? <div className="bluetooth-recovery__actions">
        {device.bond === 'none' && <button type="button" aria-label={`Pair ${device.name}`} disabled={!available || !capabilities.pair} onClick={()=>action('pair',device)}>Pair</button>}
        {device.bond === 'bonded' && <>
          <button type="button" aria-label={`${device.connected ? 'Disconnect' : 'Connect'} ${device.name}`} disabled={!available || !capabilities.input} onClick={()=>action(device.connected ? 'disconnect':'connect',device,{profile:'input'})}>{device.connected ? 'Disconnect':'Connect'}</button>
          <button type="button" aria-label={`Forget ${device.name}`} disabled={!available || !capabilities.unpair} onClick={()=>setForget(device)}>Forget</button>
        </>}
      </div> : <small>Remote or other device · view only</small>}
    </li>)}</ul>
    {state && state.devices.filter(d=>d.manageable).length === 0 && <p>No game controllers found. Put the controller in pairing mode, then choose Find controllers.</p>}
    {forget && <section aria-label="Confirm forget" className="bluetooth-recovery__confirmation">
      <p>Forget {forget.name} ({forget.address})? You will need to pair it again.</p>
      <button type="button" disabled={!available} aria-label={`Confirm forget ${forget.name}`} onClick={()=>{action('unpair',forget);setForget(null);}}>Forget controller</button>
      <button type="button" onClick={()=>setForget(null)}>Cancel forget</button>
    </section>}
    {pairing && <section aria-label="Pairing request">
      <p>{pairing.variant === 'pin' ? 'Enter the controller pairing PIN.' : 'Confirm this controller pairing request.'}</p>
      {pairing.variant === 'pin' && <label>Pairing PIN<input type="password" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)} /></label>}
      <button type="button" disabled={!replyAvailable || (pairing.variant === 'pin' ? !capabilities.pin || !pin : !capabilities.confirm)} onClick={()=>{action('pairing',pairing,{accept:true,...(pairing.variant==='pin'?{pin}:{})});setPin('');}}>Approve pairing</button>
      <button type="button" disabled={!replyAvailable} onClick={()=>{action('pairing',pairing,{accept:false});setPin('');}}>Cancel pairing</button>
    </section>}
  </div>;
}
