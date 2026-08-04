import { gradeAnswer } from '../grading.mjs';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const RESULT_KINDS = new Set(['responses', 'progress']);
export const SCHOOLCALC_PROGRESS_STATUSES = Object.freeze(['started', 'viewed', 'completed', 'abandoned']);
const PROGRESS_STATUS_SET = new Set(SCHOOLCALC_PROGRESS_STATUSES);
const FORBIDDEN_AUTHORITY_FIELDS = Object.freeze([
  'learnerId', 'userId', 'correct', 'score', 'percentCorrect', 'reward', 'credited',
]);
const FORBIDDEN_WALL_TIME_FIELDS = Object.freeze([
  'at', 'timestamp', 'occurredAt', 'completedAt', 'receivedAt', 'recordedAt',
]);

/**
 * Validate the device-neutral submission after a calculator-family adapter has
 * decoded it and the application has resolved artifact positions to stable
 * lesson/module/item IDs.
 *
 * @param {*} raw
 * @returns {{errors: string[], submission?: object}}
 */
export function validateSchoolCalcSubmission(raw) {
  if (!isObject(raw)) return { errors: ['SchoolCalc submission must be a mapping'] };
  const errors = [];
  if (raw.schema !== 'school.calc.submission/v1') errors.push('schema must be school.calc.submission/v1');
  for (const field of ['deviceId', 'artifactId', 'lessonId', 'moduleId']) {
    if (!isText(raw[field])) errors.push(`${field} is required`);
  }
  if (!Number.isSafeInteger(raw.learnerKey) || raw.learnerKey < 1 || raw.learnerKey > 0xffff) {
    errors.push('learnerKey must be a positive 16-bit stable binding');
  }
  if (!Number.isSafeInteger(raw.sequence) || raw.sequence < 0) errors.push('sequence must be a non-negative safe integer');
  if (!RESULT_KINDS.has(raw.kind)) errors.push('kind must be responses|progress');
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (Object.hasOwn(raw, field)) errors.push(`${field} is server-authoritative and must not be submitted`);
  }
  for (const field of FORBIDDEN_WALL_TIME_FIELDS) {
    if (Object.hasOwn(raw, field)) {
      errors.push(`${field} is not accepted as authoritative calculator time`);
    }
  }

  if (raw.kind === 'responses') {
    validateResponses(raw.responses, errors);
    validateLocalScore(raw.localScore, raw.responses, errors);
  }
  if (raw.kind === 'progress') validateProgress(raw.progress, errors);
  if (raw.kind === 'responses' && raw.progress !== undefined) errors.push('responses submission must not contain progress');
  if (raw.kind === 'progress' && raw.responses !== undefined) errors.push('progress submission must not contain responses');
  if (raw.kind === 'progress' && raw.localScore !== undefined) errors.push('progress submission must not contain localScore');

  if (errors.length) return { errors };
  return { errors, submission: structuredClone(raw) };
}

/**
 * Recompute a calculator's offline score from the immutable bank snapshot.
 * The submitted score is useful learner-facing evidence, but this comparison
 * is what allows the backend to mark it verified rather than trusting it.
 */
export function verifySchoolCalcLocalScore({ localScore, responses, bank }) {
  const errors = [];
  if (!isObject(bank) || !Array.isArray(bank.items) || bank.items.length === 0) {
    return { errors: ['SchoolCalc score verification requires a question bank'] };
  }
  if (!Array.isArray(responses) || responses.length === 0) {
    return { errors: ['SchoolCalc score verification requires responses'] };
  }
  validateLocalScore(localScore, responses, errors);
  const items = new Map(bank.items.map((item) => [item.id, item]));
  let correct = 0;
  for (const [index, response] of responses.entries()) {
    const item = items.get(response?.itemId);
    if (!item) {
      errors.push(`responses[${index}].itemId is not in the immutable bank`);
      continue;
    }
    try {
      if (gradeAnswer(item, response.given).correct) correct += 1;
    } catch (error) {
      errors.push(`responses[${index}] cannot be scored: ${error.message}`);
    }
  }
  if (errors.length) return { errors };
  const verified = Object.freeze({
    correct,
    total: responses.length,
    percent: scorePercent(correct, responses.length),
    basis: 'immutable_answer_key',
    verified: true,
  });
  if (localScore.correct !== verified.correct
      || localScore.total !== verified.total
      || localScore.percent !== verified.percent) {
    return {
      errors: [
        `localScore ${localScore.correct}/${localScore.total} (${localScore.percent}%) `
        + `does not match the immutable answer key ${verified.correct}/${verified.total} (${verified.percent}%)`,
      ],
      score: verified,
    };
  }
  return { errors, score: verified };
}

