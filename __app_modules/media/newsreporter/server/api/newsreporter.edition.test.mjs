/**
 * Router contract for the edition routes (spec §6), the newsstand's API:
 * bare arrays for lists, `{ status, edition, png }` for a dry run (png is
 * base64 without a data: prefix), `{ status, edition }` from deliver, always
 * 200 for deliver outcomes, 404 for unknown reporters.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createNewsReporterRouter } from './newsreporter.mjs';
import { harness } from '../application/edition/fixtures/editionHarness.mjs';
import { NewsReporterContainer } from '../application/NewsReporterContainer.mjs';

const BASE = '/api/v1/newsreporter';

describe('newsreporter router — edition routes', () => {
  let app;
  let h;
  beforeEach(() => {
    h = harness();
    const reporterDirectory = {
      list: () => [{ id: 'office-paper', kind: 'edition', title: 'The Daylight Ledger', enabled: true }, { id: 'world-cup', kind: 'report', title: 'world-cup', enabled: true }],
    };
    app = express();
    app.use(express.json());
    app.use(BASE, createNewsReporterRouter({
      newsReporterService: { run: async () => ({ status: 'ok' }) },
      editionService: h.service,
      reporterDirectory,
      logger: h.logger,
    }));
    // The global error handler is not mounted here; surface throws as 500.
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  });

  it('GET / lists reporters as a bare array', async () => {
    const res = await request(app).get(`${BASE}/`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'office-paper', kind: 'edition', title: 'The Daylight Ledger', enabled: true },
      { id: 'world-cup', kind: 'report', title: 'world-cup', enabled: true },
    ]);
  });

  it('compose, then list, detail, image, deliver and printers', async () => {
    const composed = await request(app).post(`${BASE}/office-paper/compose`).send({});
    expect(composed.status).toBe(200);
    expect(composed.body.status).toBe('composed');
    expect(composed.body.edition).toMatchObject({ date: '2026-11-24', number: 1, status: 'composed' });

    const list = await request(app).get(`${BASE}/office-paper/editions?limit=5`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(Object.keys(list.body[0]).sort()).toEqual(['composedAt', 'costUsd', 'date', 'deliveredAt', 'leadHeadline', 'missing', 'number', 'printer', 'status']);

    const detail = await request(app).get(`${BASE}/office-paper/editions/2026-11-24`);
    expect(detail.status).toBe(200);
    expect(typeof detail.body.inputs.headlines).toBe('number');
    expect(Array.isArray(detail.body.inputs.missing)).toBe(true);
    expect(detail.body.stories[0]).toEqual(expect.objectContaining({ ids: expect.any(Array), urls: expect.any(Array), titles: expect.any(Array) }));
    expect(detail.body.layout.masthead.title).toBe('The Daylight Ledger');

    const image = await request(app).get(`${BASE}/office-paper/editions/2026-11-24/image.png`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.body.subarray(1, 4).toString()).toBe('PNG');

    const deliver = await request(app).post(`${BASE}/office-paper/deliver`).send({ trigger: 'ha' });
    expect(deliver.status).toBe(200);
    expect(deliver.body).toMatchObject({ status: 'printed', edition: { date: '2026-11-24', printer: 'office' } });
    const again = await request(app).post(`${BASE}/office-paper/deliver`).send({});
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('already_delivered');

    const printers = await request(app).get(`${BASE}/office-paper/printers`);
    expect(printers.body).toEqual(['office', 'upstairs']);
  });

  it('a dry run returns { status, edition, png } and stores nothing', async () => {
    const res = await request(app).post(`${BASE}/office-paper/compose`).send({ dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('composed');
    expect(res.body.edition.layout.blocks.length).toBeGreaterThan(3);
    expect(res.body.png.startsWith('data:')).toBe(false);
    expect(Buffer.from(res.body.png, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect((await request(app).get(`${BASE}/office-paper/editions`)).body).toEqual([]);
  });

  it('deliver failures are 200 with a status', async () => {
    h.printerRegistry.printer.print.mockResolvedValue({ dispatched: false });
    const res = await request(app).post(`${BASE}/office-paper/deliver`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('print_failed');
  });

  it('404s unknown and report-kind reporters, a missing edition and its image; 400s a bad date', async () => {
    expect((await request(app).get(`${BASE}/nope/editions`)).status).toBe(404);
    expect((await request(app).post(`${BASE}/world-cup/deliver`).send({})).status).toBe(404);
    expect((await request(app).get(`${BASE}/office-paper/editions/2026-01-01`)).status).toBe(404);
    expect((await request(app).get(`${BASE}/office-paper/editions/2026-01-01/image.png`)).status).toBe(404);
    expect((await request(app).get(`${BASE}/office-paper/editions/yesterday`)).status).toBe(400);
    expect((await request(app).post(`${BASE}/office-paper/compose`).send({ date: '24/11/2026' })).status).toBe(400);
  });
});

describe('NewsReporterContainer edition wiring', () => {
  it('routes an edition reporter\'s run to compose and lists reporters with their kind', async () => {
    const h = harness();
    const configProjection = { reporter: (id) => h.reporters[id] || null, timezone: () => 'America/Denver', all: () => h.reporters };
    const built = NewsReporterContainer.build({
      configProjection,
      runtimeFor: () => ({ execute: async () => ({ output: '{"sections":[]}' }) }),
      defaultModel: 'x',
      renderer: { render: () => ({ items: [] }), renderText: () => '' },
      sourceRegistry: { create: () => ({ gather: async () => ({ items: [] }) }) },
      jobDatastore: { reporterIds: () => new Set(['office-paper']) },
      history: { record: async () => {} },
      printerRegistry: h.printerRegistry,
      logger: h.logger,
      edition: { store: h.store, renderer: { measure: async () => ({ heightCm: 1 }), render: async () => ({ canvas: { toBuffer: () => Buffer.from('png') }, width: 576, height: 8, heightCm: 0.1 }), renderText: () => '' } },
    });
    expect(built.reporterDirectory.list()).toEqual([
      { id: 'office-paper', kind: 'edition', title: 'The Daylight Ledger', enabled: true },
      { id: 'world-cup', kind: 'report', title: 'world-cup', enabled: true },
    ]);
    // No headline service wired: the compose fails, and run reports it as an error.
    const result = await built.service.run('office-paper');
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/headline service unavailable|no AI gateway/);
    // The report kind still runs its own pipeline.
    expect((await built.service.run('world-cup')).status).toBe('empty');
  });
});
