// @vitest-environment node
/**
 * `POST /learners/:learnerId/print-next` and `GET /learners/:learnerId/next` —
 * the code-free "print my next sheet" door. The judgement lives in
 * `IssueSubjectNext`; what is pinned here is the boundary: the body is read for
 * `subject` and `deviceId` and nothing else, a learner off the roster is a 404,
 * a subject that is not theirs is a 400, a printer failure is still a 200 with
 * a sentence, nothing is cached, and the routes exist only when wired.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolLifecycleTestRouter as createSchoolLifecycleRouter } from '../../../_lib/school/schoolLifecycleRouterTestSupport.mjs';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const BASE = '/api/v1/school/lifecycle';

const fakeUseCase = () => ({
  execute: vi.fn(async ({ learnerId, subject }) => {
    if (learnerId !== 'learner_a') throw new EntityNotFoundError('learner', learnerId);
    if (subject && subject !== 'math') throw new ValidationError(`${subject} is not one of this learner's subjects`, { field: 'subject' });
    return {
      status: 'print_failed', outcome: 'failed',
      sentence: 'The printer did not answer. Try that again in a minute.',
      subject: 'math', unit: { unitId: 'math.02', title: 'Fractions', subject: 'math' }, sessionId: 'ses_1',
    };
  }),
  preview: vi.fn(async ({ learnerId }) => {
    if (learnerId !== 'learner_a') throw new EntityNotFoundError('learner', learnerId);
    return { subject: 'math', unit: { unitId: 'math.02', title: 'Fractions', subject: 'math' }, printable: true, reward: { silver: 2 } };
  }),
});

function appWith(issueSubjectNext) {
  const app = express();
  app.use(express.json());
  app.use(BASE, createSchoolLifecycleRouter({
    buildAgenda: { execute: vi.fn() },
    issueSubjectNext,
    logger: { info() {}, warn() {}, error() {} },
  }));
  app.use(errorHandlerMiddleware());
  return app;
}

describe('POST /learners/:learnerId/print-next', () => {
  it('passes only the learner, subject and device on, and answers 200 with the sentence', async () => {
    const useCase = fakeUseCase();
    const response = await request(appWith(useCase))
      .post(`${BASE}/learners/learner_a/print-next`)
      .send({ subject: 'math', deviceId: 'portal', unitId: 'other.99', sessionId: 'ses_x', learnerId: 'learner_b' });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.sentence).toBe('The printer did not answer. Try that again in a minute.');
    expect(useCase.execute).toHaveBeenCalledWith({ learnerId: 'learner_a', subject: 'math', deviceId: 'portal' });
  });

  it('works with an empty body', async () => {
    const useCase = fakeUseCase();
    const response = await request(appWith(useCase)).post(`${BASE}/learners/learner_a/print-next`);
    expect(response.status).toBe(200);
    expect(useCase.execute).toHaveBeenCalledWith({ learnerId: 'learner_a', subject: null, deviceId: null });
  });

  it('404s a learner who is not on the roster', async () => {
    const response = await request(appWith(fakeUseCase()))
      .post(`${BASE}/learners/stranger/print-next`).send({});
    expect(response.status).toBe(404);
  });

  it('400s a subject that is not the learner\'s', async () => {
    const response = await request(appWith(fakeUseCase()))
      .post(`${BASE}/learners/learner_a/print-next`).send({ subject: 'history' });
    expect(response.status).toBe(400);
  });

  it('does not exist when the use case is not wired', async () => {
    const response = await request(appWith(null)).post(`${BASE}/learners/learner_a/print-next`).send({});
    expect(response.status).toBe(404);
  });
});

describe('GET /learners/:learnerId/next', () => {
  it('serves the dry run, uncached, with the subject from the query', async () => {
    const useCase = fakeUseCase();
    const response = await request(appWith(useCase)).get(`${BASE}/learners/learner_a/next?subject=math`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ subject: 'math', unit: { title: 'Fractions' }, reward: { silver: 2 } });
    expect(useCase.preview).toHaveBeenCalledWith({ learnerId: 'learner_a', subject: 'math' });
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('404s a learner who is not on the roster', async () => {
    const response = await request(appWith(fakeUseCase())).get(`${BASE}/learners/stranger/next`);
    expect(response.status).toBe(404);
  });
});
