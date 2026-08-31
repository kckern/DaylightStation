import { IDeviceRemoteAdministrationGateway } from '#apps/admin/ports/IDeviceRemoteAdministrationGateway.mjs';
import { FullyKioskRestClient } from './FullyKioskRestClient.mjs';

const ACTION_COMMANDS = Object.freeze({
  'screen-on': ['screenOn'],
  'screen-off': ['screenOff'],
  'set-brightness': ['setScreenBrightness', ({ level }) => ({ level })],
  'load-start-url': ['loadStartUrl'],
  'load-url': ['loadUrl', ({ url }) => ({ url })],
  refresh: ['refreshTab'],
  'reset-webview': ['resetWebview'],
  foreground: ['toForeground'],
  'restart-app': ['restartApp'],
  'screensaver-start': ['startScreensaver'],
  'screensaver-stop': ['stopScreensaver'],
  'kiosk-lock': ['lockKiosk'],
  'kiosk-unlock': ['unlockKiosk'],
  'maintenance-enable': ['enableLockedMode'],
  'maintenance-disable': ['disableLockedMode'],
  'overlay-message': ['setOverlayMessage', ({ text }) => ({ text })],
  'set-volume': ['setAudioVolume', ({ level }) => ({ level, stream: 3 })],
  speak: ['textToSpeech', ({ text, locale }) => ({ text, ...(locale ? { locale } : {}) })],
  'launch-app': ['startApplication', ({ package: packageName }) => ({ package: packageName })],
  reboot: ['rebootDevice'],
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class DeviceRemoteGatewayError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DeviceRemoteGatewayError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new DeviceRemoteGatewayError(message, code);
}

/**
 * Fleet-aware Fully Kiosk implementation of the remote administration port.
 */
export class FullyKioskRemoteAdministrationAdapter extends IDeviceRemoteAdministrationGateway {
  #readDevices;
  #resolveAuth;
  #httpClient;
  #logger;

  constructor({ readDevices, resolveAuth, httpClient, logger = console } = {}) {
    super();
    if (typeof readDevices !== 'function') throw new Error('FullyKioskRemoteAdministrationAdapter requires readDevices');
    if (typeof resolveAuth !== 'function') throw new Error('FullyKioskRemoteAdministrationAdapter requires resolveAuth');
    if (!httpClient?.get) throw new Error('FullyKioskRemoteAdministrationAdapter requires httpClient');
    this.#readDevices = readDevices;
    this.#resolveAuth = resolveAuth;
    this.#httpClient = httpClient;
    this.#logger = logger;
  }

  async readStatus(deviceId) {
    const target = this.#target(deviceId);
    const response = await target.client.command('getDeviceInfo');
    const rawDetails = this.#data(response);
    if (!rawDetails || typeof rawDetails !== 'object' || Array.isArray(rawDetails)) {
      fail('Device returned invalid status data', 'INVALID_RESPONSE');
    }
    const details = sanitizeDetails(rawDetails);
    return {
      device: target.device,
      summary: normalizeSummary(details),
      details,
      companionApps: target.companionApps,
    };
  }

  async captureScreenshot(deviceId) {
    const target = this.#target(deviceId);
    const response = await target.client.command(
      'getScreenshot',
      { format: 'png' },
      { json: false, binary: true, timeout: 20_000 },
    );
    const buffer = this.#data(response);
    if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length
      || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      fail('Device did not return a PNG screenshot', 'INVALID_RESPONSE');
    }
    return { buffer, contentType: 'image/png', capturedAt: new Date().toISOString() };
  }

  async readSettings(deviceId) {
    const target = this.#target(deviceId);
    const settings = this.#data(await target.client.command('listSettings'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      fail('Device returned invalid settings data', 'INVALID_RESPONSE');
    }
    return settings;
  }

  async executeAction(deviceId, action, params = {}) {
    const target = this.#target(deviceId);
    const mapping = ACTION_COMMANDS[action];
    if (!mapping) fail('Remote action is not supported', 'INVALID_ACTION');
    const [command, mapParams = () => ({})] = mapping;
    const response = await target.client.command(command, mapParams(params));

    // Fully usually closes the socket while rebooting. Once the request has
    // been dispatched, that expected disconnect is the closest thing to an ACK.
    if (action === 'reboot' && !response.ok && ['TIMEOUT', 'UNREACHABLE'].includes(response.code)) {
      return { accepted: true, message: 'Reboot sent; allow about a minute for the device to return.' };
    }
    return this.#data(response);
  }

  async writeSetting(deviceId, key, value) {
    const target = this.#target(deviceId);
    const command = typeof value === 'boolean' ? 'setBooleanSetting' : 'setStringSetting';
    const response = await target.client.command(command, { key, value });
    return this.#data(response);
  }

  #target(deviceId) {
    if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(deviceId)) {
      fail('Invalid device ID', 'INVALID_DEVICE_ID');
    }
    const source = this.#readDevices()?.[deviceId];
    if (!source) fail('Device not found', 'DEVICE_NOT_FOUND');
    const content = source.content_control;
    if (content?.provider !== 'fully-kiosk') {
      fail('Device is not configured for Fully Kiosk administration', 'NOT_FULLY_KIOSK');
    }
    if (!content.host || !content.auth_ref) {
      fail('Fully Kiosk device configuration is incomplete', 'FKB_CONFIGURATION_ERROR');
    }
    const auth = this.#resolveAuth(content.auth_ref);
    if (!auth?.password) fail('Fully Kiosk credentials are not configured', 'FKB_CONFIGURATION_ERROR');

    return {
      client: new FullyKioskRestClient({
        host: content.host,
        port: content.port || 2323,
        password: auth.password,
      }, {
        httpClient: this.#httpClient,
        logger: this.#logger,
      }),
      device: {
        id: deviceId,
        name: source.name || source.label || deviceId,
        type: source.type || 'unknown',
        address: `${content.host}:${content.port || 2323}`,
      },
      companionApps: Array.isArray(content.companion_apps) ? content.companion_apps : [],
    };
  }

  #data(response) {
    if (response?.ok) return response.data;
    const code = ({
      TIMEOUT: 'FKB_TIMEOUT',
      UNREACHABLE: 'FKB_UNREACHABLE',
      AUTH_REJECTED: 'FKB_AUTH_REJECTED',
      COMMAND_REJECTED: 'FKB_COMMAND_REJECTED',
      INVALID_RESPONSE: 'FKB_INVALID_RESPONSE',
      HTTP_ERROR: 'FKB_UNREACHABLE',
    })[response?.code] || response?.code || 'FKB_COMMAND_REJECTED';
    const message = ({
      FKB_TIMEOUT: 'Fully Kiosk device did not respond in time',
      FKB_UNREACHABLE: 'Fully Kiosk device is unreachable',
      FKB_AUTH_REJECTED: 'Fully Kiosk rejected the configured credentials',
      FKB_INVALID_RESPONSE: 'Fully Kiosk returned an invalid response',
      FKB_COMMAND_REJECTED: 'Fully Kiosk rejected the command',
    })[code] || 'Fully Kiosk command failed';
    fail(message, code);
  }
}

