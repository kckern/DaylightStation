const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const STATUSES = new Set(['completed', 'abandoned']);
const OUTCOMES = new Set(['win', 'loss', 'draw', 'completed', 'abandoned']);
const record = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function validateGamingResult(result) {
  const errors = [];
  if (!record(result)) return { valid: false, errors: ['result must be an object'] };
  if (result.schema !== 'gaming-result/v1') errors.push('schema must be gaming-result/v1');
  if (!ID.test(String(result.session_id || ''))) errors.push('session_id is invalid');
  if (!ID.test(String(result.experience_id || ''))) errors.push('experience_id is invalid');
  if (!STATUSES.has(result.status)) errors.push('status is invalid');
  if (!record(result.outcome) || !OUTCOMES.has(result.outcome.kind)) errors.push('outcome is invalid');
  if (!Array.isArray(result.scores)
    || result.scores.some((score) => !ID.test(String(score?.subject_id || '')) || !Number.isFinite(score?.value))) {
    errors.push('scores are invalid');
  }
  if (!Number.isFinite(result.duration_ms) || result.duration_ms < 0) errors.push('duration_ms is invalid');
  if (result.evidence != null && !record(result.evidence)) errors.push('evidence must be an object');
  return { valid: errors.length === 0, errors };
}

export function gamingResult(input) {
  const result = {
    schema: 'gaming-result/v1',
    session_id: input.sessionId,
    experience_id: input.experienceId,
    status: input.status,
    outcome: structuredClone(input.outcome),
    scores: structuredClone(input.scores || []),
    duration_ms: input.durationMs,
    evidence: structuredClone(input.evidence || {}),
  };
  const validation = validateGamingResult(result);
  if (!validation.valid) throw new Error(`GamingResult: ${validation.errors.join('; ')}`);
  return Object.freeze(result);
}
