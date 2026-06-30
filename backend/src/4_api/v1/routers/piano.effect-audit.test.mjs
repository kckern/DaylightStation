// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const written = [];
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: () => null, saveYaml: () => {}, listYamlFiles: () => [], deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn((p, buf) => { written.push({ path: p, bytes: buf.length, buf }); }),
}));
vi.mock('#system/config/UserService.mjs', () => ({ userService: { hydrateUsers: () => [] } }));
vi.mock('#domains/core/utils/id.mjs', () => ({ shortId: () => 'x' }));

import { createPianoRouter } from './piano.mjs';

const configService = {
  getDefaultHouseholdId: () => 'default',
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getUserProfile: () => null,
  getUserDir: (id) => `/data/users/${id}`,
  getHouseholdAppConfig: () => ({}),
  getMediaDir: () => '/data/media',
};

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1/piano', createPianoRouter({ configService, logger: { info() {}, error() {} } }));
  return a;
}

beforeEach(() => { written.length = 0; });

describe('POST /effect-audit/:runId/clip/:label', () => {
  it('writes a webm clip under media/logs/piano/effect-audit', async () => {
    const res = await request(app())
      .post('/api/v1/piano/effect-audit/run1/clip/00-control')
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from([1, 2, 3, 4]));
    expect(res.status).toBe(201);
    expect(written).toHaveLength(1);
    expect(written[0].path).toBe('/data/media/logs/piano/effect-audit/run1/00-control.webm');
    expect(written[0].bytes).toBe(4);
  });
  it('rejects a path-traversal label', async () => {
    const res = await request(app())
      .post('/api/v1/piano/effect-audit/run1/clip/..%2Fx')
      .set('Content-Type', 'audio/webm').send(Buffer.from([1]));
    expect(res.status).toBe(400);
    expect(written).toHaveLength(0);
  });
  it('rejects an empty body', async () => {
    const res = await request(app())
      .post('/api/v1/piano/effect-audit/run1/clip/00-control')
      .set('Content-Type', 'audio/webm').send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });
});

describe('POST /effect-audit/:runId/manifest', () => {
  it('writes manifest.json', async () => {
    const res = await request(app())
      .post('/api/v1/piano/effect-audit/run1/manifest')
      .send({ clips: [{ label: '00-control' }] });
    expect(res.status).toBe(201);
    expect(written[0].path).toBe('/data/media/logs/piano/effect-audit/run1/manifest.json');
    expect(JSON.parse(written[0].buf.toString()).clips).toHaveLength(1);
  });
  it('rejects a manifest without a clips array', async () => {
    const res = await request(app()).post('/api/v1/piano/effect-audit/run1/manifest').send({});
    expect(res.status).toBe(400);
  });
});
