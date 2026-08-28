import { DaylightAPI } from '../../../lib/api.mjs';

/** Read the learner-owned placement result; household repertoire stays config-owned. */
export async function readPianoChallengeProfile(learnerId) {
  if (!learnerId || learnerId === 'guest') return { startLevel: null };
  const result = await DaylightAPI(`api/v1/piano/users/${encodeURIComponent(learnerId)}/piano-challenge-profile`);
  return { startLevel: typeof result?.startLevel === 'string' ? result.startLevel : null };
}

/** Persist exactly the placement result, through the dedicated narrow API. */
export async function savePianoChallengeStartLevel(learnerId, startLevel) {
  return DaylightAPI(
    `api/v1/piano/users/${encodeURIComponent(learnerId)}/piano-challenge-profile`,
    { startLevel },
    'PUT',
  );
}
