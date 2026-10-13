const SCREEN_ROUTE = /^\/screen\/[^/]+\/?$/;
const MIN_MATCH_LENGTH = 3;

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Owns the public screen-framework path convention and the fallback for a
 * device with no `screen_path`.
 *
 * Resolution order:
 *   1. the device's configured `screenPath`
 *   2. a fuzzy match of the device id / location against the known screens
 *      (`office-tv` → `/screen/office`, location "Living Room" → `living-room`)
 *   3. the legacy default screen (`living-room`)
 *
 * Only web screens take part in the match: e-ink screens route to an image
 * endpoint (`/api/eink/panel`), which no kiosk can load.
 */
export class ScreenAddressResolver {
  #screens;

  /**
   * @param {Object} [options]
   * @param {string} [options.defaultScreen]
   * @param {Array<{id: string, route?: string}>} [options.screens] - known screens
   */
  constructor({ defaultScreen = 'living-room', screens = [] } = {}) {
    this.defaultScreen = defaultScreen;
    this.#screens = screens
      .map(({ id, route }) => ({ id, path: route || `/screen/${id}` }))
      .filter(({ id, path }) => id && SCREEN_ROUTE.test(path));
  }

  /**
   * Best screen for a device that did not declare one, or null when nothing
   * matches unambiguously. A screen matches when its normalized name is
   * contained in the device id or equals the device location; the longest
   * match wins, and a tie between different screens is no match.
   * @param {{id?: string, location?: string}} device
   * @returns {{path: string, name: string}|null}
   */
  match(device) {
    const deviceId = normalize(device?.id);
    const location = normalize(device?.location);
    let best = null;
    let bestScore = 0;
    let tied = false;
    for (const screen of this.#screens) {
      const name = normalize(screen.id);
      if (name.length < MIN_MATCH_LENGTH) continue;
      const hit = (deviceId && deviceId.includes(name)) || (location && location === name);
      if (!hit) continue;
      if (name.length > bestScore) {
        best = screen; bestScore = name.length; tied = false;
      } else if (name.length === bestScore && screen.path !== best.path) {
        tied = true;
      }
    }
    if (!best || tied) return null;
    return { path: best.path, name: best.path.replace(/^\/screen\//, '').replace(/\/$/, '') };
  }

  /**
   * @returns {{path: string, name: string, source: 'configured'|'fuzzy'|'default'}}
   */
  resolve(device) {
    if (device?.screenPath) {
      return { path: device.screenPath, name: device.screenPath.replace(/^\/screen\//, ''), source: 'configured' };
    }
    const matched = this.match(device);
    if (matched) return { ...matched, source: 'fuzzy' };
    const path = `/screen/${this.defaultScreen}`;
    return { path, name: this.defaultScreen, source: 'default' };
  }
}

export default ScreenAddressResolver;
