/**
 * printSessionSheet — put one session's sheet in the tray and say so in words
 * a child can read on a SCREEN.
 *
 * Extracted from `RunSelfServiceAction#print` so the keypad's `print` button
 * and `IssueSubjectNext` ("print my next sheet" on the Portal bank strip and
 * the piano kiosk) share one judgement: which `IssueDocument` statuses keep the
 * use case's own wording, and which must be rewritten because that wording
 * tells a child to SCAN — a scanner instruction on a screen.
 *
 * The caller owns the session. By the time this runs `sessionId` must be a
 * REAL session id (`ensureSession` has run), never the card's synthetic marker.
 *
 * Event names are the caller's: the keypad keeps its historical
 * `school.selfservice.action.*` names byte-for-byte, and another surface passes
 * its own so its failures are not filed under the keypad's.
 */

export const TELL_A_GROWN_UP = 'Something went wrong. Tell a grown-up.';

/**
 * `IssueDocument` status -> what a screen says and how its caller branches.
 *
 * `sentence: null` means the use case's own message is already screen-safe
 * ("Printing your sheet."). Every other row is rewritten because
 * `IssueDocument`'s copy tells the child to SCAN — a scanner instruction on a
 * keypad, the exact trap `offeredActions` warns about for `nextMove`'s labels.
 */
export const PRINT_RESULTS = Object.freeze({
  issued: { outcome: 'done', sentence: null },
  reprinted: { outcome: 'done', sentence: null },
  debounced: { outcome: 'debounced', sentence: "It's already on its way — give it a minute." },
  already_done: { outcome: 'refused', sentence: 'That one is finished. Type your code again to see what is next.' },
  print_failed: { outcome: 'failed', sentence: 'The printer did not answer. Try that again in a minute.' },
  render_failed: { outcome: 'failed', sentence: 'We could not make that sheet. Tell a grown-up.' },
  unavailable: { outcome: 'failed', sentence: 'There is no sheet for this one. Tell a grown-up.' },
});

/** The keypad's historical event names. */
export const SELF_SERVICE_EVENTS = Object.freeze({
  failed: 'school.selfservice.action.failed',
  unwired: 'school.selfservice.action.unwired',
  unknownStatus: 'school.selfservice.action.unknown-status',
  useCaseFailed: 'school.selfservice.action.use-case-failed',
});

/**
 * One use-case result -> one screen answer. A status the table does not know
 * is a failure with words, never a blank card, and it is logged, because a new
 * status in `IssueDocument`/`DispatchMedia` that nobody taught the table about
 * is a real gap and there is no other way to see it.
 */
export function reportUseCaseResult({
  action, table, result, sessionId, effect, logger = console, events = SELF_SERVICE_EVENTS,
}) {
  const known = table[result?.status];
  if (!known) {
    logger.warn?.(events.unknownStatus, {
      action, sessionId, status: result?.status ?? null,
    });
  } else if (known.outcome === 'failed') {
    logger.warn?.(events.useCaseFailed, {
      action, sessionId, status: result.status, message: result.message ?? null,
    });
  }
  // `sentence: null` in a table means "the use case already said it well".
  const own = known?.sentence === null ? result?.message : known?.sentence;
  const outcome = known?.outcome ?? 'failed';
  return {
    outcome,
    // A blank sentence is the one thing a screen may never show, so even a
    // use case that answers with an empty message gets words here.
    sentence: (typeof own === 'string' && own.trim()) ? own : (outcome === 'done' ? 'All set.' : TELL_A_GROWN_UP),
    sessionId,
    effect: { status: result?.status ?? null, ...effect },
    transition: action === 'print' && outcome === 'done' ? 'confirm-print' : 'message',
  };
}

/** A collaborator that was never wired: words, not a crash or a phantom success. */
export function unwiredAnswer({ action, sessionId, logger = console, events = SELF_SERVICE_EVENTS }) {
  logger.warn?.(events.unwired, { action, sessionId });
  return { outcome: 'failed', sentence: 'That is not set up yet. Tell a grown-up.', sessionId, effect: null };
}

/** A use case that threw: logged, and answered in words. */
export function threwAnswer({ action, sessionId, error, logger = console, events = SELF_SERVICE_EVENTS }) {
  logger.error?.(events.failed, {
    stage: action, sessionId, error: error?.message ?? String(error),
  });
  return { outcome: 'failed', sentence: TELL_A_GROWN_UP, sessionId, effect: null };
}

/**
 * Print a session's sheet through `IssueDocument`. Never throws.
 *
 * No print-or-screen fallback here on purpose: the caller already decided this
 * session's next move is paper (`offeredActions`, from `IssueDocument
 * .canIssueBank`), and re-deciding it would be the duplicated judgement
 * `offerSession.mjs` records deleting after it drifted.
 *
 * @param {object} args
 * @param {import('./IssueDocument.mjs').IssueDocument|null} args.issueDocument
 * @param {string} args.sessionId - a REAL session id
 * @param {object} [args.logger]
 * @param {object} [args.events] - event names; the keypad's by default
 * @returns {Promise<{outcome: string, sentence: string, sessionId: string,
 *                    effect: object|null, transition: string}>}
 */
export async function printSessionSheet({
  issueDocument, sessionId, logger = console, events = SELF_SERVICE_EVENTS,
}) {
  if (!issueDocument) return unwiredAnswer({ action: 'print', sessionId, logger, events });
  let result;
  try {
    result = await issueDocument.execute({ sessionId });
  } catch (error) {
    return threwAnswer({ action: 'print', sessionId, error, logger, events });
  }
  return reportUseCaseResult({
    action: 'print',
    table: PRINT_RESULTS,
    result,
    sessionId,
    effect: {
      artifactId: result?.artifactId ?? null,
      pageCount: result?.pageCount ?? null,
    },
    logger,
    events,
  });
}

export default printSessionSheet;
