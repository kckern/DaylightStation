import { describe, expect, it, vi } from 'vitest';
import { ImportSchoolCalcResult } from './ImportSchoolCalcResult.mjs';

function bank() {
  return {
    id: 'algebra-check',
    title: 'Algebra check',
    audience: 'assigned',
    items: [
      {
        id: 'equation-1',
        type: 'multiple_choice',
        prompt: 'Solve x + 1 = 3',
        choices: ['1', '2', '3'],
        answer: '2',
      },
    ],
  };
}

function artifact(overrides = {}) {
  return {
    artifactId: 'sc:future:ARTIFACT01',
    platformId: 'future',
    interpretation: {
      schema: 'school.calc.artifact-interpretation/v1',
      bundle: {
        lesson: {
          lessonId: 'linear-equations',
          modules: [{ moduleId: 'check', type: 'quiz', bankId: 'algebra-check', bank: bank() }],
        },
      },
    },
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    schema: 'school.calc.result/v1',
    deviceId: 'DEVICE01',
    sequence: 7,
    learnerKey: 4,
    artifactId: 'sc:future:ARTIFACT01',
    moduleIndex: 0,
    kind: 'responses',
    responses: [{ itemIndex: 0, given: 2 }],
    localScore: { correct: 1, total: 1, percent: 100 },
    recordDigest: 'digest-a',
    ...overrides,
  };
}

class MemoryLedger {
  entries = new Map();
  arrivals = [];

  async claimResult({ deviceId, sequence, recordDigest }) {
    const key = `${deviceId}:${sequence}`;
    const prior = this.entries.get(key);
    if (!prior) {
      const entry = { recordDigest, complete: false, state: null };
      this.entries.set(key, entry);
      return { status: 'new', entry: structuredClone(entry) };
    }
    if (prior.recordDigest !== recordDigest) return { status: 'conflict', entry: structuredClone(prior) };
    return { status: prior.complete ? 'duplicate' : 'resume', entry: structuredClone(prior) };
  }

  async recordArrival(arrival) { this.arrivals.push(structuredClone(arrival)); }

  async saveImportState({ deviceId, sequence, state }) {
    const entry = this.entries.get(`${deviceId}:${sequence}`);
    entry.state = structuredClone(state);
    entry.complete = state.status === 'complete';
  }

  async listAcknowledgedSequences(deviceId) {
    return [...this.entries.entries()]
      .filter(([key, entry]) => key.startsWith(`${deviceId}:`) && entry.complete)
      .map(([key]) => Number(key.split(':').at(-1)));
  }
}

function harness({
  device = {}, storedArtifact = artifact(),
  clock = () => new Date('2026-08-01T15:00:00.000Z'),
  remediationOffers = null,
  probeEvidenceRepository = null,
  studySessions = null,
  studyOutcomes = null,
} = {}) {
  const codec = { platformId: 'future' };
  const ledger = new MemoryLedger();
  const grader = { importSchoolCalcAssessment: vi.fn(async () => ({ imported: 1, correct: 1, total: 1 })) };
  const progress = { saveLatest: vi.fn(async (entry) => ({ status: 'accepted', progress: entry })) };
  const importer = new ImportSchoolCalcResult({
    codecs: { decodeResult: (record) => ({ codec, result: structuredClone(record) }) },
    devices: {
      getDevice: async (deviceId) => (deviceId === 'DEVICE01'
        ? {
          deviceId, platformId: 'future',
          resolveLearnerKey: (learnerKey) => (learnerKey === 4
            ? { learnerKey: 4, learnerId: 'learner-a', active: true }
            : null),
          ...device,
        }
        : null),
    },
    artifacts: { getArtifact: async (id) => (id === storedArtifact?.artifactId ? storedArtifact : null) },
    ledger,
    grader,
    progress,
    remediationOffers,
    probeEvidenceRepository,
    studySessions,
    studyOutcomes,
    clock,
  });
  return { importer, grader, progress, ledger };
}

