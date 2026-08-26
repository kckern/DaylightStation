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
   *   `printed` is only ever true when the printer CONFIRMED it — see
   *   `reason: 'unverified'` below for the case in between.
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
      // THREE OUTCOMES, NOT TWO.
      //
      // The thermal adapter resolves a claim tier — `{dispatched, verified}` —
      // because "our bytes flushed" and "the printer says it printed and is
      // still fine" are different claims, and the morning of 2026-08-25 a child
      // was locked out for fifteen minutes over a receipt that never came out
      // because only the first was ever checked. `printed: true` requires the
      // second. `unverified` is the honest middle: the bytes went, and the
      // printer would not confirm it — the caller can retry or ask, but must
      // not write down a permanent `issued`.
      //
      // A plain boolean is still accepted so test doubles and any other printer
      // surface that answers true/false keep working, and it never rejects.
      const outcome = await this.#printer.print(job);
      const dispatched = outcome === true || outcome?.dispatched === true;
      const verified = outcome === true || outcome?.verified === true;
      if (verified) return { printed: true, reason: null };
      if (dispatched) {
        this.#logger.warn?.('school.receipt.unverified', { id: document.id });
        return { printed: false, reason: 'unverified' };
      }
      this.#logger.warn?.('school.receipt.refused', { id: document.id });
      return { printed: false, reason: 'printer_refused' };
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
