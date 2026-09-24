import { describe, expect, test, vi } from 'vitest';
import stringSimilarity from 'string-similarity';
import { HeadlineService } from '#apps/feed/services/HeadlineService.mjs';
import { DataServiceFeedConfigRepository } from '#adapters/feed/DataServiceFeedConfigRepository.mjs';
import { HeadlineStoryJudge } from '#apps/feed/services/HeadlineStoryJudge.mjs';

describe('HeadlineService briefing', () => {
  test('clusters similar coverage and reports invalid zero-based placements', async () => {
    const now = new Date().toISOString();
    const config = {
      headline_pages: [{
        id: 'daily',
        label: 'Daily',
        grid: { rows: ['top'], cols: ['left', 'right'] },
        sources: [
          { id: 'one', label: 'One', row: 0, col: 0, url: 'https://one.example/rss' },
          { id: 'two', label: 'Two', row: 0, col: 0, url: 'https://two.example/rss' },
          { id: 'three', label: 'Three', row: 2, col: 0, url: 'https://three.example/rss' },
        ],
      }],
    };
    const cached = {
      one: { items: [{ id: 'one-a', title: 'Major coastal storm reaches the western United States', link: 'https://one.example/storm', timestamp: now }] },
      two: { items: [{ id: 'two-a', title: 'Major coastal storm arrives in the western United States', link: 'https://two.example/storm', timestamp: now }] },
      three: { items: [] },
    };
    const service = new HeadlineService({
      headlineStore: { loadAllSources: async () => cached },
      harvester: {},
      configRepository: new DataServiceFeedConfigRepository({ dataService: { user: { read: () => config } } }),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });

    const result = await service.getAllHeadlines('alice', 'daily');
    expect(result.briefing[0]).toMatchObject({ sourceCount: 2 });
    expect(result.briefing[0].coverage.map(item => item.sourceLabel)).toEqual(['One', 'Two']);
    expect(result.briefing[0].timeline).toHaveLength(2);
    expect(result.briefing[0].timeline.every(item => item.kind === 'report')).toBe(true);
    expect(result.configWarnings.map(warning => warning.code)).toEqual(['DUPLICATE_PLACEMENT', 'OUT_OF_RANGE']);
  });
});


const PARAPHRASE_A = 'White House Restores Access for CNN, MS NOW and Politico';
const PARAPHRASE_B = 'CNN, MS NOW and Politico reporters regain entry to White House';
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'from']);
const norm = t => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).join(' ');

const fakeGateway = ({ same = 0.9, kind = 'live', confidence = 0.8, fail = false } = {}) => ({
  isConfigured: () => true,
  evaluate: vi.fn(async (state, questions) => {
    if (fail) throw new Error('jev down');
    if (questions.sameEvent) return { model: 'jev-test', answers: { sameEvent: { type: 'yesNo', probability: same } }, usage: {} };
    return { model: 'jev-test', answers: { kind: { type: 'choice', choice: kind, confidence, probabilities: { [kind]: confidence } } }, usage: {} };
  }),
});

