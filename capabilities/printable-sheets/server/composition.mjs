/** Generic sheet runtime, with installed providers injected in import order. */
export async function createPrintableSheetsRuntime({getConfig,loadProviders,rootLogger}) {
  const { createSheetService } = await import("./application/SheetService.mjs");
  const { PrintableSheetOperations } = await import("./application/PrintableSheetOperations.mjs");
  const { createCellRenderers } = await import('#rendering/pdf/cellRenderers.mjs');
  const { layout: layoutSheet } = await import("./rendering/SheetLayout.mjs");
  const { renderSheetPdf } = await import("./rendering/QRSheetRenderer.mjs");
  const buildProviders = await loadProviders();
  const { createSheetsRouter } = await import("./api/sheets.mjs");

  const sheetCellKinds = createCellRenderers();
  const sheetsLogger = rootLogger.child({ module: 'sheets' });
  const sheetService = createSheetService({
    getConfig,
    providers: buildProviders(sheetsLogger),
    cellKinds: sheetCellKinds,
    layoutSheet,
    logger: sheetsLogger,
  });
  return createSheetsRouter({
    printableSheets: new PrintableSheetOperations({
      sheets: sheetService,
      cellKinds: sheetCellKinds,
      renderPdf: renderSheetPdf,
      logger: sheetsLogger,
    }),
    logger: sheetsLogger,
  });
}
