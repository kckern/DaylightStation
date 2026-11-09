import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { useBluetoothManager } from './useBluetoothManager.js';
import { deviceStatus, STATUS_LABEL, splitDevices, shortAddress, findDevice } from './controllerModel.js';
import { runControllerFlow, flowSteps, STEP_LABEL, FlowError } from './controllerFlows.js';
import { useRemoteFocus } from './useRemoteFocus.js';
import { useGamepadActivity, gamepadIsPressing, isLit } from './useGamepadActivity.js';
import { attributePads } from './liveInput.js';
import PadDiagram from './PadDiagram.jsx';
import './ControllerManager.scss';

const FLOW_TITLE = { fix: 'Fixing', repair: 'Re-pairing', pair: 'Pairing', connect: 'Connecting' };

function PadIcon() {
  return <svg className="ctl-manager__icon" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M7 7h10a5 5 0 0 1 4.9 6l-.7 3.6a2.6 2.6 0 0 1-4.4 1.3L14.4 15H9.6l-2.4 2.9a2.6 2.6 0 0 1-4.4-1.3L2.1 13A5 5 0 0 1 7 7Zm0 3v1.5H5.5v1H7V14h1v-1.5h1.5v-1H8V10H7Zm9.5.2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Zm-2 2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z" />
  </svg>;
}

function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Full Bluetooth controller manager for a TV: see every pad and what it is
 * doing, and run the whole lifecycle — reconnect, forget, find, pair, PIN,
 * connect — from the remote, without Android Settings. Driven by the device's
 * audio-bridge Bluetooth API through /api/v1/arcade-bluetooth/:deviceId.
 */
