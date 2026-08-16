/**
 * VirtualLaserPrinterAdapter — a laser printer that exists only on disk.
 *
 * Same surface as {@link LaserPrinterAdapter} (`printPdf`, `getStatus`, `ping`),
 * same return shapes, same error codes. The composition root chooses which one
 * to wire; production code never asks whether it is talking to a real printer.
 *
 * Every accepted job lands in `<captureDir>` as `{jobId}.pdf` plus a
 * `{jobId}.json` sidecar, so a test — or a human on the virtual device console —
 * can read back exactly what would have come out of the tray.
 *
 * Fault injection covers the two failures the lifecycle has to survive:
 *  - `offline` — printer unreachable. `printPdf` rejects PRINT_SEND_FAILED, the
 *    same code the real adapter raises when the JetDirect socket errors, which
 *    is what drives the print-pending recovery path.
 *  - `jam` — printer reachable, transport stopped. Port 9100 is fire-and-forget
 *    with no per-job ack, so a jam does NOT fail `printPdf` on the real device
 *    either; it only shows up in `getStatus`. Modeled faithfully.
 *
 * @module adapters/hardware/laser-printer
 */
import { promises as fs } from 'fs';
import path from 'path';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const FAULTS = Object.freeze(['offline', 'jam']);

/** Placeholder endpoint reported in errors/status so the shape matches the real adapter. */
const VIRTUAL_HOST = 'virtual-laser.local';
const VIRTUAL_PORT = 631;
const VIRTUAL_RAW_PORT = 9100;

/**
 * Page count by the house method (`backend/src/app.mjs`): count `/Type /Page`
 * occurrences while excluding `/Type /Pages`. Never returns 0.
 * @param {Buffer} pdf
 * @returns {number}
 */
function sniffPageCount(pdf) {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || 1;
}

export class VirtualLaserPrinterAdapter {
  #captureDir; #logger; #clock;
  #fault = null;
  #seq = 0;
  #jobs = [];

  /**
   * @param {Object} opts
   * @param {string} opts.captureDir - directory that stands in for the paper tray
   * @param {Object} [opts.logger=console]
   * @param {() => Date} [opts.clock] - injected for deterministic `at` timestamps
   */
  constructor({ captureDir, logger = console, clock = () => new Date() } = {}) {
    if (!captureDir) {
      throw new InfrastructureError('VirtualLaserPrinterAdapter requires captureDir', {
        code: 'MISSING_DEPENDENCY', dependency: 'captureDir',
      });
    }
    this.#captureDir = captureDir;
    this.#logger = logger;
    this.#clock = clock;
  }

  get printerUri() { return `ipp://${VIRTUAL_HOST}:${VIRTUAL_PORT}/ipp/print`; }
  get captureDir() { return this.#captureDir; }

  // -------------------------------------------------------------------------
  // Real adapter surface
  // -------------------------------------------------------------------------

  /**
   * `duplex`/`binding` are RECORDED, not applied: there is no PJL wrapping here
   * because there is no printer to parse it — the capture holds the plain PDF,
   * and the sidecar states what the real adapter would have requested.
   * `bytes` likewise counts document bytes only, without the real adapter's PJL
   * envelope, so the capture stays a readable PDF.
   *
   * @param {Buffer} pdf - complete PDF bytes
   * @param {Object} [opts]
   * @param {string} [opts.jobName='daylight-print']
   * @param {string} [opts.user='daylight']
   * @param {number} [opts.copies=1]
   * @param {boolean} [opts.duplex=true] - double-sided, matching the real adapter's default
   * @param {'LONGEDGE'|'SHORTEDGE'} [opts.binding='LONGEDGE']
   * @returns {Promise<{ok:boolean, bytes:number, copies:number, duplex:boolean}>}
   * @throws {InfrastructureError} INVALID_DOCUMENT | PRINT_SEND_FAILED
   */
  async printPdf(pdf, {
    jobName = 'daylight-print', user = 'daylight', copies = 1,
    duplex = true, binding = 'LONGEDGE',
  } = {}) {
    if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
      throw new InfrastructureError('printPdf requires non-empty PDF buffer', { code: 'INVALID_DOCUMENT' });
    }
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new InfrastructureError('document is not a PDF', { code: 'INVALID_DOCUMENT' });
    }
    if (this.#fault === 'offline') {
      // Mirrors the real adapter's socket-error branch: the only failure signal
      // JetDirect gives is a connect/stream error, surfaced as PRINT_SEND_FAILED.
      throw new InfrastructureError(
        `raw print failed: connect ECONNREFUSED ${VIRTUAL_HOST}:${VIRTUAL_RAW_PORT}`,
        { code: 'PRINT_SEND_FAILED', host: VIRTUAL_HOST, port: VIRTUAL_RAW_PORT },
      );
    }

