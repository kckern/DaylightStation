/**
 * ThermalPrinterAdapter - ESC/POS thermal printer control
 *
 * Provides network-based thermal printer control using ESC/POS protocol.
 * Features:
 * - Text, image, barcode, line, space printing
 * - Receipt and table formatting helpers
 * - Print job queueing to prevent concurrency issues
 * - Upside-down mode for mounted printers
 * - Ping and status querying
 *
 * @module adapters/hardware/thermal-printer
 */

import escpos from 'escpos';
import Network from 'escpos-network';
import { createConnection } from 'net';
import { createCanvas, loadImage } from 'canvas';
import { nowTs24 } from '#system/utils/index.mjs';
import { fileExists } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { encodeText } from './escposEncode.mjs';

/**
 * Code-page name → ESC/POS `ESC t n` table id (the standard Epson table; cheap
 * clones like the Volcora V-WLRP5 follow the low ids but may not implement every
 * one — hence configurable). The key doubles as the iconv-lite codec, so the
 * selected ROM page and the encoded bytes can never drift; every entry is
 * verified to exist in iconv-lite. CP858 (DOS Latin-1 + Euro) is the default:
 * it carries the Western-European accent set (ç é ñ ô ü à …) receipts need.
 */
const CODE_PAGE_IDS = {
  // Western / Latin
  cp437: 0,        // USA, Standard Europe
  cp850: 2,        // Latin-1 Multilingual
  cp860: 3,        // Portuguese
  cp863: 4,        // Canadian-French
  cp865: 5,        // Nordic
  cp857: 13,       // Turkish
  win1252: 16,     // Windows Latin-1 (richer punctuation; some units ignore it)
  cp1252: 16,      // alias for win1252
  cp852: 18,       // Latin-2 Central European
  cp858: 19,       // Latin-1 + Euro
  'iso-8859-2': 27, // ISO Latin-2
  'iso-8859-15': 28, // ISO Latin-9
  win1257: 38,     // Baltic
  win1258: 39,     // Vietnamese
  // Cyrillic
  cp866: 17,
  win1251: 33,
  // Greek
  cp869: 26,
  win1253: 34,
  // Turkish (Windows)
  win1254: 35,
  // Hebrew
  cp862: 24,
  win1255: 36,
  // Arabic
  win1256: 37,
};

const DEFAULT_CODE_PAGE = 'cp858';

/**
 * Connect timeout. 20s, not the old 5s: on 2026-08-25 the printer refused new
 * connections for ~11.5s after an abrupt close, and every job queued behind
 * that window timed out and (before the abort flag) resurrected as blank paper.
 *
 * Deliberately NOT derived from payload size — the observed lockout had nothing
 * to do with how big the job was. This guards CONNECT only; `device.open`'s
 * callback clears it, so a large job's own transfer and drain time is never
 * charged against it.
 *
 * NOTE: production never falls through to this default. `backend/src/app.mjs`
 * constructs the live adapter with an explicit `timeout` sourced from
 * `thermal_printer_defaults.timeout` in `data/system/config/adapters.yml` —
 * both printers inherit that config value. Changing this constant alone does
 * NOT change production behaviour; the config value must be changed too.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 20000;

/**
 * NUL bytes fed ahead of `ESC @` on the job following an unclean one, to be
 * eaten by a printer still counting an unfinished raster. Roughly seven
 * 576-dot raster lines' worth — enough for a small shortfall, cheap enough to
 * be harmless when the parser is already idle.
 */
const RESYNC_PAD_BYTES = 512;

/**
 * The four `DLE EOT n` real-time status queries, in the order they are asked.
 * Order is load-bearing: replies are one byte each and come back in the same
 * order, and `#parseStatusResponses` indexes them by position.
 *
 * These are REAL-TIME commands — the printer answers them immediately instead
 * of spooling them as content, which is why it is safe to send them down the
 * same raw port 9100 socket that carries a job.
 */
const STATUS_QUERIES = [
  Buffer.from([0x10, 0x04, 0x01]), // 1 - printer status
  Buffer.from([0x10, 0x04, 0x02]), // 2 - offline cause (the ONLY cover authority)
  Buffer.from([0x10, 0x04, 0x03]), // 3 - error status
  Buffer.from([0x10, 0x04, 0x04]), // 4 - paper sensor status
];

/** Gap between successive status queries, and the grace after the last one. */
const STATUS_QUERY_GAP_MS = 100;
const STATUS_REPLY_GRACE_MS = 200;

/**
 * How long to let the printer settle after a job's socket is destroyed before
 * opening a new one to ask how it went.
 *
 * `close()` is a `socket.destroy()`, and this printer refuses new connections
 * for a spell afterwards — an ~11.5 s lockout was observed 2026-08-25, and a
 * second connection arriving during a job is how that morning's incident
 * cascaded. The post-job read therefore never runs inside the `device.open`
 * callback; it waits out this settle and then connects on its own.
 */
export const POST_JOB_STATUS_SETTLE_MS = 1000;

/**
 * Timeout for the post-job status CONNECT only — deliberately NOT
 * `DEFAULT_CONNECT_TIMEOUT_MS`. That 20s guard exists for a job's own connect,
 * where a hung connection blocks paper the household is waiting on and must be
 * given every reasonable chance to land. A post-job status read is different:
 * it is pure bookkeeping (upgrading `unreadable` to `verified`, or catching a
 * mid-job paper-out), the caller already has their printed page in hand, and
 * this read sits directly in front of the next queued job. Probed read-only
 * 2026-08-25: a status connection that hangs can take up to ~42s to resolve —
 * with the connect guard reused here (as it originally was), 2 retries of that
 * could add well over a minute behind one job. Bounding it to a few seconds
 * caps the worst case near `POST_JOB_STATUS_SETTLE_MS + this value`, not
 * `DEFAULT_CONNECT_TIMEOUT_MS × POST_JOB_STATUS_ATTEMPTS`.
 */
export const POST_JOB_STATUS_TIMEOUT_MS = 2500;

/**
 * Post-job status read attempts. Was 2; a retry immediately after a refused
 * connection is unlikely to land (the printer is refusing because of its own
 * post-`destroy()` lockout, which does not clear inside one settle interval)
 * and simply doubles the worst-case delay in front of the next queued job. One
 * attempt, bounded by `POST_JOB_STATUS_TIMEOUT_MS`, is the whole fix: an
 * unreadable status already resolves to `verified: false` /
 * `verification: 'unreadable'` — never a fault — so a lone attempt costs
 * nothing in correctness, only in the rare case where a second try might have
 * caught a printer that recovered in the interim.
 */
