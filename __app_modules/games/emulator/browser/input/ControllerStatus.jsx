/**
 * ControllerStatus — panel showing which configured controllers are connected
 * and a live "connected now" list with press-to-identify highlighting.
 *
 * Keyboard always works regardless of controllers, so the empty state reminds
 * the user of the fallback mapping rather than reading as an error.
 *
 * Pairing is GUIDED: the per-controller steps (which buttons, what the LED
 * does) come from each controller's `pairing:` block in input.yml, shown before
 * and during the pairing window, with the window's live lifecycle progress.
 */

import React, { useEffect, useMemo, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { useGamepadStatus } from "./useGamepadStatus.js";
import { pairButtonState } from "./pairButtonState.js";
import { pairingGuides, buildPairTargets, pairingStatus, controllerOsState } from "./pairingGuide.js";
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

/**
 * @param {object} props
 * @param {Array<object>} props.controllers   [{ id, label, match, count?, address?, pairing? }].
 * @param {Function} [props.getGamepads]       injectable for tests.
 * @param {Array<object>} [props.btInventory]  OS-level BlueZ inventory
 *   ([{ address, name, connected, battery, paired?, input? }]) passed in by the
 *   host. Optional — when absent the panel renders browser-only (no OS column).
 *   This component is host-agnostic: it never imports FitnessContext.
 * @param {Function} [props.onPair]            ({ targets, controllerId }) => void | Promise<void>.
 *   When provided, render the pairing affordance.
 * @param {object} [props.pairing]             latest `bt.pair.progress` message.
 * @param {Function} [props.onForget]          (address: string) => void | Promise<void>.
 *   When provided, render a per-controller "Forget" button on rows that have a bond.
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
  const status = pairingStatus(pairing);
  const showGuide = canPair && guides.length > 0 && (guideOpen || status.busy);

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

  const startPairing = (controllerId) => {
    const targets = buildPairTargets(controllers, controllerId || null);
    logger().info('controller-status.pair-start', { controllerId: controllerId || null, targets: targets.length });
    try {
      const r = onPair({ targets, controllerId: controllerId || null });
      if (r && typeof r.catch === 'function') {
        r.catch((err) => logger().warn('controller-status.pair-error', { error: err && err.message }));
      }
    } catch (err) {
      logger().warn('controller-status.pair-error', { error: err && err.message });
    }
  };

  const openGuide = (controllerId) => {
    setGuideId(controllerId || guides[0]?.id || null);
    setGuideOpen(true);
    logger().info('controller-status.pair-guide-open', { controllerId: controllerId || guides[0]?.id || null });
  };

  const handlePairClick = () => {
    logger().info('controller-status.pair-click', {});
    if (guides.length > 0) openGuide(null);
    else startPairing(null);
  };

  const forgetMessage = forgetResult?.address
    ? (forgetResult.success
      ? 'Forgotten. To use it again, put the controller in pairing mode and press Pair controller.'
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

      {canPair && !showGuide && (
        <section className="ccs-pair">
          <button
            type="button"
            className={`ccs-pair-button${btn.scanning ? ' ccs-pair-scanning' : ''}`}
            data-phase={pairing?.phase || 'idle'}
            disabled={btn.disabled}
            onClick={handlePairClick}
          >
            {guides.length > 0 && !btn.scanning ? '🎮 Pair controller' : btn.label}
          </button>
          {btn.scanning && <span className="ccs-pair-progress" aria-hidden="true" />}
          {guides.length > 0 && status.text && !status.busy ? (
            <span className={`ccs-pair-status ccs-tone-${status.tone}`} role="status">{status.text}</span>
          ) : null}
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
          {status.text ? (
            <p className={`ccs-pair-status ccs-tone-${status.tone}`} role="status" data-phase={pairing?.phase}>
              {status.busy && status.tone === 'info' && <span className="ccs-pair-progress" aria-hidden="true" />}
              {status.text}
            </p>
          ) : null}
          {status.retry && activeGuide.troubleshoot ? (
            <p className="ccs-guide-troubleshoot">{activeGuide.troubleshoot}</p>
          ) : null}
          <div className="ccs-guide-actions">
            <button
              type="button"
              className="ccs-pair-button ccs-guide-start"
              disabled={status.busy}
              onClick={() => startPairing(activeGuide.id)}
            >
              {status.retry ? 'Try again' : 'It’s blinking — start pairing'}
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
              {status.tone === 'ok' ? 'Done' : 'Close'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export default ControllerStatus;
