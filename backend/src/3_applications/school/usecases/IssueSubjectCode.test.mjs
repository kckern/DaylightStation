// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { IssueSubjectCode } from './IssueSubjectCode.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const rng = (() => { let n = 0.137; return () => { n = (n * 9301 + 0.49297) % 1; return n; }; })();

function registry(live = []) {
  const records = [];
  return {
    records,
    async put(record) { records.push(record); },
    async liveAccessCodes() { return [...live, ...records.map((r) => r.accessCode)]; },
  };
}

describe('IssueSubjectCode', () => {
  const clock = () => new Date('2026-09-09T20:00:00Z');

  it('mints the same record the printed agenda would: subject_next, a six-digit code, rollover expiry, a use cap', async () => {
    const tokens = registry();
    const door = new IssueSubjectCode({ tokens, rng, clock, timezone: 'America/Los_Angeles', roster: () => [{ id: 'kid' }], logger: silent });
    const out = await door.execute({ learnerId: 'kid', subject: 'math' });
    expect(out.code).toMatch(/^\d{6}$/);
    expect(tokens.records[0]).toMatchObject({ tokenClass: 'subject_next', subject: { learnerId: 'kid', subject: 'math' }, accessCode: out.code, maxUses: 3 });
    // The code dies at the 4am rollover, the token keeps its week.
    expect(out.accessCodeExpiresAt).toBe('2026-09-10T11:00:00.000Z');
    expect(out.expiresAt).toBe('2026-09-16T20:00:00.000Z');
  });

  it('a reading disc mints the shelf code: continueToday, program book-log', async () => {
    const tokens = registry();
    const door = new IssueSubjectCode({ tokens, rng, clock, logger: silent });
    await door.execute({ learnerId: 'kid', subject: 'english', program: 'book-log' });
    expect(tokens.records[0].subject).toMatchObject({ learnerId: 'kid', subject: 'english', continueToday: true, program: 'book-log' });
  });

  it('never reissues a live code, and refuses a learner not on the roster', async () => {
    const tokens = registry();
    const door = new IssueSubjectCode({ tokens, rng, clock, roster: () => [{ id: 'kid' }], logger: silent });
    const a = await door.execute({ learnerId: 'kid', subject: 'math' });
    const b = await door.execute({ learnerId: 'kid', subject: 'math' });
    expect(a.code).not.toBe(b.code);
    await expect(door.execute({ learnerId: 'stranger', subject: 'math' })).rejects.toThrow(/learner/);
  });
});
