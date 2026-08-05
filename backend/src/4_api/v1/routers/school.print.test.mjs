import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolRouter } from './school.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const PDF_BYTES = Buffer.from('%PDF-1.7 fake');

function appWith({ render, repo, allocations } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolService: { listBankSourceSummaries: () => [] },
    renderPrintDocument: render ?? null,
    printDocumentsRepo: repo ?? null,
    printAllocationStore: allocations ?? null,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  }));
  return app;
}

function renderFake(result = {}) {
  return {
    calls: [],
    async execute(input) {
      this.calls.push(input);
      if (result.throws) throw result.throws;
      return {
        bytes: PDF_BYTES,
        pageCount: 1,
        density: 'normal',
        warnings: result.warnings ?? [],
        ...(result.allocation ? { allocation: result.allocation } : {}),
      };
    },
  };
}

describe('GET /api/v1/school/print/:id', () => {
  it('503s when the render pipeline is not wired', async () => {
    const res = await request(appWith()).get('/api/v1/school/print/pokemon-quiz-1?variety=hand');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('print-render-unavailable');
  });

  it('400s on a missing or unknown variety', async () => {
    const app = appWith({ render: renderFake() });
    for (const q of ['', '?variety=fancy']) {
      const res = await request(app).get(`/api/v1/school/print/pokemon-quiz-1${q}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/variety/);
    }
  });

  it('400s on a malformed document id', async () => {
    const res = await request(appWith({ render: renderFake() }))
      .get('/api/v1/school/print/Bad_Id?variety=hand');
    expect(res.status).toBe(400);
  });

  it('hand variety renders a PDF with no card context and filters the no-allocation warning', async () => {
    const render = renderFake({ warnings: ["quiz 'pokemon-quiz-1' rendered without card allocation"] });
    const res = await request(appWith({ render }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=hand&learnerName=Milo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe('inline; filename="pokemon-quiz-1.pdf"');
    expect(res.headers['x-school-print-warnings']).toBeUndefined();
    expect(render.calls[0]).toEqual({ id: 'pokemon-quiz-1', context: { learnerName: 'Milo' } });
    expect(Buffer.from(res.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('hand variety rejects card parameters', async () => {
    const app = appWith({ render: renderFake() });
    for (const q of ['card=1234567', 'freshCard=1', 'startRow=3']) {
      const res = await request(app).get(`/api/v1/school/print/pokemon-quiz-1?variety=hand&${q}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/hand variety/);
    }
  });

  it('freshCard and card remain mutually exclusive', async () => {
    const both = await request(appWith({ render: renderFake() }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&freshCard=1&card=1234567');
    expect(both.status).toBe(400);
    expect(both.body.error).toMatch(/mutually exclusive/);
  });

  it('bare omr with no existing sheet mints a fresh card automatically', async () => {
    const render = renderFake({ allocation: { cardId: '1111111', rowRange: { start: 1, end: 6 }, recordId: 'r', status: 'live' } });
    const allocations = { findByCard: vi.fn(), findByDocument: vi.fn().mockResolvedValue([]) };
    const res = await request(appWith({ render, allocations }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr');
    expect(res.status).toBe(200);
    expect(render.calls[0].context).toEqual({ freshCard: true });
  });

  it('bare omr reuses the document\'s newest usable sheet (refresh-safe)', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'pokemon-quiz-1', rev: 'abcdef123', seed: 1, blocks: [] }),
    };
    const allocations = {
      findByDocument: vi.fn().mockResolvedValue([
        { documentId: 'pokemon-quiz-1', cardId: '2222222', status: 'satisfied', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: '2026-08-05T01:00:00Z' },
        { documentId: 'pokemon-quiz-1', cardId: '3333333', status: 'live', rev: 'abcdef123', variant: 1, rowRange: { start: 7, end: 12 }, renderedAt: '2026-08-05T00:00:00Z' },
      ]),
    };
    const res = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr');
    expect(res.status).toBe(200);
    expect(allocations.findByDocument).toHaveBeenCalledWith('pokemon-quiz-1');
    // live beats the newer satisfied record
    expect(render.calls[0].context).toMatchObject({ cardId: '3333333', startRow: 7 });
    expect(render.calls[0].document).toMatchObject({ variant: 1 });
  });

  it('bare omr with learnerId reuses only that learner\'s sheet, else mints', async () => {
    const render = renderFake();
    const allocations = {
      findByDocument: vi.fn().mockResolvedValue([
        { documentId: 'pokemon-quiz-1', cardId: '2222222', status: 'live', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, learnerId: 'soren', renderedAt: '2026-08-05T01:00:00Z' },
      ]),
    };
    await request(appWith({ render, allocations }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&learnerId=milo');
    expect(render.calls[0].context).toEqual({ freshCard: true, learnerId: 'milo' });
  });

  it('freshCard=1 forces a new card even when a sheet exists', async () => {
    const render = renderFake();
    const allocations = { findByDocument: vi.fn() };
    await request(appWith({ render, allocations }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&freshCard=1');
    expect(allocations.findByDocument).not.toHaveBeenCalled();
    expect(render.calls[0].context).toEqual({ freshCard: true });
  });

  it('omr freshCard render threads context and surfaces the allocation header', async () => {
    const allocation = { cardId: '4829306', rowRange: { start: 1, end: 6 }, recordId: 'r1', status: 'live' };
    const render = renderFake({ allocation });
    const res = await request(appWith({ render }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&freshCard=1&learnerId=milo');
    expect(res.status).toBe(200);
    expect(render.calls[0].context).toEqual({ freshCard: true, learnerId: 'milo' });
    expect(JSON.parse(res.headers['x-school-print-allocation'])).toEqual(allocation);
  });

  it('omr card attachment validates card digits and startRow bounds', async () => {
    const app = appWith({ render: renderFake() });
    const badCard = await request(app)
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=12345');
    expect(badCard.status).toBe(400);
    expect(badCard.body.error).toMatch(/7 digits/);
    const badRow = await request(app)
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=1234567&startRow=51');
    expect(badRow.status).toBe(400);
    const ok = await request(app)
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=1234567&startRow=18');
    expect(ok.status).toBe(200);
  });

  it('omr card without startRow defaults to row 1', async () => {
    const render = renderFake();
    await request(appWith({ render }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=1234567');
    expect(render.calls[0].context).toEqual({ cardId: '1234567', startRow: 1 });
  });

  it('teacher=1 renders the key with -key filename and same shuffles context', async () => {
    const render = renderFake();
    const res = await request(appWith({ render }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=hand&teacher=1');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('inline; filename="pokemon-quiz-1-key.pdf"');
    expect(render.calls[0].context).toEqual({ teacher: true });
  });

  it('variant override fetches the source and spreads the variant like IssueDocument', async () => {
    const render = renderFake();
    const repo = { get: vi.fn().mockResolvedValue({ id: 'pokemon-quiz-1', seed: 1, blocks: [] }) };
    const res = await request(appWith({ render, repo }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=hand&variant=2');
    expect(res.status).toBe(200);
    expect(repo.get).toHaveBeenCalledWith('pokemon-quiz-1');
    expect(render.calls[0].document).toMatchObject({ id: 'pokemon-quiz-1', variant: 2 });
    expect(render.calls[0].id).toBeUndefined();
  });

  it('variant override without a wired repository 503s; unknown id 404s', async () => {
    const noRepo = await request(appWith({ render: renderFake() }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=hand&variant=1');
    expect(noRepo.status).toBe(503);
    const repo = { get: vi.fn().mockResolvedValue(null) };
    const missing = await request(appWith({ render: renderFake(), repo }))
      .get('/api/v1/school/print/nope?variety=hand&variant=1');
    expect(missing.status).toBe(404);
  });

  it('maps render-time validation errors (FIT_OVERSET et al.) to 400 and not-found to 404', async () => {
    const overset = await request(appWith({
      render: renderFake({ throws: new ValidationError('document oversets one-page by 40pt', { code: 'FIT_OVERSET' }) }),
    })).get('/api/v1/school/print/pokemon-quiz-1?variety=hand');
    expect(overset.status).toBe(400);
    const gone = await request(appWith({
      render: renderFake({ throws: new EntityNotFoundError('print document', 'pokemon-quiz-1') }),
    })).get('/api/v1/school/print/pokemon-quiz-1?variety=hand');
    expect(gone.status).toBe(404);
  });

  it('rev pins the published revision (getPublished, not source)', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'pokemon-quiz-1', rev: '4d9ea4aaf', seed: 1, blocks: [] }),
    };
    const res = await request(appWith({ render, repo }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=hand&rev=4d9ea4aaf');
    expect(res.status).toBe(200);
    expect(repo.getPublished).toHaveBeenCalledWith('pokemon-quiz-1', '4d9ea4aaf');
    expect(repo.get).not.toHaveBeenCalled();
    expect(render.calls[0].document).toMatchObject({ rev: '4d9ea4aaf' });
  });

  it('rejects a malformed rev; 404s an unknown rev', async () => {
    const bad = await request(appWith({ render: renderFake() }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=hand&rev=NOPE');
    expect(bad.status).toBe(400);
    const repo = { get: vi.fn(), getPublished: vi.fn().mockResolvedValue(null) };
    const gone = await request(appWith({ render: renderFake(), repo }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=hand&rev=123456789');
    expect(gone.status).toBe(404);
  });

  it('omr card without startRow ADOPTS the existing allocation record (sheet identity)', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'pokemon-quiz-1', rev: 'abcdef123', seed: 1, blocks: [] }),
    };
    const allocations = {
      findByCard: vi.fn().mockResolvedValue([
        { documentId: 'other-doc', status: 'live', rev: '111111111', variant: 0, rowRange: { start: 1, end: 4 }, renderedAt: '2026-08-05T01:00:00Z' },
        { documentId: 'pokemon-quiz-1', status: 'superseded', rev: '000000000', variant: 0, rowRange: { start: 5, end: 10 }, renderedAt: '2026-08-05T02:00:00Z' },
        { documentId: 'pokemon-quiz-1', status: 'satisfied', rev: 'abcdef123', variant: 2, rowRange: { start: 5, end: 10 }, learnerId: 'milo', renderedAt: '2026-08-05T03:00:00Z' },
      ]),
    };
    const res = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=4829306&teacher=1');
    expect(res.status).toBe(200);
    expect(repo.getPublished).toHaveBeenCalledWith('pokemon-quiz-1', 'abcdef123');
    expect(render.calls[0].document).toMatchObject({ variant: 2 });
    expect(render.calls[0].context).toEqual({
      teacher: true, cardId: '4829306', startRow: 5, learnerId: 'milo',
    });
  });

  it('adopted-record mode rejects explicit rev/variant (the record is the identity)', async () => {
    const allocations = {
      findByCard: vi.fn().mockResolvedValue([
        { documentId: 'pokemon-quiz-1', status: 'live', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: '2026-08-05T01:00:00Z' },
      ]),
    };
    const res = await request(appWith({ render: renderFake(), repo: { get: vi.fn(), getPublished: vi.fn() }, allocations }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=4829306&variant=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allocation record/);
  });

  it('omr card with no matching record falls back to attach-new semantics', async () => {
    const render = renderFake();
    const allocations = { findByCard: vi.fn().mockResolvedValue([]) };
    await request(appWith({ render, allocations }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=1234567');
    expect(render.calls[0].context).toEqual({ cardId: '1234567', startRow: 1 });
  });

  it('explicit startRow skips the identity lookup entirely', async () => {
    const render = renderFake();
    const allocations = { findByCard: vi.fn() };
    await request(appWith({ render, allocations }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=1234567&startRow=18');
    expect(allocations.findByCard).not.toHaveBeenCalled();
    expect(render.calls[0].context).toEqual({ cardId: '1234567', startRow: 18 });
  });

  it('hierarchical taxonomy ids route, adopt, and name the download correctly', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'arts/pokemon-identification/quiz-1', rev: 'abcdef123', seed: 1, blocks: [] }),
    };
    const allocations = {
      findByDocument: vi.fn().mockResolvedValue([
        { documentId: 'arts/pokemon-identification/quiz-1', cardId: '7654321', status: 'live', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: '2026-08-05T01:00:00Z' },
      ]),
    };
    const res = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/arts/pokemon-identification/quiz-1?variety=omr&teacher=1');
    expect(res.status).toBe(200);
    expect(allocations.findByDocument).toHaveBeenCalledWith('arts/pokemon-identification/quiz-1');
    expect(render.calls[0].context).toMatchObject({ cardId: '7654321', teacher: true });
    expect(res.headers['content-disposition']).toBe('inline; filename="quiz-1-key.pdf"');
  });

  it('rejects ids deeper than 4 segments or with bad segments', async () => {
    const app = appWith({ render: renderFake() });
    for (const id of ['a/b/c/d/e', 'arts//quiz', 'Arts/quiz']) {
      const res = await request(app).get(`/api/v1/school/print/${id}?variety=hand`);
      expect(res.status).toBe(400);
    }
  });

  it('omr keeps its warnings in the header (nothing filtered)', async () => {
    const render = renderFake({ warnings: ['some genuine warning'] });
    const res = await request(appWith({ render }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&freshCard=1');
    expect(JSON.parse(res.headers['x-school-print-warnings'])).toEqual(['some genuine warning']);
  });
});
