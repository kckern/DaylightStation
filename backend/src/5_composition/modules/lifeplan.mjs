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
import { RetroService } from '#apps/lifeplan/services/RetroService.mjs';
import { DriftService } from '#apps/lifeplan/services/DriftService.mjs';
import { AlignmentService } from '#apps/lifeplan/services/AlignmentService.mjs';
import { CeremonyScheduler } from '#system/scheduling/CeremonyScheduler.mjs';
import createLifeRouter from '#api/v1/routers/life.mjs';

/**
 * Bootstrap the lifeplan domain.
 *
 * @param {Object} deps
 * @param {string} deps.dataPath - Base data path for YAML stores
 * @param {Object} deps.aggregator - LifelogAggregator instance
 * @param {Object} [deps.notificationService] - Notification service for ceremony reminders
 * @param {Object} [deps.clock] - Injectable clock
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Object} { router, container, ceremonyScheduler, services }
 */
export function bootstrapLifeplan(deps) {
  const { dataPath, aggregator, notificationService, clock, logger } = deps;

  // Persistence stores (constructed here at the composition root; the
  // container receives instances per Decision D1)
  const container = new LifeplanContainer({
    lifePlanStore: new YamlLifePlanStore({ basePath: dataPath }),
    metricsStore: new YamlLifeplanMetricsStore({ basePath: dataPath }),
    ceremonyRecordStore: new YamlCeremonyRecordStore({ basePath: dataPath }),
  });

  // Application services
  const feedbackService = new FeedbackService({
    lifePlanStore: container.getLifePlanStore(),
  });

  const driftService = new DriftService({
    lifePlanStore: container.getLifePlanStore(),
    metricsStore: container.getMetricsStore(),
    aggregator,
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
  });

  // Ceremony scheduler
  const ceremonyScheduler = new CeremonyScheduler({
    ceremonyService,
    notificationService: notificationService || { send: () => {} },
    lifePlanStore: container.getLifePlanStore(),
    ceremonyRecordStore: container.getCeremonyRecordStore(),
    cadenceService: container.getCadenceService(),
    clock,
  });

  // Router config (extends container's base config)
  const routerConfig = {
    ...container.getRouterConfig(),
    ceremonyService,
    feedbackService,
    retroService,
    alignmentService,
    driftService,
    aggregator,
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
      retroService,
      driftService,
      alignmentService,
    },
  };
}
