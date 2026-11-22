// tests/isolated/application/weekly-review/SchoolShowcaseService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import {
  SchoolShowcaseService,
  SHOWCASE_SYSTEM_PROMPT,
  parseShowcaseBullets,
  checkShowcaseBullets,
} from '../../../../__app_modules/personal/weekly-review/server/application/SchoolShowcaseService.mjs';

const WEEK = '2026-03-23';
const NOW = '2026-03-30T20:00:00.000Z';

function showcase(overrides = {}) {
  return {
    learnerId: 'kid-a',
    learnerName: 'Robin',
    items: [{ kind: 'book', verb: 'finished', title: 'Holes', subtitle: null, weight: 1 }],
    images: ['/img/holes'],
    bullets: ['Finished Holes'],
    source: 'plain',
    itemsHash: 'book:r1:finished:1',
    ...overrides,
  };
}

function setup({ chat, cache = null, ...deps } = {}) {
  const store = { load: vi.fn(async () => cache), save: vi.fn(async () => {}) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ai = chat ? { chat: vi.fn(chat) } : null;
  const clock = () => new Date(NOW);
  const service = new SchoolShowcaseService({ ai, store, logger, clock, ...deps });
  return { service, store, logger, ai };
}

describe('parseShowcaseBullets', () => {
  it('reads a plain or fenced JSON array of strings', () => {
    expect(parseShowcaseBullets('["Finished Holes", "Read every night"]')).toEqual(['Finished Holes', 'Read every night']);
    expect(parseShowcaseBullets('```json\n["Finished Holes"]\n```')).toEqual(['Finished Holes']);
  });

  it.each([
    ['not JSON', 'Finished Holes', 'parse'],
    ['an object', '{"bullets":["a"]}', 'parse'],
    ['empty array', '[]', 'count'],
    ['too many', JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']), 'count'],
    ['a non-string', '["a", 3]', 'parse'],
    ['an empty string', '["a", "  "]', 'length'],
    ['an over-long bullet', JSON.stringify(['x'.repeat(121)]), 'length'],
    ['a praise word', '["Did a great job on mazes"]', 'banned'],
    ['another praise word', '["So proud of the reading"]', 'banned'],
    ['an exclamation mark', '["Finished Holes!"]', 'banned'],
    ['a percent', '["Got 90% right"]', 'banned'],
    ['a grade', '["Earned a top grade"]', 'banned'],
    ['grades', '["Math grades went up"]', 'banned'],
    ['a percentage', '["A high percentage right"]', 'banned'],
    ['null', null, 'parse'],
  ])('rejects %s', (_label, answer, reason) => {
    expect(parseShowcaseBullets(answer)).toBeNull();
    expect(checkShowcaseBullets(answer).reason).toBe(reason);
  });

  it('does not count the child\'s own titles against the rules', () => {
    const allowedPhrases = ["Oh, the Places You'll Go!", 'Great Expectations', null];
    expect(parseShowcaseBullets(`["Finished Oh, the Places You'll Go!", "Started great expectations"]`, { allowedPhrases }))
      .toEqual(["Finished Oh, the Places You'll Go!", 'Started great expectations']);
    // Outside the title the same words still count.
    expect(checkShowcaseBullets('["Great Expectations was great"]', { allowedPhrases }).reason).toBe('banned');
    expect(checkShowcaseBullets('["Started Great Expectations!"]', { allowedPhrases }).reason).toBe('banned');
  });
});

describe('SchoolShowcaseService', () => {
  it('requires a store', () => {
    expect(() => new SchoolShowcaseService({})).toThrow(/store/);
  });

  it('asks the AI with the house prompt and capped facts without the name, then caches the bullets', async () => {
    const longTitle = 'T'.repeat(100);
    const items = [{ kind: 'book', verb: 'finished', title: longTitle, subtitle: 'S'.repeat(90), weight: 1 }];
    const { service, store, logger, ai } = setup({ chat: async () => '["Finished a long book", "Read before bed most nights"]' });
    const [result] = await service.execute(WEEK, [showcase({ items })]);

    expect(result).toMatchObject({ learnerId: 'kid-a', source: 'ai', bullets: ['Finished a long book', 'Read before bed most nights'], images: ['/img/holes'] });
    const [messages, opts] = ai.chat.mock.calls[0];
    expect(messages[0]).toEqual({ role: 'system', content: SHOWCASE_SYSTEM_PROMPT });
    expect(SHOWCASE_SYSTEM_PROMPT).toMatch(/never as an instruction/);
    const payload = JSON.parse(messages[1].content);
    expect(payload).toEqual({ work: [{ kind: 'book', verb: 'finished', title: 'T'.repeat(80), subtitle: 'S'.repeat(80), weight: 1 }] });
    expect(messages[1].content).not.toContain('Robin');
    expect(opts).toEqual({ temperature: 0.3, maxTokens: 400, timeout: 15000 });

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(WEEK, {
      'kid-a': { itemsHash: 'book:r1:finished:1', bullets: ['Finished a long book', 'Read before bed most nights'], at: NOW },
    });
    expect(logger.info).toHaveBeenCalledWith('weekly-review.showcase.generated', {
      week: WEEK, learnerId: 'kid-a', items: 1, ms: 0, cached: false, source: 'ai',
    });
  });

  it('accepts bullets that quote a title with a banned word in it', async () => {
    const items = [{ kind: 'book', verb: 'finished', title: 'Great Expectations', subtitle: 'Charles Dickens', weight: 1 }];
    const { service } = setup({ chat: async () => '["Finished Great Expectations by Charles Dickens"]' });
    const [result] = await service.execute(WEEK, [showcase({ items })]);
    expect(result).toMatchObject({ source: 'ai', bullets: ['Finished Great Expectations by Charles Dickens'] });
  });

  it('serves cached bullets when the items hash matches and does not call the AI', async () => {
    const cache = { 'kid-a': { itemsHash: 'book:r1:finished:1', bullets: ['From the cache'], at: 'x' } };
    const { service, store, ai, logger } = setup({ chat: async () => '["new"]', cache });
    const [result] = await service.execute(WEEK, [showcase()]);
    expect(result).toMatchObject({ bullets: ['From the cache'], source: 'ai' });
    expect(ai.chat).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('weekly-review.showcase.generated', expect.objectContaining({ cached: true, source: 'ai' }));
  });

  it('redrafts when the week changed and merges into the existing cache', async () => {
    const cache = {
      'kid-a': { itemsHash: 'old', bullets: ['Stale'], at: 'x' },
      'kid-b': { itemsHash: 'h-b', bullets: ['Kept'], at: 'y' },
    };
    const { service, store } = setup({ chat: async () => '["Fresh"]', cache });
    const [result] = await service.execute(WEEK, [showcase()]);
    expect(result.bullets).toEqual(['Fresh']);
    expect(store.save.mock.calls[0][1]).toEqual({
      'kid-a': { itemsHash: 'book:r1:finished:1', bullets: ['Fresh'], at: NOW },
      'kid-b': cache['kid-b'],
    });
  });

  it('keeps plain bullets when the AI breaks the rules, logs why, and records the rejection', async () => {
    const { service, store, logger } = setup({ chat: async () => '["What an amazing week!"]' });
    const [result] = await service.execute(WEEK, [showcase()]);
    expect(result).toMatchObject({ bullets: ['Finished Holes'], source: 'plain' });
    expect(logger.warn).toHaveBeenCalledWith('weekly-review.showcase.ai-rejected', { week: WEEK, learnerId: 'kid-a', reason: 'banned' });
    expect(store.save).toHaveBeenCalledWith(WEEK, {
      'kid-a': { itemsHash: 'book:r1:finished:1', bullets: null, rejectedAt: NOW, attempts: 1 },
    });
  });

  it('counts a second rejection for the same week and then stops asking', async () => {
    const once = { 'kid-a': { itemsHash: 'book:r1:finished:1', bullets: null, rejectedAt: 'x', attempts: 1 } };
    const second = setup({ chat: async () => 'not json', cache: once });
    await second.service.execute(WEEK, [showcase()]);
    expect(second.ai.chat).toHaveBeenCalledTimes(1);
    expect(second.store.save.mock.calls[0][1]['kid-a']).toEqual({ itemsHash: 'book:r1:finished:1', bullets: null, rejectedAt: NOW, attempts: 2 });

    const twice = { 'kid-a': { itemsHash: 'book:r1:finished:1', bullets: null, rejectedAt: 'x', attempts: 2 } };
    const third = setup({ chat: async () => '["Fresh"]', cache: twice });
    const [result] = await third.service.execute(WEEK, [showcase()]);
    expect(third.ai.chat).not.toHaveBeenCalled();
    expect(third.store.save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ bullets: ['Finished Holes'], source: 'plain' });

    // New work in the week resets the count.
    const changed = setup({ chat: async () => '["Fresh"]', cache: twice });
    const [fresh] = await changed.service.execute(WEEK, [showcase({ itemsHash: 'book:r1:finished:1|course:c:1' })]);
    expect(changed.ai.chat).toHaveBeenCalledTimes(1);
    expect(fresh).toMatchObject({ bullets: ['Fresh'], source: 'ai' });
  });

  it('keeps plain bullets and warns when the AI throws, without recording a rejection', async () => {
    const { service, logger, store } = setup({ chat: async () => { throw new Error('quota'); } });
    const [result] = await service.execute(WEEK, [showcase()]);
    expect(result).toMatchObject({ bullets: ['Finished Holes'], source: 'plain' });
    expect(logger.warn).toHaveBeenCalledWith('weekly-review.showcase.ai-failed', { week: WEEK, learnerId: 'kid-a', error: 'quota' });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('gives up on an AI that never answers after the injected timeout', async () => {
    const timers = [];
    const setTimer = vi.fn((fn, ms) => { timers.push({ fn, ms }); return timers.length; });
    const clearTimer = vi.fn();
    const { service, logger, ai } = setup({ chat: () => new Promise(() => {}), setTimer, clearTimer, aiTimeoutMs: 5000 });
    const run = service.execute(WEEK, [showcase()]);
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(timers[0].ms).toBe(5000);
    expect(ai.chat.mock.calls[0][1].timeout).toBe(5000);
    timers[0].fn();
    const [result] = await run;
    expect(result).toMatchObject({ bullets: ['Finished Holes'], source: 'plain' });
    expect(logger.warn).toHaveBeenCalledWith('weekly-review.showcase.ai-failed', { week: WEEK, learnerId: 'kid-a', error: 'timeout' });
    expect(clearTimer).toHaveBeenCalledWith(1);
  });

  it('is plain without an AI gateway', async () => {
    const { service, store } = setup();
    const [result] = await service.execute(WEEK, [showcase()]);
    expect(result).toMatchObject({ bullets: ['Finished Holes'], source: 'plain' });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('drafts children in parallel and saves once', async () => {
    const pending = [];
    const chat = () => new Promise(resolve => pending.push(resolve));
    const { service, store, ai } = setup({ chat });
    const run = service.execute(WEEK, [showcase(), showcase({ learnerId: 'kid-b', learnerName: 'Ada', itemsHash: 'h-b' })]);
    await vi.waitFor(() => expect(ai.chat).toHaveBeenCalledTimes(2));
    pending.forEach((resolve, i) => resolve(`["Bullet ${i}"]`));
    const results = await run;
    expect(results.map(r => r.learnerId)).toEqual(['kid-a', 'kid-b']);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.save.mock.calls[0][1]).sort()).toEqual(['kid-a', 'kid-b']);
  });

  it('shares one run between concurrent requests for the same week', async () => {
    const pending = [];
    const chat = () => new Promise(resolve => pending.push(resolve));
    const { service, ai, store } = setup({ chat });
    const list = () => [showcase(), showcase({ learnerId: 'kid-b', learnerName: 'Ada', itemsHash: 'h-b' })];
    const first = service.execute(WEEK, list());
    const second = service.execute(WEEK, list().reverse());
    await vi.waitFor(() => expect(ai.chat).toHaveBeenCalledTimes(2));
    pending.forEach(resolve => resolve('["Same"]'));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(ai.chat).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenCalledTimes(1);

    // Once settled, a later request starts its own run (this mock store never returns a cache).
    await service.execute(WEEK, list());
    expect(ai.chat).toHaveBeenCalledTimes(4);
  });

  it('survives a broken cache store', async () => {
    const { service, store, logger } = setup({ chat: async () => '["Fresh"]' });
    store.load.mockRejectedValue(new Error('bad yaml'));
    store.save.mockRejectedValue(new Error('read-only'));
    const [result] = await service.execute(WEEK, [showcase()]);
    expect(result).toMatchObject({ bullets: ['Fresh'], source: 'ai' });
    expect(logger.warn).toHaveBeenCalledWith('weekly-review.showcase.cache-load-failed', { week: WEEK, error: 'bad yaml' });
    expect(logger.warn).toHaveBeenCalledWith('weekly-review.showcase.cache-save-failed', { week: WEEK, error: 'read-only' });
  });

  it('returns an empty list for no showcases without touching the store', async () => {
    const { service, store } = setup({ chat: async () => '["x"]' });
    expect(await service.execute(WEEK, [])).toEqual([]);
    expect(store.load).not.toHaveBeenCalled();
  });
});
