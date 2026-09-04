import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';

function app(overrides = {}) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school', createSchoolRouter({
    schoolService: {}, learnerDirectory: { listLearners: async () => [] },
    logger: { error() {} }, ...overrides,
  }));
  return server;
}

describe('GET /teacher/learners/:learnerId/launch-preview', () => {
  it('signs the scope and redirects the synchronously-opened popup', async () => {
    const launchPreviewTokens = { issue: vi.fn(() => 'header.signature') };
    const response = await request(app({ launchPreviewTokens }))
      .get('/api/v1/school/teacher/learners/user_4/launch-preview?subject=science')
      .expect(302);

    expect(launchPreviewTokens.issue).toHaveBeenCalledWith({
      learnerId: 'user_4', subject: 'science', continueToday: false,
    });
    expect(response.headers.location).toBe('/school?preview=header.signature');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('refuses an incomplete scope and is absent when token signing is unavailable', async () => {
    const launchPreviewTokens = { issue: vi.fn() };
    await request(app({ launchPreviewTokens }))
      .get('/api/v1/school/teacher/learners/user_4/launch-preview')
      .expect(400);
    expect(launchPreviewTokens.issue).not.toHaveBeenCalled();

    await request(app())
      .get('/api/v1/school/teacher/learners/user_4/launch-preview?subject=science')
      .expect(404);
  });
});
