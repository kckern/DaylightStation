// backend/src/4_api/v1/routers/piano.compositions.test.mjs
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let files = {}, blobs = {};
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: (p) => (p in files ? files[p] : null),
  saveYaml: (p, d) => { files[p] = d; },
  listYamlFiles: (dir) => Object.keys(files).filter(p => p.startsWith(dir + '/')).map(p => p.slice(dir.length + 1)),
  deleteYaml: (p) => { const had = p in files; delete files[p]; delete blobs[p]; return had; },
  ensureDir: vi.fn(),
  writeBinary: (p, b) => { blobs[p] = String(b); },
  readFile: (p) => (p in blobs ? blobs[p] : null),
  listFiles: (dir) => Object.keys(blobs).filter(p => p.startsWith(dir + '/')).map(p => p.slice(dir.length + 1)),
  deleteFile: (p) => { const had = p in blobs; delete blobs[p]; return had; },
}));
import { ComposerSongStore } from '#apps/piano/ComposerSongStore.mjs';
import { PianoContainer } from '#apps/piano/PianoContainer.mjs';
import { createPianoRouter } from './piano.mjs';

const configService = {
  getUserDir: (id) => `/data/users/${id}`,
  getUserProfile: (id) => (['kc'].includes(id) ? { id } : null),
  getHouseholdAppConfig: () => ({ composer: { versions_keep: 5 } }),
  listHouseholdUsers: () => ['kc'],
};
// A minimal but well-formed single-note score so musicXmlToNotes finds >=1 note.
const VALID_XML = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>`;

function app() {
  const composerSongStore = new ComposerSongStore({ configService, logger: { info() {}, warn() {}, debug() {} } });
  const studioDatastore = { listStudioTakes: () => [], isKnownUser: () => true };
  const pianoContainer = new PianoContainer({ studioDatastore, composerSongStore, configService });
  const a = express(); a.use(express.json());
  a.use('/api/v1/piano', createPianoRouter({ pianoContainer, logger: { info() {}, error() {} } }));
  return a;
}
beforeEach(() => { files = {}; blobs = {}; });

describe('piano compositions routes', () => {
  it('400s an invalid user on list', async () => {
    expect((await request(app()).get('/api/v1/piano/users/nobody/compositions')).status).toBe(400);
  });
  it('creates, gets, lists', async () => {
    const a = app();
    const c = await request(a).post('/api/v1/piano/users/kc/compositions').send({ title: 'T', musicxml: VALID_XML });
    expect(c.status).toBe(201);
    const id = c.body.id;
    expect((await request(a).get(`/api/v1/piano/users/kc/compositions/${id}`)).body.musicxml).toBe(VALID_XML);
    expect((await request(a).get('/api/v1/piano/users/kc/compositions')).body.compositions.map(x => x.id)).toContain(id);
  });
  it('rejects invalid xml on save (validation gate, 400)', async () => {
    const a = app();
    const id = (await request(a).post('/api/v1/piano/users/kc/compositions').send({ title: 'T', musicxml: VALID_XML })).body.id;
    const r = await request(a).put(`/api/v1/piano/users/kc/compositions/${id}`).send({ musicxml: '<not-a-score/>', meta: {}, revision: 1 });
    expect(r.status).toBe(400);
  });
  it('409s a stale revision', async () => {
    const a = app();
    const id = (await request(a).post('/api/v1/piano/users/kc/compositions').send({ title: 'T', musicxml: VALID_XML })).body.id;
    await request(a).put(`/api/v1/piano/users/kc/compositions/${id}`).send({ musicxml: VALID_XML, meta: {}, revision: 1 }); // -> rev 2
    const r = await request(a).put(`/api/v1/piano/users/kc/compositions/${id}`).send({ musicxml: VALID_XML, meta: {}, revision: 1 });
    expect(r.status).toBe(409);
  });
});
