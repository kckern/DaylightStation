import { describe, expect, it } from 'vitest';
import {
  activateAdaptiveRemediationSession,
  adaptiveRemediationSessionView,
  answerAdaptiveRemediationTurn,
  appendAdaptiveRemediationTurn,
  controlAdaptiveRemediationTurn,
  createAdaptiveRemediationSession,
  evaluateAssessmentForRemediation,
  selectNextRemediationConcept,
  validateAdaptiveRemediationPolicy,
} from './adaptiveRemediation.mjs';

const at = (minute) => `2026-08-02T12:${String(minute).padStart(2, '0')}:00.000Z`;
const bank = {
  id: 'rates', title: 'Rates', audience: 'assigned',
  concepts: [
    { conceptId: 'unit-rate', title: 'Unit rate', description: 'Compare one unit.' },
    { conceptId: 'slope', title: 'Slope' },
  ],
  items: [
    { id: 'q1', type: 'multiple_choice', prompt: '12 miles in 3 hours?', choices: ['3', '4'], answer: '4', concepts: ['unit-rate'] },
    { id: 'q2', type: 'multiple_choice', prompt: 'Rise 6, run 2?', choices: ['2', '3'], answer: '3', concepts: ['slope'] },
  ],
};

function policy() {
  return validateAdaptiveRemediationPolicy({
    trigger: { scoreBelowPercent: 70, minimumIncorrect: 1 },
    mastery: { targetPercent: 80, minimumChecksPerConcept: 2 },
    limits: { maxTurns: 5, maxMinutes: 20 },
  }).policy;
}

function offered() {
  const evaluation = evaluateAssessmentForRemediation({
    policy: policy(), bank,
    responses: [{ itemId: 'q1', given: '3' }, { itemId: 'q2', given: '3' }],
  }).evaluation;
  return createAdaptiveRemediationSession({
    sessionId: 'rem-1', learnerId: 'learner-a',
    source: { kind: 'assessment', externalId: 'DEVICE01:9' },
    tutorContext: { lesson: { title: 'Rates' } },
    policy: policy(), evaluation, createdAt: at(0),
  });
}

describe('adaptive remediation domain', () => {
  it('validates a compact F1-F5 policy and rejects unsupported free text', () => {
    expect(policy()).toMatchObject({ launch: 'offer', interaction: { maxChoices: 5 } });
    expect(validateAdaptiveRemediationPolicy({ interaction: { responseMode: 'text' } }).errors)
      .toContain('remediation.interaction.responseMode: v1 supports choice only');
  });

  it('uses deterministic grading and explicit concept tags to find weaknesses', () => {
    const result = evaluateAssessmentForRemediation({
      policy: policy(), bank,
      responses: [{ itemId: 'q1', given: '3' }, { itemId: 'q2', given: '3' }],
    });
    expect(result.errors).toEqual([]);
    expect(result.evaluation).toMatchObject({ correct: 1, incorrect: 1, scorePercent: 50, triggered: true });
    expect(result.evaluation.concepts.map(({ conceptId }) => conceptId)).toEqual(['unit-rate']);
  });

  it('never exposes the current answer and reaches mastery after configured checks', () => {
    let session = activateAdaptiveRemediationSession(offered(), { at: at(1) });
    expect(selectNextRemediationConcept(session).conceptId).toBe('unit-rate');
    session = appendAdaptiveRemediationTurn(session, {
      conceptId: 'unit-rate', body: 'A unit rate compares a quantity with one unit.',
      prompt: '15 miles in 3 hours is how many miles per hour?',
      choices: [{ id: 'A', label: '3' }, { id: 'B', label: '5' }],
      correctChoiceId: 'B', rationale: '15 divided by 3 is 5.',
    }, { turnId: 'turn-1', at: at(2) });
    const publicTurn = adaptiveRemediationSessionView(session).turns[0];
    expect(publicTurn).not.toHaveProperty('correctChoiceId');
    expect(publicTurn).not.toHaveProperty('rationale');

    ({ session } = answerAdaptiveRemediationTurn(session, { turnId: 'turn-1', choiceId: 'B', at: at(3) }));
    session = appendAdaptiveRemediationTurn(session, {
      conceptId: 'unit-rate', body: 'Keep dividing the total by the number of units.',
      prompt: '24 pages in 4 days is how many pages per day?',
      choices: [{ id: 'A', label: '6' }, { id: 'B', label: '8' }],
      correctChoiceId: 'A', rationale: '24 divided by 4 is 6.',
    }, { turnId: 'turn-2', at: at(4) });
    const answered = answerAdaptiveRemediationTurn(session, {
      turnId: 'turn-2', choiceId: 'A', at: at(5),
    });
    expect(answered.session).toMatchObject({ status: 'mastered', masteryPercent: 100 });
    expect(answered.result).toMatchObject({ correct: true, status: 'mastered' });
    expect(adaptiveRemediationSessionView(answered.session).terminalSummary).toMatchObject({
      initialScorePercent: 50, finalMasteryPercent: 100,
      masteredConceptIds: ['unit-rate'], remainingConceptIds: [],
      completionReason: 'mastery_target_reached', nextAction: 'continue',
    });
  });

  it('rejects repeated tutor wording and records learner controls without inventing correctness', () => {
    let session = activateAdaptiveRemediationSession(offered(), { at: at(1) });
    const turn = {
      conceptId: 'unit-rate', body: 'Divide the total by the number of equal units.',
      prompt: '15 miles in 3 hours is how many miles per hour?',
      choices: [{ id: 'A', label: '3' }, { id: 'B', label: '5' }],
      correctChoiceId: 'B', rationale: '15 divided by 3 is 5.',
    };
    session = appendAdaptiveRemediationTurn(session, turn, { turnId: 'turn-1', at: at(2) });
    ({ session } = controlAdaptiveRemediationTurn(session, {
      turnId: 'turn-1', control: 'explain', at: at(3),
    }));
    expect(session.turns[0].response).toEqual({ control: 'explain', respondedAt: at(3) });
    expect(session.concepts[0]).toMatchObject({ checksTotal: 0, checksCorrect: 0 });
    expect(() => appendAdaptiveRemediationTurn(session, turn, {
      turnId: 'turn-2', at: at(4),
    })).toThrow(/repeats an earlier/);
  });

  it('fails closed when remediation content lacks concept metadata', () => {
    const untagged = structuredClone(bank);
    delete untagged.items[0].concepts;
    const result = evaluateAssessmentForRemediation({
      policy: policy(), bank: untagged,
      responses: [{ itemId: 'q1', given: '3' }],
    });
    expect(result.errors.join(' ')).toContain('needs concepts');
  });
});