/** Stable result identity; transport is intentionally absent. */
export function schoolCalcResultIdentity({ deviceId, sequence }) {
  if (!isText(deviceId) || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('SchoolCalc result identity requires deviceId and non-negative sequence');
  }
  return `${deviceId}:${sequence}`;
}

/**
 * Pure idempotency decision. Atomic storage of the decision belongs to the
 * result-ledger adapter.
 */
export function classifySchoolCalcResultClaim({ existingDigest = null, incomingDigest, importComplete = false }) {
  if (!isText(incomingDigest)) throw new Error('incomingDigest is required');
  if (existingDigest === null || existingDigest === undefined) return 'new';
  if (existingDigest !== incomingDigest) return 'conflict';
  return importComplete ? 'duplicate' : 'resume';
}

function validateResponses(raw, errors) {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('responses must be a non-empty array');
    return;
  }
  const ids = new Set();
  raw.forEach((response, index) => {
    const at = `responses[${index}]`;
    if (!isObject(response)) { errors.push(`${at} must be a mapping`); return; }
    if (!isText(response.itemId)) errors.push(`${at}.itemId is required`);
    else if (ids.has(response.itemId)) errors.push(`${at}.itemId duplicates '${response.itemId}'`);
    else ids.add(response.itemId);
    if (!Object.hasOwn(response, 'given') || response.given === null || response.given === undefined) {
      errors.push(`${at}.given is required`);
    }
    if (response.probe !== undefined) validateProbeTrace(response.probe, response.given, `${at}.probe`, errors);
  });
}

function validateProbeTrace(raw, given, path, errors) {
  if (!isObject(raw)) { errors.push(`${path} must be a mapping`); return; }
  const allowed = new Set(['attempts', 'feedbackViewed', 'continued']);
  Object.keys(raw).forEach((field) => {
    if (!allowed.has(field)) errors.push(`${path}.${field} is not supported`);
  });
  if (!Array.isArray(raw.attempts) || raw.attempts.length < 1 || raw.attempts.length > 3
      || raw.attempts.some((attempt) => attempt === null || attempt === undefined)) {
    errors.push(`${path}.attempts must contain 1..3 response values`);
  } else if (!sameValue(raw.attempts[0], given)) {
    errors.push(`${path}.attempts[0] must equal the score-bearing given response`);
  }
  if (typeof raw.feedbackViewed !== 'boolean') errors.push(`${path}.feedbackViewed must be boolean`);
  if (typeof raw.continued !== 'boolean') errors.push(`${path}.continued must be boolean`);
}

function sameValue(left, right) {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function validateLocalScore(raw, responses, errors) {
  if (!isObject(raw)) {
    errors.push('localScore must be a mapping for response submissions');
    return;
  }
  const allowed = new Set(['correct', 'total', 'percent', 'basis']);
  Object.keys(raw).forEach((field) => {
    if (!allowed.has(field)) errors.push(`localScore.${field} is not supported`);
  });
  const total = Array.isArray(responses) ? responses.length : null;
  if (!Number.isSafeInteger(raw.correct) || raw.correct < 0) errors.push('localScore.correct must be a non-negative safe integer');
  if (!Number.isSafeInteger(raw.total) || raw.total < 1) errors.push('localScore.total must be a positive safe integer');
  if (!Number.isSafeInteger(raw.percent) || raw.percent < 0 || raw.percent > 100) errors.push('localScore.percent must be an integer from 0 to 100');
  if (raw.basis !== 'embedded_answer_key') errors.push('localScore.basis must be embedded_answer_key');
  if (Number.isSafeInteger(raw.correct) && Number.isSafeInteger(raw.total) && raw.correct > raw.total) {
    errors.push('localScore.correct must not exceed localScore.total');
  }
  if (Number.isSafeInteger(raw.total) && total !== null && raw.total !== total) {
    errors.push('localScore.total must equal the response count');
  }
  if (Number.isSafeInteger(raw.correct) && Number.isSafeInteger(raw.total) && raw.total > 0
      && Number.isSafeInteger(raw.percent) && raw.percent !== scorePercent(raw.correct, raw.total)) {
    errors.push('localScore.percent must equal the rounded correct/total percentage');
  }
}

function scorePercent(correct, total) {
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}

function validateProgress(raw, errors) {
  if (!isObject(raw)) {
    errors.push('progress must be a mapping');
    return;
  }
  if (!PROGRESS_STATUS_SET.has(raw.status)) errors.push(`progress.status must be ${SCHOOLCALC_PROGRESS_STATUSES.join('|')}`);
  for (const field of ['position', 'total']) {
    if (!Number.isSafeInteger(raw[field]) || raw[field] < 0) errors.push(`progress.${field} must be a non-negative safe integer`);
  }
  if (Number.isSafeInteger(raw.position) && Number.isSafeInteger(raw.total) && raw.position > raw.total) {
    errors.push('progress.position must not exceed progress.total');
  }
}
