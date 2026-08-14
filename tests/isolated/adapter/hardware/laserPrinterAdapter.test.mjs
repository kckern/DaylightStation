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
} = {}) {
  const printJobs = [];
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
  ];

  return new Promise((resolve) => {
    const httpServer = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const operation = body.readUInt16BE(2); // same wire offset as a response's status-code
        if (operation === OPS.GET_PRINTER_ATTRIBUTES) {
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
        res.writeHead(500);
        res.end();
      });
    });
    httpServer.listen(0, '127.0.0.1', () => resolve({ httpServer, port: httpServer.address().port, printJobs }));
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
    const result = await p.printPdf(PDF, { jobName: 'ws', user: 'learner-two' });
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
    const result = await p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner-two' });
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
    const result = await p.printPdf(REAL_PDF, { jobName: 'ws', user: 'learner-two' });
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

describe('LaserPrinterAdapter.printPdf — raw 9100 transport (opt-in, still capability-gated)', () => {
  it('with rawTransport:true and a printer that advertises PDF, sends over raw JetDirect instead of IPP', async () => {
    const { httpServer, port: ippPort } = await ippServer({
      documentFormatSupported: ['application/octet-stream', 'application/pdf'],
      documentFormatPreferred: 'application/pdf',
    });
    const { port: rawPort, received } = await rawSink();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', port: ippPort, rawPort, rawTransport: true, logger: { info() {} } });

    const result = await p.printPdf(PDF, { jobName: 't', user: 'learner-two' });
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
