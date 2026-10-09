/** Supplemental existing oracles for the full Health/Nutribot ownership move. */
export const healthStackSelected = [
  'modules/health/browser/healthResources.test.js',
  'modules/health/browser/today/useHealthDay.test.jsx',
  'modules/health/browser/progress/ProgressView.range.test.jsx',
  'modules/health/browser/today/FoodCatalogManager.test.jsx',
  'modules/health/server/application/health/BudgetService.test.mjs',
  'modules/health/server/application/health/SavedMealsService.test.mjs',
  'modules/health/server/composition/healthApi.timezone.test.mjs',
  'modules/health/server/application/agents/nutrition-auditor/NutritionAuditor.test.mjs',
  'modules/health/server/adapters/persistence/yaml/YamlMedicalReadingsDatastore.test.mjs',
  'modules/health/server/rendering/NutritionReceiptRenderer.test.mjs',
  'modules/health/cli/curate-nutrition-icons.test.mjs',
  'modules/health/cli/nutrition-auditor-backfill.cli.test.mjs',
  'modules/health/cli/health-icon-manifest-merge.cli.test.mjs',
  'modules/health/cli/health-scan-repair.cli.test.mjs',
  'modules/health/cli/health-catalog-serving-repair.cli.test.mjs',
  'modules/health/cli/health-artwork-sweep.cli.test.mjs',
];

/** Explicit additional existing oracles; separate from the original 146-case baseline. */
export const healthCliSupplemental = ['tests/unit/cli/commands/health.test.mjs','tests/unit/cli/health-group-repair.test.mjs','modules/health/server/application/health/NutritionRepair.test.mjs'];
export const healthCliSupplementalCaseCount = 39;
