import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
import { createLanguageRouter } from './language.mjs';

const notFound = () => ({ kind: 'not-found' });
const found = (bytes, contentType) => ({
  kind: 'found',
  resource: {
    size: bytes.length,
    contentType,
    open: () => Readable.from(bytes),
  },
});

function appWith({
  verify = () => ({ ok: true }),
  promptAudio = notFound(),
  recordingAudio = notFound(),
} = {}) {
  const service = {
    listCourses: vi.fn(() => [{ id: 'korean' }]),
    previewDay: vi.fn(() => ({ schema: 'school.sentence-ladder-guest-preview/v1', day: 1, queue: [] })),
    getDay: vi.fn(() => ({ day: 1, queue: [] })),
    logAttempt: vi.fn((value) => value), setPacing: vi.fn(() => ({})),
    rollDay: vi.fn(() => ({})), getHistory: vi.fn(() => ({ days: [] })),
    saveRecording: vi.fn(() => ({})),
  };
  const languageAudioResource = {
    getPromptAudio: vi.fn().mockResolvedValue(promptAudio),
    getRecordingAudio: vi.fn().mockResolvedValue(recordingAudio),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/sentence-ladder', createLanguageRouter({
    languageStudyService: service, studyGrants: { verify },
    languageAudioResource,
    logger: { info() {}, warn() {}, error() {} },
  }));
  return { app, service, languageAudioResource };
}

describe('Sentence Ladder study grant boundary', () => {
  it('keeps course metadata and prompt audio outside learner authority', async () => {
    const { app } = appWith({ verify: () => ({ ok: false }) });
    expect((await request(app).get('/api/v1/school/sentence-ladder/courses')).status).toBe(200);
    expect((await request(app).get('/api/v1/school/sentence-ladder/audio/korean/1/KR')).status).toBe(404);
  });

  it('serves the guest preview without a study grant or learner route', async () => {
    const { app, service } = appWith({ verify: () => ({ ok: false }) });
    const res = await request(app)
      .get('/api/v1/school/sentence-ladder/preview/korean/day?microphone=true&textInput=EN,KR');
    expect(res.status).toBe(200);
    expect(res.headers['x-school-preview']).toBe('guest-non-recording');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(service.previewDay).toHaveBeenCalledWith({
      corpusId: 'korean', capabilities: { microphone: true, textInput: ['EN', 'KR'] },
    });
    expect(service.getDay).not.toHaveBeenCalled();
  });

  it('refuses a learner day without a valid header', async () => {
    const { app, service } = appWith({ verify: () => ({ ok: false, reason: 'missing' }) });
    const res = await request(app).get('/api/v1/school/sentence-ladder/users/learner3/day?corpus=korean');
    expect(res.status).toBe(403);
    expect(service.getDay).not.toHaveBeenCalled();
  });

  it('binds verification to learner and corpus and forwards capabilities', async () => {
    const verify = vi.fn(() => ({ ok: true }));
    const { app, service } = appWith({ verify });
    const res = await request(app)
      .get('/api/v1/school/sentence-ladder/users/learner3/day?corpus=korean&microphone=true&textInput=EN,KR')
      .set('X-School-Study-Grant', 'signed');
    expect(res.status).toBe(200);
    expect(verify).toHaveBeenCalledWith('signed', { learnerId: 'learner3', corpusId: 'korean' });
    expect(service.getDay).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'learner3', corpusId: 'korean', capabilities: { microphone: true, textInput: ['EN', 'KR'] },
    }));
  });

  it('streams prompt audio with the established public media headers', async () => {
    const bytes = Buffer.from('prompt-audio');
    const { app, languageAudioResource } = appWith({
      promptAudio: found(bytes, 'audio/mpeg'),
    });

    const res = await request(app)
      .get('/api/v1/school/sentence-ladder/audio/korean/7/KR');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.headers['content-length']).toBe(String(bytes.length));
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.compare(res.body, bytes)).toBe(0);
    expect(languageAudioResource.getPromptAudio).toHaveBeenCalledWith({
      corpusId: 'korean', seq: '7', language: 'KR',
    });
  });

  it('streams learner recordings with the established private cache header', async () => {
    const bytes = Buffer.from('learner-voice');
    const { app, languageAudioResource } = appWith({
      recordingAudio: found(bytes, 'audio/webm'),
    });

    const res = await request(app)
      .get('/api/v1/school/sentence-ladder/recordings/learner3/korean/7')
      .set('X-School-Study-Grant', 'signed');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/webm');
    expect(res.headers['content-length']).toBe(String(bytes.length));
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(Buffer.compare(res.body, bytes)).toBe(0);
    expect(languageAudioResource.getRecordingAudio).toHaveBeenCalledWith({
      corpusId: 'korean', userId: 'learner3', seq: '7',
    });
  });

  it('preserves the raw recording upload status, body, and operation input', async () => {
    const bytes = Buffer.from('new-learner-voice');
    const { app, service } = appWith();
    service.saveRecording.mockReturnValue({ rung: 'recording', seq: 7 });

    const res = await request(app)
      .post('/api/v1/school/sentence-ladder/users/learner3/recording?corpus=korean&seq=7&ext=webm&microphone=1&textInput=KR')
      .set('X-School-Study-Grant', 'signed')
      .set('Content-Type', 'audio/webm')
      .send(bytes);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rung: 'recording', seq: 7 });
    expect(service.saveRecording).toHaveBeenCalledWith({
      userId: 'learner3',
      corpusId: 'korean',
      seq: '7',
      buffer: expect.any(Buffer),
      ext: 'webm',
      capabilities: { microphone: true, textInput: ['KR'] },
    });
    expect(service.saveRecording.mock.calls[0][0].buffer).toEqual(bytes);
  });

  it('preserves the two audio not-found envelopes', async () => {
    const { app } = appWith();

    const prompt = await request(app)
      .get('/api/v1/school/sentence-ladder/audio/korean/7/KR');
    expect(prompt.status).toBe(404);
    expect(prompt.body).toEqual({ error: 'audio not found' });

    const recording = await request(app)
      .get('/api/v1/school/sentence-ladder/recordings/learner3/korean/7')
      .set('X-School-Study-Grant', 'signed');
    expect(recording.status).toBe(404);
    expect(recording.body).toEqual({ error: 'recording not found' });
  });
});
