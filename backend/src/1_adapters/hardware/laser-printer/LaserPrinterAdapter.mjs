/**
 * LaserPrinterAdapter — network laser printer control for the kitchen Brother
 * HL-L2460DW. Dumb transport only: pushes a ready-made PDF and reports printer
 * state. Page quotas, approval flows, and who-may-print policy belong in the
 * application layer (ddd-reference: adapters translate, they do not decide).
 *
 * ── Incident, 2026-08 ──────────────────────────────────────────────────────
 * An earlier version of this adapter printed by opening a raw JetDirect
 * socket (port 9100) and writing the PDF bytes straight in, on the premise —
 * stated right here in this comment, at the time — that "this Brother's PDF
 * Direct Print" would render the PDF as-is. That premise was false. Queried
 * over IPP, this printer's actual capabilities are:
 *
 *   printer-make-and-model    = "Brother HL-L2460DW"
 *   document-format-supported = [application/octet-stream, image/urf, image/pwg-raster]
 *   document-format-default   = application/octet-stream
 *   document-format-preferred = image/urf
 *
 * There is no PDF interpreter, no PostScript, no PCL — it's an AirPrint-class
 * raster printer. `application/octet-stream` does not mean "PDF welcome";
 * it means "raw bytes, printer guesses the format from content." Its guess
 * for a PDF was plain text, and it printed the PDF's own `%PDF-1.3…` source
 * until the tray ran out of paper.
 *
 * The fix has two parts:
 *  1. Never assume a format works — query `document-format-supported` first
 *    and negotiate (`negotiate.mjs`'s `chooseDocumentFormat`). A PDF payload
 *    against a printer that only lists urf/pwg-raster gets rasterized with
 *    ghostscript (`rasterize.mjs`) into one of those formats before anything
 *    is transmitted.
 *  2. A hard guard: this adapter refuses to transmit any payload whose
 *    format is not literally present in the printer's advertised
 *    `document-format-supported`. `application/octet-stream` being present
 *    is NEVER read as "anything goes" — that permissiveness is exactly what
 *    let the raw PDF through last time.
 *
 * Transport, post-fix:
 *  - STATUS/capabilities over IPP/1.1 (HTTP POST application/ipp, port 631)
 *    — Get-Printer-Attributes, used both for health checks and to drive
 *    format negotiation before every print.
 *  - PRINTING over IPP/1.1 Print-Job (same port 631), with the negotiated
 *    `document-format` operation attribute — the standards-compliant path,
 *    now the default for everything.
 *  - Raw JetDirect (port 9100) still exists (`#sendRaw9100`), for a printer
 *    that genuinely advertises `application/pdf` (or another format its
 *    firmware is confirmed to accept raw) and is explicitly configured with
 *    `rawTransport: true`. It is capability-gated the same as the IPP path —
 *    never selected by assumption, and this Brother will never route through
 *    it because it never advertises PDF.
 *
 * ── Incident #2, 2026-08 ───────────────────────────────────────────────────
 * The fix above shipped, and a real worksheet scan went through it
 * successfully — correct container (`image/urf`), correct IPP transport,
 * printer answered idle/accepting throughout — and STILL produced no paper.
 * Negotiating the CONTAINER (`document-format-supported`) was only half the
 * problem: this printer separately advertises, per container, what the
 * PIXELS inside have to look like (`urf-supported: ["W8", ...]` = 8-bit
 * grayscale; `pwg-raster-document-type-supported: ["sgray_8"]` = the same
 * thing in PWG's vocabulary; `pwg-raster-document-resolution-supported` =
 * 600 DPI only, a DIFFERENT resolution constraint than `urf-supported`'s
 * `RS300-600-1200`). Ghostscript's raster devices default to 1-bit
 * monochrome regardless of `-r`/`-sPAPERSIZE`, which is not what either
 * capability list named — the printer silently dropped a job whose
 * container it had agreed to but whose bit depth it never did.
 *
 * The fix, same shape as the first: never assume, always verify.
 *  1. `negotiate.mjs`'s `negotiatePrintPlan` reads the printer's per-container
 *     pixel capabilities (`urf-supported` CS/RS tokens, or
 *     `pwg-raster-document-type-supported`/`-resolution-supported`) and
 *     derives the exact channels/bits-per-color/DPI to target — falling back
 *     to the other raster container if the first one's constraints can't be
 *     satisfied, rather than shipping an unverified guess.
 *  2. `rasterize.mjs` drives ghostscript with those exact parameters, then
 *     PARSES THE RASTER IT JUST PRODUCED and asserts it matches — refusing
 *     (RASTERIZE_PARAM_MISMATCH) rather than returning bytes nobody checked.
 *  3. The negotiated resolution/color-mode/media are also sent as real IPP
 *     job attributes (`printer-resolution`, `print-color-mode`, `media`,
 *     `sides`), gated on the printer's own `job-creation-attributes-supported`
 *     — so the metadata and the pixels agree, instead of the printer having
 *     to guess from mismatched hints again.
 *
 * @module adapters/hardware/laser-printer
 */
