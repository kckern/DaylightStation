import { pianoAttemptClient } from '../../performance/attemptEvidence.js';

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(body.message || body.error || `Piano challenge request failed (${response.status})`),
      { status: response.status, code: body.error, details: body.details },
    );
  }
  return body;
}

/** Piano-owned services consumed by the Piano challenge provider. */
export function createPianoChallengeApi() {
  return {
    async recordAttempt(userId, attempt, { keepalive = false } = {}) {
      const outcome = await pianoAttemptClient.record(userId, attempt, { keepalive });
      if (!outcome.ok) {
        throw Object.assign(
          new Error(outcome.error || `Piano attempt request failed (${outcome.status})`),
          { status: outcome.status },
        );
      }
      return outcome;
    },
    prepareChallenge(userId, requestBody) {
      return request(`/api/v1/piano/users/${encodeURIComponent(userId)}/challenges/prepare`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
    },
  };
}
