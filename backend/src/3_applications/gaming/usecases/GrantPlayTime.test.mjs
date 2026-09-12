import { describe, it, expect, beforeEach } from 'vitest';
import { GrantPlayTime } from './GrantPlayTime.mjs';

const quiet = { info() {} };
let rows;
const ledger = {
  forUserOn: async () => ({
    grantedMs: rows.reduce((t, r) => t + r.deltaMs, 0), entries: rows,
  }),
  append: async (_u, _d, entry) => { rows.push(entry); return entry; },
};
const build = () => new GrantPlayTime({ ledger, today: () => '2026-09-11', logger: quiet });

beforeEach(() => { rows = []; });

describe('GrantPlayTime', () => {
  it('grants time', async () => {
    const r = await build().execute({ userId: 'child', minutes: 20, by: 'parent' });
    expect(r.grantedMs).toBe(20 * 60_000);
  });

  it('extends by adding, not replacing', async () => {
    const uc = build();
    await uc.execute({ userId: 'child', minutes: 20 });
    const r = await uc.execute({ userId: 'child', minutes: 10 });
    expect(r.grantedMs).toBe(30 * 60_000);
    expect(rows).toHaveLength(2);
  });

  it('revokes by writing a negative entry, leaving both visible', async () => {
    const uc = build();
    await uc.execute({ userId: 'child', minutes: 30, by: 'parent', reason: 'chores done' });
    await uc.execute({ userId: 'child', minutes: -10, by: 'parent', reason: 'was rude' });
    expect(rows.map((r) => r.deltaMs)).toEqual([1_800_000, -600_000]);
    expect(rows[1].reason).toBe('was rude');
  });

  it('never drives the balance below zero — nothing here collects debts', async () => {
    const uc = build();
    await uc.execute({ userId: 'child', minutes: 10 });
    const r = await uc.execute({ userId: 'child', minutes: -60 });
    expect(r.grantedMs).toBe(0);
    expect(rows[1].deltaMs).toBe(-600_000);
  });

  it('does nothing when there is nothing left to take', async () => {
    const r = await build().execute({ userId: 'child', minutes: -30 });
    expect(r.changedMs).toBe(0);
    expect(rows).toEqual([]);
  });

  it('records who authorised it and why', async () => {
    await build().execute({ userId: 'child', minutes: 15, by: 'parent', reason: 'reading' });
    expect(rows[0]).toMatchObject({ by: 'parent', reason: 'reading' });
  });

  it('rejects a no-op or nonsense amount', async () => {
    await expect(build().execute({ userId: 'child', minutes: 0 })).rejects.toThrow(/non-zero/);
    await expect(build().execute({ minutes: 5 })).rejects.toThrow(/userId/);
  });
});
