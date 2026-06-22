/**
 * ControllerStatus — panel showing which configured controllers are connected
 * and a live "connected now" list with press-to-identify highlighting.
 *
 * Keyboard always works regardless of controllers, so the empty state reminds
 * the user of the fallback mapping rather than reading as an error.
 */

import React, { useEffect, useMemo } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { useGamepadStatus } from './useGamepadStatus.js';
import './ControllerStatus.scss';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'emulator-controller-status' });
  return _logger;
}

/**
 * Translate a pairing-progress status into the button's display/disabled state.
 *
 * Pure helper so it can be reasoned about (and tested) without rendering.
 *
 * @param {{ phase?: string, device?: object, message?: string, paired?: Array }|null|undefined} pairing
 * @returns {{ label: string, disabled: boolean, scanning: boolean }}
 */
export function pairButtonState(pairing) {
  const phase = pairing && pairing.phase;
  switch (phase) {
    case 'scanning':
      return { label: 'Scanning for controllers… (~30s)', disabled: true, scanning: true };
    case 'paired': {
      const name = pairing?.device?.name;
      return { label: name ? `Paired: ${name}` : 'Paired', disabled: true, scanning: false };
    }
    case 'done': {
      const n = Array.isArray(pairing?.paired) ? pairing.paired.length : 0;
      return {
        label: n > 0 ? `Done — ${n} paired` : 'Done',
        disabled: false,
        scanning: false,
      };
    }
    case 'error':
      return {
        label: `Pairing failed — ${pairing?.message || 'unknown error'}`,
        disabled: false,
        scanning: false,
      };
    default:
      return { label: '🎮 Pair controller', disabled: false, scanning: false };
  }
}

/**
 * @param {object} props
 * @param {Array<object>} props.controllers   [{ id, label, match, count?, address? }].
 * @param {Function} [props.getGamepads]       injectable for tests.
 * @param {Array<object>} [props.btInventory]  OS-level BlueZ inventory
 *   ([{ address, name, connected, battery }]) passed in by the host. Optional —
 *   when absent the panel renders browser-only (no OS column). This component is
 *   host-agnostic: it never imports FitnessContext; the feed arrives as a prop.
 * @param {Function} [props.onPair]            () => void | Promise<void>. When
 *   provided, render a "Pair controller" button that calls this on click.
 * @param {{ phase?: string, device?: object, message?: string, paired?: Array }} [props.pairing]
 *   optional live pairing status driving the button's label/disabled state.
 */
export function ControllerStatus({ controllers = [], getGamepads, btInventory, onPair, pairing }) {
  const { connected, known } = useGamepadStatus(controllers, { getGamepads, btInventory });

  // Show the OS column only when a BT inventory feed is actually present.
  const hasBtFeed = Array.isArray(btInventory);

  // label lookup for the "connected now" rows.
  const labelById = useMemo(() => {
    const m = {};
    for (const c of controllers) m[c.id] = c.label ?? c.id;
    return m;
  }, [controllers]);

  const hasConnected = connected.length > 0;

  const canPair = typeof onPair === 'function';
  const btn = pairButtonState(pairing);

  useEffect(() => {
    logger().debug('controller-status.connected-change', {
      count: connected.length,
      slots: connected.map((p) => p.slot),
      matched: connected.map((p) => p.matchedId),
    });
  }, [connected]);

  const handlePairClick = () => {
    logger().info('controller-status.pair-click', {});
    try {
      const r = onPair();
      if (r && typeof r.catch === 'function') {
        r.catch((err) =>
          logger().warn('controller-status.pair-error', { error: err && err.message }),
        );
      }
    } catch (err) {
      logger().warn('controller-status.pair-error', { error: err && err.message });
    }
  };

  return (
    <div className="emulator-controller-status" data-connected={hasConnected ? '1' : '0'}>
      <section className="ccs-known">
        <h4 className="ccs-heading">Known controllers</h4>
        <ul className="ccs-known-list">
          {known.map((k) => (
            <li
              key={k.id}
              className={`ccs-known-row${k.connected ? ' ccs-on' : ''}`}
              data-controller-id={k.id}
            >
              <span className="ccs-label">{k.label}</span>
              <span className={`ccs-badge${k.connected ? ' ccs-badge-on' : ''}`}>
                {k.connectedCount} of {k.count} connected
              </span>
              {hasBtFeed && k.os ? (
                <span className={`ccs-os-badge${k.os.connected ? ' ccs-os-on' : ' ccs-os-off'}`}>
                  {k.os.connected
                    ? `BT: connected${k.os.battery != null ? ` · ${k.os.battery}%` : ''}`
                    : 'BT: off'}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
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

      {canPair && (
        <section className="ccs-pair">
          <button
            type="button"
            className={`ccs-pair-button${btn.scanning ? ' ccs-pair-scanning' : ''}`}
            data-phase={pairing?.phase || 'idle'}
            disabled={btn.disabled}
            onClick={handlePairClick}
          >
            {btn.label}
          </button>
          {btn.scanning && <span className="ccs-pair-progress" aria-hidden="true" />}
        </section>
      )}
    </div>
  );
}

export default ControllerStatus;
