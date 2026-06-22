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
 * @param {object} props
 * @param {Array<object>} props.controllers  [{ id, label, match, count? }].
 * @param {Function} [props.getGamepads]      injectable for tests.
 */
export function ControllerStatus({ controllers = [], getGamepads }) {
  const { connected, known } = useGamepadStatus(controllers, { getGamepads });

  // label lookup for the "connected now" rows.
  const labelById = useMemo(() => {
    const m = {};
    for (const c of controllers) m[c.id] = c.label ?? c.id;
    return m;
  }, [controllers]);

  const hasConnected = connected.length > 0;

  useEffect(() => {
    logger().debug('controller-status.connected-change', {
      count: connected.length,
      slots: connected.map((p) => p.slot),
      matched: connected.map((p) => p.matchedId),
    });
  }, [connected]);

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
    </div>
  );
}

export default ControllerStatus;
