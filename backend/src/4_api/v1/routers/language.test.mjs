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
  cueAudio = notFound(),
  cues = [],
  transcript = 'it is cold today',
  // `null` stands for a household with no AI gateway: composition hands the
  // router nothing and the route must still answer something a child can act on.
  languageTranscription = undefined,
} = {}) {
  const service = {
    listCourses: vi.fn(() => [{ id: 'korean' }]),
    previewDay: vi.fn(() => ({ schema: 'school.sentence-ladder-guest-preview/v1', day: 1, queue: [] })),
    getDay: vi.fn(() => ({ day: 1, queue: [] })),
    logAttempt: vi.fn((value) => value), setPacing: vi.fn(() => ({})),
    rollDay: vi.fn(() => ({})), getHistory: vi.fn(() => ({ days: [] })),
    saveRecording: vi.fn(() => ({})),
  };
  const transcription = languageTranscription === undefined
    ? {
      transcribe: vi.fn(async () => ({ transcriptRaw: transcript, transcriptClean: transcript })),
      isEmpty: vi.fn((text) => String(text || '').toLowerCase().includes('no answer')),
    }
    : languageTranscription;
  const languageAudioResource = {
    getPromptAudio: vi.fn().mockResolvedValue(promptAudio),
    getRecordingAudio: vi.fn().mockResolvedValue(recordingAudio),
    getCueAudio: vi.fn().mockResolvedValue(cueAudio),
    listCues: vi.fn(() => cues),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/sentence-ladder', createLanguageRouter({
    languageStudyService: service, studyGrants: { verify },
    languageAudioResource,
    languageTranscription: transcription,
    logger: { info() {}, warn() {}, error() {} },
  }));
  return { app, service, languageAudioResource, transcription };
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
      runId: null,
    });
    expect(service.saveRecording.mock.calls[0][0].buffer).toEqual(bytes);
  });

  // A REVEAL IS A DIFFERENT RECORD, so the flag has to survive the wire. An
  // un-plumbed field on the service is not "recorded": the screen would draw
  // an honest reveal and the log would still say the child answered.
  it('carries a reveal through to the service, and never infers one', async () => {
    const { app, service } = appWith();
    service.logAttempt.mockReturnValue({ rung: 'interpretation', seq: 7, revealed: true });

    await request(app)
      .post('/api/v1/school/sentence-ladder/users/learner3/log')
      .set('X-School-Study-Grant', 'signed')
      .send({ corpus: 'korean', seq: 7, rung: 'interpretation', revealed: true });
    expect(service.logAttempt).toHaveBeenCalledWith(expect.objectContaining({ revealed: true }));

    // Anything that is not literally `true` is not a reveal. A body that says
    // `revealed: "false"` must not turn an answered sentence into a skip.
    await request(app)
      .post('/api/v1/school/sentence-ladder/users/learner3/log')
      .set('X-School-Study-Grant', 'signed')
      .send({ corpus: 'korean', seq: 7, rung: 'interpretation', given: 'it is cold', revealed: 'false' });
    expect(service.logAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      revealed: false, given: 'it is cold',
    }));
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

describe('run id correlation', () => {
  it('threads the client run id into the operations that log', async () => {
    const { app, service } = appWith();

    await request(app)
      .get('/api/v1/school/sentence-ladder/users/learner3/day?corpus=korean')
      .set('X-School-Study-Grant', 'signed')
      .set('X-School-Run-Id', 'b1f0c0de-1111-2222-3333-444455556666');

    expect(service.getDay).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'b1f0c0de-1111-2222-3333-444455556666',
    }));
  });

  it('degrades a malformed run id to null rather than failing a child mid-lesson', async () => {
    const { app, service } = appWith();

    const res = await request(app)
      .post('/api/v1/school/sentence-ladder/users/learner3/log')
      .set('X-School-Study-Grant', 'signed')
      .set('X-School-Run-Id', 'not a run id; drop table')
      .send({ corpus: 'korean', seq: 7, rung: 'repetition' });

    expect(res.status).toBe(200);
    expect(service.logAttempt).toHaveBeenCalledWith(expect.objectContaining({ runId: null }));
  });

  it('logs the run id on context, where the store indexes it', async () => {
    const warn = vi.fn();
    const service = {
      listCourses: vi.fn(), previewDay: vi.fn(), getDay: vi.fn(), logAttempt: vi.fn(),
      setPacing: vi.fn(), rollDay: vi.fn(), getHistory: vi.fn(), saveRecording: vi.fn(),
    };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/school/sentence-ladder', createLanguageRouter({
      languageStudyService: service,
      studyGrants: { verify: () => ({ ok: false, reason: 'expired' }) },
      languageAudioResource: {
        getPromptAudio: vi.fn().mockResolvedValue(notFound()),
        getRecordingAudio: vi.fn().mockResolvedValue(notFound()),
      },
      logger: { info() {}, warn, error() {} },
    }));

    await request(app)
      .get('/api/v1/school/sentence-ladder/users/learner3/day?corpus=korean')
      .set('X-School-Run-Id', 'run-abc123');

    expect(warn).toHaveBeenCalledWith(
      'school.sentence-ladder.study-grant-refused',
      expect.any(Object),
      { context: { runId: 'run-abc123' } },
    );
  });
});

