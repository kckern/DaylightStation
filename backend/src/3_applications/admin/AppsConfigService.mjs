import { ValidationError, NotFoundError } from '#apps/common/errors/SemanticErrors.mjs';

export class AppsConfigService {
  #configStore;
  constructor({ configStore, logger = console }) {
    if (!configStore) throw new Error('AppsConfigService requires a configStore dependency');
    this.#configStore = configStore;
    this.logger = logger;
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
    return record;
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
