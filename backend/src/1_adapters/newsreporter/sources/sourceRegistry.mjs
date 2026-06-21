import { HttpSourceAdapter } from '#adapters/newsreporter/sources/HttpSourceAdapter.mjs';
import { RssSourceAdapter } from '#adapters/newsreporter/sources/RssSourceAdapter.mjs';
import { HarvesterSourceAdapter } from '#adapters/newsreporter/sources/HarvesterSourceAdapter.mjs';
import { AgentSourceAdapter } from '#adapters/newsreporter/sources/AgentSourceAdapter.mjs';
import { ValidationError } from '#system/utils/errors/index.mjs';

/**
 * Source registry (1_adapters) — type-keyed factory for ISource implementations.
 *
 * Add-a-class-and-register: new source kinds plug in here without touching the
 * orchestration core. `http` is fully implemented; `rss`/`harvester`/`agent`
 * are registered stubs that throw on gather() so a misconfigured reporter fails
 * loudly (recorded as `error`). An unknown type is a config mistake and throws
 * a ValidationError at create() time.
 *
 * @param {{ httpClient: object, logger?: object }} deps
 * @returns {{ create(type: string, cfg: object): import('#apps/newsreporter/ports/ISource.mjs').ISource }}
 */
export function createSourceRegistry({ httpClient, logger } = {}) {
  const factories = {
    http: () => new HttpSourceAdapter({ httpClient, logger }),
    rss: () => new RssSourceAdapter({ logger }),
    harvester: () => new HarvesterSourceAdapter({ logger }),
    agent: () => new AgentSourceAdapter({ logger }),
  };

  return {
    /**
     * @param {string} type source type key
     * @param {object} cfg resolved source config block
     */
    create(type, cfg) {
      const factory = factories[type];
      if (!factory) {
        throw new ValidationError(`unknown source type: ${type}`, {
          code: 'NEWSREPORTER_UNKNOWN_SOURCE_TYPE',
          field: 'type',
          type,
        });
      }
      return factory(cfg);
    },
  };
}

export default createSourceRegistry;
