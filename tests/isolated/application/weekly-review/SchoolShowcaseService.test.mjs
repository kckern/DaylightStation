// tests/isolated/application/weekly-review/SchoolShowcaseService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import {
  SchoolShowcaseService,
  SHOWCASE_SYSTEM_PROMPT,
  parseShowcaseBullets,
} from '../../../../__app_modules/personal/weekly-review/server/application/SchoolShowcaseService.mjs';

const WEEK = '2026-03-23';

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

function setup({ chat, cache = null } = {}) {
  const store = { load: vi.fn(async () => cache), save: vi.fn(async () => {}) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ai = chat ? { chat: vi.fn(chat) } : null;
  const clock = () => new Date('2026-03-30T20:00:00.000Z');
  const service = new SchoolShowcaseService({ ai, store, logger, clock });
  return { service, store, logger, ai };
}

describe('parseShowcaseBullets', () => {
  it('reads a plain or fenced JSON array of strings', () => {
    expect(parseShowcaseBullets('["Finished Holes", "Read every night"]')).toEqual(['Finished Holes', 'Read every night']);
    expect(parseShowcaseBullets('```json\n["Finished Holes"]\n```')).toEqual(['Finished Holes']);
  });

  it.each([
    ['not JSON', 'Finished Holes'],
    ['an object', '{"bullets":["a"]}'],
    ['empty array', '[]'],
    ['too many', JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f'])],
    ['a non-string', '["a", 3]'],
    ['an empty string', '["a", "  "]'],
    ['an over-long bullet', JSON.stringify(['x'.repeat(121)])],
    ['a praise word', '["Did a great job on mazes"]'],
    ['an exclamation mark', '["Finished Holes!"]'],
    ['a percent', '["Got 90% right"]'],
    ['a grade', '["Earned a top grade"]'],
    ['null', null],
  ])('rejects %s', (_label, answer) => {
    expect(parseShowcaseBullets(answer)).toBeNull();
  });
});

describe('SchoolShowcaseService', () => {
  it('requires a store', () => {
    expect(() => new SchoolShowcaseService({})).toThrow(/store/);
  });

  it('asks the AI with the house prompt and the child facts, then caches the bullets', async () => {
    const { service, store, logger, ai } = setup({ chat: async () => '["Finished reading Holes", "Read before bed most nights"]' });
    const [result] = await service.execute(WEEK, [showcase()]);

    expect(result).toMatchObject({ learnerId: 'kid-a', source: 'ai', bullets: ['Finished reading Holes', 'Read before bed most nights'], images: ['/img/holes'] });
    const [messages, opts] = ai.chat.mock.calls[0];
    expect(messages[0]).toEqual({ role: 'system', content: SHOWCASE_SYSTEM_PROMPT });
    expect(JSON.parse(messages[1].content)).toEqual({ name: 'Robin', work: showcase().items });
    expect(opts).toEqual({ temperature: 0.3, maxTokens: 400 });

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(WEEK, {
      'kid-a': { itemsHash: 'book:r1:finished:1', bullets: ['Finished reading Holes', 'Read before bed most nights'], at: '2026-03-30T20:00:00.000Z' },
    });
    expect(logger.info).toHaveBeenCalledWith('weekly-review.showcase.generated', {
      week: WEEK, learnerId: 'kid-a', items: 1, ms: 0, cached: false, source: 'ai',
    });
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
      'kid-a': { itemsHash: 'book:r1:finished:1', bullets: ['Fresh'], at: '2026-03-30T20:00:00.000Z' },
      'kid-b': cache['kid-b'],
    });
  });

  it('keeps plain bullets when the AI breaks the rules, and does not cache them', async () => {
    const { service, store } = setup({ chat: async () => '["What an amazing week!"]' });
    const [result] = await service.execute(WEEK, [showcase()]);
    expect(result).toMatchObject({ bullets: ['Finished Holes'], source: 'plain' });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('keeps plain bullets and warns when the AI throws', async () => {
    const { service, logger } = setup({ chat: async () => { throw new Error('quota'); } });
    const [result] = await service.execute(WEEK, [showcase()]);
    expect(result).toMatchObject({ bullets: ['Finished Holes'], source: 'plain' });
    expect(logger.warn).toHaveBeenCalledWith('weekly-review.showcase.ai-failed', { learnerId: 'kid-a', error: 'quota' });
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
