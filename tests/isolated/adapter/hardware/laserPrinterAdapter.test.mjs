// @vitest-environment node
//
// The suite's default environment (happy-dom, see vitest.config.mjs) patches
// global `fetch` for DOM-flavored use and mangles the binary IPP request
// bodies LaserPrinterAdapter sends (Buffer.readUInt16BE on the server side
// started going out-of-bounds — the body arrived truncated/re-encoded).
// LaserPrinterAdapter is pure Node backend code with no DOM dependency, so
// forcing the real Node environment for this file is correct, not a
// workaround for a real bug.
import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import http from 'http';
import { execFileSync } from 'node:child_process';
import { LaserPrinterAdapter } from '../../../../backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs';
import { OPS, encodeRequest, decodeResponse } from '../../../../backend/src/1_adapters/hardware/laser-printer/ipp.mjs';

// Passes LaserPrinterAdapter's own `%PDF-` header sniff but is not a real
// parseable PDF — fine for every test except the rasterization path, which
// hands the bytes to a real ghostscript process.
const PDF = Buffer.from('%PDF-1.4\n... fake worksheet ...\n%%EOF');

// A minimal-but-actually-valid single-page PDF, for the one test that runs
// real ghostscript end-to-end (mirrors the fixture in laserPrinterRasterize.test.mjs).
const REAL_PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF',
  'latin1',
);

let hasGs = false;
try { execFileSync('gs', ['--version'], { stdio: 'ignore' }); hasGs = true; } catch { hasGs = false; }

let server;
afterEach(() => { if (server) { server.close(); server = null; } });

// -----------------------------------------------------------------------
// Fake IPP server: answers Get-Printer-Attributes with a caller-supplied
// capability set, and records every Print-Job it receives (document-format
// + full request bytes, so a test can diff the trailing document bytes
// against what it expects). Reusing `encodeRequest`/`decodeResponse` here
// is legitimate — the IPP request/response frame layout (version, a
// status/operation code, request-id, tagged attributes, optional document)
// is identical in both directions; only the *meaning* of the 2-byte field
// at offset 2 differs (operation vs. status-code).
// -----------------------------------------------------------------------
/** RFC 8011 §5.1.14 resolution value — mirrors ipp.mjs's own resolutionAttr, duplicated here so the fake server has no production import. */
function resolutionValue({ xres, yres, units = 3 }) {
  const v = Buffer.alloc(9);
  v.writeInt32BE(xres, 0);
  v.writeInt32BE(yres, 4);
  v.writeUInt8(units, 8);
  return v;
}

