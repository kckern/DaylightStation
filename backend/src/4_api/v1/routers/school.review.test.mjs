import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolRouter } from './school.mjs';

function appWith({ reviewQueue, academicPeriods } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolService: { listBankSourceSummaries: () => [] },
    reviewQueue: reviewQueue ?? null,
    academicPeriods: academicPeriods ?? null,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  }));
  return app;
}

const ITEM = {
  itemId: 'q1', sessionId: 'ses_1', learnerId: 'kid1', unitId: 'math-fractions.02',
  verdict: 'correct', note: 'Nice work', gradedBy: 'parent', gradedAt: '2026-07-27T09:00:00.000Z',
  prompt: 'What is 1/2 + 1/2?', questionNumber: 3, reason: 'free_response', given: 'x', rubric: null, enqueuedAt: '2026-07-27T08:00:00.000Z',
};

describe('GET /api/v1/school/review/learner/:learnerId', () => {
  it('200s with the newest-first resolved items when wired', async () => {
    const reviewQueue = { listForLearner: vi.fn(async () => [ITEM]) };
    const res = await request(appWith({ reviewQueue })).get('/api/v1/school/review/learner/kid1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      itemId: 'q1', sessionId: 'ses_1', unitId: 'math-fractions.02', verdict: 'correct',
      note: 'Nice work', gradedBy: 'parent', gradedAt: '2026-07-27T09:00:00.000Z',
      prompt: 'What is 1/2 + 1/2?', questionNumber: 3,
    }]);
    expect(reviewQueue.listForLearner).toHaveBeenCalledWith('kid1', { limit: 20 });
  });

  it('carries verdict through untouched — a route that ever showed a null verdict would be leaking a pending item', async () => {
    const reviewQueue = { listForLearner: vi.fn(async () => [{ ...ITEM, verdict: 'incorrect' }]) };
    const res = await request(appWith({ reviewQueue })).get('/api/v1/school/review/learner/kid1');
    expect(res.body[0].verdict).toBe('incorrect');
  });

  it('passes a query limit through', async () => {
    const reviewQueue = { listForLearner: vi.fn(async () => []) };
    await request(appWith({ reviewQueue })).get('/api/v1/school/review/learner/kid1?limit=5');
    expect(reviewQueue.listForLearner).toHaveBeenCalledWith('kid1', { limit: 5 });
  });

  it('400s an out-of-range limit', async () => {
    const reviewQueue = { listForLearner: vi.fn(async () => []) };
    const res = await request(appWith({ reviewQueue })).get('/api/v1/school/review/learner/kid1?limit=0');
    expect(res.status).toBe(400);
  });

  it('empty array when not wired', async () => {
    const res = await request(appWith()).get('/api/v1/school/review/learner/kid1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/v1/school/periods', () => {
  const PERIODS = [
    { schema: 'school.academic-period/v1', periodId: 'fall-2026', kind: 'semester', label: 'Fall 2026', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z' },
  ];

  it('returns the configured list when wired', async () => {
    const academicPeriods = { listPeriods: vi.fn(() => PERIODS) };
    const res = await request(appWith({ academicPeriods })).get('/api/v1/school/periods');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(PERIODS);
  });

  it('empty array when not wired', async () => {
    const res = await request(appWith()).get('/api/v1/school/periods');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
