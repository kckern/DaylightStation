/**
 * VirtualThermalPrinterAdapter — an ESC/POS receipt printer that exists only on
 * disk. Same surface as {@link ThermalPrinterAdapter}; the composition root
 * chooses which one to wire, and production code never asks which it has.
 *
 * It EXTENDS the real adapter and overrides only the three methods that touch
 * the network (`print`, `ping`, `getStatus`). Surface parity is then structural
 * rather than maintained by hand: the job builders (`createReceiptPrint`,
 * `createImagePrint`, `createTablePrint`, `setFeedButton`, `testFeedButton`) are
 * the real ones, so a capture is built from exactly the item list the real
 * printer would have encoded.
 *
 * Each job is captured twice:
 *  - `<captureDir>/{receiptId}.json` — the raw item list plus metadata.
 *  - `<captureDir>/{receiptId}.txt`  — a decoded plain-text transcript. Tests and
 *    the e2e harness assert on this ("the receipt told the child to rescan and
 *    carried token sch:abc"), so it must preserve authored order and content.
 *    Barcode/QR items render as their code value on its own line; image items
 *    contribute no text and are recorded by dimension only — UNLESS the job
 *    itself carries a `transcript` string (a raster job's own words for what
 *    it drew as pixels, since there is no text item to decode one from). When
 *    present, that string is authoritative and nothing is re-derived from
 *    `items`. Likewise `codes`, if the job carries it: a raster job's QR is
 *    pixels, not a `qrcode` item, so anything reading "what can be scanned
 *    off this receipt" from item types alone would see none.
 *
 * Faults:
 *  - `offline` — unreachable. `print` resolves FALSE (the real adapter never
 *    rejects on a failed job), ping/getStatus report the connection failure.
 *  - `jam` — out of paper / cover fault. The printer still accepts the bytes on
 *    the wire, exactly as the real one does, so the fault surfaces only through
 *    `getStatus`.
 *
 * @module adapters/hardware/thermal-printer
 */
import { promises as fs } from 'fs';
import path from 'path';
import { nowTs24 } from '#system/utils/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { transcribeEscPosItems } from '#system/utils/escposTranscript.mjs';
import { ThermalPrinterAdapter } from './ThermalPrinterAdapter.mjs';

const FAULTS = Object.freeze(['offline', 'jam']);
const VIRTUAL_HOST = 'virtual-thermal.local';

export class VirtualThermalPrinterAdapter extends ThermalPrinterAdapter {
  #captureDir; #logger; #clock; #jobDelayMs;
  #host; #port;
  #fault = null;
  #seq = 0;
  #receipts = [];
  #queue = Promise.resolve();

  /**
   * @param {Object} config
   * @param {string} config.captureDir - directory that stands in for the paper roll
   * @param {string} [config.host='virtual-thermal.local']
   * @param {number} [config.port=9100]
   * @param {boolean} [config.upsideDown]
   * @param {number} [config.jobDelayMs=0] - per-job dwell; the real adapter waits 500ms between jobs
   * @param {Object} [options]
   * @param {Object} [options.logger=console]
   * @param {() => Date} [options.clock]
   */
  constructor(config = {}, options = {}) {
    if (!config.captureDir) {
      throw new InfrastructureError('VirtualThermalPrinterAdapter requires captureDir', {
        code: 'MISSING_DEPENDENCY', dependency: 'captureDir',
      });
    }
    const host = config.host || VIRTUAL_HOST;
    const port = config.port || 9100;
    super({ ...config, host, port }, options);
    this.#captureDir = config.captureDir;
    this.#host = host;
    this.#port = port;
    this.#jobDelayMs = config.jobDelayMs ?? 0;
    this.#logger = options.logger || console;
    this.#clock = options.clock || (() => new Date());
  }

