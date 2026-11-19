/**
 * RoutedThermalPrinter — one named printer with fallbacks behind it.
 *
 * Callers resolve a printer once (often at boot) and keep it, so routing has
 * to live inside the object they hold. This wraps an ordered chain of physical
 * ThermalPrinterAdapters and presents the same surface as one of them.
 *
 * The one rule that keeps it safe: a job moves to the next printer ONLY when
 * it provably never left (`dispatched: false`: the connection failed, or the
 * printer refused at preflight, e.g. paper out). A job that was sent, even
 * unconfirmed, is never sent again — a duplicate quiz card is worse than one
 * that came out unannounced.
 *
 * A printer that did not take a job is marked down for `downForMs`, so later
 * jobs go straight to the next one instead of waiting on a dead host. Once
 * the window passes it is tried first again. When every printer is down they
 * are all tried in order anyway: being wrong about "down" must not stop
 * printing.
 *
 * @module adapters/hardware/thermal-printer
 */

const DEFAULT_DOWN_FOR_MS = 2 * 60 * 1000;

export class RoutedThermalPrinter {
  #name;
  #chain;
  #downForMs;
  #clock;
  #logger;
  #downUntil = new Map();

  /**
   * @param {{ name: string, chain: Array<{ name: string, adapter: object }>,
   *   downForMs?: number, clock?: () => number, logger?: object }} options
   */
  constructor({ name, chain, downForMs = DEFAULT_DOWN_FOR_MS, clock = () => Date.now(), logger = console }) {
    if (!Array.isArray(chain) || chain.length === 0) throw new Error('RoutedThermalPrinter needs at least one printer');
    this.#name = name;
    this.#chain = chain;
    this.#downForMs = downForMs;
    this.#clock = clock;
    this.#logger = logger;
  }

  get #primary() { return this.#chain[0].adapter; }

  #isDown(name) { return (this.#downUntil.get(name) ?? 0) > this.#clock(); }

  /** Printers to try, in order: those not marked down; every one if all are. */
  #order() {
    const up = this.#chain.filter((link) => !this.#isDown(link.name));
    return up.length ? up : this.#chain;
  }

  async print(printJob) {
    const tried = [];
    let last = null;
    for (const link of this.#order()) {
      tried.push(link.name);
      // eslint-disable-next-line no-await-in-loop -- strictly one printer at a time.
      const outcome = await link.adapter.print(printJob);
      last = outcome;
      const dispatched = outcome === true || outcome?.dispatched === true;
      if (dispatched) {
        if (this.#downUntil.delete(link.name)) {
          this.#logger.info?.('thermalPrinter.route.restored', { route: this.#name, printer: link.name });
        }
        const failedOver = link.name !== this.#chain[0].name;
        if (failedOver) {
          this.#logger.warn?.('thermalPrinter.route.failover', { route: this.#name, printedOn: link.name, tried });
        }
        const base = outcome === true ? { dispatched: true, verified: true, verification: 'verified', faults: null } : outcome;
        return { ...base, printedOn: link.name, failedOver, tried };
      }
      this.#downUntil.set(link.name, this.#clock() + this.#downForMs);
      this.#logger.warn?.('thermalPrinter.route.down', {
        route: this.#name, printer: link.name, verification: outcome?.verification ?? null, faults: outcome?.faults ?? null,
      });
    }
    return { ...(last ?? { dispatched: false, verified: false, verification: 'unreadable', faults: null }), printedOn: null, failedOver: false, tried };
  }

  /** Status of the first printer that answers, with which one it was. */
  async getStatus(timeoutMs) {
    let last = null;
    for (const link of this.#order()) {
      // eslint-disable-next-line no-await-in-loop -- first answer wins.
      const status = await link.adapter.getStatus(timeoutMs);
      if (status?.success) return { ...status, printer: link.name };
      last = { ...status, printer: link.name };
    }
    return last;
  }

  async ping() {
    let last = null;
    for (const link of this.#order()) {
      // eslint-disable-next-line no-await-in-loop -- first answer wins.
      const result = await link.adapter.ping();
      if (result?.success) return { ...result, printer: link.name };
      last = { ...result, printer: link.name };
    }
    return last;
  }

  // Jobs are plain data, so the primary builds them for whichever printer prints.
  createTextPrint(...args) { return this.#primary.createTextPrint(...args); }
  createImagePrint(...args) { return this.#primary.createImagePrint(...args); }
  createReceiptPrint(...args) { return this.#primary.createReceiptPrint(...args); }
  createTablePrint(...args) { return this.#primary.createTablePrint(...args); }
  setFeedButton(...args) { return this.#primary.setFeedButton(...args); }
  testFeedButton(...args) { return this.#primary.testFeedButton(...args); }
  isConfigured() { return this.#primary.isConfigured(); }
  getHost() { return this.#primary.getHost(); }
  getPort() { return this.#primary.getPort(); }

  /** The route's names in order, for status and logs. */
  route() { return this.#chain.map((link) => link.name); }
}

export default RoutedThermalPrinter;
