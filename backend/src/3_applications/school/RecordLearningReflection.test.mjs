import { describe, expect, it, vi } from 'vitest';
import { RecordLearningReflection } from './RecordLearningReflection.mjs';

function fixture(overrides = {}) {
  const evidenceRepository = {
    appendEvidence: vi.fn(async (evidence) => ({ status: 'recorded', evidence })),
    listEvidence: vi.fn(async () => []),
  };
  const learnerDirectory = { hasLearner: vi.fn(async (id) => id === 'kid-a') };
  return {
    evidenceRepository,
    useCase: new RecordLearningReflection({
      evidenceRepository,
      learnerDirectory,
      evidenceIdFactory: () => 'reflection-1',
      clock: () => new Date('2026-08-02T12:00:00.000Z'),
      ...overrides,
    }),
  };
}

describe('RecordLearningReflection', () => {
  it('records optional self-regulation evidence without academic responses or correctness', async () => {
    const { useCase, evidenceRepository } = fixture();
    const result = await useCase.execute({
      observationId: 'quiz-1:self-reflection',
      learnerId: 'kid-a',
      activity: { id: 'fractions-check', sessionId: 'quiz-1' },
      learning: { courseId: 'fractions', conceptIds: ['equivalence'] },
      selfRegulation: {
        phase: 'self_reflection', confidence: 2, selfAssessment: 'uncertain',
        errorCategoryId: 'sign-error', strategyIds: ['draw-model'],
        nextAction: { type: 'lesson', id: 'equivalent-fractions-review' },
      },
      source: { surface: 'web', transport: 'screen' },
    });

    expect(result).toMatchObject({
      status: 'recorded',
      evidence: {
        evidenceId: 'reflection-1', verification: 'self_reported',
        activity: { kind: 'reflection', graded: false },
        measures: { engagements: 1, responses: 0, correct: 0 },
        selfRegulation: { confidence: 2 },
      },
    });
    expect(evidenceRepository.appendEvidence).toHaveBeenCalledOnce();
  });

  it('rejects a learner outside the configured School roster', async () => {
    const { useCase, evidenceRepository } = fixture();
    await expect(useCase.execute({ observationId: 'adult-reflection', learnerId: 'adult' })).rejects.toThrow(/active learner/);
    expect(evidenceRepository.appendEvidence).not.toHaveBeenCalled();
  });

  it('maps malformed reflection input to an application validation error', async () => {
    const { useCase } = fixture();
    await expect(useCase.execute({
      observationId: 'quiz-reflection', learnerId: 'kid-a', activity: { id: 'quiz' },
      selfRegulation: { phase: 'self_reflection', abilityTier: 'low' },
    })).rejects.toThrow(/unknown fields abilityTier/);
  });

  it('reuses the first receipt time so a delayed retry is an exact duplicate', async () => {
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
    const useCase = new RecordLearningReflection({
      evidenceRepository,
      learnerDirectory: { hasLearner: async () => true },
      evidenceIdFactory: () => 'reflection-stable',
      clock: () => new Date(`2026-08-02T12:00:0${tick++}.000Z`),
    });
    const command = {
      observationId: 'quiz:self-reflection', learnerId: 'kid-a',
      activity: { id: 'quiz' },
      selfRegulation: { phase: 'self_reflection', confidence: 3 },
      source: { surface: 'web', transport: 'screen' },
    };
    expect((await useCase.execute(command)).status).toBe('recorded');
    expect((await useCase.execute(command)).status).toBe('duplicate');
    expect(evidenceRepository.appendEvidence.mock.calls[1][0].occurredAt)
      .toBe(evidenceRepository.appendEvidence.mock.calls[0][0].occurredAt);
  });
});
