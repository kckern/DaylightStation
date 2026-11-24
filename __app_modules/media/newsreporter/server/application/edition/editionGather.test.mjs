import { describe, it, expect, vi } from 'vitest';
import { EditionGatherer, mapLimit } from './editionGather.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';

const logger = { warn: vi.fn(), info: vi.fn() };
const source = (sourceType, items) => ({ sourceType, fetchItems: vi.fn(async () => items) });

describe('EditionGatherer.modules', () => {
  it('flags notable weather (freeze, precip ≥ 60%) and overdue tasks', async () => {
    const g = new EditionGatherer({
      feedSources: [
        source('weather', [{ title: 'Snow', meta: { tempF: 30, forecast: { condition: 'Snow', highF: 34, lowF: 20, precipPct: 70 } } }]),
        source('tasks', [{ title: 'Later', meta: { isOverdue: false } }, { title: 'Late', meta: { isOverdue: true } }]),
      ],
      logger,
    });
    const { facts, missing } = await g.modules({ modules: ['weather', 'todoist'], day: { todoist: { max: 1 } }, user: 'u', date: '2026-11-24' });
    expect(missing).toEqual([]);
    expect(facts.weather).toMatchObject({ highF: 34, lowF: 20, notable: true, notableReasons: ['freeze', 'precip'] });
    expect(facts.todoist).toEqual({ items: [{ text: 'Late', overdue: true }], total: 2, notable: true });
  });

  it('shows the next two days when today is thin', async () => {
    const g = new EditionGatherer({
      loadCalendar: () => [
        { date: '2026-11-24', time: '9:00 AM', summary: 'Sync', allday: false, startDateTime: '2026-11-24T09:00' },
        { date: '2026-11-25', time: '5:00 PM', summary: 'Parkour', allday: false, startDateTime: '2026-11-25T17:00' },
        { date: '2026-11-26', time: null, summary: 'Thanksgiving', allday: true, startDateTime: '2026-11-26' },
        { date: '2026-11-27', time: null, summary: 'Too far', allday: true, startDateTime: '2026-11-27' },
      ],
      logger,
    });
    const { facts } = await g.modules({ modules: ['calendar'], day: { calendar: { max: 5 } }, user: 'u', date: '2026-11-24' });
    expect(facts.calendar.items).toEqual([
      { time: '9:00 AM', text: 'Sync' },
      { time: 'Wed 5:00 PM', text: 'Parkour', later: true },
      { time: 'Thu', text: 'Thanksgiving', later: true },
    ]);
  });

  it('walks back to the previous study day that asked for work', async () => {
    const summarizeSchool = vi.fn(async ({ studyDay }) => ({ learners: studyDay === '2026-11-20' ? [{ child: 'Sam', served: 2, asked: 3 }] : [{ child: 'Sam', served: 0, asked: 0 }] }));
    const g = new EditionGatherer({ summarizeSchool, logger });
    const { facts } = await g.modules({ modules: ['school'], day: {}, user: 'u', date: '2026-11-23' });
    expect(facts.school).toMatchObject({ studyDay: '2026-11-20', learners: [{ child: 'Sam', served: 2, asked: 3 }] });
    expect(summarizeSchool.mock.calls.map((c) => c[0].studyDay)).toEqual(['2026-11-22', '2026-11-21', '2026-11-20']);
  });

  it('a module that throws, times out or is unwired is missing, and the rest still gather', async () => {
    const g = new EditionGatherer({
      feedSources: [
        { sourceType: 'weather', fetchItems: () => new Promise(() => {}) },
        source('tasks', [{ title: 'T', meta: {} }]),
        { sourceType: 'gratitude', fetchItems: async () => { throw new Error('down'); } },
      ],
      logger, moduleTimeoutMs: 20, timing: new NodeApplicationScheduler(),
    });
    const { facts, missing } = await g.modules({ modules: ['weather', 'todoist', 'school', 'calendar'], day: {}, user: 'u', date: '2026-11-24' });
    expect(Object.keys(facts)).toEqual(['todoist']);
    expect(missing).toEqual(['calendar', 'school', 'weather']);
  });
});

describe('EditionGatherer.read', () => {
  it('reads the first two URLs per group, capped, and leaves a failed read thin', async () => {
    const extract = vi.fn(async (url) => {
      if (url.includes('bad')) throw new Error('403');
      return { content: `<p>${'word '.repeat(2000)}</p>` };
    });
    const g = new EditionGatherer({ webContent: { extractReadableContent: extract }, logger });
    const texts = await g.read([
      { key: 'a', items: [{ url: 'https://x/1', source: 'X' }, { url: 'https://x/2', source: 'Y' }, { url: 'https://x/3', source: 'Z' }] },
      { key: 'b', items: [{ url: 'https://bad/1', source: 'B' }] },
    ], { date: '2026-11-24' });
    expect(extract).toHaveBeenCalledTimes(3);
    expect(texts.get('a')).toHaveLength(2);
    expect(texts.get('a')[0].text.length).toBe(6000);
    expect(texts.get('b')).toEqual([]);
  });

  it('mapLimit keeps order and the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
