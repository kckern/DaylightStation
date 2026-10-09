/** Existing fitness receipt runtime assembly; preserves construction order. */

export async function createFitnessReceiptRuntime(dependencies) {
  const { fitnessServices, householdId, userService, configService, mediaBasePath, rootLogger } = dependencies;
let createFitnessReceiptCanvas = null;
  try {
    const { createFitnessReceiptRenderer } = await import("../rendering/FitnessReceiptRenderer.mjs");
    const renderer = createFitnessReceiptRenderer({
      getSessionData: async (sessionId) => {
        const session = await fitnessServices.sessionService.getSession(sessionId, householdId, { decodeTimeline: false });
        return session ? session.toJSON() : null;
      },
      resolveDisplayName: (slug) => userService.resolveDisplayName(slug),
      fontDir: configService.getPath('font') || `${mediaBasePath}/fonts`
    });
    createFitnessReceiptCanvas = renderer.createCanvas;
  } catch (e) {
    rootLogger.warn?.('fitness.receipt.import_failed', { error: e.message });
  }
  return { createFitnessReceiptCanvas };
}
