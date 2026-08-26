// Registration-order regression net for the /print namespace. The Express 5
// splat `/print/*id` (the document renderer) and the fixed quota-printing
// routes (`/print/printables|quota|pending`) share a prefix; whichever is
// registered first wins. These tests pin BOTH directions: the fixed routes
// must not be shadowed by the splat (the 2026-08-06 production bug — all
// three 404'd as "print document not found"), and the splat must still serve
// a real multi-segment document id afterward.
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolRouter } from './school.mjs';

const PDF_BYTES = Buffer.from('%PDF-1.7 fake');

function appWith({ printService = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolService: { listBankSourceSummaries: () => [] },
    renderPrintDocument: {
      async execute() {
        return { bytes: PDF_BYTES, pageCount: 1, density: 'normal', warnings: [] };
      },
    },
    printDocumentsRepo: null,
    printAllocationStore: null,
    printService,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  }));
  return app;
}

const printService = {
  listPrintables: async () => [{ id: 'state-capitals', pages: 2 }],
  getQuota: (userId) => ({ userId, remaining: 5 }),
  listPending: () => [{ requestId: 'req-1', userId: 'learner4', pages: 6 }],
  listRequestsFor: (userId) => [{ id: 'pr_1', userId, status: 'denied', label: 'Maze' }],
  previewPrintable: async (printableId) => {
    if (printableId !== 'state-capitals') {
      const { EntityNotFoundError } = await import('#domains/core/errors/index.mjs');
      throw new EntityNotFoundError('printable', printableId);
    }
    return { pdf: PDF_BYTES, label: 'State Capitals' };
  },
};

describe('/print fixed routes vs the *id splat', () => {
  it('GET /print/pending reaches the pending handler, not the document splat', async () => {
    const res = await request(appWith({ printService })).get('/api/v1/school/print/pending');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ requestId: 'req-1', userId: 'learner4', pages: 6 }]);
  });

  it('GET /print/requests serves a learner\'s own asks; no userId answers []', async () => {
    const res = await request(appWith({ printService })).get('/api/v1/school/print/requests?userId=learner4');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'pr_1', userId: 'learner4', status: 'denied', label: 'Maze' }]);
    expect((await request(appWith({ printService })).get('/api/v1/school/print/requests')).body).toEqual([]);
  });

  it('GET /print/printables reaches printables', async () => {
    const res = await request(appWith({ printService })).get('/api/v1/school/print/printables');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'state-capitals', pages: 2 }]);
  });

  it('GET /print/quota reaches quota', async () => {
    const res = await request(appWith({ printService })).get('/api/v1/school/print/quota?userId=learner4');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'learner4', remaining: 5 });
  });

  it('fixed routes answer their inert shapes even with no printService wired', async () => {
    const app = appWith();
    expect((await request(app).get('/api/v1/school/print/pending')).body).toEqual([]);
    expect((await request(app).get('/api/v1/school/print/printables')).body).toEqual([]);
    expect((await request(app).get('/api/v1/school/print/quota?userId=x')).body).toEqual(null);
  });

  it('a multi-segment document id still resolves through the splat', async () => {
    const res = await request(appWith({ printService })).get('/api/v1/school/print/math/fractions/quiz-1?variety=hand');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('GET /print/printables/:printableId/preview reaches the preview handler, not the document splat', async () => {
    const res = await request(appWith({ printService })).get('/api/v1/school/print/printables/state-capitals/preview');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/inline; filename="preview-state-capitals\.pdf"/);
    expect(res.body).toEqual(PDF_BYTES);
  });

  it('GET preview of an unknown printableId 404s', async () => {
    const res = await request(appWith({ printService })).get('/api/v1/school/print/printables/nope/preview');
    expect(res.status).toBe(404);
  });

  it('preview 503s when no printService is wired', async () => {
    const res = await request(appWith()).get('/api/v1/school/print/printables/state-capitals/preview');
    expect(res.status).toBe(503);
  });
});

