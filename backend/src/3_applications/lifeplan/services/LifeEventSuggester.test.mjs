import { describe, it, expect, vi } from 'vitest';
import { LifeEventSuggester, LIFE_EVENT_OPTIONS } from './LifeEventSuggester.mjs';
import { LIFE_EVENT_SIGNAL_KINDS } from '#domains/lifeplan/services/LifeEventSignalDetector.mjs';

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


/** Gateway that answers each question id from a table: id → [choice, confidence]. */
function gateway(table, { fail = false } = {}) {
  return {
    isConfigured: () => true,
    evaluate: vi.fn(async (state, questions) => {
      if (fail) throw new Error('jev down');
      const answers = {};
      for (const id of Object.keys(questions)) {
        const [choice, confidence] = table[state[id].summary] || ['none', 0.95];
        answers[id] = { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } };
      }
      return { model: 'jev-test-1', answers, usage: {} };
    }),
  };
}

describe('LifeEventSuggester (model judge)', () => {
  it('offers exactly none + the domain signal kinds', () => {
    expect(Object.keys(LIFE_EVENT_OPTIONS).sort()).toEqual(['none', ...Object.keys(LIFE_EVENT_SIGNAL_KINDS)].sort());
  });

  it('shadow: returns keyword suggestions, asks the model, logs agreement per item', async () => {
    const decisionGateway = gateway({ 'Moving day': ['relocation', 0.9], Standup: ['none', 0.97] });
    const { suggester, logger } = setup({ decisionGateway });
    const result = await suggester.suggest('kc');

    expect(result.judge).toBe('keyword');
    expect(result.suggestions.map((s) => s.detector)).toEqual(['keyword']);
    const [state, questions] = decisionGateway.evaluate.mock.calls[0];
    expect(state).toEqual({
      c0: { date: '2026-09-20', summary: 'Moving day', calendar: 'Family', allDay: true, location: null },
      c1: { date: '2026-09-20', summary: 'Standup', calendar: 'Family', allDay: true, location: null },
    });
    expect(questions.c0.type).toBe('choice');
    expect(questions.c0.instructions).toContain('`c0`');
    expect(questions.c0.options).toBe(LIFE_EVENT_OPTIONS);

    expect(logger.info).toHaveBeenCalledWith('lifeplan.life-event.shadow',
      { username: 'kc', date: '2026-09-20', keyword: 'relocation', model: 'relocation', confidence: 0.9, agreed: true });
    expect(logger.info).toHaveBeenCalledWith('lifeplan.life-event.shadow-summary', expect.objectContaining(
      { username: 'kc', mode: 'shadow', items: 2, keywordHits: 1, modelHits: 1, agreed: 2, disagreed: 0, model: 'jev-test-1' }));
  });

  it('shadow: logs a short summary only on disagreement rows', async () => {
    const days = Object.fromEntries([cal('2026-09-21', "Mom's funeral service at St. Mary's with the whole extended family")]);
    const decisionGateway = gateway({});  // model says none
    const { suggester, logger } = setup({ days, decisionGateway });
    await suggester.suggest('kc');
    const row = logger.info.mock.calls.find(([e]) => e === 'lifeplan.life-event.shadow')[1];
    expect(row.agreed).toBe(false);
    expect(row.keyword).toBe('family_event');
    expect(row.model).toBe('none');
    expect(row.summary).toHaveLength(60);
  });

  it('batches 20 items per evaluate call', async () => {
    const summaries = Array.from({ length: 45 }, (_, i) => `Meeting ${i}`);
    const decisionGateway = gateway({});
    const { suggester } = setup({ days: Object.fromEntries([cal('2026-09-22', ...summaries)]), decisionGateway });
    await suggester.suggest('kc');
    expect(decisionGateway.evaluate.mock.calls.map(([state]) => Object.keys(state).length)).toEqual([20, 20, 5]);
  });

  it('model failure logs a warning and returns keyword suggestions', async () => {
    const decisionGateway = gateway({}, { fail: true });
    const { suggester, logger } = setup({ decisionGateway, mode: 'decide' });
    const result = await suggester.suggest('kc');
    expect(result.judge).toBe('keyword');
    expect(result.suggestions).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith('lifeplan.life-event.model-failed', expect.objectContaining({ error: 'jev down' }));
  });

  it('a missing answer counts as a failure (no partial model verdicts)', async () => {
    const decisionGateway = { isConfigured: () => true, evaluate: vi.fn(async () => ({ model: 'm', answers: {}, usage: {} })) };
    const { suggester, logger } = setup({ decisionGateway, mode: 'decide' });
    expect((await suggester.suggest('kc')).judge).toBe('keyword');
    expect(logger.warn).toHaveBeenCalledWith('lifeplan.life-event.model-failed', expect.objectContaining({ error: 'no answer for c0' }));
  });

  it('off: never calls the model', async () => {
    const decisionGateway = gateway({});
    const { suggester } = setup({ decisionGateway, mode: 'off' });
    await suggester.suggest('kc');
    expect(decisionGateway.evaluate).not.toHaveBeenCalled();
  });

  it('decide: returns model suggestions above min confidence, typed from the kind', async () => {
    const days = Object.fromEntries([cal('2026-09-23', 'Retirement party for KC', 'Maybe a job thing', 'Standup')]);
    const decisionGateway = gateway({ 'Retirement party for KC': ['financial', 0.82], 'Maybe a job thing': ['job_change', 0.4] });
    const { suggester } = setup({ days, decisionGateway, mode: 'decide', minConfidence: 0.6 });
    const result = await suggester.suggest('kc');
    expect(result.judge).toBe('model');
    expect(result.suggestions).toEqual([{
      date: '2026-09-23', type: 'financial', subtype: 'financial', name: 'Retirement party for KC',
      source: 'calendar', confidence: 0.82, detector: 'model',
    }]);
  });

  it('noteConfirmed logs lifeplan.life-event.confirmed from the event signal', () => {
    const { suggester, logger } = setup();
    suggester.noteConfirmed('kc', { type: 'location', subtype: 'relocation', signals: [{ detector: 'keyword', confidence: 0.8 }] });
    expect(logger.info).toHaveBeenCalledWith('lifeplan.life-event.confirmed',
      { username: 'kc', type: 'location', subtype: 'relocation', detector: 'keyword', confidence: 0.8 });
  });
});