function paraphraseService({ jev = null, storyJudge = null } = {}) {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const config = {
    headline_pages: [{
      id: 'daily', label: 'Daily', grid: { rows: ['top'], cols: ['left', 'right'] },
      sources: [
        { id: 'one', label: 'One', row: 0, col: 0, url: 'https://one.example/rss' },
        { id: 'two', label: 'Two', row: 0, col: 1, url: 'https://two.example/rss' },
      ],
    }],
    headlines: jev ? { jev } : {},
  };
  const cached = {
    one: { items: [{ id: 'one-a', title: PARAPHRASE_A, link: 'https://one.example/wh', timestamp: now }] },
    two: { items: [{ id: 'two-a', title: PARAPHRASE_B, link: 'https://two.example/wh', timestamp: earlier }] },
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = new HeadlineService({
    headlineStore: {
      loadAllSources: async () => cached,
      loadSource: async () => null,
      saveSource: async () => true,
      pruneOlderThan: async () => 0,
    },
    harvester: { harvest: async () => ({ items: [] }) },
    configRepository: new DataServiceFeedConfigRepository({ dataService: { user: { read: () => config } } }),
    storyJudge,
    logger: log,
  });
  return { service, log };
}

describe('HeadlineService briefing with a story judge', () => {
  test('the paraphrase fixture sits in the ambiguous band', () => {
    const similarity = stringSimilarity.compareTwoStrings(norm(PARAPHRASE_A), norm(PARAPHRASE_B));
    expect(similarity).toBeGreaterThanOrEqual(0.5);
    expect(similarity).toBeLessThan(0.72);
  });

  test('without a judge, band pairs stay separate (legacy)', async () => {
    const { service } = paraphraseService();
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(2);
    expect(briefing.every(story => story.sourceCount === 1)).toBe(true);
  });

  test('traces band pairs and timeline titles without changing a shadow briefing', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: fakeGateway(), logger: { info() {}, warn() {} } });
    const { service } = paraphraseService({ storyJudge: judge });
    const trace = { pageId: 'daily', pairs: [], titles: [] };
    const { briefing } = await service.getAllHeadlines('alice', 'daily', { trace });
    expect(briefing).toHaveLength(2);
    expect(trace.pairs).toHaveLength(1);
    expect(trace.pairs[0]).toMatchObject({
      normA: norm(PARAPHRASE_A), normB: norm(PARAPHRASE_B),
      a: { title: PARAPHRASE_A, source: 'One' }, b: { title: PARAPHRASE_B, source: 'Two' },
    });
    expect(trace.titles).toEqual([]);
  });

  test('promote with cached verdicts merges the pair and relabels its timeline', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: fakeGateway({ kind: 'analysis' }), logger: { info() {}, warn() {} } });
    const settings = HeadlineStoryJudge.settings({ mode: 'promote' });
    await judge.review({ pageId: 'daily', pairs: [{ similarity: 0.67, normA: norm(PARAPHRASE_A), normB: norm(PARAPHRASE_B),
      a: { title: PARAPHRASE_A }, b: { title: PARAPHRASE_B } }],
    titles: [{ title: PARAPHRASE_A, legacyKind: 'report' }, { title: PARAPHRASE_B, legacyKind: 'report' }] }, settings);
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'promote' } });
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(1);
    expect(briefing[0].sourceCount).toBe(2);
    expect(briefing[0].timeline.map(item => item.kind)).toEqual(['analysis', 'analysis']);
  });

  test('promote with an empty cache serves the legacy briefing and asks nothing', async () => {
    const gateway = fakeGateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway, logger: { info() {}, warn() {} } });
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'promote' } });
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(2);
    expect(briefing[0].timeline.every(item => item.kind === 'report')).toBe(true);
    expect(gateway.evaluate).not.toHaveBeenCalled();
  });
});

