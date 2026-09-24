import { describe, it, expect, vi } from 'vitest';
import { LifeEventSuggester } from './LifeEventSuggester.mjs';

const clock = { now: () => new Date('2026-09-24T18:00:00Z') };
const cal = (date, ...summaries) => [date, { sources: { calendar: summaries.map((summary) => ({ summary, calendarName: 'Family', allday: true })) } }];

function setup({ days = Object.fromEntries([cal('2026-09-20', 'Moving day', 'Standup')]), plan = { life_events: [] }, ...rest } = {}) {
  const aggregator = { aggregateRange: vi.fn(async () => ({ days })) };
  const lifePlanStore = { load: vi.fn(() => plan) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const suggester = new LifeEventSuggester({ aggregator, lifePlanStore, clock, timezone: 'UTC', logger, ...rest });
  return { suggester, aggregator, lifePlanStore, logger };
}

describe('LifeEventSuggester (keyword path)', () => {
  it('without a decision model returns keyword suggestions over the last N days', async () => {
    const { suggester, aggregator } = setup();
    const result = await suggester.suggest('kc', { days: 14 });
    expect(aggregator.aggregateRange).toHaveBeenCalledWith('kc', '2026-09-11', '2026-09-24');
    expect(result.judge).toBe('keyword');
    expect(result.suggestions).toEqual([{
      date: '2026-09-20', type: 'location', subtype: 'relocation', name: 'Moving day',
      source: 'calendar', confidence: 0.8, detector: 'keyword',
    }]);
  });

  it('clamps days to 1..60 and defaults to 14', async () => {
    const { suggester, aggregator } = setup();
    await suggester.suggest('kc');
    expect(aggregator.aggregateRange).toHaveBeenLastCalledWith('kc', '2026-09-11', '2026-09-24');
    await suggester.suggest('kc', { days: 500 });
    expect(aggregator.aggregateRange).toHaveBeenLastCalledWith('kc', '2026-07-27', '2026-09-24');
  });

  it('skips items already recorded as life events in the plan (by name)', async () => {
    const { suggester } = setup({ plan: { life_events: [{ name: 'moving day' }] } });
    expect((await suggester.suggest('kc')).suggestions).toEqual([]);
  });

  it('treats a gateway that reports not-configured as absent', async () => {
    const decisionGateway = { isConfigured: () => false, evaluate: vi.fn() };
    const { suggester } = setup({ decisionGateway });
    await suggester.suggest('kc');
    expect(decisionGateway.evaluate).not.toHaveBeenCalled();
  });

  it('logs lifeplan.life-event.suggested', async () => {
    const { suggester, logger } = setup();
    await suggester.suggest('kc');
    expect(logger.info).toHaveBeenCalledWith('lifeplan.life-event.suggested',
      { username: 'kc', mode: 'shadow', judge: 'keyword', items: 2, suggestions: 1 });
  });
});