describe('ImportSchoolCalcResult', () => {
  it('validates adaptive telemetry, settles ordinary work, and closes the code on first acceptance', async () => {
    const quizArtifact = artifact({
      interpretation: {
        schema: 'school.calc.artifact-interpretation/v1',
        bundle: { lesson: {
          lessonId: 'adaptive-linear',
          modules: [
            { moduleId: 'adaptive-study', type: 'flashcards', bank: bank() },
            { moduleId: 'adaptive-quiz', type: 'quiz', bank: bank() },
          ],
        } },
      },
    });
    const session = {
      studySessionId: 'study-one', workSessionId: 'work-one', learnerId: 'learner-a', status: 'open',
      artifact: { artifactId: quizArtifact.artifactId },
      resolution: { deviceId: 'DEVICE01', learnerKey: 4 },
      curation: { policy: { cardCount: 1, itemCount: 1, maxExposuresPerCard: 4, passingPercent: 80 } },
    };
    const studySessions = {
      getByCode: vi.fn(async () => session),
      close: vi.fn(async () => ({ status: 'accepted' })),
    };
    const studyOutcomes = { execute: vi.fn(async () => ({ status: 'settled', result: 'passed', percent: 100 })) };
    const { importer } = harness({ storedArtifact: quizArtifact, studySessions, studyOutcomes });
    const adaptive = result({
      moduleIndex: 1,
      adaptiveStudy: {
        sessionCode: '001234', attemptCount: 2,
        cards: [{ rating: 'know', exposureCount: 1 }], quizChoices: [2],
      },
    });
    await expect(importer.execute({ record: adaptive, transport: 'qr' })).resolves.toMatchObject({
      status: 'accepted', outcome: { study: { result: 'passed' } },
    });
    expect(studyOutcomes.execute).toHaveBeenCalledWith(expect.objectContaining({
      studySession: session, percent: 100, passingPercent: 80,
    }));
    expect(studySessions.close).toHaveBeenCalledWith(expect.objectContaining({
      studySessionId: 'study-one', resultDigest: 'digest-a', outcome: 'passed',
    }));
  });

  it('rejects unresolved final cards below their authored exposure cap', async () => {
    const quizArtifact = artifact({ interpretation: {
      schema: 'school.calc.artifact-interpretation/v1',
      bundle: { lesson: { lessonId: 'adaptive', modules: [
        { moduleId: 'study', type: 'flashcards', bank: bank() },
        { moduleId: 'quiz', type: 'quiz', bank: bank() },
      ] } },
    } });
    const studySessions = { getByCode: async () => ({
      studySessionId: 'study-one', learnerId: 'learner-a', status: 'open',
      artifact: { artifactId: quizArtifact.artifactId }, resolution: { deviceId: 'DEVICE01', learnerKey: 4 },
      curation: { policy: { cardCount: 1, itemCount: 1, maxExposuresPerCard: 4, passingPercent: 80 } },
    }) };
    const { importer, ledger } = harness({
      storedArtifact: quizArtifact, studySessions, studyOutcomes: { execute: vi.fn() },
    });
    await expect(importer.execute({ record: result({
      moduleIndex: 1,
      adaptiveStudy: {
        sessionCode: '001234', attemptCount: 1,
        cards: [{ rating: 'hard', exposureCount: 3 }], quizChoices: [2],
      },
    }), transport: 'relay' })).rejects.toThrow(/invalid final telemetry/);
    expect(ledger.entries.size).toBe(0);
  });

  it('imports QR and cable through one idempotency identity and grades the exact artifact snapshot', async () => {
    const { importer, grader, ledger } = harness();
    const first = await importer.execute({ record: result(), transport: 'qr' });
    const retry = await importer.execute({ record: result(), transport: 'relay' });

    expect(first).toMatchObject({ status: 'accepted', acknowledge: true, deviceId: 'DEVICE01', sequence: 7 });
    expect(retry).toMatchObject({ status: 'duplicate', acknowledge: true });
    expect(grader.importSchoolCalcAssessment).toHaveBeenCalledTimes(1);
    expect(grader.importSchoolCalcAssessment).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'learner-a',
      mode: 'quiz',
      recordDigest: 'digest-a',
      receivedAt: '2026-08-01T15:00:00.000Z',
      submission: expect.objectContaining({
        lessonId: 'linear-equations',
        moduleId: 'check',
        responses: [{ itemId: 'equation-1', given: '2' }],
      }),
      bankSnapshot: expect.objectContaining({ id: 'algebra-check' }),
    }));
    expect(grader.importSchoolCalcAssessment.mock.calls[0][0].submission).not.toHaveProperty('_module');
    expect(ledger.arrivals).toEqual([
      expect.objectContaining({ transport: 'qr', receivedAt: '2026-08-01T15:00:00.000Z' }),
      expect.objectContaining({ transport: 'relay', receivedAt: '2026-08-01T15:00:00.000Z' }),
    ]);
    await expect(ledger.listAcknowledgedSequences('DEVICE01')).resolves.toEqual([7]);
  });

  it('never acknowledges a changed payload claiming an existing device sequence', async () => {
    const { importer, grader, ledger } = harness();
    await importer.execute({ record: result(), transport: 'qr' });
    const collision = await importer.execute({
      record: result({
        recordDigest: 'digest-b',
        responses: [{ itemIndex: 0, given: 1 }],
        localScore: { correct: 0, total: 1, percent: 0 },
      }),
      transport: 'relay',
    });

    expect(collision).toMatchObject({ status: 'conflict', acknowledge: false });
    expect(grader.importSchoolCalcAssessment).toHaveBeenCalledTimes(1);
    expect(ledger.arrivals).toHaveLength(2);
  });

  it('creates and durably replays remediation metadata before acknowledging a failed quiz', async () => {
    const remediationOffers = { execute: vi.fn(async (input) => ({
      status: 'offered', offer: { sessionId: 'rem_ABC123', launch: 'offer' },
      input: { source: input.source, responses: input.responses },
    })) };
    const { importer } = harness({ remediationOffers });
    const failedRecord = result({
      responses: [{ itemIndex: 0, given: 1 }],
      localScore: { correct: 0, total: 1, percent: 0 },
    });
    const first = await importer.execute({ record: failedRecord, transport: 'relay' });
    const duplicate = await importer.execute({ record: failedRecord, transport: 'qr' });

    expect(first.remediation).toMatchObject({ status: 'offered', offer: { sessionId: 'rem_ABC123' } });
    expect(duplicate.remediation).toEqual(first.remediation);
    expect(remediationOffers.execute).toHaveBeenCalledTimes(1);
    expect(remediationOffers.execute).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'learner-a',
      source: expect.objectContaining({
        surface: 'schoolcalc', learnerKey: 4,
        externalId: 'DEVICE01:7', moduleId: 'check',
      }),
      lesson: expect.objectContaining({ lessonId: 'linear-equations' }),
      module: expect.objectContaining({ moduleId: 'check', type: 'quiz' }),
      responses: [{ itemId: 'equation-1', given: '1' }],
    }));
  });

  it('imports progress through the same record and ledger path without invoking assessment grading', async () => {
    const { importer, grader, progress } = harness();
    const outcome = await importer.execute({
      record: result({
        kind: 'progress',
        responses: undefined,
        localScore: undefined,
        progress: { status: 'viewed', position: 3, total: 8 },
      }),
      transport: 'relay',
    });

    expect(outcome).toMatchObject({ status: 'accepted', acknowledge: true });
    expect(grader.importSchoolCalcAssessment).not.toHaveBeenCalled();
    expect(progress.saveLatest).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'learner-a',
      lessonId: 'linear-equations',
      moduleId: 'check',
      progress: { status: 'viewed', position: 3, total: 8 },
      timeBasis: 'backend_received',
      recordedAt: '2026-08-01T15:00:00.000Z',
    }));
  });

  it('keeps a learning probe first score intact while recording retry, feedback, and continuation separately', async () => {
    const probeBank = bank();
    probeBank.items[0].feedback = { explanation: 'Undo addition before dividing.' };
    const probeArtifact = artifact({
      interpretation: {
        schema: 'school.calc.artifact-interpretation/v1',
        bundle: {
          context: { course: { courseId: 'algebra' }, unit: { unitId: 'linear' } },
          lesson: {
            lessonId: 'linear-equations',
            modules: [{
              moduleId: 'probe', type: 'learning_probe', bankId: 'algebra-check',
              conceptIds: ['inverse-operations'], bank: probeBank,
            }],
          },
        },
      },
    });
    const saved = [];
    const probeEvidenceRepository = {
      appendEvidence: vi.fn(async (evidence) => {
        saved.push(evidence);
        return { status: 'recorded', evidence };
      }),
    };
    const { importer, grader } = harness({ storedArtifact: probeArtifact, probeEvidenceRepository });
    const outcome = await importer.execute({
      record: result({
        moduleIndex: 0,
        responses: [{
          itemIndex: 0, given: 1,
          probe: { attempts: [1, 2], feedbackViewed: true, continued: true },
        }],
        localScore: { correct: 0, total: 1, percent: 0 },
      }),
      transport: 'relay',
    });

    expect(outcome).toMatchObject({
      status: 'accepted',
      localScore: { correct: 0, total: 1, percent: 0 },
      outcome: {
        score: { correct: 0, total: 1, percent: 0, verified: true },
        probeEvidence: { eventCount: 5, recordedCount: 5, duplicateCount: 0 },
      },
    });
    expect(grader.importSchoolCalcAssessment).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'learning_probe',
      submission: expect.objectContaining({
        responses: [{
          itemId: 'equation-1', given: '1',
          probe: { attempts: ['1', '2'], feedbackViewed: true, continued: true },
        }],
      }),
    }));
    expect(saved.map(({ activity }) => [activity.kind, activity.attemptNumber, activity.action ?? null]))
      .toEqual([
        ['learning_probe_feedback_viewed', 1, null],
        ['learning_probe_continuation', 1, 'retry'],
        ['learning_probe_response', 2, null],
        ['learning_probe_feedback_viewed', 2, null],
        ['learning_probe_continuation', 2, 'continue'],
      ]);
    expect(saved.find(({ activity }) => activity.kind === 'learning_probe_response').measures.correct).toBe(1);
  });

  it('rejects a forged or stale local score before claiming or grading it', async () => {
    const { importer, grader, ledger } = harness();
    await expect(importer.execute({
      record: result({ localScore: { correct: 0, total: 1, percent: 0 } }),
      transport: 'qr',
    })).rejects.toThrow(/does not match the immutable answer key/);
    expect(ledger.entries.size).toBe(0);
    expect(grader.importSchoolCalcAssessment).not.toHaveBeenCalled();
  });

  it('records each arrival time but preserves the first import time across interruption', async () => {
    const times = [
      new Date('2026-08-01T15:00:00.000Z'),
      new Date('2026-08-03T09:30:00.000Z'),
    ];
    const { importer, grader, ledger } = harness({ clock: () => times.shift() });
    grader.importSchoolCalcAssessment
      .mockRejectedValueOnce(new Error('simulated interruption'))
      .mockResolvedValueOnce({ imported: 1, correct: 1, total: 1 });

    await expect(importer.execute({ record: result(), transport: 'qr' }))
      .rejects.toThrow(/simulated interruption/);
    const resumed = await importer.execute({ record: result(), transport: 'relay' });

    expect(resumed).toMatchObject({
      status: 'accepted', resumed: true, receivedAt: '2026-08-03T09:30:00.000Z',
    });
    expect(grader.importSchoolCalcAssessment.mock.calls[1][0].receivedAt)
      .toBe('2026-08-01T15:00:00.000Z');
    expect(ledger.arrivals.map((entry) => entry.receivedAt)).toEqual([
      '2026-08-01T15:00:00.000Z',
      '2026-08-03T09:30:00.000Z',
    ]);
    expect(ledger.entries.get('DEVICE01:7').state).toMatchObject({
      status: 'complete',
      startedAt: '2026-08-01T15:00:00.000Z',
      completedAt: '2026-08-03T09:30:00.000Z',
    });
  });

  it('fails closed before claiming records with unresolved authority or artifact positions', async () => {
    const noLearner = harness({ device: { resolveLearnerKey: () => null } });
    await expect(noLearner.importer.execute({ record: result(), transport: 'qr' }))
      .rejects.toThrow(/learnerKey 4 is not bound/);
    expect(noLearner.ledger.entries.size).toBe(0);

    const wrongModule = harness();
    await expect(wrongModule.importer.execute({
      record: result({ moduleIndex: 9 }), transport: 'relay',
    })).rejects.toThrow(/moduleIndex 9/);
    expect(wrongModule.ledger.entries.size).toBe(0);

    const wrongItem = harness();
    await expect(wrongItem.importer.execute({
      record: result({ responses: [{ itemIndex: 9, given: 1 }] }), transport: 'relay',
    })).rejects.toThrow(/itemIndex 9/);
    expect(wrongItem.ledger.entries.size).toBe(0);

    const wrongChoice = harness();
    await expect(wrongChoice.importer.execute({
      record: result({ responses: [{ itemIndex: 0, given: 9 }] }), transport: 'relay',
    })).rejects.toThrow(/choice 9/);
    expect(wrongChoice.ledger.entries.size).toBe(0);
  });

  it('uses the result-time key even after that learner leaves the active roster', async () => {
    const { importer, grader } = harness({
      device: {
        resolveLearnerKey: (learnerKey) => (learnerKey === 4
          ? { learnerKey: 4, learnerId: 'learner-retired', active: false }
          : null),
      },
    });
    const outcome = await importer.execute({ record: result(), transport: 'relay' });
    expect(outcome).toMatchObject({ learnerKey: 4, learnerId: 'learner-retired', status: 'accepted' });
    expect(grader.importSchoolCalcAssessment).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'learner-retired',
    }));
  });
});
