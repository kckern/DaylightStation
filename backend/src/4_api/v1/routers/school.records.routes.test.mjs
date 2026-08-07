/**
 * Route-level net for the wave-4 records GETs (M4 review gate 3): the exact
 * seam the mid-wave deps-drop slipped through. Fixtures use the REAL
 * read-model shapes (activeDays is {bySubject, total} — the object whose
 * mis-render black-screened the live tab).
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolRouter } from './school.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

const REPORT = {
  schema: 'school.progress-report/v1',
  learnerId: 'felix',
  period: { periodId: '2026-fall', label: 'Fall 2026', startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2026-12-19T07:00:00.000Z' },
  courses: [{ courseId: 'math-fractions', coursePercent: 88 }],
  activeDays: { bySubject: [{ subjectId: 'math', days: 3 }], total: 3 },
  milestones: [],
  enrichment: { entries: [], daysInPeriod: 0 },
};

const CARD = {
  schema: 'school.report-card/v1',
  learnerId: 'felix',
  period: { periodId: '2026-fall', label: 'Fall 2026' },
  courses: [{ courseId: 'math-fractions', policy: 'best-of-unit-mean-v1', coursePercent: 88 }],
  activeDays: { bySubject: [], total: 3 },
  concepts: { mastered: [], developing: [] },
  pendingReview: 0,
  remediationArcs: [],
  materials: [],
};

const silent = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };

function appWith(over = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolService: { listBankSourceSummaries: () => [] },
    getProgressReport: { execute: vi.fn(async ({ periodId }) => {
      if (periodId === 'ghost') throw new EntityNotFoundError('Academic period', periodId);
      return REPORT;
    }) },
    renderProgressReportPdf: vi.fn(async () => ({ pdf: Buffer.from('%PDF-fake'), pageCount: 1 })),
    renderCertificatePdf: vi.fn(async (input) => ({ pdf: Buffer.from(`%PDF-${input.learnerName}`), pageCount: 1 })),
    getReportCard: { execute: vi.fn(async () => CARD) },
    learnerDirectory: { listLearners: async () => [{ id: 'felix', name: 'Felix' }] },
    getHouseholdOffsetMinutes: () => -420,
    logger: silent,
    ...over,
  }));
  return app;
}

describe('GET /api/v1/school/progress-report', () => {
  it('serves the read model as JSON', async () => {
    const res = await request(appWith()).get('/api/v1/school/progress-report?learnerId=felix&periodId=2026-fall');
    expect(res.status).toBe(200);
    expect(res.body.activeDays).toEqual({ bySubject: [{ subjectId: 'math', days: 3 }], total: 3 });
  });

  it('format=pdf renders with a safe filename', async () => {
    const res = await request(appWith()).get('/api/v1/school/progress-report?learnerId=felix&periodId=2026-fall&format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe('inline; filename="progress-report-felix-2026-fall.pdf"');
  });

  it('a ghost period is a 404, never a 500', async () => {
    const res = await request(appWith()).get('/api/v1/school/progress-report?learnerId=felix&periodId=ghost');
    expect(res.status).toBe(404);
  });

  it('unwired serves null (the unavailable tell), not a 404', async () => {
    const res = await request(appWith({ getProgressReport: null })).get('/api/v1/school/progress-report?learnerId=felix&periodId=2026-fall');
    expect(res.status).toBe(200);
    expect(res.body).toBe(null);
  });
});

describe('GET /api/v1/school/certificate', () => {
  it('renders a PDF for a graded course, dated in the household calendar', async () => {
    const res = await request(appWith()).get('/api/v1/school/certificate?learnerId=felix&periodId=2026-fall&courseId=math-fractions&format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe('inline; filename="certificate-felix-math-fractions.pdf"');
  });

  it('an ungraded or unknown course 404s — no fabricated diplomas', async () => {
    const res = await request(appWith()).get('/api/v1/school/certificate?learnerId=felix&periodId=2026-fall&courseId=ghost&format=pdf');
    expect(res.status).toBe(404);
  });

  it('unwired is a 503, not a silent empty', async () => {
    const res = await request(appWith({ renderCertificatePdf: null })).get('/api/v1/school/certificate?learnerId=felix&periodId=2026-fall&courseId=math-fractions&format=pdf');
    expect(res.status).toBe(503);
  });
});

describe('stale-save baselines travel through the routes (M6 gate 3)', () => {
  it('PUT /periods forwards baseHistoryLength; GET /periods-meta serves it', async () => {
    const setAcademicPeriods = { execute: vi.fn(async (args) => ({ periods: [], got: args })) };
    const academicPeriods = { listPeriods: () => [], historyLength: () => 7 };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      setAcademicPeriods, academicPeriods, logger: silent,
    }));
    const meta = await request(app).get('/api/v1/school/periods-meta');
    expect(meta.body).toEqual({ historyLength: 7 });
    await request(app).put('/api/v1/school/periods').send({ periods: [], editedBy: 'k', pin: 'p', baseHistoryLength: 7 });
    expect(setAcademicPeriods.execute).toHaveBeenCalledWith(
      expect.objectContaining({ baseHistoryLength: 7 }));
  });

  it('PUT /periods: a stale baseHistoryLength is refused 409, not the router\'s ValidationError 400', async () => {
    const setAcademicPeriods = {
      execute: vi.fn(async () => {
        const err = new Error('The periods changed since you loaded them — reload and try again.');
        err.name = 'ValidationError';
        err.code = 'STALE_SAVE';
        err.status = 409;
        throw err;
      }),
    };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      setAcademicPeriods, logger: silent,
    }));
    const res = await request(app).put('/api/v1/school/periods').send({ periods: [], editedBy: 'k', baseHistoryLength: 0 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'STALE_SAVE' });
  });

  it('PUT /milestones forwards baseHistoryLength', async () => {
    const setMilestones = { execute: vi.fn(async () => ({ milestones: [] })) };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      setMilestones, logger: silent,
    }));
    await request(app).put('/api/v1/school/milestones').send({ learnerId: 'felix', milestones: [], editedBy: 'k', baseHistoryLength: 3 });
    expect(setMilestones.execute).toHaveBeenCalledWith(expect.objectContaining({ baseHistoryLength: 3 }));
  });
});
