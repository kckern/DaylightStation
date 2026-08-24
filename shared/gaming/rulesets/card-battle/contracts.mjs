/**
 * Wire-level vocabulary shared by the browser and backend.
 *
 * Lifecycle states are explicit because provider work may cross process and
 * device boundaries and must be recoverable from committed state.
 */
export const GAMING_SCHEMA_VERSION = 1;
export const GAMING_ENGINE_VERSION = '1.0.0-card-battle';

export const COMMAND_TYPES = Object.freeze({
  CHOOSE_ACTION: 'choose_action',
  END_TURN: 'end_turn',
  SUSPEND_SESSION: 'suspend_session',
  PREPARE_CHALLENGE: 'prepare_challenge',
  START_CHALLENGE: 'start_challenge',
  SUBMIT_CHALLENGE_RESULT: 'submit_challenge_result',
  ABORT_PENDING_ACTION: 'abort_pending_action',
  ABANDON_SESSION: 'abandon_session',
});

export const CHALLENGE_STATES = Object.freeze({
  REQUESTED: 'requested',
  PREPARED: 'prepared',
  STARTED: 'started',
});

export const CHALLENGE_RESULT_STATUSES = Object.freeze([
  'completed',
  'aborted',
  'timeout',
  'error',
]);

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

export function validateCommandEnvelope(command) {
  const errors = [];
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    return { valid: false, errors: ['command must be an object'] };
  }
  if (!ID_RE.test(String(command.command_id || ''))) errors.push('command_id is invalid');
  if (!Object.values(COMMAND_TYPES).includes(command.type)) errors.push(`unsupported command type: ${command.type}`);
  if (!Number.isInteger(command.session_revision) || command.session_revision < 0) {
    errors.push('session_revision must be a non-negative integer');
  }
  if (command.payload !== undefined && (!command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload))) {
    errors.push('payload must be an object');
  }
  return { valid: errors.length === 0, errors };
}

export function isChallengeResult(value) {
  if (!value || !CHALLENGE_RESULT_STATUSES.includes(value.status)) return false;
  if (value.status === 'completed') return Number.isFinite(value.score) && value.score >= 0 && value.score <= 1;
  return value.score === null || value.score === undefined;
}

export function gamingError(code, message, details = null) {
  return { code, message, ...(details ? { details } : {}) };
}
