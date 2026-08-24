import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createPianoRouter } from './piano.mjs';

function subject() {
  const store = { save: vi.fn((_user, value) => value), list: vi.fn(() => []) };
  const server = express();
  server.use(express.json());
  server.use('/api/v1/piano', createPianoRouter({
    pianoContainer: { studioDatastore: { isKnownUser: () => true }, composerSongStore: {} },
    pianoAttemptStore: store,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return { server, store };
}

describe('piano attempt identity', () => {
  it('accepts an activity-only Learn practice write', async () => {
    const { server, store } = subject();
    const response = await request(server).post('/api/v1/piano/users/felix/attempts').send({
      activity_id: 'sheet:bach:measure-1:rh', purpose: 'practice', status: 'completed', score: 1,
      criteria: { completeness: 1, cleanliness: 1 },
      rubric: { id: 'sheet-learn-practice-v2', version: '2', weights: { completeness: 1, cleanliness: 1 }, part_weights: { rh: 1 } },
      verdict: { score: 1, passed: true, failed_criteria: [], failed_gates: [] },
      context: { surface: 'sheet-music-learn', matcher: 'cursor' },
    });
    expect(response.status).toBe(201);
    expect(store.save).toHaveBeenCalledWith('felix', expect.objectContaining({ activity_id: 'sheet:bach:measure-1:rh' }));
  });

  it('still rejects records without either stable identity', async () => {
    const { server } = subject();
    const response = await request(server).post('/api/v1/piano/users/felix/attempts').send({ status: 'completed', score: 1 });
    expect(response.status).toBe(400);
    expect(response.body.details.join(' ')).toMatch(/challenge_id or activity_id/);
  });
});
