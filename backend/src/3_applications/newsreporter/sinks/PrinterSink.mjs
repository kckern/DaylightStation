import { ISink } from '#apps/newsreporter/ports/ISink.mjs';

/**
 * Printer sink (3_applications glue).
 *
 * Composes the 1_rendering ReportReceiptRenderer (layout) with a thermal
 * printer resolved from the injected printer registry (output). Living in
 * 3_applications is what makes importing a 1_rendering renderer legal — a
 * 1_adapters file may not.
 *
 * @implements {import('#apps/newsreporter/ports/ISink.mjs').ISink}
 */
export class PrinterSink extends ISink {
  #renderer;
  #printerRegistry;
  #logger;

  /**
   * @param {{ renderer: object, printerRegistry: { resolve: Function }, logger?: object }} deps
   */
  constructor({ renderer, printerRegistry, logger } = {}) {
    super();
    if (!renderer) throw new Error('PrinterSink requires a renderer');
    if (!printerRegistry) throw new Error('PrinterSink requires a printerRegistry');
    this.#renderer = renderer;
    this.#printerRegistry = printerRegistry;
    this.#logger = logger || console;
  }

  /**
   * Render sections and print them (or preview when ctx.dryRun).
   * @param {Array} sections validated report sections
   * @param {object} cfg sink config block ({ template, printer })
   * @param {object} ctx run context ({ dryRun, printerOverride, ... })
   * @returns {Promise<{ status: 'ok'|'error', detail?: object }>}
   */
  async emit(sections, cfg = {}, ctx = {}) {
    const job = this.#renderer.render(sections, cfg.template, ctx);

    if (ctx.dryRun) {
      return {
        status: 'ok',
        detail: { preview: this.#renderer.renderText(sections, cfg.template, ctx) },
      };
    }

    const printerName = ctx.printerOverride ?? cfg.printer;
    // resolve() may throw on misconfig — let it propagate (the only throw path).
    const printer = this.#printerRegistry.resolve(printerName);

    const ok = await printer.print(job);
    this.#logger.info?.('newsreporter.sink.emit', {
      type: 'printer',
      printer: printerName,
      status: ok ? 'ok' : 'error',
    });

    return { status: ok ? 'ok' : 'error' };
  }
}
