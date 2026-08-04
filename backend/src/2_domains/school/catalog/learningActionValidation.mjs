const ACTION_ID = /^[a-z0-9][a-z0-9:._/-]{0,127}$/;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Closed set of low-risk, repeatable actions that may be reached from a
 * persistent lesson QR. Arbitrary commands and provider-specific operations
 * are deliberately absent.
 */
export const LEARNING_ACTION_KINDS = Object.freeze([
  'print_document',
  'launch_media',
]);

/**
 * Validate the server-side meaning of one authored `scan_action.actionId`.
 * The definition never enters a calculator artifact; only its opaque token
 * does. Persistent v1 lesson codes are repeatable and revocable, not bearer
 * authentication and not one-shot authorization.
 */
export function validateLearningAction(raw) {
  if (!isObject(raw)) return { errors: ['learning action must be a mapping'] };
  const errors = [];
  const push = (field, message) => errors.push(`${field}: ${message}`);
  if (raw.schema !== 'school.learning-action/v1') push('schema', 'must be school.learning-action/v1');
  if (!ACTION_ID.test(raw.actionId || '')) push('actionId', 'must be a lowercase content reference');
  if (!isText(raw.title)) push('title', 'is required');
  if (!LEARNING_ACTION_KINDS.includes(raw.kind)) {
    push('kind', `must be one of ${LEARNING_ACTION_KINDS.join('|')}`);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') push('enabled', 'must be a boolean when present');
  if (!Number.isInteger(raw.tokenVersion) || raw.tokenVersion < 1 || raw.tokenVersion > 0xffff) {
    push('tokenVersion', 'must be an integer from 1–65535');
  }
  if (!isObject(raw.policy)) push('policy', 'must be a mapping');
  else {
    if (raw.policy.replay !== 'repeatable') push('policy.replay', 'must be repeatable for a persistent v1 lesson action');
    const unknown = Object.keys(raw.policy).filter((field) => field !== 'replay');
    if (unknown.length) push('policy', `contains unsupported fields: ${unknown.sort().join(', ')}`);
  }
  validateTarget(raw, errors);

  const forbidden = ['token', 'provider', 'learnerId', 'deviceId', 'command', 'url', 'expiresAt'];
  forbidden.filter((field) => raw[field] !== undefined)
    .forEach((field) => push(field, 'is server/runtime policy and must not be authored here'));
  if (errors.length) return { errors };
  return {
    errors,
    action: Object.freeze({
      schema: raw.schema,
      actionId: raw.actionId,
      title: raw.title.trim(),
      kind: raw.kind,
      enabled: raw.enabled !== false,
      tokenVersion: raw.tokenVersion,
      policy: Object.freeze({ replay: 'repeatable' }),
      target: Object.freeze(structuredClone(raw.target)),
    }),
  };
}

function validateTarget(raw, errors) {
  const push = (field, message) => errors.push(`${field}: ${message}`);
  if (!isObject(raw.target)) { push('target', 'must be a mapping'); return; }
  if (raw.kind === 'print_document') {
    if (!ACTION_ID.test(raw.target.printableId || '')) push('target.printableId', 'must be a lowercase content reference');
    if (raw.target.copies !== undefined
      && (!Number.isInteger(raw.target.copies) || raw.target.copies < 1 || raw.target.copies > 10)) {
      push('target.copies', 'must be an integer from 1–10 when present');
    }
    rejectUnknownTarget(raw.target, ['printableId', 'copies'], errors);
  } else if (raw.kind === 'launch_media') {
    if (!isText(raw.target.contentCode)) push('target.contentCode', 'is required');
    if (raw.target.contentCode?.startsWith('sch:')) push('target.contentCode', 'must not recurse into the School scan namespace');
    rejectUnknownTarget(raw.target, ['contentCode'], errors);
  }
}

function rejectUnknownTarget(target, allowed, errors) {
  const unknown = Object.keys(target).filter((field) => !allowed.includes(field));
  if (unknown.length) errors.push(`target: contains unsupported fields: ${unknown.sort().join(', ')}`);
}

export default validateLearningAction;
