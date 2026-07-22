/**
 * LaserPrinterAdapter — network laser printer control for the kitchen Brother
 * HL-L2460DW. Dumb transport only: pushes a ready-made PDF and reports printer
 * state. Page quotas, approval flows, and who-may-print policy belong in the
 * application layer (ddd-reference: adapters translate, they do not decide).
 *
 * Two protocols, each for what it does best:
 *  - STATUS/PING over IPP/1.1 (HTTP POST application/ipp, port 631) — clean
 *    structured Get-Printer-Attributes.
 *  - PRINTING over raw JetDirect (port 9100) — this Brother's IPP does NOT
 *    accept a PDF: it advertises only image/urf + image/pwg-raster + generic
 *    octet-stream, rejects `application/pdf` (0x040a) and hangs on an
 *    octet-stream PDF (its auto-detect can't parse PDF). Port 9100 with the
 *    printer's built-in PDF Direct Print renders the PDF as-is. No CUPS, no
 *    client-side rasterization, no npm printing deps.
 *
 * @module adapters/hardware/laser-printer
 */
import { createConnection } from 'net';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { OPS, encodeRequest, baseAttrs, decodeResponse } from './ipp.mjs';

/** IPP printer-state enum (RFC 8011 §5.4.11). */
const PRINTER_STATE = { 3: 'idle', 4: 'processing', 5: 'stopped' };

/**
 * @typedef {Object} LaserPrinterConfig
 * @property {string} host - printer IP or hostname
 * @property {number} [port=631] - IPP port (status/ping)
 * @property {number} [rawPort=9100] - JetDirect port (printing)
 * @property {string} [path='/ipp/print'] - IPP endpoint path (AirPrint default)
 * @property {number} [timeout=15000] - IPP request timeout in ms
 * @property {number} [printTimeout=60000] - raw print send timeout in ms
 */
export class LaserPrinterAdapter {
  #host; #port; #rawPort; #path; #timeout; #printTimeout; #logger;
  #requestId = 0;

  constructor({ host, port = 631, rawPort = 9100, path = '/ipp/print', timeout = 15000, printTimeout = 60000, logger = console } = {}) {
    if (!host) {
      throw new InfrastructureError('LaserPrinterAdapter requires host', {
        code: 'MISSING_DEPENDENCY', dependency: 'host',
      });
    }
    this.#host = host;
    this.#port = port;
    this.#rawPort = rawPort;
    this.#path = path.startsWith('/') ? path : `/${path}`;
    this.#timeout = timeout;
    // Port 9100 is single-session: a print in progress holds the socket, so a
    // fresh job's connect can wait. Generous timeout covers warm-up + render.
    this.#printTimeout = printTimeout;
    this.#logger = logger;
  }

  get printerUri() { return `ipp://${this.#host}:${this.#port}${this.#path}`; }
  #httpUrl() { return `http://${this.#host}:${this.#port}${this.#path}`; }

