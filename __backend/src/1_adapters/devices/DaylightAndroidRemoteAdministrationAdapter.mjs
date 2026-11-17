import { IDeviceRemoteAdministrationGateway } from '#apps/admin/ports/IDeviceRemoteAdministrationGateway.mjs';
import { DaylightAndroidRestClient } from './DaylightAndroidRestClient.mjs';
import { DeviceRemoteGatewayError } from './DeviceRemoteGatewayError.mjs';

export const DAYLIGHT_ANDROID_PROVIDER = 'daylight-android';

const DEFAULT_PORT = 8780;
/** A page load answers only after the page finishes, up to the device's own 20s. */
const LOAD_TIMEOUT_MS = 30_000;
/** How long `maintenance-enable` leaves the kiosk unlocked before it relocks itself. */
const DEFAULT_MAINTENANCE_MS = 15 * 60_000;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Admin action name → [route, params → body, request options].
 * The names are the ones the Admin console sends for either provider. The
 * screensaver actions are absent on purpose: this app has no screensaver (the
 * piano page owns its own), so they are refused as INVALID_ACTION.
 */
const ACTION_ROUTES = Object.freeze({
  'screen-on': ['/screen', () => ({ on: true })],
  'screen-off': ['/screen', () => ({ on: false })],
  'set-brightness': ['/screen/brightness', ({ level }) => ({ level })],
  'load-start-url': ['/kiosk/load-start', undefined, { timeout: LOAD_TIMEOUT_MS }],
  'load-url': ['/kiosk/load', ({ url }) => ({ url }), { timeout: LOAD_TIMEOUT_MS }],
  refresh: ['/kiosk/reload', undefined, { timeout: LOAD_TIMEOUT_MS }],
  'reset-webview': ['/kiosk/renderer/reset', undefined, { timeout: LOAD_TIMEOUT_MS }],
  foreground: ['/kiosk/foreground'],
  'restart-app': ['/kiosk/restart'],
  'kiosk-lock': ['/lockdown/lock'],
  'kiosk-unlock': ['/lockdown/unlock'],
  // Maintenance mode is an unlock that relocks itself; there is no second mode.
  'maintenance-enable': ['/lockdown/unlock', (_params, target) => ({ forMs: target.maintenanceMs })],
  'maintenance-disable': ['/lockdown/lock'],
  'overlay-message': ['/kiosk/overlay', ({ text }) => ({ text })],
  'set-volume': ['/volume', ({ level }) => ({ level, stream: 3 })],
  speak: ['/speak', ({ text, locale }) => ({ text, ...(locale ? { locale } : {}) })],
  'launch-app': ['/launch', ({ package: packageName }) => ({ package: packageName })],
  reboot: ['/device/reboot'],
});

/** Admin actions this app has no equivalent for; the console hides them. */
const UNSUPPORTED_ACTIONS = Object.freeze(['screensaver-start', 'screensaver-stop']);

/**
 * The app's setting types are exactly STRING, BOOLEAN and INTEGER. They are
 * read case-insensitively, and a few aliases are tolerated so a build that
 * spells one differently still gets an editable control.
 */
const SETTING_TYPES = Object.freeze({
  string: 'string',
  boolean: 'boolean', bool: 'boolean',
  integer: 'integer', int: 'integer', long: 'integer',
  number: 'number', float: 'number', double: 'number',
});