function ippServer({
  documentFormatSupported = [], documentFormatPreferred = null, urfSupported = [],
  pwgRasterDocumentTypeSupported = [], pwgRasterResolutionSupported = [],
  jobCreationAttributesSupported = [],
  // sides-default / sides-supported — the printer's OWN duplex configuration,
  // as reported by GET_PRINTER_ATTRIBUTES. Omitted by default (many of the
  // other tests in this file don't care about duplex at all).
  sidesDefault = null, sidesSupported = [],
  // 1-indexed GET_PRINTER_ATTRIBUTES call number(s) at which the fake
  // printer answers with a bare HTTP 500 instead of a real attributes
  // response, instead of the normal path — e.g. `1` fails only the FIRST
  // such call and lets every later one (including the capabilities call
  // `#getCapabilities()` needs for format negotiation) succeed normally.
  // Simulates the printer-attribute read done purely for the duplex-honesty
  // log failing independently of the read format negotiation depends on.
  attributesFailOn = [],
  // (decodedAttrs) => boolean — the fake printer's Validate-Job verdict for a
  // given candidate. Default accepts everything, matching a printer with no
  // incident-#3-shaped quirk. Tests below override this to reproduce the
  // real Brother's exact behavior: refuse whenever `sides` is present.
  validateJob = () => true,
} = {}) {
  const printJobs = [];
  const validateJobs = [];
  const failOnSet = new Set(Array.isArray(attributesFailOn) ? attributesFailOn : [attributesFailOn]);
  let attributesCallCount = 0;
  const capabilityAttrs = [
    { tag: 0x47, name: 'attributes-charset', value: 'utf-8' },
    { tag: 0x48, name: 'attributes-natural-language', value: 'en' },
    { tag: 0x41, name: 'printer-make-and-model', value: 'Test Printer' },
    ...documentFormatSupported.map((f) => ({ tag: 0x49, name: 'document-format-supported', value: f })),
    ...(documentFormatPreferred ? [{ tag: 0x49, name: 'document-format-preferred', value: documentFormatPreferred }] : []),
    ...urfSupported.map((u) => ({ tag: 0x44, name: 'urf-supported', value: u })),
    ...pwgRasterDocumentTypeSupported.map((t) => ({ tag: 0x44, name: 'pwg-raster-document-type-supported', value: t })),
    ...pwgRasterResolutionSupported.map((r) => ({ tag: 0x32, name: 'pwg-raster-document-resolution-supported', value: resolutionValue(r) })),
    ...jobCreationAttributesSupported.map((a) => ({ tag: 0x44, name: 'job-creation-attributes-supported', value: a })),
    ...(sidesDefault ? [{ tag: 0x44, name: 'sides-default', value: sidesDefault }] : []),
    ...sidesSupported.map((s) => ({ tag: 0x44, name: 'sides-supported', value: s })),
  ];

  return new Promise((resolve) => {
    const httpServer = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const operation = body.readUInt16BE(2); // same wire offset as a response's status-code
        if (operation === OPS.GET_PRINTER_ATTRIBUTES) {
          attributesCallCount += 1;
          if (failOnSet.has(attributesCallCount)) {
            res.writeHead(500);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/ipp' });
          res.end(encodeRequest(0x0000, capabilityAttrs, null, 1));
          return;
        }
        if (operation === OPS.PRINT_JOB) {
          const { attrs } = decodeResponse(body); // stops at end-tag; never touches the trailing document
          printJobs.push({
            documentFormat: attrs['document-format']?.[0] ?? null,
            fullBody: body,
            copies: attrs.copies?.[0] ?? 1,
            printerResolution: attrs['printer-resolution']?.[0] ?? null,
            printColorMode: attrs['print-color-mode']?.[0] ?? null,
            sides: attrs.sides?.[0] ?? null,
            media: attrs.media?.[0] ?? null,
          });
          res.writeHead(200, { 'Content-Type': 'application/ipp' });
          res.end(encodeRequest(0x0000, [
            { tag: 0x47, name: 'attributes-charset', value: 'utf-8' },
            { tag: 0x48, name: 'attributes-natural-language', value: 'en' },
          ], null, 1));
          return;
        }
        if (operation === OPS.VALIDATE_JOB) {
          // Real Validate-Job (RFC 8011 §3.2.3) carries no document body —
          // `body` here is operation-attributes only, same shape as a
          // Print-Job request minus the trailing bytes, which is exactly
          // what `decodeResponse` (reused for its identical frame layout)
          // reads.
          const { attrs } = decodeResponse(body);
          const accept = validateJob(attrs);
          validateJobs.push({
            accept,
            documentFormat: attrs['document-format']?.[0] ?? null,
            printerResolution: attrs['printer-resolution']?.[0] ?? null,
            printColorMode: attrs['print-color-mode']?.[0] ?? null,
            sides: attrs.sides?.[0] ?? null,
            media: attrs.media?.[0] ?? null,
          });
          res.writeHead(200, { 'Content-Type': 'application/ipp' });
          res.end(encodeRequest(accept ? 0x0000 : 0x0505, [
            { tag: 0x47, name: 'attributes-charset', value: 'utf-8' },
            { tag: 0x48, name: 'attributes-natural-language', value: 'en' },
          ], null, 1));
          return;
        }
        res.writeHead(500);
        res.end();
      });
    });
    httpServer.listen(0, '127.0.0.1', () => resolve({
      httpServer,
      port: httpServer.address().port,
      printJobs,
      validateJobs,
      get attributesCallCount() { return attributesCallCount; },
    }));
  });
}

