// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';

const service = {
  getRoster: () => [], warmBanks: async () => {}, listBanks: () => [],
};

function fixture() {
  const getLearningProgress = {
    execute: vi.fn(async (query) => ({ schema: 'school.learning-progress/v1', query })),
    options: vi.fn(async () => ({
      learners: [{ id: 'kid-a', name: 'Alpha' }],
      scopes: [{ type: 'household', id: 'home', label: 'Home', learnerIds: ['kid-a'] }],
      periods: [{ periodId: 'fall', kind: 'semester', label: 'Fall' }],
    })),
  };
  const learnerDirectory = { listLearners: vi.fn(async () => [{ id: 'kid-a', name: 'Alpha' }]) };
  const getInstructionalInsights = {
    execute: vi.fn(async (query) => ({ schema: 'school.instructional-insights/v1', query })),
  };
  const recordLearningReflection = {
    execute: vi.fn(async (command) => ({ status: 'recorded', evidence: command })),
  };
  const recordLearningProbeInteraction = {
    execute: vi.fn(async (command) => ({ status: 'recorded', evidence: command })),
  };
  const learningCatalog = {
    list: vi.fn(async () => ({ schema: 'school.catalog-index/v1', catalogs: [{ catalogId: 'main' }] })),
    lesson: vi.fn(async (address) => ({ schema: 'school.learning-lesson/v1', address })),
  };
  const openCatalogLearningSession = {
    execute: vi.fn(async () => ({ sessionId: 'ses-catalog' })),
  };
  const issueContinuationCode = {
    execute: vi.fn(async ({ learnerId, moduleCode }) => ({
      schema: 'school.continuation-code/v1', learnerId, moduleCode, code: '123456',
    })),
  };
  const remediationTutor = {
    listAvailable: vi.fn(async () => [{ sessionId: 'rem-1', status: 'offered' }]),
    get: vi.fn(async () => ({ sessionId: 'rem-1', learnerId: 'kid-a', status: 'active' })),
    act: vi.fn(async () => ({ status: 'complete', session: { sessionId: 'rem-1' } })),
  };
  const offerCatalogQuizRemediation = {
    execute: vi.fn(async () => ({ status: 'offered', offer: { sessionId: 'rem-quiz-1' } })),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolService: service, getLearningProgress, getInstructionalInsights,
    recordLearningReflection, remediationTutor, offerCatalogQuizRemediation, learnerDirectory,
    recordLearningProbeInteraction,
    learningCatalog,
    openCatalogLearningSession,
    issueContinuationCode,
    logger: { error: vi.fn() },
  }));
  return {
    app, getLearningProgress, getInstructionalInsights, recordLearningReflection,
    recordLearningProbeInteraction, learningCatalog, remediationTutor,
    offerCatalogQuizRemediation, learnerDirectory,
    openCatalogLearningSession,
    issueContinuationCode,
  };
}

