import { describe, it, expect } from 'vitest';
import {
  TOKEN_CLASSES,
  TOKEN_PREFIX,
  createTokenRecord,
  isAccessCodeLive,
  isSchoolToken,
  mintToken,
  resolveTokenState,
} from '#domains/school/sessions/tokens.mjs';

const AT = '2026-07-27T10:00:00.000Z';
const SID = 'ses_abc123';

/** Deterministic rng: cycles a fixed ladder of draws, so mints are reproducible. */
const seededRng = (seed = 1) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
};
const constantRng = (v) => () => v;

const mint = (over = {}) => mintToken({
  tokenClass: 'issue_document', subject: { sessionId: SID }, at: AT, rng: seededRng(), ...over,
});

/** Derived session state, as `reduceSession` would produce it. */
const session = (state, over = {}) => ({ sessionId: SID, state, terminal: false, outcome: null, ...over });

describe('TOKEN_CLASSES', () => {
  it('is the closed spec §6.1 set', () => {
    expect(TOKEN_CLASSES).toEqual([
      'identify', 'select_unit', 'issue_document', 'media_action', 'remediation', 'recovery',
      'subject_next', 'learning_action', 'answer_sheet_lost', 'worksheet_companion',
      'agenda_print',
    ]);
  });

  it('is frozen — a new action class is a code change, never config', () => {
    expect(Object.isFrozen(TOKEN_CLASSES)).toBe(true);
  });
});

describe('isSchoolToken', () => {
  it('recognises the sch: prefix the relay branches on', () => {
    expect(TOKEN_PREFIX).toBe('sch:');
    expect(isSchoolToken('sch:ABCD2345')).toBe(true);
  });

  it('rejects everything else the scanners in the house emit', () => {
    ['0123456789012', 'plex:1234', 'nutribot:x', '', null, undefined, 7, {}, 'SCH:ABCD']
      .forEach((code) => expect(isSchoolToken(code)).toBe(false));
  });

  it('tolerates the whitespace a scanner can append', () => {
    expect(isSchoolToken(' sch:ABCD2345\r\n')).toBe(true);
  });
});

describe('mintToken', () => {
  it('mints a prefixed, opaque token with its class, subject and issue time', () => {
    const record = mint();
    expect(record.token.startsWith('sch:')).toBe(true);
    expect(record.tokenClass).toBe('issue_document');
    expect(record.subject).toEqual({ sessionId: SID });
    expect(record.issuedAt).toBe(AT);
    expect(record.expiresAt).toBe(null);
    expect(record.revokedAt).toBe(null);
  });

  it('draws every opaque character from the injected rng — no crypto, no clock', () => {
    const a = mintToken({ tokenClass: 'recovery', subject: { sessionId: SID }, at: AT, rng: constantRng(0) });
    const b = mintToken({ tokenClass: 'recovery', subject: { sessionId: SID }, at: AT, rng: constantRng(0.999999) });
    expect(a.token).not.toBe(b.token);
    expect(new Set(a.token.slice(4)).size).toBe(1); // one draw value => one repeated char
  });

  it('mints an unambiguous, scanner-safe body of fixed length', () => {
    const body = mint({ rng: seededRng(42) }).token.slice(TOKEN_PREFIX.length);
    expect(body).toMatch(/^[A-Z0-9]{16}$/);
    // 0/O and 1/I are excluded: a mis-keyed token is a child at a dead end.
    expect(body).not.toMatch(/[OI]/);
  });

  it('ENCODES NOTHING: two different subjects on the same rng stream mint the same body', () => {
    const a = mintToken({ tokenClass: 'identify', subject: { learnerId: 'kid1' }, at: AT, rng: seededRng(7) });
    const b = mintToken({ tokenClass: 'identify', subject: { learnerId: 'a-completely-different-child' }, at: AT, rng: seededRng(7) });
    expect(a.token).toBe(b.token);
  });

  it('leaks no part of the subject, class, or time into the printed code', () => {
    const record = mintToken({
      tokenClass: 'media_action',
      subject: { sessionId: 'ses_ZEBRA', learnerId: 'kid1', unitId: 'math-add-1' },
      at: AT,
      rng: seededRng(3),
    });
    const body = record.token.slice(TOKEN_PREFIX.length);
    ['ZEBRA', 'KID1', 'MATH', 'MEDIA', '2026'].forEach((needle) => {
      expect(body).not.toContain(needle);
    });
  });

  it('yields different tokens on successive draws from one stream', () => {
    const rng = seededRng(11);
    const tokens = new Set([1, 2, 3, 4, 5].map(() => mint({ rng }).token));
    expect(tokens.size).toBe(5);
  });

  it('carries an expiry when one is supplied', () => {
    expect(mint({ expiresAt: '2026-07-28T00:00:00.000Z' }).expiresAt).toBe('2026-07-28T00:00:00.000Z');
  });

  it('rejects an unknown token class', () => {
    expect(() => mint({ tokenClass: 'teleport' })).toThrow(/unknown token class: teleport/);
  });

  it('requires an rng — randomness is injected so the domain stays pure and testable', () => {
    expect(() => mintToken({ tokenClass: 'recovery', subject: { sessionId: SID }, at: AT }))
      .toThrow(/rng/);
  });

  it('requires an ISO issue time — the domain never reads the clock', () => {
    expect(() => mintToken({ tokenClass: 'recovery', subject: { sessionId: SID }, rng: seededRng() }))
      .toThrow(/at/);
  });

  it('requires a learnerId subject for identify and a sessionId subject for the rest', () => {
    expect(() => mint({ tokenClass: 'identify', subject: { sessionId: SID } })).toThrow(/learnerId/);
    expect(() => mint({ tokenClass: 'recovery', subject: { learnerId: 'kid1' } })).toThrow(/sessionId/);
    expect(mintToken({ tokenClass: 'identify', subject: { learnerId: 'kid1' }, at: AT, rng: seededRng() }).tokenClass)
      .toBe('identify');
  });

  it('refuses an expiry on a personal card — it is reusable forever', () => {
    expect(() => mintToken({
      tokenClass: 'identify', subject: { learnerId: 'kid1' }, at: AT, rng: seededRng(), expiresAt: AT,
    })).toThrow(/never expires/);
  });
});