/** The document bytes a Print-Job request ends with are always the last N bytes of the frame (encodeRequest appends verbatim). */
function tailBytes(fullBody, expected) {
  return fullBody.subarray(fullBody.length - expected.length).equals(expected);
}

function rawSink() {
  return new Promise((resolve) => {
    const received = [];
    server = net.createServer((sock) => {
      const chunks = [];
      sock.on('data', (c) => chunks.push(c));
      sock.on('end', () => { received.push(Buffer.concat(chunks)); });
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, received }));
  });
}

describe('LaserPrinterAdapter.printPdf — validation (before any network activity)', () => {
  it('rejects a non-PDF buffer before opening any connection', async () => {
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port: 1, logger: { info() {} } });
    await expect(p.printPdf(Buffer.from('not a pdf'))).rejects.toThrow(/not a PDF/i);
  });

  it('rejects an empty buffer', async () => {
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port: 1, logger: { info() {} } });
    await expect(p.printPdf(Buffer.alloc(0))).rejects.toThrow(/non-empty/i);
  });
});

describe('LaserPrinterAdapter.printPdf — capability negotiation (the fix)', () => {
  it('a printer that advertises application/pdf gets the PDF verbatim, over IPP, unrasterized', async () => {
    const { httpServer, port, printJobs } = await ippServer({
      documentFormatSupported: ['application/octet-stream', 'application/pdf'],
      documentFormatPreferred: 'application/pdf',
    });
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {} } });
    const result = await p.printPdf(PDF, { jobName: 'ws', user: 'learner2' });
    httpServer.close();

    expect(result.ok).toBe(true);
    expect(result.transport).toBe('ipp');
    expect(result.documentFormat).toBe('application/pdf');
    expect(printJobs).toHaveLength(1);
    expect(printJobs[0].documentFormat).toBe('application/pdf');
    expect(tailBytes(printJobs[0].fullBody, PDF)).toBe(true); // sent as-is — no rasterization
  });

  it.runIf(hasGs)('a printer advertising only urf/pwg-raster gets rasterized bytes (image/urf magic), never the raw PDF', async () => {
    const { httpServer, port, printJobs } = await ippServer({
      documentFormatSupported: ['application/octet-stream', 'image/urf', 'image/pwg-raster'],
      documentFormatPreferred: 'image/urf',
      // "W8" is what tells negotiate.mjs's chooseUrfColor this printer wants
      // 8-bit grayscale — without a CS token here there is nothing to
      // satisfy urf's raster constraints and the print plan correctly comes
      // back null (see the incident #2 header comment in LaserPrinterAdapter.mjs).
      urfSupported: ['V1.4', 'RS300-600', 'W8'],
    });
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {} } });
    const result = await p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner2' });
    httpServer.close();

    expect(result.ok).toBe(true);
    expect(result.documentFormat).toBe('image/urf');
    expect(printJobs).toHaveLength(1);
    expect(printJobs[0].documentFormat).toBe('image/urf');
    // The transmitted bytes are NOT the PDF — this is the exact failure the
    // incident needs never repeat. They're ghostscript's urf output.
    expect(tailBytes(printJobs[0].fullBody, REAL_PDF)).toBe(false);
    expect(printJobs[0].fullBody.includes(Buffer.from('UNIRAST\0', 'latin1'))).toBe(true);
  });

  it.runIf(hasGs)('incident #2, end to end: the exact Brother HL-L2460DW capability shape produces a grayscale-8bpp raster at the format-specific DPI, with matching IPP job attributes', async () => {
    const { httpServer, port, printJobs } = await ippServer({
      documentFormatSupported: ['application/octet-stream', 'image/urf', 'image/pwg-raster'],
      documentFormatPreferred: 'image/urf',
      urfSupported: ['W8', 'CP1', 'IS4-1', 'MT1-3-4-5-8', 'OB10', 'PQ3-4-5', 'RS300-600-1200', 'V1.5', 'DM1'],
      pwgRasterDocumentTypeSupported: ['sgray_8'],
      pwgRasterResolutionSupported: [{ xres: 600, yres: 600, units: 3 }],
      jobCreationAttributesSupported: [
        'copies', 'finishings', 'ipp-attribute-fidelity', 'job-name', 'media', 'media-col',
        'orientation-requested', 'output-bin', 'output-mode', 'print-quality', 'printer-resolution',
        'requesting-user-name', 'sides', 'print-color-mode', 'job-pages-per-set',
      ],
    });
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {} } });
    const result = await p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner2' });
    httpServer.close();

    expect(result.ok).toBe(true);
    // image/urf is the printer's own document-format-preferred, and its
    // urf-supported list (W8, RS300-600-1200) is fully satisfiable, so
    // negotiatePrintPlan has no reason to fall back to pwg-raster here.
    expect(result.documentFormat).toBe('image/urf');
    expect(printJobs).toHaveLength(1);

    // The IPP job attributes describe exactly what was rasterized — the
    // metadata and the pixels no longer disagree with each other.
    expect(printJobs[0].printerResolution).toEqual({ xres: 300, yres: 300, units: 3 });
    expect(printJobs[0].printColorMode).toBe('monochrome');
    expect(printJobs[0].sides).toBe('one-sided');
    expect(printJobs[0].media).toBe('na_letter_8.5x11in');

    // And the raster bytes actually sent match: 8bpp (not the ghostscript
    // device's 1-bit default), Letter geometry at 300dpi.
    const doc = printJobs[0].fullBody.subarray(printJobs[0].fullBody.length - (printJobs[0].fullBody.length - printJobs[0].fullBody.indexOf(Buffer.from('UNIRAST\0', 'latin1'))));
    expect(doc.readUInt8(12)).toBe(8); // bitsPerPixel
    expect(doc.readUInt32BE(24)).toBe(2550); // width px @300dpi Letter
    expect(doc.readUInt32BE(28)).toBe(3300); // height px @300dpi Letter
    expect(doc.readUInt32BE(32)).toBe(300); // resolution
  });

  it('a printer advertising neither PDF nor a producible raster format is REFUSED — nothing is sent', async () => {
    const { httpServer, port, printJobs } = await ippServer({
      // This is the exact shape of the incident: octet-stream ONLY.
      documentFormatSupported: ['application/octet-stream'],
    });
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {} } });

    await expect(p.printPdf(PDF)).rejects.toMatchObject({ code: 'PRINT_FORMAT_UNSUPPORTED' });
    httpServer.close();
    expect(printJobs).toHaveLength(0); // the guard: no Print-Job was ever transmitted
  });

  it('the guard also fires when a printer advertises nothing at all', async () => {
    const { httpServer, port, printJobs } = await ippServer({ documentFormatSupported: [] });
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {} } });
    await expect(p.printPdf(PDF)).rejects.toMatchObject({ code: 'PRINT_FORMAT_UNSUPPORTED' });
    httpServer.close();
    expect(printJobs).toHaveLength(0);
  });
});

