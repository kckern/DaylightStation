/**
 * The shape of a recorded assessment.
 *
 * One rule sits behind this module: **a persisted attempt must not flatten to a
 * scalar.** A 0-1 score is a projection through a particular rubric's weights,
 * and a projection cannot be undone. Store only the score and every later
 * question — did the rubric change, was this child weak on timing or on notes,
 * should this level estimate be re-derived — becomes unanswerable about every
 * run already recorded.
 *
 * So the criterion vector is the record, the score is a convenience, and the
 * rubric that produced the score is named so a future rubric can re-project the
 * same vector rather than discard the history.
 *
 * Pure and dependency-free: the browser writes these and the backend validates
 * them, and neither should own the definition.
 *
 * Concept map: docs/reference/piano/performance-assessment.md
 */

/** Statuses an attempt can end in. Only `completed` carries a verdict. */
export const ATTEMPT_STATUSES = Object.freeze(['completed', 'aborted', 'timeout', 'error']);

/**
 * Criteria this vocabulary knows about.
 *
 * A record may carry any subset — a free-mode run has no `placement` because
 * there was no clock to be placed against, and that absence is information.
 * An unknown name is refused rather than stored: a typo that persists for months
 * is worse than a rejected write.
 */
export const CRITERIA = Object.freeze(['completeness', 'cleanliness', 'placement']);

const isUnit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Validates the assessment half of an attempt body.
 *
 * Returns `{ valid, errors }` rather than throwing, so a router can answer 400
 * with something a client can act on.
 */
export function validateAssessment(body = {}) {
  const errors = [];
  const completed = body.status === 'completed';

  if (!ATTEMPT_STATUSES.includes(body.status)) errors.push(`status must be one of: ${ATTEMPT_STATUSES.join(', ')}`);
  if (body.purpose !== undefined && !['practice', 'challenge'].includes(body.purpose)) {
    errors.push('purpose must be practice or challenge');
  }

  // The scalar keeps its old contract exactly, so existing writers stay valid.
  if (completed) {
    if (!isUnit(body.score)) errors.push('score must be a number from 0 to 1 on a completed attempt');
  } else if (body.score != null) {
    errors.push('score must be absent unless the attempt completed');
  }

  // The vector is optional for now — the old writers predate it — but if it is
  // present it must be well formed, or it is worse than nothing.
  if (body.criteria !== undefined) {
    if (!body.criteria || typeof body.criteria !== 'object' || Array.isArray(body.criteria)) {
      errors.push('criteria must be an object');
    } else {
      for (const [name, value] of Object.entries(body.criteria)) {
        if (!CRITERIA.includes(name)) errors.push(`unknown criterion: ${name}`);
        else if (!isUnit(value)) errors.push(`criterion ${name} must be a number from 0 to 1`);
      }
      if (!completed && Object.keys(body.criteria).length) {
        errors.push('criteria must be absent unless the attempt completed');
      }
    }
  }

  // Gates say why, not just whether. A bare boolean cannot tell a child that
  // they were four beats-per-minute short.
  if (body.gates !== undefined) {
    if (!body.gates || typeof body.gates !== 'object' || Array.isArray(body.gates)) {
      errors.push('gates must be an object');
    } else {
      for (const [name, gate] of Object.entries(body.gates)) {
        if (!gate || typeof gate !== 'object') { errors.push(`gate ${name} must be an object`); continue; }
        if (typeof gate.passed !== 'boolean') errors.push(`gate ${name} must say whether it passed`);
      }
    }
  }

  // A vector without the rubric that judged it cannot be re-projected later,
  // which is the whole point of keeping it.
  if (body.criteria !== undefined && typeof body.rubric?.id !== 'string') {
    errors.push('rubric.id is required when criteria are recorded');
  }
  if (body.rubric !== undefined) {
    if (!body.rubric || typeof body.rubric !== 'object') errors.push('rubric must be an object');
    else if (body.rubric.version !== undefined && typeof body.rubric.version !== 'string') {
      errors.push('rubric.version must be a string');
    }
  }

  // Diagnostics are measured, never scored, and are free-form by design — but
  // they must be a bag of numbers, not a place to smuggle prose.
  if (body.diagnostics !== undefined) {
    if (!body.diagnostics || typeof body.diagnostics !== 'object' || Array.isArray(body.diagnostics)) {
      errors.push('diagnostics must be an object');
    } else {
      for (const [name, value] of Object.entries(body.diagnostics)) {
        if (!Number.isFinite(value)) errors.push(`diagnostic ${name} must be a number`);
      }
    }
  }

  if (body.verdict !== undefined) {
    if (!completed || !body.verdict || typeof body.verdict !== 'object' || Array.isArray(body.verdict)) {
      errors.push('verdict must be an object on a completed attempt');
    } else {
      if (!isUnit(body.verdict.score)) errors.push('verdict.score must be a number from 0 to 1');
      if (typeof body.verdict.passed !== 'boolean') errors.push('verdict.passed must be boolean');
      if (isUnit(body.score) && isUnit(body.verdict.score) && body.score !== body.verdict.score) {
        errors.push('verdict.score must equal score');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Re-derives a score from a stored vector under different weights.
 *
 * This is the function the whole record shape exists to make possible: when a
 * rubric changes, history does not have to be thrown away or misread — it can be
 * asked the new question. Criteria the record does not carry are skipped and the
 * remaining weights renormalised, so a free-mode run (no `placement`) can still
 * be re-scored without inventing a timing number it never had.
 */
export function reproject(criteria, weights) {
  if (!criteria || !weights) return null;
  let total = 0;
  let used = 0;
  for (const [name, weight] of Object.entries(weights)) {
    const value = criteria[name];
    if (!isUnit(value) || !Number.isFinite(weight) || weight <= 0) continue;
    total += weight * value;
    used += weight;
  }
  return used > 0 ? total / used : null;
}