describe('resolveTokenState: unresolvable', () => {
  it('is unknown for a missing record — the scan still gets a printed explanation', () => {
    const out = resolveTokenState(null, { sessionState: session('created'), now: AT });
    expect(out.status).toBe('unknown');
    expect(out.message.length).toBeGreaterThan(0);
  });

  it('is unknown for a record with an unrecognised class', () => {
    expect(resolveTokenState({ tokenClass: 'teleport', subject: {} }, { now: AT }).status).toBe('unknown');
  });

  it('is expired for a revoked token', () => {
    const record = { ...mint(), revokedAt: AT };
    expect(resolveTokenState(record, { sessionState: session('created'), now: AT }).status).toBe('expired');
  });

  it('is expired once `now` is past the recorded expiry', () => {
    const record = mint({ expiresAt: '2026-07-27T11:00:00.000Z' });
    expect(resolveTokenState(record, { sessionState: session('created'), now: '2026-07-27T10:59:00.000Z' }).status)
      .toBe('actionable');
    expect(resolveTokenState(record, { sessionState: session('created'), now: '2026-07-27T11:00:01.000Z' }).status)
      .toBe('expired');
  });

  it('is unknown when the token names a session that cannot be found', () => {
    expect(resolveTokenState(mint(), { sessionState: null, now: AT }).status).toBe('unknown');
  });
});

describe('resolveTokenState: identify', () => {
  const card = () => mintToken({ tokenClass: 'identify', subject: { learnerId: 'kid1' }, at: AT, rng: seededRng() });

  it('is always actionable — no expiry, reusable forever', () => {
    expect(resolveTokenState(card(), { sessionState: null, now: AT }).status).toBe('actionable');
    expect(resolveTokenState(card(), { sessionState: null, now: '2099-01-01T00:00:00.000Z' }).status)
      .toBe('actionable');
  });

  it('stays actionable regardless of any session state', () => {
    ['created', 'issued', 'graded', 'abandoned', 'rewarded'].forEach((state) => {
      expect(resolveTokenState(card(), { sessionState: session(state, { terminal: true }), now: AT }).status)
        .toBe('actionable');
    });
  });

  it('is still refused once revoked — a lost card must be cancellable', () => {
    expect(resolveTokenState({ ...card(), revokedAt: AT }, { now: AT }).status).toBe('expired');
  });
});

