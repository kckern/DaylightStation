/**
 * YamlQuickInputLedgerStore - one bot's quick-input ledger for a user, as one
 * YAML document under the user's folder for that bot.
 *
 * Implements IQuickInputLedgerStore.
 * Data stored at: users/{username}/apps/{bot}/quick_input_ledger.yml
 * (or the `relativePath` it is given).
 *
 * @module quick-input/adapters
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IQuickInputLedgerStore } from '../application/ports/IQuickInputLedgerStore.mjs';

export class YamlQuickInputLedgerStore extends IQuickInputLedgerStore {
  #dataService;
  #relativePath;
  #failureEvent;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.dataService - User-scoped YAML read and write
   * @param {string} [deps.bot] - Names the default path
   * @param {string} [deps.relativePath] - Path under the user's folder, without extension
   * @param {string} [deps.failureEvent] - Log event for a write that did not land
   * @param {Object} [deps.logger]
   */
  constructor({ dataService, bot = null, relativePath = null, failureEvent = 'quick_input.ledger.writeFailed', logger = console } = {}) {
    super();
    if (!dataService?.user?.read || !dataService?.user?.write) {
      throw new InfrastructureError('YamlQuickInputLedgerStore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    if (!relativePath && !/^[a-z][a-z0-9_-]*$/.test(String(bot ?? ''))) {
      throw new InfrastructureError('YamlQuickInputLedgerStore requires a bot or a relativePath', {
        code: 'MISSING_CONFIG',
        field: 'bot',
      });
    }
    this.#dataService = dataService;
    this.#relativePath = relativePath || `apps/${bot}/quick_input_ledger`;
    this.#failureEvent = failureEvent;
    this.#logger = logger;
  }

  read(username) {
    const data = this.#dataService.user.read(this.#relativePath, username);
    return data && typeof data === 'object' ? data : null;
  }

  write(username, ledger) {
    const stored = Boolean(this.#dataService.user.write(this.#relativePath, ledger, username));
    if (!stored) this.#logger.error?.(this.#failureEvent, { username });
    return stored;
  }
}

export default YamlQuickInputLedgerStore;
