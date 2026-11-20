// @vitest-environment node
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import { createAdminSheetMusicRouter, MAX_CROP_BYTES, MAX_POSTER_BODY_BYTES, MAX_SEGMENTS, MAX_UPLOAD_BYTES } from './sheetMusic.mjs';

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
    savePoster: record('savePoster', (id, text) => ({ id, poster: 'generated', url: '/u', bytes: text.length })),
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
    expect(res.body).toEqual({ scores: [{ id: ID }], folders: ['classical'], boundaryScorer: 'heuristic' });
  });

  it('GET / reports the configured boundary scorer', async () => {
    const { app } = harness({ boundaryScorer: () => 'jev' });
    expect((await request(app).get('/sheet-music/')).body.boundaryScorer).toBe('jev');
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
    expect(logs).toContainEqual({ level: 'warn', event: 'admin.sheetmusic.request-rejected', data: { route: 'GET /learn', code, id: ID } });
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

/** Sends a raw request body (supertest cannot send a truncated multipart form). */
function rawRequest(app, { method = 'POST', path, headers, body }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); });
      });
      req.on('error', (error) => { server.close(); reject(error); });
      req.end(body);
    });
  });
}

describe('createAdminSheetMusicRouter: malformed requests', () => {
  it('a multipart content type without a boundary is 400 invalid-request', async () => {
    const { app, calls, logs } = harness();
    const res = await request(app).post('/sheet-music/upload').set('Content-Type', 'multipart/form-data').send('garbage');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid-request' });
    expect(calls).toHaveLength(0);
    expect(logs.some((l) => l.event === 'admin.sheetmusic.request-failed')).toBe(false);
  });

  it('a truncated multipart body is 400 invalid-request', async () => {
    const { app, calls } = harness();
    const boundary = 'XBOUNDARY';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="folder"',
      '',
      'classical',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="a.mxl"',
      'Content-Type: application/octet-stream',
      '',
      'partial bytes with no closing boundary',
    ].join('\r\n');
    const res = await rawRequest(app, {
      path: '/sheet-music/upload',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': Buffer.byteLength(body) },
      body,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid-request' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ segment: [] }],
    [{ segments: 'x' }],
    [{ segments: { start: 1 } }],
    [{}],
  ])('POST /impact with %j is 400 invalid-request', async (body) => {
    const { app, calls } = harness();
    const res = await request(app).post(`/sheet-music/impact?${q}`).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid-request' });
    expect(calls).toHaveLength(0);
  });

  it(`caps segments at ${500} for drafts and impact`, async () => {
    expect(MAX_SEGMENTS).toBe(500);
    const { app, calls } = harness();
    const many = Array.from({ length: MAX_SEGMENTS + 1 }, (_, i) => ({ start: i + 1, end: i + 1 }));
    const draft = await request(app).put(`/sheet-music/learn?${q}`).send({ action: 'draft', segments: many });
    expect(draft.status).toBe(400);
    expect(draft.body).toEqual({ error: 'invalid-request' });
    const impact = await request(app).post(`/sheet-music/impact?${q}`).send({ segments: many });
    expect(impact.status).toBe(400);
    expect(calls).toHaveLength(0);
    const atCap = await request(app).post(`/sheet-music/impact?${q}`).send({ segments: many.slice(0, MAX_SEGMENTS) });
    expect(atCap.status).toBe(200);
  });
});

describe('createAdminSheetMusicRouter: logs', () => {
  it('request-rejected carries the query id, truncated to 200 characters', async () => {
    const { app, logs } = harness({ getLearn: async () => { throw coded('SCORE_NOT_FOUND'); } });
    await request(app).get(`/sheet-music/learn?${q}`);
    expect(logs).toContainEqual({ level: 'warn', event: 'admin.sheetmusic.request-rejected', data: { route: 'GET /learn', code: 'SCORE_NOT_FOUND', id: ID } });
    const longId = `files:docs/sheet-music/${'a'.repeat(400)}.mxl`;
    await request(app).get(`/sheet-music/learn?id=${encodeURIComponent(longId)}`);
    const last = logs.filter((l) => l.event === 'admin.sheetmusic.request-rejected').at(-1);
    expect(last.data.id).toBe(longId.slice(0, 200));
  });

  it('request-rejected has a null id when none was given', async () => {
    const { app, logs } = harness();
    await request(app).get('/sheet-music/learn');
    expect(logs.at(-1).data).toEqual({ route: 'GET /learn', code: 'invalid-request', id: null });
  });

  it('an unexpected error logs request-failed with its code and no message', async () => {
    const { app, logs } = harness({ upload: async () => { throw coded('SCORE_UNWRITABLE'); } });
    await request(app).post('/sheet-music/upload').field('folder', 'classical').attach('file', Buffer.from('x'), 'a.mxl');
    const failed = logs.filter((l) => l.event === 'admin.sheetmusic.request-failed');
    expect(failed).toEqual([{ level: 'error', event: 'admin.sheetmusic.request-failed', data: { route: 'POST /upload', code: 'SCORE_UNWRITABLE' } }]);
    expect(JSON.stringify(failed)).not.toContain('secret');
  });
});

describe('createAdminSheetMusicRouter: POST /poster', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';

  it('a text/plain body is 400 and never reaches the service', async () => {
    const { app, calls } = harness();
    const res = await request(app).post(`/sheet-music/poster?${q}`).set('Content-Type', 'text/plain').send(SVG);
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.name === 'savePoster')).toBe(false);
  });

  it.each(['image/svg+xml', 'image/svg+xml; charset=utf-8'])('forwards a %s body as text and answers 201', async (type) => {
    const { app, calls } = harness();
    const res = await request(app).post(`/sheet-music/poster?${q}`).set('Content-Type', type).send(SVG);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: ID, poster: 'generated', url: '/u', bytes: SVG.length });
    expect(calls.find((c) => c.name === 'savePoster').args).toEqual([ID, SVG]);
  });

  it('a JSON or missing body is 400 and never reaches the service', async () => {
    const { app, calls } = harness();
    expect((await request(app).post(`/sheet-music/poster?${q}`).send({ svg: SVG })).status).toBe(400);
    expect((await request(app).post(`/sheet-music/poster?${q}`)).status).toBe(400);
    expect(calls.some((c) => c.name === 'savePoster')).toBe(false);
  });

  it('a body over the cap is 413 too-large and never reaches the service', async () => {
    const { app, calls } = harness();
    const big = `<svg>${'x'.repeat(MAX_POSTER_BODY_BYTES)}</svg>`;
    const res = await request(app).post(`/sheet-music/poster?${q}`).set('Content-Type', 'image/svg+xml').send(big);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'too-large' });
    expect(calls.some((c) => c.name === 'savePoster')).toBe(false);
  });

  it('without an id is 400', async () => {
    const { app } = harness();
    const res = await request(app).post('/sheet-music/poster').set('Content-Type', 'image/svg+xml').send(SVG);
    expect(res.status).toBe(400);
  });

  it.each([
    ['too-large', 413], ['has-scan', 409], ['poster-exists', 409], ['not-svg', 422], ['script', 422],
    ['foreign-object', 422], ['event-handler', 422], ['external-href', 422], ['doctype', 422],
    ['processing-instruction', 422], ['element', 422], ['attribute', 422], ['namespace', 422], ['bad-char', 422],
    ['entity', 422], ['invalid-request', 400], ['NOT_LIBRARY_SCORE', 400], ['SCORE_NOT_FOUND', 404],
  ])('%s → %i', async (codeName, status) => {
    const { app } = harness({ savePoster: async () => { throw coded(codeName); } });
    const res = await request(app).post(`/sheet-music/poster?${q}`).set('Content-Type', 'image/svg+xml').send(SVG);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: codeName });
  });
});

