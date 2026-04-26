// tests/isolated/api/routers/fitness-debug-voice-memo.test.mjs
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createFitnessRouter } from '../../../../backend/src/4_api/v1/routers/fitness.mjs';

describe('POST /api/v1/fitness/debug/voice-memo', () => {
  let app;
  let tmpDataDir;

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-memo-test-'));
    const configService = {
      getDefaultHouseholdId: () => 'default',
      getDataDir: () => tmpDataDir,
    };
    const router = createFitnessRouter({
      sessionService: { getStoragePaths: vi.fn() },
      zoneLedController: null,
      userService: { hydrateFitnessConfig: (d) => d },
      configService,
      contentRegistry: null,
      transcriptionService: null,
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    });
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use((req, res, next) => { req.householdId = 'default'; next(); });
    app.use('/api/v1/fitness', router);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('writes a .webm file under data/_debug/voice_memos/ and returns metadata', async () => {
    const audioBase64 = 'data:audio/webm;base64,dGVzdA=='; // "test"
    const res = await request(app)
      .post('/api/v1/fitness/debug/voice-memo')
      .send({ audioBase64, mimeType: 'audio/webm' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.filename).toBe('string');
    expect(res.body.filename.endsWith('.webm')).toBe(true);
    expect(res.body.filename).not.toMatch(/:/);
    expect(res.body.size).toBe(4);
    expect(typeof res.body.savedAt).toBe('number');

    const writtenDir = path.join(tmpDataDir, '_debug', 'voice_memos');
    expect(fs.existsSync(writtenDir)).toBe(true);
    const files = fs.readdirSync(writtenDir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe(res.body.filename);

    const buf = fs.readFileSync(path.join(writtenDir, files[0]));
    expect(buf.toString('utf8')).toBe('test');
  });

  it('accepts raw base64 without the data URI prefix', async () => {
    const res = await request(app)
      .post('/api/v1/fitness/debug/voice-memo')
      .send({ audioBase64: 'dGVzdA==', mimeType: 'audio/webm' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.size).toBe(4);
  });

  it('returns 400 when audioBase64 is missing', async () => {
    const res = await request(app)
      .post('/api/v1/fitness/debug/voice-memo')
      .send({ mimeType: 'audio/webm' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/audioBase64/);
  });

  it('does NOT attach sessionId or trigger Strava enrichment', async () => {
    const enrichmentService = { reEnrichDescription: vi.fn() };
    const configService = {
      getDefaultHouseholdId: () => 'default',
      getDataDir: () => tmpDataDir,
    };
    const router = createFitnessRouter({
      sessionService: { getStoragePaths: vi.fn() },
      zoneLedController: null,
      userService: { hydrateFitnessConfig: (d) => d },
      configService,
      contentRegistry: null,
      transcriptionService: null,
      enrichmentService,
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    });
    const local = express();
    local.use(express.json({ limit: '50mb' }));
    local.use((req, res, next) => { req.householdId = 'default'; next(); });
    local.use('/api/v1/fitness', router);

    const res = await request(local)
      .post('/api/v1/fitness/debug/voice-memo')
      .send({
        audioBase64: 'dGVzdA==',
        mimeType: 'audio/webm',
        sessionId: '20260423T000000',
        context: { householdId: 'default' }
      });

    expect(res.status).toBe(200);
    expect(enrichmentService.reEnrichDescription).not.toHaveBeenCalled();
  });
});
