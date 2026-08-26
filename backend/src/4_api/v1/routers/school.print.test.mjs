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

// Card-minting params (card/freshCard/retake+identity, teacher pin) moved off
// the GET splat onto this POST (punch 5b) — every case below that exercises
// one of those params goes through here instead of a `card=`/`freshCard=`
// query string.
function postRender(app, body) {
  return request(app).post('/api/v1/school/print/render').send(body);
}

describe('GET /api/v1/school/print/:id', () => {
  it('503s when the render pipeline is not wired', async () => {
    const res = await request(appWith()).get('/api/v1/school/print/creature-quiz-1?variety=hand');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('print-render-unavailable');
  });

  it('400s on an unknown variety; a MISSING variety defaults to omr', async () => {
    const app = appWith({ render: renderFake() });
    const unknown = await request(app).get('/api/v1/school/print/creature-quiz-1?variety=fancy');
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/variety/);
    // No variety at all: card-backed is the system's main mode, so a bare
    // URL renders omr — here that means an automatic fresh mint.
    const bare = await request(app).get('/api/v1/school/print/creature-quiz-1');
    expect(bare.status).toBe(200);
    expect(bare.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('/print/<7 digits> is a card lookup: resolves the card\'s document and reproduces its sheet', async () => {
    const render = renderFake();
    const doc = { id: 'arts/quiz-1', seed: 1, rev: 'abcdef123', blocks: [] };
    const repo = { get: vi.fn().mockResolvedValue(doc), getPublished: vi.fn().mockResolvedValue(doc) };
    const record = {
      documentId: 'arts/quiz-1', cardId: '9251793', learnerId: 'learner4', status: 'live',
      rev: 'abcdef123', variant: 2, rowRange: { start: 1, end: 6 }, renderedAt: 't1',
    };
    const allocations = { findByCard: vi.fn().mockResolvedValue([record]), findByDocument: vi.fn() };
    const res = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/9251793');
    expect(res.status).toBe(200);
    expect(allocations.findByCard).toHaveBeenCalledWith('9251793');
    // Adopted: the record's identity governs, filename comes from the doc slug.
    expect(render.calls[0].context).toMatchObject({ cardId: '9251793', startRow: 1, learnerId: 'learner4' });
    expect(render.calls[0].document).toMatchObject({ variant: 2 });
    expect(res.headers['content-disposition']).toBe('inline; filename="quiz-1.pdf"');
  });

  it('an unknown card path 404s with Hamming-1 live near-miss suggestions', async () => {
    const nearRecord = {
      documentId: 'arts/quiz-1', cardId: '9251793', status: 'live',
      rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: 't1',
    };
    const allocations = {
      findByCard: vi.fn().mockImplementation(async (cardId) => (cardId === '9251793' ? [nearRecord] : [])),
      listCardIds: vi.fn().mockResolvedValue(['9251793']),
      findByDocument: vi.fn(),
    };
    const res = await request(appWith({ render: renderFake(), allocations }))
      .get('/api/v1/school/print/9251792');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no sheet found for card 9251792/);
    expect(res.body.nearMissCardIds).toEqual(['9251793']);
  });

  it('a card path rejects hand variety and explicit card params', async () => {
    const allocations = { findByCard: vi.fn().mockResolvedValue([]), findByDocument: vi.fn() };
    const app = appWith({ render: renderFake(), allocations });
    const hand = await request(app).get('/api/v1/school/print/9251793?variety=hand');
    expect(hand.status).toBe(400);
    expect(hand.body.error).toMatch(/hand variety does not apply/);
    for (const q of ['startRow=2', 'retake=1']) {
      const res = await request(app).get(`/api/v1/school/print/9251793?${q}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already names the sheet/);
    }
    // card=/freshCard= are card-minting params — POST /print/render now.
    for (const body of [{ card: '1234567' }, { freshCard: true }]) {
      const res = await postRender(app, { id: '9251793', ...body });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already names the sheet/);
    }
  });

  it('400s on a malformed document id', async () => {
    const res = await request(appWith({ render: renderFake() }))
      .get('/api/v1/school/print/Bad_Id?variety=hand');
    expect(res.status).toBe(400);
  });

  it('hand variety renders a PDF with no card context and filters the no-allocation warning', async () => {
    const render = renderFake({ warnings: ["quiz 'creature-quiz-1' rendered without card allocation"] });
    const res = await request(appWith({ render }))
      .get('/api/v1/school/print/creature-quiz-1?variety=hand&learnerName=Learner3');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe('inline; filename="creature-quiz-1.pdf"');
    expect(res.headers['x-school-print-warnings']).toBeUndefined();
    expect(render.calls[0]).toEqual({ id: 'creature-quiz-1', context: { learnerName: 'Learner3' } });
    expect(Buffer.from(res.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('hand variety rejects card parameters', async () => {
    const app = appWith({ render: renderFake() });
    const startRow = await request(app).get('/api/v1/school/print/creature-quiz-1?variety=hand&startRow=3');
    expect(startRow.status).toBe(400);
    expect(startRow.body.error).toMatch(/hand variety/);
    // card=/freshCard= are card-minting params — POST /print/render now.
    for (const body of [{ card: '1234567' }, { freshCard: true }]) {
      const res = await postRender(app, { id: 'creature-quiz-1', variety: 'hand', ...body });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/hand variety/);
    }
  });

  it('freshCard and card remain mutually exclusive', async () => {
    const both = await postRender(appWith({ render: renderFake() }), {
      id: 'creature-quiz-1', variety: 'omr', freshCard: true, card: '1234567',
    });
    expect(both.status).toBe(400);
    expect(both.body.error).toMatch(/mutually exclusive/);
  });

  it('teacher keys deny without the configured pin — the quiz-taker cannot print their own key', async () => {
    const render = renderFake();
    const app = express();
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      renderPrintDocument: render,
      getPrintTeacherPin: () => '4321',
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }));
    for (const q of ['', '&pin=0000']) {
      const res = await request(app).get(`/api/v1/school/print/creature-quiz-1?variety=hand&teacher=1${q}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/pin/);
    }
    const ok = await request(app).get('/api/v1/school/print/creature-quiz-1?variety=hand&teacher=1&pin=4321');
    expect(ok.status).toBe(200);
    expect(render.calls[0].context).toEqual({ teacher: true });
    // Non-teacher renders never ask for a pin.
    const student = await request(app).get('/api/v1/school/print/creature-quiz-1?variety=hand');
    expect(student.status).toBe(200);
  });

  it('teacher keys deny with an instructive error when no pin is configured', async () => {
    const app = express();
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      renderPrintDocument: renderFake(),
      getPrintTeacherPin: () => null,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }));
    const res = await request(app).get('/api/v1/school/print/creature-quiz-1?variety=hand&teacher=1');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/print\.teacherPin/);
  });

  it('quiz-archetype omr renders demand a learnerId (or explicit card) — siblings must not share a sheet', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'q', archetype: 'quiz', seed: 1, blocks: [] }),
    };
    const allocations = { findByCard: vi.fn().mockResolvedValue([]), findByDocument: vi.fn().mockResolvedValue([]) };
    const bare = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/creature-quiz-1?variety=omr');
    expect(bare.status).toBe(400);
    expect(bare.body.error).toMatch(/per-student/);
    // freshCard does not evade the rule — an anonymous mint is the problem.
    // (freshCard is a card-minting param — POST /print/render now.)
    const fresh = await postRender(appWith({ render, repo, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', freshCard: true,
    });
    expect(fresh.status).toBe(400);
    expect(fresh.body.error).toMatch(/per-student/);
    // An explicit card with an explicit startRow and NO learner is the same
    // fabricated-identity bypass with one extra param — still 400.
    const fabricatedCard = await postRender(appWith({ render, repo, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', card: '1234567', startRow: 1,
    });
    expect(fabricatedCard.status).toBe(400);
    // With a learner, or in teacher mode (neither one a card-minting param),
    // a plain GET still renders.
    for (const q of ['learnerId=learner4', 'teacher=1']) {
      const res = await request(appWith({ render, repo, allocations }))
        .get(`/api/v1/school/print/creature-quiz-1?variety=omr&${q}`);
      expect(res.status).toBe(200);
    }
    // An explicit card with a learner also renders — via the POST route.
    const withLearner = await postRender(appWith({ render, repo, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', card: '1234567', startRow: 1, learnerId: 'learner4',
    });
    expect(withLearner.status).toBe(200);
  });

  it('worksheet-archetype omr renders may stay anonymous', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'w', archetype: 'worksheet', seed: 1, blocks: [] }),
    };
    const allocations = { findByCard: vi.fn(), findByDocument: vi.fn().mockResolvedValue([]) };
    const res = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/practice-sheet?variety=omr');
    expect(res.status).toBe(200);
    expect(render.calls[0].context).toEqual({ freshCard: true });
  });

  it('retake=1 mints a fresh card at the next unused variant for this learner', async () => {
    const render = renderFake();
    // get() returns the SOURCE (no rev field); getPublished() the published
    // doc. A variant override must ride the published one — a mutated source
    // would hash to a phantom rev no scan could ever resolve.
    const source = { id: 'q', seed: 1, blocks: [] };
    const doc = { id: 'q', seed: 1, rev: 'abcdef123', blocks: [] };
    const repo = { get: vi.fn().mockResolvedValue(source), getPublished: vi.fn().mockResolvedValue(doc) };
    const allocations = {
      findByDocument: vi.fn().mockResolvedValue([
        { documentId: 'creature-quiz-1', learnerId: 'learner4', status: 'satisfied', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: 't1' },
        { documentId: 'creature-quiz-1', learnerId: 'learner4', status: 'satisfied', variant: 1, rowRange: { start: 1, end: 6 }, renderedAt: 't2' },
        { documentId: 'creature-quiz-1', learnerId: 'learner1', status: 'live', variant: 7, rowRange: { start: 1, end: 6 }, renderedAt: 't3' },
      ]),
    };
    const res = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/creature-quiz-1?variety=omr&retake=1&learnerId=learner4');
    expect(res.status).toBe(200);
    // Learner4's max variant is 1 (learner1's 7 is not his) → retake is variant 2,
    // riding the PUBLISHED doc so the allocation pins a resolvable rev.
    expect(render.calls[0].context).toMatchObject({ freshCard: true, learnerId: 'learner4' });
    expect(render.calls[0].document).toMatchObject({ variant: 2, rev: 'abcdef123' });
  });

  it('retake rejects explicit identity parameters', async () => {
    const app = appWith({ render: renderFake() });
    for (const q of ['variant=3', 'rev=abcdef123']) {
      const res = await request(app).get(`/api/v1/school/print/creature-quiz-1?variety=omr&retake=1&${q}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/retake/);
    }
    // card=/freshCard= are card-minting params — POST /print/render now.
    for (const body of [{ card: '1234567' }, { freshCard: true }]) {
      const res = await postRender(app, { id: 'creature-quiz-1', variety: 'omr', retake: true, ...body });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/retake/);
    }
  });

  it('a teacher key with no existing sheet renders WITHOUT minting an allocation', async () => {
    const render = renderFake({ warnings: ["quiz 'q' rendered without card allocation"] });
    const allocations = { findByCard: vi.fn(), findByDocument: vi.fn().mockResolvedValue([]) };
    const res = await request(appWith({ render, allocations }))
      .get('/api/v1/school/print/creature-quiz-1?variety=omr&teacher=1');
    expect(res.status).toBe(200);
    // No freshCard, no cardId — the render is key-only, never an allocation.
    expect(render.calls[0].context).toEqual({ teacher: true });
    // The warning is NOT filtered for omr — the teacher should see this key
    // is unattached to any card.
    expect(res.headers['x-school-print-warnings']).toMatch(/without card allocation/);
  });

  it('bare omr with no existing sheet mints a fresh card automatically', async () => {
    const render = renderFake({ allocation: { cardId: '1111111', rowRange: { start: 1, end: 6 }, recordId: 'r', status: 'live' } });
    const allocations = { findByCard: vi.fn(), findByDocument: vi.fn().mockResolvedValue([]) };
    const res = await request(appWith({ render, allocations }))
      .get('/api/v1/school/print/creature-quiz-1?variety=omr');
    expect(res.status).toBe(200);
    expect(render.calls[0].context).toEqual({ freshCard: true });
  });

  it('bare omr reuses the document\'s newest usable sheet (refresh-safe)', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'creature-quiz-1', rev: 'abcdef123', seed: 1, blocks: [] }),
    };
    const allocations = {
      findByDocument: vi.fn().mockResolvedValue([
        { documentId: 'creature-quiz-1', cardId: '2222222', status: 'satisfied', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: '2026-08-05T01:00:00Z' },
        { documentId: 'creature-quiz-1', cardId: '3333333', status: 'live', rev: 'abcdef123', variant: 1, rowRange: { start: 7, end: 12 }, renderedAt: '2026-08-05T00:00:00Z' },
      ]),
    };
    const res = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/creature-quiz-1?variety=omr');
    expect(res.status).toBe(200);
    expect(allocations.findByDocument).toHaveBeenCalledWith('creature-quiz-1');
    // live beats the newer satisfied record
    expect(render.calls[0].context).toMatchObject({ cardId: '3333333', startRow: 7 });
    expect(render.calls[0].document).toMatchObject({ variant: 1 });
  });

  it('bare omr with learnerId reuses only that learner\'s sheet, else mints', async () => {
    const render = renderFake();
    const allocations = {
      findByDocument: vi.fn().mockResolvedValue([
        { documentId: 'creature-quiz-1', cardId: '2222222', status: 'live', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, learnerId: 'learner1', renderedAt: '2026-08-05T01:00:00Z' },
      ]),
    };
    await request(appWith({ render, allocations }))
      .get('/api/v1/school/print/creature-quiz-1?variety=omr&learnerId=learner3');
    expect(render.calls[0].context).toEqual({ freshCard: true, learnerId: 'learner3' });
  });

  it('freshCard=1 forces a new card even when a sheet exists', async () => {
    const render = renderFake();
    const allocations = { findByDocument: vi.fn() };
    await postRender(appWith({ render, allocations }), { id: 'creature-quiz-1', variety: 'omr', freshCard: true });
    expect(allocations.findByDocument).not.toHaveBeenCalled();
    expect(render.calls[0].context).toEqual({ freshCard: true });
  });

  it('omr freshCard render threads context and surfaces the allocation header', async () => {
    const allocation = { cardId: '4829306', rowRange: { start: 1, end: 6 }, recordId: 'r1', status: 'live' };
    const render = renderFake({ allocation });
    const res = await postRender(appWith({ render }), {
      id: 'creature-quiz-1', variety: 'omr', freshCard: true, learnerId: 'learner3',
    });
    expect(res.status).toBe(200);
    expect(render.calls[0].context).toEqual({ freshCard: true, learnerId: 'learner3' });
    expect(JSON.parse(res.headers['x-school-print-allocation'])).toEqual(allocation);
  });

  it('omr card attachment validates card digits and startRow bounds', async () => {
    const app = appWith({ render: renderFake() });
    const badCard = await postRender(app, { id: 'creature-quiz-1', variety: 'omr', card: '12345' });
    expect(badCard.status).toBe(400);
    expect(badCard.body.error).toMatch(/7 digits/);
    const badRow = await postRender(app, {
      id: 'creature-quiz-1', variety: 'omr', card: '1234567', startRow: 51,
    });
    expect(badRow.status).toBe(400);
    const ok = await postRender(app, { id: 'creature-quiz-1', variety: 'omr', card: '1234567', startRow: 18 });
    expect(ok.status).toBe(200);
  });

  it('omr card without startRow defaults to row 1', async () => {
    const render = renderFake();
    await postRender(appWith({ render }), { id: 'creature-quiz-1', variety: 'omr', card: '1234567' });
    expect(render.calls[0].context).toEqual({ cardId: '1234567', startRow: 1 });
  });

  it('teacher=1 renders the key with -key filename and same shuffles context', async () => {
    const render = renderFake();
    const res = await request(appWith({ render }))
      .get('/api/v1/school/print/creature-quiz-1?variety=hand&teacher=1');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('inline; filename="creature-quiz-1-key.pdf"');
    expect(render.calls[0].context).toEqual({ teacher: true });
  });

  it('variant override rides the published doc (source only as fallback) and spreads the variant like IssueDocument', async () => {
    const render = renderFake();
    // Never published: falls back to the source. A published doc, when one
    // exists, wins — see the retake test above — because a variant-mutated
    // source hashes to a phantom rev no scan could resolve.
    const repo = {
      get: vi.fn().mockResolvedValue({ id: 'creature-quiz-1', seed: 1, blocks: [] }),
      getPublished: vi.fn().mockResolvedValue(null),
    };
    const res = await request(appWith({ render, repo }))
      .get('/api/v1/school/print/creature-quiz-1?variety=hand&variant=2');
    expect(res.status).toBe(200);
    expect(repo.get).toHaveBeenCalledWith('creature-quiz-1');
    expect(render.calls[0].document).toMatchObject({ id: 'creature-quiz-1', variant: 2 });
    expect(render.calls[0].id).toBeUndefined();
  });

  it('variant override without a wired repository 503s; unknown id 404s', async () => {
    const noRepo = await request(appWith({ render: renderFake() }))
      .get('/api/v1/school/print/creature-quiz-1?variety=hand&variant=1');
    expect(noRepo.status).toBe(503);
    const repo = {
      get: vi.fn().mockResolvedValue(null),
      getPublished: vi.fn().mockResolvedValue(null),
    };
    const missing = await request(appWith({ render: renderFake(), repo }))
      .get('/api/v1/school/print/nope?variety=hand&variant=1');
    expect(missing.status).toBe(404);
  });

  it('maps render-time validation errors (FIT_OVERSET et al.) to 400 and not-found to 404', async () => {
    const overset = await request(appWith({
      render: renderFake({ throws: new ValidationError('document oversets one-page by 40pt', { code: 'FIT_OVERSET' }) }),
    })).get('/api/v1/school/print/creature-quiz-1?variety=hand');
    expect(overset.status).toBe(400);
    const gone = await request(appWith({
      render: renderFake({ throws: new EntityNotFoundError('print document', 'creature-quiz-1') }),
    })).get('/api/v1/school/print/creature-quiz-1?variety=hand');
    expect(gone.status).toBe(404);
  });

  it('rev pins the published revision (getPublished, not source)', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'creature-quiz-1', rev: '4d9ea4aaf', seed: 1, blocks: [] }),
    };
    const res = await request(appWith({ render, repo }))
      .get('/api/v1/school/print/creature-quiz-1?variety=hand&rev=4d9ea4aaf');
    expect(res.status).toBe(200);
    expect(repo.getPublished).toHaveBeenCalledWith('creature-quiz-1', '4d9ea4aaf');
    expect(repo.get).not.toHaveBeenCalled();
    expect(render.calls[0].document).toMatchObject({ rev: '4d9ea4aaf' });
  });

  it('rejects a malformed rev; 404s an unknown rev', async () => {
    const bad = await request(appWith({ render: renderFake() }))
      .get('/api/v1/school/print/creature-quiz-1?variety=hand&rev=NOPE');
    expect(bad.status).toBe(400);
    const repo = { get: vi.fn(), getPublished: vi.fn().mockResolvedValue(null) };
    const gone = await request(appWith({ render: renderFake(), repo }))
      .get('/api/v1/school/print/creature-quiz-1?variety=hand&rev=123456789');
    expect(gone.status).toBe(404);
  });

  it('omr card without startRow ADOPTS the existing allocation record (sheet identity)', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'creature-quiz-1', rev: 'abcdef123', seed: 1, blocks: [] }),
    };
    const allocations = {
      findByCard: vi.fn().mockResolvedValue([
        { documentId: 'other-doc', status: 'live', rev: '111111111', variant: 0, rowRange: { start: 1, end: 4 }, renderedAt: '2026-08-05T01:00:00Z' },
        { documentId: 'creature-quiz-1', status: 'superseded', rev: '000000000', variant: 0, rowRange: { start: 5, end: 10 }, renderedAt: '2026-08-05T02:00:00Z' },
        { documentId: 'creature-quiz-1', status: 'satisfied', rev: 'abcdef123', variant: 2, rowRange: { start: 5, end: 10 }, learnerId: 'learner3', renderedAt: '2026-08-05T03:00:00Z' },
      ]),
    };
    const res = await postRender(appWith({ render, repo, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', card: '4829306', teacher: true,
    });
    expect(res.status).toBe(200);
    expect(repo.getPublished).toHaveBeenCalledWith('creature-quiz-1', 'abcdef123');
    expect(render.calls[0].document).toMatchObject({ variant: 2 });
    expect(render.calls[0].context).toEqual({
      teacher: true, cardId: '4829306', startRow: 5, learnerId: 'learner3',
    });
  });

  it('adopted-record mode rejects explicit rev/variant (the record is the identity)', async () => {
    const allocations = {
      findByCard: vi.fn().mockResolvedValue([
        { documentId: 'creature-quiz-1', status: 'live', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: '2026-08-05T01:00:00Z' },
      ]),
    };
    const res = await postRender(appWith({
      render: renderFake(), repo: { get: vi.fn(), getPublished: vi.fn() }, allocations,
    }), { id: 'creature-quiz-1', variety: 'omr', card: '4829306', variant: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allocation record/);
  });

  it('omr card with no matching record falls back to attach-new semantics', async () => {
    const render = renderFake();
    const allocations = { findByCard: vi.fn().mockResolvedValue([]) };
    await postRender(appWith({ render, allocations }), { id: 'creature-quiz-1', variety: 'omr', card: '1234567' });
    expect(render.calls[0].context).toEqual({ cardId: '1234567', startRow: 1 });
  });

  it('explicit startRow skips the identity lookup entirely', async () => {
    const render = renderFake();
    const allocations = { findByCard: vi.fn() };
    await postRender(appWith({ render, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', card: '1234567', startRow: 18,
    });
    expect(allocations.findByCard).not.toHaveBeenCalled();
    expect(render.calls[0].context).toEqual({ cardId: '1234567', startRow: 18 });
  });

  it('hierarchical taxonomy ids route, adopt, and name the download correctly', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn(),
      getPublished: vi.fn().mockResolvedValue({ id: 'arts/creature-identification/quiz-1', rev: 'abcdef123', seed: 1, blocks: [] }),
    };
    const allocations = {
      findByDocument: vi.fn().mockResolvedValue([
        { documentId: 'arts/creature-identification/quiz-1', cardId: '7654321', status: 'live', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: '2026-08-05T01:00:00Z' },
      ]),
    };
    const res = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/arts/creature-identification/quiz-1?variety=omr&teacher=1');
    expect(res.status).toBe(200);
    expect(allocations.findByDocument).toHaveBeenCalledWith('arts/creature-identification/quiz-1');
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
    const res = await postRender(appWith({ render }), { id: 'creature-quiz-1', variety: 'omr', freshCard: true });
    expect(JSON.parse(res.headers['x-school-print-warnings'])).toEqual(['some genuine warning']);
  });

  it('EVERY lane rides the published doc when the repo is wired — a fresh first print never pins a source-hash rev', async () => {
    const render = renderFake();
    const source = { id: 'q', seed: 1, blocks: [] }; // no rev — a drifted/unpublished source
    const published = { id: 'q', seed: 1, rev: 'abcdef123', blocks: [] };
    const repo = { get: vi.fn().mockResolvedValue(source), getPublished: vi.fn().mockResolvedValue(published) };
    const allocations = { findByCard: vi.fn(), findByDocument: vi.fn().mockResolvedValue([]) };
    const res = await request(appWith({ render, repo, allocations }))
      .get('/api/v1/school/print/creature-quiz-1?variety=omr&learnerId=learner4');
    expect(res.status).toBe(200);
    // The render receives the PUBLISHED document (rev field intact), never the source.
    expect(render.calls[0].document).toMatchObject({ rev: 'abcdef123' });
    expect(render.calls[0].id).toBeUndefined();
  });

  it('a never-published document still renders from source (proofing a draft stays legal)', async () => {
    const render = renderFake();
    const repo = {
      get: vi.fn().mockResolvedValue({ id: 'draft', seed: 1, blocks: [] }),
      getPublished: vi.fn().mockResolvedValue(null),
    };
    const res = await request(appWith({ render, repo }))
      .get('/api/v1/school/print/draft-sheet?variety=hand');
    expect(res.status).toBe(200);
    expect(render.calls[0].document).toMatchObject({ id: 'draft' });
  });

  it('quiz + fabricated card (no usable record) demands a learnerId — the seven-digit bypass is closed', async () => {
    const render = renderFake();
    const doc = { id: 'q', archetype: 'quiz', seed: 1, rev: 'abcdef123', blocks: [] };
    const repo = { get: vi.fn().mockResolvedValue(doc), getPublished: vi.fn().mockResolvedValue(doc) };
    const allocations = { findByCard: vi.fn().mockResolvedValue([]), findByDocument: vi.fn().mockResolvedValue([]) };
    const bare = await postRender(appWith({ render, repo, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', card: '1111111',
    });
    expect(bare.status).toBe(400);
    expect(bare.body.error).toMatch(/learnerId/);
    // Adding an explicit startRow does NOT reopen the bypass — a fabricated
    // card with no usable record for this document is still fabricated,
    // startRow or not.
    const fabricatedWithStartRow = await postRender(appWith({ render, repo, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', card: '1111111', startRow: 1,
    });
    expect(fabricatedWithStartRow.status).toBe(400);
    expect(fabricatedWithStartRow.body.error).toMatch(/learnerId/);
    // With a learner, attach-new on an explicit card stays legal.
    const ok = await postRender(appWith({ render, repo, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', card: '1111111', learnerId: 'learner4',
    });
    expect(ok.status).toBe(200);
  });

  it('adopting a card that belongs to a DIFFERENT learner is a 409, never a silent identity swap', async () => {
    const render = renderFake();
    const doc = { id: 'q', seed: 1, rev: 'abcdef123', blocks: [] };
    const repo = { get: vi.fn().mockResolvedValue(doc), getPublished: vi.fn().mockResolvedValue(doc) };
    const allocations = {
      findByCard: vi.fn().mockResolvedValue([
        { documentId: 'creature-quiz-1', cardId: '4829306', learnerId: 'learner4', status: 'live', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: 't1' },
      ]),
      findByDocument: vi.fn(),
    };
    const res = await postRender(appWith({ render, repo, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', card: '4829306', learnerId: 'learner1',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CARD_LEARNER_MISMATCH');
    expect(res.body.error).toMatch(/belongs to a different learner/);
  });

  it('adopting a card with NO learnerId of its own (rendered anonymously) is still a 409, but the message never claims it belongs to someone else (re-review wave 2 F4)', async () => {
    const render = renderFake();
    const doc = { id: 'q', seed: 1, rev: 'abcdef123', blocks: [] };
    const repo = { get: vi.fn().mockResolvedValue(doc), getPublished: vi.fn().mockResolvedValue(doc) };
    const allocations = {
      findByCard: vi.fn().mockResolvedValue([
        { documentId: 'creature-quiz-1', cardId: '4829306', learnerId: null, status: 'live', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: 't1' },
      ]),
      findByDocument: vi.fn(),
    };
    const res = await postRender(appWith({ render, repo, allocations }), {
      id: 'creature-quiz-1', variety: 'omr', card: '4829306', learnerId: 'learner1',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CARD_LEARNER_MISMATCH');
    expect(res.body.error).toMatch(/anonymous sheet/);
    expect(res.body.error).not.toMatch(/belongs to a different learner/);
  });
});
