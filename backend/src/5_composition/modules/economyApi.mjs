// backend/src/5_composition/modules/economyApi.mjs
// Composition wiring for the household Economy API router. Follows the gratitudeApi
// module pattern, but returns { economyService, router } rather than a bare router:
// the piano earn-hook (Task 8) needs the same EconomyService instance, so we expose it.

import { YamlEconomyDatastore } from '#adapters/persistence/yaml/YamlEconomyDatastore.mjs';
import { EconomyService } from '#apps/economy/EconomyService.mjs';
import { createEconomyRouter } from '#api/v1/routers/economy.mjs';

/**
 * Create the economy application service + API router.
 * @param {Object} config
 * @param {Object} config.configService - ConfigService (user profiles, dirs, economy.yml)
 * @param {Object} [config.logger] - Logger instance
 * @returns {{ economyService: EconomyService, router: import('express').Router }}
 */
export function createEconomyApi({ configService, logger = console }) {
  const economyService = new EconomyService({
    datastore: new YamlEconomyDatastore({ configService }),
    configService,
    logger,
  });
  return { economyService, router: createEconomyRouter({ economyService, logger }) };
}

export default createEconomyApi;
