const makeAttemptId = () => `attempt-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

/** Build the one portable payload accepted by the Piano attempt ledger. */
export function buildPianoAttemptEvidence({
  result,
  challengeId = null,
  activityId = null,
  kind,
  purpose,
  prompt = null,
  context = null,
  providerVersion,
  gradingPolicyVersion = null,
  attemptId = null,
  extra = null,
} = {}) {
  if (!result?.status) throw new Error('Piano attempt evidence requires a terminal result');
  const challenge = typeof challengeId === 'string' && challengeId.trim() ? challengeId.trim() : null;
  const activity = typeof activityId === 'string' && activityId.trim() ? activityId.trim() : null;
  if (!challenge && !activity) throw new Error('Piano attempt evidence requires challengeId or activityId');
  if (!['practice', 'challenge'].includes(purpose)) throw new Error('Piano attempt evidence requires a valid purpose');
  return {
    ...(extra || {}),
    ...result,
    attempt_id: attemptId || makeAttemptId(),
    ...(challenge ? { challenge_id: challenge } : {}),
    ...(activity ? { activity_id: activity } : {}),
    kind,
    purpose,
    ...(prompt ? { prompt } : {}),
    ...(context ? { context } : {}),
    grading_policy_version: gradingPolicyVersion || result.rubric?.id || 'piano-assessment-v2',
    provider_version: providerVersion,
  };
}

/** HTTP transport shared by Learn, Exercises, and Gaming. It never throws. */
export function createPianoAttemptClient({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  return Object.freeze({
    async record(userId, evidence, { keepalive = false } = {}) {
      const startedAt = now();
      if (typeof userId !== 'string' || !userId.trim()) {
        return { ok: false, status: 0, data: null, error: 'user-required', durationMs: Math.max(0, now() - startedAt) };
      }
      try {
        const response = await fetchImpl(`/api/v1/piano/users/${encodeURIComponent(userId)}/attempts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(evidence),
          keepalive,
        });
        const data = await response.json().catch(() => null);
        return {
          ok: response.ok,
          status: response.status,
          data,
          error: response.ok ? null : data?.error || 'request-failed',
          durationMs: Math.max(0, now() - startedAt),
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          data: null,
          error: error?.message || 'network-failed',
          durationMs: Math.max(0, now() - startedAt),
        };
      }
    },
  });
}

export const pianoAttemptClient = createPianoAttemptClient();

/** Normalize transport outcomes so every surface uses the same vocabulary. */
export function pianoPersistenceOutcome(response) {
  if (response?.skipped) return `skipped-${response.skipped}`;
  const status = Number(response?.status);
  if (response?.ok || (status >= 200 && status < 400)) return 'saved';
  if (status >= 400 && status < 500) return 'rejected';
  return 'failed';
}

/** Low-cardinality assessment telemetry; deliberately excludes note streams. */
export function pianoAssessmentTelemetry(evidence, persistence = {}) {
  return {
    surface: evidence?.context?.surface ?? null,
    matcher: evidence?.context?.matcher ?? null,
    mode: evidence?.context?.mode ?? evidence?.assessment?.mode ?? evidence?.prompt?.mode ?? null,
    attemptId: evidence?.attempt_id ?? null,
    activityId: evidence?.activity_id ?? null,
    challengeId: evidence?.challenge_id ?? null,
    purpose: evidence?.purpose ?? null,
    criteria: evidence?.criteria ?? null,
    rubricId: evidence?.rubric?.id ?? evidence?.grading_policy_version ?? null,
    rubricVersion: evidence?.rubric?.version ?? null,
    providerVersion: evidence?.provider_version ?? null,
    partWeights: evidence?.rubric?.part_weights ?? null,
    failedCriteria: evidence?.verdict?.failed_criteria ?? [],
    failedGates: evidence?.verdict?.failed_gates ?? [],
    gates: evidence?.gates ?? null,
    terminalStatus: evidence?.status ?? null,
    score: evidence?.score ?? null,
    passed: evidence?.verdict?.passed ?? null,
    expectedNotes: evidence?.diagnostics?.expected_notes ?? null,
    matchedNotes: evidence?.diagnostics?.matched_notes ?? null,
    wrongNotes: evidence?.diagnostics?.wrong_notes ?? null,
    missedNotes: evidence?.diagnostics?.missed_notes ?? null,
    responseMedianMs: evidence?.diagnostics?.response_median_ms ?? null,
    persistence: persistence.outcome ?? 'not-attempted',
    persistenceStatus: persistence.status ?? null,
    persistenceDurationMs: persistence.durationMs ?? null,
    ...(persistence.error ? { persistenceError: persistence.error } : {}),
  };
}
