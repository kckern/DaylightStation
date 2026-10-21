import { describe, it, expect } from 'vitest';
import { HmacSchoolBookGrantIssuer } from "../../../../__app_modules/learning/school/server/adapters/actions/HmacSchoolBookGrantIssuer.mjs";
import { HmacSchoolDebriefGrantIssuer } from "../../../../__app_modules/learning/school/server/adapters/actions/HmacSchoolDebriefGrantIssuer.mjs";
const KEY = 'k'.repeat(32);
describe('HmacSchoolDebriefGrantIssuer', () => {
  it('verifies learner and an allowed day', () => {
    const g = new HmacSchoolDebriefGrantIssuer({ key: KEY, clock: () => 1000 });
    const t = g.issue({ learnerId: 'test-learner', days: ['2026-10-21', '2026-10-20'] });
    expect(g.verify(t, { learnerId: 'test-learner', day: '2026-10-20' }).ok).toBe(true);
    expect(g.verify(t, { learnerId: 'test-learner', day: '2026-10-19' })).toEqual({ ok: false, reason: 'day' });
    expect(g.verify(t, { learnerId: 'other', day: '2026-10-21' })).toEqual({ ok: false, reason: 'learnerId' });
  });
  it('expires and rejects tampering and other purposes', () => {
    let now = 1000; const g = new HmacSchoolDebriefGrantIssuer({ key: KEY, clock: () => now, ttlMs: 10 });
    const t = g.issue({ learnerId: 'test-learner', days: ['2026-10-21'] });
    expect(g.verify(`${t}x`, {}).reason).toBe('tampered');
    now = 2000; expect(g.verify(t, {}).reason).toBe('expired');
    // A book-shelf grant signed with the same key is a different key context: it never opens a debrief.
    const book = new HmacSchoolBookGrantIssuer({ key: KEY, clock: () => 1000 }).issue({ learnerId: 'test-learner' });
    expect(new HmacSchoolDebriefGrantIssuer({ key: KEY, clock: () => 1000 }).verify(book, {}).reason).toBe('tampered');
  });
  it('refuses a short key and an empty day list', () => {
    expect(() => new HmacSchoolDebriefGrantIssuer({ key: 'short' })).toThrow();
    expect(() => new HmacSchoolDebriefGrantIssuer({ key: KEY }).issue({ learnerId: 'x', days: [] })).toThrow();
  });
});
