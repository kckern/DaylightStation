import { ValidationError, NotFoundError } from '#apps/common/errors/SemanticErrors.mjs';

export class AppsConfigService {
  #configStore;
  #getHouseholdTimezone;
  /**
   * @param {Object} deps
   * @param {Object} deps.configStore
   * @param {() => (string|null)} [deps.getHouseholdTimezone] - household IANA
   *   zone, injected from the composition root. Served on every read as
   *   `householdTimezone` so a client (the piano kiosk) evaluates its time
   *   windows on the household clock rather than its own device clock — on
   *   2026-10-09 the piano tablet's zone was changed to Chicago and its curfew
   *   began at 17:00 Pacific.
   */
  constructor({ configStore, getHouseholdTimezone = null, logger = console }) {
    if (!configStore) throw new Error('AppsConfigService requires a configStore dependency');
    this.#configStore = configStore;
    this.#getHouseholdTimezone = typeof getHouseholdTimezone === 'function' ? getHouseholdTimezone : null;
    this.logger = logger;
  }

  #householdTimezone() {
    try {
      return this.#getHouseholdTimezone?.() || null;
    } catch (error) {
      this.logger.warn?.('admin.apps.timezone.failed', { error: error?.message });
      return null;
    }
  }

  listApps() {
    const apps = this.#configStore.listManagedAppConfigs();
    this.logger.info?.('admin.apps.listed', { count: apps.length });
    return { apps };
  }

  readAppConfig(appId) {
    const result = this.#configStore.readManagedAppConfig(appId);
    if (result.kind === 'unknown_app') {
      throw new ValidationError(`Unknown app "${appId}"`, { field: 'appId', code: 'UNKNOWN_APP' });
    }
    if (result.kind === 'missing') {
      throw new NotFoundError(`Config file not found for "${appId}"`, undefined, { appId, code: 'CONFIG_NOT_FOUND' });
    }
    const { kind: _kind, ...record } = result;
    this.logger.info?.('admin.apps.config.read', { appId });
    // Beside `parsed`/`raw`, never inside them: write-backs PUT `raw`, so the
    // zone can't leak into the file.
    return { ...record, householdTimezone: this.#householdTimezone() };
  }

  writeAppConfig(appId, content = {}) {
    const result = this.#configStore.writeManagedAppConfig(appId, content);
    if (result.kind === 'unknown_app') {
      throw new ValidationError(`Unknown app "${appId}"`, { field: 'appId', code: 'UNKNOWN_APP' });
    }
    if (result.kind === 'empty') {
      throw new ValidationError('Must provide either "raw" or "parsed"', { code: 'EMPTY_BODY' });
    }
    if (result.kind === 'invalid_yaml') {
      throw new ValidationError('Invalid YAML', {
        code: 'INVALID_YAML', details: { message: result.error.message, mark: result.error.mark },
      });
    }
    if (result.kind === 'dump_failed') {
      throw new ValidationError('Invalid YAML', {
        code: 'YAML_DUMP_FAILED', details: { message: result.error.message, mark: result.error.mark },
      });
    }
    if (result.kind === 'directory_missing') {
      throw new NotFoundError(
        `Config directory does not exist for "${appId}" — refusing to write to a possibly-stale location`,
        undefined, { appId, configPath: result.configPath, code: 'CONFIG_DIR_NOT_FOUND' },
      );
    }
    const { kind: _kind, ...receipt } = result;
    this.logger.info?.('admin.apps.config.written', { appId });
    return { ok: true, ...receipt };
  }
}

export default AppsConfigService;