  get captureDir() { return this.#captureDir; }

  // -------------------------------------------------------------------------
  // Overridden real-adapter surface
  // -------------------------------------------------------------------------

  /**
   * @param {import('./ThermalPrinterAdapter.mjs').PrintJob} printJob
   * @returns {Promise<boolean>} false on any failure — never rejects
   */
  async print(printJob) {
    // Same serialization guarantee as the real adapter: one job at a time,
    // chained off a promise, so back-to-back receipts can never interleave.
    // A failure resolves false — the real adapter never rejects from print().
    const run = this.#queue.then(() => this.#capture(printJob).catch((e) => {
      this.#logger.error?.('virtual-thermal.queue.error', { error: e.message });
      return false;
    }));
    this.#queue = run;
    return run;
  }

  /**
   * @returns {Promise<{success:boolean, latency:number, configured:boolean, host:string, port:number, error?:string, message?:string}>}
   */
  async ping() {
    const base = { host: this.#host, port: this.#port, latency: 0, configured: true };
    if (this.#fault === 'offline') {
      return { success: false, error: 'Connection failed', ...base };
    }
    return { success: true, message: 'Printer is reachable', ...base };
  }

  /**
   * @returns {Promise<Object>} same shape the real adapter derives from the DLE EOT queries
   */
  async getStatus() {
    if (this.#fault === 'offline') {
      return { success: false, error: 'Connection failed', details: `connect ECONNREFUSED ${this.#host}:${this.#port}` };
    }
    const jammed = this.#fault === 'jam';
    return {
      success: true,
      online: true,
      feedButtonEnabled: 'unknown',
      paperPresent: !jammed,
      errors: jammed ? ['auto_recoverable_error'] : [],
      coverOpen: false,
      cutterOk: true,
      rawResponses: [],
      timestamp: nowTs24(),
    };
  }

  // -------------------------------------------------------------------------
  // Double-only surface (tests + virtual device console)
  // -------------------------------------------------------------------------

  /** @returns {Array<Object>} captures in submission order */
  listReceipts() {
    return this.#receipts.map((r) => ({ ...r }));
  }

  /**
   * @param {string} receiptId
   * @returns {Object|null}
   */
  readReceipt(receiptId) {
    const found = this.#receipts.find((r) => r.receiptId === receiptId);
    return found ? { ...found } : null;
  }

  /** @returns {string|null} decoded transcript of the most recent receipt */
  lastTranscript() {
    return this.#receipts.length ? this.#receipts[this.#receipts.length - 1].transcript : null;
  }

  /** @param {'offline'|'jam'|null} fault */
  setFault(fault) {
    if (fault !== null && !FAULTS.includes(fault)) {
      throw new InfrastructureError(`unknown thermal printer fault: ${fault} (expected ${FAULTS.join('|')} or null)`, {
        code: 'INVALID_FAULT', fault,
      });
    }
    this.#fault = fault;
    this.#logger.info?.('virtual-thermal.fault', { fault });
  }

  /** @returns {'offline'|'jam'|null} */
  getFault() { return this.#fault; }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  async #capture(printJob) {
    if (this.#jobDelayMs > 0) await new Promise((r) => setTimeout(r, this.#jobDelayMs));

    if (!printJob?.items || !Array.isArray(printJob.items)) {
      this.#logger.error?.('virtual-thermal.invalidJob', { message: 'Must have items array' });
      return false;
    }
    if (this.#fault === 'offline') {
      this.#logger.error?.('virtual-thermal.connect.failed', { host: this.#host });
      return false;
    }

    const receiptId = `receipt_${String(++this.#seq).padStart(4, '0')}`;
    // Transcript order is the AUTHORED order. The real adapter reverses items on
    // the wire for upside-down mounting; that is a wire concern, and reversing
    // the transcript would make every assertion read backwards.
    //
    // A renderer that already knows what it drew (the raster receipt renderer,
    // which has no text item for `transcribeEscPosItems` to read) hands that
    // knowledge over explicitly as `printJob.transcript`; that string wins
    // outright rather than being merged with a derived one, because a job that
    // set it deliberately chose it over whatever `items` alone would say.
    const transcript = typeof printJob.transcript === 'string'
      ? printJob.transcript
      : transcribeEscPosItems(printJob.items);
    const images = printJob.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === 'image')
      .map(({ item, index }) => ({
        index,
        path: item.path ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
      }));

    const capture = {
      receiptId,
      at: this.#clock().toISOString(),
      host: this.#host,
      port: this.#port,
      itemCount: printJob.items.length,
      footer: printJob.footer ?? null,
      items: printJob.items,
      images,
      transcript,
      // Pass-through, not derived: a raster job's scannable codes live in
      // drawn pixels, not in `qrcode`/`barcode` items, so anything that wants
      // to know what a child could scan off THIS receipt (the e2e harness's
      // `barcodesInLastReceipt`, among others) has to be told rather than
      // shown. `null` for a job that never set it — the normal ESC/POS-items
      // case, where a reader already has `items` to look at directly.
      codes: printJob.codes ?? null,
    };

    await fs.mkdir(this.#captureDir, { recursive: true });
    await fs.writeFile(path.join(this.#captureDir, `${receiptId}.json`), `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(this.#captureDir, `${receiptId}.txt`), transcript, 'utf8');
    this.#receipts.push(capture);

    this.#logger.info?.('virtual-thermal.receipt-captured', { receiptId, itemCount: printJob.items.length });
    return true;
  }
}

export default VirtualThermalPrinterAdapter;