describe('resolveTokenState: renewable action classes', () => {
  const at = (tokenClass, state, over = {}) => resolveTokenState(
    mint({ tokenClass }), { sessionState: session(state, over), now: AT },
  );

  it('select_unit is actionable only while the session has not started work', () => {
    expect(at('select_unit', 'created').status).toBe('actionable');
    expect(at('select_unit', 'issued').status).toBe('already_done');
    expect(at('select_unit', 'submitted').status).toBe('already_done');
  });

  it('issue_document is actionable before printing and again after the media is done', () => {
    expect(at('issue_document', 'created').status).toBe('actionable');
    expect(at('issue_document', 'media_completed').status).toBe('actionable');
    expect(at('issue_document', 'issued').status).toBe('already_done');
    expect(at('issue_document', 'graded').status).toBe('already_done');
  });

  it('media_action is actionable before dispatch and after a stall, never mid-play', () => {
    expect(at('media_action', 'created').status).toBe('actionable');
    expect(at('media_action', 'media_stalled').status).toBe('actionable');
    // Idempotency matrix: re-scan mid-play must not dispatch a second time.
    expect(at('media_action', 'media_dispatched').status).toBe('already_done');
    expect(at('media_action', 'media_completed').status).toBe('already_done');
  });

  it('remediation is actionable only once an outcome asked for it', () => {
    expect(at('remediation', 'outcome_recorded', { outcome: { result: 'needs_remediation' } }).status)
      .toBe('actionable');
    expect(at('remediation', 'outcome_recorded', { outcome: { result: 'passed' } }).status).toBe('already_done');
    expect(at('remediation', 'graded').status).toBe('already_done');
    expect(at('remediation', 'remediation_opened', { terminal: true }).status).toBe('already_done');
  });

  it('an advanced state is never an error — the message is friendly and points somewhere', () => {
    // identify and subject_next are both sessionless short-circuits (never
    // reach the sessionState-driven actionable/done split this test exercises).
    // `worksheet_companion` is sessionless for the same reason — it is keyed by
    // learner + companion, not by a session, and `tokens.mjs` groups it with
    // `subject_next` everywhere it matters (access codes, renewability).
    // `agenda_print` is sessionless too — it is a bulk-print fan-out keyed by
    // the agenda's refs, not by any one session.
    TOKEN_CLASSES.filter((c) => !['identify', 'subject_next', 'learning_action', 'answer_sheet_lost', 'worksheet_companion', 'agenda_print'].includes(c)).forEach((tokenClass) => {
      const out = at(tokenClass, 'rewarded', { terminal: true });
      expect(out.status).toBe('already_done');
      expect(out.message.length).toBeGreaterThan(0);
      expect(out.message.toLowerCase()).not.toMatch(/error|invalid|denied|failed/);
    });
  });

  it('re-scanning while still valid stays actionable — the action re-executes idempotently', () => {
    const record = mint({ tokenClass: 'issue_document' });
    const first = resolveTokenState(record, { sessionState: session('created'), now: AT });
    const second = resolveTokenState(record, { sessionState: session('created'), now: AT });
    expect(first).toEqual(second);
    expect(second.status).toBe('actionable');
  });
});

describe('subject_next tokens', () => {
  const at = '2026-07-29T16:00:00Z';
  const rng = () => 0.5;
  it('mints with a learnerId + subject and no session', () => {
    const rec = mintToken({
      tokenClass: 'subject_next',
      subject: { learnerId: 'learner4', subject: 'math' },
      at, rng, expiresAt: '2026-08-05T16:00:00Z',
    });
    expect(rec.token.startsWith('sch:')).toBe(true);
    expect(rec.subject).toEqual({ learnerId: 'learner4', subject: 'math' });
  });
  it('requires learnerId and subject', () => {
    expect(() => mintToken({ tokenClass: 'subject_next', subject: { learnerId: 'learner4' }, at, rng }))
      .toThrow(/subject/);
    expect(() => mintToken({ tokenClass: 'subject_next', subject: { subject: 'math' }, at, rng }))
      .toThrow(/learnerId/);
  });
  it('resolves actionable without any sessionState', () => {
    const rec = mintToken({ tokenClass: 'subject_next', subject: { learnerId: 'learner4', subject: 'math' }, at, rng, expiresAt: '2026-08-05T16:00:00Z' });
    expect(resolveTokenState(rec, { now: '2026-07-30T16:00:00Z' }).status).toBe('actionable');
  });
  it('still expires', () => {
    const rec = mintToken({ tokenClass: 'subject_next', subject: { learnerId: 'learner4', subject: 'math' }, at, rng, expiresAt: '2026-07-30T16:00:00Z' });
    expect(resolveTokenState(rec, { now: '2026-08-01T00:00:00Z' }).status).toBe('expired');
  });
});

