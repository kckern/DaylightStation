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
   *   `printed` is true when the bytes went out and nothing told us they
   *   failed; `reason: 'unverified'` marks the prints the printer would not
   *   confirm. `printed: false` always means positive evidence — a refusal, a
   *   reported fault, or a thrown error — never mere silence.
   */
  async print(document, opts = {}) {
    if (!document) return { printed: false, reason: 'nothing_to_print' };
    if (!this.wired) {
      this.#logger.debug?.('school.receipt.not-wired', { id: document.id });
      return { printed: false, reason: 'not_wired' };
    }
    try {
      const artifact = await this.#renderer.render(document, opts);
      // FOUR OUTCOMES, NOT TWO — AND SILENCE IS NOT ONE OF THE FAILURES.
      //
      // The thermal adapter resolves a claim tier, because "our bytes flushed"
      // and "the printer says it printed and is still fine" are different
      // claims, and the morning of 2026-08-25 a child was locked out for
      // fifteen minutes over a receipt that never came out because only the
      // first was ever checked.
      //
      // Requiring `verified` for `printed: true` then broke it the other way.
      // `verified: false` covers BOTH "the printer reported a fault" and "the
      // printer reported nothing", and on this hardware the second is the
      // ordinary case: port 9100 is fire-and-forget with no per-job
      // acknowledgment, and a probe found the post-job read answering 2 of 4
      // queries then timing out entirely on the next connection. Every real
      // print therefore came back unverified, and children were told their
      // worksheet had not printed while it sat in the tray — and, because the
      // failure path arms no cooldown, tapping again reprinted it.
      //
      // So the tier's `verification` is what decides, not the boolean:
      //
      //   verified   → printed. The printer confirmed it.
      //   faulted    → NOT printed. The printer told us it failed; say so.
      //   unreadable → PRINTED, flagged. The pre-flight already refuses when
      //                the printer reports it cannot print, so once bytes are
      //                dispatched past a passing pre-flight, absence of
      //                confirmation is not evidence of failure. Telling a child
      //                their work did not print when it did is the worse error.
      //                The `warn` keeps the silence visible for operators, and
      //                `reason: 'unverified'` keeps it visible to callers that
      //                care to distinguish a confirmed print from a probable one.
      //   undispatched → NOT printed. Nothing ever went out.
      //
      // An outcome with no `verification` (a plain boolean, an older printer
      // surface, a test double) asserts nothing about faults, so it is read as
      // unreadable — inventing a fault out of silence is the error above.
      //
      // A plain boolean is still accepted so test doubles and any other printer
      // surface that answers true/false keep working, and it never rejects.
      const outcome = await artifact.printWith(this.#printer);
      const dispatched = outcome === true || outcome?.dispatched === true;
      const verified = outcome === true || outcome?.verified === true;
      const faulted = outcome?.verification === 'faulted';
      if (verified) return { printed: true, reason: null };
      if (dispatched) {
        if (faulted) {
          this.#logger.warn?.('school.receipt.printer-fault', {
            id: document.id, faults: outcome?.faults ?? null,
          });
          return { printed: false, reason: 'printer_fault' };
        }
        this.#logger.warn?.('school.receipt.unverified', { id: document.id });
        return { printed: true, reason: 'unverified' };
      }
      this.#logger.warn?.('school.receipt.refused', { id: document.id });
      return { printed: false, reason: 'printer_refused' };
    } catch (err) {
      this.#logger.warn?.('school.receipt.failed', { id: document.id, error: err.message });
      return { printed: false, reason: 'printer_error' };
    }
  }
}

export default ReceiptPrinting;
