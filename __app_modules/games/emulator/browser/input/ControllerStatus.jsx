/**
 * ControllerStatus — panel showing which configured controllers are connected
 * and a live "connected now" list with press-to-identify highlighting.
 *
 * Keyboard always works regardless of controllers, so the empty state reminds
 * the user of the fallback mapping rather than reading as an error.
 *
 * Pairing has two paths:
 *   - a configured controller's guided re-pair: the per-controller steps (which
 *     buttons, what the LED does) come from its `pairing:` block in input.yml,
 *     shown before and during the pairing window with live lifecycle progress;
 *   - "Add a new device": any Bluetooth input device (gamepad, keyboard, mouse,
 *     remote), generic steps, no config entry needed. Such devices are listed
 *     under "Other Bluetooth devices" with a Forget button.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { useGamepadStatus } from "./useGamepadStatus.js";
import { pairButtonState } from "./pairButtonState.js";
import {
  pairingGuides, buildPairTargets, pairingStatus, controllerOsState, ADD_DEVICE_STEPS, otherBtDevices,
} from "./pairingGuide.js";
import "./ControllerStatus.scss";

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'emulator-controller-status' });
  return _logger;
}

const OS_LABEL = {
  ready: 'Ready',
  connecting: 'Connecting…',
  asleep: 'Asleep — press START to wake',
  unpaired: 'Not paired — trying to connect',
  'not-paired': 'Not paired',
};

const KIND_LABEL = { gamepad: 'Controller', keyboard: 'Keyboard mode', mouse: 'Mouse mode', tablet: 'Tablet' };
const OTHER_LABEL = { ready: 'Ready', connecting: 'Connecting…', asleep: 'Not connected', unpaired: 'Not paired — trying to connect' };

/**
 * @param {object} props
 * @param {Array<object>} props.controllers   [{ id, label, match, count?, address?, pairing? }].
 * @param {Function} [props.getGamepads]       injectable for tests.
 * @param {Array<object>} [props.btInventory]  OS-level BlueZ inventory
 *   ([{ address, name, connected, battery, paired?, input?, kind? }]) passed in by the
 *   host. Optional — when absent the panel renders browser-only (no OS column).
 *   This component is host-agnostic: it never imports FitnessContext.
 * @param {Function} [props.onPair]            ({ targets, controllerId, mode: 'repair'|'add' }) => void | Promise<void>.
 *   When provided, render the pairing affordance (re-pair and "Add a new device").
 * @param {object} [props.pairing]             latest `bt.pair.progress` message (may carry `mode`).
 * @param {Function} [props.onForget]          (address: string) => void | Promise<void>.
 *   When provided, render a "Forget" button on bonded rows (configured and other devices).
 * @param {object} [props.forgetResult]        latest `bt.remove.result` ({ address, success, error }).
 */
