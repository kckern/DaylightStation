import { describe, expect, it, vi } from 'vitest';
import { RecordLearningProbeInteraction } from './RecordLearningProbeInteraction.mjs';

function fixture() {
  const evidenceRepository = {
    appendEvidence: vi.fn(async (evidence) => ({ status: 'recorded', evidence })),
    listEvidence: vi.fn(async () => []),
  };
  return {
    evidenceRepository,
    useCase: new RecordLearningProbeInteraction({
      evidenceRepository,
      learnerDirectory: { hasLearner: async (id) => id === 'kid-a' },
      evidenceIdFactory: ({ observationId }) => `probe:${observationId}`,
      clock: () => new Date('2026-08-02T12:00:00.000Z'),
    }),
  };
}

describe('RecordLearningProbeInteraction', () => {
  it('records a client-retry-stable continuation without academic score data', async () => {
    const { useCase, evidenceRepository } = fixture();
    const result = await useCase.execute({
      observationId: 'ses-1:q1:1:continuation', learnerId: 'kid-a',
      event: 'continuation', attemptNumber: 1, continuation: 'retry',
      activity: { id: 'rates/check', sessionId: 'ses-1', itemId: 'q1' },
      learning: { courseId: 'finance', moduleId: 'check' },
    });
    expect(result).toMatchObject({ status: 'recorded', evidence: {
      evidenceId: 'probe:ses-1:q1:1:continuation',
      activity: { kind: 'learning_probe_continuation', action: 'retry' },
      measures: { responses: 0, correct: 0 },
    } });
    expect(evidenceRepository.appendEvidence).toHaveBeenCalledOnce();
  });

  it('rejects an unbound learner before persistence', async () => {
    const { useCase, evidenceRepository } = fixture();
    await expect(useCase.execute({
      observationId: 'x', learnerId: 'unknown', event: 'feedback_viewed',
      attemptNumber: 1, activity: { id: 'probe' },
    })).rejects.toThrow(/active learner/);
    expect(evidenceRepository.appendEvidence).not.toHaveBeenCalled();
  });

  it('reuses the first receipt time so a delayed network retry is an exact duplicate', async () => {
    let saved = null;
    let tick = 0;
    const evidenceRepository = {
      listEvidence: vi.fn(async () => saved ? [saved] : []),
      appendEvidence: vi.fn(async (evidence) => {
        if (saved) return { status: 'duplicate', evidence: saved };
        saved = evidence;
        return { status: 'recorded', evidence };
      }),
    };
    const useCase = new RecordLearningProbeInteraction({
      evidenceRepository,
      learnerDirectory: { hasLearner: async () => true },
      evidenceIdFactory: ({ observationId }) => `probe:${observationId}`,
      clock: () => new Date(`2026-08-02T12:00:0${tick++}.000Z`),
    });
    const command = {
      observationId: 'stable-feedback', learnerId: 'kid-a', event: 'feedback_viewed',
      attemptNumber: 1, activity: { id: 'probe' },
    };
    expect((await useCase.execute(command)).status).toBe('recorded');
    expect((await useCase.execute(command)).status).toBe('duplicate');
    expect(evidenceRepository.appendEvidence.mock.calls[1][0].occurredAt)
      .toBe(evidenceRepository.appendEvidence.mock.calls[0][0].occurredAt);
  });
});
