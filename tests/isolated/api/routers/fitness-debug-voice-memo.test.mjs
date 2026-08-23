// tests/isolated/api/routers/fitness-debug-voice-memo.test.mjs
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createFitnessRouter } from '../../../../backend/src/4_api/v1/routers/fitness.mjs';
import { writeBinary } from '../../../../backend/src/0_system/utils/FileIO.mjs';

// NOTE: c2880857f "refactor(api/fitness): webhook policy + FS + household-id
// out of router (audit API-3)" (2026-07-07) moved this route's filesystem
// write behind an injected `voiceMemoDebugStore` provider (mirrors the real
// wiring in backend/src/5_composition/modules/fitnessApi.mjs) so the router
// itself no longer touches fs/path. This test was written 55c080b41
// (2026-04-23), before that refactor, and never supplied the provider, so
// every request 503'd on "Debug voice-memo store not configured". Added a
// real-filesystem-backed fake store here (same shape as the composition-root
// one) instead of relaxing the route.
const makeVoiceMemoDebugStore = (dataDir) => ({
  async save(buffer) {
    const savedAt = Date.now();
    const iso = new Date(savedAt).toISOString().replace(/:/g, '-');
    const filename = `${iso}.webm`;
    const filePath = path.join(dataDir, '_debug', 'voice_memos', filename);
    writeBinary(filePath, buffer);
    return { path: filePath, filename, size: buffer.length, savedAt };
  },
});

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
      voiceMemoDebugStore: makeVoiceMemoDebugStore(tmpDataDir),
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
      voiceMemoDebugStore: makeVoiceMemoDebugStore(tmpDataDir),
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
