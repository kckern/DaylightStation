import { ISink } from '#apps/newsreporter/ports/ISink.mjs';
import { readPrintOutcome } from '#domains/core/utils/printOutcome.mjs';

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

    // The thermal adapter answers a claim tier; anything else may still
    // answer a plain boolean. `verified` means paper, but so does a dispatched
    // job the printer merely couldn't confirm — port 9100 gives no per-job
    // acknowledgment, so silence past a passing pre-flight is the ordinary
    // case, not evidence of failure (see readPrintOutcome). Only a reported
    // fault, or never dispatching at all, is a real failure.
    const outcome = await printer.print(job);
    const { printed, confirmed } = readPrintOutcome(outcome);
    // Never `error` for a print that went out unconfirmed — that would be the
    // same mistake, just moved into the sink instead of the adapter reading.
    // Still visible to operators at `warn` rather than a plain `info`.
    const level = printed ? (confirmed ? 'info' : 'warn') : 'warn';
    this.#logger[level]?.('newsreporter.sink.emit', {
      type: 'printer',
      printer: printerName,
      status: printed ? 'ok' : 'error',
    });

    return { status: printed ? 'ok' : 'error' };
  }
}