describe('Sentence Ladder UI cues', () => {
  it('tells the day which cues exist, so the client never probes for them', async () => {
    const { app } = appWith({ cues: ['record'] });
    const res = await request(app)
      .get('/api/v1/school/sentence-ladder/users/kckern/day?corpus=korean');
    expect(res.status).toBe(200);
    expect(res.body.cues).toEqual(['record']);
    // The preview carries the same fact: a teacher hears what a learner hears.
    const preview = await request(app).get('/api/v1/school/sentence-ladder/preview/korean/day');
    expect(preview.body.cues).toEqual(['record']);
  });

  it('serves a cue by role with the public media headers', async () => {
    const bytes = Buffer.from('ding');
    const { app, languageAudioResource } = appWith({ cueAudio: found(bytes, 'audio/mpeg') });
    const res = await request(app).get('/api/v1/school/sentence-ladder/cue/record');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(languageAudioResource.getCueAudio).toHaveBeenCalledWith({ name: 'record' });
  });

  it('answers an unconfigured cue with its own not-found envelope', async () => {
    const { app } = appWith();
    const res = await request(app).get('/api/v1/school/sentence-ladder/cue/record');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'cue not found' });
  });
});

/**
 * A SPOKEN ANSWER TO A TYPING RUNG.
 *
 * Interpretation asks what a sentence means, and the answer is still text — a
 * learner who understands perfectly can be defeated by an English keyboard, and
 * then the record measures typing rather than comprehension. So the audio goes
 * one way, a transcript comes back, and the learner reads it before it is sent.
 *
 * ⚠ THE DANGER THIS BLOCK EXISTS TO NAME. A Whisper prompt BIASES recognition:
 * feed it the expected English sentence and the model hears that sentence
 * whatever the child said. Feed the cleanup pass a repair instruction and it
 * tidies a wrong translation into a right one. Either produces a rung that
 * looks like it is working perfectly while measuring nothing, and a green suite
 * will not notice. The profile is written to prevent both
 * (`1_adapters/ai/transcriptionProfiles/language.mjs`); the tests below say the
 * same thing about THIS route, which is the path that would actually leak.
 */
