// @vitest-environment node
// camera.clips.test.mjs
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createCameraRouter } from './camera.mjs';
import { InvalidInputError } from '#apps/common/errors/SemanticErrors.mjs';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

const app = (cameraService) => { const a = express(); a.use('/camera', createCameraRouter({ cameraService, cameraEvents: { publish: vi.fn() }, logger: { error: vi.fn(), warn: vi.fn() } })); a.use(errorHandlerMiddleware()); return a; };
const service = (over = {}) => ({ hasCamera: (id) => id === 'doorbell', listClips: vi.fn(async (id, day) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new InvalidInputError('day must be YYYY-MM-DD'); return []; }), getClip: vi.fn(), ...over });

describe('camera clip routes', () => {
  it('lists a day of clips', async () => {
    const s = service({ listClips: vi.fn().mockResolvedValue([{ start: 'a', end: 'b', name: 'n', labels: [] }]) });
    const r = await request(app(s)).get('/camera/doorbell/clips?day=2026-10-28');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ camera: 'doorbell', day: '2026-10-28', clips: [{ start: 'a', end: 'b', name: 'n', labels: [] }] });
  });
  it('rejects a bad day and an unknown camera', async () => {
    expect((await request(app(service())).get('/camera/doorbell/clips?day=yesterday')).status).toBe(400);
    expect((await request(app(service())).get('/camera/garage/clips?day=2026-10-28')).status).toBe(404);
  });
  it('answers 502 when the clip cannot be fetched', async () => {
    const s = service({ getClip: vi.fn().mockRejectedValue(new Error('Download HTTP 500')) });
    expect((await request(app(s)).get('/camera/doorbell/clips/file?name=Mp4Record/2026-10-28/a.mp4')).status).toBe(502);
  });
});
