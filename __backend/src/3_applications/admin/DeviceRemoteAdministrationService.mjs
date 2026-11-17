import {
  InvalidInputError,
} from '#apps/common/errors/SemanticErrors.mjs';

const NO_PARAMS = Object.freeze({});
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const LOCALE_RE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z]{2})?$/;

function onlyParams(params, allowed, normalize = () => NO_PARAMS) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw invalid('action parameters must be an object', 'params');
  }
  const unexpected = Object.keys(params).find(key => !allowed.includes(key));
  if (unexpected) throw invalid(`Unexpected action parameter: ${unexpected}`, unexpected);
  return normalize(params);
}

const noParams = params => onlyParams(params, []);

const ACTIONS = Object.freeze({
  'screen-on': noParams,
  'screen-off': noParams,
  'set-brightness': params => onlyParams(params, ['level'], value => ({
    level: integer(value.level, 'level', 0, 255),
  })),
  'load-start-url': noParams,
  'load-url': params => onlyParams(params, ['url'], value => ({ url: webUrl(value.url, 'url') })),
  refresh: noParams,
  'reset-webview': noParams,
  foreground: noParams,
  'restart-app': noParams,
  'screensaver-start': noParams,
  'screensaver-stop': noParams,
  'kiosk-lock': noParams,
  'kiosk-unlock': noParams,
  'maintenance-enable': noParams,
  'maintenance-disable': noParams,
  'overlay-message': params => onlyParams(params, ['text'], value => ({
    text: limitedText(value.text, 'text', { allowEmpty: true }),
  })),
  'set-volume': params => onlyParams(params, ['level'], value => ({
    level: integer(value.level, 'level', 0, 100),
  })),
  speak: params => onlyParams(params, ['text', 'locale'], value => {
    const normalized = { text: limitedText(value.text, 'text') };
    if (value.locale !== undefined && value.locale !== '') {
      if (typeof value.locale !== 'string' || !LOCALE_RE.test(value.locale)) {
        throw invalid('locale must look like en or en-US', 'locale');
      }
      normalized.locale = value.locale.replace('_', '-');
    }
    return normalized;
  }),
  'launch-app': params => onlyParams(params, ['package'], value => {
    const packageName = limitedText(value.package, 'package', { max: 255 });
    if (!PACKAGE_RE.test(packageName)) {
      throw invalid('package must be a valid Android package name', 'package');
    }
    return { package: packageName };
  }),
  reboot: noParams,
});

const BOOLEAN_SETTINGS = [
  'keepScreenOn',
  'preventSleepWhileScreenOff',
  'setWifiWakelock',
  'reloadOnWifiOn',
  'reloadOnInternet',
  'waitInternetOnReload',
  'restartOnCrash',
  'reloadOnScreenOn',
  'reloadOnScreensaverStop',
  'skipReloadIfStartUrlShowing',
  'autoplayAudio',
  'autoplayVideos',
  'enableFullscreenVideos',
  'enableZoom',
];

const DURATION_SETTINGS = [
  'reloadPageFailure',
  'reloadOnIdle',
  'reloadEachSeconds',
  'timeToRestartUnresponsiveWebview',
  'screensaverTimeout',
];

const SETTING_SCHEMAS = Object.freeze({
  startURL: {
    type: 'url',
    normalize: value => webUrl(value, 'value'),
  },
  screenBrightness: {
    type: 'number',
    normalize: value => blankOrInteger(value, 'value', 0, 255),
  },
  screensaverBrightness: {
    type: 'number',
    normalize: value => blankOrInteger(value, 'value', 0, 255),
  },
  screensaverWallpaperURL: {
    type: 'url',
    normalize: value => wallpaperUrl(value),
  },
  ...Object.fromEntries(BOOLEAN_SETTINGS.map(key => [key, {
    type: 'boolean',
    normalize: value => boolean(value, 'value'),
  }])),
  ...Object.fromEntries(DURATION_SETTINGS.map(key => [key, {
    type: 'number',
    normalize: value => integer(value, 'value', 0, 86_400),
  }])),
});

/**
 * Value checks for a setting whose type the device declares. They only make
 * the value the declared type; what the value means is the device's to judge.
 */
const TYPED_SETTING_NORMALIZERS = Object.freeze({
  boolean: value => boolean(value, 'value'),
  number: (value) => {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) throw invalid('value must be a number', 'value');
    return number;
  },
  // No range: what a sensible value is belongs to the device, which rejects
  // one it does not accept.
  integer: (value) => {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (!Number.isInteger(number)) throw invalid('value must be a whole number', 'value');
    return number;
  },
  string: value => limitedText(value, 'value', { allowEmpty: true, max: 2048 }),
});

/** The console has one numeric control; an integer setting is shown as a number. */
const consoleType = type => (type === 'integer' ? 'number' : type);

const SENSITIVE_SETTING_KEYS = new Set([
  'wifiKey',
  'sebConfigKey',
  'sebExamKey',
  'volumeLicenseKey',
]);

function invalid(message, field) {
  return new InvalidInputError(message, { code: 'INVALID_REMOTE_DEVICE_INPUT', context: { field } });
}

function integer(value, field, min, max) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(number) || number < min || number > max) {
    throw invalid(`${field} must be an integer from ${min} to ${max}`, field);
  }
  return number;
}

function blankOrInteger(value, field, min, max) {
  if (value === '' || value === null) return '';
  return integer(value, field, min, max);
}

function boolean(value, field) {
  if (typeof value !== 'boolean') throw invalid(`${field} must be a boolean`, field);
  return value;
}

