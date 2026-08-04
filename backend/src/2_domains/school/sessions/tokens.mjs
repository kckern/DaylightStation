/**
 * Action-token semantics (spec §6.1). Pure: no I/O, no clock, no crypto import —
 * the issue time (`at`), the current time (`now`) and the randomness (`rng`) are
 * all injected.
 *
 * A token is a random opaque id printed as `sch:<body>` on a QR or Code128 and
 * resolved server-side through the token registry. It ENCODES NOTHING: no
 * learner id, no unit id, no expiry, no policy. Anything printed into the barcode
 * is a fact the house cannot change afterwards and anyone holding the paper can
 * read — so meaning stays on the server, where revocation, expiry and policy
 * edits are one registry write.
 *
 * The other governing idea is that a scan is never a dead end. A token whose
 * moment has passed resolves to `already_done` with a FRIENDLY message, not an
 * error: the holder is a child with a piece of paper, and "that didn't work" with
 * nothing after it is the failure this whole subsystem exists to avoid.
 */

export const TOKEN_PREFIX = 'sch:';

/** Closed set — a new action class is a code change, never config. */
export const TOKEN_CLASSES = Object.freeze([
  'identify', 'select_unit', 'issue_document', 'media_action', 'remediation', 'recovery',
  'subject_next', 'learning_action',
]);

/**
 * 32 unambiguous uppercase characters: no O/0 and no I/1, because the fallback
 * when a barcode will not scan is a grown-up keying the code in by hand.
 */
const BODY_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const BODY_LENGTH = 16;
const TOKEN_PATTERN = new RegExp(`^${TOKEN_PREFIX}[${BODY_CHARSET}]{${BODY_LENGTH}}$`);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isIsoTimestamp = (v) => isNonEmptyString(v) && !Number.isNaN(Date.parse(v));

/**
 * Does this scan belong to School? (spec §6.2 — any scanner in the house works,
 * whatever route it is configured for.)
 *
 * The relay's `onScan` used to branch on this ahead of its own route dispatch.
 * It no longer does: the shared scan vocabulary claims `sch:` for the school
 * NAMESPACE (`#domains/scan/ScanCode.mjs`), and a namespace always outranks the
 * reader's route, which is what makes route-independence structural rather than
 * a matter of branch order. This predicate agrees with that parse by
 * construction — both test the same prefix — and is still consulted inside the
 * school handler, where it doubles as the unwired-console switch.
 *
 * @param {*} code - raw scanned code
 * @returns {boolean}
 */
export function isSchoolToken(code) {
  return typeof code === 'string' && code.trim().startsWith(TOKEN_PREFIX);
}

/**
 * Mint one opaque action token.
 *
 * @param {object}   args
 * @param {string}   args.tokenClass  one of TOKEN_CLASSES
 * @param {object}   args.subject     `{ learnerId }` for identify, `{ sessionId }` otherwise
 * @param {string}   args.at          ISO issue time (injected — the domain reads no clock)
 * @param {Function} args.rng         () => number in [0,1) (injected — no crypto here;
 *                                    composition supplies a CSPRNG-backed draw, tests a seeded one)
 * @param {string}   [args.expiresAt] ISO expiry; forbidden for `identify`
 * @returns {{ token: string, tokenClass: string, subject: object, issuedAt: string,
 *             expiresAt: string|null, revokedAt: null }}
 */
export function mintToken({ tokenClass, subject, at, rng, expiresAt = null } = {}) {
  if (typeof rng !== 'function') throw new Error('mintToken: rng function is required');
  let body = '';
  for (let i = 0; i < BODY_LENGTH; i += 1) {
    // Clamp rather than trust: an rng that returns exactly 1 (or drifts out of
    // range) would otherwise index past the charset and print "undefined".
    const draw = Math.min(Math.max(Number(rng()) || 0, 0), 0.9999999999);
    body += BODY_CHARSET[Math.floor(draw * BODY_CHARSET.length)];
  }

  return createTokenRecord({
    token: `${TOKEN_PREFIX}${body}`, tokenClass, subject, at, expiresAt,
  }, { caller: 'mintToken' });
}

/**
 * Validate and construct a record for an opaque body supplied by a security
 * adapter. This is used by deterministic, device-bound lesson-action tokens;
 * all class/subject/time invariants remain in the pure domain.
 */
export function createTokenRecord({ token, tokenClass, subject, at, expiresAt = null } = {}, { caller = 'createTokenRecord' } = {}) {
  if (!TOKEN_CLASSES.includes(tokenClass)) throw new Error(`${caller}: unknown token class: ${tokenClass}`);
  if (!TOKEN_PATTERN.test(token || '')) throw new Error(`${caller}: token must be an opaque 16-character School token`);
  if (!isIsoTimestamp(at)) throw new Error(`${caller}: at must be an ISO-8601 timestamp`);
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) {
    throw new Error(`${caller}: subject must be a mapping`);
  }
  if (tokenClass === 'identify') {
    if (!isNonEmptyString(subject.learnerId)) throw new Error(`${caller}: identify subject requires a learnerId`);
    if (expiresAt != null) throw new Error(`${caller}: an identify token never expires`);
  } else if (tokenClass === 'subject_next') {
    if (!isNonEmptyString(subject.learnerId)) throw new Error(`${caller}: subject_next subject requires a learnerId`);
    if (!isNonEmptyString(subject.subject)) throw new Error(`${caller}: subject_next subject requires a subject`);
  } else if (tokenClass === 'learning_action') {
    if (!isNonEmptyString(subject.deviceId)) throw new Error(`${caller}: learning_action subject requires a deviceId`);
    if (!isNonEmptyString(subject.address)) throw new Error(`${caller}: learning_action subject requires an address`);
    if (!isNonEmptyString(subject.actionId)) throw new Error(`${caller}: learning_action subject requires an actionId`);
    if (!Number.isInteger(subject.tokenVersion) || subject.tokenVersion < 1 || subject.tokenVersion > 0xffff) {
      throw new Error(`${caller}: learning_action subject requires a 1..65535 tokenVersion`);
    }
    if (expiresAt != null) throw new Error(`${caller}: a persistent learning_action token never expires`);
  } else if (!isNonEmptyString(subject.sessionId)) {
    throw new Error(`${caller}: ${tokenClass} subject requires a sessionId`);
  }
  if (expiresAt != null && !isIsoTimestamp(expiresAt)) {
    throw new Error(`${caller}: expiresAt must be an ISO-8601 timestamp`);
  }
  return {
    token, tokenClass, subject: structuredClone(subject), issuedAt: at, expiresAt, revokedAt: null,
  };
}

