import { describe, expect, it, vi } from 'vitest';
import {
  buildPianoAttemptEvidence,
  createPianoAttemptClient,
  pianoAssessmentTelemetry,
  pianoPersistenceOutcome,
} from './attemptEvidence.js';

describe('Piano attempt evidence', () => {
  it('builds activity-only practice evidence without inventing a challenge identity', () => {
    const evidence = buildPianoAttemptEvidence({
      result: { status: 'completed', score: 1, rubric: { id: 'learn-v2' } },
      activityId: 'sheet-learn:score:range:rh', kind: 'score', purpose: 'practice', providerVersion: 'learn-v2',
    });
    expect(evidence).toMatchObject({ activity_id: 'sheet-learn:score:range:rh', purpose: 'practice', grading_policy_version: 'learn-v2' });
    expect(evidence.challenge_id).toBeUndefined();
  });

  it('rejects identity-free or purpose-free evidence', () => {
    expect(() => buildPianoAttemptEvidence({ result: { status: 'completed' }, purpose: 'practice' })).toThrow(/challengeId or activityId/);
    expect(() => buildPianoAttemptEvidence({ result: { status: 'completed' }, activityId: 'a' })).toThrow(/purpose/);
  });

  it('returns an observable persistence outcome for both success and failure', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ attempt_id: 'saved' }) }));
    const ticks = [10, 34];
    const client = createPianoAttemptClient({ fetchImpl, now: () => ticks.shift() });
    await expect(client.record('kid one', { status: 'completed' }, { keepalive: true })).resolves.toMatchObject({ ok: true, status: 201, data: { attempt_id: 'saved' }, durationMs: 24 });
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/piano/users/kid%20one/attempts', expect.objectContaining({ keepalive: true }));
    await expect(createPianoAttemptClient({ fetchImpl: async () => { throw new Error('offline'); } }).record('kid', {}))
      .resolves.toMatchObject({ ok: false, status: 0, error: 'offline' });
  });

  it('classifies saved, rejected, failed, and skipped persistence consistently', () => {
    expect(pianoPersistenceOutcome({ ok: true, status: 201 })).toBe('saved');
    expect(pianoPersistenceOutcome({ status: 201 })).toBe('saved');
    expect(pianoPersistenceOutcome({ ok: false, status: 400 })).toBe('rejected');
    expect(pianoPersistenceOutcome({ ok: false, status: 503 })).toBe('failed');
    expect(pianoPersistenceOutcome({ skipped: 'guest' })).toBe('skipped-guest');
  });

  it('summarizes assessment and persistence without carrying musical input', () => {
    const summary = pianoAssessmentTelemetry({
      status: 'completed', attempt_id: 'attempt-1', activity_id: 'learn:1', purpose: 'practice', provider_version: 'learn-runtime-v2',
      context: { surface: 'learn', matcher: 'cursor', mode: 'free' },
      score: 0.9, criteria: { completeness: 1 }, gates: { pace: { passed: false, actual: 92, target: 100 } },
      diagnostics: { expected_notes: 10, matched_notes: 10, wrong_notes: 1, missed_notes: 0, response_median_ms: 400 },
      rubric: { id: 'learn-v2', version: '2', part_weights: { rh: 1 } }, verdict: { passed: false, failed_criteria: [], failed_gates: ['pace'] },
      wrong: [{ midi: 61 }],
    }, { outcome: 'saved', status: 201, durationMs: 25 });
    expect(summary).toMatchObject({
      surface: 'learn', terminalStatus: 'completed', persistence: 'saved', attemptId: 'attempt-1',
      activityId: 'learn:1', purpose: 'practice', rubricId: 'learn-v2', rubricVersion: '2', providerVersion: 'learn-runtime-v2',
      score: 0.9, passed: false, gates: { pace: { passed: false, actual: 92, target: 100 } },
      expectedNotes: 10, matchedNotes: 10, wrongNotes: 1, missedNotes: 0, responseMedianMs: 400, persistenceDurationMs: 25,
    });
    expect(summary.wrong).toBeUndefined();
  });
});
