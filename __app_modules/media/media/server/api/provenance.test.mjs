import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';
import { createProvenanceRouter } from './provenance.mjs';

function app({ found = null, logo = true } = {}) {
  const getTitleProvenance = { execute: vi.fn(async () => found) };
  const logos = {
    open: vi.fn((provider, opts) => (logo ? { stream: Readable.from([`<svg data-p="${provider}" data-w="${!!opts.white}"/>`]), contentType: 'image/svg+xml' } : null)),
  };
  const a = express();
  a.use('/api/v1/provenance', createProvenanceRouter({ getTitleProvenance, logos, logger: { warn: () => {} } }));
  return { a, getTitleProvenance, logos };
}

describe('provenance router', () => {
  it('returns the provider with its logo URL', async () => {
    const { a, getTitleProvenance } = app({ found: { ratingKey: '50896', provider: 'hoopla', name: 'Hoopla', tier: 'free', offerType: 'free', checkedAt: 'x' } });
    const res = await request(a).get('/api/v1/provenance/plex:50896');
    expect(res.status).toBe(200);
    expect(res.body.provenance).toMatchObject({ provider: 'hoopla', logo: '/api/v1/provenance/logo/hoopla' });
    expect(getTitleProvenance.execute).toHaveBeenCalledWith({ ratingKey: '50896' });
  });
  it('returns null when nothing is confirmed, 400 for a bad key', async () => {
    const { a } = app();
    expect((await request(a).get('/api/v1/provenance/1')).body).toEqual({ provenance: null });
    expect((await request(a).get('/api/v1/provenance/..%2Fx')).status).toBe(400);
  });
  it('serves logos, preferring the white variant on request', async () => {
    const { a } = app();
    const res = await request(a).get('/api/v1/provenance/logo/peacock?variant=white');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/svg/);
    expect(String(res.body)).toContain('data-w="true"');
  });
  it('404s a missing logo and rejects odd names', async () => {
    expect((await request(app({ logo: false }).a).get('/api/v1/provenance/logo/nope')).status).toBe(404);
    expect((await request(app().a).get('/api/v1/provenance/logo/A_B')).status).toBe(400);
  });
});
