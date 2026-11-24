/** Existing fitness receipt runtime assembly; preserves construction order. */

/**
 * `createFitnessReceiptCanvas(sessionId)` loads the session, builds the
 * presentation model and renders it upright.
 *
 * Until 2026-11-23 this handed the bare renderer's `createCanvas(model)` to
 * callers that pass a session id, so the renderer destructured a string and
 * threw (`Cannot read properties of undefined (reading 'length')`): the
 * 2026-08-29 DDD remediation moved session loading out of the renderer into
 * `RenderFitnessReceipt` + `FitnessReceiptCanvasRenderer` and never wired them.
 */
export async function createFitnessReceiptRuntime(dependencies) {
  const { fitnessServices, householdId, userService, configService, mediaBasePath, rootLogger } = dependencies;
  let createFitnessReceiptCanvas = null;
  try {
    const { createFitnessReceiptRenderer } = await import("../rendering/FitnessReceiptRenderer.mjs");
    const { fitnessReceiptTheme } = await import("../rendering/fitnessReceiptTheme.mjs");
    const { FitnessReceiptCanvasRenderer } = await import("../adapters/FitnessReceiptCanvasRenderer.mjs");
    const { RenderFitnessReceipt } = await import("../application/RenderFitnessReceipt.mjs");
    const { prepareFitnessReceiptPresentation } = await import("../application/FitnessReceiptPresentation.mjs");
    const renderer = createFitnessReceiptRenderer({
      fontDir: configService.getPath('font') || `${mediaBasePath}/fonts`
    });
    const renderReceipt = new RenderFitnessReceipt({
      loadSession: (sessionId) => fitnessServices.sessionService.getSession(sessionId, householdId, { decodeTimeline: false }),
      receiptRenderer: new FitnessReceiptCanvasRenderer({
        renderer,
        theme: fitnessReceiptTheme,
        resolveDisplayName: (slug) => userService.resolveDisplayName(slug),
        serializeSession: (session) => session.toJSON(),
        preparePresentation: prepareFitnessReceiptPresentation,
      }),
    });
    createFitnessReceiptCanvas = (sessionId) => renderReceipt.execute(sessionId);
  } catch (e) {
    rootLogger.warn?.('fitness.receipt.import_failed', { error: e.message });
  }
  return { createFitnessReceiptCanvas };
}
