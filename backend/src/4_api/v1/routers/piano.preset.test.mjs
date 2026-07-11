// @vitest-environment node
//
// NOTE: the sibling router tests (piano.history.test.mjs, piano.effect-audit.test.mjs,
// piano.courses.test.mjs) construct createPianoRouter({ configService, ... }) directly,
// which predates commit a0ca19028 ("thin the router onto PianoContainer; wire at
// composition root") — the router now takes `pianoContainer` (exposing
// `.studioDatastore`), so those files currently fail on main independent of this
// change. This new test targets the CURRENT router contract.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let files = {};
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
  saveYaml: (p, data) => { files[p] = data; },
  listYamlFiles: () => [],
  deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn(),
}));

import { createPianoRouter } from './piano.mjs';
import { YamlPianoStudioDatastore } from '../../../1_adapters/piano/YamlPianoStudioDatastore.mjs';
import { PianoContainer } from '../../../3_applications/piano/PianoContainer.mjs';

const configService = {
  getUserDir: (id) => `/data/users/${id}`,
  getUserProfile: (id) => (['kc'].includes(id) ? { id } : null),
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getHouseholdAppConfig: () => ({}),
  getMediaDir: () => '/data/media',
};

function app() {
  const studioDatastore = new YamlPianoStudioDatastore({ configService });
  const pianoContainer = new PianoContainer({ studioDatastore, configService });
  const a = express();
  a.use(express.json());
  a.use('/api/v1/piano', createPianoRouter({ pianoContainer, logger: { info() {}, error() {} } }));
  return a;
}

beforeEach(() => { files = {}; });

describe('GET /users/:userId/preset', () => {
  it('returns {} for a known user with no preset saved yet', async () => {
    const res = await request(app()).get('/api/v1/piano/users/kc/preset');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('returns the saved preset for a known user', async () => {
    files['/data/users/kc/apps/piano/preset'] = { default: { voice: { pc: 0, bank: 0 }, volume: 0.6 } };
    const res = await request(app()).get('/api/v1/piano/users/kc/preset');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ default: { voice: { pc: 0, bank: 0 }, volume: 0.6 } });
  });

  it('rejects an unknown user with 400', async () => {
    const res = await request(app()).get('/api/v1/piano/users/nobody/preset');
    expect(res.status).toBe(400);
  });
});

describe('PUT /users/:userId/preset', () => {
  it('shallow-merges the body into the existing preset and persists it', async () => {
    files['/data/users/kc/apps/piano/preset'] = { default: { voice: { pc: 0, bank: 0 }, volume: 0.6 } };
    const res = await request(app())
      .put('/api/v1/piano/users/kc/preset')
      .send({ favorites: [{ voice: { pc: 4, bank: 0 }, volume: 0.5 }] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      default: { voice: { pc: 0, bank: 0 }, volume: 0.6 },
      favorites: [{ voice: { pc: 4, bank: 0 }, volume: 0.5 }],
    });
    expect(files['/data/users/kc/apps/piano/preset']).toEqual(res.body);
  });

  it('rejects an unknown user with 400', async () => {
    const res = await request(app()).put('/api/v1/piano/users/nobody/preset').send({ default: {} });
    expect(res.status).toBe(400);
  });
});