describe('learning_action tokens', () => {
  const subject = {
    deviceId: 'SC86A001', address: 'main/physics/mechanics/motion/velocity',
    actionId: 'worksheet:velocity', tokenVersion: 1,
  };

  it('admits a security-adapter supplied opaque body without encoding its subject', () => {
    const record = createTokenRecord({
      token: 'sch:23456789ABCDEFGH', tokenClass: 'learning_action', subject, at: AT,
    });
    expect(record).toMatchObject({ tokenClass: 'learning_action', subject, expiresAt: null, revokedAt: null });
    Object.values(subject).forEach((value) => expect(record.token).not.toContain(String(value)));
    expect(resolveTokenState(record, { now: '2099-01-01T00:00:00Z' }).status).toBe('actionable');
  });

  it('requires the complete stable binding and forbids expiry', () => {
    expect(() => createTokenRecord({
      token: 'sch:23456789ABCDEFGH', tokenClass: 'learning_action', subject: { ...subject, deviceId: '' }, at: AT,
    })).toThrow(/deviceId/);
    expect(() => createTokenRecord({
      token: 'sch:23456789ABCDEFGH', tokenClass: 'learning_action', subject, at: AT, expiresAt: '2099-01-01T00:00:00Z',
    })).toThrow(/never expires/);
    expect(() => createTokenRecord({
      token: 'sch:OOOOOOOOOOOOOOOO', tokenClass: 'learning_action', subject, at: AT,
    })).toThrow(/opaque 16-character/);
  });

  it('remains repeatable but fails closed after registry revocation', () => {
    const record = createTokenRecord({
      token: 'sch:23456789ABCDEFGH', tokenClass: 'learning_action', subject, at: AT,
    });
    expect(resolveTokenState(record, { now: AT }).status).toBe('actionable');
    expect(resolveTokenState(record, { now: AT }).status).toBe('actionable');
    expect(resolveTokenState({ ...record, revokedAt: AT }, { now: AT }).status).toBe('expired');
  });
});

describe('resolveTokenState: recovery', () => {
  it('is actionable at every open state — it only ever reprints', () => {
    ['created', 'issued', 'reprinted', 'media_dispatched', 'media_stalled', 'submitted', 'graded', 'outcome_recorded']
      .forEach((state) => {
        expect(resolveTokenState(mint({ tokenClass: 'recovery' }), { sessionState: session(state), now: AT }).status)
          .toBe('actionable');
      });
  });

  it('is already_done once the session is closed', () => {
    ['rewarded', 'remediation_opened', 'abandoned'].forEach((state) => {
      const out = resolveTokenState(
        mint({ tokenClass: 'recovery' }), { sessionState: session(state, { terminal: true }), now: AT },
      );
      expect(out.status).toBe('already_done');
    });
  });
});