  async #ipp(operation, attrs, document = null, timeoutMs = this.#timeout) {
    this.#requestId = (this.#requestId % 0x7fffffff) + 1;
    const body = encodeRequest(operation, attrs, document, this.#requestId);
    const res = await fetch(this.#httpUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/ipp' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new InfrastructureError(`printer HTTP ${res.status}`, {
        code: 'PRINTER_HTTP_ERROR', host: this.#host, status: res.status,
      });
    }
    return decodeResponse(Buffer.from(await res.arrayBuffer()));
  }

  /**
   * Print a PDF via raw JetDirect (port 9100). The Brother's PDF Direct Print
   * renders the bytes as-is; copies are sent as N concatenated documents
   * (JetDirect has no copies attribute). Resolves once every byte is flushed
   * and the socket closes cleanly — port 9100 is fire-and-forget, so there is
   * no per-job ack; a stream/connect failure is the only failure signal.
   *
   * @param {Buffer} pdf - complete PDF bytes
   * @param {Object} [opts]
   * @param {string} [opts.jobName='daylight-print'] - for our own logging (9100 carries no metadata)
   * @param {string} [opts.user='daylight'] - for our own logging
   * @param {number} [opts.copies=1]
   * @returns {Promise<{ok:boolean, bytes:number, copies:number}>}
   * @throws {InfrastructureError} on transport failure
   */
  printPdf(pdf, { jobName = 'daylight-print', user = 'daylight', copies = 1 } = {}) {
    if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
      return Promise.reject(new InfrastructureError('printPdf requires non-empty PDF buffer', { code: 'INVALID_DOCUMENT' }));
    }
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return Promise.reject(new InfrastructureError('document is not a PDF', { code: 'INVALID_DOCUMENT' }));
    }
    const nCopies = Math.max(1, Math.floor(copies));
    const payload = nCopies === 1 ? pdf : Buffer.concat(Array.from({ length: nCopies }, () => pdf));

    return new Promise((resolve, reject) => {
      const sock = createConnection({ host: this.#host, port: this.#rawPort, timeout: this.#printTimeout });
      let settled = false;
      const done = () => {
        if (settled) return; settled = true;
        // Fully tear the socket down — do NOT linger in FIN-WAIT-2. JetDirect
        // often never sends its own FIN, so a half-closed socket would sit
        // open holding the printer's SINGLE 9100 session and wedge the NEXT
        // print (and keep a short-lived Node process from exiting). We already
        // have confirmation the bytes flushed, so destroying now is safe and
        // releases the port immediately.
        sock.destroy();
        this.#logger.info?.('laser-printer.job-sent', { host: this.#host, port: this.#rawPort, jobName, user, copies: nCopies, bytes: payload.length });
        resolve({ ok: true, bytes: payload.length, copies: nCopies });
      };
      const fail = (msg) => {
        if (settled) return; settled = true;
        sock.destroy();
        reject(new InfrastructureError(`raw print failed: ${msg}`, { code: 'PRINT_SEND_FAILED', host: this.#host, port: this.#rawPort }));
      };
      // JetDirect is fire-and-forget and often leaves ITS half of the socket
      // open after receiving a job — so waiting for 'close' can hang until the
      // idle timeout even though the job printed. The real success signal is
      // "our bytes are flushed and our FIN is sent": sock.end(data, cb) fires
      // cb exactly then. We resolve (and destroy) there and don't wait on the
      // printer to close its half.
      sock.once('connect', () => sock.end(payload, done));
      sock.once('timeout', () => fail('timeout (printer busy or unreachable)'));
      sock.once('error', (e) => fail(e.message));
    });
  }

  /**
   * Printer identity + state, for health checks and a pre-print guard.
   *
   * @returns {Promise<{state:string, stateReasons:string[], name:?string, model:?string, accepting:?boolean}>}
   */
  async getStatus() {
    const { ok, statusCode, attrs } = await this.#ipp(OPS.GET_PRINTER_ATTRIBUTES, baseAttrs(this.printerUri, 'daylight'));
    if (!ok) {
      throw new InfrastructureError(`get-printer-attributes failed (ipp status 0x${statusCode.toString(16)})`, {
        code: 'PRINTER_STATUS_ERROR', host: this.#host, statusCode,
      });
    }
    return {
      state: PRINTER_STATE[attrs['printer-state']?.[0]] ?? 'unknown',
      stateReasons: (attrs['printer-state-reasons'] ?? []).filter((r) => r !== 'none'),
      name: attrs['printer-name']?.[0] ?? null,
      model: attrs['printer-make-and-model']?.[0] ?? null,
      accepting: attrs['printer-is-accepting-jobs']?.[0] ?? null,
    };
  }

  /** TCP reachability probe (no IPP round-trip). */
  ping({ timeout = 3000 } = {}) {
    return new Promise((resolve) => {
      const sock = createConnection({ host: this.#host, port: this.#port, timeout });
      const done = (up) => { sock.destroy(); resolve(up); };
      sock.once('connect', () => done(true));
      sock.once('timeout', () => done(false));
      sock.once('error', () => done(false));
    });
  }
}

export default LaserPrinterAdapter;
