import { GoalStateService } from '#domains/lifeplan/services/GoalStateService.mjs';
import { BeliefEvaluator } from '#domains/lifeplan/services/BeliefEvaluator.mjs';
import { BeliefCascadeProcessor } from '#domains/lifeplan/services/BeliefCascadeProcessor.mjs';
import { DependencyResolver } from '#domains/lifeplan/services/DependencyResolver.mjs';
import { CadenceService } from '#domains/lifeplan/services/CadenceService.mjs';

/**
 * DI container for the lifeplan domain.
 *
 * Persistence stores are constructed at the composition root
 * (5_composition/modules/lifeplan.mjs) and injected as instances (Decision D1:
 * containers never import concrete adapter classes). Pure domain services
 * are lazily constructed here.
 */
export class LifeplanContainer {
  #goalStateService;
  #beliefEvaluator;
  #beliefCascadeProcessor;
  #dependencyResolver;
  #cadenceService;
  #lifePlanStore;
  #metricsStore;
  #ceremonyRecordStore;
  #timezone;

  /**
   * @param {Object} options
   * @param {Object} options.lifePlanStore - ILifePlanStore instance
   * @param {Object} options.metricsStore - Metrics store instance
   * @param {Object} options.ceremonyRecordStore - Ceremony record store instance
   * @param {string} [options.timezone] - IANA household timezone for cadence math (defaults to UTC)
   */
  constructor(options = {}) {
    this.#lifePlanStore = options.lifePlanStore || null;
    this.#metricsStore = options.metricsStore || null;
    this.#ceremonyRecordStore = options.ceremonyRecordStore || null;
    this.#timezone = options.timezone || null;
  }

  getGoalStateService() {
    if (!this.#goalStateService) {
      this.#goalStateService = new GoalStateService();
    }
    return this.#goalStateService;
  }

  getBeliefEvaluator() {
    if (!this.#beliefEvaluator) {
      this.#beliefEvaluator = new BeliefEvaluator();
    }
    return this.#beliefEvaluator;
  }

  getBeliefCascadeProcessor() {
    if (!this.#beliefCascadeProcessor) {
      this.#beliefCascadeProcessor = new BeliefCascadeProcessor();
    }
    return this.#beliefCascadeProcessor;
  }

  getDependencyResolver() {
    if (!this.#dependencyResolver) {
      this.#dependencyResolver = new DependencyResolver();
    }
    return this.#dependencyResolver;
  }

  getCadenceService() {
    if (!this.#cadenceService) {
      this.#cadenceService = new CadenceService({ timezone: this.#timezone });
    }
    return this.#cadenceService;
  }

  getLifePlanStore() {
    if (!this.#lifePlanStore) {
      throw new Error('lifePlanStore not configured');
    }
    return this.#lifePlanStore;
  }

  getMetricsStore() {
    if (!this.#metricsStore) {
      throw new Error('metricsStore not configured');
    }
    return this.#metricsStore;
  }

  getCeremonyRecordStore() {
    if (!this.#ceremonyRecordStore) {
      throw new Error('ceremonyRecordStore not configured');
    }
    return this.#ceremonyRecordStore;
  }

  getRouterConfig() {
    return {
      lifePlanStore: this.getLifePlanStore(),
      goalStateService: this.getGoalStateService(),
      beliefEvaluator: this.getBeliefEvaluator(),
      cadenceService: this.getCadenceService(),
      metricsStore: this.getMetricsStore(),
      ceremonyRecordStore: this.getCeremonyRecordStore(),
      dependencyResolver: this.getDependencyResolver(),
      beliefCascadeProcessor: this.getBeliefCascadeProcessor(),
    };
  }
}
