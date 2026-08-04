import { validateLearningEvidence } from './learningProgress.mjs';

export const LEARNING_PROBE_EVENTS = Object.freeze([
  'response', 'feedback_viewed', 'continuation',
]);
export const LEARNING_PROBE_CONTINUATIONS = Object.freeze(['retry', 'continue']);

/**
 * Build one append-only event in an embedded learning-probe trace.
 *
 * A retry response is accuracy evidence, while viewing feedback and choosing
 * what to do next are engagement evidence. Keeping them as separate records
 * prevents a successful retry from rewriting the original response or score.
 */
export function createLearningProbeEvidence({
  evidenceId, learnerId, occurredAt, event, activity, learning = {},
  attemptNumber, correct, continuation = null,
  source = { surface: 'web', transport: 'screen' },
} = {}) {
  if (!LEARNING_PROBE_EVENTS.includes(event)) {
    throw new TypeError(`Learning probe event must be ${LEARNING_PROBE_EVENTS.join('|')}`);
  }
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 3) {
    throw new TypeError('Learning probe attemptNumber must be an integer from 1 to 3');
  }
  if (event === 'response' && typeof correct !== 'boolean') {
    throw new TypeError('Learning probe response requires verified correctness');
  }
  if (event !== 'response' && correct !== undefined) {
    throw new TypeError('Learning probe feedback/continuation cannot carry correctness');
  }
  if (event === 'continuation' && !LEARNING_PROBE_CONTINUATIONS.includes(continuation)) {
    throw new TypeError(`Learning probe continuation must be ${LEARNING_PROBE_CONTINUATIONS.join('|')}`);
  }
  if (event !== 'continuation' && continuation !== null && continuation !== undefined) {
    throw new TypeError('Learning probe continuation applies only to continuation evidence');
  }

  const graded = event === 'response';
  const candidate = {
    schema: 'school.learning-evidence/v1', evidenceId, learnerId, occurredAt,
    verification: graded ? 'verified' : 'self_reported',
    activity: {
      id: activity?.id,
      kind: `learning_probe_${event}`,
      graded,
      attemptNumber,
      ...(activity?.sessionId ? { sessionId: activity.sessionId } : {}),
      ...(activity?.itemId ? { itemId: activity.itemId } : {}),
      ...(continuation ? { action: continuation } : {}),
    },
    learning,
    measures: graded
      ? { engagements: 1, responses: 1, correct: correct ? 1 : 0 }
      : { engagements: 1, responses: 0, correct: 0 },
    source,
  };
  const result = validateLearningEvidence(candidate);
  if (result.errors.length) throw new TypeError(result.errors.join('; '));
  return result.evidence;
}

export default createLearningProbeEvidence;