export function ControllerStatus({ controllers = [], getGamepads, btInventory, onPair, pairing, onForget, forgetResult }) {
  const { connected, known } = useGamepadStatus(controllers, { getGamepads, btInventory });

  // Show the OS column only when a BT inventory feed is actually present.
  const hasBtFeed = Array.isArray(btInventory);

  // label lookup for the "connected now" rows.
  const labelById = useMemo(() => {
    const m = {};
    for (const c of controllers) m[c.id] = c.label ?? c.id;
    return m;
  }, [controllers]);
  const configById = useMemo(() => {
    const m = {};
    for (const c of controllers) m[c.id] = c;
    return m;
  }, [controllers]);

  const guides = useMemo(() => pairingGuides(controllers), [controllers]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideId, setGuideId] = useState(null);
  const activeGuide = guides.find((g) => g.id === guideId) || guides[0] || null;

  const hasConnected = connected.length > 0;
  const canPair = typeof onPair === 'function';
  const btn = pairButtonState(pairing);
  const [addOpen, setAddOpen] = useState(false);
  const [activeMode, setActiveMode] = useState('repair');
  // The host keeps `mode` on every message of a window (FitnessContext's
  // mergePairingProgress), so a remounted panel still knows an add window from
  // a re-pair. The last button pressed is only the fallback for a host that
  // does not send `mode`.
  const mode = pairing?.mode || activeMode;
  const status = pairingStatus(pairing, mode);
  const showAdd = canPair && (addOpen || (status.busy && mode === 'add'));
  const showGuide = canPair && !showAdd && guides.length > 0 && (guideOpen || status.busy);
  const others = useMemo(() => otherBtDevices(controllers, btInventory), [controllers, btInventory]);

  // A panel opened over a finished window must not show that window's result
  // as if it were new. `staleResult` remembers the result on screen when the
  // panel opened; starting a request from the panel clears it (some hosts send
  // no requestId, so "a different requestId" alone cannot tell them apart).
  const [staleResult, setStaleResult] = useState(null);
  const showResult = status.busy || !staleResult || pairing?.requestId !== staleResult.requestId;
  const panelStatus = showResult ? status : { busy: false, tone: 'idle', text: null, retry: false };

  // Keep a gamepad user's place: focus the start button when a panel opens.
  const addStartRef = useRef(null);
  const guideStartRef = useRef(null);
  useEffect(() => { if (showAdd) addStartRef.current?.focus(); }, [showAdd]);
  useEffect(() => { if (showGuide) guideStartRef.current?.focus(); }, [showGuide]);

  useEffect(() => {
    logger().debug('controller-status.connected-change', {
      count: connected.length,
      slots: connected.map((p) => p.slot),
      matched: connected.map((p) => p.matchedId),
    });
  }, [connected]);

  useEffect(() => {
    if (!pairing?.phase) return;
    logger().info('controller-status.pair-phase', {
      phase: pairing.phase,
      requestId: pairing.requestId,
      address: pairing.device?.address,
      controllerId: pairing.controllerId,
      reason: pairing.reason,
      message: pairing.message,
    });
  }, [pairing]);

  /**
   * One pairing request. `repair` re-pairs a configured controller (or any
   * configured model when controllerId is null); `add` looks for any new input
   * device, and every configured model's PIN still applies.
   */
  const requestPair = ({ controllerId = null, mode: reqMode }) => {
    const targets = buildPairTargets(controllers, reqMode === 'add' ? null : controllerId);
    setActiveMode(reqMode);
    setStaleResult(null);
    logger().info(reqMode === 'add' ? 'controller-status.add-start' : 'controller-status.pair-start', {
      controllerId, mode: reqMode, targets: targets.length,
    });
    try {
      const r = onPair({ targets, controllerId: reqMode === 'add' ? null : controllerId, mode: reqMode });
      if (r && typeof r.catch === 'function') {
        r.catch((err) => logger().warn('controller-status.pair-error', { error: err && err.message }));
      }
    } catch (err) {
      logger().warn('controller-status.pair-error', { error: err && err.message });
    }
  };

  const markOpened = () => {
    setStaleResult(pairing?.phase && !status.busy ? { requestId: pairing.requestId } : null);
  };

  const openAdd = () => {
    if (status.busy) return;
    markOpened();
    setGuideOpen(false);
    setAddOpen(true);
    logger().info('controller-status.add-open', {});
  };

  const openGuide = (controllerId) => {
    if (status.busy) return;
    markOpened();
    setAddOpen(false);
    setGuideId(controllerId || guides[0]?.id || null);
    setGuideOpen(true);
    logger().info('controller-status.pair-guide-open', { controllerId: controllerId || guides[0]?.id || null });
  };

  const handlePairClick = () => {
    logger().info('controller-status.pair-click', {});
    if (guides.length > 0) openGuide(null);
    else requestPair({ controllerId: null, mode: 'repair' });
  };

  // A forgotten configured pad comes back through its own guide; anything
  // else comes back through "Add a new device".
  const forgotConfigured = useMemo(() => {
    const want = String(forgetResult?.address || '').toUpperCase();
    if (!want) return false;
    return controllers.some((c) => String(c?.address || '').toUpperCase() === want
      || (hasBtFeed && String(controllerOsState(c, btInventory).device?.address || '').toUpperCase() === want));
  }, [forgetResult, controllers, hasBtFeed, btInventory]);
  const forgetMessage = forgetResult?.address
    ? (forgetResult.success
      ? (forgotConfigured
        ? 'Forgotten. To use it again, put the controller in pairing mode and press Pair controller.'
        : 'Forgotten. To use it again, put it in pairing mode and press Add a new device.')
      : `Could not forget it — ${forgetResult.error || 'unknown error'}`)
    : null;

  return (
    <div className="emulator-controller-status" data-connected={hasConnected ? '1' : '0'}>
      <section className="ccs-known">
        <h4 className="ccs-heading">Known controllers</h4>
        <ul className="ccs-known-list">
          {known.map((k) => {
            const os = hasBtFeed ? controllerOsState(configById[k.id], btInventory) : { status: 'unknown', device: null };
            const bonded = os.status === 'ready' || os.status === 'connecting' || os.status === 'asleep';
            return (
              <li
                key={k.id}
                className={`ccs-known-row${k.connected ? ' ccs-on' : ''}`}
                data-controller-id={k.id}
                data-os-status={os.status}
              >
                <div className="ccs-known-main">
                  <span className="ccs-label">{k.label}</span>
                  <span className={`ccs-badge${k.connected ? ' ccs-badge-on' : ''}`}>
                    {k.connectedCount} of {k.count} connected
                  </span>
                  {hasBtFeed && os.status !== 'unknown' ? (
                    <span className={`ccs-os-badge ccs-os-${os.status}${os.status === 'ready' ? ' ccs-os-on' : ' ccs-os-off'}`}>
                      {OS_LABEL[os.status]}
                      {os.status === 'ready' && os.device?.battery != null ? ` · ${os.device.battery}%` : ''}
                    </span>
                  ) : null}
                  {typeof onForget === 'function' && k.address && (!hasBtFeed || bonded) ? (
                    <button
                      type="button"
                      className="ccs-forget-button"
                      aria-label={`Forget ${k.label}`}
                      onClick={() => {
                        try {
                          logger().info('controller-status.forget-click', { id: k.id });
                        } catch {
                          /* logging must never break the forget action */
                        }
                        onForget(k.address);
                      }}
                    >
                      Forget
                    </button>
                  ) : null}
                </div>
                {canPair && os.status === 'unpaired' ? (
                  <div className="ccs-unpaired-notice" role="status">
                    <span>{k.label} is trying to connect but isn&apos;t paired. Put it in pairing mode and pair it again.</span>
                    <button type="button" className="ccs-pair-button" onClick={() => openGuide(k.id)}>
                      Pair {k.label}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {forgetMessage ? <p className="ccs-forget-result" role="status">{forgetMessage}</p> : null}
      </section>

      {hasBtFeed && others.length > 0 && (
        <section className="ccs-other">
          <h4 className="ccs-heading">Other Bluetooth devices</h4>
          <ul className="ccs-other-list">
            {others.map((d) => {
              const label = d.name || d.address;
              return (
                <li key={d.address} className="ccs-other-row" data-address={d.address} data-os-status={d.status}>
                  <span className="ccs-label">{label}</span>
                  {d.kind && KIND_LABEL[d.kind] ? <span className="ccs-kind">{KIND_LABEL[d.kind]}</span> : null}
                  <span className={`ccs-os-badge ccs-os-${d.status}${d.status === 'ready' ? ' ccs-os-on' : ' ccs-os-off'}`}>
                    {OTHER_LABEL[d.status]}{d.status === 'ready' && d.battery != null ? ` · ${d.battery}%` : ''}
                  </span>
                  {canPair && d.paired === false ? (
                    <button
                      type="button"
                      className="ccs-pair-button ccs-add-again-button"
                      aria-label={`Add ${label} again`}
                      disabled={status.busy}
                      onClick={openAdd}
                    >
                      Add again
                    </button>
                  ) : null}
                  {typeof onForget === 'function' && d.paired !== false ? (
                    <button
                      type="button"
                      className="ccs-forget-button"
                      aria-label={`Forget ${label}`}
                      onClick={() => {
                        logger().info('controller-status.forget-other-click', { address: d.address, kind: d.kind || null });
                        onForget(d.address);
                      }}
                    >
                      Forget
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="ccs-connected">
        <h4 className="ccs-heading">Connected now</h4>
        {hasConnected ? (
          <ul className="ccs-connected-list">
            {connected.map((p) => (
              <li
                key={p.slot}
                className={`ccs-connected-row${p.active ? ' gp-active' : ''}`}
                data-slot={p.slot}
              >
                <span className="ccs-player">
                  Player {p.slot + 1} · {p.matchedId ? labelById[p.matchedId] : p.id}
                </span>
                <span className="ccs-raw-id">{p.id}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ccs-empty">
            No controllers connected — keyboard always works (arrows = D-pad, Enter = Start,
            Space = Select).
          </p>
        )}
      </section>

      {canPair && !showGuide && !showAdd && (
        <section className="ccs-pair">
          <button
            type="button"
            className={`ccs-pair-button${btn.scanning ? ' ccs-pair-scanning' : ''}`}
            data-phase={pairing?.phase || 'idle'}
            disabled={btn.disabled}
            onClick={handlePairClick}
          >
            {guides.length > 0 && !btn.scanning
              ? <><span aria-hidden="true">🎮</span> Pair controller</>
              : btn.label}
          </button>
          <button type="button" className="ccs-pair-button ccs-add-button" disabled={status.busy} onClick={openAdd}>
            <span aria-hidden="true">➕</span> Add a new device
          </button>
          {btn.scanning && <span className="ccs-pair-progress" aria-hidden="true" />}
          {status.text && !status.busy && (guides.length > 0 || status.text !== btn.label) ? (
            <span className={`ccs-pair-status ccs-tone-${status.tone}`} role="status">{status.text}</span>
          ) : null}
        </section>
      )}

      {showAdd && (
        <section className="ccs-pair-guide ccs-add-guide" aria-label="Add a new device">
          <h4 className="ccs-heading">Add a new Bluetooth device</h4>
          <ol className="ccs-guide-steps">
            {ADD_DEVICE_STEPS.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {panelStatus.text ? (
            <p className={`ccs-pair-status ccs-tone-${panelStatus.tone}`} role="status" data-phase={pairing?.phase}>
              {panelStatus.busy && panelStatus.tone === 'info' && <span className="ccs-pair-progress" aria-hidden="true" />}
              {panelStatus.text}
            </p>
          ) : null}
          <div className="ccs-guide-actions">
            <button
              ref={addStartRef}
              type="button"
              className="ccs-pair-button ccs-guide-start"
              disabled={status.busy}
              onClick={() => requestPair({ controllerId: null, mode: 'add' })}
            >
              {panelStatus.retry ? 'Try again' : 'Start search'}
            </button>
            <button
              type="button"
              className="ccs-guide-close"
              disabled={status.busy}
              onClick={() => {
                setAddOpen(false);
                logger().info('controller-status.add-close', {});
              }}
            >
              {panelStatus.tone === 'ok' ? 'Done' : 'Close'}
            </button>
          </div>
        </section>
      )}

      {showGuide && activeGuide && (
        <section className="ccs-pair-guide" aria-label="Pair a controller">
          {guides.length > 1 && (
            <div className="ccs-guide-choices" role="tablist">
              {guides.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  aria-selected={g.id === activeGuide.id}
                  className={`ccs-guide-choice${g.id === activeGuide.id ? ' ccs-guide-choice-on' : ''}`}
                  disabled={status.busy}
                  onClick={() => setGuideId(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          )}
          <h4 className="ccs-heading">
            Pair {activeGuide.label}{activeGuide.mode ? ` — ${activeGuide.mode}` : ''}
          </h4>
          <ol className="ccs-guide-steps">
            {activeGuide.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {panelStatus.text ? (
            <p className={`ccs-pair-status ccs-tone-${panelStatus.tone}`} role="status" data-phase={pairing?.phase}>
              {panelStatus.busy && panelStatus.tone === 'info' && <span className="ccs-pair-progress" aria-hidden="true" />}
              {panelStatus.text}
            </p>
          ) : null}
          {panelStatus.retry && activeGuide.troubleshoot ? (
            <p className="ccs-guide-troubleshoot">{activeGuide.troubleshoot}</p>
          ) : null}
          <div className="ccs-guide-actions">
            <button
              ref={guideStartRef}
              type="button"
              className="ccs-pair-button ccs-guide-start"
              disabled={status.busy}
              onClick={() => requestPair({ controllerId: activeGuide.id, mode: 'repair' })}
            >
              {panelStatus.retry ? 'Try again' : 'It’s blinking — start pairing'}
            </button>
            <button
              type="button"
              className="ccs-guide-close"
              disabled={status.busy}
              onClick={() => {
                setGuideOpen(false);
                logger().info('controller-status.pair-guide-close', { controllerId: activeGuide.id });
              }}
            >
              {panelStatus.tone === 'ok' ? 'Done' : 'Close'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export default ControllerStatus;