const POST_JOB_STATUS_ATTEMPTS = 1;

/**
 * Blocking conditions read out of a parsed status, or `null` for "nothing to
 * report" — which includes "we learned nothing".
 *
 * A status read that failed, or answered nothing, is an ABSENCE of knowledge,
 * never a fault: treating silence as a fault would refuse every job the moment
 * the status path broke, and a broken status read must not stop a household
 * from printing. Each field is judged only when the query that carries it was
 * actually answered — replies arrive in query order, so an answer count is
 * exactly how far down the list we got.
 */
function faultsIn(status) {
  if (!status?.success) return null;
  const answered = status.answered || 0;
  if (answered < 1) return null;

  const faults = [];
  if (status.online === false) faults.push('offline');
  if (answered >= 2 && status.coverOpen === true) faults.push('cover_open');
  if (answered >= 3 && status.errors?.length) faults.push(...status.errors);
  if (answered >= 4 && status.paperPresent === false) faults.push('no_paper');
  return faults.length ? faults : null;
}

/**
 * Whether a status read told us everything we asked. Anything less leaves the
 * paper sensor (the last query, and the one the 2026-08-25 incident turned on)
 * unread, so the job cannot be called verified.
 */
function statusIsConclusive(status) {
  return status?.success === true && (status.answered || 0) >= STATUS_QUERIES.length;
}

/**
 * Build the claim tier `print()` resolves — see its doc comment for what each
 * `verification` value claims.
 *
 * `verified` is DERIVED, never passed in, so the boolean and the reason can
 * never disagree: it was two independent fields that let "faulted" and
 * "unreadable" be flattened into one `false` in the first place.
 */
function claimTier({ dispatched, verification, faults = null, printerState = null }) {
  return {
    dispatched,
    verified: verification === 'verified',
    verification,
    faults: faults?.length ? faults : null,
    printerState,
  };
}

function jobLogContext(printJob) {
  return typeof printJob?.jobName === 'string' && printJob.jobName.trim()
    ? { jobName: printJob.jobName.trim() }
    : {};
}

/**
 * @typedef {Object} PrinterConfig
 * @property {string} host - Printer IP address
 * @property {number} [port=9100] - Printer port
 * @property {number} [timeout=5000] - Connection timeout in ms
 * @property {string} [encoding='utf8'] - Text encoding
 * @property {boolean} [upsideDown=true] - Enable upside-down mode for mounted printers
 */

/**
 * @typedef {Object} PrintItem
 * @property {'text'|'image'|'barcode'|'qrcode'|'line'|'space'|'cut'|'feedButton'} type
 * @property {string} [content] - Text content or image path
 * @property {'left'|'center'|'right'} [align='left'] - Text alignment
 * @property {Object} [size] - Text size {width, height}
 * @property {'a'|'b'} [font] - Font selection
 * @property {Object} [style] - {bold, underline, invert}
 * @property {string} [path] - Image file path
 * @property {number} [width] - Image width in pixels
 * @property {number} [height] - Image height in pixels
 * @property {number} [threshold=128] - B&W threshold (0-255)
 * @property {'CODE128'|'EAN13'|'EAN8'|'UPC'} [format] - Barcode format
 * @property {number} [barcodeHeight=64] - Barcode height in dots
 * @property {number} [lines=1] - Number of blank lines for space
 * @property {boolean} [enabled] - Feed button enabled state
 */

/**
 * @typedef {Object} PrintJob
 * @property {PrinterConfig} [config] - Override default config
 * @property {PrintItem[]} items - Array of items to print
 * @property {Object} [footer] - Footer options {paddingLines, autoCut}
 */

export class ThermalPrinterAdapter {
  #host;
  #port;
  #timeout;
  #encoding;
  #codepage;
  #codePageId;
  #upsideDown;
  #logger;
  #printQueue;
  #createTransport;
  #needsResync = false;
  #statusSettleMs;

  /**
   * @param {PrinterConfig} config
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   * @param {(host: string, port: number) => object} [options.createTransport]
   *   Builds the ESC/POS byte transport (`open`/`write`/`close`). Defaults to
   *   the real `escpos-network`. This exists as a TEST SEAM: `escpos-network` is
   *   CJS, so an `import` of it from this ESM module resolves through interop
   *   and Jest's module mocks never intercept it — a test that thinks it has
   *   mocked the socket silently opens a real one and prints. Injecting the
   *   transport is the only reliable way to exercise the write/close contract
   *   without paper coming out of a printer.
   * @param {number} [options.statusSettleMs] - pause between a job's socket
   *   being destroyed and the post-job status connection. Defaults to
   *   `POST_JOB_STATUS_SETTLE_MS`; tests shorten it.
   */
  constructor(config, options = {}) {
    this.#host = config.host;
    this.#port = config.port || 9100;
    this.#timeout = config.timeout || DEFAULT_CONNECT_TIMEOUT_MS;
    this.#encoding = config.encoding || 'utf8';
    this.#codepage = (config.codepage || DEFAULT_CODE_PAGE).toLowerCase();
    this.#codePageId = CODE_PAGE_IDS[this.#codepage] ?? CODE_PAGE_IDS[DEFAULT_CODE_PAGE];
    this.#upsideDown = config.upsideDown !== false; // Default true
    this.#logger = options.logger || console;
    this.#printQueue = Promise.resolve();
    this.#createTransport = options.createTransport
      || ((host, port) => new Network(host, port));
    this.#statusSettleMs = Number.isFinite(options.statusSettleMs)
      ? options.statusSettleMs
      : POST_JOB_STATUS_SETTLE_MS;
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.#host);
  }

  /**
   * Get printer host
   * @returns {string}
   */
  getHost() {
    return this.#host;
  }

  /**
   * Get printer port
   * @returns {number}
   */
  getPort() {
    return this.#port;
  }

