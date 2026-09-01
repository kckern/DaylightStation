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
 * ── Incident #3, 2026-08 ───────────────────────────────────────────────────
 * Both fixes above shipped, capabilities all negotiated correctly, and a
 * real Print-Job STILL came back rejected outright — `0x0505
 * server-error-temporary-error` — from a printer reporting itself idle and
 * accepting (`printer-state: 3`, `printer-state-reasons: ["none"]`,
 * `queued-job-count: 0`). Progress over incident #2 (an honest rejection
 * instead of a silent discard), but still not a print, and this time the
 * capability list gave no clue why: every attribute in the job — document
 * format, resolution, color mode, media, `sides` — was one the printer's own
 * `job-creation-attributes-supported` and format-specific capability lists
 * had named as supported.
 *
 * The culprit, found by bisecting the job attributes one at a time against
 * IPP's Validate-Job operation (`OPS.VALIDATE_JOB`, RFC 8011 §3.2.3 — "ask
 * the printer whether it would accept this job" with no document body and no
 * paper produced, so bisecting costs nothing): `sides`. The printer
 * separately advertises `sides-supported: ["one-sided",
 * "two-sided-long-edge", "two-sided-short-edge"]` — a complete, spec-shaped
 * declaration — and its own `sides-default` IS `one-sided`, the exact value
 * this adapter was sending. None of that mattered: the attribute being
 * PRESENT at all, at any value, is what this firmware refuses. Every other
 * job attribute validated individually and combined; only `sides` didn't.
 * `job-creation-attributes-supported` naming a key, it turns out, is a
 * weaker promise than `document-format-supported` naming a format — the
 * same "the capability list doesn't mean what I assumed" lesson as
 * incidents #1 and #2, one layer further up the stack (container, then
 * pixels, now job template attributes).
 *
 * The fix generalizes past "never send `sides` to this one Brother":
 *  1. `LaserPrinterAdapter` now implements Validate-Job (`validateJob`,
 *     exposed publicly — the same `printJobAttrs` encoding as Print-Job,
 *     minus the document body, see ipp.mjs) and calls it, via
 *     `#negotiateJobAttributes`, on EVERY real print, before Print-Job ever
 *     runs. It starts from the full candidate `chooseJobAttributes` computed
 *     and, only if the printer refuses it, drops ONE attribute at a time —
 *     in `negotiate.mjs`'s `JOB_ATTRIBUTE_TRIM_ORDER`, least physically
 *     consequential first — re-validating after each drop, never guessing
 *     which one was the problem, until the printer accepts or nothing is
 *     left (at which point the print is refused with the real cause, not
 *     attempted blind).
 *  2. This is the same "never assume, always verify" posture as incidents #1
 *     and #2, extended to the one remaining layer that hadn't been checked:
 *     we had verified the printer would open the envelope (container) and
 *     could read what was inside it (pixels), but never actually asked
 *     whether it would take the job at all.
 *
 * @module adapters/hardware/laser-printer
 */
