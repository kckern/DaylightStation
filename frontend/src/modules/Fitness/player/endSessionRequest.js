/**
 * buildEndSessionRequest — pure helper that produces the { path, body, method }
 * triple for the "End current fitness session" REST call.
 *
 * @param {string|number|null|undefined} sessionId
 * @param {{ now?: () => number }} [options]
 * @returns {null | { path: string, body: { endTime: number }, method: 'POST' }}
 */
export function buildEndSessionRequest(sessionId, { now = Date.now } = {}) {
  if (sessionId === null || sessionId === undefined) return null;
  const asString = String(sessionId);
  if (asString === '') return null;
  return {
    path: `api/v1/fitness/sessions/${asString}/end`,
    body: { endTime: now() },
    method: 'POST',
  };
}

export default buildEndSessionRequest;
