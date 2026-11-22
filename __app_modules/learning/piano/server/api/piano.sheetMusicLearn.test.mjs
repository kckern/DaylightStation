// @vitest-environment node
//
// GET /sheet-music/learn: the kiosk's read of a score's approved Learn segments.
// Same harness as piano.practice.test.mjs (in-memory FileIO, real datastore).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let files = {};
vi.mock('../../../../../__backend/src/0_system/utils/FileIO.mjs', () => ({
  loadYaml: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
  saveYaml: (p, data) => { files[p] = data; },
  saveYamlToPathAtomic: (p, data) => { files[p.replace(/\.yml$/, '')] = data; },
  listYamlFiles: () => [],
  deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn(),
  getStats: () => null,
}));

import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';
import { YamlPianoStudioDatastore } from '../adapters/YamlPianoStudioDatastore.mjs';
import { PianoContainer } from '../application/PianoContainer.mjs';
import { PianoConfigProjection } from '../adapters/PianoConfigProjection.mjs';
import { practiceKeyOfScore } from '../../portable/music/practiceKey.mjs';

const configService = {
  getUserDir: (id) => `/data/users/${id}`,
  getUserProfile: (id) => (['kc'].includes(id) ? { id } : null),
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getHouseholdAppConfig: () => ({}),
  getMediaDir: () => '/data/media',
};

const SCORE = 'files:docs/sheet-music/Bach/Minuet in G.mxl';
const learnKey = (id) => `/data/household/piano/sheetmusic/${practiceKeyOfScore(id)}`;
const url = (id) => `/api/v1/piano/sheet-music/learn?id=${encodeURIComponent(id)}`;

function app(logger = { info() {}, warn: vi.fn(), error() {} }) {
  const studioDatastore = new YamlPianoStudioDatastore({ configService });
  const pianoContainer = new PianoContainer({ studioDatastore, configProjection: new PianoConfigProjection({ configService }) });
  const a = express();
  a.use(express.json());
  a.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({ pianoContainer, logger })));
  return a;
}

beforeEach(() => { files = {}; });

describe('GET /sheet-music/learn', () => {
  it('answers {} when the score has no Learn file', async () => {
    const r = await request(app()).get(url(SCORE));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({});
  });

  it('answers only the approved segments (sorted) and the sha, never the draft or approval metadata', async () => {
    files[learnKey(SCORE)] = {
      version: 1, scoreId: SCORE, contentSha256: 'abc123',
      segments: [{ id: 'b', start: 4, end: 7, name: 'B' }, { id: 'a', start: 0, end: 3 }],
      approved: { by: 'kc', at: '2026-11-20T00:00:00Z' },
      draft: { segments: [{ id: 'x', start: 0, end: 9 }] },
    };
    const r = await request(app()).get(url(SCORE));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      segments: [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7, name: 'B' }],
      contentSha256: 'abc123',
    });
  });

  it('does not serve approved segments from a colliding score\'s Learn file', async () => {
    const colliding = SCORE.replace('Minuet in G', 'Minuet_in_G');
    expect(learnKey(colliding)).toBe(learnKey(SCORE));
    files[learnKey(SCORE)] = {
      scoreId: SCORE, contentSha256: 'abc123', segments: [{ id: 'a', start: 0, end: 3 }],
    };
    const logger = { info() {}, warn: vi.fn(), error() {} };
    const r = await request(app(logger)).get(url(colliding));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith('piano.sheetmusic.learn-owner-conflict', {
      scoreId: colliding, ownerScoreId: SCORE,
    });
  });

  it('passes a segment\'s hands through to the kiosk', async () => {
    files[learnKey(SCORE)] = { contentSha256: 'abc', segments: [{ id: 'a', start: 0, end: 3, parts: ['rh'] }, { id: 'b', start: 4, end: 7 }] };
    const r = await request(app()).get(url(SCORE));
    expect(r.body.segments).toEqual([{ id: 'a', start: 0, end: 3, parts: ['rh'] }, { id: 'b', start: 4, end: 7 }]);
  });

  it('answers {} for an id outside the sheet music library', async () => {
    const other = 'files:docs/other/song.mxl';
    files[learnKey(other)] = { contentSha256: 'z', segments: [{ id: 'a', start: 0, end: 3 }] };
    const r = await request(app()).get(url(other));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({});
  });

  it('answers {} and logs piano.sheetmusic.learn-invalid when stored segments overlap', async () => {
    files[learnKey(SCORE)] = {
      contentSha256: 'abc', segments: [{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 3, end: 8 }],
    };
    const logger = { info() {}, warn: vi.fn(), error() {} };
    const r = await request(app(logger)).get(url(SCORE));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith('piano.sheetmusic.learn-invalid', { scoreId: SCORE });
  });

  it('answers {} without a warning when the file has a draft but no approved segments', async () => {
    files[learnKey(SCORE)] = { draft: { segments: [{ id: 'a', start: 0, end: 3 }] } };
    const logger = { info() {}, warn: vi.fn(), error() {} };
    const r = await request(app(logger)).get(url(SCORE));
    expect(r.body).toEqual({});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('answers {} when the id parameter is missing', async () => {
    const r = await request(app()).get('/api/v1/piano/sheet-music/learn');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({});
  });
});