import { createConnection } from 'net';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import {
  OPS, encodeRequest, baseAttrs, printJobAttrs, jobAttrsRequest, decodeResponse,
} from './ipp.mjs';
import {
  negotiatePrintPlan, chooseJobAttributes, DEFAULT_MEDIA, JOB_ATTRIBUTE_TRIM_ORDER,
} from './negotiate.mjs';
import { rasterizePdf } from './rasterize.mjs';
import { classifyJobState, isTerminal } from './jobState.mjs';

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
   * @returns {Promise<{ok:boolean, bytes:number, copies:number, jobId:?number, documentFormat:string, transport:'ipp'|'raw9100'}>}
   *   Resolves on SEND, same as before this file grew job-outcome polling —
   *   see `awaitJobOutcome`, which this method now kicks off in the
   *   background (not awaited) and which reports via the
   *   `laser-printer.job-outcome` log event, not through this return value.
   * @throws {InfrastructureError} INVALID_DOCUMENT | PRINT_FORMAT_UNSUPPORTED | RASTERIZE_* | PRINT_VALIDATE_FAILED | PRINT_SEND_FAILED
   */
  /**
   * DUPLEX, AND WHY IT LIVES IN THE RASTER.
   *
   * `duplex` is never sent as a job attribute. This printer advertises
   * `sides-supported` and then returns `0x0505 server-error-temporary-error`
   * the instant a `sides` attribute is present at ANY value, including its
   * own `sides-default`. Measured against the physical HL-L2460DW via
   * Validate-Job (no paper produced) on 2026-08-22:
   *
   *   no `sides` attribute       -> ok, 0x0
   *   sides=one-sided            -> 0x505
   *   sides=two-sided-long-edge  -> 0x505
   *
   * i.e. it isn't the VALUE that's rejected, it's the attribute's presence.
   *
   * The first remedy tried was the printer's OWN `sides-default`, changed at
   * its web UI to `two-sided-long-edge` on the theory that a job omitting
   * `sides` inherits it. THAT DID NOT WORK, and 2026-08-23's sheets proved
   * it: the printer reported `sides-default: two-sided-long-edge`, the job
   * carried no `sides`, and it still came out one page per sheet.
   *
   * The reason is one layer down. We rasterize to `image/urf`, and EVERY URF
   * page carries its own duplex byte in its 32-byte page header. Ghostscript
   * writes 1 (simplex) there unless told otherwise — so the bytes we sent
   * were explicitly instructing the printer to print single-sided, and an
   * explicit per-page instruction beats a printer-level default. We were
   * asking for duplex in the one place the printer was not listening while
   * telling it "simplex" in the place it was.
   *
   * So duplex is applied where it is actually read: `rasterizePdf` passes
   * `-dDuplex`/`-dTumble` to ghostscript, which writes the page-header byte
   * (see that function for the measured value mapping). A caller's `duplex`
   * intent reaches the duplexer only through a rasterized container; a
   * direct-PDF job has no page header of ours and genuinely cannot duplex,
   * which `laser-printer.duplex-requested-not-applied` says plainly rather
   * than going quiet.
   *
   * Callers (`IssueDocument`, `school.yml printing.duplex`) just pass intent.
   */
  async printPdf(pdf, {
    jobName = 'daylight-print', user = 'daylight', copies = 1, duplex = undefined,
  } = {}) {
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
        // The ONLY channel that actually reaches this printer's duplexer.
        // `sides` is refused as a job attribute and the printer's own
        // `sides-default` loses to the per-page duplex byte ghostscript
        // writes into every URF page header — so a caller asking for duplex
        // has to be answered here, in the raster, or not at all.
        duplex: duplex === true,
        maxPages: this.#renderPageLimit, logger: this.#logger,
      })
      : pdf;

    // Duplex honesty, reported AFTER the plan is known rather than guessed
    // before it. Rasterizing is the only path that can carry duplex on this
    // hardware; a direct-PDF container has no page header of ours to write
    // it into, and `sides` is refused, so that combination genuinely cannot
    // duplex and must say so rather than going quiet.
    if (duplex === true) {
      if (plan.needsRasterize) {
        this.#logger.info?.('laser-printer.duplex-applied', {
          host: this.#host, jobName, via: 'raster-page-header', format: plan.format,
        });
      } else {
        this.#logger.warn?.('laser-printer.duplex-requested-not-applied', {
          host: this.#host,
          jobName,
          format: plan.format,
          reason: 'printer rejects the IPP `sides` attribute at any value, and this job is being sent as a direct '
            + 'PDF rather than rasterized — there is no URF page header to carry the duplex byte, which is the only '
            + 'channel that reaches this printer\'s duplexer',
        });
      }
    }

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
      // means the printer's own document-format-supported listed it. Raw
      // JetDirect has no IPP job-attributes concept at all — Validate-Job
      // (an IPP operation) has nothing to check on this transport, so it's
      // skipped rather than performed pointlessly.
      const raw = await this.#sendRaw9100(bytes, { jobName, user, copies: nCopies });
      return { ...raw, documentFormat: plan.format, transport: 'raw9100' };
    }

    // Incident #3 (see this file's header): a capability list naming
    // `sides` was not a promise this printer would actually accept it. Ask
    // FIRST, with Validate-Job — same attributes Print-Job is about to carry,
    // zero paper cost — and only fall through to Print-Job with whatever
    // subset the printer actually confirmed.
    const validatedJobAttributes = await this.#negotiateJobAttributes({
      documentFormat: plan.format, jobName, user, copies: nCopies, jobAttributes,
    });

    const sent = await this.#sendIpp(bytes, {
      jobName, user, copies: nCopies, documentFormat: plan.format, jobAttributes: validatedJobAttributes,
    });

    // DETACHED, DELIBERATELY. printPdf must resolve on SEND — the same
    // contract it always had — not on the printer's eventual terminal
    // answer. `awaitJobOutcome`'s own default deadline is 30s; awaiting it
    // here would hold open whatever HTTP request/loop called printPdf (e.g.
    // a sequential bulk-print loop, one POST per subject) for up to 30s per
    // print, well past any UI's own "don't wait forever" timeout. So: start
    // the poll, do not await it, and log the outcome when it lands. The
    // point of Phase 1 — knowing what actually happened — is served by the
    // log record, not by a slower return value.
    if (Number.isInteger(sent.jobId)) {
      this.awaitJobOutcome(sent.jobId)
        .then((outcome) => {
          this.#logger.info?.('laser-printer.job-outcome', {
            host: this.#host, jobName, jobId: sent.jobId,
            outcome: outcome.outcome, state: outcome.state,
            stateReasons: outcome.stateReasons, polls: outcome.polls,
            impressionsCompleted: outcome.impressionsCompleted,
          });
        })
        // `awaitJobOutcome` itself never rejects, but a detached promise
        // chain with no rejection handler can still crash the process on an
        // unhandled rejection if something upstream ever does — a status
        // query failing must never be able to do that, so this is a
        // deliberate backstop, not defensive filler.
        .catch((err) => {
          this.#logger.warn?.('laser-printer.job-outcome-poll-failed', {
            host: this.#host, jobName, jobId: sent.jobId, error: err?.message ?? String(err),
          });
        });
    }

    return { ...sent, documentFormat: plan.format, transport: 'ipp' };
  }

  /**
   * Validate-Job (RFC 8011 §3.2.3) — "would you accept this job?" with no
   * document body and no side effect: the printer answers without
   * allocating a Job object or producing paper, so this can be (and, in
   * building the fix for incident #3, was) called as many times as needed
   * to bisect a rejection. Same operation-attribute encoding as Print-Job
   * (`printJobAttrs` in ipp.mjs) — the only difference on the wire is the
   * operation code and the absence of trailing document bytes.
   *
   * Exposed publicly (not just used internally by `#negotiateJobAttributes`)
   * so a caller — or a diagnostic script, the way incident #3 was actually
   * root-caused — can probe an arbitrary candidate job directly.
   *
   * @param {Object} params
   * @param {string} [params.jobName='daylight-print']
   * @param {string} [params.user='daylight']
   * @param {number} [params.copies=1]
   * @param {string} params.documentFormat - required, same rule as printJobAttrs: never default to octet-stream
   * @param {Object} [params.jobAttributes] - see printJobAttrs's jobAttributes shape
   * @returns {Promise<{ok:boolean, statusCode:number}>}
   */
  async validateJob({
    jobName = 'daylight-print', user = 'daylight', copies = 1, documentFormat, jobAttributes = {},
  } = {}) {
    const attrs = printJobAttrs(this.printerUri, {
      user, jobName, copies, documentFormat, jobAttributes,
    });
    const { ok, statusCode } = await this.#ipp(OPS.VALIDATE_JOB, attrs, null, this.#timeout);
    return { ok, statusCode };
  }

  /**
   * Incident #3's actual fix. Starts from the full candidate job attributes
   * `chooseJobAttributes` computed from capability lists alone, and asks the
   * printer for real via `validateJob`. If refused, drops exactly one
   * attribute — `negotiate.mjs`'s `JOB_ATTRIBUTE_TRIM_ORDER`, least
   * physically consequential first — and asks again, repeating until the
   * printer accepts or nothing is left to drop. Never guesses which
   * attribute was the problem: every candidate that gets sent as a real
   * Print-Job was independently confirmed by the printer itself, not
   * inferred from a single rejection.
   *
   * @throws {InfrastructureError} PRINT_VALIDATE_FAILED — the printer refuses
   *   even the empty-job-attributes candidate; the problem is the document
   *   format/content itself, not a trimmable job attribute, so this refuses
   *   to guess further and Print-Job is never attempted.
   */
  async #negotiateJobAttributes({
    documentFormat, jobName, user, copies, jobAttributes,
  }) {
    let candidate = { ...jobAttributes };
    let probe = await this.validateJob({
      jobName, user, copies, documentFormat, jobAttributes: candidate,
    });
    if (probe.ok) return candidate;

    this.#logger.warn?.('laser-printer.validate-job-rejected', {
      host: this.#host, documentFormat, jobAttributes: candidate, statusCode: probe.statusCode,
    });

    for (const key of JOB_ATTRIBUTE_TRIM_ORDER) {
      if (!(key in candidate)) continue;
      const trimmed = { ...candidate };
      delete trimmed[key];
      // eslint-disable-next-line no-await-in-loop -- each probe's candidate depends on the previous probe's outcome; nothing here can run in parallel
      probe = await this.validateJob({
        jobName, user, copies, documentFormat, jobAttributes: trimmed,
      });
      candidate = trimmed;
      this.#logger.info?.('laser-printer.validate-job-retry', {
        host: this.#host, dropped: key, statusCode: probe.statusCode, ok: probe.ok,
      });
      if (probe.ok) return candidate;
    }

    throw new InfrastructureError(
      `printer refuses this job even with every optional job attribute stripped `
      + `(validate-job status 0x${probe.statusCode.toString(16)}) — the document-format or `
      + `rasterized content itself is the problem, not a job attribute; refusing to send Print-Job blind`,
      {
        code: 'PRINT_VALIDATE_FAILED', host: this.#host, documentFormat, statusCode: probe.statusCode,
      },
    );
  }

  /** IPP Print-Job — the default transport. `copies` is a real IPP attribute; no manual concatenation needed. */
  async #sendIpp(document, { jobName, user, copies, documentFormat, jobAttributes = {} }) {
    // Named `requestAttrs`, not `attrs`, so it doesn't shadow the response's
    // own `attrs` below — the two are unrelated objects (this method's
    // outgoing job-attributes vs. the printer's returned attribute set).
    const requestAttrs = printJobAttrs(this.printerUri, {
      user, jobName, copies, documentFormat, jobAttributes,
    });
    const { ok, statusCode, attrs } = await this.#ipp(OPS.PRINT_JOB, requestAttrs, document, this.#printTimeout);
    if (!ok) {
      throw new InfrastructureError(`print-job failed (ipp status 0x${statusCode.toString(16)})`, {
        code: 'PRINT_SEND_FAILED', host: this.#host, port: this.#port, statusCode, documentFormat,
      });
    }
    // The printer's own handle for this job. Parsed all along by
    // `decodeResponse` and dropped here, which is why nothing downstream could
    // ever ask what became of a job.
    // `decodeResponse` collects EVERY attribute as an array
    // (`(attrs[name] ||= []).push(value)`, ipp.mjs:219), so this is `[42]`,
    // never `42`.
    const jobId = Number.isInteger(attrs?.['job-id']?.[0]) ? attrs['job-id'][0] : null;
    this.#logger.info?.('laser-printer.job-sent', {
      host: this.#host, port: this.#port, transport: 'ipp', jobName, user, copies, documentFormat, jobAttributes, bytes: document.length, jobId,
    });
    return { ok: true, bytes: document.length, copies, jobId };
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
        // JetDirect has no job handle — say so explicitly rather than
        // leaving the key absent, so both transports return the same shape.
        resolve({ ok: true, bytes: payload.length, copies, jobId: null });
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

  /**
   * What the printer says about one job. Never throws on an unparseable IPP
   * answer — that comes back as `classification: 'unknown'`, because "the
   * printer stopped answering" is not "the sheet failed to print". It CAN
   * still throw on a transport failure (HTTP error, network error): callers
   * polling for an outcome must catch it themselves (see `awaitJobOutcome`,
   * which does).
   *
   * @param {number} jobId
   */
  async getJobState(jobId) {
    const { ok, attrs } = await this.#ipp(
      OPS.GET_JOB_ATTRIBUTES,
      jobAttrsRequest(this.printerUri, { user: 'daylight', jobId }),
      null,
      this.#timeout,
    );
    // Every attribute decodes as an array (ipp.mjs:219).
    const state = ok && Number.isInteger(attrs?.['job-state']?.[0])
      ? attrs['job-state'][0]
      : null;
    return {
      state,
      classification: classifyJobState(state),
      stateReasons: attrs?.['job-state-reasons'] ?? [],
      impressionsCompleted: Number.isInteger(attrs?.['job-impressions-completed']?.[0])
        ? attrs['job-impressions-completed'][0]
        : null,
    };
  }

  /**
   * Poll one job until the printer gives a terminal answer, or the deadline
   * passes.
   *
   * THREE OUTCOMES, DELIBERATELY. `indeterminate` is not `failed`: it means we
   * stopped asking, or the printer stopped answering, and we do not know
   * whether paper came out. Collapsing it into `failed` would prompt a reprint
   * of a sheet that printed — duplicate worksheets bound to different
   * answer-card rows, which is a worse mess than a missing sheet.
   *
   * Never throws. A print that succeeded must not be reported as failed
   * because a status query did.
   *
   * @param {number|null} jobId
   * @param {{deadlineMs?: number, intervalMs?: number, sleep?: Function, clock?: Function}} [options]
   */
  async awaitJobOutcome(jobId, options = {}) {
    const {
      deadlineMs = 30000,
      intervalMs = 1000,
      sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
      clock = () => Date.now(),
    } = options;

    const base = {
      state: null, stateReasons: [], impressionsCompleted: null, polls: 0,
    };
    // JetDirect has no job handle, and a dropped id is a bug elsewhere. Either
    // way, say we do not know rather than poll something meaningless.
    if (!Number.isInteger(jobId)) return { ...base, outcome: 'indeterminate' };

    const started = clock();
    let polls = 0;
    let last = base;
    while (clock() - started < deadlineMs) {
      polls += 1;
      try {
        // eslint-disable-next-line no-await-in-loop -- each poll depends on the previous one's outcome; nothing here can run in parallel
        const observed = await this.getJobState(jobId);
        last = { ...observed, polls };
        if (isTerminal(observed.state)) {
          return { ...last, outcome: observed.classification };
        }
      } catch (err) {
        // Swallowed on purpose: an unreachable printer is an unknown outcome,
        // not a failed print. Keep the last state we DID observe (if any) and
        // keep trying to the deadline. Still logged at debug — silently
        // swallowing means a TypeError here reads identically to "the
        // printer went offline" in every log query, which defeats exactly
        // the postmortem capability this feature exists to provide.
        this.#logger.debug?.('laser-printer.job-outcome-poll-error', {
          host: this.#host, jobId, poll: polls, error: err?.message ?? String(err),
        });
        last = { ...last, polls };
      }
      // eslint-disable-next-line no-await-in-loop -- deliberate poll cadence, not a parallelizable batch
      await sleep(intervalMs);
    }
    return { ...last, polls, outcome: 'indeterminate' };
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
