/**
 * controllerStatus — pure derivation of KNOWN-controller connection state from
 * the BlueZ `bt_inventory` feed, plus a connect/disconnect diff for toasts.
 *
 * This is the realtime OS-level truth (BlueZ reports connect/disconnect within
 * ~3s regardless of a browser button press), so it drives the connect/disconnect
 * toasts. Matching mirrors useGamepadStatus: by MAC `address` (preferred), else
 * by the controller's `match` name regex for a currently-connected device.
 */

/**
 * Connection state for each KNOWN controller, derived from the inventory.
 * - A controller with an `address` is always tracked (connected reflects the
 *   feed; absent address in the feed → disconnected).
 * - A controller without an `address` is tracked only while a connected device
 *   matches its `match` name regex (so generic fallbacks don't clutter).
 * Unknown connected devices (speakers, TVs) are ignored.
 *
 * @param {Array<{address,name,connected,battery}>|null|undefined} btInventory
 * @param {Array<{id,label,address?,match?}>} controllers
 * @returns {Array<{ key: string, label: string, connected: boolean, battery: number|null }>}
 */
export function knownControllerStates(btInventory, controllers = []) {
  const devices = Array.isArray(btInventory) ? btInventory : [];
  const out = [];
  const seen = new Set();

  for (const c of controllers || []) {
    let dev = null;
    if (c?.address) {
      const want = String(c.address).toLowerCase();
      dev = devices.find((d) => d && typeof d.address === 'string' && d.address.toLowerCase() === want) || null;
    }
    if (!dev && c?.match) {
      let re = null;
      try { re = new RegExp(c.match, 'i'); } catch { re = null; }
      if (re) dev = devices.find((d) => d && d.connected && re.test(d.name || '')) || null;
    }

    const hasAddress = !!c?.address;
    const connected = !!(dev && dev.connected);
    if (!hasAddress && !connected) continue; // address-less + absent → not a tracked device

    const key = String(c?.address || dev?.address || c?.id || c?.label || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    out.push({
      key,
      label: c?.label || dev?.name || c?.id || 'Controller',
      connected,
      battery: Number.isFinite(dev?.battery) ? dev.battery : null,
    });
  }

  return out;
}

/**
 * Diff two knownControllerStates lists into connect/disconnect deltas (by key).
 * A newly-known controller is reported only when it appears already connected
 * (so an initial disconnected baseline never toasts).
 *
 * @param {Array} prev
 * @param {Array} next
 * @returns {{ connected: Array, disconnected: Array }}
 */
export function diffControllerConnections(prev = [], next = []) {
  const prevMap = new Map((prev || []).map((s) => [s.key, s]));
  const connected = [];
  const disconnected = [];
  for (const s of next || []) {
    const before = prevMap.get(s.key);
    if (!before) {
      if (s.connected) connected.push(s);
    } else if (s.connected && !before.connected) {
      connected.push(s);
    } else if (!s.connected && before.connected) {
      disconnected.push(s);
    }
  }
  return { connected, disconnected };
}

export default { knownControllerStates, diffControllerConnections };
