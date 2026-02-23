import { isSyncSource } from '../ports/ISyncSource.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

/**
 * Generic sync orchestration service.
 * Any ISyncSource can register; the service delegates sync and status calls.
 */
export class SyncService {
  #syncSources;
  #logger;

  constructor(config = {}) {
    this.#syncSources = new Map();
    this.#logger = config.logger || console;
  }

  registerSyncSource(source, adapter) {
    if (!isSyncSource(adapter)) {
      throw new ValidationError(`Adapter for '${source}' does not implement ISyncSource`, {
        code: 'INVALID_SYNC_SOURCE',
        field: 'adapter'
      });
    }
    this.#syncSources.set(source, adapter);
    this.#logger.debug?.('syncService.registered', { source });
  }

  async sync(source) {
    const adapter = this.#syncSources.get(source);
    if (!adapter) {
      throw new EntityNotFoundError('SyncSource', source);
    }
    this.#logger.info?.('syncService.syncStart', { source });
    const result = await adapter.sync();
    this.#logger.info?.('syncService.syncComplete', { source, ...result });
    return result;
  }

  async getStatus(source) {
    const adapter = this.#syncSources.get(source);
    if (!adapter) {
      throw new EntityNotFoundError('SyncSource', source);
    }
    return adapter.getStatus();
  }
}

export default SyncService;
