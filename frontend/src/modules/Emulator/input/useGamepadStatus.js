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
 * Look up OS-level (BlueZ) truth for a controller config in the BT inventory.
 * Match by MAC address, case-insensitive.
 *
 * @param {object} config                       controller config entry.
 * @param {Array<object>|null|undefined} btInventory  [{ address, name, connected, battery }].
 * @returns {{ connected: boolean, battery: number|null }|null}
 *   null when: no `address` on the config, no btInventory feed at all, or the
 *   address is configured but not present in the feed → caller distinguishes
 *   "no feed" (null) from "present but off" below.
 */
function lookupOsStatus(config, btInventory) {
  // No feed at all → caller renders browser-only (no OS column).
  if (!Array.isArray(btInventory)) return null;
  // No MAC on this controller config → nothing to match.
  if (!config.address) return null;
  const want = String(config.address).toLowerCase();
  const hit = btInventory.find(
    (d) => d && typeof d.address === 'string' && d.address.toLowerCase() === want,
  );
  if (!hit) {
    // Address configured but not in the feed → OS reports it as off.
    return { connected: false, battery: null };
  }
  return {
    connected: !!hit.connected,
    battery: Number.isFinite(hit.battery) ? hit.battery : null,
  };
}

/**
 * Build the `known` controller rows, merging browser-slot matches with the
 * optional OS-level BT inventory (matched by MAC `address`).
 *
 * @param {Array<object>} controllersConfig    [{ id, label, match, count?, address? }].
 * @param {Array<object>} connected            output rows from computeStatus.
 * @param {Array<object>|null} [btInventory]    [{ address, name, connected, battery }].
 * @returns {object[]}
 */
export function mergeKnown(controllersConfig, connected, btInventory) {
  const list = Array.isArray(controllersConfig) ? controllersConfig : [];
  const conn = Array.isArray(connected) ? connected : [];
  return list.map((config) => {
    const connectedCount = conn.filter((c) => c.matchedId === config.id).length;
    return {
      id: config.id,
      label: config.label ?? config.id,
      address: config.address ?? null,
      count: Number.isFinite(config.count) ? config.count : 1,
      connectedCount,
      connected: connectedCount > 0,
      os: lookupOsStatus(config, btInventory),
    };
  });
}

/**
 * Pure status computation from a gamepads snapshot.
 *
 * @param {Array<Gamepad|null>} gamepads      raw getGamepads() result.
 * @param {Array<object>} controllersConfig   [{ id, label, match, count?, address? }].
 * @param {object} [opts]
 * @param {Array<object>} [opts.btInventory]  optional OS-level BT inventory feed
 *   ([{ address, name, connected, battery }]); merged into `known` by MAC.
 * @returns {{ connected: object[], known: object[] }}
 */
export function computeStatus(gamepads, controllersConfig, { btInventory } = {}) {
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

  const known = mergeKnown(controllersConfig, connected, btInventory);

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
 * @param {Array<object>} [opts.btInventory] - optional OS-level BT inventory
 *   ([{ address, name, connected, battery }]); merged into `known` by MAC.
 * @returns {{ connected: object[], known: object[] }}
 */
export function useGamepadStatus(controllersConfig, { getGamepads, pollMs = 500, btInventory } = {}) {
  const [status, setStatus] = useState(EMPTY_STATUS);

  // Keep the latest btInventory in a ref so poll refreshes pick it up without
  // re-subscribing the gamepad listeners on every feed update.
  const btRef = useRef(btInventory);
  btRef.current = btInventory;

  // Stable reader: navigator.getGamepads if not injected.
  const readPads =
    getGamepads || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));

  useEffect(() => {
    let mounted = true;

    const refresh = () => {
      if (!mounted) return;
      const next = computeStatus(readPads(), controllersConfig, { btInventory: btRef.current });
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

  // Recompute promptly when the BT inventory feed changes (rather than waiting
  // for the next poll tick), so the OS column reflects fresh OS-level truth.
  useEffect(() => {
    setStatus(computeStatus(readPads(), controllersConfig, { btInventory }));
    // readPads/controllersConfig captured; btInventory identity is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btInventory]);

  return status;
}