describe('School progress HTTP projection', () => {
  it('issues a non-cacheable continuation route through the School application', async () => {
    const { app, issueContinuationCode } = fixture();
    const response = await request(app).get('/api/v1/school/continuation-code')
      .query({ learnerId: 'kid-a', moduleCode: '098765' }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ schema: 'school.continuation-code/v1', code: '123456' });
    expect(issueContinuationCode.execute).toHaveBeenCalledWith({ learnerId: 'kid-a', moduleCode: '098765' });
  });

  it('rejects incomplete continuation-code requests at the HTTP boundary', async () => {
    const { app, issueContinuationCode } = fixture();
    await request(app).get('/api/v1/school/continuation-code?learnerId=kid-a').expect(400);
    expect(issueContinuationCode.execute).not.toHaveBeenCalled();
  });

  it('serves the configured learner roster and progress filter options', async () => {
    const { app } = fixture();
    await request(app).get('/api/v1/school/roster').expect(200, [{ id: 'kid-a', name: 'Alpha' }]);
    const options = await request(app).get('/api/v1/school/progress/options').expect(200);
    expect(options.body).toMatchObject({ learners: [{ id: 'kid-a' }], periods: [{ periodId: 'fall' }] });
    expect(options.headers['cache-control']).toBe('no-store');
  });

  it('maps learner/cohort, academic-time, curriculum, classification, and grouping query fields', async () => {
    const { app, getLearningProgress } = fixture();
    await request(app).get('/api/v1/school/progress')
      .query({
        learnerId: 'kid-a', periodId: 'fall', subject: 'math', area: 'quantitative',
        excludeClassification: 'elective', groupBy: 'subject,month', recentLimit: '5',
      })
      .expect(200);
    expect(getLearningProgress.execute).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: 'learner', scopeId: 'kid-a', periodId: 'fall', recentLimit: 5,
      filters: expect.objectContaining({
        subjectIds: ['math'], areaIds: ['quantitative'], excludeClassifications: ['elective'],
      }),
      groupBy: ['subject', 'month'],
    }));
  });

  it('rejects malformed query bounds as a 400 instead of an internal error', async () => {
    const { app, getLearningProgress } = fixture();
    await request(app).get('/api/v1/school/progress?recentLimit=101').expect(400);
    expect(getLearningProgress.execute).not.toHaveBeenCalled();
  });

  it('projects cohort instructional insights without calculator-specific query fields', async () => {
    const { app, getInstructionalInsights } = fixture();
    const response = await request(app).get('/api/v1/school/progress/insights').query({
      scopeType: 'classroom', scopeId: 'math',
      from: '2026-08-01T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z',
    }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(getInstructionalInsights.execute).toHaveBeenCalledWith({
      scopeType: 'classroom', scopeId: 'math',
      from: '2026-08-01T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z',
    });
  });

  it('records a web reflection while owning evidence source identity at the HTTP boundary', async () => {
    const { app, recordLearningReflection } = fixture();
    await request(app).post('/api/v1/school/progress/reflections').send({
      observationId: 'quiz-1:self-reflection',
      learnerId: 'kid-a',
      activity: { id: 'fractions-check', sessionId: 'quiz-1' },
      learning: { conceptIds: ['equivalence'] },
      selfRegulation: { phase: 'self_reflection', confidence: 2 },
      source: { surface: 'calculator', transport: 'offline' },
    }).expect(201);
    expect(recordLearningReflection.execute).toHaveBeenCalledWith(expect.objectContaining({
      observationId: 'quiz-1:self-reflection',
      learnerId: 'kid-a',
      source: { surface: 'web', transport: 'screen' },
    }));
  });

  it('projects the shared remediation tutor through learner-scoped web access', async () => {
    const { app, remediationTutor } = fixture();
    await request(app).get('/api/v1/school/remediation?learnerId=kid-a').expect(200);
    expect(remediationTutor.listAvailable).toHaveBeenCalledWith({
      surface: 'web', learnerId: 'kid-a',
    });

    await request(app).get('/api/v1/school/remediation/rem-1')
      .query({ learnerId: 'kid-a', after: '2', limit: '5' }).expect(200);
    expect(remediationTutor.get).toHaveBeenCalledWith({
      sessionId: 'rem-1', access: { surface: 'web', learnerId: 'kid-a' },
      afterServerSequence: 2, maxTurns: 5,
    });

    await request(app).post('/api/v1/school/remediation/rem-1/actions').send({
      learnerId: 'kid-a', clientSequence: 1, lastServerSequence: 2,
      action: 'explain', turnId: 'turn-2',
    }).expect(200);
    expect(remediationTutor.act).toHaveBeenCalledWith(expect.objectContaining({
      access: { surface: 'web', learnerId: 'kid-a' }, action: 'explain', turnId: 'turn-2',
    }));
  });

  it('mints a remediation offer from server-owned completed-quiz evidence', async () => {
    const { app, offerCatalogQuizRemediation } = fixture();
    const response = await request(app).post('/api/v1/school/sessions/ses-quiz-1/remediation-offer')
      .send({ learnerId: 'kid-a', bankId: 'untrusted-client-bank' })
      .expect(201);
    expect(response.body).toEqual({ status: 'offered', offer: { sessionId: 'rem-quiz-1' } });
    expect(offerCatalogQuizRemediation.execute).toHaveBeenCalledWith({
      sessionId: 'ses-quiz-1', learnerId: 'kid-a',
    });
  });

  it('records probe feedback and continuation separately while owning web source identity', async () => {
    const { app, recordLearningProbeInteraction } = fixture();
    await request(app).post('/api/v1/school/learning-probes/interactions').send({
      observationId: 'ses-1:q1:1:feedback', learnerId: 'kid-a',
      event: 'feedback_viewed', attemptNumber: 1,
      activity: { id: 'rates/check', sessionId: 'ses-1', itemId: 'q1' },
      learning: { conceptIds: ['unit-rate'] },
      source: { surface: 'calculator', transport: 'relay' },
    }).expect(201);
    expect(recordLearningProbeInteraction.execute).toHaveBeenCalledWith(expect.objectContaining({
      event: 'feedback_viewed',
      source: { surface: 'web', transport: 'screen' },
    }));
  });

  it('serves the shared authored Catalog and hydrated Lesson without calculator query fields', async () => {
    const { app, learningCatalog } = fixture();
    await request(app).get('/api/v1/school/catalogs?learnerId=kid-a').expect(200, {
      schema: 'school.catalog-index/v1', catalogs: [{ catalogId: 'main' }],
    });
    const response = await request(app)
      .get('/api/v1/school/catalogs/main/subjects/quant/courses/rates/units/unit-1/lessons/intro?learnerId=kid-a')
      .expect(200);
    expect(response.body.schema).toBe('school.learning-lesson/v1');
    expect(learningCatalog.lesson).toHaveBeenCalledWith({
      catalogId: 'main', subjectId: 'quant', courseId: 'rates',
      unitId: 'unit-1', lessonId: 'intro', learnerId: 'kid-a',
    });
    expect(learningCatalog.list).toHaveBeenCalledWith({ learnerId: 'kid-a' });
  });

  it('routes Catalog work through server-resolved session opening', async () => {
    const { app, openCatalogLearningSession } = fixture();
    const learning = {
      catalogId: 'main', subjectId: 'quant', courseId: 'rates', unitId: 'unit-1',
      lessonId: 'intro', moduleId: 'check', conceptIds: ['untrusted-client-value'],
    };
    await request(app).post('/api/v1/school/sessions').send({
      userId: 'kid-a', bankId: 'rates/check', mode: 'learning_probe', learning,
    }).expect(200, { sessionId: 'ses-catalog' });
    // `purpose`/`testPlan` ride along on every Catalog open since the rich
    // flashcard study program landed — the router forwards both from the body
    // and `OpenCatalogLearningSession#execute` declares both in its signature.
    // They are `null` here because this request is ordinary Catalog work, not
    // a flashcard test; asserted explicitly rather than loosened to
    // `objectContaining` so that a future field silently joining the call
    // still fails this test.
    expect(openCatalogLearningSession.execute).toHaveBeenCalledWith({
      learnerId: 'kid-a',
      bankId: 'rates/check',
      mode: 'learning_probe',
      learning,
      purpose: null,
      testPlan: null,
      fresh: false,
    });
  });

  it('requires a learner scope for web remediation reads', async () => {
    const { app, remediationTutor } = fixture();
    await request(app).get('/api/v1/school/remediation').expect(400);
    expect(remediationTutor.listAvailable).not.toHaveBeenCalled();
  });
});
