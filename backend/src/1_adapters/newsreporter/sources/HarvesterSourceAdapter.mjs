import { ISource } from '#apps/newsreporter/ports/ISource.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Harvester source adapter (1_adapters) — STUB.
 *
 * Registered so a reporter configured with `type: harvester` fails loudly
 * (recorded as `error`) rather than silently doing nothing. Implement gather()
 * when harvester-backed sources are needed.
 *
 * @implements {import('#apps/newsreporter/ports/ISource.mjs').ISource}
 */
export class HarvesterSourceAdapter extends ISource {
  #logger;

  constructor({ logger } = {}) {
    super();
    this.#logger = logger || console;
  }

  async gather() {
    throw new InfrastructureError('harvester source not implemented yet', {
      code: 'NEWSREPORTER_SOURCE_NOT_IMPLEMENTED',
      type: 'harvester',
    });
  }
}

export default HarvesterSourceAdapter;