import { createConnection } from 'net';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { OPS, encodeRequest, baseAttrs, printJobAttrs, decodeResponse } from './ipp.mjs';
import { negotiatePrintPlan, chooseJobAttributes, DEFAULT_MEDIA } from './negotiate.mjs';
import { rasterizePdf } from './rasterize.mjs';

/** IPP printer-state enum (RFC 8011 §5.4.11). */
const PRINTER_STATE = { 3: 'idle', 4: 'processing', 5: 'stopped' };

/**
 * @typedef {Object} LaserPrinterConfig
 * @property {string} host - printer IP or hostname
 * @property {number} [port=631] - IPP port (status + printing)
 * @property {number} [rawPort=9100] - JetDirect port (only used when rawTransport is true AND the printer advertises the format)
 * @property {string} [path='/ipp/print'] - IPP endpoint path (AirPrint default)
 * @property {number} [timeout=15000] - IPP request timeout in ms
 * @property {number} [printTimeout=60000] - print-send timeout in ms (IPP Print-Job or raw)
 * @property {boolean} [rawTransport=false] - opt into raw JetDirect for a printer confirmed (by capability, not assumption) to accept a format that way; default is IPP for everything
 */
export class LaserPrinterAdapter {
  #host; #port; #rawPort; #path; #timeout; #printTimeout; #rawTransport; #logger;
  #renderPageLimit;
  #requestId = 0;

  constructor({
    host, port = 631, rawPort = 9100, path = '/ipp/print', timeout = 15000, printTimeout = 60000,
    rawTransport = false, logger = console, renderPageLimit = null,
  } = {}) {
    if (!host) {
      throw new InfrastructureError('LaserPrinterAdapter requires host', {
        code: 'MISSING_DEPENDENCY', dependency: 'host',
      });
    }
    this.#host = host;
    // Trim, not refuse: see rasterize.mjs. Null in production.
    this.#renderPageLimit = renderPageLimit;
    this.#port = port;
    this.#rawPort = rawPort;
    this.#path = path.startsWith('/') ? path : `/${path}`;
    this.#timeout = timeout;
    // Port 9100 is single-session: a print in progress holds the socket, so a
    // fresh job's connect can wait. Generous timeout covers warm-up + render.
    // The same generous window covers a rasterize-then-IPP-Print-Job send.
    this.#printTimeout = printTimeout;
    this.#rawTransport = Boolean(rawTransport);
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

  async #fetchAttributes() {
    const { ok, statusCode, attrs } = await this.#ipp(OPS.GET_PRINTER_ATTRIBUTES, baseAttrs(this.printerUri, 'daylight'));
    if (!ok) {
      throw new InfrastructureError(`get-printer-attributes failed (ipp status 0x${statusCode.toString(16)})`, {
        code: 'PRINTER_STATUS_ERROR', host: this.#host, statusCode,
      });
    }
    return attrs;
  }

