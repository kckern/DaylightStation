/**
 * THE SWEEP THAT NEVER RAN.
 *
 * `listStale` was reachable only through a manual, teacher-gated
 * `GET /sessions/stale`; nothing scheduled ever called it, so the threshold
 * written into that route was never once consulted. That is how Felix's
 * 2026-08-14 session was still live eight days later and resumed presenting
 * itself as that morning's work.
 *
 * Policy (KC, 2026-08-23): sweep UNTOUCHED work only, at 14 days. Anything the
 * child actually handed in is left for a person.
 */
import { describe, it, expect, vi } from 'vitest';
import { MarkSessionAbandoned } from '#apps/school/usecases/MarkSessionAbandoned.mjs';
import { FakeSessionRepository } from '../../../_lib/school/lifecycleFakes.mjs';

const NOW = new Date('2026-08-23T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
/** The sweep must never consult it — asserted below. */
const loudGate = { assert: vi.fn(() => { throw new Error('teacher gate must not be asked by a cron sweep'); }) };

async function build(sessions) {
  const repo = new FakeSessionRepository();
  for (const [sessionId, events] of Object.entries(sessions)) {
    for (const event of events) {
      // eslint-disable-next-line no-await-in-loop
      await repo.appendEvent(sessionId, event);
    }
  }
  const useCase = new MarkSessionAbandoned({
    sessions: repo,
    teacherGate: loudGate,
    learnerDirectory: { listLearners: async () => [{ id: 'felix' }] },
    clock: () => NOW,
    logger: silent,
  });
  return { repo, useCase };
}

const created = (at) => ({ type: 'created', at, learnerId: 'felix', unitId: 'u1' });
const issued = (at) => ({ type: 'issued', at, artifactId: 'a1' });

describe('sweepUntouched', () => {
  it('sweeps work issued and never returned, past the threshold', async () => {
    const { useCase, repo } = await build({
      ses_old: [created(daysAgo(20)), issued(daysAgo(20))],
    });
    const result = await useCase.sweepUntouched({ olderThanDays: 14 });
    expect(result.swept.map((s) => s.sessionId)).toEqual(['ses_old']);
    const events = await repo.readEvents('ses_old');
    expect(events[events.length - 1]).toMatchObject({
      type: 'abandoned', decidedBy: 'system:stale-sweep',
    });
  });

  it('leaves work inside the threshold entirely alone', async () => {
    const { useCase, repo } = await build({
      ses_recent: [created(daysAgo(3)), issued(daysAgo(3))],
    });
    const result = await useCase.sweepUntouched({ olderThanDays: 14 });
    expect(result.swept).toEqual([]);
    expect((await repo.readEvents('ses_recent')).some((e) => e.type === 'abandoned')).toBe(false);
  });

  it("never touches work the child handed in — the state machine forbids it, and so does this", async () => {
    // `submitted` has no `abandoned` edge. Even aged well past the threshold,
    // a sheet that came back settles through grading, not a sweep.
    const { useCase, repo } = await build({
      ses_submitted: [created(daysAgo(30)), issued(daysAgo(30)), { type: 'submitted', at: daysAgo(29), transport: 'omr' }],
    });
    const result = await useCase.sweepUntouched({ olderThanDays: 14 });
    expect(result.swept).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toContain('state-settles-through-grading');
    expect((await repo.readEvents('ses_submitted')).some((e) => e.type === 'abandoned')).toBe(false);
  });

  it('leaves a session carrying graded attempts for a person, even from a sweepable state', async () => {
    // Belt to the state machine's brace: attempt evidence without an advanced
    // state is an anomaly, and an anomaly is exactly what a sweep must not
    // quietly close.
    const { useCase } = await build({
      ses_odd: [created(daysAgo(20)), { ...issued(daysAgo(20)), attemptIds: ['att_1'] }],
    });
    const result = await useCase.sweepUntouched({ olderThanDays: 14 });
    expect(result.swept).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toContain('has-graded-attempts');
  });

  it('never asks the teacher gate — a cron job has no PIN, and the threshold IS the authority', async () => {
    loudGate.assert.mockClear();
    const { useCase } = await build({ ses_old: [created(daysAgo(20)), issued(daysAgo(20))] });
    await useCase.sweepUntouched({ olderThanDays: 14 });
    expect(loudGate.assert).not.toHaveBeenCalled();
  });

  it('still names an author and a why — authorship is honoured, not dropped', async () => {
    const { useCase, repo } = await build({ ses_old: [created(daysAgo(20)), issued(daysAgo(20))] });
    await useCase.sweepUntouched({ olderThanDays: 14 });
    const abandoned = (await repo.readEvents('ses_old')).find((e) => e.type === 'abandoned');
    expect(abandoned.decidedBy).toBe('system:stale-sweep');
    expect(abandoned.reason).toMatch(/untouched for \d+ days/);
  });

  it('dryRun reports exactly what it would sweep and writes nothing', async () => {
    const { useCase, repo } = await build({ ses_old: [created(daysAgo(20)), issued(daysAgo(20))] });
    const result = await useCase.sweepUntouched({ olderThanDays: 14, dryRun: true });
    expect(result.swept.map((s) => s.sessionId)).toEqual(['ses_old']);
    expect(result.dryRun).toBe(true);
    expect((await repo.readEvents('ses_old')).some((e) => e.type === 'abandoned')).toBe(false);
  });

  it('defaults to 14 days without being told', async () => {
    const { useCase } = await build({
      ses_ten: [created(daysAgo(10)), issued(daysAgo(10))],
      ses_twenty: [created(daysAgo(20)), issued(daysAgo(20))],
    });
    const result = await useCase.sweepUntouched();
    expect(result.olderThanDays).toBe(14);
    expect(result.swept.map((s) => s.sessionId)).toEqual(['ses_twenty']);
  });

  it('one unwritable session does not abort the rest of the sweep', async () => {
    const { useCase, repo } = await build({
      ses_bad: [created(daysAgo(20)), issued(daysAgo(20))],
      ses_good: [created(daysAgo(21)), issued(daysAgo(21))],
    });
    const original = repo.appendEvent.bind(repo);
    repo.appendEvent = async (sessionId, event) => {
      if (sessionId === 'ses_bad') throw new Error('disk full');
      return original(sessionId, event);
    };
    const result = await useCase.sweepUntouched({ olderThanDays: 14 });
    expect(result.swept.map((s) => s.sessionId)).toEqual(['ses_good']);
    expect(result.skipped.find((s) => s.sessionId === 'ses_bad').reason).toBe('append-failed');
  });
});
