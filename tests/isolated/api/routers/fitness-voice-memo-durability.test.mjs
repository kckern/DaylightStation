// tests/isolated/api/routers/fitness-voice-memo-durability.test.mjs
//
// The HTTP contract for durable voice-memo capture. A transcription failure
// must not read as data loss: the response has to name the stored artifact and
// its lifecycle state, because that is the only thing the overlay can use to
// tell the person their recording is safe.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createFitnessRouter } from '#api/v1/routers/fitness.mjs';
import { FilesystemVoiceMemoArtifactStore } from '#adapters/fitness/FilesystemVoiceMemoArtifactStore.mjs';
import { FitnessVoiceMemoService } from '#apps/fitness/services/FitnessVoiceMemoService.mjs';

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const AUDIO_B64 = `data:audio/webm;base64,${Buffer.from('pretend opus payload').toString('base64')}`;

function quotaError() {
  const error = new Error('Request failed with status code 429');
  error.status = 429;
  error.apiError = { code: 'credit_balance_exhausted', type: 'insufficient_quota' };
  return error;
}

describe('POST /api/v1/fitness/voice_memo — durable capture', () => {
  let app, tmpDataDir, store, transcribeVoiceMemo, voiceMemoOperations;

  const artifactDir = () => path.join(tmpDataDir, 'household', 'fitness/voice-memos');

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-memo-route-'));
    const configService = {
      getDefaultHouseholdId: () => 'default',
      getDataDir: () => tmpDataDir,
      getHouseholdPath: (relative) => path.join(tmpDataDir, 'household', relative),
    };
    store = new FilesystemVoiceMemoArtifactStore({ configService, logger: silent });
    transcribeVoiceMemo = vi.fn(async () => ({ transcriptRaw: 'raw', transcriptClean: 'Clean', durationSeconds: 2 }));
    voiceMemoOperations = new FitnessVoiceMemoService({
      transcription: { transcribeVoiceMemo },
      artifacts: store,
      logger: silent,
    });

    const router = createFitnessRouter({
      sessionService: { getStoragePaths: vi.fn() },
      userService: { hydrateFitnessConfig: (d) => d },
      configService,
      contentRegistry: null,
      transcriptionService: null,
      voiceMemoOperations,
      logger: silent,
    });
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use((req, res, next) => { req.householdId = 'default'; next(); });
    app.use('/api/v1/fitness', router);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('answers a provider quota failure with 502 and the saved artifact', async () => {
    transcribeVoiceMemo.mockRejectedValueOnce(quotaError());

    const res = await request(app)
      .post('/api/v1/fitness/voice_memo')
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/webm', sessionId: '20260907120000' });

    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.retryScheduled).toBe(true);
    expect(res.body.artifact.state).toBe('retryable');
    expect(res.body.artifact.lastFailure.classification).toBe('quota_exhausted');
    // The bytes are on disk, which is the claim the response is making.
    expect(store.readAudio(null, res.body.artifact.ref).buffer.toString()).toBe('pretend opus payload');
  });

  it('never puts the audio, the transcript, or the provider prose in the failure body', async () => {
    const error = quotaError();
    // Not key-shaped on purpose — see the note in the service durability test.
    error.message = 'You exceeded your current quota — billing details at REDACTED-KEY-FIXTURE';
    transcribeVoiceMemo.mockRejectedValueOnce(error);

    const res = await request(app)
      .post('/api/v1/fitness/voice_memo')
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/webm' });

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/REDACTED-KEY-FIXTURE/);
    expect(body).not.toMatch(/billing details/);
    expect(body).not.toMatch(/pretend opus/);
  });

  it('returns the memo and leaves no recording behind on success', async () => {
    const res = await request(app)
      .post('/api/v1/fitness/voice_memo')
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/webm' });

    expect(res.status).toBe(200);
    expect(res.body.memo.transcriptClean).toBe('Clean');
    expect(res.body.artifact.state).toBe('transcribed');
    expect(fs.readdirSync(artifactDir()).filter((f) => !f.endsWith('.json'))).toEqual([]);
  });

  it('rejects an oversized capture before it reaches the provider', async () => {
    const big = Buffer.alloc(voiceMemoOperations.maxArtifactBytes + 1, 0x61);
    const res = await request(app)
      .post('/api/v1/fitness/voice_memo')
      .send({ audioBase64: `data:audio/webm;base64,${big.toString('base64')}` });

    expect(res.status).toBe(413);
    expect(transcribeVoiceMemo).not.toHaveBeenCalled();
  });

  it('rejects an undecodable payload as a client error', async () => {
    const res = await request(app).post('/api/v1/fitness/voice_memo').send({ audioBase64: '!!!!' });
    expect(res.status).toBe(400);
    expect(transcribeVoiceMemo).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/fitness/voice_memo/artifacts — staff view', () => {
  let app, tmpDataDir, store;

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-memo-staff-'));
    const configService = {
      getDefaultHouseholdId: () => 'default',
      getDataDir: () => tmpDataDir,
      getHouseholdPath: (relative) => path.join(tmpDataDir, 'household', relative),
    };
    store = new FilesystemVoiceMemoArtifactStore({ configService, logger: silent });
    const router = createFitnessRouter({
      sessionService: { getStoragePaths: vi.fn() },
      userService: { hydrateFitnessConfig: (d) => d },
      configService,
      contentRegistry: null,
      transcriptionService: null,
      voiceMemoOperations: new FitnessVoiceMemoService({
        transcription: { transcribeVoiceMemo: vi.fn(async () => { throw quotaError(); }) },
        artifacts: store,
        logger: silent,
      }),
      logger: silent,
    });
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use((req, res, next) => { req.householdId = 'default'; next(); });
    app.use('/api/v1/fitness', router);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('says which memos are awaiting transcription, and for which session', async () => {
    await request(app).post('/api/v1/fitness/voice_memo')
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/webm', sessionId: '20260907120000' });

    const res = await request(app).get('/api/v1/fitness/voice_memo/artifacts?sessionId=20260907120000');

    expect(res.status).toBe(200);
    expect(res.body.artifacts).toHaveLength(1);
    expect(res.body.artifacts[0]).toMatchObject({
      state: 'retryable', sessionId: '20260907120000', audioAvailable: true, hasTranscript: false,
    });
  });

  it('404s a retry against a ref that never existed', async () => {
    const res = await request(app).post(`/api/v1/fitness/voice_memo/artifacts/vm_${'a'.repeat(16)}/retry`).send({});
    expect(res.status).toBe(404);
  });
});
