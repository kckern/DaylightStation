export async function createEinkModule({ configService, householdId, dataService, mediaBasePath, rootLogger }) {
const { EinkPanelService } = await import("./application/eink/EinkPanelService.mjs");
  const { createEinkRouter } = await import("./api/eink.mjs");
  const { DataServiceEinkPanelStore } = await import("./adapters/eink/DataServiceEinkPanelStore.mjs");
  const { HttpEinkDataSourceGateway } = await import("./adapters/eink/HttpEinkDataSourceGateway.mjs");
  const { Sha1ContentFingerprint } = await import("./adapters/eink/Sha1ContentFingerprint.mjs");
  const { createEinkPanelRenderer } = await import("./rendering/eink/EinkPanelRenderer.mjs");
  const { loadImage: decodeEinkImage } = await import('#rendering/canvas/index.mjs');
  // Self-fetch base for panel data sources comes from household config, never a
  // literal — same source the MediaBundle uses (see bootstrap.mjs). Internal
  // host (e.g. http://daylight-station:3111) so the round-trip stays on-LAN.
  const einkDevices = configService.getHouseholdDevices(householdId) || {};
  const einkPanelService = new EinkPanelService({
    panelStore: new DataServiceEinkPanelStore({ dataService }),
    dataSourceGateway: new HttpEinkDataSourceGateway({
      baseUrl: einkDevices.daylightHostInternal || einkDevices.daylightHost,
      decodeImage: decodeEinkImage,
    }),
    panelRenderer: createEinkPanelRenderer({ fontDir: configService.getPath('font') || `${mediaBasePath}/fonts` }),
    fingerprint: new Sha1ContentFingerprint(),
    logger: rootLogger.child({ module: 'eink' }),
  });
  return createEinkRouter({
    einkPanelService,
    logger: rootLogger.child({ module: 'eink-api' }),
  });
}
