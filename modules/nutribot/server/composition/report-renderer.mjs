/** Optional native report rendering, initialized at the installed application phase. */
export async function createNutribotReportRenderer({ configService, rootLogger }) {
  let nutribotReportRenderer = null;
  try {
    const { NutriReportRenderer } = await import("../rendering/NutriReportRenderer.mjs");
    nutribotReportRenderer = new NutriReportRenderer({
      logger: rootLogger.child({ module: 'nutribot-renderer' }),
      fontDir: configService.getPath('font'),
      iconDir: configService.getPath('icons') + '/food',
    });
    rootLogger.info?.('nutribot.renderer.initialized');
  } catch (e) {
    rootLogger.warn?.('nutribot.renderer.import_failed', { error: e.message });
  }
  return nutribotReportRenderer;
}
