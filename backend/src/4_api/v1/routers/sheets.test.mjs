// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSheetsRouter } from './sheets.mjs';

const okModel = {
  sheetId: 'ok',
  title: 'OK',
  fingerprint: 'aaa111',
  page: { widthPt: 612, heightPt: 792, marginPt: 36 },
  blocks: [{ id: 'b', kind: 'label', cellOpts: {}, items: [{ label: 'X' }] }],
  placements: {
    pages: 1,
    cells: [{ page: 0, block: 'b', index: 0, x: 36, y: 60, w: 100, h: 100 }],
    titles: [],
  },
};

const cellKinds = {
  label: () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
};

function makeApp(build) {
  const app = express();
  app.use('/sheets', createSheetsRouter({
    sheetService: { build },
    cellKinds,
    logger: { warn() {}, info() {} },
  }));
  return app;
}

const okService = async (id, params) => {
  if (id !== 'ok') throw new Error(`unknown sheet "${id}"`);
  return { ...okModel, params };
};

describe('sheets router', () => {
  it('serves a PDF with a fingerprinted filename', async () => {
    const res = await request(makeApp(okService)).get('/sheets/ok.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain('ok-aaa111.pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('forwards query params to the provider layer', async () => {
    let seen = null;
    await request(makeApp(async (id, params) => { seen = params; return okModel; }))
      .get('/sheets/ok.pdf?source=plex&id=42');
    expect(seen).toMatchObject({ source: 'plex', id: '42' });
  });

  // Structural failures are 404 because they mean "that sheet does not exist as
  // described" — a config problem, not a server fault. The four phrasings are a
  // contract with SheetService; if either side changes wording, this breaks.
  it.each([
    'unknown sheet "nope"',
    'unknown source "missing.provider" in sheet "s"',
    'unknown cell kind "runes" in sheet "s"',
    'unknown page size "a3"',
  ])('404s on a structural failure: %s', async (message) => {
    const res = await request(makeApp(async () => { throw new Error(message); })).get('/sheets/x.pdf');
    expect(res.status).toBe(404);
  });

  it('500s on an unexpected failure rather than calling it missing', async () => {
    const res = await request(makeApp(async () => { throw new Error('provider exploded'); }))
      .get('/sheets/x.pdf');
    expect(res.status).toBe(500);
  });
});
