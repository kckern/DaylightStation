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
import { EventBusEconomyEvents } from "../adapters/eventbus/EventBusEconomyEvents.mjs";
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
 * @param {string} [config.processTimezone] - defaults to `process.env.TZ`
 * @param {Object|null} [config.eventBus] - the house bus; with it, every write
 *   that moves a balance or a pass publishes `economy.coins-changed {userId}`.
 *   Without it nobody is told.
 * @returns {{ economyService: EconomyService, earnRulesService: EarnRulesService, bankService: BankService,
 *   configProjection: EconomyConfigProjection, studyCalendar: {timezone: string|null, boundaryHour: number},
 *   useEvidenceLabels: (fn: (userId: string) => Promise<Map<string,string>|null>) => void,
 *   useSheetRewards: (fn: (args: {learnerId: string, unit: object}) => Promise<object|null>) => void,
 *   rewardFor: (args: {learnerId: string, unit: object}) => Promise<{silver: number, gems: number}|null>,
 *   router: import('express').Router }}
 */
export function createEconomyApi({ configService, logger = console, clock = () => new Date(), timezone = null, boundaryHour = 4,
  processTimezone = process.env.TZ, eventBus = null }) {
  // The week-close job fires in the process TZ (the container's, from
  // system.yml); the bank and the passes read the household's. Say so once
  // when they differ.
  if (processTimezone && timezone && processTimezone !== timezone) {
    logger.warn?.('economy.timezone-mismatch', { processTimezone, householdTimezone: timezone });
  }
  const configProjection = new EconomyConfigProjection({ configService, logger });
  const studyCalendar = Object.freeze({ timezone: timezone ?? null, boundaryHour });
  const economyService = new EconomyService({
    datastore: new YamlEconomyDatastore({ configService }),
    configProjection,
    clock,
    ...studyCalendar,
    events: eventBus ? new EventBusEconomyEvents({ eventBus, logger }) : null,
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
  // School's "print my next sheet" reward port. School is composed before the
  // earnings runtime, so it gets this late-bound thunk: null until the runtime
  // binds the real source (`cachedSheetRewards`).
  let sheetRewards = null;
  return {
    economyService, earnRulesService, bankService, configProjection, studyCalendar,
    useEvidenceLabels(fn) { evidenceLabels = typeof fn === 'function' ? fn : null; },
    useSheetRewards(fn) { sheetRewards = typeof fn === 'function' ? fn : null; },
    rewardFor: async (args) => (sheetRewards ? sheetRewards(args) : null),
    router: createEconomyRouter({ economyService, bankService, logger }),
  };
}

export default createEconomyApi;
