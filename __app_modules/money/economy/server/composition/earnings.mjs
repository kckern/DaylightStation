export async function createEconomyEarningsRuntime({schoolLifecycle,economyApi,fitnessRings,schoolLearnerDirectory,measuresTimezone,rootLogger}) {
    const { EarningsPreviewService } = await import("../application/EarningsPreviewService.mjs");
    const { SchoolEarningEvidence } = await import("../adapters/school/SchoolEarningEvidence.mjs");
    const { createEarningsRouter } = await import("../api/earnings.mjs");
    const termVerdicts = schoolLifecycle?.termVerdicts ?? null;
    const learnerSessions = schoolLifecycle?.listLearnerSessions ?? null;
    const curriculum = schoolLifecycle?.stores?.curriculum ?? null;
    const unavailableSchool = {
      schoolWeek: async () => { throw new Error('school term verdicts are not wired'); },
    };
    const earningsPreview = new EarningsPreviewService({
      rules: economyApi.earnRulesService,
      schoolEvidence: termVerdicts && learnerSessions
        ? new SchoolEarningEvidence({
          termVerdicts,
          sessions: learnerSessions,
          unitInfo: curriculum?.getUnitSummary
            ? async (unitId) => {
              const unit = await curriculum.getUnitSummary(unitId);
              return unit ? { subject: unit.subject ?? null, courseId: unit.courseId ?? null } : null;
            }
            : null,
          logger: rootLogger.child({ module: 'school-earning-evidence' }),
        })
        : unavailableSchool,
      // The same provider the board's weekly ring figure uses.
      ringEvidence: fitnessRings,
      learners: async () => schoolLearnerDirectory.listLearners(),
      clock: () => new Date(),
      timezone: measuresTimezone,
      logger: rootLogger.child({ module: 'economy-earnings' }),
    });
    return createEarningsRouter({
      earningsPreview,
      earnRules: economyApi.earnRulesService,
      logger: rootLogger.child({ module: 'economy-earnings-api' }),
    });
}