describe('a spoken answer', () => {
  const speak = (app, query = 'corpus=korean&seq=7&lang=EN', bytes = Buffer.from('spoken-answer')) => request(app)
    .post(`/api/v1/school/sentence-ladder/users/test-learner/transcribe?${query}`)
    .set('X-School-Study-Grant', 'signed')
    .set('Content-Type', 'audio/webm')
    .send(bytes);

  it('is guarded by the same study grant as every other write on this rung', async () => {
    const { app, transcription } = appWith({ verify: () => ({ ok: false, reason: 'missing' }) });
    const res = await speak(app);
    expect(res.status).toBe(403);
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it('hands back the transcript and never the audio', async () => {
    const { app, transcription } = appWith({ transcript: '  it is cold today  ' });
    const res = await speak(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transcript: 'it is cold today', empty: false });
    expect(transcription.transcribe).toHaveBeenCalledTimes(1);
    const [call] = transcription.transcribe.mock.calls[0];
    expect(call.audioBuffer).toEqual(Buffer.from('spoken-answer'));
    expect(call.mimeType).toBe('audio/webm');
  });

  /**
   * THE TRAP, named against this route rather than against the profile.
   *
   * Two independent guarantees, because one alone is not enough: the route
   * never asks the study service for the sentence (so there is no expected text
   * in scope to leak), and the context it builds has a fixed, closed shape that
   * a query string cannot widen.
   */
  it('lets NOTHING derived from the expected answer reach the transcription call', async () => {
    const { app, service, transcription } = appWith();

    await speak(
      app,
      // Everything a client could try to smuggle through, at once.
      'corpus=korean&seq=7&lang=EN&expected=The+weather+is+nice+today&text=The+weather+is+nice+today'
      + '&prompt=The+weather+is+nice+today&register=The+weather+is+nice+today',
    );

    // 1. The corpus is never read on this path. Nothing in this request's scope
    //    knows what the right answer is, so nothing can pass it on.
    expect(service.getDay).not.toHaveBeenCalled();
    expect(service.previewDay).not.toHaveBeenCalled();
    expect(service.getHistory).not.toHaveBeenCalled();

    // 2. The context is exactly two fields, both from a closed set. A new key
    //    here is how an expected answer would arrive, so the shape is asserted
    //    exactly rather than with objectContaining.
    const [{ context }] = transcription.transcribe.mock.calls[0];
    expect(Object.keys(context).sort()).toEqual(['register', 'spokenLanguage']);
    expect(context.spokenLanguage).toBe('English');
    expect(context.register).toBe('everyday');

    // 3. And, belt and braces, no field of the call carries the sentence.
    expect(JSON.stringify(transcription.transcribe.mock.calls[0][0].context))
      .not.toMatch(/weather/i);
  });

  it('names the language from an allowlist, never from what the client typed', async () => {
    const { app, transcription } = appWith();
    await speak(app, 'corpus=korean&seq=7&lang=KR');
    expect(transcription.transcribe.mock.calls[0][0].context.spokenLanguage).toBe('Korean');

    // An unknown code falls back to the profile's own default rather than
    // passing a client string into the prompt.
    await speak(app, 'corpus=korean&seq=7&lang=The+weather+is+nice');
    expect(transcription.transcribe.mock.calls[1][0].context.spokenLanguage).toBeUndefined();
  });

  it('says plainly that it heard nothing rather than putting a marker in the field', async () => {
    const { app } = appWith({ transcript: '[No Answer]' });
    const res = await speak(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transcript: '', empty: true });
  });

  it('refuses an empty upload instead of paying for a model call on silence', async () => {
    const { app, transcription } = appWith();
    const res = await request(app)
      .post('/api/v1/school/sentence-ladder/users/test-learner/transcribe?corpus=korean&seq=7&lang=EN')
      .set('X-School-Study-Grant', 'signed')
      .set('Content-Type', 'audio/webm')
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it('answers 503 where no AI gateway is wired, and the day says so in advance', async () => {
    const { app } = appWith({ languageTranscription: null });
    const res = await speak(app);
    expect(res.status).toBe(503);

    // The client does not discover this by pressing a button that fails: the
    // day carries the fact, so the control is never drawn at all.
    const day = await request(app)
      .get('/api/v1/school/sentence-ladder/users/test-learner/day?corpus=korean')
      .set('X-School-Study-Grant', 'signed');
    expect(day.body.voiceAnswer).toBe(false);
  });

  it('advertises voice answers on the day and the preview alike', async () => {
    const { app } = appWith();
    const day = await request(app)
      .get('/api/v1/school/sentence-ladder/users/test-learner/day?corpus=korean')
      .set('X-School-Study-Grant', 'signed');
    expect(day.body.voiceAnswer).toBe(true);
    const preview = await request(app).get('/api/v1/school/sentence-ladder/preview/korean/day');
    expect(preview.body.voiceAnswer).toBe(true);
  });

  /**
   * HOW THE ANSWER WAS GIVEN IS PART OF THE RECORD. `entry.response` is still
   * text — voice is an input method, not a different kind of response — so the
   * only thing that changes on the wire is one field saying which.
   */
  it('carries the answer method through to the service', async () => {
    const { app, service } = appWith();
    await request(app)
      .post('/api/v1/school/sentence-ladder/users/test-learner/log')
      .set('X-School-Study-Grant', 'signed')
      .send({ corpus: 'korean', seq: 7, rung: 'interpretation', given: 'it is cold', method: 'spoken' });
    expect(service.logAttempt).toHaveBeenCalledWith(expect.objectContaining({
      given: 'it is cold', method: 'spoken',
    }));

    // A body with no method is an older client, not a spoken answer: the field
    // stays absent rather than being guessed at.
    await request(app)
      .post('/api/v1/school/sentence-ladder/users/test-learner/log')
      .set('X-School-Study-Grant', 'signed')
      .send({ corpus: 'korean', seq: 7, rung: 'interpretation', given: 'it is cold' });
    expect(service.logAttempt).toHaveBeenLastCalledWith(expect.objectContaining({ method: null }));
  });
});
