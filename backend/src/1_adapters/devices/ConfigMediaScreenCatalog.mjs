/**
 * ConfigMediaScreenCatalog — the screens devices.yml declares, as the screen
 * registry sees them (`fleet:<key>`, name, room, type).
 *
 * A device is a media screen when it can be sent content: it has
 * `content_control`, a `fleet` lane, a `plex` client identity, or a playback
 * device type. Cameras, scanners, relays, printers and MIDI gear are not.
 * `wakeable` = it has `device_control` (power), so a routine can turn it on.
 *
 * devices.yml stays read-only here: names and rooms changed in the app are
 * overrides in the registry (YamlScreenRegistryDatastore).
 */
const PLAYBACK_TYPES = new Set(['shield-tv', 'linux-pc', 'android-tablet', 'speaker', 'smart-tv', 'chromecast', 'kiosk']);

export class ConfigMediaScreenCatalog {
  #config;

  /** @param {{configService: {getHouseholdDevices: Function}}} deps */
  constructor({ configService }) {
    this.#config = configService;
  }

  /**
   * @param {string} [householdId]
   * @returns {Array<{id:string, screenId:string, name:string, room:string|null, type:string|null, wakeable:boolean}>}
   */
  list(householdId) {
    const devices = this.#config?.getHouseholdDevices?.(householdId)?.devices;
    if (!devices || typeof devices !== 'object') return [];
    const out = [];
    for (const [key, device] of Object.entries(devices)) {
      if (!device || typeof device !== 'object') continue;
      const media = device.content_control || device.fleet || device.plex || PLAYBACK_TYPES.has(device.type);
      if (!media) continue;
      out.push({
        id: `fleet:${key}`,
        screenId: key,
        name: typeof device.name === 'string' && device.name.trim() ? device.name.trim() : key,
        room: typeof device.location === 'string' && device.location.trim() ? device.location.trim() : null,
        type: device.type ?? null,
        wakeable: Boolean(device.device_control),
      });
    }
    return out;
  }
}

export default ConfigMediaScreenCatalog;
