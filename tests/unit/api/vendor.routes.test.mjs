import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVendorRouter } from '#api/v1/routers/vendor.mjs';
import { vendorDirFor, createVendorApiRouter } from '#composition/modules/vendorApi.mjs';

describe('/vendor route (media/vendor)', () => {
  let media; let app;
  beforeAll(() => {
    media = mkdtempSync(join(tmpdir(), 'vendor-route-'));
    mkdirSync(join(media, 'vendor', 'fonts'), { recursive: true });
    writeFileSync(join(media, 'vendor', 'fonts', 'a.txt'), 'hello');
    writeFileSync(join(media, 'secret.txt'), 'nope');
    app = express();
    app.use('/vendor', createVendorApiRouter({ mediaDir: media, logger: { debug() {}, warn() {} } }));
  });
  afterAll(() => rmSync(media, { recursive: true, force: true }));

  it('derives the vendor dir from the media dir', () => {
    expect(vendorDirFor('/m')).toBe('/m/vendor');
  });

  it('serves a file with an immutable one-year cache header', async () => {
    const res = await request(app).get('/vendor/fonts/a.txt');
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('404s for an absent file', async () => {
    const res = await request(app).get('/vendor/fonts/missing.woff2');
    expect(res.status).toBe(404);
  });

  it('404s when the vendor directory itself is absent', async () => {
    const empty = express();
    empty.use('/vendor', createVendorRouter({ vendorDir: join(media, 'no-such'), logger: { debug() {}, warn() {} } }));
    const res = await request(empty).get('/vendor/fonts/a.txt');
    expect(res.status).toBe(404);
  });

  it('does not escape the vendor directory', async () => {
    const res = await request(app).get('/vendor/..%2fsecret.txt');
    expect(res.status).toBe(404);
  });

  it.each([
    ['encoded dot-dot', '/vendor/%2e%2e/secret.txt'],
    ['encoded dot-dot with encoded slash', '/vendor/%2e%2e%2fsecret.txt'],
    ['double-encoded dot-dot', '/vendor/%252e%252e%252fsecret.txt'],
    ['NUL byte', '/vendor/fonts/a.txt%00.png'],
    ['dotfile', '/vendor/.env'],
    ['dotfile in subdir', '/vendor/fonts/.hidden'],
  ])('never serves outside media/vendor: %s', async (_name, url) => {
    const res = await request(app).get(url);
    expect([400, 404]).toContain(res.status);
    expect(res.text || '').not.toContain('nope');
  });
});
