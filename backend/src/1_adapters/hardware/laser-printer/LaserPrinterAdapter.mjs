/**
 * LaserPrinterAdapter — network laser printer control over IPP (AirPrint
 * class; verified against the kitchen Brother HL-L2460DW). Dumb transport
 * only: it pushes a ready-made PDF and reports printer state. Page quotas,
 * approval flows, and who-may-print policy belong in the application layer
 * (ddd-reference: adapters translate, they do not decide).
 *
 * Protocol: raw IPP/1.1 over HTTP POST (application/ipp) via global fetch —
 * no CUPS, no npm printing deps. See ./ipp.mjs for the wire format.
 *
 * @module adapters/hardware/laser-printer
 */
import { createConnection } from 'net';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { OPS, encodeRequest, baseAttrs, printJobAttrs, decodeResponse } from './ipp.mjs';

/** IPP printer-state enum (RFC 8011 §5.4.11). */
const PRINTER_STATE = { 3: 'idle', 4: 'processing', 5: 'stopped' };

/**
 * @typedef {Object} LaserPrinterConfig
 * @property {string} host - printer IP or hostname
 * @property {number} [port=631] - IPP port
 * @property {string} [path='/ipp/print'] - IPP endpoint path (AirPrint default)
 * @property {number} [timeout=15000] - request timeout in ms
 */
export class LaserPrinterAdapter {
  #host; #port; #path; #timeout; #logger;
  #requestId = 0;

  constructor({ host, port = 631, path = '/ipp/print', timeout = 15000, logger = console } = {}) {
    if (!host) {
      throw new InfrastructureError('LaserPrinterAdapter requires host', {
        code: 'MISSING_DEPENDENCY', dependency: 'host',
      });
    }
    this.#host = host;
    this.#port = port;
    this.#path = path.startsWith('/') ? path : `/${path}`;
    this.#timeout = timeout;
    this.#logger = logger;
  }

  get printerUri() { return `ipp://${this.#host}:${this.#port}${this.#path}`; }
  #httpUrl() { return `http://${this.#host}:${this.#port}${this.#path}`; }

  async #ipp(operation, attrs, document = null) {
    this.#requestId = (this.#requestId % 0x7fffffff) + 1;
    const body = encodeRequest(operation, attrs, document, this.#requestId);
    const res = await fetch(this.#httpUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/ipp' },
      body,
      signal: AbortSignal.timeout(this.#timeout),
    });
    if (!res.ok) {
      throw new InfrastructureError(`printer HTTP ${res.status}`, {
        code: 'PRINTER_HTTP_ERROR', host: this.#host, status: res.status,
      });
    }
    return decodeResponse(Buffer.from(await res.arrayBuffer()));
  }

  /**
   * Submit a PDF as one print job.
   *
   * @param {Buffer} pdf - complete PDF bytes
   * @param {Object} [opts]
   * @param {string} [opts.jobName='daylight-print'] - shows in the printer's job log
   * @param {string} [opts.user='daylight'] - requesting-user-name (attribution, not auth)
   * @param {number} [opts.copies=1]
   * @returns {Promise<{ok:boolean, statusCode:number, jobId:?number}>}
   * @throws {InfrastructureError} on transport failure or IPP rejection
   */
  async printPdf(pdf, { jobName = 'daylight-print', user = 'daylight', copies = 1 } = {}) {
    if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
      throw new InfrastructureError('printPdf requires non-empty PDF buffer', { code: 'INVALID_DOCUMENT' });
    }
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new InfrastructureError('document is not a PDF', { code: 'INVALID_DOCUMENT' });
    }
    const { ok, statusCode, attrs } = await this.#ipp(
      OPS.PRINT_JOB,
      printJobAttrs(this.printerUri, { user, jobName, copies }),
      pdf,
    );
    if (!ok) {
      throw new InfrastructureError(`printer rejected job (ipp status 0x${statusCode.toString(16)})`, {
        code: 'PRINT_JOB_REJECTED', host: this.#host, statusCode,
      });
    }
    const jobId = attrs['job-id']?.[0] ?? null;
    this.#logger.info?.('laser-printer.job-submitted', { host: this.#host, jobName, user, copies, jobId });
    return { ok, statusCode, jobId };
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
