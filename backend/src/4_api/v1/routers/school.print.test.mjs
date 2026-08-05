import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolRouter } from './school.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const PDF_BYTES = Buffer.from('%PDF-1.7 fake');

function appWith({ render, repo } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolService: { listBankSourceSummaries: () => [] },
    renderPrintDocument: render ?? null,
    printDocumentsRepo: repo ?? null,
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

  it('omr variety requires freshCard or card, mutually exclusive', async () => {
    const app = appWith({ render: renderFake() });
    const none = await request(app).get('/api/v1/school/print/pokemon-quiz-1?variety=omr');
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/freshCard=1.*card=/);
    const both = await request(app)
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&freshCard=1&card=1234567');
    expect(both.status).toBe(400);
    expect(both.body.error).toMatch(/mutually exclusive/);
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

  it('omr keeps its warnings in the header (nothing filtered)', async () => {
    const render = renderFake({ warnings: ['some genuine warning'] });
    const res = await request(appWith({ render }))
      .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&freshCard=1');
    expect(JSON.parse(res.headers['x-school-print-warnings'])).toEqual(['some genuine warning']);
  });
});