    const nCopies = Math.max(1, Math.floor(copies));
    // Wire bytes: copies go out as N concatenated documents (9100 has no copies
    // attribute). The capture holds ONE readable copy; `bytes` is what was sent.
    const bytes = pdf.length * nCopies;
    const jobId = `job_${String(++this.#seq).padStart(4, '0')}`;
    const sidecar = {
      jobId,
      bytes,
      pageCount: sniffPageCount(pdf),
      at: this.#clock().toISOString(),
      requestedBy: user,
      copies: nCopies,
      jobName,
      duplex,
      binding,
    };

    await fs.mkdir(this.#captureDir, { recursive: true });
    await fs.writeFile(path.join(this.#captureDir, `${jobId}.pdf`), pdf);
    await fs.writeFile(path.join(this.#captureDir, `${jobId}.json`), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
    this.#jobs.push(sidecar);

    this.#logger.info?.('virtual-laser.job-captured', { jobId, jobName, user, copies: nCopies, duplex, bytes });
    return { ok: true, bytes, copies: nCopies, duplex };
  }

  /**
   * @returns {Promise<{state:string, stateReasons:string[], name:?string, model:?string, accepting:?boolean}>}
   * @throws {InfrastructureError} PRINTER_STATUS_ERROR when offline
   */
  async getStatus() {
    if (this.#fault === 'offline') {
      // The real adapter's transport failure here surfaces as a raw fetch
      // rejection; the double raises the adapter's declared status error so
      // callers have one documented error class to recover from.
      throw new InfrastructureError('get-printer-attributes failed (printer unreachable)', {
        code: 'PRINTER_STATUS_ERROR', host: VIRTUAL_HOST,
      });
    }
    const jammed = this.#fault === 'jam';
    return {
      state: jammed ? 'stopped' : 'idle',
      stateReasons: jammed ? ['media-jam'] : [],
      name: 'virtual-laser',
      model: 'DaylightStation Virtual Laser',
      accepting: !jammed,
    };
  }

  /**
   * TCP reachability probe. A jam is a transport fault, not a network one, so
   * a jammed printer still pings.
   * @returns {Promise<boolean>}
   */
  async ping() {
    return this.#fault !== 'offline';
  }

  // -------------------------------------------------------------------------
  // Double-only surface (tests + virtual device console)
  // -------------------------------------------------------------------------

  /** @returns {Array<Object>} sidecars in submission order */
  listJobs() {
    return this.#jobs.map((j) => ({ ...j }));
  }

  /**
   * @param {string} jobId
   * @returns {Promise<(Object & {pdf: Buffer})|null>}
   */
  async readJob(jobId) {
    const sidecar = this.#jobs.find((j) => j.jobId === jobId);
    if (!sidecar) return null;
    const pdf = await fs.readFile(path.join(this.#captureDir, `${jobId}.pdf`));
    return { ...sidecar, pdf };
  }

  /**
   * @param {'offline'|'jam'|null} fault
   */
  setFault(fault) {
    if (fault !== null && !FAULTS.includes(fault)) {
      throw new InfrastructureError(`unknown laser printer fault: ${fault} (expected ${FAULTS.join('|')} or null)`, {
        code: 'INVALID_FAULT', fault,
      });
    }
    this.#fault = fault;
    this.#logger.info?.('virtual-laser.fault', { fault });
  }

  /** @returns {'offline'|'jam'|null} */
  getFault() { return this.#fault; }
}

export default VirtualLaserPrinterAdapter;
