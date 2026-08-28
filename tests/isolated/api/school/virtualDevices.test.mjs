// @vitest-environment node
//
// The repo's default vitest environment is a happy-dom shim, whose `fetch`
// enforces browser CORS rules and so rejects plain cross-port requests to an
// ephemeral test server. Like schoolRouter.test.mjs, this router test opts out
// and uses the real Node fetch against a real http.Server.
//
// These tests wire the REAL doubles (not fakes) to a temp capture dir: the
// point of this router is that it drives the doubles, so a fake here would
// test nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createSchoolVirtualDevicesRouter } from '#api/v1/routers/schoolVirtualDevices.mjs';
import { VirtualLaserPrinterAdapter } from '#adapters/hardware/laser-printer/VirtualLaserPrinterAdapter.mjs';
import { VirtualThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/VirtualThermalPrinterAdapter.mjs';
import { VirtualScannerAdapter } from '#adapters/hardware/scanner/VirtualScannerAdapter.mjs';
import { VirtualPlaybackAdapter } from '#adapters/hardware/playback/VirtualPlaybackAdapter.mjs';
import { VirtualOmrReader } from '#adapters/hardware/omr/VirtualOmrReader.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** Smallest thing the laser double accepts: %PDF- magic and one /Type /Page. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n', 'latin1');

/** Shape the worksheet PDF renderer emits: three 4-choice questions, one page. */
const CHOICES = ['A', 'B', 'C', 'D'];
const FORM_MAP = {
  formVersion: 'wk-fractions-v1',
  marks: ['q1', 'q2', 'q3'].flatMap((itemId, row) => CHOICES.map((choice, col) => ({
    itemId, choice, xPt: 72 + col * 24, yPt: 200 + row * 30, rPt: 6, page: 1,
  }))),
};

const makeBus = () => {
  const broadcasts = [];
  return { broadcasts, broadcast: (topic, payload) => broadcasts.push({ topic, payload }) };
};

/** Mount a router on an ephemeral server; returns a base URL + close(). */
async function serve(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/devices', router);
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  return {
    base: `http://127.0.0.1:${server.address().port}/api/v1/school/devices`,
    close: () => new Promise((res) => server.close(res)),
  };
}

