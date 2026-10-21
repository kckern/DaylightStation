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
 * @param {Object<string, string>} [args.sentences] - per-status sentence
 *   overrides for a surface whose wording differs (the Portal has no code to
 *   "type again"); every other row keeps `PRINT_RESULTS`
 * @returns {Promise<{outcome: string, sentence: string, sessionId: string,
 *                    effect: object|null, transition: string}>}
 */
/** `PRINT_RESULTS` with some rows' sentences replaced; the outcomes never change. */
function printResultsWith(sentences) {
  if (!sentences) return PRINT_RESULTS;
  return Object.fromEntries(Object.entries(PRINT_RESULTS).map(([status, row]) => [
    status,
    typeof sentences[status] === 'string' ? { ...row, sentence: sentences[status] } : row,
  ]));
}

export async function printSessionSheet({
  issueDocument, sessionId, logger = console, events = SELF_SERVICE_EVENTS, sentences = null,
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
    table: printResultsWith(sentences),
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

/** What a screen says when a fresh sheet for a failed attempt went out. */
export const FRESH_SHEET_SENTENCE = 'Printing a fresh sheet to try again.';

/**
 * Open the retry session for a failed attempt (`OpenRemediation`). Never
 * throws. Answers `{ opened }` with `opened.newSessionId` set, or `{ answer }`:
 * a screen answer for an unwired collaborator, a throw, or a refusal.
 *
 * `OpenRemediation`'s own refusals ("There is nothing to try again right
 * now.", "After two tries, a grown-up will help with this one.") are already
 * screen-safe and are passed through; `refusedSentence` is only the fallback
 * for a refusal that carries no message.
 */
export async function openRemediationSession({
  openRemediation, sessionId, refusedSentence = TELL_A_GROWN_UP,
  logger = console, events = SELF_SERVICE_EVENTS,
}) {
  if (!openRemediation) return { answer: unwiredAnswer({ action: 'retry', sessionId, logger, events }) };
  let opened;
  try {
    opened = await openRemediation.execute({ sessionId });
  } catch (error) {
    return { answer: threwAnswer({ action: 'retry', sessionId, error, logger, events }) };
  }
  if (opened?.status === 'unavailable' || !opened?.newSessionId) {
    return {
      answer: {
        outcome: 'refused',
        sentence: opened?.message || refusedSentence,
        sessionId,
        effect: { status: opened?.status ?? null },
      },
    };
  }
  return { opened };
}

/**
 * One operation's answer, restated as the retry it was: the FRESH session's
 * id, the lineage in `effect`, and the fresh-sheet sentence for a print that
 * went out.
 */
export function retryAnswer({ result, sessionId, opened, operation }) {
  return {
    ...result,
    sessionId: opened.newSessionId,
    sentence: operation === 'print' && result.outcome === 'done'
      ? FRESH_SHEET_SENTENCE : result.sentence,
    effect: { ...(result.effect ?? {}), remediationOf: sessionId, variant: opened.variant ?? null },
  };
}

/**
 * A failed attempt's fresh sheet: open the retry session, then print it.
 * The paper half of `RunSelfServiceAction#retry`, shared with
 * `IssueSubjectNext`. Never throws.
 *
 * @param {object} args
 * @param {object|null} args.openRemediation
 * @param {object|null} args.issueDocument
 * @param {string} args.sessionId - the FAILED session the retry hangs off
 */
export async function printFreshSheet({
  openRemediation, issueDocument, sessionId, refusedSentence = TELL_A_GROWN_UP,
  logger = console, events = SELF_SERVICE_EVENTS, sentences = null,
}) {
  const { answer, opened } = await openRemediationSession({
    openRemediation, sessionId, refusedSentence, logger, events,
  });
  if (answer) return answer;
  const result = await printSessionSheet({
    issueDocument, sessionId: opened.newSessionId, logger, events, sentences,
  });
  return retryAnswer({ result, sessionId, opened, operation: 'print' });
}

export default printSessionSheet;