describe('LaserPrinterAdapter — Incident #3: Validate-Job before every real Print-Job', () => {
  // The exact Brother HL-L2460DW capability shape from the incidents,
  // reused so these tests exercise the real negotiated candidate
  // (image/urf, 8-bit grayscale, printer-resolution/print-color-mode/
  // sides/media all present) rather than a synthetic one.
  const brotherCaps = {
    documentFormatSupported: ['application/octet-stream', 'image/urf', 'image/pwg-raster'],
    documentFormatPreferred: 'image/urf',
    urfSupported: ['W8', 'CP1', 'IS4-1', 'MT1-3-4-5-8', 'OB10', 'PQ3-4-5', 'RS300-600-1200', 'V1.5', 'DM1'],
    pwgRasterDocumentTypeSupported: ['sgray_8'],
    pwgRasterResolutionSupported: [{ xres: 600, yres: 600, units: 3 }],
    jobCreationAttributesSupported: [
      'copies', 'finishings', 'ipp-attribute-fidelity', 'job-name', 'media', 'media-col',
      'orientation-requested', 'output-bin', 'output-mode', 'print-quality', 'printer-resolution',
      'requesting-user-name', 'sides', 'print-color-mode', 'job-pages-per-set',
    ],
  };

  it.runIf(hasGs)('a printer that accepts the full candidate: Validate-Job runs once, Print-Job carries every attribute unchanged', async () => {
    const { httpServer, port, printJobs, validateJobs } = await ippServer(brotherCaps); // default validateJob: () => true
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {}, warn() {} } });

    const result = await p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner2' });
    httpServer.close();

    expect(result.ok).toBe(true);
    expect(validateJobs).toHaveLength(1); // exactly one round trip when nothing needed trimming
    expect(validateJobs[0].sides).toBe('one-sided');
    expect(validateJobs[0].printColorMode).toBe('monochrome');
    expect(validateJobs[0].media).toBe('na_letter_8.5x11in');
    // Validate-Job's candidate and the eventual Print-Job's attributes match
    // exactly — the whole point of validating with the SAME encoder.
    expect(printJobs[0].sides).toBe(validateJobs[0].sides);
    expect(printJobs[0].printColorMode).toBe(validateJobs[0].printColorMode);
    expect(printJobs[0].media).toBe(validateJobs[0].media);
  });

  it.runIf(hasGs)('the exact real-world shape: printer refuses any job carrying `sides` — adapter drops it and Print-Job succeeds without it', async () => {
    const { httpServer, port, printJobs, validateJobs } = await ippServer({
      ...brotherCaps,
      // Reproduces the real Brother HL-L2460DW's Validate-Job behavior
      // (confirmed against the physical device, see the fix report):
      // `sides-supported` lists `one-sided` — the printer's own default —
      // and it STILL refuses the instant a `sides` attribute is present at
      // any value.
      validateJob: (attrs) => !('sides' in attrs),
    });
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {}, warn() {} } });

    const result = await p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner2' });
    httpServer.close();

    expect(result.ok).toBe(true);
    // Two Validate-Job round trips: the full candidate (rejected because it
    // carries `sides`), then the same candidate with `sides` dropped
    // (accepted) — `sides` is first in JOB_ATTRIBUTE_TRIM_ORDER, so nothing
    // else needed to be tried.
    expect(validateJobs).toHaveLength(2);
    expect(validateJobs[0].accept).toBe(false);
    expect(validateJobs[0].sides).toBe('one-sided');
    expect(validateJobs[1].accept).toBe(true);
    expect(validateJobs[1].sides).toBeNull();
    // The other three attributes survived the trim untouched.
    expect(validateJobs[1].printColorMode).toBe('monochrome');
    expect(validateJobs[1].media).toBe('na_letter_8.5x11in');

    // And the real Print-Job that followed carries the SAME trimmed set —
    // never the original, never a guess.
    expect(printJobs).toHaveLength(1);
    expect(printJobs[0].sides).toBeNull();
    expect(printJobs[0].printColorMode).toBe('monochrome');
    expect(printJobs[0].media).toBe('na_letter_8.5x11in');
  });

  it.runIf(hasGs)('a printer that refuses every candidate, down to the empty one, is never sent a real Print-Job: PRINT_VALIDATE_FAILED', async () => {
    const { httpServer, port, printJobs, validateJobs } = await ippServer({
      ...brotherCaps,
      validateJob: () => false, // refuses categorically, including the empty candidate
    });
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {}, warn() {} } });

    await expect(p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner2' }))
      .rejects.toMatchObject({ code: 'PRINT_VALIDATE_FAILED' });
    httpServer.close();

    // Every optional attribute (sides, print-color-mode, printer-resolution,
    // media — JOB_ATTRIBUTE_TRIM_ORDER's full length) was tried and stripped
    // in turn before giving up: 1 (full candidate) + 4 (one per trimmed key).
    expect(validateJobs).toHaveLength(5);
    expect(validateJobs.every((v) => v.accept === false)).toBe(true);
    // The guard held: no paper-costing Print-Job was ever attempted.
    expect(printJobs).toHaveLength(0);
  });

  it('validateJob is exposed publicly and reports the raw ok/statusCode the printer returned', async () => {
    const { httpServer, port } = await ippServer({
      ...brotherCaps,
      validateJob: (attrs) => !('sides' in attrs),
    });
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {} } });

    const rejected = await p.validateJob({ documentFormat: 'image/urf', jobAttributes: { sides: 'one-sided' } });
    expect(rejected).toEqual({ ok: false, statusCode: 0x0505 });

    const accepted = await p.validateJob({ documentFormat: 'image/urf', jobAttributes: { media: 'na_letter_8.5x11in' } });
    expect(accepted).toEqual({ ok: true, statusCode: 0x0000 });

    httpServer.close();
  });

  it('validateJob requires an explicit documentFormat, same rule as Print-Job — never defaults to octet-stream', async () => {
    const { httpServer, port } = await ippServer(brotherCaps);
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger: { info() {} } });
    await expect(p.validateJob({ jobAttributes: {} })).rejects.toThrow(/documentFormat/i);
    httpServer.close();
  });
});