const post = (base, p, body) => fetch(base + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

// ---------------------------------------------------------------------------
// The security-relevant one. A production deployment must never be able to
// reach "make the printer fail", so an unwired console must have NO routes at
// all — not routes that politely decline.
// ---------------------------------------------------------------------------
describe('fail closed: no doubles wired', () => {
  let srv;
  afterEach(async () => { await srv?.close(); srv = null; });

  it('registers no routes at all — every path 404s', async () => {
    srv = await serve(createSchoolVirtualDevicesRouter({ logger: silent }));
    const paths = [
      ['GET', '/status'],
      ['GET', '/captures'],
      ['GET', '/captures/laser/job_0001'],
      ['GET', '/playback'],
      ['GET', '/scan'],
      ['GET', '/omr/sheets'],
      ['GET', '/omr/forms/wk-1/layout'],
    ];
    for (const [, p] of paths) {
      expect((await fetch(srv.base + p)).status, `GET ${p}`).toBe(404);
    }
    expect((await post(srv.base, '/scan', { code: 'sch:abc' })).status).toBe(404);
    expect((await post(srv.base, '/fault', { device: 'laser', fault: 'offline' })).status).toBe(404);
    expect((await post(srv.base, '/omr/submit', { formId: 'wk-1', answers: {} })).status).toBe(404);
    expect((await post(srv.base, '/playback/dsp_0001/complete')).status).toBe(404);
  });

  it('a router built with no arguments at all is empty too', async () => {
    srv = await serve(createSchoolVirtualDevicesRouter());
    expect((await fetch(`${srv.base}/status`)).status).toBe(404);
    expect((await post(srv.base, '/fault', { device: 'thermal', fault: 'jam' })).status).toBe(404);
  });

  it('gates per device: a scanner-only console exposes /scan but not /fault or /captures', async () => {
    const scanner = new VirtualScannerAdapter({ eventBus: makeBus(), logger: silent });
    srv = await serve(createSchoolVirtualDevicesRouter({ scanner, logger: silent }));

    expect((await post(srv.base, '/scan', { code: 'sch:abc' })).status).toBe(200);
    expect((await post(srv.base, '/fault', { device: 'laser', fault: 'offline' })).status).toBe(404);
    expect((await fetch(`${srv.base}/captures`)).status).toBe(404);
    expect((await fetch(`${srv.base}/playback`)).status).toBe(404);
    // OMR needs BOTH a reader and a form-map resolver; a reader alone is inert.
    expect((await fetch(`${srv.base}/omr/sheets`)).status).toBe(404);
  });

  it('gates OMR on the form-map resolver, not just the reader', async () => {
    const omrReader = new VirtualOmrReader({ logger: silent });
    srv = await serve(createSchoolVirtualDevicesRouter({ omrReader, logger: silent }));
    expect((await fetch(`${srv.base}/omr/forms/wk-fractions-v1/layout`)).status).toBe(404);
    expect((await post(srv.base, '/omr/submit', { formId: 'wk-fractions-v1', answers: {} })).status).toBe(404);
    // The reader itself IS wired, so /status still reports it.
    expect((await (await fetch(`${srv.base}/status`)).json()).devices.omr)
      .toEqual({ present: true, sheets: 0, forms: false });
  });
});

// ---------------------------------------------------------------------------
// Fully wired console — the surface a human drives.
// ---------------------------------------------------------------------------
describe('virtual device console, fully wired', () => {
  let captureDir, laserPrinter, thermalPrinter, scanner, playback, omrReader, bus, srv, base, formIds;

  beforeEach(async () => {
    captureDir = await mkdtemp(path.join(os.tmpdir(), 'virt-console-'));
    bus = makeBus();
    laserPrinter = new VirtualLaserPrinterAdapter({ captureDir: path.join(captureDir, 'laser'), logger: silent });
    thermalPrinter = new VirtualThermalPrinterAdapter({ captureDir: path.join(captureDir, 'thermal') }, { logger: silent });
    scanner = new VirtualScannerAdapter({ eventBus: bus, logger: silent });
    playback = new VirtualPlaybackAdapter({ eventBus: bus, logger: silent });
    omrReader = new VirtualOmrReader({ eventBus: bus, readerId: 'omr-1100-virtual', logger: silent });
    formIds = new Map([['wk-fractions-v1', FORM_MAP]]);

    srv = await serve(createSchoolVirtualDevicesRouter({
      laserPrinter,
      thermalPrinter,
      scanner,
      playback,
      omrReader,
      getFormMap: async (formId) => formIds.get(formId) ?? null,
      logger: silent,
    }));
    base = srv.base;
  });

  afterEach(async () => {
    await srv.close();
    await rm(captureDir, { recursive: true, force: true });
  });

  describe('GET /captures', () => {
    it('reflects a printed laser job with its page and byte counts', async () => {
      await laserPrinter.printPdf(PDF, { jobName: 'Fractions worksheet', user: 'kid1' });

      const body = await (await fetch(`${base}/captures`)).json();
      expect(body.captures).toHaveLength(1);
      expect(body.captures[0]).toMatchObject({
        kind: 'laser',
        id: 'job_0001',
        title: 'Fractions worksheet',
        requestedBy: 'kid1',
        pageCount: 1,
        bytes: PDF.length,
        contentType: 'application/pdf',
      });
    });

    it('includes receipts with their decoded transcript', async () => {
      await thermalPrinter.print({
        items: [
          { type: 'text', content: 'AGENDA' },
          { type: 'text', content: 'Scan to begin' },
          { type: 'barcode', content: 'sch:a1b2c3' },
        ],
      });

      const body = await (await fetch(`${base}/captures`)).json();
      const receipt = body.captures.find((c) => c.kind === 'thermal');
      expect(receipt).toMatchObject({ id: 'receipt_0001', title: 'AGENDA', itemCount: 3 });
      expect(receipt.transcript).toBe('AGENDA\nScan to begin\nsch:a1b2c3');
    });

    it('lists both printers newest first', async () => {
      await laserPrinter.printPdf(PDF);
      await new Promise((r) => setTimeout(r, 5));
      await thermalPrinter.print({ items: [{ type: 'text', content: 'LATER' }] });

      const body = await (await fetch(`${base}/captures`)).json();
      expect(body.captures.map((c) => c.kind)).toEqual(['thermal', 'laser']);
    });

    it('is empty, not an error, before anything has printed', async () => {
      const r = await fetch(`${base}/captures`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ captures: [] });
    });
  });

  describe('GET /captures/:kind/:id', () => {
    it('serves the laser job as application/pdf bytes, not base64 JSON', async () => {
      await laserPrinter.printPdf(PDF);
      const r = await fetch(`${base}/captures/laser/job_0001`);

      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('application/pdf');
      const bytes = Buffer.from(await r.arrayBuffer());
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(bytes.equals(PDF)).toBe(true);
    });

    it('serves a receipt as JSON, and as text/plain with ?format=text', async () => {
      await thermalPrinter.print({ items: [{ type: 'text', content: 'RESCAN sch:zz9' }] });

      const asJson = await fetch(`${base}/captures/thermal/receipt_0001`);
      expect(asJson.headers.get('content-type')).toMatch(/application\/json/);
      expect((await asJson.json()).transcript).toBe('RESCAN sch:zz9');

      const asText = await fetch(`${base}/captures/thermal/receipt_0001?format=text`);
      expect(asText.headers.get('content-type')).toMatch(/text\/plain/);
      expect(await asText.text()).toBe('RESCAN sch:zz9');
    });

    it('404s an unknown id and 400s an unknown kind', async () => {
      expect((await fetch(`${base}/captures/laser/job_9999`)).status).toBe(404);
      expect((await fetch(`${base}/captures/thermal/receipt_9999`)).status).toBe(404);
      expect((await fetch(`${base}/captures/fax/job_0001`)).status).toBe(400);
    });
  });

  describe('POST /scan', () => {
    it('reaches the scanner double and broadcasts the relay payload', async () => {
      const r = await post(base, '/scan', { code: '  sch:a1b2c3  ', device: 'console' });

      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({
        source: 'barcode-relay', device: 'console', route: 'content', code: 'sch:a1b2c3',
      });
      expect(scanner.lastScan().code).toBe('sch:a1b2c3');
      expect(bus.broadcasts.filter((b) => b.topic === 'barcode-relay')).toHaveLength(1);
    });

    it('replays a code so idempotency guards can be driven from the console', async () => {
      await post(base, '/scan', { code: 'sch:dup' });
      await post(base, '/scan', { code: 'sch:dup' });
      expect(scanner.listScans().map((s) => s.code)).toEqual(['sch:dup', 'sch:dup']);
    });

    it('400s an empty code instead of recording a scan that never happened', async () => {
      const r = await post(base, '/scan', { code: '   ' });
      expect(r.status).toBe(400);
      expect(scanner.listScans()).toHaveLength(0);
    });
  });

  describe('playback', () => {
    // `sessionId` is required by every implementation of the playback port as
    // of the real §8 screen adapter — the screen fetches its lesson by it.
    const dispatch = () => playback.dispatch({
      target: 'tv', contentId: 'plex:670208', learnerId: 'kid1', durationSec: 600, sessionId: 'ses_1',
    }).dispatchId;

    it('lists current dispatches', async () => {
      const id = dispatch();
      const body = await (await fetch(`${base}/playback`)).json();
      expect(body.dispatches).toHaveLength(1);
      expect(body.dispatches[0]).toMatchObject({ dispatchId: id, status: 'playing', positionSec: 0 });
    });

    it('completes a dispatch and emits the completion signal', async () => {
      const id = dispatch();
      const r = await post(base, `/playback/${id}/complete`);

      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ status: 'completed', positionSec: 600 });
      expect(bus.broadcasts.some((b) => b.payload.type === 'complete' && b.payload.dispatchId === id)).toBe(true);
    });

    it('advances the playhead without completing', async () => {
      const id = dispatch();
      const r = await post(base, `/playback/${id}/advance`, { seconds: 120 });

      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ status: 'playing', positionSec: 120 });
    });

    it('400s a non-positive advance', async () => {
      expect((await post(base, `/playback/${dispatch()}/advance`, { seconds: 0 })).status).toBe(400);
    });

    it('interrupts a dispatch and emits no completion', async () => {
      const id = dispatch();
      const r = await post(base, `/playback/${id}/interrupt`);

      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ status: 'stopped' });
      expect(bus.broadcasts.some((b) => b.payload.type === 'complete')).toBe(false);
    });

    it('404s an unknown dispatch and 409s an already-stopped one', async () => {
      expect((await post(base, '/playback/dsp_9999/complete')).status).toBe(404);
      const id = dispatch();
      await post(base, `/playback/${id}/interrupt`);
      expect((await post(base, `/playback/${id}/advance`, { seconds: 5 })).status).toBe(409);
    });
  });

  describe('OMR', () => {
    it('serves the form layout the console builds its answer grid from', async () => {
      const r = await fetch(`${base}/omr/forms/wk-fractions-v1/layout`);

      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.formVersion).toBe('wk-fractions-v1');
      expect(body.layout).toHaveLength(3);
      expect(body.layout[0].choices.map((c) => [c.itemId, c.choice, c.bit]))
        .toEqual([['q1', 'A', 0], ['q1', 'B', 1], ['q1', 'C', 2], ['q1', 'D', 3]]);
    });

    it('submits answers and produces a sheet event on the reader', async () => {
      const r = await post(base, '/omr/submit', {
        formId: 'wk-fractions-v1',
        answers: { q1: 'A', q2: 'C' },
        ambiguous: [],
        blank: ['q3'],
      });

      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.sheet).toMatchObject({ source: 'omr-relay', type: 'sheet', id: 'omr-1100-virtual', columns: 3 });
      expect(body.sheet.marks).toEqual([0b0001, 0b0100, 0]);
      expect(body.sheet.markedColumns).toBe(2);
      expect(omrReader.lastSheet().marks).toEqual([0b0001, 0b0100, 0]);
      expect(bus.broadcasts.some((b) => b.topic === 'omr')).toBe(true);
    });

    it('marks a row ambiguous — two bits in one column', async () => {
      const r = await post(base, '/omr/submit', {
        formId: 'wk-fractions-v1', answers: { q1: 'B' }, ambiguous: ['q1'],
      });
      expect((await r.json()).sheet.marks[0]).toBe(0b0110);
    });

    it('404s an unknown formId and 400s a bad item or conflicting answer', async () => {
      expect((await post(base, '/omr/submit', { formId: 'nope', answers: {} })).status).toBe(404);
      expect((await post(base, '/omr/submit', { formId: 'wk-fractions-v1', answers: { q9: 'A' } })).status).toBe(400);
      expect((await post(base, '/omr/submit', { formId: 'wk-fractions-v1', answers: { q1: 'A' }, blank: ['q1'] })).status).toBe(400);
      expect((await post(base, '/omr/submit', { formId: 'wk-fractions-v1', answers: [] })).status).toBe(400);
    });

    it('lists submitted sheets', async () => {
      await post(base, '/omr/submit', { formId: 'wk-fractions-v1', answers: { q1: 'D' } });
      expect((await (await fetch(`${base}/omr/sheets`)).json()).sheets).toHaveLength(1);
    });
  });

  describe('POST /fault', () => {
    it('takes the laser printer offline, observably on the double', async () => {
      const r = await post(base, '/fault', { device: 'laser', fault: 'offline' });

      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ device: 'laser', fault: 'offline' });
      expect(laserPrinter.getFault()).toBe('offline');
      await expect(laserPrinter.printPdf(PDF)).rejects.toMatchObject({ code: 'PRINT_SEND_FAILED' });
    });

    it('jams the thermal printer and clears it again with a null fault', async () => {
      await post(base, '/fault', { device: 'thermal', fault: 'jam' });
      expect(thermalPrinter.getFault()).toBe('jam');
      expect((await thermalPrinter.getStatus()).paperPresent).toBe(false);

      const cleared = await post(base, '/fault', { device: 'thermal', fault: null });
      expect(await cleared.json()).toEqual({ device: 'thermal', fault: null });
      expect(thermalPrinter.getFault()).toBe(null);
    });

    it('400s an unknown device or an unsupported fault', async () => {
      expect((await post(base, '/fault', { device: 'scanner', fault: 'offline' })).status).toBe(400);
      expect((await post(base, '/fault', { device: 'laser', fault: 'on-fire' })).status).toBe(400);
      expect(laserPrinter.getFault()).toBe(null);
    });
  });

  describe('GET /status', () => {
    it('reports every wired device, its fault, and its capture counts', async () => {
      await laserPrinter.printPdf(PDF);
      await post(base, '/scan', { code: 'sch:abc' });
      await post(base, '/fault', { device: 'thermal', fault: 'jam' });

      const body = await (await fetch(`${base}/status`)).json();
      expect(body.devices.laser).toMatchObject({ present: true, fault: null, jobs: 1 });
      expect(body.devices.thermal).toMatchObject({ present: true, fault: 'jam', receipts: 0 });
      expect(body.devices.scanner).toMatchObject({ present: true, scans: 1 });
      expect(body.devices.scanner.lastScan.code).toBe('sch:abc');
      expect(body.devices.omr).toMatchObject({ present: true, forms: true });
    });
  });
});
