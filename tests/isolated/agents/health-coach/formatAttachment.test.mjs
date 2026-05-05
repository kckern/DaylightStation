// tests/isolated/agents/health-coach/formatAttachment.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { formatHealthAttachment } from '../../../../backend/src/3_applications/agents/health-coach/formatAttachment.mjs';

const fakeResolver = {
  resolve: vi.fn(async (input) => {
    if (input?.rolling === 'last_30d') return { from: '2026-04-06', to: '2026-05-05', label: 'last_30d', source: 'rolling' };
    if (input?.named === '2017-cut')   return { from: '2017-01-15', to: '2017-04-30', label: '2017 Cut', source: 'named', subSource: 'declared' };
    throw new Error(`unknown period: ${JSON.stringify(input)}`);
  }),
};

describe('formatHealthAttachment', () => {
  it('formats a rolling period with resolved bounds inline', async () => {
    const out = await formatHealthAttachment({
      type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days',
    }, { userId: 'kc', periodResolver: fakeResolver });
    expect(out).toMatch(/Last 30 days/);
    expect(out).toMatch(/2026-04-06/);
    expect(out).toMatch(/2026-05-05/);
    expect(out).toMatch(/period/i);
  });

  it('formats a named period with resolved bounds and subSource', async () => {
    const out = await formatHealthAttachment({
      type: 'period', value: { named: '2017-cut' }, label: '2017 Cut',
    }, { userId: 'kc', periodResolver: fakeResolver });
    expect(out).toMatch(/2017 Cut/);
    expect(out).toMatch(/2017-01-15/);
    expect(out).toMatch(/declared/);
  });

  it('formats a day with tool hint', async () => {
    const out = await formatHealthAttachment({
      type: 'day', date: '2026-05-04', label: 'May 4, 2026',
    }, { userId: 'kc', periodResolver: fakeResolver });
    expect(out).toMatch(/2026-05-04/);
    expect(out).toMatch(/get_health_summary|query_historical_workouts/);
  });

  it('formats a workout with the right tool hint', async () => {
    const out = await formatHealthAttachment({
      type: 'workout', date: '2026-05-04', label: 'Workout on May 4',
    }, { userId: 'kc', periodResolver: fakeResolver });
    expect(out).toMatch(/2026-05-04/);
    expect(out).toMatch(/query_historical_workouts/);
  });

  it('formats a metric_snapshot with metric+period', async () => {
    const out = await formatHealthAttachment({
      type: 'metric_snapshot', metric: 'weight_lbs',
      period: { rolling: 'last_30d' }, label: 'Weight (last 30d)',
    }, { userId: 'kc', periodResolver: fakeResolver });
    expect(out).toMatch(/weight_lbs/);
    expect(out).toMatch(/2026-04-06/);
    expect(out).toMatch(/aggregate_metric/);
  });

  it('falls back to generic format when period resolution fails', async () => {
    const out = await formatHealthAttachment({
      type: 'period', value: { named: 'no-such-thing' }, label: 'Unknown',
    }, { userId: 'kc', periodResolver: fakeResolver });
    expect(out).toMatch(/Unknown/);
    expect(out).toMatch(/unresolvable|could not resolve|no-such-thing/);
  });

  it('falls back to a generic line for unknown types', async () => {
    const out = await formatHealthAttachment({
      type: 'unknown_thing', label: 'foo',
    }, { userId: 'kc', periodResolver: fakeResolver });
    expect(out).toMatch(/foo/);
    expect(out).toMatch(/unknown_thing/);
  });
});