describe('access code on a token record', () => {
  const base = {
    tokenClass: 'subject_next',
    subject: { learnerId: 'test-user', subject: 'mathematics' },
    at: '2026-08-20T16:00:00Z',
    expiresAt: '2026-08-27T16:00:00Z', // the QR's week
  };
  const TOKEN = 'sch:ABCDEFGHJKLMNPQR';
  const CODE = '481920';
  const CODE_EXPIRES = '2026-08-21T06:00:00Z'; // the code's study day

  const withCode = (over = {}) => createTokenRecord({
    token: TOKEN, ...base, accessCode: CODE, accessCodeExpiresAt: CODE_EXPIRES, ...over,
  });

  it('carries accessCode and accessCodeExpiresAt onto the record', () => {
    const record = withCode();
    expect(record.accessCode).toBe(CODE);
    expect(record.accessCodeExpiresAt).toBe(CODE_EXPIRES);
    // The token's own week is untouched by the code's day.
    expect(record.expiresAt).toBe(base.expiresAt);
  });

  it.each([
    ['too short', '4819'],
    ['too long', '4819201'],
    ['non-digits', '48192a'],
    ['padded with spaces', ' 481920 '],
    ['a number, not a string', 481920],
    ['empty', ''],
  ])('rejects a malformed code (%s)', (_label, accessCode) => {
    expect(() => withCode({ accessCode }))
      .toThrow(expect.objectContaining({ code: 'INVALID_SCHOOL_ACCESS_CODE' }));
  });

  it.each([
    ['omitted', undefined],
    ['null', null],
    ['not a timestamp', 'tomorrow'],
    ['empty', ''],
  ])('rejects a code whose study-day clock is %s', (_label, accessCodeExpiresAt) => {
    expect(() => createTokenRecord({ token: TOKEN, ...base, accessCode: CODE, accessCodeExpiresAt }))
      .toThrow(expect.objectContaining({ code: 'SCHOOL_ACCESS_CODE_MISSING_EXPIRY' }));
  });

  it('rejects a clock with no code to expire', () => {
    expect(() => createTokenRecord({ token: TOKEN, ...base, accessCodeExpiresAt: CODE_EXPIRES }))
      .toThrow(expect.objectContaining({ code: 'SCHOOL_ACCESS_CODE_MISSING_CODE' }));
  });

  it('reports a malformed code before a missing clock — format is the first question', () => {
    // Both rules are broken at once. If the order ever flips, a child who typed
    // a bad code is told the SERVER is misconfigured.
    expect(() => createTokenRecord({
      token: TOKEN, ...base, accessCode: 'abc', accessCodeExpiresAt: null,
    })).toThrow(expect.objectContaining({ code: 'INVALID_SCHOOL_ACCESS_CODE' }));
  });

  it.each([
    ['a day later', '2026-08-28T16:00:00Z'],
    ['a month later', '2026-09-30T16:00:00Z'],
    ['one millisecond later', '2026-08-27T16:00:00.001Z'],
  ])('refuses a code clock that outlives the token clock (%s)', (_label, accessCodeExpiresAt) => {
    // The invariant this whole record is named for. Without it the panel accepts
    // the code, then resolution calls the same token expired.
    expect(() => withCode({ accessCodeExpiresAt }))
      .toThrow(expect.objectContaining({ code: 'SCHOOL_ACCESS_CODE_OUTLIVES_TOKEN' }));
  });

  it('allows a code clock that lands exactly on the token clock', () => {
    // Equal is not longer. A same-day token is legal, if pointless.
    expect(withCode({ accessCodeExpiresAt: base.expiresAt }).accessCodeExpiresAt).toBe(base.expiresAt);
  });

  it.each([
    ['identify', { learnerId: 'test-user' }, null],
    ['select_unit', { sessionId: 'ses_abc123' }, null],
    ['issue_document', { sessionId: 'ses_abc123' }, null],
    ['media_action', { sessionId: 'ses_abc123' }, null],
    ['remediation', { sessionId: 'ses_abc123' }, null],
    ['recovery', { sessionId: 'ses_abc123' }, null],
    ['learning_action', {
      deviceId: 'dev1', address: 'a/b', actionId: 'act1', tokenVersion: 1,
    }, null],
    ['answer_sheet_lost', { cardId: '1234567', authorizedBy: 'test-user' }, '2026-08-27T16:00:00Z'],
  ])('refuses an access code on a %s token', (tokenClass, subject, expiresAt) => {
    // Only a subject_next agenda line carries a code. The other classes either
    // forbid an expiry outright or name a session, so there is nothing for the
    // code's shorter clock to be shorter THAN.
    expect(() => createTokenRecord({
      token: TOKEN, tokenClass, subject, at: base.at, expiresAt,
      accessCode: CODE, accessCodeExpiresAt: CODE_EXPIRES,
    })).toThrow(expect.objectContaining({ code: 'SCHOOL_ACCESS_CODE_WRONG_CLASS' }));
  });

  it('reports the wrong class before a malformed code — a code on this class was never typed', () => {
    // Both rules are broken at once, and the class wins deliberately. The panel
    // only ever reads codes off `subject_next` records, so a code on `identify`
    // did not come from a child's keystrokes — it can only have come from a
    // miswired call site. Calling it a format error would send a developer to
    // fix six digits when the real defect is that nothing should be passing a
    // code here at all.
    expect(() => createTokenRecord({
      token: TOKEN, tokenClass: 'identify', subject: { learnerId: 'test-user' },
      at: base.at, accessCode: 'abc', accessCodeExpiresAt: null,
    })).toThrow(expect.objectContaining({ code: 'SCHOOL_ACCESS_CODE_WRONG_CLASS' }));
  });

  it('leaves those classes untouched when no code is supplied', () => {
    const card = createTokenRecord({ token: TOKEN, tokenClass: 'identify', subject: { learnerId: 'test-user' }, at: base.at });
    expect(Object.keys(card)).toEqual([
      'token', 'tokenClass', 'subject', 'issuedAt', 'expiresAt', 'revokedAt',
    ]);
  });

  it('leaves a record with neither field exactly as it is today', () => {
    const record = createTokenRecord({ token: TOKEN, ...base });
    expect(Object.keys(record)).toEqual([
      'token', 'tokenClass', 'subject', 'issuedAt', 'expiresAt', 'revokedAt',
    ]);
    expect(record).toEqual({
      token: TOKEN,
      tokenClass: 'subject_next',
      subject: base.subject,
      issuedAt: base.at,
      expiresAt: base.expiresAt,
      revokedAt: null,
    });
    expect(record.subject).not.toBe(base.subject);
  });

  it('kills the code at the study-day rollover while the printed QR keeps resolving', () => {
    const record = withCode();
    const now = '2026-08-21T09:00:00Z'; // past the code's day, inside the token's week
    expect(isAccessCodeLive(record, { now })).toBe(false);
    expect(resolveTokenState(record, { now }).status).toBe('actionable');
  });

  it('is live before the rollover', () => {
    expect(isAccessCodeLive(withCode(), { now: '2026-08-20T18:00:00Z' })).toBe(true);
  });

  it('is dead exactly AT the rollover, not a moment after', () => {
    expect(isAccessCodeLive(withCode(), { now: CODE_EXPIRES })).toBe(false);
  });

  it('is false for a revoked record even before the code expires', () => {
    const record = { ...withCode(), revokedAt: '2026-08-20T17:00:00Z' };
    expect(isAccessCodeLive(record, { now: '2026-08-20T18:00:00Z' })).toBe(false);
  });

  it.each([
    ['a record with no code at all', () => createTokenRecord({ token: TOKEN, ...base })],
    ['null', () => null],
    ['undefined', () => undefined],
    ['an array', () => []],
  ])('is false for %s', (_label, make) => {
    expect(isAccessCodeLive(make(), { now: '2026-08-20T18:00:00Z' })).toBe(false);
  });

  it.each([
    ['unparseable accessCodeExpiresAt', { accessCodeExpiresAt: 'not-a-date' }],
    ['missing accessCodeExpiresAt', { accessCodeExpiresAt: null }],
    ['missing accessCode', { accessCode: null }],
    // Item 8: a hand-edited registry record can hold anything. The predicate
    // applies the SAME format rule the constructor delegates to, not a laxer one.
    ['a word for an accessCode', { accessCode: 'hello' }],
    ['a short accessCode', { accessCode: '4819' }],
    ['a long accessCode', { accessCode: '4819201' }],
    ['a padded accessCode', { accessCode: ' 481920 ' }],
    ['a numeric accessCode', { accessCode: 481920 }],
  ])('is false when the record is malformed after the fact (%s)', (_label, over) => {
    // Records reach this predicate from the registry, not only from the constructor.
    expect(isAccessCodeLive({ ...withCode(), ...over }, { now: '2026-08-20T18:00:00Z' })).toBe(false);
  });

  it.each([
    'identify', 'select_unit', 'issue_document', 'media_action', 'remediation', 'recovery',
    'learning_action', 'answer_sheet_lost',
  ])('is false for a hand-edited %s record carrying a code', (tokenClass) => {
    // The mint-time whitelist says a panel code belongs to a subject_next line
    // and nowhere else. A registry record can be hand-edited past that gate, and
    // whoever resolves the code next expects a subject_next SHAPE — a subject
    // with a `subject` on it. The read path mirrors the mint rule rather than
    // trusting that nothing ever wrote around it.
    expect(isAccessCodeLive({ ...withCode(), tokenClass }, { now: '2026-08-20T18:00:00Z' })).toBe(false);
  });

  it('is false for an unparseable now', () => {
    expect(isAccessCodeLive(withCode(), { now: 'whenever' })).toBe(false);
  });

  it('takes an options bag like resolveTokenState, and fails closed without one', () => {
    // Tasks 3 and 5 call this beside `resolveTokenState(record, { sessionState, now })`.
    // A bare positional string must not quietly keep working during that move.
    expect(isAccessCodeLive(withCode())).toBe(false);
    expect(isAccessCodeLive(withCode(), {})).toBe(false);
    expect(isAccessCodeLive(withCode(), '2026-08-20T18:00:00Z')).toBe(false);
  });

  it('threads both fields through mintToken', () => {
    const record = mintToken({
      ...base, rng: seededRng(), accessCode: CODE, accessCodeExpiresAt: CODE_EXPIRES,
    });
    expect(record.accessCode).toBe(CODE);
    expect(record.accessCodeExpiresAt).toBe(CODE_EXPIRES);
    expect(record.token).toMatch(/^sch:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{16}$/);
  });

  it('mintToken still refuses a code with no clock', () => {
    expect(() => mintToken({ ...base, rng: seededRng(), accessCode: CODE }))
      .toThrow(expect.objectContaining({ code: 'SCHOOL_ACCESS_CODE_MISSING_EXPIRY' }));
  });
});

