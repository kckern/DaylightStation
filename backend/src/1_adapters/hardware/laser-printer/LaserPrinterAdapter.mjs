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
 * Because there is no CUPS layer, per-job options (duplex, binding) cannot be
 * expressed as `-o sides=...` / IPP job attributes. They are sent as a PJL
 * preamble wrapped around the PDF bytes instead — see {@link pjlWrap}.
 *
 * @module adapters/hardware/laser-printer
 */
import { createConnection } from 'net';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { OPS, encodeRequest, baseAttrs, decodeResponse } from './ipp.mjs';

/** IPP printer-state enum (RFC 8011 §5.4.11). */
const PRINTER_STATE = { 3: 'idle', 4: 'processing', 5: 'stopped' };

/** Universal Exit Language — enters/leaves PJL job-control mode around a raw job. */
const UEL = '\x1B%-12345X';

/** PJL job names are a quoted single-line string; keep them printable and short. */
function sanitizeJobName(jobName) {
  return String(jobName ?? '')
    .replace(/[^\x20-\x7E]/g, ' ') // no CR/LF/control bytes — they would break PJL line parsing
    .replace(/"/g, "'")
    .slice(0, 80)
    // Trimmed BEFORE the fallback: a name that is all whitespace (or became
    // all whitespace once control bytes were blanked above) is not a name, and
    // `NAME="   "` is worse than the default — it names nothing in the
    // printer's job log.
    .trim() || 'daylight-print';
}

/** The only two values `@PJL SET BINDING=` may carry. */
const BINDINGS = Object.freeze(['LONGEDGE', 'SHORTEDGE']);

/**
 * Whitelist a binding value on its way to the wire.
 *
 * `binding` arrives from `school.yml`, i.e. from a human. Two things go wrong
 * without this: a value containing a newline would inject arbitrary PJL lines,
 * and — far more likely — a plausible typo (`long-edge`, `longedge `) would
 * emit an invalid value that the printer rejects while silently keeping its own
 * default, producing the wrong physical output with nothing logged. Anything
 * not on the list falls back and says so.
 *
 * Case and surrounding whitespace are forgiven (YAML invites both); the value
 * that reaches the wire is always one of {@link BINDINGS} verbatim.
 *
 * @param {*} binding
 * @param {Object} [opts]
 * @param {'LONGEDGE'|'SHORTEDGE'} [opts.fallback='LONGEDGE']
 * @param {{warn?: Function}} [opts.logger]
 * @param {string} [opts.source] - where the bad value came from, for the log line
 * @returns {'LONGEDGE'|'SHORTEDGE'}
 */
export function normalizeBinding(binding, { fallback = 'LONGEDGE', logger = null, source = 'binding' } = {}) {
  const candidate = String(binding ?? '').trim().toUpperCase();
  if (BINDINGS.includes(candidate)) return candidate;
  logger?.warn?.('laser-printer.invalid-binding', {
    source, supplied: binding, used: fallback, expected: BINDINGS,
  });
  return fallback;
}

/**
 * Standard PJL preamble/trailer around raw PDF bytes for a JetDirect (port
 * 9100) job — sets per-job DUPLEX/BINDING before the printer enters PDF
 * parsing mode, then exits cleanly so the settings do not leak into the next
 * job. The PDF bytes themselves pass through byte-for-byte untouched.
 *
 * INFERRED, NOT MEASURED: this is the de facto standard preamble for
 * PJL-capable laser printers (HP's PJL Technical Reference, which Brother
 * firmware broadly implements), but it has NOT been verified against the
 * physical Brother HL-L2460DW this codebase targets — no hardware print was
 * run when this was written. Two specific things a physical test should
 * confirm: (1) the sheet actually comes out double-sided, and (2) `@PJL ENTER
 * LANGUAGE=PDF` is accepted (PDF is a vendor personality, not one of the PJL
 * spec's named languages; if the firmware rejects it, dropping that one line
 * and letting PDF Direct Print auto-detect — as it does today — is the first
 * thing to try). See docs/reference/school/README.md → Printing → Duplex.
 *
 * @param {Buffer} pdf - the document bytes to wrap (ONE copy — see `copies`)
 * @param {Object} opts
 * @param {string} opts.jobName
 * @param {boolean} opts.duplex
 * @param {'LONGEDGE'|'SHORTEDGE'} opts.binding
 * @param {number} [opts.copies=1] - emitted as `@PJL SET COPIES`; the document
 *   itself is sent exactly once regardless
 * @returns {Buffer}
 */
export function pjlWrap(pdf, {
  jobName, duplex, binding, copies = 1,
}) {
  const header = [
    `${UEL}@PJL JOB NAME="${sanitizeJobName(jobName)}"`,
    // Copies are the FIRMWARE's job, not ours. Sending the PDF N times inside
    // one `ENTER LANGUAGE=PDF` stream hands the PDF personality one contiguous
    // stream, which resolves a single document from its trailing xref — the
    // plausible outcome is "3 requested, 1 printed", silent, with the quota
    // still charging 3. `COPIES` is a standard PJL environment variable and
    // also gets copy boundaries right under duplex (each copy starts on a
    // fresh sheet), which concatenation could not.
    // INFERRED, NOT MEASURED — like everything else in this envelope; see the
    // block comment above.
    `@PJL SET COPIES=${Math.max(1, Math.floor(Number(copies) || 1))}`,
    `@PJL SET DUPLEX=${duplex ? 'ON' : 'OFF'}`,
    ...(duplex ? [`@PJL SET BINDING=${normalizeBinding(binding)}`] : []),
    '@PJL ENTER LANGUAGE=PDF',
    '',
  ].join('\r\n');
  const trailer = `\r\n${UEL}@PJL EOJ\r\n${UEL}`;
  return Buffer.concat([Buffer.from(header, 'latin1'), pdf, Buffer.from(trailer, 'latin1')]);
}

/**
 * @typedef {Object} LaserPrinterConfig
 * @property {string} host - printer IP or hostname
 * @property {number} [port=631] - IPP port (status/ping)
 * @property {number} [rawPort=9100] - JetDirect port (printing)
 * @property {string} [path='/ipp/print'] - IPP endpoint path (AirPrint default)
 * @property {number} [timeout=15000] - IPP request timeout in ms
 * @property {number} [printTimeout=60000] - raw print send timeout in ms
 * @property {boolean} [duplex=true] - default double-sided printing (config-driven; per-job override in printPdf)
 * @property {'LONGEDGE'|'SHORTEDGE'} [binding='LONGEDGE'] - duplex flip style; LONGEDGE = book-style,
 *   the right default for portrait text. Whitelisted at construction — see {@link normalizeBinding}
 */
export class LaserPrinterAdapter {
  #host; #port; #rawPort; #path; #timeout; #printTimeout; #duplexDefault; #bindingDefault; #logger;
  #requestId = 0;

  constructor({
    host, port = 631, rawPort = 9100, path = '/ipp/print', timeout = 15000, printTimeout = 60000,
    duplex = true, binding = 'LONGEDGE', logger = console,
  } = {}) {
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
    this.#duplexDefault = duplex;
    // Validated once, at construction, so a `school.yml` typo is reported at
    // boot rather than silently mis-binding every job for the rest of time.
    this.#bindingDefault = normalizeBinding(binding, { logger, source: 'adapter-config' });
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
   * renders the bytes as-is. Resolves once every byte is flushed and the socket
   * closes cleanly — port 9100 is fire-and-forget, so there is no per-job ack;
   * a stream/connect failure is the only failure signal.
   *
   * The document is wrapped in ONE {@link pjlWrap} envelope carrying the duplex
   * settings and the copy count — one PJL job, ONE document inside it, with
   * `@PJL SET COPIES` asking the firmware for the repeats.
   *
   * @param {Buffer} pdf - complete PDF bytes
   * @param {Object} [opts]
   * @param {string} [opts.jobName='daylight-print'] - our own logging AND the PJL JOB NAME
   * @param {string} [opts.user='daylight'] - for our own logging (9100 carries no user metadata)
   * @param {number} [opts.copies=1]
   * @param {boolean} [opts.duplex] - per-job override; defaults to the adapter's configured default
   * @param {'LONGEDGE'|'SHORTEDGE'} [opts.binding] - per-job override; ignored when duplex is off.
   *   Anything outside that pair is refused with a `laser-printer.invalid-binding` warning and the
   *   adapter's configured default is used instead
   * @returns {Promise<{ok:boolean, bytes:number, copies:number, duplex:boolean}>} `bytes` counts the
   *   wire payload INCLUDING the PJL envelope; `duplex` echoes what was requested (not confirmed —
   *   9100 gives no ack, and PJL duplex is unverified on this printer model)
   * @throws {InfrastructureError} on transport failure
   */
  printPdf(pdf, {
    jobName = 'daylight-print', user = 'daylight', copies = 1,
    duplex = this.#duplexDefault, binding = this.#bindingDefault,
  } = {}) {
    if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
      return Promise.reject(new InfrastructureError('printPdf requires non-empty PDF buffer', { code: 'INVALID_DOCUMENT' }));
    }
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return Promise.reject(new InfrastructureError('document is not a PDF', { code: 'INVALID_DOCUMENT' }));
    }
    const nCopies = Math.max(1, Math.floor(copies));
    const resolvedBinding = normalizeBinding(binding, {
      fallback: this.#bindingDefault, logger: this.#logger, source: 'print-job',
    });
    // ONE envelope, ONE document, `COPIES` doing the repeating: see pjlWrap.
    const payload = pjlWrap(pdf, {
      jobName, duplex, binding: resolvedBinding, copies: nCopies,
    });

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
        this.#logger.info?.('laser-printer.job-sent', { host: this.#host, port: this.#rawPort, jobName, user, copies: nCopies, duplex, bytes: payload.length });
        resolve({ ok: true, bytes: payload.length, copies: nCopies, duplex });
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
