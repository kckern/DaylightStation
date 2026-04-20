import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWeeklyReviewRouter } from '../../../../../../src/4_api/v1/routers/weekly-review.mjs';

describe('weekly-review chunk router', () => {
  let mockService;
  let app;

  beforeEach(() => {
    mockService = {
      appendChunk: vi.fn().mockResolvedValue({ ok: true, bytesWritten: 10, totalBytes: 10, nextSeq: 1 }),
      listDrafts: vi.fn().mockResolvedValue([]),
      finalizeDraft: vi.fn().mockResolvedValue({ ok: true, transcript: { raw: 'r', clean: 'c', duration: 5 } }),
      discardDraft: vi.fn().mockResolvedValue({ ok: true, existed: true }),
      bootstrap: vi.fn(),
      saveRecording: vi.fn(),
    };
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    app = express();
    app.use(express.json({ limit: '20mb' }));
    app.use('/', createWeeklyReviewRouter({ weeklyReviewService: mockService, logger }));
  });

  it('POST /recording/chunk forwards to appendChunk with decoded buffer', async () => {
    const buf = Buffer.from('hello');
    const res = await request(app)
      .post('/recording/chunk')
      .send({ sessionId: 'sess-aaaaaaaa', seq: 0, week: '2026-04-12', chunkBase64: buf.toString('base64') });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockService.appendChunk).toHaveBeenCalledTimes(1);
    const arg = mockService.appendChunk.mock.calls[0][0];
    expect(arg.sessionId).toBe('sess-aaaaaaaa');
    expect(arg.seq).toBe(0);
    expect(arg.week).toBe('2026-04-12');
    expect(Buffer.isBuffer(arg.buffer)).toBe(true);
    expect(arg.buffer.toString()).toBe('hello');
  });

  it('POST /recording/chunk returns 400 when chunkBase64 missing', async () => {
    const res = await request(app)
      .post('/recording/chunk')
      .send({ sessionId: 'sess-aaaaaaaa', seq: 0, week: '2026-04-12' });
    expect(res.status).toBe(400);
  });

  it('POST /recording/chunk returns 409 on out-of-order error', async () => {
    mockService.appendChunk.mockRejectedValueOnce(new Error('out-of-order chunk: expected 1, got 3'));
    const res = await request(app)
      .post('/recording/chunk')
      .send({ sessionId: 'sess-aaaaaaaa', seq: 3, week: '2026-04-12', chunkBase64: 'QUFB' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/out-of-order/);
  });

  it('GET /recording/drafts lists drafts for a week', async () => {
    mockService.listDrafts.mockResolvedValueOnce([
      { sessionId: 'sess-aaaaaaaa', week: '2026-04-12', seq: 5, totalBytes: 12345, startedAt: '2026-04-19T10:00:00Z', updatedAt: '2026-04-19T10:01:00Z' },
    ]);
    const res = await request(app).get('/recording/drafts?week=2026-04-12');
    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0].sessionId).toBe('sess-aaaaaaaa');
    expect(mockService.listDrafts).toHaveBeenCalledWith('2026-04-12');
  });

  it('POST /recording/finalize forwards sessionId/week/duration', async () => {
    const res = await request(app)
      .post('/recording/finalize')
      .send({ sessionId: 'sess-aaaaaaaa', week: '2026-04-12', duration: 120 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockService.finalizeDraft).toHaveBeenCalledWith({ sessionId: 'sess-aaaaaaaa', week: '2026-04-12', duration: 120 });
  });

  it('DELETE /recording/drafts/:sessionId discards the draft', async () => {
    const res = await request(app)
      .delete('/recording/drafts/sess-aaaaaaaa')
      .query({ week: '2026-04-12' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockService.discardDraft).toHaveBeenCalledWith({ sessionId: 'sess-aaaaaaaa', week: '2026-04-12' });
  });
});
