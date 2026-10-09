export async function createInstalledWeeklyMeasures(dependencies) {
  const { MeasureRegistry } = await import("../../../../capabilities/measures/server/application/MeasureRegistry.mjs");
  const { createFitnessRingsProvider } = await import("../../../../modules/fitness/server/application/measures/fitnessRingsProvider.mjs");
  const {createSchoolWeeklyMeasures} = await import('../../../../modules/school/server/composition/weekly-measures.mjs');
  return createSchoolWeeklyMeasures(dependencies,{MeasureRegistry,createFitnessRingsProvider});
}