describe('agenda_print', () => {
  const REFS = ['sch:AAAA2222BBBB3333', 'sch:CCCC4444DDDD5555'];

  it('mints with learnerId + tokenRefs subject', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'test-user', tokenRefs: REFS },
      at: AT, rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    expect(record.tokenClass).toBe('agenda_print');
    expect(record.subject.learnerId).toBe('test-user');
    expect(record.subject.tokenRefs).toEqual(REFS);
  });

  it('rejects missing learnerId', () => {
    expect(() => mintToken({
      tokenClass: 'agenda_print',
      subject: { tokenRefs: REFS },
      at: AT, rng: seededRng(),
    })).toThrow(/learnerId/);
  });

  it('rejects empty tokenRefs', () => {
    expect(() => mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'test-user', tokenRefs: [] },
      at: AT, rng: seededRng(),
    })).toThrow(/tokenRefs/);
  });

  it('rejects non-sch: prefixed refs', () => {
    expect(() => mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'test-user', tokenRefs: ['bad:token'] },
      at: AT, rng: seededRng(),
    })).toThrow(/tokenRefs/);
  });

  it('rejects duplicate tokenRefs', () => {
    expect(() => mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'test-user', tokenRefs: [REFS[0], REFS[0]] },
      at: AT, rng: seededRng(),
    })).toThrow(/duplicate/i);
  });

  it('accepts an access code (unlike other non-subject_next classes)', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'test-user', tokenRefs: REFS },
      at: AT, rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
      accessCode: '123456',
      accessCodeExpiresAt: '2026-07-28T04:00:00.000Z',
    });
    expect(record.accessCode).toBe('123456');
  });

  it('does not require sessionId', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'test-user', tokenRefs: REFS },
      at: AT, rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    expect(record.subject.sessionId).toBeUndefined();
  });
});