/**
 * DUPLEX HONESTY, after the 2026-08-23 correction.
 *
 * The earlier version of this block asserted a theory that turned out to be
 * wrong: that omitting the IPP `sides` attribute would let the printer's own
 * `sides-default` apply. It was set to `two-sided-long-edge` and worksheets
 * still printed one page per sheet, because ghostscript writes a per-page
 * duplex byte of 1 (simplex) into every URF page header, and an explicit
 * per-page instruction beats a printer default. Duplex is now applied in the
 * raster, so the honest report is about WHICH CONTAINER the job took.
 */
describe('LaserPrinterAdapter.printPdf — duplex honesty (applied in the raster)', () => {
  // Captures every logger call instead of asserting against real console
  // output — `info`/`warn` calls are pushed with their event name + payload
  // so tests can assert on exactly which event fired and what it carried.
  function collectingLogger() {
    const calls = [];
    return {
      logger: {
        info(event, data) { calls.push({ level: 'info', event, data }); },
        warn(event, data) { calls.push({ level: 'warn', event, data }); },
      },
      calls,
    };
  }

  const rasterPrinter = () => ippServer({
    documentFormatSupported: ['application/octet-stream', 'image/urf', 'image/pwg-raster'],
    documentFormatPreferred: 'image/urf',
    urfSupported: ['V1.4', 'RS300-600', 'W8'],
  });

  const directPdfPrinter = () => ippServer({
    documentFormatSupported: ['application/octet-stream', 'application/pdf'],
    documentFormatPreferred: 'application/pdf',
  });

  it.runIf(hasGs)('a rasterized job reports duplex APPLIED, via the page header', async () => {
    const { httpServer, port } = await rasterPrinter();
    const { logger, calls } = collectingLogger();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger });

    const result = await p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner2', duplex: true });
    httpServer.close();

    expect(result.ok).toBe(true);
    const applied = calls.find((c) => c.event === 'laser-printer.duplex-applied');
    expect(applied).toBeTruthy();
    expect(applied.level).toBe('info');
    expect(applied.data.via).toBe('raster-page-header');
    expect(applied.data.format).toBe('image/urf');
    expect(calls.some((c) => c.event === 'laser-printer.duplex-requested-not-applied')).toBe(false);
  });

  it('a DIRECT-PDF job cannot duplex and says so — there is no page header of ours to write it into', async () => {
    const { httpServer, port } = await directPdfPrinter();
    const { logger, calls } = collectingLogger();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger });

    const result = await p.printPdf(PDF, { jobName: 'ws', user: 'learner2', duplex: true });
    httpServer.close();

    // The print still SUCCEEDS — an un-duplexed sheet beats no sheet.
    expect(result.ok).toBe(true);
    const notApplied = calls.find((c) => c.event === 'laser-printer.duplex-requested-not-applied');
    expect(notApplied).toBeTruthy();
    expect(notApplied.level).toBe('warn');
    expect(notApplied.data.format).toBe('application/pdf');
    // The reason must name the real mechanism, not the old sides-default story.
    expect(notApplied.data.reason).toMatch(/page header/i);
    expect(calls.some((c) => c.event === 'laser-printer.duplex-applied')).toBe(false);
  });

  it.runIf(hasGs)('says nothing about duplex when the caller never asked for it', async () => {
    const { httpServer, port } = await rasterPrinter();
    const { logger, calls } = collectingLogger();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger });

    await p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner2' });
    httpServer.close();

    expect(calls.some((c) => c.event?.startsWith('laser-printer.duplex'))).toBe(false);
  });

  it.runIf(hasGs)('never sends `sides` as a job attribute — the firmware refuses it at any value', async () => {
    const { httpServer, port } = await rasterPrinter();
    const { logger, calls } = collectingLogger();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port, logger });

    await p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner2', duplex: true });
    httpServer.close();

    const sent = calls.find((c) => c.event === 'laser-printer.job-sent');
    expect(sent).toBeTruthy();
    expect(sent.data.jobAttributes?.sides).toBeUndefined();
  });
});

