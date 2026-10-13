/** Existing fitness services runtime assembly; preserves construction order. */

export async function createFitnessServicesRuntime(dependencies) {
  const { configService, createFitnessServices, mediaBasePath, householdId, scopedGateway, rootLogger } = dependencies;
const loadFitnessConfig = (hid) => {
    const targetHouseholdId = hid || configService.getDefaultHouseholdId();
    return configService.getHouseholdAppConfig(targetHouseholdId, 'fitness');
  };

  const fitnessServices = createFitnessServices({
    configService,
    mediaRoot: mediaBasePath,
    defaultHouseholdId: householdId,
    // Config-driven HA adapter (use .has() to avoid NoOp)
    haGateway: dependencies.householdAdapters?.has?.('home_automation') ? dependencies.householdAdapters.get('home_automation') : null,
    loadFitnessConfig,
    openaiAdapter: scopedGateway(dependencies.sharedAiGateway, { app: 'fitness' }),
    logger: rootLogger.child({ module: 'fitness' })
  });
  return { loadFitnessConfig, fitnessServices };
}
