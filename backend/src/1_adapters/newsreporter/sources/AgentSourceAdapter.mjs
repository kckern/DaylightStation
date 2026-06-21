import { ISource } from '#apps/newsreporter/ports/ISource.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Agent source adapter (1_adapters) — STUB.
 *
 * Registered so a reporter configured with `type: agent` fails loudly
 * (recorded as `error`) rather than silently doing nothing. Implement gather()
 * when agent-backed sources are needed.
 *
 * @implements {import('#apps/newsreporter/ports/ISource.mjs').ISource}
 */
export class AgentSourceAdapter extends ISource {
  #logger;

  constructor({ logger } = {}) {
    super();
    this.#logger = logger || console;
  }

  async gather() {
    throw new InfrastructureError('agent source not implemented yet', {
      code: 'NEWSREPORTER_SOURCE_NOT_IMPLEMENTED',
      type: 'agent',
    });
  }
}

export default AgentSourceAdapter;