describe('createAdminSheetMusicRouter: POST /propose', () => {
  const features = [{ after: 0, sectionStart: false }, { after: 1, sectionStart: true }, { after: 2, sectionStart: false }];
  const body = JSON.stringify({ features, measureCount: 4, targetLen: 4 });
  const proposeResult = { segments: [{ start: 0, end: 3 }], proposal: { scorer: 'jev' } };

  it('parses the features and crops and forwards them', async () => {
    const { app, calls } = harness({ propose: async (...args) => { calls.push({ name: 'propose', args }); return proposeResult; } });
    const res = await request(app).post(`/sheet-music/propose?${q}`)
      .field('features', body)
      .attach('crop_0', Buffer.from('png-0'), { filename: 'crop_0.png', contentType: 'image/png' })
      .attach('crop_2', Buffer.from('png-2'), { filename: 'crop_2.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(proposeResult);
    const [id, input] = calls.find((c) => c.name === 'propose').args;
    expect(id).toBe(ID);
    expect(input).toMatchObject({ features, measureCount: 4, targetLen: 4 });
    expect([...input.crops.keys()]).toEqual([0, 2]);
    expect(input.crops.get(2).toString()).toBe('png-2');
  });

  it('without a propose method it is 409 jev-disabled', async () => {
    const { app } = harness();
    const res = await request(app).post(`/sheet-music/propose?${q}`).field('features', body);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'jev-disabled' });
  });

  it('features that are not JSON, or a stray file field, are 400', async () => {
    const { app, calls } = harness({ propose: async () => proposeResult });
    expect((await request(app).post(`/sheet-music/propose?${q}`).field('features', '{nope')).status).toBe(400);
    expect((await request(app).post(`/sheet-music/propose?${q}`).field('features', body)
      .attach('poster', Buffer.from('x'), 'x.png')).status).toBe(400);
    expect((await request(app).post(`/sheet-music/propose?${q}`).send({ features })).status).toBe(400);
    expect(calls.some((c) => c.name === 'propose')).toBe(false);
  });

  it('a crop over the cap is 413 too-large', async () => {
    const { app } = harness({ propose: async () => proposeResult });
    const res = await request(app).post(`/sheet-music/propose?${q}`).field('features', body)
      .attach('crop_0', Buffer.alloc(MAX_CROP_BYTES + 1), 'crop_0.png');
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'too-large' });
  });

  it('maps the proposal codes', async () => {
    for (const [code, status] of [['jev-disabled', 409], ['jev-unavailable', 503], ['proposal-failed', 502], ['bad-crop', 422]]) {
      const { app } = harness({ propose: async () => { throw coded(code); } });
      const res = await request(app).post(`/sheet-music/propose?${q}`).field('features', body);
      expect(res.status, code).toBe(status);
      expect(res.body).toEqual({ error: code });
    }
  });
});
