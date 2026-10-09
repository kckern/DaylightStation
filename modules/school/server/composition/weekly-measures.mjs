/** School weekly read model over installed measure providers. */
export async function createSchoolWeeklyMeasures(dependencies,{MeasureRegistry,createFitnessRingsProvider}) {
  const { createMeasuresRouter } = await import("../api/measures.mjs");
  const { GetWeeklyMeasures } = await import("../application/measures/GetWeeklyMeasures.mjs");
  const {configService,householdId,fitnessServices,schoolLearnerDirectory,rootLogger,studyDayFor,isInWindow} = dependencies;
  const measuresTimezone = configService.getHouseholdTimezone?.(householdId) || 'UTC';
  const fitnessRings = createFitnessRingsProvider({ studyDayFor,isInWindow,
    timezone: measuresTimezone,
    sessions: {
      // The provider asks in study days; SessionService speaks the same
      // YYYY-MM-DD range, so no translation layer is needed.
      listSessions: ({ from, to }) => fitnessServices.sessionService
        .listSessionsInRange(from, to, householdId),
    },
  });
  const measureRegistry = new MeasureRegistry().register(fitnessRings);
  const weeklyMeasures = new GetWeeklyMeasures({
    registry: measureRegistry,
    learners: async () => schoolLearnerDirectory.listLearners(),
    timezone: measuresTimezone,
    logger: rootLogger.child({ module: 'measures' }),
  });
  const router = createMeasuresRouter({
    weeklyMeasures,
  });
  return {router,fitnessRings,weeklyMeasures,measuresTimezone};
}
