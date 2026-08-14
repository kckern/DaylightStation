/**
 * ReceiptPrinting — render a receipt document and put it on the roll.
 *
 * Two ports, one obligation: every lifecycle use case that has something to SAY
 * says it as a receipt document, and this is the only place that knows how a
 * document becomes paper. It exists so that "a scan never succeeds silently"
 * (spec §6.2) is enforced in one place rather than remembered in eight.
 *
 * It NEVER throws. A thermal printer that is out of paper, unplugged, or simply
 * absent must not take down the scan that reached it — the caller still gets a
 * truthful `{ printed: false }` and can say so. A missing printer is a
 * configuration state, not an exception: on an install with no receipt printer
 * wired, the lifecycle still runs and every response reports that nothing
 * printed.
 */
export class ReceiptPrinting {
  #renderer; #printer; #logger;

  /**
   * @param {object} deps
   * @param {import('./ports/IDocumentRenderer.mjs').IReceiptRenderer} [deps.renderer]
   * @param {{print: Function}} [deps.printer] - thermal printer adapter surface
   * @param {object} [deps.logger]
   */
  constructor({ renderer = null, printer = null, logger = console } = {}) {
    this.#renderer = renderer;
    this.#printer = printer;
    this.#logger = logger;
  }

  /** @returns {boolean} whether anything can actually be printed */
  get wired() { return Boolean(this.#renderer && this.#printer); }

  /**
   * @param {object} document - a validated `target: ['receipt']` document
   * @param {object} [opts] - passed through to the renderer
   * @returns {Promise<{ printed: boolean, reason: string|null }>}
   */
  async print(document, opts = {}) {
    if (!document) return { printed: false, reason: 'nothing_to_print' };
    if (!this.wired) {
      this.#logger.debug?.('school.receipt.not-wired', { id: document.id });
      return { printed: false, reason: 'not_wired' };
    }
    let job = null;
    try {
      job = await this.#renderer.render(document, opts);
      // The real adapter's `print` resolves FALSE on failure and never rejects;
      // both are handled, because a double or a future adapter might differ.
      const ok = await this.#printer.print(job);
      if (!ok) {
        this.#logger.warn?.('school.receipt.refused', { id: document.id });
        return { printed: false, reason: 'printer_refused' };
      }
      return { printed: true, reason: null };
    } catch (err) {
      this.#logger.warn?.('school.receipt.failed', { id: document.id, error: err.message });
      return { printed: false, reason: 'printer_error' };
    } finally {
      // A raster renderer's job points the printer at a scratch PNG on disk
      // (ESC/POS has no in-memory image item) and hands back a `cleanup()` to
      // remove it once the bytes are no longer needed — after the print
      // attempt, win or lose. A text renderer sets none, so this is a no-op
      // for the ordinary case. Best-effort: a stray temp file is disk
      // clutter, never a reason to turn a successful print into a failed one.
      try { await job?.cleanup?.(); } catch (err) {
        this.#logger.debug?.('school.receipt.cleanup-failed', { id: document.id, error: err.message });
      }
    }
  }
}

export default ReceiptPrinting;
