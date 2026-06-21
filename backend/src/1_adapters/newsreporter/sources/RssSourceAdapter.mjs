import { ISource } from '#apps/newsreporter/ports/ISource.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * RSS source adapter (1_adapters) — STUB.
 *
 * Registered so a reporter configured with `type: rss` fails loudly (recorded
 * as `error`) rather than silently doing nothing. Implement gather() when RSS
 * support is needed.
 *
 * @implements {import('#apps/newsreporter/ports/ISource.mjs').ISource}
 */
export class RssSourceAdapter extends ISource {
  #logger;

  constructor({ logger } = {}) {
    super();
    this.#logger = logger || console;
  }

  async gather() {
    throw new InfrastructureError('rss source not implemented yet', {
      code: 'NEWSREPORTER_SOURCE_NOT_IMPLEMENTED',
      type: 'rss',
    });
  }
}

export default RssSourceAdapter;