describe('HeadlineService harvest-time story review', () => {
  test('shadow: harvest asks about the band pair and the projected timeline, briefing unchanged', async () => {
    const gateway = fakeGateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway, logger: { info() {}, warn() {} } });
    const { service, log } = paraphraseService({ storyJudge: judge });
    await service.harvestAll('alice');
    expect(log.info).toHaveBeenCalledWith('feed.headlines.jev-review', expect.objectContaining({
      page: 'daily', mode: 'shadow', pairs: 1, titles: 2, evaluated: 3, failed: 0,
      multiSourceServed: 0, multiSourceWithJev: 1,
    }));
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(2);
    await service.harvestAll('alice');
    expect(gateway.evaluate).toHaveBeenCalledTimes(3); // second harvest is all cache hits
  });

  test('promote: after a harvest the served briefing uses the verdicts', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: fakeGateway({ kind: 'live' }), logger: { info() {}, warn() {} } });
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'promote' } });
    await service.harvestAll('alice');
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(1);
    expect(briefing[0].timeline.map(item => item.kind)).toEqual(['live', 'live']);
  });

  test('off: harvest never asks the model', async () => {
    const gateway = fakeGateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway, logger: { info() {}, warn() {} } });
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'off' } });
    await service.harvestAll('alice');
    expect(gateway.evaluate).not.toHaveBeenCalled();
  });

  test('a failing model never breaks harvest or the briefing', async () => {
    const judgeLog = { info: vi.fn(), warn: vi.fn() };
    const judge = new HeadlineStoryJudge({ decisionGateway: fakeGateway({ fail: true }), logger: judgeLog });
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'promote' } });
    await expect(service.harvestAll('alice')).resolves.toMatchObject({ harvested: 2 });
    expect(judgeLog.warn).toHaveBeenCalledWith('feed.headlines.jev-pair-failed', expect.objectContaining({ error: 'jev down' }));
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(2);
  });
});

describe('HeadlineService review scheduling', () => {
  // A gateway whose answers wait until release() so a review can be held "in flight".
  const heldGateway = () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const evaluate = vi.fn(async (state, questions) => {
      await gate;
      if (questions.sameEvent) return { model: 'jev-test', answers: { sameEvent: { type: 'yesNo', probability: 0.9 } } };
      return { model: 'jev-test', answers: { kind: { type: 'choice', choice: 'report', confidence: 0.9 } } };
    });
    return { gateway: { isConfigured: () => true, evaluate }, release: () => release() };
  };
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  test("review: 'background' returns the harvest result before the review finishes", async () => {
    const { gateway, release } = heldGateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway, logger: { info() {}, warn() {} } });
    const { service, log } = paraphraseService({ storyJudge: judge });
    const result = await service.harvestAll('alice', undefined, { review: 'background' });
    expect(result).toMatchObject({ harvested: 2 });
    await flush();
    expect(gateway.evaluate).toHaveBeenCalledTimes(1);
    expect(log.info).not.toHaveBeenCalledWith('feed.headlines.jev-review', expect.anything());
    release();
    await flush(); await flush();
    expect(log.info).toHaveBeenCalledWith('feed.headlines.jev-review', expect.objectContaining({ page: 'daily' }));
  });

  test('a harvest during a running review does not start a second review for that user', async () => {
    const { gateway, release } = heldGateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway, logger: { info() {}, warn() {} } });
    const { service, log } = paraphraseService({ storyJudge: judge });
    await service.harvestAll('alice', undefined, { review: 'background' });
    await flush();
    await service.harvestAll('alice', undefined, { review: 'background' });
    await flush();
    expect(gateway.evaluate).toHaveBeenCalledTimes(1);
    release();
    await flush(); await flush();
    const reviews = log.info.mock.calls.filter(([event]) => event === 'feed.headlines.jev-review');
    expect(reviews).toHaveLength(1);
  });

  test('a background review that throws is logged, not raised', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: fakeGateway(), logger: { info() {}, warn() {} } });
    judge.review = async () => { throw new Error('boom'); };
    const { service, log } = paraphraseService({ storyJudge: judge });
    await expect(service.harvestAll('alice', undefined, { review: 'background' })).resolves.toMatchObject({ harvested: 2 });
    await flush();
    expect(log.warn).toHaveBeenCalledWith('feed.headlines.jev-review-failed', expect.objectContaining({ error: 'boom' }));
  });
});

describe('HeadlineService review call budget', () => {
  test('one budget covers both passes of a page review', async () => {
    const gateway = fakeGateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway, logger: { info() {}, warn() {} }, maxCallsPerReview: 2 });
    const { service, log } = paraphraseService({ storyJudge: judge });
    await service.harvestAll('alice');
    expect(gateway.evaluate).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith('feed.headlines.jev-review', expect.objectContaining({ evaluated: 2, skipped: 1 }));
  });
});