describe('card-minting print renders are POSTs, not GETs (punch 5b)', () => {
  it('GET with freshCard= 400s, naming POST /print/render', async () => {
    const res = await request(appWith({ printService }))
      .get('/api/v1/school/print/math/fractions/quiz-1?freshCard=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('card-minting renders require POST /print/render');
  });

  it('GET with card= 400s the same way', async () => {
    const res = await request(appWith({ printService }))
      .get('/api/v1/school/print/math/fractions/quiz-1?card=1234567');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('card-minting renders require POST /print/render');
  });

  it('GET with teacherPin= 400s the same way', async () => {
    const res = await request(appWith({ printService }))
      .get('/api/v1/school/print/math/fractions/quiz-1?teacherPin=4321');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('card-minting renders require POST /print/render');
  });

  it('POST /print/render with a JSON body renders the PDF (card-minting behavior lives here now)', async () => {
    const res = await request(appWith({ printService }))
      .post('/api/v1/school/print/render')
      .send({ id: 'math/fractions/quiz-1', freshCard: true });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('a plain proof GET (no card params) still 200s a PDF, unchanged', async () => {
    const res = await request(appWith({ printService }))
      .get('/api/v1/school/print/math/fractions/quiz-1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });
});

describe('GET /api/v1/school/teachers', () => {
  it('serves the use case result', async () => {
    const app = express();
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      getTeachers: { execute: async () => ({ configured: true, teachers: [{ id: 'kckern', name: 'KC' }] }) },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }));
    const res = await request(app).get('/api/v1/school/teachers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, teachers: [{ id: 'kckern', name: 'KC' }] });
  });

  it('unwired answers the honest not-configured shape, not a 404', async () => {
    const app = express();
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }));
    const res = await request(app).get('/api/v1/school/teachers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, teachers: [] });
  });
});

describe('print approve/deny forward the body pin', () => {
  it('approve and deny hand {requestId, approver, pin} to the service', async () => {
    const approve = vi.fn(async (args) => ({ decision: 'printed', ...args }));
    const deny = vi.fn(async (args) => ({ decision: 'denied', ...args }));
    const app = express();
    app.use(express.json());
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      printService: { approve, deny, listPending: () => [], listPrintables: async () => [], getQuota: () => null },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }));
    await request(app).post('/api/v1/school/print/pr_1/approve').send({ approver: 'kckern', pin: '7410' });
    expect(approve).toHaveBeenCalledWith({ requestId: 'pr_1', approver: 'kckern', pin: '7410' });
    await request(app).post('/api/v1/school/print/pr_1/deny').send({ approver: 'kckern', pin: '7410' });
    expect(deny).toHaveBeenCalledWith({ requestId: 'pr_1', approver: 'kckern', pin: '7410' });
  });
});

describe('GET /api/v1/school/audit (admin advocacy #9)', () => {
  it('merges the five history trails newest-first and honors ?since=', async () => {
    const app = express();
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      academicPeriodStore: { history: () => [{ at: '2026-08-01T10:00:00Z', editedBy: 'kckern', count: 3 }] },
      passOverrideStore: { all: () => ({}), history: () => [{ at: '2026-08-03T10:00:00Z', editedBy: 'elizabeth', unitId: 'frac.01', percent: 60 }] },
      milestoneStore: { history: () => [{ at: '2026-07-01T10:00:00Z', editedBy: 'kckern', count: 2 }] },
      assignmentsStore: {
        list: async () => [{ learnerId: 'learner4' }],
        history: async () => [{ recordedAt: '2026-08-02T10:00:00Z', assignedBy: 'kckern', courses: ['math'] }],
      },
      // Task 12 (debt M5): the reassignment audit trail joins the merge too.
      reassignmentLog: { list: () => [{ at: '2026-08-04T09:00:00Z', fromLearnerId: 'learner4', toLearnerId: 'learner3', moved: 1, reassignedBy: 'kckern' }] },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }));
    const res = await request(app).get('/api/v1/school/audit');
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e) => e.kind)).toEqual(['reassignment', 'pass-override', 'assignments', 'periods', 'milestones']);
    expect(res.body.entries[0]).toMatchObject({ kind: 'reassignment', by: 'kckern', learnerId: 'learner4', toLearnerId: 'learner3', moved: 1 });

    const since = await request(app).get('/api/v1/school/audit?since=2026-08-02');
    expect(since.body.entries.map((e) => e.kind)).toEqual(['reassignment', 'pass-override', 'assignments']);
  });

  it('a throwing reassignment trail must not blank the rest (same posture as the other trails)', async () => {
    const app = express();
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      academicPeriodStore: { history: () => [{ at: '2026-08-01T10:00:00Z', editedBy: 'kckern', count: 3 }] },
      reassignmentLog: { list: () => { throw new Error('reassignments.yml is corrupt'); } },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }));
    const res = await request(app).get('/api/v1/school/audit');
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e) => e.kind)).toEqual(['periods']);
  });

  it('no stores wired answers an empty trail, never a crash', async () => {
    const app = express();
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }));
    expect((await request(app).get('/api/v1/school/audit')).body).toEqual({ entries: [] });
  });
});

describe('report-card PDF name resolution (M9 fix)', () => {
  it('resolves the display name from a SYNC learnerDirectory without crashing', async () => {
    const app = express();
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      getReportCard: { execute: async () => ({ schema: 'school.report-card/v1', learnerId: 'learner4', period: { label: 'Fall' }, courses: [], materials: [], activeDays: { bySubject: {}, total: 0 }, concepts: null, pendingReview: 0, remediationArcs: [] }) },
      renderReportCardPdf: async (report, { learnerName }) => ({ pdf: Buffer.from(`PDF:${learnerName}`), pageCount: 1, mode: 'draft' }),
      learnerDirectory: { listLearners: () => [{ id: 'learner4', name: 'Learner4' }] }, // SYNC return
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }));
    const res = await request(app).get('/api/v1/school/report-card?learnerId=learner4&periodId=p1&format=pdf');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('PDF:Learner4');
  });
});
