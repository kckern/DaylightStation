// @vitest-environment node
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminSheetMusicRouter, MAX_UPLOAD_BYTES } from './sheetMusic.mjs';

const ID = 'files:docs/sheet-music/classical/fur elise.musicxml';
const coded = (code, extra = {}) => Object.assign(new Error(`secret detail for ${code}`), { code, ...extra });

function harness(overrides = {}) {
  const calls = [];
  const logs = [];
  const record = (name, result) => async (...args) => { calls.push({ name, args }); return typeof result === 'function' ? result(...args) : result; };
  const service = {
    library: record('library', [{ id: ID }]),
    uploadFolders: record('uploadFolders', ['classical']),
    upload: record('upload', { id: 'files:docs/sheet-music/classical/new.mxl', title: 'New', composer: null, filename: 'new.mxl' }),
    getLearn: record('getLearn', { scoreId: ID, draftRevision: 'rev1' }),
    saveDraft: record('saveDraft', { scoreId: ID, draftRevision: 'rev2' }),
    approve: record('approve', { file: { scoreId: ID }, impact: [] }),
    revert: record('revert', { file: { scoreId: ID }, impact: null, changed: true }),
    draftImpact: record('draftImpact', { draftRevision: 'rev1', impact: [] }),
    impact: record('impact', [{ userId: 'learner1' }]),
    ...overrides,
  };
  const logger = {
    debug: () => {}, info: () => {},
    warn: (event, data) => logs.push({ level: 'warn', event, data }),
    error: (event, data) => logs.push({ level: 'error', event, data }),
  };
  const app = express();
  app.use(express.json());
  app.use('/sheet-music', createAdminSheetMusicRouter({ service, logger }));
  return { app, calls, logs };
}

const q = `id=${encodeURIComponent(ID)}`;

describe('createAdminSheetMusicRouter: forwarding', () => {
  it('requires a service', () => {
    expect(() => createAdminSheetMusicRouter({})).toThrow(/service/);
  });

  it('GET / returns scores and upload folders', async () => {
    const { app } = harness();
    const res = await request(app).get('/sheet-music/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scores: [{ id: ID }], folders: ['classical'] });
  });

  it('POST /upload passes the buffer, original name, folder and filename and answers 201', async () => {
    const { app, calls } = harness();
    const res = await request(app).post('/sheet-music/upload')
      .field('folder', 'classical').field('filename', 'new.mxl')
      .attach('file', Buffer.from('PK-bytes'), 'Original Name.mxl');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'files:docs/sheet-music/classical/new.mxl', title: 'New', composer: null, filename: 'new.mxl' });
    const [args] = calls.find((c) => c.name === 'upload').args;
    expect(Buffer.isBuffer(args.buffer)).toBe(true);
    expect(args.buffer.toString()).toBe('PK-bytes');
    expect(args).toMatchObject({ originalName: 'Original Name.mxl', folder: 'classical', filename: 'new.mxl' });
  });

  it('POST /upload without a filename passes none', async () => {
    const { app, calls } = harness();
    await request(app).post('/sheet-music/upload').field('folder', 'classical')
      .attach('file', Buffer.from('x'), 'a.musicxml');
    expect(calls.find((c) => c.name === 'upload').args[0].filename).toBeUndefined();
  });

  it('GET /learn decodes the id', async () => {
    const { app, calls } = harness();
    const res = await request(app).get(`/sheet-music/learn?${q}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scoreId: ID, draftRevision: 'rev1' });
    expect(calls.find((c) => c.name === 'getLearn').args).toEqual([ID]);
  });

  it('PUT /learn draft forwards segments, proposal and measureCount', async () => {
    const { app, calls } = harness();
    const segments = [{ start: 1, end: 4 }];
    const res = await request(app).put(`/sheet-music/learn?${q}`)
      .send({ action: 'draft', segments, proposal: { by: 'ai' }, measureCount: 32, ignored: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scoreId: ID, draftRevision: 'rev2' });
    expect(calls.find((c) => c.name === 'saveDraft').args).toEqual([ID, { segments, proposal: { by: 'ai' }, measureCount: 32 }]);
  });

  it('PUT /learn approve forwards measureCount and expectedDraftRevision', async () => {
    const { app, calls } = harness();
    const res = await request(app).put(`/sheet-music/learn?${q}`)
      .send({ action: 'approve', measureCount: 32, expectedDraftRevision: 'rev1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ file: { scoreId: ID }, impact: [] });
    expect(calls.find((c) => c.name === 'approve').args).toEqual([ID, { measureCount: 32, expectedDraftRevision: 'rev1' }]);
  });

  it('PUT /learn revert calls revert with the id', async () => {
    const { app, calls } = harness();
    const res = await request(app).put(`/sheet-music/learn?${q}`).send({ action: 'revert' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ file: { scoreId: ID }, impact: null, changed: true });
    expect(calls.find((c) => c.name === 'revert').args).toEqual([ID]);
  });

  it('GET /learn/draft-impact forwards the id', async () => {
    const { app, calls } = harness();
    const res = await request(app).get(`/sheet-music/learn/draft-impact?${q}`);
    expect(res.body).toEqual({ draftRevision: 'rev1', impact: [] });
    expect(calls.find((c) => c.name === 'draftImpact').args).toEqual([ID]);
  });

  it('POST /impact forwards the segments', async () => {
    const { app, calls } = harness();
    const segments = [{ start: 1, end: 8 }];
    const res = await request(app).post(`/sheet-music/impact?${q}`).send({ segments });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ impact: [{ userId: 'learner1' }] });
    expect(calls.find((c) => c.name === 'impact').args).toEqual([ID, segments]);
  });
});

describe('createAdminSheetMusicRouter: request refusals', () => {
  it.each([
    ['get', '/sheet-music/learn'],
    ['put', '/sheet-music/learn'],
    ['get', '/sheet-music/learn/draft-impact'],
    ['post', '/sheet-music/impact'],
  ])('%s %s without id is 400 invalid-request', async (method, path) => {
    const { app, calls, logs } = harness();
    const res = await request(app)[method](path).send({ action: 'revert', segments: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid-request' });
    expect(calls).toHaveLength(0);
    expect(logs).toContainEqual({ level: 'warn', event: 'admin.sheetmusic.request-rejected', data: expect.objectContaining({ code: 'invalid-request' }) });
  });

  it('an unknown action is 400 invalid-request', async () => {
    const { app, calls } = harness();
    for (const body of [{ action: 'delete' }, {}, { action: ['draft'] }]) {
      const res = await request(app).put(`/sheet-music/learn?${q}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid-request' });
    }
    expect(calls).toHaveLength(0);
  });

  it('an id given twice is 400', async () => {
    const { app } = harness();
    const res = await request(app).get(`/sheet-music/learn?${q}&${q}`);
    expect(res.status).toBe(400);
  });

  it('upload without a file is 400 invalid-request', async () => {
    const { app, calls } = harness();
    const res = await request(app).post('/sheet-music/upload').field('folder', 'classical');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid-request' });
    expect(calls).toHaveLength(0);
  });

  it('an oversized upload is 413 and never reaches the service', async () => {
    const { app, calls, logs } = harness();
    const res = await request(app).post('/sheet-music/upload').field('folder', 'classical')
      .attach('file', Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'big.musicxml');
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'SCORE_TOO_LARGE' });
    expect(calls).toHaveLength(0);
    expect(logs).toContainEqual({ level: 'warn', event: 'admin.sheetmusic.request-rejected', data: expect.objectContaining({ code: 'SCORE_TOO_LARGE' }) });
  });

  it('a file under another field name is 400', async () => {
    const { app, calls } = harness();
    const res = await request(app).post('/sheet-music/upload').attach('other', Buffer.from('x'), 'a.mxl');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid-request' });
    expect(calls).toHaveLength(0);
  });

  it('uses a 32 MB file limit', () => {
    expect(MAX_UPLOAD_BYTES).toBe(32 * 1024 * 1024);
  });
});

