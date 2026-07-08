// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const written = [];
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: () => null, saveYaml: () => {}, listYamlFiles: () => [], deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn((p, buf) => { written.push({ path: p, bytes: buf.length }); }),
}));
vi.mock('#system/config/UserService.mjs', () => ({ userService: { hydrateUsers: () => [] } }));
vi.mock('#domains/core/utils/id.mjs', () => ({ shortId: () => 'x' }));

import { createPianoRouter } from './piano.mjs';

const configService = {
  getDefaultHouseholdId: () => 'default',
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getUserProfile: (id) => (['kc', 'user_3'].includes(id) ? { id } : null),
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

const body = { events: [{ t: 0, type: 'note_on', note: 60, velocity: 90 }, { t: 100, type: 'note_off', note: 60, velocity: 0 }], startedAt: '2026-06-26T10:00:00.000Z', durationMs: 100 };

beforeEach(() => { written.length = 0; });

describe('PUT /users/:userId/history/:date/:takeId', () => {
  it('writes a .mid for a known user at the household history path', async () => {
    const res = await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/10.00.00').send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0].path).toBe('/data/household/history/piano/kc/2026-06-26/10.00.00.mid');
    expect(written[0].bytes).toBeGreaterThan(20);
  });
  it('accepts the guest user', async () => {
    const res = await request(app()).put('/api/v1/piano/users/guest/history/2026-06-26/10.00.00').send(body);
    expect(res.status).toBe(200);
    expect(written[0].path).toBe('/data/household/history/piano/guest/2026-06-26/10.00.00.mid');
  });
  it('rejects an unknown user (not guest)', async () => {
    const res = await request(app()).put('/api/v1/piano/users/nobody/history/2026-06-26/10.00.00').send(body);
    expect(res.status).toBe(400);
  });
  it('rejects a bad date / takeId', async () => {
    expect((await request(app()).put('/api/v1/piano/users/kc/history/2026_06_26/10.00.00').send(body)).status).toBe(400);
    expect((await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/..%2Fx').send(body)).status).toBe(400);
  });
  it('requires a non-empty events array', async () => {
    const res = await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/10.00.00').send({ events: [] });
    expect(res.status).toBe(400);
  });
  it('is idempotent — a second PUT overwrites the same path', async () => {
    await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/10.00.00').send(body);
    await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/10.00.00').send(body);
    expect(written.map((w) => w.path)).toEqual([
      '/data/household/history/piano/kc/2026-06-26/10.00.00.mid',
      '/data/household/history/piano/kc/2026-06-26/10.00.00.mid',
    ]);
  });
});
