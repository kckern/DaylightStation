export async function createInstalledWeeklyMeasures(dependencies) {
  const { MeasureRegistry } = await import("../../../../__capabilities/measures/server/application/MeasureRegistry.mjs");
  const { createFitnessRingsProvider } = await import("../../../../__app_modules/wellness/fitness/server/application/measures/fitnessRingsProvider.mjs");
  const {createSchoolWeeklyMeasures} = await import('../../../../__app_modules/learning/school/server/composition/weekly-measures.mjs');
  return createSchoolWeeklyMeasures(dependencies,{MeasureRegistry,createFitnessRingsProvider});
}