describe('LaserPrinterAdapter.printPdf — raw 9100 transport (opt-in, still capability-gated)', () => {
  it('with rawTransport:true and a printer that advertises PDF, sends over raw JetDirect instead of IPP', async () => {
    const { httpServer, port: ippPort } = await ippServer({
      documentFormatSupported: ['application/octet-stream', 'application/pdf'],
      documentFormatPreferred: 'application/pdf',
    });
    const { port: rawPort, received } = await rawSink();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port: ippPort, rawPort, rawTransport: true, logger: { info() {} } });

    const result = await p.printPdf(PDF, { jobName: 't', user: 'learner2' });
    httpServer.close();

    expect(result.ok).toBe(true);
    expect(result.transport).toBe('raw9100');
    expect(result.bytes).toBe(PDF.length);
    await new Promise((res) => setTimeout(res, 20));
    expect(received[0].equals(PDF)).toBe(true);
  });

  it('sends N copies as N concatenated documents over raw 9100', async () => {
    const { httpServer, port: ippPort } = await ippServer({ documentFormatSupported: ['application/pdf'] });
    const { port: rawPort, received } = await rawSink();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port: ippPort, rawPort, rawTransport: true, logger: { info() {} } });

    const result = await p.printPdf(PDF, { copies: 3 });
    httpServer.close();

    expect(result.copies).toBe(3);
    expect(result.bytes).toBe(PDF.length * 3);
    await new Promise((res) => setTimeout(res, 20));
    expect(received[0].length).toBe(PDF.length * 3);
  });

  it('rawTransport:true does NOT bypass the guard — a printer that only lists octet-stream still gets refused, never sent raw', async () => {
    const { httpServer, port: ippPort } = await ippServer({ documentFormatSupported: ['application/octet-stream'] });
    const { port: rawPort, received } = await rawSink();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port: ippPort, rawPort, rawTransport: true, logger: { info() {} } });

    await expect(p.printPdf(PDF)).rejects.toMatchObject({ code: 'PRINT_FORMAT_UNSUPPORTED' });
    httpServer.close();
    await new Promise((res) => setTimeout(res, 20));
    expect(received).toHaveLength(0); // nothing ever hit the raw socket either
  });

  it('surfaces a raw connection failure as an InfrastructureError', async () => {
    const { httpServer, port: ippPort } = await ippServer({ documentFormatSupported: ['application/pdf'] });
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port: ippPort, rawPort: 1, rawTransport: true, printTimeout: 2000, logger: { info() {} } });
    await expect(p.printPdf(PDF)).rejects.toThrow(/raw print failed/i);
    httpServer.close();
  });
});