/** The device's 409 words, as an operator would say them. */
const CONFLICT_WORDS = Object.freeze({
  no_kiosk_activity: 'the kiosk window is not open',
  not_in_foreground: 'the kiosk is not in front',
  update_in_progress: 'an update is already running',
  not_ready: 'the device is not ready yet',
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(message, code, extra) {
  throw new DeviceRemoteGatewayError(message, code, extra);
}

/**
 * Actions the device carries out by going away: the app restarts, or the
 * device reboots. A connection that drops or times out once the request has
 * gone out is how that looks from here.
 */
const DROPS_CONNECTION = Object.freeze({
  'restart-app': 'Restart sent; the kiosk app dropped the connection as it restarted.',
  reboot: 'Reboot sent; allow about a minute for the device to return.',
});

/**
 * Fleet-aware implementation of the remote administration port for devices
 * running the DaylightStation Android kiosk app.
 *
 * Contract: ops:docs/superpowers/specs/2026-11-16-daylight-android-control-api.md
 */
export class DaylightAndroidRemoteAdministrationAdapter extends IDeviceRemoteAdministrationGateway {
  #readDevices;
  #resolveAuth;
  #httpClient;
  #logger;

  constructor({ readDevices, resolveAuth, httpClient, logger = console } = {}) {
    super();
    if (typeof readDevices !== 'function') throw new Error('DaylightAndroidRemoteAdministrationAdapter requires readDevices');
    if (typeof resolveAuth !== 'function') throw new Error('DaylightAndroidRemoteAdministrationAdapter requires resolveAuth');
    if (!httpClient?.get || !httpClient?.post || !httpClient?.delete) {
      throw new Error('DaylightAndroidRemoteAdministrationAdapter requires httpClient');
    }
    this.#readDevices = readDevices;
    this.#resolveAuth = resolveAuth;
    this.#httpClient = httpClient;
    this.#logger = logger;
  }

  async readStatus(deviceId) {
    const target = this.#target(deviceId);
    // The kiosk route is the status; the other two add the version and model
    // and may be missing from a build without failing the read.
    const [kiosk, core, debug] = await Promise.all([
      target.client.get('/kiosk/status'),
      target.client.get('/status'),
      target.client.get('/debug/info'),
    ]);
    const kioskData = this.#data(kiosk);
    const coreData = core.ok ? core.data : {};
    const debugData = debug.ok ? debug.data : {};
    const { ok: _debugOk, device: hardwareDevice, ...debugRest } = debugData;
    const { ok: _coreOk, ...coreRest } = coreData;
    const { ok: _kioskOk, ...kioskRest } = kioskData;
    const details = sanitizeDetails({
      ...debugRest,
      ...(hardwareDevice !== undefined ? { hardwareDevice } : {}),
      ...coreRest,
      ...kioskRest,
    });
    return {
      provider: DAYLIGHT_ANDROID_PROVIDER,
      device: target.device,
      summary: normalizeSummary(details),
      details,
      companionApps: [],
      unsupportedActions: [...UNSUPPORTED_ACTIONS],
    };
  }

  async captureScreenshot(deviceId) {
    const target = this.#target(deviceId);
    const response = await target.client.get('/debug/screenshot', { binary: true, timeout: 20_000 });
    const buffer = this.#data(response);
    if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length
      || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      fail('Device did not return a PNG screenshot', 'INVALID_RESPONSE');
    }
    return { buffer, contentType: 'image/png', capturedAt: new Date().toISOString() };
  }

  /**
   * @returns {Promise<Object>} key → current value, the shape the Fully
   *   adapter returns, built from the app's list of setting descriptors.
   */
  async readSettings(deviceId) {
    return Object.fromEntries((await this.#settings(deviceId)).map(setting => [setting.key, setting.value]));
  }

  /**
   * The app declares a type for every setting, so the application layer can
   * offer each one for editing and check a value before sending it. Types are
   * normalised to `string`, `boolean`, `integer` and `number`; any other word
   * the app uses is passed through as it is.
   * @returns {Promise<Array<{key: string, type: string, value: *}>>}
   */
  async readTypedSettings(deviceId) {
    return (await this.#settings(deviceId)).map(setting => ({
      key: setting.key,
      type: SETTING_TYPES[String(setting.type).toLowerCase()] ?? String(setting.type),
      value: setting.value,
    }));
  }

  async #settings(deviceId) {
    const target = this.#target(deviceId);
    const data = this.#data(await target.client.get('/settings'));
    if (!Array.isArray(data?.settings)) {
      fail('Device returned invalid settings data', 'INVALID_RESPONSE');
    }
    return data.settings.filter(setting => setting && typeof setting.key === 'string');
  }

  async executeAction(deviceId, action, params = {}) {
    const target = this.#target(deviceId);
    const mapping = Object.hasOwn(ACTION_ROUTES, action) ? ACTION_ROUTES[action] : null;
    if (!mapping) fail('Remote action is not supported', 'INVALID_ACTION');
    const [route, mapParams = () => ({}), options] = mapping;
    const response = await target.client.post(route, mapParams(params || {}, target), options);
    if (Object.hasOwn(DROPS_CONNECTION, action) && !response.ok && !response.neverSent
      && ['TIMEOUT', 'UNREACHABLE'].includes(response.code)) {
      return { accepted: true, message: DROPS_CONNECTION[action] };
    }
    return this.#data(response);
  }

  async writeSetting(deviceId, key, value) {
    const target = this.#target(deviceId);
    return this.#data(await target.client.post('/settings', { key, value }));
  }

  #target(deviceId) {
    if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(deviceId)) {
      fail('Invalid device ID', 'INVALID_DEVICE_ID');
    }
    const devices = this.#readDevices();
    const source = devices && Object.hasOwn(devices, deviceId) ? devices[deviceId] : null;
    if (!source) fail('Device not found', 'DEVICE_NOT_FOUND');
    const content = source.content_control;
    if (content?.provider !== DAYLIGHT_ANDROID_PROVIDER) {
      fail('Device is not configured for DaylightStation Android administration', 'NOT_DAYLIGHT_ANDROID');
    }
    if (!content.host || !content.auth_ref) {
      fail('DaylightStation Android device configuration is incomplete', 'DAYLIGHT_ANDROID_CONFIGURATION_ERROR');
    }
    // The auth file holds one entry per device id: { <deviceId>: { host, token } }.
    const token = this.#resolveAuth(content.auth_ref)?.[deviceId]?.token;
    if (!token) fail('DaylightStation Android token is not configured for this device', 'DAYLIGHT_ANDROID_CONFIGURATION_ERROR');

    const port = content.port || DEFAULT_PORT;
    return {
      client: new DaylightAndroidRestClient({ host: content.host, port, token }, {
        httpClient: this.#httpClient,
        logger: this.#logger,
      }),
      device: {
        id: deviceId,
        name: source.name || source.label || deviceId,
        type: source.type || 'unknown',
        address: `${content.host}:${port}`,
      },
      maintenanceMs: Number.isInteger(content.maintenance_ms) && content.maintenance_ms > 0
        ? content.maintenance_ms
        : DEFAULT_MAINTENANCE_MS,
    };
  }

  #data(response) {
    if (response?.ok) return response.data;
    const code = ({
      TIMEOUT: 'DAYLIGHT_ANDROID_TIMEOUT',
      UNREACHABLE: 'DAYLIGHT_ANDROID_UNREACHABLE',
      AUTH_REJECTED: 'DAYLIGHT_ANDROID_AUTH_REJECTED',
      UNSUPPORTED: 'DAYLIGHT_ANDROID_UNSUPPORTED',
      // The device is in a state where the command cannot run.
      CONFLICT: 'DAYLIGHT_ANDROID_CONFLICT',
      // The device answered; something it depends on failed or took too long.
      DEVICE_DEPENDENCY_FAILED: 'DAYLIGHT_ANDROID_DEPENDENCY_FAILED',
      DEVICE_TIMEOUT: 'DAYLIGHT_ANDROID_DEVICE_TIMEOUT',
      COMMAND_REJECTED: 'DAYLIGHT_ANDROID_COMMAND_REJECTED',
      INVALID_RESPONSE: 'DAYLIGHT_ANDROID_INVALID_RESPONSE',
      // The device answered and its handler failed: a failed command, not an
      // unreachable device.
      HTTP_ERROR: 'DAYLIGHT_ANDROID_COMMAND_REJECTED',
    })[response?.code] || 'DAYLIGHT_ANDROID_COMMAND_REJECTED';
    const message = ({
      DAYLIGHT_ANDROID_TIMEOUT: 'Kiosk app did not respond in time',
      DAYLIGHT_ANDROID_UNREACHABLE: 'Kiosk app is unreachable',
      DAYLIGHT_ANDROID_AUTH_REJECTED: 'Kiosk app rejected the configured token',
      DAYLIGHT_ANDROID_UNSUPPORTED: 'This device cannot do that',
      DAYLIGHT_ANDROID_INVALID_RESPONSE: 'Kiosk app returned an invalid response',
      DAYLIGHT_ANDROID_COMMAND_REJECTED: 'Kiosk app rejected the command',
      DAYLIGHT_ANDROID_CONFLICT: 'The kiosk cannot do that right now',
      DAYLIGHT_ANDROID_DEPENDENCY_FAILED: 'Something the kiosk depends on failed',
      DAYLIGHT_ANDROID_DEVICE_TIMEOUT: 'The kiosk gave up waiting on the page or download',
    })[code];
    // A conflict is shown to the operator as it is (HTTP 409), so it is put
    // in plain words. `deviceCode` is the device's fixed word; a word with no
    // translation is shown as the device gave it, a sentence never is.
    if (code === 'DAYLIGHT_ANDROID_CONFLICT') {
      const why = CONFLICT_WORDS[response?.deviceCode] ?? response?.deviceCode;
      fail(why ? `${message}: ${why}` : message, code);
    }
    // `reason` and `deviceCode` are the device's own short words
    // ("device owner required", "not_installed"); they hold no credentials
    // and no page data. The reason of an unsupported action also rides on the
    // error, so the API layer can tell the operator why the device cannot do it.
    const reason = typeof response?.reason === 'string' && !response.reason.includes('://') ? response.reason : null;
    const detail = reason || response?.deviceCode;
    fail(
      detail ? `${message}: ${detail}` : message,
      code,
      code === 'DAYLIGHT_ANDROID_UNSUPPORTED' && response?.reason ? { reason: response.reason } : undefined,
    );
  }
}