export default function ControllerManager({ deviceId, onClose, client }) {
  const logger = useMemo(() => getLogger().child({ component: 'controller-manager' }), []);
  const { state, fresh, readError, api } = useBluetoothManager({ deviceId, client });
  const [flow, setFlow] = useState(null);
  const [confirmForget, setConfirmForget] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pinPrompt, setPinPrompt] = useState(null);
  const [pin, setPin] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const flowAbort = useRef(null);
  const pinResolve = useRef(null);
  const root = useRef(null);
  const overlay = useRef(null);
  const scanning = state?.adapter?.discovering === true;
  const enabled = state?.adapter?.enabled === true;
  const caps = state?.capabilities || {};
  const busy = Boolean(flow && !flow.result && !flow.error);
  const ready = fresh && enabled && !busy;
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);
  const { controllers, others } = splitDevices(state);

  useEffect(() => { logger.info('controller-manager.mount', { deviceId }); return () => logger.info('controller-manager.unmount', { deviceId }); }, [deviceId, logger]);
  useEffect(() => () => { flowAbort.current?.abort(); pinResolve.current?.(null); }, []);

  const start = useCallback(async (mode, device) => {
    if (flowAbort.current) return;
    const abort = new AbortController();
    flowAbort.current = abort;
    setNotice(null);
    setFlow({ mode, device, steps: Object.fromEntries(flowSteps(mode).map((id) => [id, { status: 'pending' }])), result: null, error: null });
    logger.info('controller-manager.flow-start', { deviceId, mode, address: device.address });
    const report = (id, status, extra = {}) => setFlow((f) => (f ? { ...f, steps: { ...f.steps, [id]: { status, ...extra } } } : f));
    const prompts = {
      pin: (prompt) => new Promise((resolve) => { setPin(''); setPinPrompt(prompt); pinResolve.current = resolve; }),
    };
    try {
      const address = await runControllerFlow({ mode, device, api, signal: abort.signal, report, prompts });
      logger.info('controller-manager.flow-done', { deviceId, mode, address });
      setFlow((f) => (f ? { ...f, result: address } : f));
    } catch (error) {
      if (error.name === 'AbortError') { logger.info('controller-manager.flow-cancelled', { deviceId, mode }); setFlow(null); }
      else {
        logger.warn('controller-manager.flow-failed', { deviceId, mode, error: error.message });
        setFlow((f) => (f ? { ...f, error: error instanceof FlowError ? error.message : 'Something went wrong. Try again.' } : f));
      }
    } finally {
      flowAbort.current = null; pinResolve.current = null; setPinPrompt(null);
    }
  }, [api, deviceId, logger]);

  const single = useCallback(async (action, device, done) => {
    setNotice(null);
    try {
      const after = await api.command(action, { address: device.address, ...(action === 'disconnect' ? { profile: 'input' } : {}) });
      await api.waitFor(done, 15000, { after });
      setNotice(`${device.name}: ${action === 'unpair' ? 'forgotten' : 'disconnected'}.`);
    } catch (error) {
      setNotice(`${device.name}: ${action === 'unpair' ? 'could not forget it' : 'could not disconnect'}. Try again.`);
    }
  }, [api]);

  const findNew = useCallback(async () => {
    setNotice(null);
    try { await api.command(scanning ? 'scan/stop' : 'scan', { durationMs: 30000 }); }
    catch {
      // Android denies discovery to a bridge whose service lacks the location
      // type (audio-bridge DESIGN.md). Say what still works instead of "try again".
      setNotice(/discovery was not accepted/i.test(api.current()?.lastError || '')
        ? 'This TV cannot search for brand-new controllers until the audio-bridge update is installed. Controllers listed here can still be fixed and re-paired.'
        : 'Could not start a search. Try again.');
    }
  }, [api, scanning]);

  const answerPin = (value) => { const resolve = pinResolve.current; pinResolve.current = null; setPinPrompt(null); resolve?.(value); };
  const closeFlow = () => { flowAbort.current?.abort(); pinResolve.current?.(null); setFlow(null); };

  const back = useCallback(() => {
    if (pinPrompt) { answerPin(null); return; }
    if (confirmForget) { setConfirmForget(null); return; }
    if (flow) { closeFlow(); return; }
    onClose?.();
  }, [pinPrompt, confirmForget, flow, onClose]);

  // Controllers under test only light up; the TV remote drives this screen.
  // A key that arrives while a pad button is held came from the pad (Android's
  // A → OK, B → Back fallbacks), so mashing can never click Forget or leave.
  useRemoteFocus({ scope: flow || confirmForget ? overlay : root, onBack: back, ignore: gamepadIsPressing });

  const { pads, lastSeen, now: padNow } = useGamepadActivity();
  const padFor = attributePads(pads, controllers.filter((d) => d.connected === true));
  const padLit = (index) => index != null && isLit(lastSeen[index], padNow);
  const anyLit = pads.some((p) => padLit(p.index));

  // Buttons are disabled until the first status read, so the remote would
  // otherwise start on Back. Once status arrives, start on the thing most
  // likely wanted: the first controller's main action, else Find.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !fresh || !root.current || flow || confirmForget) return;
    placed.current = true;
    const target = root.current.querySelector('.ctl-manager__list button.is-primary:not(:disabled)')
      || root.current.querySelector('.ctl-manager__list button:not(:disabled)')
      || root.current.querySelector('.ctl-manager__header button:not(:disabled)');
    target?.focus();
  }, [fresh, flow, confirmForget]);

  const live = flow ? findDevice(state, flow.result || flow.device.address) : null;
  const guide = state?.guide;

  return <div className="ctl-manager" ref={root} role="dialog" aria-modal="true" aria-label="Controllers">
    <header className="ctl-manager__header" data-nav-row="header">
      <h1>Controllers</h1>
      <span className={`ctl-manager__chip ${fresh && enabled ? 'is-ok' : 'is-bad'}`}>
        {!state ? 'Checking Bluetooth…' : !fresh ? 'Bluetooth status unavailable' : enabled ? (scanning ? 'Searching…' : 'Bluetooth on') : 'Bluetooth off'}
      </span>
      <button type="button" disabled={!ready || !caps.scan} onClick={findNew}>{scanning ? 'Stop search' : 'Find new controllers'}</button>
      <button type="button" onClick={() => onClose?.()}>Back</button>
    </header>

    {/* The bridge's lastError is sticky (it outlives the action that set it), so the
        main view shows only this screen's own notices; flows quote the bridge
        when one of THEIR steps fails. */}
    {(readError || notice) && <p className="ctl-manager__notice" role="status">{notice || readError}</p>}

    <div className="ctl-manager__body">
    <ul className="ctl-manager__list">
      {controllers.map((d) => {
        const status = deviceStatus(d);
        return <li key={d.address} className={`ctl-manager__row is-${status}`} data-nav-row={d.address}>
          <PadIcon />
          <div className="ctl-manager__name"><strong>{d.name}</strong><small>…{shortAddress(d.address)}</small></div>
          <span className={`ctl-manager__status is-${status}`}>
            {STATUS_LABEL[status]}
            {status === 'connected' && <span className={`ctl-manager__lamp${padLit(padFor.get(d.address)) ? ' is-lit' : ''}`}>
              {padLit(padFor.get(d.address)) ? 'I’m here!' : padFor.has(d.address) ? 'Press a button' : 'Press a button →'}
            </span>}
          </span>
          <div className="ctl-manager__actions">
            {status === 'connected' && <>
              <button type="button" disabled={!ready || !caps.input} onClick={() => single('disconnect', d, (s) => findDevice(s, d.address)?.connected === false)}>Disconnect</button>
              <button type="button" disabled={!ready || !caps.unpair} onClick={() => start('repair', d)}>Re-pair</button>
              <button type="button" disabled={!ready || !caps.unpair} onClick={() => setConfirmForget(d)}>Forget</button>
            </>}
            {(status === 'paired' || status === 'unknown') && <>
              <button type="button" className="is-primary" disabled={!ready || !caps.input} onClick={() => start('fix', d)}>Fix</button>
              <button type="button" disabled={!ready || !caps.input} onClick={() => start('connect', d)}>Connect</button>
              <button type="button" disabled={!ready || !caps.unpair} onClick={() => start('repair', d)}>Re-pair</button>
              <button type="button" disabled={!ready || !caps.unpair} onClick={() => setConfirmForget(d)}>Forget</button>
            </>}
            {status === 'nearby' && <button type="button" className="is-primary" disabled={!ready || !caps.pair} onClick={() => start('pair', d)}>Pair</button>}
          </div>
        </li>;
      })}
      {state && controllers.length === 0 && <li className="ctl-manager__empty">
        No game controllers yet. Put a controller in pairing mode, then choose <b>Find new controllers</b>.
      </li>}
    </ul>

    <aside className="ctl-manager__live" aria-label="Live input">
      <h2>Live input</h2>
      {pads.length === 0
        ? <p className="ctl-manager__live-empty">Press any button on a connected controller — it shows up here and lights up as you press.</p>
        : pads.map((p) => {
          const lit = padLit(p.index);
          return <div key={p.index} className={`ctl-manager__pad${lit ? ' is-lit' : ''}`}>
            <div className="ctl-manager__pad-head"><strong>Player {p.index + 1}</strong><small>{p.name}</small></div>
            <PadDiagram pressed={p.pressed} axes={p.axes} />
            <p className="ctl-manager__pad-press">{lit ? `I’m here! ${lastSeen[p.index]?.press || ''}` : 'Waiting for a press…'}</p>
          </div>;
        })}
      <p className="ctl-manager__live-hint">Controller buttons only light up here. Use the TV remote to choose.</p>
    </aside>
    </div>

    {others.length > 0 && <p className="ctl-manager__others">
      Other Bluetooth devices (view only): {others.map((d) => `${d.name} — ${STATUS_LABEL[deviceStatus(d)]}`).join(' · ')}
    </p>}

    {confirmForget && <div className="ctl-manager__overlay" ref={overlay} role="alertdialog" aria-label="Confirm forget">
      <div className="ctl-manager__card">
        <h2>Forget {confirmForget.name}?</h2>
        <p>The TV will stop recognising it until it is paired again.</p>
        <div data-nav-row="confirm" className="ctl-manager__actions">
          <button type="button" onClick={() => setConfirmForget(null)}>Keep it</button>
          <button type="button" className="is-danger" onClick={() => { const d = confirmForget; setConfirmForget(null); single('unpair', d, (s) => { const x = findDevice(s, d.address); return !x || x.bond === 'none'; }); }}>Forget</button>
        </div>
      </div>
    </div>}

    {flow && <div className="ctl-manager__overlay" ref={overlay} role="dialog" aria-label={`${FLOW_TITLE[flow.mode]} ${flow.device.name}`}>
      <div className="ctl-manager__card">
        <h2>{flow.result ? 'Ready to play' : flow.error ? 'That did not work' : `${FLOW_TITLE[flow.mode]} ${flow.device.name}`}</h2>
        <ol className="ctl-manager__steps">
          {flowSteps(flow.mode).map((id) => {
            const st = flow.steps[id] || { status: 'pending' };
            return <li key={id} className={`is-${st.status}${st.soft ? ' is-soft' : ''}`}>
              <span className="ctl-manager__step-mark" aria-hidden="true" />
              <span>{STEP_LABEL[id]}{st.status === 'failed' && st.soft ? ' — no answer, starting over' : ''}
                {id === 'search' && st.status === 'active' && st.endsAt ? ` — looking (${formatClock(Math.max(0, st.endsAt - now))})` : ''}</span>
            </li>;
          })}
        </ol>
        {flow.steps.search?.status === 'active' && <div className="ctl-manager__guide">
          {guide ? <>
            <p>{guide.mode ? `Pairing mode (${guide.mode}):` : 'Pairing mode:'}</p>
            <ol>{guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </> : <p>Turn the controller on and hold its pairing button until the light blinks fast.</p>}
        </div>}
        {pinPrompt && <form className="ctl-manager__pin" onSubmit={(e) => { e.preventDefault(); answerPin(pin || null); }} data-nav-row="pin">
          <label>The controller asks for a PIN (often 0000)
            <input type="text" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
          <button type="submit" disabled={!pin}>Send PIN</button>
          <button type="button" onClick={() => answerPin('0000')}>Use 0000</button>
        </form>}
        {flow.error && <p className="ctl-manager__error" role="alert">{flow.error}</p>}
        {flow.error && guide?.troubleshoot && <p className="ctl-manager__hint">{guide.troubleshoot}</p>}
        {flow.result && <p className="ctl-manager__success">{live?.name || flow.device.name} is connected.</p>}
        {flow.result && (() => {
          // Attributed by name when unambiguous; otherwise any controller's press
          // counts — the one just connected is the one being mashed.
          const index = padFor.get(flow.result);
          const lit = index != null ? padLit(index) : anyLit;
          return <p className={`ctl-manager__check${lit ? ' is-lit' : ''}`}>
            {lit ? 'I’m here! Buttons are coming through.' : 'Press any button on it to check — this lights up.'}
          </p>;
        })()}
        <div data-nav-row="flow" className="ctl-manager__actions">
          {flow.result && <button type="button" className="is-primary" onClick={() => onClose?.()}>Done — back to the menu</button>}
          {flow.result && <button type="button" onClick={() => setFlow(null)}>Manage more controllers</button>}
          {flow.error && <button type="button" className="is-primary" onClick={() => { const { mode, device } = flow; setFlow(null); start(mode === 'fix' ? 'repair' : mode, device); }}>Try again</button>}
          {flow.error && <button type="button" onClick={() => setFlow(null)}>Close</button>}
          {busy && <button type="button" onClick={closeFlow}>Cancel</button>}
        </div>
      </div>
    </div>}
  </div>;
}
