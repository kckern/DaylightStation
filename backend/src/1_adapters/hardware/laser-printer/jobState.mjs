/**
 * IPP job states (RFC 8011 §5.3.7) and what they mean to us.
 *
 * Pure and separate from the adapter so the table is testable without a
 * printer, and so ONE rule lives in one readable place: a state we could not
 * read is `unknown`, never `failed`. A printer that stops answering has not
 * told us the sheet failed to print — reporting that as failure is the same
 * class of mistake as reporting spooler acceptance as success.
 */
export const JOB_STATES = Object.freeze({
  pending: 3,
  pendingHeld: 4,
  processing: 5,
  processingStopped: 6,
  canceled: 7,
  aborted: 8,
  completed: 9,
});

const TERMINAL = Object.freeze(new Set([
  JOB_STATES.canceled, JOB_STATES.aborted, JOB_STATES.completed,
]));

/** @param {number} state */
export function isTerminal(state) {
  return TERMINAL.has(state);
}

/**
 * @param {number|null|undefined} state
 * @returns {'completed'|'failed'|'pending'|'unknown'}
 */
export function classifyJobState(state) {
  if (state === JOB_STATES.completed) return 'completed';
  if (state === JOB_STATES.canceled || state === JOB_STATES.aborted) return 'failed';
  if (state === JOB_STATES.pending || state === JOB_STATES.pendingHeld
      || state === JOB_STATES.processing || state === JOB_STATES.processingStopped) {
    return 'pending';
  }
  return 'unknown';
}

export default { JOB_STATES, isTerminal, classifyJobState };
