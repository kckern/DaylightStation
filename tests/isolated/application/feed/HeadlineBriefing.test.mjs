import { describe, expect, test } from 'vitest';
import { HeadlineService } from '#apps/feed/services/HeadlineService.mjs';
import { DataServiceFeedConfigRepository } from '#adapters/feed/DataServiceFeedConfigRepository.mjs';

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
