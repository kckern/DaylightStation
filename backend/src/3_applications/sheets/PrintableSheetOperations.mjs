export class PrintableSheetOperations {
  constructor({ sheets, renderPdf, cellKinds, logger = console }) { this.sheets = sheets; this.renderPdf = renderPdf; this.cellKinds = cellKinds; this.logger = logger; }
  async render(id, params) {
    const model = await this.sheets.build(id, params);
    if (typeof this.renderPdf !== 'function') throw new TypeError('sheets router requires renderPdf');
    return { model, pdf: await this.renderPdf(model, { cellKinds: this.cellKinds, logger: this.logger }) };
  }
}
