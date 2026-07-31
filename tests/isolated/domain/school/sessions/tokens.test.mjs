import { describe, it, expect } from 'vitest';
import {
  TOKEN_CLASSES,
  TOKEN_PREFIX,
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
      'identify', 'select_unit', 'issue_document', 'media_action', 'remediation', 'recovery', 'subject_next',
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
    TOKEN_CLASSES.filter((c) => c !== 'identify' && c !== 'subject_next').forEach((tokenClass) => {
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
      subject: { learnerId: 'felix', subject: 'math' },
      at, rng, expiresAt: '2026-08-05T16:00:00Z',
    });
    expect(rec.token.startsWith('sch:')).toBe(true);
    expect(rec.subject).toEqual({ learnerId: 'felix', subject: 'math' });
  });
  it('requires learnerId and subject', () => {
    expect(() => mintToken({ tokenClass: 'subject_next', subject: { learnerId: 'felix' }, at, rng }))
      .toThrow(/subject/);
    expect(() => mintToken({ tokenClass: 'subject_next', subject: { subject: 'math' }, at, rng }))
      .toThrow(/learnerId/);
  });
  it('resolves actionable without any sessionState', () => {
    const rec = mintToken({ tokenClass: 'subject_next', subject: { learnerId: 'felix', subject: 'math' }, at, rng, expiresAt: '2026-08-05T16:00:00Z' });
    expect(resolveTokenState(rec, { now: '2026-07-30T16:00:00Z' }).status).toBe('actionable');
  });
  it('still expires', () => {
    const rec = mintToken({ tokenClass: 'subject_next', subject: { learnerId: 'felix', subject: 'math' }, at, rng, expiresAt: '2026-07-30T16:00:00Z' });
    expect(resolveTokenState(rec, { now: '2026-08-01T00:00:00Z' }).status).toBe('expired');
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
