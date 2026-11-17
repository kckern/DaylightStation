/**
 * YamlMemoLedgerStore - a user's voice memo ledger as one YAML document.
 *
 * Implements IMemoLedgerStore.
 * Data stored at: users/{username}/apps/journalist/memo_ledger.yml
 *
 * @module adapters/persistence/yaml
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IMemoLedgerStore } from '../../application/ports/IMemoLedgerStore.mjs';

const RELATIVE_PATH = 'apps/journalist/memo_ledger';

export class YamlMemoLedgerStore extends IMemoLedgerStore {
  #dataService;
  #logger;

  constructor({ dataService, logger = console } = {}) {
    super();
    if (!dataService?.user?.read || !dataService?.user?.write) {
      throw new InfrastructureError('YamlMemoLedgerStore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  read(username) {
    const data = this.#dataService.user.read(RELATIVE_PATH, username);
    return data && typeof data === 'object' ? data : null;
  }

  write(username, ledger) {
    const stored = Boolean(this.#dataService.user.write(RELATIVE_PATH, ledger, username));
    if (!stored) this.#logger.error?.('journalist.memo.ledger.writeFailed', { username });
    return stored;
  }
}

export default YamlMemoLedgerStore;