  /**
   * Ping printer to check if it's reachable.
   *
   * Opens a raw TCP connection and closes it immediately. NEVER writes any
   * bytes — this is important because raw port 9100 is ESC/POS, and any
   * unsolicited bytes would be spooled and printed as garbage.
   *
   * @returns {Promise<{success: boolean, latency?: number, error?: string, configured: boolean}>}
   */
  async ping() {
    if (!this.#host) {
      return { success: false, error: 'Printer IP not configured', configured: false };
    }

    const startTime = Date.now();
    const host = this.#host;
    const port = this.#port;
    const timeout = this.#timeout;

    return new Promise((resolve) => {
      const socket = createConnection({ host, port });
      let settled = false;
      let timeoutHandle = null;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        try { socket.destroy(); } catch { /* noop */ }
        resolve(result);
      };

      socket.setTimeout(timeout);

      // Independent timeout guard — the socket's own setTimeout may not
      // fire in all environments (e.g. mocked sockets in unit tests), so
      // we enforce the bound ourselves too.
      timeoutHandle = setTimeout(() => {
        finish({
          success: false,
          error: 'Connection timeout',
          host, port,
          latency: Date.now() - startTime,
          configured: true,
        });
      }, timeout);

      socket.once('connect', () => {
        // Close cleanly WITHOUT writing anything.
        try { socket.end(); } catch { /* noop */ }
        finish({
          success: true,
          message: 'Printer is reachable',
          host, port,
          latency: Date.now() - startTime,
          configured: true,
        });
      });

      socket.once('timeout', () => {
        finish({
          success: false,
          error: 'Connection timeout',
          host, port,
          latency: Date.now() - startTime,
          configured: true,
        });
      });

      socket.once('error', (err) => {
        finish({
          success: false,
          error: err.message || 'Connection failed',
          host, port,
          latency: Date.now() - startTime,
          configured: true,
        });
      });
    });
  }

  /**
   * Query printer status on a connection of its own.
   *
   * Opens, asks the four `DLE EOT` queries, closes. NEVER call this while a job
   * holds the socket: this printer refuses concurrent connections, and a second
   * connection arriving mid-job is how the 2026-08-25 incident cascaded. The
   * print path's own pre-flight rides the job's socket instead (see
   * `#executePrintJob`), and its post-job read runs only after `device.close()`.
   *
   * @param {number} [timeoutMs] - Connect timeout for THIS call only. Defaults
   *   to the adapter's configured connect timeout (`this.#timeout`, the
   *   post-destroy-lockout guard) so every caller except the post-job path
   *   keeps its existing behaviour unchanged. The post-job read passes
   *   `POST_JOB_STATUS_TIMEOUT_MS` explicitly — that read is bookkeeping after
   *   paper is already in hand, not a job the household is waiting on, and it
   *   sits in front of the next queued job.
   * @returns {Promise<{success: boolean, online?: boolean, paperPresent?: boolean, errors?: string[]}>}
   */
  async getStatus(timeoutMs = this.#timeout) {
    if (!this.#host) {
      return { success: false, error: 'Printer IP not configured' };
    }

    const device = this.#createTransport(this.#host, this.#port);

    return new Promise((resolve) => {
      let settled = false;
      let timeoutId = null;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        try { device.close(); } catch { /* never connected — nothing to destroy */ }
        resolve(result);
      };

      timeoutId = setTimeout(
        () => finish({ success: false, error: 'Connection timeout' }),
        timeoutMs,
      );

      device.open(async (error) => {
        if (error) {
          finish({ success: false, error: 'Connection failed', details: error.message });
          return;
        }
        if (typeof device.read !== 'function') {
          // A write-only transport cannot carry an answer. Say so rather than
          // parsing an empty response set into a printer that looks broken.
          finish({ success: false, error: 'Transport cannot read replies' });
          return;
        }
        const status = await this.#queryStatusOn(device);
        finish(status || { success: false, error: 'Query processing error' });
      });
    });
  }

  /**
   * Print a job.
   *
   * WHAT THE RETURN VALUE CLAIMS — and what it deliberately does not.
   *
   * `dispatched` means our bytes reached the socket and the printer was not
   * reporting a blocking fault when we handed them over. `verified` means that
   * after the job we asked again and it still reported itself able to print
   * with nothing wrong — which is how a roll that ran out MID-receipt is
   * caught, and it is the only tier a caller may turn into a permanent,
   * cooldown-arming fact.
   *
   * `verified` is NOT "this raster rendered". Probed 2026-08-25: this hardware
   * answers all four `DLE EOT` queries but supports neither `GS r` nor `ESC v`,
   * so there is NO end-of-job barrier to wait on — nothing the printer will
   * tell us corresponds to "the paper you asked for came out". The tier means
   * exactly "the printer reports it CAN print, and reports no fault after the
   * job". Do not read more into it.
   *
   * A status read that fails tells us nothing, and nothing is not a fault: it
   * drops `verified` to false and never blocks the job.
   *
   * WHICH IS WHY `verified: false` ALONE IS NOT A REPORTABLE OUTCOME. It covers
   * two incompatible situations — "I asked and the printer reported a fault"
   * and "I asked and heard nothing" — and a caller that cannot tell them apart
   * has to guess. It guessed wrong on 2026-08-25: a caller read every silence
   * as a failed print and told children their worksheets had not printed while
   * they sat in the tray. `verification` carries the distinction across the
   * seam so no caller has to infer it:
   *
   *   'verified'   — asked after the job, printer reported itself able to print
   *                  with nothing wrong. The only tier that may become a
   *                  permanent, cooldown-arming fact.
   *   'faulted'    — the printer REPORTED a blocking condition (paper out,
   *                  cover open, error). Positive evidence of failure, whether
   *                  it came from the pre-flight or the post-job read;
   *                  `faults` names them.
   *   'unreadable' — nothing could be learned: no reply, a refused connection,
   *                  a partial answer, or a write-only transport. NOT evidence
   *                  of failure in either direction. On this hardware it is the
   *                  ordinary case, because port 9100 is fire-and-forget and
   *                  gives no per-job acknowledgment.
   *
   * `verified` is retained as exactly `verification === 'verified'`, so callers
   * and doubles written against the two-field tier keep working.
   *
   * @param {PrintJob} printJob
   * @returns {Promise<{dispatched: boolean, verified: boolean,
   *   verification: 'verified'|'faulted'|'unreadable', faults: string[]|null,
   *   printerState: object|null}>}
   */
  async print(printJob) {
    const result = await new Promise((resolve) => {
      this.#printQueue = this.#printQueue.then(async () => {
        try {
          await new Promise(r => setTimeout(r, 500)); // Delay between jobs
          resolve(await this.#printWithClaimTier(printJob));
        } catch (e) {
          this.#logger.error?.('thermalPrinter.queue.error', { error: e.message });
          resolve(claimTier({ dispatched: false, verification: 'unreadable' }));
        }
      });
    });
    return result;
  }

  async #printWithClaimTier(printJob) {
    const logContext = jobLogContext(printJob);
    const outcome = await this.#executePrintJob(printJob);
    const preflightState = outcome.printerState ?? null;

    if (!outcome.dispatched) {
      // A pre-flight refusal is the printer SAYING it cannot print; a connect
      // failure or a job that could not be built is silence. Both stop the job
      // here, but only the first is evidence about the printer's condition.
      const preflightFaults = faultsIn(preflightState);
      return claimTier({
        dispatched: false,
        verification: preflightFaults ? 'faulted' : 'unreadable',
        faults: preflightFaults,
        printerState: preflightState,
      });
    }
    if (!outcome.statusCapable) {
      // Nothing on this transport can answer, so nothing here can be verified.
      return claimTier({
        dispatched: true, verification: 'unreadable', printerState: preflightState,
      });
    }

    const post = await this.#readStatusAfterJob(logContext);
    const faults = faultsIn(post);
    if (faults) {
      this.#logger.error?.('thermalPrinter.postjob.fault', {
        target: `${this.#host}:${this.#port}`, faults, ...logContext,
      });
      return claimTier({
        dispatched: true, verification: 'faulted', faults, printerState: post,
      });
    }
    if (!statusIsConclusive(post)) {
      this.#logger.warn?.('thermalPrinter.postjob.unverified', {
        target: `${this.#host}:${this.#port}`,
        error: post?.error ?? null,
        answered: post?.answered ?? 0,
        ...logContext,
      });
      return claimTier({
        dispatched: true, verification: 'unreadable', printerState: post ?? null,
      });
    }
    this.#logger.info?.('thermalPrinter.postjob.ok', {
      target: `${this.#host}:${this.#port}`,
      ...logContext,
    });
    return claimTier({ dispatched: true, verification: 'verified', printerState: post });
  }

  /**
   * Ask how the job went — AFTER the job's socket is gone, never during.
   *
   * Uses `POST_JOB_STATUS_TIMEOUT_MS`, NOT `this.#timeout` (the connect guard
   * a job's own socket relies on for the post-destroy lockout) — see that
   * constant's doc comment for why the two must not share a value.
   */
  async #readStatusAfterJob(logContext = {}) {
    let last = null;
    for (let attempt = 1; attempt <= POST_JOB_STATUS_ATTEMPTS; attempt += 1) {
      await new Promise((r) => setTimeout(r, this.#statusSettleMs));
      last = await this.getStatus(POST_JOB_STATUS_TIMEOUT_MS);
      if (statusIsConclusive(last) || faultsIn(last)) return last;
      this.#logger.warn?.('thermalPrinter.postjob.status-unreadable', {
        attempt, error: last?.error ?? null,
        ...logContext,
      });
    }
    return last;
  }

  /**
   * Create a simple text print job
   * @param {string} text
   * @param {Object} [options]
   * @returns {PrintJob}
   */
  createTextPrint(text, options = {}) {
    return {
      config: options.config,
      items: [{
        type: 'text',
        content: text,
        align: options.align || 'left',
        size: options.size,
        style: options.style
      }],
      footer: options.footer
    };
  }

  /**
   * Create an image print job
   * @param {string} imagePath
   * @param {Object} [options]
   * @returns {PrintJob}
   */
  createImagePrint(imagePath, options = {}) {
    return {
      config: options.config,
      items: [{
        type: 'image',
        path: imagePath,
        width: options.width || 575,
        height: options.height,
        align: options.align || 'center',
        threshold: options.threshold || 128
      }],
      footer: options.footer
    };
  }

  /**
   * Create a receipt-style print job
   * @param {Object} receiptData
   * @returns {PrintJob}
   */
  createReceiptPrint(receiptData) {
    const items = [];

    if (receiptData.header) {
      items.push({
        type: 'text',
        content: receiptData.header,
        align: 'center',
        size: { width: 2, height: 2 },
        style: { bold: true }
      });
      items.push({ type: 'space', lines: 1 });
    }

    if (receiptData.datetime !== false) {
      items.push({
        type: 'text',
        content: receiptData.datetime || new Date().toLocaleString(),
        align: 'center'
      });
      items.push({ type: 'line', align: 'center', width: 32 });
      items.push({ type: 'space', lines: 1 });
    }

    if (receiptData.items) {
      receiptData.items.forEach(item => {
        items.push({
          type: 'text',
          content: `${item.name}${item.price ? ` - $${item.price}` : ''}`,
          align: 'left'
        });
      });
      items.push({ type: 'space', lines: 1 });
    }

    if (receiptData.total) {
      items.push({ type: 'line', align: 'center', width: 32 });
      items.push({
        type: 'text',
        content: `TOTAL: $${receiptData.total}`,
        align: 'center',
        style: { bold: true }
      });
    }

    if (receiptData.footer) {
      items.push({ type: 'space', lines: 1 });
      items.push({
        type: 'text',
        content: receiptData.footer,
        align: 'center'
      });
    }

    return {
      config: receiptData.config,
      items,
      footer: { paddingLines: 3, autoCut: true }
    };
  }

  /**
   * Create a table print job
   * @param {Object} tableData
   * @returns {PrintJob}
   */
  createTablePrint(tableData) {
    const { title, headers = [], rows = [], width = 48, config, footer } = tableData;
    const items = [];

    const numCols = headers.length || (rows.length > 0 ? rows[0].length : 0);
    if (numCols === 0) {
      throw new InfrastructureError('Table must have headers or data rows', {
        code: 'VALIDATION_ERROR'
      });
    }

    const separatorSpace = numCols + 1;
    const availableWidth = width - separatorSpace;
    const colWidth = Math.floor(availableWidth / numCols);

    const padText = (text, width, align = 'left') => {
      const str = String(text || '');
      let visualWidth = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char.match(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/)) {
          visualWidth += 2;
        } else {
          visualWidth += 1;
        }
      }

      if (visualWidth > width) {
        let truncated = '';
        let currentWidth = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str[i];
          const charWidth = char.match(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/) ? 2 : 1;
          if (currentWidth + charWidth > width) break;
          truncated += char;
          currentWidth += charWidth;
        }
        return truncated.padEnd(width, ' ');
      }

      const padding = width - visualWidth;
      if (align === 'center') {
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
      } else if (align === 'right') {
        return ' '.repeat(padding) + str;
      }
      return str + ' '.repeat(padding);
    };

    const createSeparator = () => {
      let line = '+';
      for (let i = 0; i < numCols; i++) {
        line += '-'.repeat(colWidth);
        line += i < numCols - 1 ? '+' : '+';
      }
      return line;
    };

    const createRow = (data) => {
      let row = '|';
      for (let i = 0; i < numCols; i++) {
        const cellData = data[i] || '';
        const align = (i === numCols - 1 && !isNaN(cellData)) ? 'right' : 'left';
        row += padText(cellData, colWidth, align) + '|';
      }
      return row;
    };

    if (title) {
      items.push({ type: 'text', content: title, align: 'center', style: { bold: true } });
      items.push({ type: 'space', lines: 1 });
    }

    items.push({ type: 'text', content: createSeparator(), align: 'left' });

    if (headers.length > 0) {
      items.push({ type: 'text', content: createRow(headers), align: 'left', style: { bold: true } });
      items.push({ type: 'text', content: createSeparator(), align: 'left' });
    }

    rows.forEach(row => {
      items.push({ type: 'text', content: createRow(row), align: 'left' });
    });

    items.push({ type: 'text', content: createSeparator(), align: 'left' });

    return {
      config,
      items,
      footer: footer || { paddingLines: 2, autoCut: true }
    };
  }

  /**
   * Set feed button state
   * @param {boolean} enabled
   * @returns {PrintJob}
   */
  setFeedButton(enabled) {
    return {
      items: [{ type: 'feedButton', enabled }],
      footer: { paddingLines: 0, autoCut: false }
    };
  }

  /**
   * Test feed button functionality
   * Migrated from: thermalprint.mjs:1126-1156
   * @returns {Promise<{success: boolean, message?: string, steps?: Object, note?: string, error?: string, details?: string}>}
   */
  async testFeedButton() {
    try {
      this.#logger.info?.('thermalPrinter.testFeedButton.start');

      // Step 1: Disable feed button. `dispatched` is the right bar here: this
      // sets a printer mode, it puts no paper out, so there is nothing for the
      // post-job status tier to add.
      const disableResult = (await this.print(this.setFeedButton(false))).dispatched;
      if (!disableResult) {
        return { success: false, error: 'Feed button test failed', details: 'Failed to disable feed button' };
      }

      // Wait a moment (legacy uses 1000ms)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 2: Enable feed button
      const enableResult = (await this.print(this.setFeedButton(true))).dispatched;
      if (!enableResult) {
        return { success: false, error: 'Feed button test failed', details: 'Failed to enable feed button' };
      }

      this.#logger.info?.('thermalPrinter.testFeedButton.complete');

      // Match legacy return shape with steps and note
      return {
        success: true,
        message: 'Feed button test completed successfully',
        steps: {
          disable: disableResult,
          enable: enableResult
        },
        note: 'Check printer physically to verify feed button response'
      };
    } catch (error) {
      this.#logger.error?.('thermalPrinter.testFeedButton.error', { error: error.message });
      // Match legacy error shape with 'error' and 'details' fields
      return { success: false, error: 'Feed button test failed', details: error.message };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Open, (optionally) ask the printer whether it can print, write, drain,
   * close.
   *
   * @returns {Promise<{dispatched: boolean, printerState: object|null, statusCapable: boolean}>}
   *   `statusCapable` reports whether this transport can carry a reply at all,
   *   so the caller knows whether a post-job read is worth attempting.
   */
  async #executePrintJob(printJob) {
    const startTime = Date.now();
    const logContext = jobLogContext(printJob);
    const undispatched = (printerState = null, statusCapable = false) =>
      ({ dispatched: false, printerState, statusCapable });

    try {
      if (!printJob?.items || !Array.isArray(printJob.items)) {
        this.#logger.error?.('thermalPrinter.invalidJob', { message: 'Must have items array' });
        return undispatched();
      }

      const config = {
        host: this.#host,
        port: this.#port,
        timeout: this.#timeout,
        encoding: this.#encoding,
        upsideDown: this.#upsideDown,
        ...printJob.config
      };

      if (!config.host) {
        this.#logger.error?.('thermalPrinter.noHost', { message: 'Printer IP not configured' });
        return undispatched();
      }

      this.#logger.info?.('thermalPrinter.job.start', {
        target: `${config.host}:${config.port}`,
        itemCount: printJob.items.length,
        upsideDown: config.upsideDown,
        ...logContext,
      });

      // A job that renders itself as a single `{type:'image'}` (the School
      // receipt raster path) puts nothing decodable on the wire for a human
      // reviewing production logs — the paper says plenty, the log says
      // "itemCount: 1". `printJob.transcript`, when the renderer set one, is
      // that operator record: the same words a text-item job would have put
      // on the wire, logged instead of printed twice. Absent for every job
      // that never set it (the ordinary ESC/POS case, where `itemCount` plus
      // the items above already tell the story).
      if (typeof printJob.transcript === 'string' && printJob.transcript) {
        this.#logger.info?.('thermalPrinter.job.transcript', {
          target: `${config.host}:${config.port}`,
          transcript: printJob.transcript,
          ...logContext,
        });
      }

      const device = this.#createTransport(config.host, config.port);

      return new Promise((resolve) => {
        // A timed-out job must be ABANDONED, not merely reported.
        //
        // This guard covers CONNECT only — `device.open`'s callback clears it.
        // `escpos-network`'s `open()` is a bare `net.Socket.connect` with no
        // connect timeout of its own, so before this flag existed the pending
        // connect stayed live after `resolve(false)`: when it finally landed,
        // the entire job body ran against a scratch PNG that ReceiptPrinting's
        // `finally` had already deleted. The printer got headers + footer + cut
        // and no raster — blank paper, auto-cut, while the caller had been told
        // the print was refused. 2026-08-25 incident.
        //
        // `close()` is a `socket.destroy()`, which also aborts a connect that
        // is still in progress. That is the point: it frees the printer's
        // single connection slot instead of leaving a zombie queued ahead of
        // the next legitimate job.
        let aborted = false;
        const timeoutId = setTimeout(() => {
          aborted = true;
          this.#needsResync = true;
          this.#logger.error?.('thermalPrinter.timeout', { timeout: config.timeout, ...logContext });
          try { device.close(); } catch { /* never connected — nothing to destroy */ }
          resolve(undispatched());
        }, config.timeout);

        device.open(async (error) => {
          clearTimeout(timeoutId);

          if (aborted) {
            // The connect landed after we gave up. Named, not silently dropped:
            // this distinguishes a printer that is merely SLOW from one that is
            // unreachable, and it is the only signal that the timeout is tuned
            // too tight.
            this.#logger.warn?.('thermalPrinter.open.after-abort', {
              target: `${config.host}:${config.port}`,
              ...logContext,
            });
            try { device.close(); } catch { /* best effort */ }
            return;
          }

          if (error) {
            this.#logger.error?.('thermalPrinter.connect.failed', { error: error.message, ...logContext });
            resolve(undispatched());
            return;
          }

          // PRE-FLIGHT, ON THE JOB'S OWN SOCKET.
          //
          // Asking on a second connection would mean two connects bracketing
          // every job, and this printer refuses concurrent ones — that is
          // exactly how the 2026-08-25 morning cascaded. Asking here costs no
          // extra connection and is the strongest possible pre-condition: it is
          // the same socket that is about to carry the job.
          //
          // Skipped entirely when the transport cannot `read`. A write-only
          // transport cannot carry an answer, and inventing a fault out of
          // silence would refuse every job — the failure mode this pre-flight
          // exists to prevent, not to cause.
          const statusCapable = typeof device.read === 'function';
          let preflight = null;
          if (statusCapable) {
            preflight = await this.#queryStatusOn(device);
            const faults = faultsIn(preflight);
            if (faults) {
              this.#logger.warn?.('thermalPrinter.preflight.refused', {
                target: `${config.host}:${config.port}`, faults, ...logContext,
              });
              // Not a byte of the job goes out. Refusing here is the whole
              // point: paper that will not come out must not be recorded as
              // paper that did.
              try { device.close(); } catch { /* best effort */ }
              resolve(undispatched(preflight, true));
              return;
            }
            this.#logger.info?.('thermalPrinter.preflight.ok', {
              target: `${config.host}:${config.port}`,
              answered: preflight?.answered ?? 0,
              ...logContext,
            });
          }

          try {
            // RESYNC PAD — only after a job we know did not finish cleanly.
            //
            // A job that dies mid-`GS v 0` leaves the printer counting raster
            // bytes it never received; it then swallows the next job's `ESC @`
            // as bitmap payload and prints that job horizontally shifted. NULs
            // are ignored in command state, so feeding some before the init
            // gives a still-counting parser something harmless to eat.
            //
            // Best-effort and deliberately NOT on every job: the shortfall can
            // be kilobytes (a 576-dot-wide receipt is 72 bytes per raster line),
            // so no fixed pad can guarantee resync, and taxing every print for a
            // case that should not happen once the flush wait above is honoured
            // would be cargo cult. The real fix is not truncating.
            let commands = Buffer.alloc(0);
            if (this.#needsResync) {
              this.#logger.warn?.('thermalPrinter.resync.prepended', {
                bytes: RESYNC_PAD_BYTES,
                reason: 'previous job did not flush cleanly',
              });
              commands = Buffer.alloc(RESYNC_PAD_BYTES, 0x00);
              this.#needsResync = false;
            }
            commands = Buffer.concat([commands, Buffer.from([0x1B, 0x40])]); // ESC @ - Initialize
            // ESC t n — select the character code page. Bytes written for text
            // items are iconv-encoded to the matching codec (see #processTextItem),
            // so the ROM page and the byte stream stay in lockstep.
            commands = Buffer.concat([commands, Buffer.from([0x1B, 0x74, this.#codePageId])]);

            if (config.upsideDown) {
              commands = Buffer.concat([commands, Buffer.from([0x1B, 0x7B, 0x01])]);
            }

            const sortedItems = config.upsideDown ? [...printJob.items].reverse() : printJob.items;

            for (const item of sortedItems) {
              const itemCommands = await this.#processItem(item, config);
              if (itemCommands) {
                commands = Buffer.concat([commands, itemCommands]);
              }
            }

            // Footer padding
            for (let i = 0; i < 6; i++) {
              commands = Buffer.concat([commands, Buffer.from('\n')]);
            }

            // Auto-cut
            const footer = printJob.footer || {};
            if (footer.autoCut !== false) {
              commands = Buffer.concat([commands, Buffer.from([0x1D, 0x56, 0x00])]);
            }

            // Reset upside down
            if (config.upsideDown) {
              commands = Buffer.concat([commands, Buffer.from([0x1B, 0x7B, 0x00])]);
            }

            // WAIT FOR THE FLUSH — do not close on a timer (2026-08-22).
            //
            // `escpos-network.write` forwards this callback to
            // `net.Socket.write`, so it fires when the bytes have left OUR
            // buffer. The previous code discarded it and closed after a fixed
            // 1000 ms; because that library's `close()` is a `socket.destroy()`,
            // any remainder still queued was thrown away. A long receipt (the
            // School raster path is hundreds of KB, and the printer applies TCP
            // backpressure by accepting bytes at printing speed) therefore
            // truncated mid-raster — and the printer, still counting bitmap
            // bytes it never received, consumed the NEXT job's `ESC @` as image
            // data and rendered that job horizontally shifted.
            await new Promise((flushed, failed) => {
              device.write(commands, (err) => (err ? failed(err) : flushed()));
            });

            // Our buffer is empty; the printer's is not. Give it a moment to
            // drain before dropping the socket, scaled to what we actually sent
            // rather than a constant that was only ever right for short jobs.
            const drainMs = Math.min(15000, 500 + Math.ceil(commands.length / 1024) * 20);
            await new Promise((r) => setTimeout(r, drainMs));

            device.close();
            this.#logger.info?.('thermalPrinter.job.complete', {
              duration: Date.now() - startTime,
              bytes: commands.length,
              drainMs,
              ...logContext,
            });
            resolve({ dispatched: true, printerState: preflight, statusCapable });

          } catch (processingError) {
            // Includes a write that never flushed AND an item that could not be
            // built at all — see `#processItem`. Either way the printer may be
            // holding a half-delivered raster, so the NEXT job leads with a
            // resync pad. Nothing is written for a job that failed to build, so
            // no blank paper is cut.
            this.#needsResync = true;
            this.#logger.error?.('thermalPrinter.process.error', { error: processingError.message, ...logContext });
            device.close();
            resolve(undispatched(preflight, statusCapable));
          }
        });
      });

    } catch (error) {
      this.#logger.error?.('thermalPrinter.error', { error: error.message });
      return undispatched();
    }
  }

  /**
   * Ask the four `DLE EOT` queries on an ALREADY-OPEN transport.
   *
   * @param {{read: Function, write: Function}} device
   * @returns {Promise<object|null>} parsed status, or null if the exchange
   *   could not even be attempted.
   */
  async #queryStatusOn(device) {
    return new Promise((resolve) => {
      try {
        const responses = [];
        // `escpos-network` surfaces printer bytes ONLY through `read(cb)`, which
        // attaches to the underlying socket. Its `on('data')` is the WRAPPER's
        // own EventEmitter and never re-emits what the socket received —
        // listening there is why every status read parsed an empty response set
        // and reported a healthy printer as offline with no paper.
        device.read((data) => { responses.push(data); });

        let queryIndex = 0;
        const sendNextQuery = () => {
          if (queryIndex < STATUS_QUERIES.length) {
            device.write(STATUS_QUERIES[queryIndex]);
            queryIndex += 1;
            setTimeout(sendNextQuery, STATUS_QUERY_GAP_MS);
            return;
          }
          setTimeout(() => {
            resolve({
              success: true,
              ...this.#parseStatusResponses(responses),
              timestamp: nowTs24(),
            });
          }, STATUS_REPLY_GRACE_MS);
        };

        sendNextQuery();
      } catch (queryError) {
        this.#logger.warn?.('thermalPrinter.status.query-failed', { error: queryError.message });
        resolve(null);
      }
    });
  }

  async #processItem(item, config) {
    let commands = Buffer.alloc(0);

    try {
      switch (item.type) {
        case 'text':
          commands = this.#processTextItem(item);
          break;
        case 'image':
          commands = await this.#processImageItem(item);
          break;
        case 'barcode':
          commands = this.#processBarcodeItem(item);
          break;
        case 'qrcode':
          commands = this.#processQrcodeItem(item);
          break;
        case 'line':
          commands = this.#processLineItem(item);
          break;
        case 'space':
          commands = this.#processSpaceItem(item);
          break;
        case 'cut':
          commands = Buffer.from([0x1D, 0x56, 0x00]);
          break;
        case 'feedButton':
          commands = Buffer.from([0x1B, 0x63, 0x35, item.enabled ? 0x01 : 0x00]);
          break;
        default:
          this.#logger.warn?.('thermalPrinter.unknownItemType', { type: item.type });
      }
    } catch (error) {
      // A JOB THAT CANNOT BUILD ITS CONTENT IS A FAILED JOB.
      //
      // This used to log and hand back whatever had accumulated, so a receipt
      // whose image failed to load still emitted header, padding and AUTO-CUT:
      // blank paper, cut and dispensed, logged as `job.complete`. Propagating
      // unwinds before a single byte is written — `#executePrintJob` builds the
      // whole buffer before it writes — so nothing is printed and nothing is cut.
      this.#logger.error?.('thermalPrinter.processItem.error', { type: item.type, error: error.message });
      throw error;
    }

    return commands;
  }

  #processTextItem(item) {
    let commands = Buffer.alloc(0);

    // Alignment
    if (item.align) {
      const alignCode = item.align === 'center' ? 0x01 : item.align === 'right' ? 0x02 : 0x00;
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
    }

    // Size
    if (item.size) {
      const width = Math.max(1, Math.min(8, item.size.width || 1));
      const height = Math.max(1, Math.min(8, item.size.height || 1));
      commands = Buffer.concat([commands, Buffer.from([0x1D, 0x21, ((width - 1) << 4) | (height - 1)])]);
    }

    // Font
    if (item.font) {
      const fontCode = item.font === 'b' ? 0x01 : 0x00;
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x4D, fontCode])]);
    }

    // Styles
    if (item.style) {
      if (item.style.bold !== undefined) {
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x45, item.style.bold ? 0x01 : 0x00])]);
      }
      if (item.style.underline !== undefined) {
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x2D, item.style.underline ? 0x01 : 0x00])]);
      }
      if (item.style.invert !== undefined) {
        commands = Buffer.concat([commands, Buffer.from([0x1D, 0x42, item.style.invert ? 0x01 : 0x00])]);
      }
    }

    // Content
    if (item.content) {
      // Encode to the printer's selected code page (NOT raw UTF-8 — the ROM is
      // single-byte; raw UTF-8 shatters every accent/emoji into mojibake).
      const textBuffer = Buffer.concat([
        encodeText(item.content, this.#codepage),
        Buffer.from('\n'),
      ]);
      commands = Buffer.concat([commands, textBuffer]);
    }

    // Reset styles
    commands = Buffer.concat([commands, Buffer.from([
      0x1B, 0x45, 0x00, // Bold off
      0x1B, 0x2D, 0x00, // Underline off
      0x1D, 0x42, 0x00, // Invert off
      0x1D, 0x21, 0x00, // Normal size
      0x1B, 0x61, 0x00  // Left align
    ])]);

    return commands;
  }

  /**
   * A missing or unreadable image THROWS.
   *
   * This is the 2026-08-25 blank-paper path in its purest form: the raster
   * receipt is a single image item pointing at a scratch PNG, so an image that
   * cannot be loaded means the receipt has no content whatsoever. Returning an
   * empty buffer here printed the header, the padding and the cut around a hole
   * where the receipt should have been. There is no partial receipt worth
   * having — refuse the job instead.
   */
  async #processImageItem(item) {
    let commands = Buffer.alloc(0);

    try {
      if (!item.path || !fileExists(item.path)) {
        this.#logger.error?.('thermalPrinter.image.notFound', { path: item.path });
        throw new InfrastructureError(`Print image not found: ${item.path || '(no path)'}`, {
          code: 'PRINT_IMAGE_MISSING',
        });
      }

      const image = await loadImage(item.path);
      const targetWidth = item.width || 200;
      const targetHeight = item.height || Math.round((image.height / image.width) * targetWidth);

      const canvas = createCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

      const bitmap = this.#convertToMonochrome(canvas, item.threshold || 128);

      // Alignment
      if (item.align) {
        const alignCode = item.align === 'center' ? 0x01 : item.align === 'right' ? 0x02 : 0x00;
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
      }

      const bitmapCommands = this.#convertBitmapToEscPos(bitmap, canvas.width, canvas.height);
      commands = Buffer.concat([commands, bitmapCommands]);

      // Reset alignment
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, 0x00])]);

    } catch (error) {
      this.#logger.error?.('thermalPrinter.image.error', { error: error.message });
      throw error;
    }

    return commands;
  }

  #processBarcodeItem(item) {
    let commands = Buffer.alloc(0);

    if (!item.content) {
      return commands;
    }

    // Alignment
    if (item.align) {
      const alignCode = item.align === 'center' ? 0x01 : item.align === 'right' ? 0x02 : 0x00;
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
    }

    // Height
    const height = item.barcodeHeight || 64;
    commands = Buffer.concat([commands, Buffer.from([0x1D, 0x68, height])]);

    // Format
    const formatCodes = { CODE128: 73, EAN13: 67, EAN8: 68, UPC: 65 };
    const formatCode = formatCodes[item.format] || 73;

    const data = Buffer.from(item.content, 'ascii');
    commands = Buffer.concat([
      commands,
      Buffer.from([0x1D, 0x6B, formatCode, data.length]),
      data,
      Buffer.from('\n')
    ]);

    // Reset alignment
    commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, 0x00])]);

    return commands;
  }

  /**
   * ESC/POS model-2 QR (`GS ( k`), mirroring `#processBarcodeItem`'s
   * alignment/centering conventions: centered while the code prints, reset to
   * left afterward. No label is printed here — the renderer already emitted a
   * preceding text item carrying the label, the same convention `#processBarcodeItem`
   * follows, and printing one here would print every label twice.
   */
  #processQrcodeItem(item) {
    if (!item.content) {
      return Buffer.alloc(0);
    }

    const data = Buffer.from(String(item.content), 'ascii');
    const len = data.length + 3;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;

    return Buffer.concat([
      Buffer.from([0x1B, 0x61, 0x01]),                                     // center
      Buffer.from([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]), // model 2
      Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x08]),       // module size 8
      Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]),       // EC level M
      Buffer.from([0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]), data,     // store
      Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]),       // print
      Buffer.from([0x1B, 0x61, 0x00]),                                     // back to left
    ]);
  }

  #processLineItem(item) {
    const char = item.content || '-';
    const length = item.width || 48;
    const line = char.repeat(length);

    let commands = Buffer.alloc(0);

    if (item.align) {
      const alignCode = item.align === 'center' ? 0x01 : item.align === 'right' ? 0x02 : 0x00;
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
    }

    commands = Buffer.concat([commands, Buffer.from(line + '\n', 'utf8')]);
    commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, 0x00])]);

    return commands;
  }

  #processSpaceItem(item) {
    const lines = item.lines || 1;
    let commands = Buffer.alloc(0);

    for (let i = 0; i < lines; i++) {
      commands = Buffer.concat([commands, Buffer.from('\n')]);
    }

    return commands;
  }

  /**
   * Canvas → one byte per pixel (1 = ink), as a FLAT typed array.
   *
   * Was an array-of-arrays of JS numbers, which for a 576x5000 receipt meant
   * 5,000 JS arrays holding 2.88M boxed values. A flat Uint8Array is the same
   * information in 2.88MB of contiguous memory and indexes faster.
   *
   * @returns {Uint8Array} length width*height, indexed `y * width + x`
   */
  #convertToMonochrome(canvas, threshold = 128) {
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
    const bitmap = new Uint8Array(width * height);

    for (let px = 0; px < bitmap.length; px++) {
      const i = px * 4;
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      bitmap[px] = data[i + 3] > 128 && gray < threshold ? 1 : 0;
    }

    return bitmap;
  }

  /**
   * Pack a 1-byte-per-pixel bitmap into a `GS v 0` raster block.
   *
   * The output buffer is PREALLOCATED and written by index. The previous
   * implementation did `commands = Buffer.concat([commands, Buffer.from([byte])])`
   * once per output byte — a full reallocate-and-copy of the growing buffer per
   * byte, i.e. O(n^2) in both time and memory traffic. Measured on the real
   * printer 2026-08-22, a 576x5000 receipt (360,034 bytes) took 19.9s and
   * spiked RSS to 698MB against a 76MB baseline; in the container that is an
   * OOM waiting to happen. Same bytes on the wire, linear cost.
   *
   * @param {Uint8Array} bitmap flat, `y * width + x`, 1 = ink
   */
  #convertBitmapToEscPos(bitmap, width, height) {
    const widthBytes = Math.ceil(width / 8);
    const HEADER = 8;
    const out = Buffer.alloc(HEADER + widthBytes * height);

    out[0] = 0x1D; out[1] = 0x76; out[2] = 0x30; out[3] = 0x00;
    out[4] = widthBytes & 0xFF;
    out[5] = (widthBytes >> 8) & 0xFF;
    out[6] = height & 0xFF;
    out[7] = (height >> 8) & 0xFF;

    let at = HEADER;
    for (let y = 0; y < height; y++) {
      const rowStart = y * width;
      for (let byteX = 0; byteX < widthBytes; byteX++) {
        let byte = 0;
        const base = byteX * 8;
        for (let bit = 0; bit < 8; bit++) {
          const pixelX = base + bit;
          if (pixelX < width && bitmap[rowStart + pixelX]) {
            byte |= (1 << (7 - bit));
          }
        }
        out[at++] = byte;
      }
    }

    return out;
  }

  /**
   * Decode the `DLE EOT` replies.
   *
   * INDEXED BY BYTE POSITION, NOT BY CHUNK. Each reply is a single byte and
   * they come back in the order asked, but TCP is free to coalesce them into
   * one chunk — indexing the chunk array silently mis-assigns every reply the
   * moment two land together, which reads a paper answer as a printer answer.
   *
   * `answered` is how many of the four queries actually came back; callers use
   * it to tell "the printer says no paper" from "the printer said nothing".
   */
  #parseStatusResponses(responses) {
    const bytes = [];
    for (const chunk of responses) {
      for (const byte of chunk) bytes.push(byte);
    }

    const status = {
      online: false,
      feedButtonEnabled: 'unknown',
      paperPresent: false,
      errors: [],
      coverOpen: false,
      cutterOk: true,
      answered: bytes.length,
      rawResponses: responses.map(r => Array.from(r))
    };

    // `DLE EOT 1` — printer status. Bit 3 (0x08) is offline.
    //
    // BIT 2 (0x04) IS THE CASH-DRAWER PIN, NOT THE COVER. This byte reports the
    // drawer kick-out connector, and the live printer answers 0x16 — bit 2 SET
    // — while perfectly healthy with its cover shut. Reading it as cover-open,
    // as this did, meant any gate built on it would refuse EVERY job on healthy
    // hardware. Cover state comes from `DLE EOT 2` and nowhere else.
    if (bytes.length > 0) status.online = (bytes[0] & 0x08) === 0;

    // `DLE EOT 2` — offline cause. Bit 2 (0x04) is cover open. Sole authority.
    if (bytes.length > 1) status.coverOpen = (bytes[1] & 0x04) !== 0;

    // `DLE EOT 3` — error cause.
    if (bytes.length > 2) {
      const byte = bytes[2];
      if (byte & 0x08) { status.errors.push('cutter_error'); status.cutterOk = false; }
      if (byte & 0x20) status.errors.push('unrecoverable_error');
      if (byte & 0x40) status.errors.push('auto_recoverable_error');
    }

    // `DLE EOT 4` — paper sensors. Both roll-end bits clear means paper.
    if (bytes.length > 3) status.paperPresent = (bytes[3] & 0x60) === 0;

    return status;
  }
}

export default ThermalPrinterAdapter;
