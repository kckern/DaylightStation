import { createPrintableSheetsRuntime } from '../../../../capabilities/printable-sheets/server/composition.mjs';
import { normalizeScaleNutribotConfig } from '../../../../modules/health/server/scale-config.mjs';

export async function createInstalledPrintableSheets({configService,householdId,rootLogger}) {
  return createPrintableSheetsRuntime({
    getConfig: () => configService.getHouseholdAppConfig(householdId, 'sheets') || {},
    rootLogger,
    loadProviders: async () => {
  const { createNutritionProviders } = await import("../../../../modules/health/server/nutrition-sheets.mjs");
  const { createIconLoader } = await import('#composition/modules/iconLoader.mjs');
      return (sheetsLogger) => createNutritionProviders({
      // Read per build, not once: the sheet must reflect the scale config as it
      // stands when somebody asks for a printout.
      getScaleConfig: () => normalizeScaleNutribotConfig(
        configService.getHouseholdAppConfig(householdId, 'scales') || {},
      ),
      loadIcon: createIconLoader({
        dir: configService.getHouseholdPath('nutrition/icons'),
        logger: sheetsLogger,
      }),
    });
    },
  });
}
