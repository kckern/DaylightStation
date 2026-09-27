// backend/src/5_composition/modules/economyApi.mjs
// Composition wiring for the household Economy API router. Follows the gratitudeApi
// module pattern, but returns { economyService, router } rather than a bare router:
// the piano earn-hook (Task 8) needs the same EconomyService instance, so we expose it.

import { YamlEconomyDatastore } from '#adapters/persistence/yaml/YamlEconomyDatastore.mjs';
import { YamlEarnRulesStore } from '#adapters/persistence/yaml/YamlEarnRulesStore.mjs';
import { EconomyConfigProjection } from '#adapters/config/ApplicationConfigProjections.mjs';
import { EconomyService } from '#apps/economy/EconomyService.mjs';
import { EarnRulesService } from '#apps/economy/EarnRulesService.mjs';
import { createEconomyRouter } from '#api/v1/routers/economy.mjs';

/**
 * Create the economy application service + API router.
 * @param {Object} config
 * @param {Object} config.configService - ConfigService (user profiles, dirs, economy.yml)
 * @param {Object} [config.logger] - Logger instance
 * @param {() => Date} [config.clock]
 * @returns {{ economyService: EconomyService, earnRulesService: EarnRulesService, router: import('express').Router }}
 */
export function createEconomyApi({ configService, logger = console, clock = () => new Date() }) {
  const economyService = new EconomyService({
    datastore: new YamlEconomyDatastore({ configService }),
    configProjection: new EconomyConfigProjection({ configService }),
    logger,
  });
  // The household earn rules (weekly earnings preview; the future payout).
  // Built here so every surface that edits or reads them shares one instance.
  const earnRulesService = new EarnRulesService({
    store: new YamlEarnRulesStore({ configService, logger }),
    clock,
    logger,
  });
  return { economyService, earnRulesService, router: createEconomyRouter({ economyService, logger }) };
}

export default createEconomyApi;