describe('isAccessCodeLive — agenda_print', () => {
  const bulkRecord = mintToken({
    tokenClass: 'agenda_print',
    subject: { learnerId: 'test-user', tokenRefs: ['sch:AAAA2222BBBB3333'] },
    at: '2026-07-27T10:00:00.000Z', rng: seededRng(),
    expiresAt: '2026-07-28T10:00:00.000Z',
    accessCode: '654321',
    accessCodeExpiresAt: '2026-07-28T04:00:00.000Z',
  });

  it('returns true for a live bulk code', () => {
    expect(isAccessCodeLive(bulkRecord, { now: '2026-07-27T12:00:00.000Z' })).toBe(true);
  });

  it('returns false after the code expires', () => {
    expect(isAccessCodeLive(bulkRecord, { now: '2026-07-28T04:00:01.000Z' })).toBe(false);
  });
});

describe('resolveTokenState — agenda_print', () => {
  it('is actionable without sessionState', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'test-user', tokenRefs: ['sch:AAAA2222BBBB3333'] },
      at: '2026-07-27T10:00:00.000Z', rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    const result = resolveTokenState(record, { now: '2026-07-27T12:00:00.000Z' });
    expect(result.status).toBe('actionable');
  });

  it('is expired after expiresAt', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'test-user', tokenRefs: ['sch:AAAA2222BBBB3333'] },
      at: '2026-07-27T10:00:00.000Z', rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    const result = resolveTokenState(record, { now: '2026-07-29T00:00:00.000Z' });
    expect(result.status).toBe('expired');
  });
});
