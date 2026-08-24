import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createPianoRouter } from './piano.mjs';

function app({ policy, known = true }) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/piano', createPianoRouter({
    pianoContainer: {
      studioDatastore: { isKnownUser: () => known },
      composerSongStore: {},
    },
    pianoChallengePolicy: policy,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return server;
}

describe('piano challenge preparation API', () => {
  it('delegates semantic requirements to the injected pedagogy policy', async () => {
    const policy = {
      prepare: vi.fn(() => ({
        challenge_id: 'challenge-1', kind: 'scale',
        assessment: { mode: 'free', tempo_bpm: null, lead_in_ms: 0 },
        prompt: {
          label: 'G major scale',
          expected_events: [67, 69, 71].map((midi, index) => ({
            id: `event-${index}`, onsetQuarter: index, durationQuarters: 1,
            notes: [{ id: `note-${index}`, midi, hand: 'right' }],
          })),
        },
        timeout_ms: 90000,
        pedagogy_policy_version: 'exercise-bank-v2',
      })),
    };
    const response = await request(app({ policy }))
      .post('/api/v1/piano/users/guest/challenges/prepare')
      .send({
        challenge_id: 'challenge-1', kind: 'scale',
        requirements: { collection: 'major-scales' },
        context: { challenge_sequence: 1 },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      assessment: { mode: 'free' },
      prompt: { label: 'G major scale', expected_events: expect.any(Array) },
      pedagogy_policy_version: 'exercise-bank-v2',
    });
    expect(policy.prepare).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'guest',
      requirements: { collection: 'major-scales' },
    }));
  });

  it('rejects unknown users before invoking policy', async () => {
    const policy = { prepare: vi.fn() };
    const response = await request(app({ policy, known: false }))
      .post('/api/v1/piano/users/intruder/challenges/prepare')
      .send({ challenge_id: 'challenge-1', kind: 'scale' });
    expect(response.status).toBe(400);
    expect(policy.prepare).not.toHaveBeenCalled();
  });
});
