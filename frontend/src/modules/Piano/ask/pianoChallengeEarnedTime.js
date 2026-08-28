import { DaylightAPI } from '../../../lib/api.mjs';

/** Request an idempotent earned-time credit after AskSession reports a pass. */
export function creditPianoChallengeGameTime(learnerId, result) {
  return DaylightAPI(`api/v1/piano/users/${encodeURIComponent(learnerId)}/game-budget/credits`, {
    assessmentId: result.assessmentId,
    score: result.score,
    status: result.status,
    passed: true,
  }, 'POST');
}
