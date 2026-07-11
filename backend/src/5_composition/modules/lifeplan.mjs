/**
 * Lifeplan Domain Bootstrap
 *
 * Wires all lifeplan services, stores, and scheduled jobs.
 * Called from app.mjs during initialization.
 */

import { LifeplanContainer } from '#apps/lifeplan/LifeplanContainer.mjs';
import { YamlLifePlanStore } from '#adapters/persistence/yaml/YamlLifePlanStore.mjs';
import { YamlLifeplanMetricsStore } from '#adapters/persistence/yaml/YamlLifeplanMetricsStore.mjs';
import { YamlCeremonyRecordStore } from '#adapters/persistence/yaml/YamlCeremonyRecordStore.mjs';
import { CeremonyService } from '#apps/lifeplan/services/CeremonyService.mjs';
import { FeedbackService } from '#apps/lifeplan/services/FeedbackService.mjs';
import { PlanAuthoringService } from '#apps/lifeplan/services/PlanAuthoringService.mjs';
import { RetroService } from '#apps/lifeplan/services/RetroService.mjs';
import { DriftService } from '#apps/lifeplan/services/DriftService.mjs';
import { AlignmentService } from '#apps/lifeplan/services/AlignmentService.mjs';
import { CeremonyScheduler } from '#apps/lifeplan/services/CeremonyScheduler.mjs';
import createLifeRouter from '#api/v1/routers/life.mjs';

/**
 * Bootstrap the lifeplan domain.
 *
 * @param {Object} deps
 * @param {string} deps.dataPath - Base data path for YAML stores
 * @param {Object} deps.aggregator - LifelogAggregator instance
 * @param {Object} [deps.notificationService] - Notification service for ceremony reminders
 * @param {Object} [deps.userService] - UserService for username validation/profiles
 * @param {Function} [deps.listHouseholdUsers] - Returns household usernames for the switcher
 * @param {string} [deps.defaultUsername] - Username used when requests omit one
 * @param {string} [deps.timezone] - IANA household timezone for cadence math (defaults to UTC)
 * @param {Object} [deps.clock] - Injectable clock
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Object} { router, container, ceremonyScheduler, services }
 */
export function bootstrapLifeplan(deps) {
  const { dataPath, aggregator, notificationService, userService, listHouseholdUsers, defaultUsername, timezone, clock, logger } = deps;

  // Validate the household timezone at the composition seam (the domain has no
  // logger; CadenceService itself falls back to UTC on an invalid zone).
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    } catch {
      logger?.warn('cadence.invalid_timezone', { timezone, fallback: 'UTC' });
    }
  }

  // Persistence stores (constructed here at the composition root; the
  // container receives instances per Decision D1)
  const container = new LifeplanContainer({
    lifePlanStore: new YamlLifePlanStore({ basePath: dataPath }),
    metricsStore: new YamlLifeplanMetricsStore({ basePath: dataPath }),
    ceremonyRecordStore: new YamlCeremonyRecordStore({ basePath: dataPath }),
    timezone,
  });

  // Application services
  const feedbackService = new FeedbackService({
    lifePlanStore: container.getLifePlanStore(),
  });

  // Single write path for plan genesis + authoring (REST now, coach tools in C2)
  const planAuthoringService = new PlanAuthoringService({
    lifePlanStore: container.getLifePlanStore(),
  });

  const driftService = new DriftService({
    lifePlanStore: container.getLifePlanStore(),
    metricsStore: container.getMetricsStore(),
    aggregator,
    cadenceService: container.getCadenceService(),
    clock,
  });

  const ceremonyService = new CeremonyService({
    lifePlanStore: container.getLifePlanStore(),
    ceremonyRecordStore: container.getCeremonyRecordStore(),
    cadenceService: container.getCadenceService(),
  });

  const retroService = new RetroService({
    lifePlanStore: container.getLifePlanStore(),
    feedbackService,
    driftService,
  });

  const alignmentService = new AlignmentService({
    lifePlanStore: container.getLifePlanStore(),
    metricsStore: container.getMetricsStore(),
    cadenceService: container.getCadenceService(),
    ceremonyRecordStore: container.getCeremonyRecordStore(),
  });

  // Ceremony scheduler
  const ceremonyScheduler = new CeremonyScheduler({
    notificationService: notificationService || { send: () => [] },
    lifePlanStore: container.getLifePlanStore(),
    ceremonyRecordStore: container.getCeremonyRecordStore(),
    cadenceService: container.getCadenceService(),
    timezone,
    clock,
    logger,
  });

  // Router config (extends container's base config)
  const routerConfig = {
    ...container.getRouterConfig(),
    ceremonyService,
    feedbackService,
    planAuthoringService,
    retroService,
    alignmentService,
    driftService,
    aggregator,
    userService,
    listHouseholdUsers,
    defaultUsername,
  };

  const router = createLifeRouter(routerConfig);

  logger?.info('lifeplan.bootstrap.complete', {
    services: ['ceremony', 'feedback', 'retro', 'drift', 'alignment'],
  });

  return {
    router,
    container,
    ceremonyScheduler,
    services: {
      ceremonyService,
      feedbackService,
      planAuthoringService,
      retroService,
      driftService,
      alignmentService,
    },
  };
}