function limitedText(value, field, { allowEmpty = false, max = 500 } = {}) {
  if (typeof value !== 'string') throw invalid(`${field} must be a string`, field);
  const text = value.trim();
  if (!allowEmpty && !text) throw invalid(`${field} is required`, field);
  if (text.length > max) throw invalid(`${field} must be ${max} characters or fewer`, field);
  return text;
}

function webUrl(value, field) {
  const text = limitedText(value, field, { max: 2048 });
  let parsed;
  try { parsed = new URL(text); }
  catch { throw invalid(`${field} must be an absolute HTTP(S) URL`, field); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw invalid(`${field} must be an absolute HTTP(S) URL`, field);
  }
  return parsed.toString();
}

function wallpaperUrl(value) {
  if (value === '' || value === null) return '';
  if (typeof value !== 'string' || value.length > 2048) {
    throw invalid('value must be a URL no longer than 2048 characters', 'value');
  }
  if (value.startsWith('fully://')) return value;
  return webUrl(value, 'value');
}

function isSensitiveSetting(key) {
  return SENSITIVE_SETTING_KEYS.has(key)
    || /(password|secret|token|credential)/i.test(key);
}

function displayType(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (value === null) return 'null';
  return 'string';
}

/**
 * Safe administration use cases for a registered remote display.
 */
export class DeviceRemoteAdministrationService {
  #gateway;
  #logger;

  constructor({ gateway, logger = console } = {}) {
    if (!gateway) throw new Error('DeviceRemoteAdministrationService requires gateway');
    this.#gateway = gateway;
    this.#logger = logger;
  }

  async getStatus(deviceId) {
    // `provider` rides through in the result so the console can word itself;
    // `unsupportedActions` is the gateway saying which of the shared action
    // names this kind of device has no equivalent for.
    const { unsupportedActions = [], ...result } = (await this.#gateway.readStatus(deviceId)) ?? {};
    return {
      ok: true,
      ...result,
      capabilities: { actions: Object.keys(ACTIONS).filter(action => !unsupportedActions.includes(action)) },
      fetchedAt: new Date().toISOString(),
    };
  }

  async getScreenshot(deviceId) {
    return this.#gateway.captureScreenshot(deviceId);
  }

  /**
   * Settings the device describes itself (key, type, value), or null when it
   * does not, in which case the curated whitelist above decides what is
   * editable.
   */
  async #typedSettings(deviceId) {
    const typed = await this.#gateway.readTypedSettings?.(deviceId);
    return Array.isArray(typed) ? typed : null;
  }

  async getSettings(deviceId) {
    const typed = await this.#typedSettings(deviceId);
    if (typed) {
      // A device that types its own settings rejects unknown keys and wrong
      // types itself, so every setting it lists may be edited, except
      // credential-like keys and types this console has no control for.
      const settings = typed
        .slice()
        .sort((left, right) => left.key.localeCompare(right.key))
        .map(({ key, type, value }) => {
          const sensitive = isSensitiveSetting(key);
          const editableType = Object.hasOwn(TYPED_SETTING_NORMALIZERS, type);
          return {
            key,
            type: editableType ? consoleType(type) : displayType(value),
            value: sensitive ? null : value,
            editable: editableType && !sensitive,
            sensitive,
          };
        });
      return { ok: true, settings, fetchedAt: new Date().toISOString() };
    }

    const raw = await this.#gateway.readSettings(deviceId);
    const settings = Object.entries(raw || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => {
        const sensitive = isSensitiveSetting(key);
        const schema = SETTING_SCHEMAS[key];
        return {
          key,
          type: schema?.type || displayType(value),
          value: sensitive ? null : value,
          editable: Boolean(schema) && !sensitive,
          sensitive,
        };
      });
    return { ok: true, settings, fetchedAt: new Date().toISOString() };
  }

  async performAction(deviceId, action, params = {}) {
    const normalize = ACTIONS[action];
    if (!normalize) throw invalid(`Unsupported device action: ${action}`, 'action');
    const normalized = normalize(params ?? {});
    const startedAt = Date.now();
    try {
      const result = await this.#gateway.executeAction(deviceId, action, normalized);
      this.#logger.info?.('admin.deviceRemote.action.completed', {
        deviceId,
        action,
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      return { ok: true, action, result, fetchedAt: new Date().toISOString() };
    } catch (error) {
      this.#logger.warn?.('admin.deviceRemote.action.failed', {
        deviceId,
        action,
        code: error?.code,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  async updateSetting(deviceId, key, value) {
    const typed = await this.#typedSettings(deviceId);
    let schema;
    if (typed) {
      const listed = typed.find(setting => setting.key === key);
      const normalize = listed ? TYPED_SETTING_NORMALIZERS[listed.type] : null;
      if (!listed || !normalize || isSensitiveSetting(key)) {
        throw invalid(`Setting is not editable from the Admin console: ${key}`, 'key');
      }
      schema = { type: consoleType(listed.type), normalize };
    } else {
      schema = SETTING_SCHEMAS[key];
      if (!schema || isSensitiveSetting(key)) {
        throw invalid(`Setting is not editable from the Admin console: ${key}`, 'key');
      }
    }
    const normalized = schema.normalize(value);
    const startedAt = Date.now();
    try {
      await this.#gateway.writeSetting(deviceId, key, normalized);
      this.#logger.info?.('admin.deviceRemote.setting.completed', {
        deviceId,
        key,
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      return {
        ok: true,
        setting: { key, type: schema.type, value: normalized, editable: true, sensitive: false },
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.#logger.warn?.('admin.deviceRemote.setting.failed', {
        deviceId,
        key,
        code: error?.code,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }
}

export default DeviceRemoteAdministrationService;
