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
import { ValidationError } from '#domains/core/errors/index.mjs';
import { normalizeAccessCode } from './accessCode.mjs';

export const TOKEN_PREFIX = 'sch:';

/** Closed set — a new action class is a code change, never config. */
export const TOKEN_CLASSES = Object.freeze([
  'identify', 'select_unit', 'issue_document', 'media_action', 'remediation', 'recovery',
  'subject_next', 'learning_action', 'answer_sheet_lost', 'worksheet_companion',
  'agenda_print',
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
 * The boolean form of `normalizeAccessCode`, for reading records back.
 *
 * It calls the real rule rather than restating the pattern: a second `\d{6}`
 * here would be a second opinion about what a code is, and the two would drift
 * the first time the width changed. `normalizeAccessCode` reports by throwing
 * because it is a constructor guard; this wrapper is the predicate the read
 * path wants.
 */
const isAccessCodeShaped = (v) => {
  try {
    normalizeAccessCode(v);
    return true;
  } catch {
    return false;
  }
};

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
 * @param {string}   [args.accessCode]           six-digit panel alias (see accessCode.mjs);
 *                                               `subject_next` only
 * @param {string}   [args.accessCodeExpiresAt]  the code's own, shorter clock; required
 *                                               with `accessCode`, and never later than `expiresAt`
 * @returns {{ token: string, tokenClass: string, subject: object, issuedAt: string,
 *             expiresAt: string|null, revokedAt: null,
 *             accessCode?: string, accessCodeExpiresAt?: string }}
 *          The last two appear only when a code was supplied — a token without
 *          one keeps exactly the six keys it has always had.
 */
export function mintToken({
  tokenClass, subject, at, rng, expiresAt = null, accessCode = null, accessCodeExpiresAt = null,
} = {}) {
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
    accessCode, accessCodeExpiresAt,
  }, { caller: 'mintToken' });
}

/**
 * Validate and construct a record for an opaque body supplied by a security
 * adapter. This is used by deterministic, device-bound lesson-action tokens;
 * all class/subject/time invariants remain in the pure domain.
 */