function first(source, ...keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return null;
}

const megabytes = value => (typeof value === 'number' && Number.isFinite(value) ? value * BYTES_PER_MB : null);

/**
 * The summary keys are the ones the Admin console reads for a Fully device.
 * A field this app does not report is null. Memory is reported in megabytes
 * and converted, since the console formats those two fields as bytes.
 */
function normalizeSummary(data) {
  return {
    deviceName: first(data, 'device'),
    manufacturer: first(data, 'manufacturer'),
    model: first(data, 'model'),
    androidVersion: first(data, 'androidVersion'),
    appVersion: first(data, 'appVersion', 'payloadVersion'),
    licensed: null,
    currentUrl: first(data, 'currentUrl'),
    startUrl: first(data, 'startUrl'),
    screenOn: first(data, 'screenOn'),
    screenLocked: null,
    brightness: first(data, 'screenBrightness'),
    orientation: null,
    resolution: null,
    batteryLevel: first(data, 'batteryLevel'),
    batteryTemperature: null,
    plugged: first(data, 'plugged'),
    ssid: first(data, 'wifiSsid'),
    ipAddress: null,
    wifiSignal: first(data, 'wifiSignalLevel'),
    ramFree: megabytes(data.ramFreeMb),
    ramTotal: megabytes(data.ramTotalMb),
    storageFree: null,
    storageTotal: null,
    kioskLocked: first(data, 'locked'),
    kioskMode: null,
    maintenanceMode: null,
    screensaver: null,
    foregroundPackage: first(data, 'foreground'),
  };
}

/** Blank credential-like fields at every depth: `/status` nests objects (`payload{}`). */
function sanitizeDetails(value) {
  if (Array.isArray(value)) return value.map(sanitizeDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [
    key,
    /(password|secret|token|credential)/i.test(key) ? null : sanitizeDetails(inner),
  ]));
}

export default DaylightAndroidRemoteAdministrationAdapter;
