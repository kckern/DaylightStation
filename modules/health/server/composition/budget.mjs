import { BudgetService } from "../application/health/BudgetService.mjs";
import { YamlHealthGoalsDatastore } from "../adapters/persistence/yaml/YamlHealthGoalsDatastore.mjs";

export function createHealthBudget({ dataService, healthStore, nutriListStore, logger }) {
  if (!dataService || !healthStore?.loadWeightData || !healthStore?.getWorkoutsForRange || !nutriListStore) return null;
  return new BudgetService({
    goalsStore: new YamlHealthGoalsDatastore({ dataService }),
    healthStore,
    nutriListStore,
    clock: { now: () => Date.now() },
    logger,
  });
}
