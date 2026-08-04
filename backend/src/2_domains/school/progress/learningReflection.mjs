import { validateLearningEvidence } from './learningProgress.mjs';

/**
 * Create one append-only reflection observation. The caller supplies identity
 * and time; this pure factory deliberately records zero academic responses.
 */
export function createLearningReflectionEvidence({
  evidenceId, learnerId, occurredAt, activity, learning = {}, selfRegulation,
  source = { surface: 'web', transport: 'screen' },
} = {}) {
  const candidate = {
    schema: 'school.learning-evidence/v1',
    evidenceId,
    learnerId,
    occurredAt,
    verification: 'self_reported',
    activity: {
      id: activity?.id,
      kind: 'reflection',
      graded: false,
      ...(activity?.sessionId ? { sessionId: activity.sessionId } : {}),
      ...(activity?.itemId ? { itemId: activity.itemId } : {}),
    },
    learning,
    measures: { engagements: 1, responses: 0, correct: 0 },
    source,
    selfRegulation,
  };
  const result = validateLearningEvidence(candidate);
  if (result.errors.length) throw new TypeError(result.errors.join('; '));
  return result.evidence;
}

export default createLearningReflectionEvidence;