function first(source, ...keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return null;
}

function normalizeSummary(data) {
  const width = first(data, 'displayWidthPixels', 'displayWidth');
  const height = first(data, 'displayHeightPixels', 'displayHeight');
  return {
    deviceName: first(data, 'deviceName'),
    manufacturer: first(data, 'manufacturer'),
    model: first(data, 'model', 'deviceModel'),
    androidVersion: first(data, 'androidVersion'),
    appVersion: first(data, 'version', 'appVersion'),
    licensed: first(data, 'isLicensed'),
    currentUrl: first(data, 'currentPageUrl', 'currentUrl'),
    startUrl: first(data, 'startUrl', 'startURL'),
    screenOn: first(data, 'screenOn', 'isScreenOn'),
    screenLocked: first(data, 'screenLocked'),
    brightness: first(data, 'screenBrightness'),
    orientation: first(data, 'screenOrientation'),
    resolution: width && height ? `${width} × ${height}` : null,
    batteryLevel: first(data, 'batteryLevel'),
    batteryTemperature: first(data, 'batteryTemperature'),
    plugged: first(data, 'isPlugged', 'plugged'),
    ssid: first(data, 'SSID', 'ssid'),
    ipAddress: first(data, 'ip4', 'ipAddress'),
    wifiSignal: first(data, 'wifiSignalLevel'),
    ramFree: first(data, 'ramFreeMemory'),
    ramTotal: first(data, 'ramTotalMemory'),
    storageFree: first(data, 'internalStorageFreeSpace', 'storageFreeSpace'),
    storageTotal: first(data, 'internalStorageTotalSpace', 'storageTotalSpace'),
    kioskLocked: first(data, 'kioskLocked'),
    kioskMode: first(data, 'kioskMode'),
    maintenanceMode: first(data, 'maintenanceMode'),
    screensaver: first(data, 'isInScreensaver'),
    foregroundPackage: first(data, 'foreground', 'packageName', 'topFragmentTag'),
  };
}

function sanitizeDetails(details) {
  const exactSensitive = new Set(['wifiKey', 'sebConfigKey', 'sebExamKey', 'volumeLicenseKey']);
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [
    key,
    exactSensitive.has(key) || /(password|secret|token|credential)/i.test(key) ? null : value,
  ]));
}

export default FullyKioskRemoteAdministrationAdapter;