export function createTokenRecord({
  token, tokenClass, subject, at, expiresAt = null, accessCode = null, accessCodeExpiresAt = null,
} = {}, { caller = 'createTokenRecord' } = {}) {
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
  } else if (tokenClass === 'worksheet_companion') {
    if (!isNonEmptyString(subject.learnerId)) throw new Error(`${caller}: worksheet_companion subject requires a learnerId`);
    if (!isNonEmptyString(subject.companionId)) throw new Error(`${caller}: worksheet_companion subject requires a companionId`);
    if (expiresAt == null) throw new Error(`${caller}: worksheet_companion token must expire`);
  } else if (tokenClass === 'learning_action') {
    if (!isNonEmptyString(subject.deviceId)) throw new Error(`${caller}: learning_action subject requires a deviceId`);
    if (!isNonEmptyString(subject.address)) throw new Error(`${caller}: learning_action subject requires an address`);
    if (!isNonEmptyString(subject.actionId)) throw new Error(`${caller}: learning_action subject requires an actionId`);
    if (!Number.isInteger(subject.tokenVersion) || subject.tokenVersion < 1 || subject.tokenVersion > 0xffff) {
      throw new Error(`${caller}: learning_action subject requires a 1..65535 tokenVersion`);
    }
    if (expiresAt != null) throw new Error(`${caller}: a persistent learning_action token never expires`);
  } else if (tokenClass === 'answer_sheet_lost') {
    if (!/^\d{7}$/.test(subject.cardId ?? '')) throw new Error(`${caller}: answer_sheet_lost subject requires a 7-digit cardId`);
    if (!isNonEmptyString(subject.authorizedBy)) throw new Error(`${caller}: answer_sheet_lost subject requires authorizedBy`);
    if (expiresAt == null) throw new Error(`${caller}: answer_sheet_lost token must expire`);
  } else if (tokenClass === 'agenda_print') {
    if (!isNonEmptyString(subject.learnerId)) {
      throw new ValidationError(`${caller}: agenda_print subject requires a learnerId`, {
        code: 'SCHOOL_TOKEN_SUBJECT_INVALID', details: { caller, tokenClass },
      });
    }
    if (!Array.isArray(subject.tokenRefs) || subject.tokenRefs.length === 0) {
      throw new ValidationError(`${caller}: agenda_print subject requires a non-empty tokenRefs array`, {
        code: 'SCHOOL_TOKEN_SUBJECT_INVALID', details: { caller, tokenClass },
      });
    }
    if (subject.tokenRefs.some((r) => typeof r !== 'string' || !r.startsWith(TOKEN_PREFIX))) {
      throw new ValidationError(`${caller}: agenda_print tokenRefs must all be sch:-prefixed strings`, {
        code: 'SCHOOL_TOKEN_SUBJECT_INVALID', details: { caller, tokenClass },
      });
    }
    if (new Set(subject.tokenRefs).size !== subject.tokenRefs.length) {
      throw new ValidationError(`${caller}: agenda_print tokenRefs contains duplicates`, {
        code: 'SCHOOL_TOKEN_SUBJECT_INVALID', details: { caller, tokenClass },
      });
    }
  } else if (!isNonEmptyString(subject.sessionId)) {
    throw new Error(`${caller}: ${tokenClass} subject requires a sessionId`);
  }
  // Class-specific too, and deliberately a whitelist: a panel code belongs to a
  // `subject_next` agenda line and nowhere else. It is also the only class that
  // reliably HAS an `expiresAt` for the code's clock to be shorter than —
  // `identify` and `learning_action` forbid an expiry outright, so a code on
  // those could never be held to the outlives-its-token rule below.
  if (accessCode != null && !['subject_next', 'worksheet_companion', 'agenda_print'].includes(tokenClass)) {
    throw new ValidationError(`${caller}: only a subject_next token carries an access code`, {
      code: 'SCHOOL_ACCESS_CODE_WRONG_CLASS', details: { caller, tokenClass },
    });
  }
  if (expiresAt != null && !isIsoTimestamp(expiresAt)) {
    throw new Error(`${caller}: expiresAt must be an ISO-8601 timestamp`);
  }

  let code = null;
  if (accessCode != null || accessCodeExpiresAt != null) {
    if (accessCode == null) {
      throw new ValidationError(`${caller}: accessCodeExpiresAt requires an accessCode`, {
        code: 'SCHOOL_ACCESS_CODE_MISSING_CODE', details: { caller, accessCodeExpiresAt },
      });
    }
    // Format is accessCode.mjs's business — delegated, not restated, so the panel
    // and the record can never disagree about what six digits means. Its typed
    // ValidationError propagates unwrapped. Checked BEFORE the clock, so a child
    // who mistyped is told the code is wrong rather than that the server is.
    code = normalizeAccessCode(accessCode);

    // The second clock is REQUIRED, never inherited from expiresAt. A
    // `subject_next` token lives for BuildAgenda's `subjectTokenTtlHours` — a
    // week by default — so the printed QR outlives the agenda it was printed on.
    // A code riding that clock would still be typable days later and would open
    // whatever the subject offers THAT day, contradicting the paper in the
    // child's hand.
    if (!isIsoTimestamp(accessCodeExpiresAt)) {
      throw new ValidationError(`${caller}: accessCode requires an ISO-8601 accessCodeExpiresAt`, {
        code: 'SCHOOL_ACCESS_CODE_MISSING_EXPIRY', details: { caller, accessCodeExpiresAt },
      });
    }

    // ...and REQUIRED to be the shorter of the two, which is the whole claim.
    // Let it run long and the two clocks disagree in the worst direction: the
    // panel finds the code and accepts it, then `resolveTokenState` calls the
    // very token it resolved to expired. Equal is allowed — equal is not longer.
    if (expiresAt != null && Date.parse(accessCodeExpiresAt) > Date.parse(expiresAt)) {
      throw new ValidationError(`${caller}: an access code may not outlive its token`, {
        code: 'SCHOOL_ACCESS_CODE_OUTLIVES_TOKEN',
        details: { caller, expiresAt, accessCodeExpiresAt },
      });
    }
  }

  // One exit, one object. The spread keeps the no-code record byte-identical to
  // the six-key one this function has always returned, without a second return
  // that a later `Object.freeze` or `toJSON` could be added to and miss.
  return {
    token, tokenClass, subject: structuredClone(subject), issuedAt: at, expiresAt, revokedAt: null,
    ...(code == null ? {} : { accessCode: code, accessCodeExpiresAt }),
  };
}

