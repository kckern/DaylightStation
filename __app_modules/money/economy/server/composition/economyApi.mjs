// __backend/src/5_composition/modules/economyApi.mjs
// Composition wiring for the household Economy API router. Follows the gratitudeApi
// module pattern, but returns { economyService, router } rather than a bare router:
// the piano earn-hook (Task 8) needs the same EconomyService instance, so we expose it.

import { YamlEconomyDatastore } from "../adapters/persistence/YamlEconomyDatastore.mjs";
import { YamlEarnRulesStore } from "../adapters/persistence/YamlEarnRulesStore.mjs";
import { EconomyConfigProjection } from '../adapters/config/EconomyConfigProjection.mjs';
import { EconomyService } from "../application/EconomyService.mjs";
import { EarnRulesService } from "../application/EarnRulesService.mjs";
import { BankService } from "../application/BankService.mjs";
import { createEconomyRouter } from "../api/economy.mjs";

/**
 * Create the economy application service + API router.
 * @param {Object} config
 * @param {Object} config.configService - ConfigService (user profiles, dirs, economy/config.yml)
 * @param {Object} [config.logger] - Logger instance
 * @param {() => Date} [config.clock]
 * @param {string|null} [config.timezone] - the household's. The earnings
 *   runtime reads it back from `studyCalendar`, so the preview's "today" and
 *   the day a pass belongs to come from one setting.
 * @param {number} [config.boundaryHour=4]
 * @returns {{ economyService: EconomyService, earnRulesService: EarnRulesService, bankService: BankService,
 *   configProjection: EconomyConfigProjection, studyCalendar: {timezone: string|null, boundaryHour: number},
 *   useEvidenceLabels: (fn: (userId: string) => Promise<Map<string,string>|null>) => void,
 *   router: import('express').Router }}
 */
export function createEconomyApi({ configService, logger = console, clock = () => new Date(), timezone = null, boundaryHour = 4 }) {
  const configProjection = new EconomyConfigProjection({ configService, logger });
  const studyCalendar = Object.freeze({ timezone: timezone ?? null, boundaryHour });
  const economyService = new EconomyService({
    datastore: new YamlEconomyDatastore({ configService }),
    configProjection,
    clock,
    ...studyCalendar,
    logger,
  });
  // The household earn rules (weekly earnings preview; the future payout).
  // Built here so every surface that edits or reads them shares one instance.
  const earnRulesService = new EarnRulesService({
    store: new YamlEarnRulesStore({ configService, logger }),
    clock,
    logger,
  });
  // The bank names payout lines from the current week's preview, which is
  // built later (the earnings runtime); until it binds a source, the ruleset
  // labels name them.
  let evidenceLabels = null;
  const bankService = new BankService({
    economy: economyService,
    config: configProjection,
    rules: earnRulesService,
    evidenceLabels: (userId) => (evidenceLabels ? evidenceLabels(userId) : null),
    clock,
    logger,
  });
  return {
    economyService, earnRulesService, bankService, configProjection, studyCalendar,
    useEvidenceLabels(fn) { evidenceLabels = typeof fn === 'function' ? fn : null; },
    router: createEconomyRouter({ economyService, bankService, logger }),
  };
}

export default createEconomyApi;
