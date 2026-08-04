import { describe, expect, it } from 'vitest';
import { SchoolService } from './SchoolService.mjs';

function assessmentBank(answer = 'old-answer') {
  return {
    id: 'offline-bank',
    title: 'Offline bank',
    audience: 'assigned',
    items: [{
      id: 'item-1',
      type: 'multiple_choice',
      prompt: 'Which answer did the downloaded lesson define?',
      choices: ['old-answer', 'new-answer'],
      answer,
    }],
  };
}

function submission(given = 'old-answer') {
  return {
    schema: 'school.calc.submission/v1',
    kind: 'responses',
    deviceId: 'DEVICE01',
    learnerKey: 4,
    sequence: 9,
    artifactId: 'artifact-old',
    lessonId: 'lesson-1',
    moduleId: 'quiz-1',
    responses: [{ itemId: 'item-1', given }],
    localScore: {
      correct: given === 'old-answer' ? 1 : 0,
      total: 1,
      percent: given === 'old-answer' ? 100 : 0,
      basis: 'embedded_answer_key',
    },
  };
}

const RECEIVED_AT = '2026-08-01T15:00:00.000Z';

function harness() {
  const attempts = [];
  const datastore = {
    // Deliberately represents a later content edit. SchoolCalc import must not
    // load it when interpreting an old immutable artifact.
    readBankRaw: () => assessmentBank('new-answer'),
    readAllBankRaws: async () => [],
    readAllAttempts: () => attempts,
    appendAttempt: (_learnerId, attempt) => { attempts.push(attempt); return { ok: true }; },
    readQuizRequests: () => [],
  };
  const userService = {
    getProfile: (id) => (id === 'learner-a' ? { id } : null),
    getHouseholdRoster: () => [{ id: 'learner-a' }],
  };
  const service = new SchoolService({
    datastore,
    userService,
    logger: { info() {}, warn() {}, error() {} },
    now: () => 1_000,
  });
  return { service, attempts };
}

describe('SchoolService SchoolCalc import', () => {
  it('grades against the immutable downloaded bank and resumes without duplicate attempts', () => {
    const { service, attempts } = harness();
    const input = {
      learnerId: 'learner-a',
      submission: submission(),
      bankSnapshot: assessmentBank('old-answer'),
      mode: 'quiz',
      recordDigest: 'digest-a',
      receivedAt: RECEIVED_AT,
    };

    expect(service.importSchoolCalcAssessment(input)).toMatchObject({ imported: 1, correct: 1, total: 1 });
    expect(service.importSchoolCalcAssessment(input)).toMatchObject({ imported: 0, duplicateItems: 1 });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      bankId: 'offline-bank',
      mode: 'quiz',
      given: 'old-answer',
      correct: true,
      transport: 'calculator',
      at: RECEIVED_AT,
      provenance: {
        schoolCalc: {
          resultId: 'DEVICE01:9', recordDigest: 'digest-a', timeBasis: 'backend_received',
        },
      },
    });
  });

  it('rejects a changed digest for the same device-global sequence', () => {
    const { service } = harness();
    service.importSchoolCalcAssessment({
      learnerId: 'learner-a', submission: submission(), bankSnapshot: assessmentBank(), mode: 'quiz', recordDigest: 'digest-a', receivedAt: RECEIVED_AT,
    });
    expect(() => service.importSchoolCalcAssessment({
      learnerId: 'learner-a', submission: submission(), bankSnapshot: assessmentBank(), mode: 'quiz', recordDigest: 'digest-b', receivedAt: RECEIVED_AT,
    })).toThrow(/result collision/);
  });

  it('records flashcard self-grades without treating revealed answers as submitted answers', () => {
    const { service, attempts } = harness();
    service.importSchoolCalcAssessment({
      learnerId: 'learner-a',
      submission: submission(false),
      bankSnapshot: assessmentBank(),
      mode: 'flashcard',
      recordDigest: 'digest-flash',
      receivedAt: RECEIVED_AT,
    });
    expect(attempts[0]).toMatchObject({ mode: 'flashcard', given: null, correct: false });
  });

  it('rejects missing or non-canonical calculator import receipt time', () => {
    const { service } = harness();
    const input = {
      learnerId: 'learner-a', submission: submission(), bankSnapshot: assessmentBank(),
      mode: 'quiz', recordDigest: 'digest-a',
    };
    expect(() => service.importSchoolCalcAssessment(input)).toThrow(/receivedAt/);
    expect(() => service.importSchoolCalcAssessment({ ...input, receivedAt: 'yesterday' })).toThrow(/receivedAt/);
  });
});