  /**
   * The capabilities negotiation needs, straight off the wire — no guessing,
   * no caching (a print is rare enough that a fresh query every time is
   * cheap, and printer capabilities are exactly the kind of thing that must
   * never go stale behind an assumption). Deliberately returns the RAW
   * per-container attributes (urf-supported, pwg-raster-document-type-
   * supported, etc.) rather than pre-resolving a single dpi/format here —
   * incident #2 was caused by exactly that kind of premature, format-
   * agnostic resolution; `negotiate.mjs`'s `negotiatePrintPlan` is the only
   * place that decision gets made now, and it needs the per-container lists
   * intact to do it correctly.
   */
  async #getCapabilities() {
    const attrs = await this.#fetchAttributes();
    return {
      documentFormatSupported: attrs['document-format-supported'] ?? [],
      documentFormatPreferred: attrs['document-format-preferred']?.[0] ?? null,
      documentFormatDefault: attrs['document-format-default']?.[0] ?? null,
      urfSupported: attrs['urf-supported'] ?? [],
      pwgRasterDocumentTypeSupported: attrs['pwg-raster-document-type-supported'] ?? [],
      pwgRasterResolutionSupported: attrs['pwg-raster-document-resolution-supported'] ?? [],
      printerResolutionSupported: attrs['printer-resolution-supported'] ?? [],
      jobCreationAttributesSupported: attrs['job-creation-attributes-supported'] ?? [],
      media: attrs['media-default']?.[0] ?? DEFAULT_MEDIA,
    };
  }

  /**
   * Print a PDF. Negotiates a document format the target printer has
   * actually advertised (rasterizing with ghostscript first if the printer
   * doesn't take PDF directly), refuses to transmit if no safe format
   * exists, then sends over IPP Print-Job (or raw JetDirect, only if this
   * adapter was constructed with `rawTransport: true` AND the negotiated
   * format is one the printer's own capabilities list — never by default,
   * never by assumption).
   *
   * @param {Buffer} pdf - complete PDF bytes
   * @param {Object} [opts]
   * @param {string} [opts.jobName='daylight-print'] - job name (also our own logging)
   * @param {string} [opts.user='daylight'] - for our own logging / job-originating-user-name
   * @param {number} [opts.copies=1]
   * @returns {Promise<{ok:boolean, bytes:number, copies:number, documentFormat:string, transport:'ipp'|'raw9100'}>}
   * @throws {InfrastructureError} INVALID_DOCUMENT | PRINT_FORMAT_UNSUPPORTED | RASTERIZE_* | PRINT_SEND_FAILED
   */
  async printPdf(pdf, { jobName = 'daylight-print', user = 'daylight', copies = 1 } = {}) {
    if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
      throw new InfrastructureError('printPdf requires non-empty PDF buffer', { code: 'INVALID_DOCUMENT' });
    }
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new InfrastructureError('document is not a PDF', { code: 'INVALID_DOCUMENT' });
    }
    const nCopies = Math.max(1, Math.floor(copies));

    const caps = await this.#getCapabilities();
    // Decides BOTH the container (document-format) and, when rasterizing is
    // required, the exact pixel parameters for that container — falling back
    // to the other raster format if the first choice's own capability list
    // turns out to have nothing this adapter can parse/produce (see
    // negotiate.mjs and this file's incident #2 header comment).
    const plan = negotiatePrintPlan({
      payloadFormat: 'application/pdf',
      documentFormatSupported: caps.documentFormatSupported,
      documentFormatPreferred: caps.documentFormatPreferred,
      urfSupported: caps.urfSupported,
      pwgRasterDocumentTypeSupported: caps.pwgRasterDocumentTypeSupported,
      pwgRasterResolutionSupported: caps.pwgRasterResolutionSupported,
      printerResolutionSupported: caps.printerResolutionSupported,
      media: caps.media,
    });

    // THE GUARD. No format this printer hasn't named (or whose own
    // per-container pixel capabilities we could actually satisfy) -> refuse,
    // loudly, with exactly what we tried and what it offered. This is the
    // check that would have stopped BOTH incidents: a printer listing
    // `application/octet-stream` alone (incident #1) or a raster container
    // whose declared color/resolution tokens don't parse into anything
    // producible (incident #2's shape, generalized) does NOT pass — see
    // negotiate.mjs for why.
    if (!plan || !caps.documentFormatSupported.includes(plan.format)) {
      throw new InfrastructureError(
        `refusing to print: no supported document-format (with satisfiable raster parameters, if rasterizing) for this payload `
        + `(payload=application/pdf, printer supports=[${caps.documentFormatSupported.join(', ') || 'none'}])`,
        {
          code: 'PRINT_FORMAT_UNSUPPORTED', host: this.#host,
          payloadFormat: 'application/pdf', supported: caps.documentFormatSupported,
        },
      );
    }

    const bytes = plan.needsRasterize
      ? await rasterizePdf(pdf, {
        format: plan.format, dpi: plan.raster.dpi, media: plan.raster.media,
        colorParams: plan.raster,
        maxPages: this.#renderPageLimit, logger: this.#logger,
      })
      : pdf;

    // Only sent when the printer's own job-creation-attributes-supported
    // named them (see negotiate.mjs's chooseJobAttributes) — and only ever
    // describing what we actually rasterized (or, for a direct-PDF
    // container, no pixel-derived hints at all: there's no raster to have
    // decided a resolution/color-mode from).
    const jobAttributes = chooseJobAttributes({
      jobCreationAttributesSupported: caps.jobCreationAttributesSupported,
      dpi: plan.raster?.dpi ?? null,
      printColorMode: plan.raster?.printColorMode ?? null,
      media: plan.raster?.media ?? caps.media,
    });

    if (this.#rawTransport && plan.format === 'application/pdf') {
      // Opt-in only, and still capability-gated: we only get here because
      // `plan.format === 'application/pdf'` came out of negotiation, which
      // means the printer's own document-format-supported listed it.
      const raw = await this.#sendRaw9100(bytes, { jobName, user, copies: nCopies });
      return { ...raw, documentFormat: plan.format, transport: 'raw9100' };
    }

    const sent = await this.#sendIpp(bytes, {
      jobName, user, copies: nCopies, documentFormat: plan.format, jobAttributes,
    });
    return { ...sent, documentFormat: plan.format, transport: 'ipp' };
  }

  /** IPP Print-Job — the default transport. `copies` is a real IPP attribute; no manual concatenation needed. */
  async #sendIpp(document, { jobName, user, copies, documentFormat, jobAttributes = {} }) {
    const attrs = printJobAttrs(this.printerUri, {
      user, jobName, copies, documentFormat, jobAttributes,
    });
    const { ok, statusCode } = await this.#ipp(OPS.PRINT_JOB, attrs, document, this.#printTimeout);
    if (!ok) {
      throw new InfrastructureError(`print-job failed (ipp status 0x${statusCode.toString(16)})`, {
        code: 'PRINT_SEND_FAILED', host: this.#host, port: this.#port, statusCode, documentFormat,
      });
    }
    this.#logger.info?.('laser-printer.job-sent', {
      host: this.#host, port: this.#port, transport: 'ipp', jobName, user, copies, documentFormat, jobAttributes, bytes: document.length,
    });
    return { ok: true, bytes: document.length, copies };
  }

  /**
   * Raw JetDirect send (port 9100). Fire-and-forget: resolves once every
   * byte is flushed and the socket closes cleanly — there is no per-job ack,
   * so a stream/connect failure is the only failure signal. `copies` is sent
   * as N concatenated documents (9100 has no copies attribute); only ever
   * used for a format JetDirect's target firmware is confirmed to accept
   * (see `printPdf`'s capability gate — this method itself does not decide
   * whether raw is appropriate, it just sends what it's given).
   */
  #sendRaw9100(document, { jobName, user, copies }) {
    const payload = copies === 1 ? document : Buffer.concat(Array.from({ length: copies }, () => document));
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
        this.#logger.info?.('laser-printer.job-sent', {
          host: this.#host, port: this.#rawPort, transport: 'raw9100', jobName, user, copies, bytes: payload.length,
        });
        resolve({ ok: true, bytes: payload.length, copies });
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
    const attrs = await this.#fetchAttributes();
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
