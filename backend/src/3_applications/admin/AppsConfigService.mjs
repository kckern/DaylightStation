/**
 * AppsConfigService - Application service for the admin per-app config editor.
 *
 * Owns the friendly-app-ID → config-file-path registry plus the read / validate /
 * write YAML logic that the admin apps router used to inline. The router becomes a
 * thin HTTP shell: GET / → listApps(), GET /:appId/config → readAppConfig(),
 * PUT /:appId/config → writeAppConfig(). All error cases throw typed errors that
 * the router's P1.3 string error-middleware maps to HTTP status:
 *   ValidationError → 400 (unknown app, non-YAML body, invalid/undumpable YAML, empty body)
 *   NotFoundError   → 404 (config file missing for a known app)
 *
 * Path registry + behavior are preserved VERBATIM from the router.
 */
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import {
  ValidationError,
  NotFoundError
} from '#system/utils/errors/index.mjs';

/**
 * Registry mapping app IDs to their config file paths (relative to data root)
 */
const APP_CONFIGS = {
  fitness: 'household/config/fitness.yml',
  finance: 'household/config/finance.yml',
  gratitude: 'household/config/gratitude.yml',
  shopping: 'household/config/harvesters.yml',
  media: 'household/config/media-app.yml',
  chatbots: 'household/config/chatbots.yml',
  entropy: 'household/config/entropy.yml',
  keyboard: 'household/config/keyboard.yml',
  piano: 'household/config/piano.yml',
};

const YAML_DUMP_OPTS = { indent: 2, lineWidth: -1, noRefs: true };

export class AppsConfigService {
  /**
   * @param {Object} deps
   * @param {Object} deps.configService - ConfigService for data directory paths
   * @param {Object} [deps.logger=console] - Logger instance
   */
  constructor({ configService, logger = console }) {
    if (!configService) {
      throw new Error('AppsConfigService requires a configService dependency');
    }
    this.configService = configService;
    this.logger = logger;
  }

  /** Get the resolved data root directory */
  #getDataRoot() {
    return path.resolve(this.configService.getDataDir());
  }

  /**
   * Resolve the config path for a known app ID, throwing if unknown.
   * @param {string} appId
   * @returns {{ configPath: string, absPath: string }}
   * @throws {ValidationError} unknown app
   */
  #resolveApp(appId) {
    const configPath = APP_CONFIGS[appId];
    if (!configPath) {
      throw new ValidationError(`Unknown app "${appId}"`, { field: 'appId', code: 'UNKNOWN_APP' });
    }
    const absPath = path.join(this.#getDataRoot(), configPath);
    return { configPath, absPath };
  }

  /**
   * List all known apps with config-file existence + metadata.
   * @returns {{ apps: Array<Object> }}
   */
  listApps() {
    const dataRoot = this.#getDataRoot();
    const apps = Object.entries(APP_CONFIGS).map(([appId, configPath]) => {
      const absPath = path.join(dataRoot, configPath);
      const exists = fs.existsSync(absPath);
      let size = null, modified = null;
      if (exists) {
        const stat = fs.statSync(absPath);
        size = stat.size;
        modified = stat.mtime.toISOString();
      }
      return { appId, configPath, exists, size, modified };
    });

    this.logger.info?.('admin.apps.listed', { count: apps.length });
    return { apps };
  }

  /**
   * Read a known app's config file (raw + parsed).
   * @param {string} appId
   * @returns {{ appId, configPath, raw, parsed, size, modified }}
   * @throws {ValidationError} unknown app
   * @throws {NotFoundError} config file missing
   */
  readAppConfig(appId) {
    const { configPath, absPath } = this.#resolveApp(appId);

    if (!fs.existsSync(absPath)) {
      throw new NotFoundError(`Config file not found for "${appId}"`, undefined, { appId, code: 'CONFIG_NOT_FOUND' });
    }

    const raw = fs.readFileSync(absPath, 'utf8');
    let parsed;
    try {
      parsed = yaml.load(raw);
    } catch (e) {
      parsed = null;
    }

    const stat = fs.statSync(absPath);

    this.logger.info?.('admin.apps.config.read', { appId });
    return {
      appId,
      configPath,
      raw,
      parsed,
      size: stat.size,
      modified: stat.mtime.toISOString()
    };
  }

  /**
   * Write a known app's config file from either a raw YAML string or a parsed object.
   * @param {string} appId
   * @param {{ raw?: string, parsed?: Object }} content
   * @returns {{ ok: true, appId, configPath, size, modified }}
   * @throws {ValidationError} unknown app, empty body, invalid/undumpable YAML
   */
  writeAppConfig(appId, content = {}) {
    const { configPath, absPath } = this.#resolveApp(appId);

    const { raw, parsed } = content || {};

    if (raw === undefined && parsed === undefined) {
      throw new ValidationError('Must provide either "raw" or "parsed"', { code: 'EMPTY_BODY' });
    }

    let fileContent;

    if (raw !== undefined) {
      // Validate that the raw string is valid YAML
      try {
        yaml.load(raw);
      } catch (parseError) {
        throw new ValidationError('Invalid YAML', {
          code: 'INVALID_YAML',
          details: { message: parseError.message, mark: parseError.mark }
        });
      }
      fileContent = raw;
    } else {
      // Serializing an object can throw YAMLException (e.g. circular refs) -
      // map that to a 400 (client-supplied data), not a 500.
      try {
        fileContent = yaml.dump(parsed, YAML_DUMP_OPTS);
      } catch (dumpError) {
        throw new ValidationError('Invalid YAML', {
          code: 'YAML_DUMP_FAILED',
          details: { message: dumpError.message, mark: dumpError.mark }
        });
      }
    }

    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absPath, fileContent, 'utf8');

    const stat = fs.statSync(absPath);

    this.logger.info?.('admin.apps.config.written', { appId });
    return {
      ok: true,
      appId,
      configPath,
      size: stat.size,
      modified: stat.mtime.toISOString()
    };
  }
}

export default AppsConfigService;
