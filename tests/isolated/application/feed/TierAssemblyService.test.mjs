// tests/isolated/application/feed/TierAssemblyService.test.mjs
import { TierAssemblyService, TIERS } from '#apps/feed/services/TierAssemblyService.mjs';

describe('TierAssemblyService', () => {
  let service;

  beforeEach(() => {
    service = new TierAssemblyService({ logger: { info: () => {} } });
  });

  const makeItem = (id, tier, source, timestamp, priority = 0) => ({
    id, tier, source, title: `Item ${id}`, timestamp, priority,
  });

  const defaultConfig = {
    batch_size: 50,
    spacing: { max_consecutive: 1 },
    tiers: {
      wire: { selection: { sort: 'timestamp_desc' }, sources: {} },
      library: { allocation: 2, selection: { sort: 'random' }, sources: {} },
      scrapbook: { allocation: 2, selection: { sort: 'random' }, sources: {} },
      compass: { allocation: 3, selection: { sort: 'priority' }, sources: {} },
    },
  };

  test('assembles items from multiple tiers', () => {
    const items = [
      makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
      makeItem('w2', 'wire', 'headline', '2026-02-17T09:00:00Z'),
      makeItem('c1', 'compass', 'entropy', '2026-02-17T08:00:00Z', 10),
    ];
    const result = service.assemble(items, defaultConfig, { effectiveLimit: 50 });
    expect(result.items.length).toBe(3);
  });

  test('deduplicates items by id', () => {
    const items = [
      makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
      makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
    ];
    const result = service.assemble(items, defaultConfig, { effectiveLimit: 50 });
    expect(result.items.length).toBe(1);
  });

  describe('selectionCounts sort bias', () => {
    test('prefers lower selection count within same hour', () => {
      const selectionCounts = new Map([
        ['w1', { count: 5, last: '2026-02-17T09:00:00Z' }],
        ['w2', { count: 0, last: null }],
      ]);
      // w1 is 5 minutes NEWER than w2, but within same hour
      // Without selectionCounts, timestamp_desc would put w1 first
      // With selectionCounts, w2 (count=0) should beat w1 (count=5)
      const items = [
        makeItem('w1', 'wire', 'reddit', '2026-02-17T10:05:00Z'),
        makeItem('w2', 'wire', 'headline', '2026-02-17T10:00:00Z'),
      ];
      const result = service.assemble(items, defaultConfig, {
        effectiveLimit: 50,
        selectionCounts,
      });
      const wireItems = result.items.filter(i => i.tier === 'wire');
      // w2 has count 0, w1 has count 5 — w2 should come first despite being older
      expect(wireItems[0].id).toBe('w2');
    });

    test('timestamp still wins across different hours', () => {
      const selectionCounts = new Map([
        ['w1', { count: 0, last: null }],
        ['w2', { count: 10, last: '2026-02-17T09:00:00Z' }],
      ]);
      // 4 hours apart — time difference should win despite count difference
      const items = [
        makeItem('w1', 'wire', 'reddit', '2026-02-17T08:00:00Z'),
        makeItem('w2', 'wire', 'headline', '2026-02-17T12:00:00Z'),
      ];
      const result = service.assemble(items, defaultConfig, {
        effectiveLimit: 50,
        selectionCounts,
      });
      const wireItems = result.items.filter(i => i.tier === 'wire');
      // w2 is 4 hours newer — timestamp wins
      expect(wireItems[0].id).toBe('w2');
    });

    test('works without selectionCounts (backwards compat)', () => {
      const items = [
        makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
        makeItem('w2', 'wire', 'headline', '2026-02-17T09:00:00Z'),
      ];
      // No selectionCounts passed — should work as before
      const result = service.assemble(items, defaultConfig, { effectiveLimit: 50 });
      expect(result.items.length).toBe(2);
      // w1 is newer, should be first
      const wireItems = result.items.filter(i => i.tier === 'wire');
      expect(wireItems[0].id).toBe('w1');
    });

    test('does not affect priority sort', () => {
      const selectionCounts = new Map([
        ['c1', { count: 10, last: '2026-02-17T09:00:00Z' }],
        ['c2', { count: 0, last: null }],
      ]);
      const items = [
        makeItem('c1', 'compass', 'entropy', '2026-02-17T10:00:00Z', 20),
        makeItem('c2', 'compass', 'tasks', '2026-02-17T10:00:00Z', 5),
      ];
      const result = service.assemble(items, defaultConfig, {
        effectiveLimit: 50,
        selectionCounts,
      });
      const compassItems = result.items.filter(i => i.tier === 'compass');
      // c1 has higher priority (20 vs 5) — priority wins in compass tier
      expect(compassItems[0].id).toBe('c1');
    });
  });

  describe('flex-based allocation', () => {
    test('uses FlexAllocator for tier distribution with flex config', () => {
      const flexConfig = {
        batch_size: 20,
        spacing: { max_consecutive: 1 },
        tiers: {
          wire: {
            flex: '1 0 auto',
            selection: { sort: 'timestamp_desc' },
            sources: {},
          },
          compass: {
            flex: '0 0 5',
            selection: { sort: 'priority' },
            sources: {},
          },
          scrapbook: {
            flex: '0 0 3',
            selection: { sort: 'random' },
            sources: {},
          },
          library: {
            flex: '0 0 2',
            selection: { sort: 'random' },
            sources: {},
          },
        },
      };

      const items = [
        ...Array.from({ length: 15 }, (_, i) => makeItem(`w${i}`, 'wire', 'reddit', `2026-02-17T${String(10 - Math.floor(i / 6)).padStart(2, '0')}:${String(59 - (i % 60)).padStart(2, '0')}:00Z`)),
        ...Array.from({ length: 5 }, (_, i) => makeItem(`c${i}`, 'compass', 'entropy', `2026-02-17T08:${String(i).padStart(2, '0')}:00Z`, 10)),
        ...Array.from({ length: 3 }, (_, i) => makeItem(`s${i}`, 'scrapbook', 'photos', `2026-02-17T07:${String(i).padStart(2, '0')}:00Z`)),
        ...Array.from({ length: 2 }, (_, i) => makeItem(`l${i}`, 'library', 'comics', `2026-02-17T06:${String(i).padStart(2, '0')}:00Z`)),
      ];

      const result = service.assemble(items, flexConfig, { effectiveLimit: 20 });
      expect(result.items.length).toBeLessThanOrEqual(20);
      expect(result.items.length).toBeGreaterThan(0);

      // Verify non-wire tiers got their basis allocations
      const compassItems = result.items.filter(i => i.tier === 'compass');
      const scrapbookItems = result.items.filter(i => i.tier === 'scrapbook');
      const libraryItems = result.items.filter(i => i.tier === 'library');
      expect(compassItems.length).toBeGreaterThanOrEqual(1);
      expect(scrapbookItems.length).toBeGreaterThanOrEqual(1);
      expect(libraryItems.length).toBeGreaterThanOrEqual(1);
    });

    test('legacy config still works through FlexConfigParser migration', () => {
      const items = [
        makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
        makeItem('w2', 'wire', 'headlines', '2026-02-17T09:00:00Z'),
        makeItem('c1', 'compass', 'entropy', '2026-02-17T08:00:00Z', 10),
        makeItem('l1', 'library', 'komga', '2026-02-17T07:00:00Z'),
      ];
      const result = service.assemble(items, defaultConfig, { effectiveLimit: 50 });
      expect(result.items.length).toBe(4);
    });
  });
});
