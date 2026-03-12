import { GoalStateService } from '#domains/lifeplan/services/GoalStateService.mjs';
import { BeliefEvaluator } from '#domains/lifeplan/services/BeliefEvaluator.mjs';
import { BeliefCascadeProcessor } from '#domains/lifeplan/services/BeliefCascadeProcessor.mjs';
import { DependencyResolver } from '#domains/lifeplan/services/DependencyResolver.mjs';
import { CadenceService } from '#domains/lifeplan/services/CadenceService.mjs';
import { YamlLifePlanStore } from '#adapters/persistence/yaml/YamlLifePlanStore.mjs';
import { YamlLifeplanMetricsStore } from '#adapters/persistence/yaml/YamlLifeplanMetricsStore.mjs';
import { YamlCeremonyRecordStore } from '#adapters/persistence/yaml/YamlCeremonyRecordStore.mjs';

export class LifeplanContainer {
  #goalStateService;
  #beliefEvaluator;
  #beliefCascadeProcessor;
  #dependencyResolver;
  #cadenceService;
  #lifePlanStore;
  #metricsStore;
  #ceremonyRecordStore;
  #options;

  constructor(options = {}) {
    this.#options = options;
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
      this.#cadenceService = new CadenceService();
    }
    return this.#cadenceService;
  }

  getLifePlanStore() {
    if (!this.#lifePlanStore) {
      this.#lifePlanStore = new YamlLifePlanStore({
        basePath: this.#options.dataPath,
      });
    }
    return this.#lifePlanStore;
  }

  getMetricsStore() {
    if (!this.#metricsStore) {
      this.#metricsStore = new YamlLifeplanMetricsStore({
        basePath: this.#options.dataPath,
      });
    }
    return this.#metricsStore;
  }

  getCeremonyRecordStore() {
    if (!this.#ceremonyRecordStore) {
      this.#ceremonyRecordStore = new YamlCeremonyRecordStore({
        basePath: this.#options.dataPath,
      });
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
