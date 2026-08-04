import { describe, expect, it } from 'vitest';
import { createLearningProbeEvidence } from './learningProbeEvidence.mjs';

const base = {
  evidenceId: 'probe-result:feedback:1', learnerId: 'kid-a',
  occurredAt: '2026-08-02T12:00:00.000Z', event: 'feedback_viewed',
  activity: { id: 'rates/check', sessionId: 'probe-1', itemId: 'q1' },
  learning: { courseId: 'finance', lessonId: 'rates', moduleId: 'check' },
  attemptNumber: 1,
  source: { surface: 'calculator', transport: 'relay', deviceId: 'SCABC123' },
};

describe('learning probe evidence', () => {
  it('keeps feedback and continuation separate from academic responses', () => {
    const feedback = createLearningProbeEvidence(base);
    const continuation = createLearningProbeEvidence({
      ...base, evidenceId: 'probe-result:continuation:1', event: 'continuation',
      continuation: 'retry',
    });
    expect(feedback).toMatchObject({
      verification: 'self_reported',
      activity: { kind: 'learning_probe_feedback_viewed', attemptNumber: 1, graded: false },
      measures: { engagements: 1, responses: 0, correct: 0 },
    });
    expect(continuation.activity).toMatchObject({
      kind: 'learning_probe_continuation', action: 'retry', graded: false,
    });
  });

  it('records retry accuracy without changing an earlier response event', () => {
    const retry = createLearningProbeEvidence({
      ...base, evidenceId: 'probe-result:response:2', event: 'response',
      attemptNumber: 2, correct: true,
    });
    expect(retry).toMatchObject({
      verification: 'verified',
      activity: { kind: 'learning_probe_response', attemptNumber: 2, graded: true },
      measures: { responses: 1, correct: 1 },
    });
  });

  it('rejects score claims on feedback and missing continuation choices', () => {
    expect(() => createLearningProbeEvidence({ ...base, correct: false })).toThrow(/cannot carry correctness/);
    expect(() => createLearningProbeEvidence({
      ...base, event: 'continuation', evidenceId: 'x',
    })).toThrow(/continuation must be/);
  });
});