describe('createAdminSheetMusicRouter: service error mapping', () => {
  const cases = [
    ['invalid-request', 400], ['NOT_LIBRARY_SCORE', 400], ['bad-folder', 400], ['bad-filename', 400],
    ['SCORE_NOT_FOUND', 404],
    ['no-draft', 409], ['basename-exists', 409], ['slug-collides', 409],
    ['SCORE_TOO_LARGE', 413],
    ['bad-extension', 415],
    ['bad-mxl', 422], ['not-xml', 422], ['timewise', 422], ['not-partwise', 422], ['no-notes', 422],
    ['slug-too-long', 422], ['SCORE_UNREADABLE', 422],
  ];

  it.each(cases)('%s → %i with { error: code } and a warn log', async (code, status) => {
    const { app, logs } = harness({ getLearn: async () => { throw coded(code); } });
    const res = await request(app).get(`/sheet-music/learn?${q}`);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: code });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(logs).toContainEqual({ level: 'warn', event: 'admin.sheetmusic.request-rejected', data: { route: 'GET /learn', code } });
  });

  it('invalid-segments → 422 with the errors list', async () => {
    const { app } = harness({ saveDraft: async () => { throw coded('invalid-segments', { errors: ['overlap', 'empty'] }); } });
    const res = await request(app).put(`/sheet-music/learn?${q}`).send({ action: 'draft', segments: [] });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'invalid-segments', errors: ['overlap', 'empty'] });
  });

  it('draft-changed → 409 with the current draftRevision', async () => {
    const { app } = harness({ approve: async () => { throw coded('draft-changed', { draftRevision: 'rev9' }); } });
    const res = await request(app).put(`/sheet-music/learn?${q}`).send({ action: 'approve', expectedDraftRevision: 'rev1' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'draft-changed', draftRevision: 'rev9' });
  });

  it('upload refusals map too', async () => {
    const { app } = harness({ upload: async () => { throw coded('bad-extension'); } });
    const res = await request(app).post('/sheet-music/upload').field('folder', 'classical')
      .attach('file', Buffer.from('x'), 'a.pdf');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'bad-extension' });
  });

  it('a plain Error is 500 without its message', async () => {
    const { app } = harness({ library: async () => { throw new Error('/abs/media/path exploded'); } });
    const res = await request(app).get('/sheet-music/');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('exploded');
    expect(JSON.stringify(res.body)).not.toContain('/abs');
  });

  it('an unmapped code is 500 without its message', async () => {
    const { app } = harness({ upload: async () => { throw coded('SCORE_UNWRITABLE'); } });
    const res = await request(app).post('/sheet-music/upload').field('folder', 'classical')
      .attach('file', Buffer.from('x'), 'a.mxl');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
