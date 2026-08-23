import { describe, it, expect, beforeEach } from 'vitest';
import { SchoolGradingHookAdapter } from '#adapters/school/SchoolGradingHookAdapter.mjs';

function makeAdapter({ script = 'script.school_graded', failWith = null } = {}) {
  const calls = [];
  const gateway = {
    callService: async (domain, service, data) => {
      calls.push({ domain, service, data });
      if (failWith) throw new Error(failWith);
      return { ok: true };
    },
  };
  const loadSchoolConfig = () => (script ? { grading_hook: { script } } : {});
  return { adapter: new SchoolGradingHookAdapter({ gateway, loadSchoolConfig }), calls };
}

const GRADED = {
  result: 'graded', learnerId: 'felix', testId: '4071314',
  sessionId: 'ses_f6Buxumv', percent: 83, earned: 5, total: 6,
};

describe('SchoolGradingHookAdapter', () => {
  it('calls the configured script with the graded variable set', async () => {
    const { adapter, calls } = makeAdapter();
    const res = await adapter.fire(GRADED);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].domain).toBe('script');
    expect(calls[0].service).toBe('school_graded');
    expect(calls[0].data).toEqual({
      result: 'graded', learner_id: 'felix', test_id: '4071314',
      session_id: 'ses_f6Buxumv', percent: 83, earned: 5, total: 6,
      pending_review: null, reasons: [], items: [], code: null,
    });
  });

  it('fills inapplicable keys with null and [] on an unresolved outcome', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.fire({ result: 'unresolved', testId: '12123F', code: 'CARD_ID_UNREADABLE' });
    expect(calls[0].data).toEqual({
      result: 'unresolved', learner_id: null, test_id: '12123F',
      session_id: null, percent: null, earned: null, total: null,
      pending_review: null, reasons: [], items: [], code: 'CARD_ID_UNREADABLE',
    });
  });

  it('passes review reasons and items through', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.fire({
      result: 'review', learnerId: 'milo', testId: '4071314', sessionId: 'ses_x',
      pendingReview: 1, reasons: ['ambiguous'], items: ['q1'],
    });
    expect(calls[0].data.pending_review).toBe(1);
    expect(calls[0].data.reasons).toEqual(['ambiguous']);
    expect(calls[0].data.items).toEqual(['q1']);
  });

  it('accepts a bare service name without the script. prefix', async () => {
    const { adapter, calls } = makeAdapter({ script: 'school_graded' });
    await adapter.fire(GRADED);
    expect(calls[0].domain).toBe('script');
    expect(calls[0].service).toBe('school_graded');
  });

  it('is a no-op when grading_hook is not configured', async () => {
    const { adapter, calls } = makeAdapter({ script: null });
    const res = await adapter.fire(GRADED);
    expect(res).toEqual({ ok: true, skipped: true, reason: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('never throws when the gateway throws', async () => {
    const { adapter } = makeAdapter({ failWith: 'HA unreachable' });
    const res = await adapter.fire(GRADED);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HA unreachable/);
  });

  it('opens the circuit after 5 consecutive failures and then skips', async () => {
    const { adapter, calls } = makeAdapter({ failWith: 'boom' });
    for (let i = 0; i < 5; i++) await adapter.fire(GRADED);
    expect(calls).toHaveLength(5);
    const res = await adapter.fire(GRADED);
    expect(res).toMatchObject({ ok: true, skipped: true, reason: 'backoff' });
    expect(calls).toHaveLength(5); // no 6th attempt
  });

  it('does NOT deduplicate identical consecutive grades', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.fire(GRADED);
    await adapter.fire(GRADED);
    expect(calls).toHaveLength(2);
  });
});
