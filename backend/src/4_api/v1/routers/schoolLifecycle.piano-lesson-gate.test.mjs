/**
 * The piano kiosk's gate read seam. The route is deliberately thin — all the
 * judgement lives in `GetPianoLessonGate` — so what is worth pinning here is
 * the HTTP contract around it: that it is injection-gated, that it never
 * caches (a stale "owed" would hide the menu after the lesson landed), and
 * that it passes the learner through and the use case's answer back verbatim
 * rather than re-deciding anything.
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolLifecycleRouter } from './schoolLifecycle.mjs';

const GATED = {
  schema: 'school.piano-lesson-gate/v1',
  learnerId: 'kid1',
  gated: true,
  reason: 'owed',
  course: { id: 'plex:1', title: 'Hoffman Academy' },
  unit: { id: '3', title: 'Unit 3' },
  lesson: { id: 'plex:2', title: 'Lesson 12', thumbnail: '/api/img.jpg' },
};

function appWith(getPianoLessonGate) {
  const app = express();
  app.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter({
    // One other use case so the router mounts at all; this route must not
    // depend on it.
    buildAgenda: { execute: vi.fn() },
    getPianoLessonGate,
    logger: { warn() {}, error() {} },
  }));
  return app;
}

const get = (app, learnerId = 'kid1') => request(app)
  .get(`/api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/piano-lesson-gate`);

describe('GET /learners/:learnerId/piano-lesson-gate', () => {
  it('serves the use case answer verbatim, uncached', async () => {
    const getPianoLessonGate = { execute: vi.fn(async () => GATED) };
    const response = await get(appWith(getPianoLessonGate));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(GATED);
    // A cached gate would keep hiding the menu after the lesson was finished.
    expect(response.headers['cache-control']).toBe('no-store');
    expect(getPianoLessonGate.execute).toHaveBeenCalledWith({ learnerId: 'kid1' });
  });

  it('passes a not-gated answer through unchanged', async () => {
    const notGated = { schema: 'school.piano-lesson-gate/v1', learnerId: 'kid1', gated: false, reason: 'done' };
    const response = await get(appWith({ execute: vi.fn(async () => notGated) }));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(notGated);
  });

  it('decodes a learner id with URL-unsafe characters', async () => {
    const getPianoLessonGate = { execute: vi.fn(async () => ({ gated: false })) };
    await get(appWith(getPianoLessonGate), 'kid one');
    expect(getPianoLessonGate.execute).toHaveBeenCalledWith({ learnerId: 'kid one' });
  });

  // A composition with no piano course never registers the route at all, and
  // the kiosk hook is built to fail OPEN on the resulting 404 — the menu shows
  // normally rather than locking a child out of an install that has no gate.
  it('is absent when the use case is not injected', async () => {
    const response = await get(appWith(null));
    expect(response.status).toBe(404);
  });
});
