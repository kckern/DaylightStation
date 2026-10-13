/**
 * Turning a learner's session rows + event logs into readable threads.
 *
 * Two facts about the backend force this to live here:
 *
 *  1. `GET /learners/:id/sessions` is an INDEX. It carries
 *     `{ sessionId, learnerId, unitId, state, terminal, outcome, day, updatedAt }`
 *     and nothing else — no attempts, no issued documents, no reprint count and,
 *     crucially, no link between a failed session and the retry it opened.
 *  2. Everything above lives in the per-session event log, reachable only via
 *     `GET /sessions/:id/events`. The backend's own `reduceSession` is a pure
 *     `#domains/*` function that the API layer may not import and does not expose,
 *     so the same reduction is done here over the raw events — a narrow subset of
 *     it, only the fields this screen shows.
 *
 * Kept as plain functions, away from React, so the lineage rule — a fail and its
 * retry are ONE thread — can be tested without rendering anything.
 *
 * @module Admin/School/sessionLineage
 */

/** Event types that mean a document was put on paper. */
const ISSUE_TYPES = new Set(['issued', 'reprinted']);

/**
 * Fold one session's raw events into the handful of facts a parent reads.
 *
 * @param {object} row - the index row from `listForLearner`
 * @param {object[]} events - raw events from `readEvents`, any order
 * @returns {object} the row plus derived fields (never throws on a odd log)
 */
export function deriveSession(row, events) {
  const list = Array.isArray(events) ? [...events] : [];
  list.sort((a, b) => (a?.seq ?? 0) - (b?.seq ?? 0));

  const derived = {
    ...row,
    events: list,
    issuedArtifacts: [],
    reprints: 0,
    attemptIds: [],
    gradedPercent: null,
    transport: null,
    remediationOf: null,
    remediationNewSessionId: null,
    lastFailure: null,
    outcomeResult: row?.outcome?.result ?? null,
  };

  list.forEach((event) => {
    switch (event?.type) {
      case 'created':
        // The retry's own record of what it is retrying. THE lineage field.
        if (event.remediationOf) derived.remediationOf = event.remediationOf;
        break;
      case 'issued':
      case 'reprinted':
        if (event.artifactId && !derived.issuedArtifacts.includes(event.artifactId)) {
          derived.issuedArtifacts.push(event.artifactId);
        }
        // A reprint reuses the ORIGINAL artifactId, so the list does not grow —
        // the count is the only evidence a second sheet came out of the printer.
        if (event.type === 'reprinted') derived.reprints += 1;
        break;
      case 'submitted':
        derived.transport = event.transport ?? derived.transport;
        break;
      case 'graded':
        if (Array.isArray(event.attemptIds)) derived.attemptIds = [...event.attemptIds];
        if (typeof event.percent === 'number') derived.gradedPercent = event.percent;
        break;
      case 'outcome_recorded':
        derived.outcomeResult = event.result ?? derived.outcomeResult;
        break;
      case 'remediation_opened':
        // The failed session's forward pointer at the retry it opened.
        derived.remediationNewSessionId = event.newSessionId ?? null;
        break;
      case 'failed':
        derived.lastFailure = { stage: event.stage ?? null, reason: event.reason ?? null, at: event.at ?? null };
        break;
      default:
        break;
    }
  });

  derived.issueCount = list.filter((e) => ISSUE_TYPES.has(e?.type)).length;
  return derived;
}

/**
 * Chain derived sessions into threads: an original and every retry it led to,
 * oldest attempt first. A session nobody retried is a thread of one.
 *
 * Links are followed through `remediationOf` (retry → original), which is the
 * authoritative direction; `remediationNewSessionId` is used only to report a
 * retry this learner's list does not contain.
 *
 * @param {object[]} derivedSessions
 * @returns {object[][]} threads, newest activity first
 */
export function buildThreads(derivedSessions) {
  const list = Array.isArray(derivedSessions) ? derivedSessions : [];
  const byId = new Map(list.map((s) => [s.sessionId, s]));

  const childOf = new Map();
  list.forEach((s) => {
    if (s.remediationOf && byId.has(s.remediationOf) && !childOf.has(s.remediationOf)) {
      childOf.set(s.remediationOf, s.sessionId);
    }
  });
  const retries = new Set(childOf.values());

  const threads = list
    .filter((s) => !retries.has(s.sessionId))
    .map((root) => {
      const chain = [root];
      const seen = new Set([root.sessionId]);
      let cursor = root;
      // Guarded against a cycle in a hand-edited log — a loop here would hang
      // the page, and a truncated thread is a far better failure.
      while (childOf.has(cursor.sessionId)) {
        const nextId = childOf.get(cursor.sessionId);
        if (seen.has(nextId)) break;
        cursor = byId.get(nextId);
        seen.add(nextId);
        chain.push(cursor);
      }
      return chain;
    });

  const latest = (chain) => Math.max(...chain.map((s) => Date.parse(s?.updatedAt ?? '') || 0));
  return threads.sort((a, b) => latest(b) - latest(a));
}

export default { deriveSession, buildThreads };
