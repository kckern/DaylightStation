import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLanguageRouter } from './language.mjs';

function appWith({ verify = () => ({ ok: true }) } = {}) {
  const service = {
    listCourses: vi.fn(() => [{ id: 'korean' }]),
    getDay: vi.fn(() => ({ day: 1, queue: [] })),
    logAttempt: vi.fn((value) => value), setPacing: vi.fn(() => ({})),
    rollDay: vi.fn(() => ({})), getHistory: vi.fn(() => ({ days: [] })),
    saveRecording: vi.fn(() => ({})), resolveAudioPath: vi.fn(() => null),
    resolveRecordingPath: vi.fn(() => null),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/sentence-ladder', createLanguageRouter({
    languageStudyService: service, studyGrants: { verify },
    logger: { info() {}, warn() {}, error() {} },
  }));
  return { app, service };
}

describe('Sentence Ladder study grant boundary', () => {
  it('keeps course metadata and prompt audio outside learner authority', async () => {
    const { app } = appWith({ verify: () => ({ ok: false }) });
    expect((await request(app).get('/api/v1/school/sentence-ladder/courses')).status).toBe(200);
    expect((await request(app).get('/api/v1/school/sentence-ladder/audio/korean/1/KR')).status).toBe(404);
  });

  it('refuses a learner day without a valid header', async () => {
    const { app, service } = appWith({ verify: () => ({ ok: false, reason: 'missing' }) });
    const res = await request(app).get('/api/v1/school/sentence-ladder/users/milo/day?corpus=korean');
    expect(res.status).toBe(403);
    expect(service.getDay).not.toHaveBeenCalled();
  });

  it('binds verification to learner and corpus and forwards capabilities', async () => {
    const verify = vi.fn(() => ({ ok: true }));
    const { app, service } = appWith({ verify });
    const res = await request(app)
      .get('/api/v1/school/sentence-ladder/users/milo/day?corpus=korean&microphone=true&textInput=EN,KR')
      .set('X-School-Study-Grant', 'signed');
    expect(res.status).toBe(200);
    expect(verify).toHaveBeenCalledWith('signed', { learnerId: 'milo', corpusId: 'korean' });
    expect(service.getDay).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'milo', corpusId: 'korean', capabilities: { microphone: true, textInput: ['EN', 'KR'] },
    }));
  });
});