/**
 * Is the typed code still good?
 *
 * A code dies at the study-day rollover; its token lives for BuildAgenda's
 * `subjectTokenTtlHours` — a week by default. Two clocks on one record,
 * deliberately, and this predicate reads ONLY the shorter one.
 * `resolveTokenState` reads only the longer one, so a dead code never stops the
 * printed QR beside it from working.
 *
 * The two are also asymmetric AT their instants, on purpose. This one is
 * `now < accessCodeExpiresAt`, so a code is already dead the moment the study
 * day rolls over; `resolveTokenState` is `now > expiresAt`, so a token is still
 * alive at its own expiry instant. Do not "align" them: the code is meant to be
 * the stricter of the two, and closing that millisecond in the other direction
 * would hand a child a code that outlived the day it was printed for.
 *
 * Fails closed on anything it cannot read — a registry record can be older than
 * this code, hand-edited, or half-written — including on a code whose FORMAT is
 * wrong, using the same rule the constructor applies.
 *
 * Takes an options bag to match `resolveTokenState(record, { sessionState, now })`,
 * which Tasks 3 and 5 call alongside it.
 *
 * @param {object} record  the registry record
 * @param {object} [ctx]
 * @param {string} ctx.now ISO current time (injected — this module reads no clock)
 * @returns {boolean}
 */
export function isAccessCodeLive(record, { now } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (record.revokedAt) return false;
  // The mint-time whitelist again, on the way back out. A registry record can be
  // hand-edited past the constructor, and whoever resolves a code next expects a
  // `subject_next` SHAPE — a subject carrying both a learner and a subject. An
  // `identify` card wearing a code would resolve to a record with no
  // `subject.subject` at all, which is a lesson nobody can open.
  if (!['subject_next', 'worksheet_companion', 'agenda_print'].includes(record.tokenClass)) return false;
  if (!isAccessCodeShaped(record.accessCode)) return false;
  if (!isIsoTimestamp(record.accessCodeExpiresAt) || !isIsoTimestamp(now)) return false;
  // At the rollover it is already dead: the boundary belongs to the next day.
  return Date.parse(now) < Date.parse(record.accessCodeExpiresAt);
}

/**
 * Is the QR credential on a self-service card still live?
 *
 * This is deliberately NOT `isAccessCodeLive`. The digits and the QR printed
 * beside them have two clocks: the digits die at the study-day rollover while
 * the opaque ticket keeps the scanner's longer `expiresAt` lifetime. A camera
 * built into the panel is still reading the QR, so narrowing it to the digit
 * clock would make the same printed square mean two different things on two
 * scanners.
 *
 * Only token classes the panel already knows how to turn into a launch card
 * are accepted. Other `sch:` tickets still belong to the universal scanner
 * pipeline; putting one in front of this camera must not quietly give it new
 * self-service semantics.
 */
export function isSelfServiceQrTokenLive(record, { now } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (!TOKEN_PATTERN.test(record.token || '') || record.revokedAt) return false;
  if (!['subject_next', 'worksheet_companion', 'agenda_print'].includes(record.tokenClass)) return false;
  if (record.expiresAt == null) return true;
  if (!isIsoTimestamp(record.expiresAt) || !isIsoTimestamp(now)) return false;
  // Match resolveTokenState's QR boundary: the token is live AT its expiry
  // instant and dead only after it.
  return Date.parse(now) <= Date.parse(record.expiresAt);
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
  answer_sheet_lost: {
    actionable: () => true,
    doneMessage: () => 'That replacement ticket has already been used.',
    readyMessage: 'Replacing the lost answer sheet.',
  },
  agenda_print: {
    actionable: () => true,
    alreadyDone: () => false,
    readyMessage: 'Printing your sheets.',
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
  if (['subject_next', 'learning_action', 'answer_sheet_lost', 'agenda_print'].includes(record.tokenClass)) {
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
