/**
 * useGamepadStatus — observe connected gamepads and map them to known
 * controller configs (model match + slot identification + press-to-identify).
 *
 * The Gamepad API is poll-based (`navigator.getGamepads()` returns a live
 * snapshot each call) and also emits `gamepadconnected`/`gamepaddisconnected`.
 * We do both: an interval poll (to catch button activity for press-to-identify
 * and any pads that connected before listeners attached) plus the events (for
 * instant connect/disconnect reaction).
 *
 * The matching/aggregation core is the pure `computeStatus()` helper so it can
 * be unit-tested without fighting React timers; the hook is a thin wrapper.
 */

import { useEffect, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'emulator-gamepad-status' });
  return _logger;
}

const AXIS_DEADZONE = 0.5;

function buildMatchers(controllersConfig) {
  const list = Array.isArray(controllersConfig) ? controllersConfig : [];
  return list.map((c) => {
    let re = null;
    try {
      re = c.match ? new RegExp(c.match, 'i') : null;
    } catch {
      re = null;
    }
    return { config: c, re };
  });
}

/**
 * Detect whether a pad shows any input this poll: any pressed button OR any
 * axis beyond the deadzone. Used for press-to-identify highlighting.
 */
function isPadActive(gp) {
  if (!gp) return false;
  for (const b of gp.buttons || []) {
    if (b && b.pressed) return true;
  }
  for (const a of gp.axes || []) {
    if (Math.abs(a) > AXIS_DEADZONE) return true;
  }
  return false;
}

/**
 * Pure status computation from a gamepads snapshot.
 *
 * @param {Array<Gamepad|null>} gamepads      raw getGamepads() result.
 * @param {Array<object>} controllersConfig   [{ id, label, match, count? }].
 * @param {object} _prev                       reserved (prev-poll state); active
 *   detection is per-poll from current buttons/axes, so prev is not required.
 * @returns {{ connected: object[], known: object[] }}
 */
export function computeStatus(gamepads, controllersConfig, _prev = {}) {
  const matchers = buildMatchers(controllersConfig);
  const live = Array.from(gamepads || []).filter((gp) => gp != null);

  const connected = live.map((gp) => {
    const matched = matchers.find((m) => m.re && m.re.test(gp.id));
    return {
      slot: gp.index,
      id: gp.id,
      matchedId: matched ? matched.config.id : null,
      active: isPadActive(gp),
    };
  });

  const known = matchers.map(({ config }) => {
    const connectedCount = connected.filter((c) => c.matchedId === config.id).length;
    return {
      id: config.id,
      label: config.label ?? config.id,
      count: Number.isFinite(config.count) ? config.count : 1,
      connectedCount,
      connected: connectedCount > 0,
    };
  });

  return { connected, known };
}

const EMPTY_STATUS = { connected: [], known: [] };

/**
 * React hook wrapping computeStatus over a polled + event-driven gamepad source.
 *
 * @param {Array<object>} controllersConfig
 * @param {object} [opts]
 * @param {Function} [opts.getGamepads] - injectable; defaults to navigator.getGamepads.
 * @param {number}   [opts.pollMs=500]
 * @returns {{ connected: object[], known: object[] }}
 */
export function useGamepadStatus(controllersConfig, { getGamepads, pollMs = 500 } = {}) {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const prevRef = useRef({});

  // Stable reader: navigator.getGamepads if not injected.
  const readPads =
    getGamepads || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));

  useEffect(() => {
    let mounted = true;

    const refresh = () => {
      if (!mounted) return;
      const next = computeStatus(readPads(), controllersConfig, prevRef.current);
      prevRef.current = next;
      setStatus(next);
    };

    // Immediate first read so the panel reflects already-connected pads.
    refresh();

    const onConnect = (e) => {
      logger().info('gamepad.connected', { slot: e?.gamepad?.index, id: e?.gamepad?.id });
      refresh();
    };
    const onDisconnect = (e) => {
      logger().info('gamepad.disconnected', { slot: e?.gamepad?.index, id: e?.gamepad?.id });
      refresh();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', onConnect);
      window.addEventListener('gamepaddisconnected', onDisconnect);
    }

    const timer = setInterval(refresh, pollMs);

    return () => {
      mounted = false;
      clearInterval(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('gamepadconnected', onConnect);
        window.removeEventListener('gamepaddisconnected', onDisconnect);
      }
    };
    // controllersConfig identity drives re-subscribe; readPads/pollMs captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controllersConfig, pollMs]);

  return status;
}