/**
 * Per-class resolution against the session's derived state.
 *
 * `actionable(state)` is the set of states in which the class's action still
 * MEANS something. Outside it the token is spent, not broken.
 */
const SEMANTICS = {
  identify: {
    // Handled ahead of the state checks — a personal card resolves a learner,
    // not a session, so it is actionable with no session at all.
    actionable: () => true,
    doneMessage: () => 'Scan your card any time to print your list.',
    readyMessage: 'Printing your list.',
  },
  select_unit: {
    actionable: (s) => s.state === 'created',
    doneMessage: () => 'You already started this one. Scan your card to see what is next.',
    readyMessage: 'Starting this work.',
  },
  issue_document: {
    // `media_completed` re-opens it: watching first, then the questions print.
    actionable: (s) => s.state === 'created' || s.state === 'media_completed',
    doneMessage: () => 'That sheet is already printed. Scan your card if you need another copy.',
    readyMessage: 'Printing your sheet.',
  },
  media_action: {
    // NOT while it is playing: the idempotency matrix requires that a re-scan
    // mid-play never dispatches a second time.
    actionable: (s) => s.state === 'created' || s.state === 'media_stalled',
    doneMessage: (s) => (s.state === 'media_dispatched'
      ? 'It is already playing. Enjoy!'
      : 'You already watched this one. Scan your card to see what is next.'),
    readyMessage: 'Starting your video.',
  },
  remediation: {
    actionable: (s) => s.state === 'outcome_recorded' && s.outcome?.result === 'needs_remediation',
    doneMessage: () => 'There is nothing to try again right now. Scan your card to see what is next.',
    readyMessage: 'Printing a fresh sheet to try again.',
  },
  recovery: {
    // Open means anything before the session closes; a recovery scan only ever
    // reprints, so it is safe at every one of those states.
    actionable: (s) => !s.terminal,
    doneMessage: () => 'This work is all finished. Scan your card to see what is next.',
    readyMessage: 'Printing that again for you.',
  },
  subject_next: {
    // Sessionless: it names a learner + subject, not a session, so there is no
    // derived state to consult at all — resolveTokenState short-circuits this
    // class before the sessionState guard.
    actionable: () => true,
    doneMessage: () => 'Scan your card for a fresh list.',
    readyMessage: 'Finding the next thing for you.',
  },
  learning_action: {
    // A downloaded lesson may remain offline for months. The QR is therefore
    // repeatable; revocation and current downstream print/media policy remain
    // server-side. It is a locator for a low-risk action, never authentication.
    actionable: () => true,
    doneMessage: () => 'That lesson action is no longer available.',
    readyMessage: 'Starting that lesson action.',
  },
};

/**
 * Resolve what a scanned token can do right now.
 *
 * @param {object} record             the registry record from `mintToken`
 * @param {object} ctx
 * @param {object} [ctx.sessionState] derived state from `reduceSession`
 * @param {string} ctx.now            ISO current time (injected)
 * @returns {{ status: 'actionable'|'already_done'|'expired'|'unknown', message: string }}
 */
export function resolveTokenState(record, { sessionState = null, now } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { status: 'unknown', message: 'We do not know that ticket. Scan your card for a new list.' };
  }
  const semantics = TOKEN_CLASSES.includes(record.tokenClass)
    ? SEMANTICS[record.tokenClass]
    : null;
  if (!semantics) {
    return { status: 'unknown', message: 'We do not know that ticket. Scan your card for a new list.' };
  }
  // Checked before the identify short-circuit: a lost personal card has to be
  // cancellable, which is the whole reason revocation is a registry operation.
  if (record.revokedAt) {
    return { status: 'expired', message: 'That ticket is no longer in use. Scan your card for a new one.' };
  }
  if (record.tokenClass === 'identify') {
    return { status: 'actionable', message: semantics.readyMessage };
  }
  if (record.expiresAt && isIsoTimestamp(now) && Date.parse(now) > Date.parse(record.expiresAt)) {
    return { status: 'expired', message: 'That ticket is out of date. Scan your card for a new one.' };
  }
  if (record.tokenClass === 'subject_next' || record.tokenClass === 'learning_action') {
    // Sessionless, unlike identify it can still expire (checked above) — but it
    // never names a session, so there is no sessionState to require here.
    return { status: 'actionable', message: semantics.readyMessage };
  }
  if (!sessionState || typeof sessionState !== 'object') {
    return { status: 'unknown', message: 'We could not find that work. Scan your card for a new list.' };
  }
  return semantics.actionable(sessionState)
    ? { status: 'actionable', message: semantics.readyMessage }
    : { status: 'already_done', message: semantics.doneMessage(sessionState) };
}
