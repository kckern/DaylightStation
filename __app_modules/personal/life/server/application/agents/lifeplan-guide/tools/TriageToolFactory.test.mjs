import { describe, it, expect, vi } from 'vitest';
import { TriageToolFactory } from './TriageToolFactory.mjs';

const tool = (triage) => new TriageToolFactory({ triage }).createTools().find((t) => t.name === 'start_inbox_triage');

describe('start_inbox_triage', () => {
  it('runs a manual pass and returns the session path', async () => {
    const run = vi.fn(async () => ({ preDone: { archived: 3, closed: 1 }, queued: { unsure: 2 }, mailbox: 'ok' }));
    const out = await tool({ run }).execute({ userId: 'sample' });
    expect(run).toHaveBeenCalledWith({ username: 'sample', trigger: 'manual' });
    expect(out).toEqual({ preDone: { archived: 3, closed: 1 }, queued: { unsure: 2 }, mailbox: 'ok', sessionPath: '/life/now/triage' });
  });
  it('returns not_enrolled when the pass is skipped for that reason', async () => {
    const out = await tool({ run: async () => ({ skipped: 'not_enrolled' }) }).execute({ userId: 'x' });
    expect(out).toEqual({ error: 'not_enrolled' });
  });
  it('binds to the session user and refuses a different one', async () => {
    const run = vi.fn(async () => ({ queued: {} }));
    expect(await tool({ run }).execute({ userId: 'other' }, { userId: 'sample' })).toEqual({ error: 'wrong_user' });
    expect(run).not.toHaveBeenCalled();
    await tool({ run }).execute({}, { userId: 'sample' });
    expect(run).toHaveBeenCalledWith({ username: 'sample', trigger: 'manual' });
  });
  it('offers no tool when triage is not wired', () => {
    expect(new TriageToolFactory({}).createTools()).toEqual([]);
  });
});
