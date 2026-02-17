// tests/isolated/application/feed/SpacingEnforcer.test.mjs
import { SpacingEnforcer } from '#apps/feed/services/SpacingEnforcer.mjs';

const item = (source, subsource = null, id = null) => ({
  id: id || `${source}:${subsource || 'x'}:${Math.random()}`,
  source,
  type: 'external',
  meta: { subreddit: subsource, sourceId: subsource, feedTitle: subsource },
});

describe('SpacingEnforcer', () => {
  const enforcer = new SpacingEnforcer();

  describe('enforce()', () => {
    test('passes through items unchanged when no rules violated', () => {
      const items = [item('reddit'), item('headlines'), item('reddit')];
      const config = { spacing: { max_consecutive: 1 }, sources: {} };
      const result = enforcer.enforce(items, config);
      expect(result).toHaveLength(3);
    });

    test('enforces max_per_batch per source', () => {
      const items = [
        item('reddit', 'r1', 'a'), item('reddit', 'r2', 'b'),
        item('reddit', 'r3', 'c'), item('headlines', 'h1', 'd'),
      ];
      const config = {
        spacing: { max_consecutive: 99 },
        tiers: {
          wire: {
            sources: { reddit: { max_per_batch: 2 } },
          },
        },
      };
      const result = enforcer.enforce(items, config);
      const redditCount = result.filter(i => i.source === 'reddit').length;
      expect(redditCount).toBe(2);
      expect(result.find(i => i.source === 'headlines')).toBeTruthy();
    });

    test('enforces max_consecutive (no back-to-back same source)', () => {
      const items = [
        item('reddit', null, 'a'), item('reddit', null, 'b'),
        item('headlines', null, 'c'), item('headlines', null, 'd'),
      ];
      const config = { spacing: { max_consecutive: 1 }, sources: {} };
      const result = enforcer.enforce(items, config);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].source).not.toBe(result[i - 1].source);
      }
    });

    test('enforces min_spacing between same source', () => {
      const items = [
        item('photos', null, 'a'), item('headlines', null, 'b'),
        item('photos', null, 'c'), item('headlines', null, 'd'),
        item('headlines', null, 'e'),
      ];
      const config = {
        spacing: { max_consecutive: 1 },
        tiers: {
          wire: {
            sources: { photos: { min_spacing: 3 } },
          },
        },
      };
      const result = enforcer.enforce(items, config);
      const photoIndices = result
        .map((it, idx) => it.source === 'photos' ? idx : -1)
        .filter(i => i >= 0);
      for (let i = 1; i < photoIndices.length; i++) {
        expect(photoIndices[i] - photoIndices[i - 1]).toBeGreaterThanOrEqual(3);
      }
    });

    test('enforces subsource max_per_batch', () => {
      const items = [
        item('reddit', 'science', 'a'), item('reddit', 'science', 'b'),
        item('reddit', 'science', 'c'), item('reddit', 'tech', 'd'),
      ];
      const config = {
        spacing: { max_consecutive: 99 },
        tiers: {
          wire: {
            sources: {
              reddit: { max_per_batch: 10, subsources: { max_per_batch: 2 } },
            },
          },
        },
      };
      const result = enforcer.enforce(items, config);
      const scienceCount = result.filter(
        i => i.source === 'reddit' && i.meta?.subreddit === 'science'
      ).length;
      expect(scienceCount).toBe(2);
    });

    test('enforces subsource min_spacing', () => {
      const items = [
        item('reddit', 'science', 'a'), item('reddit', 'tech', 'b'),
        item('reddit', 'science', 'c'), item('headlines', null, 'd'),
        item('headlines', null, 'e'),
      ];
      const config = {
        spacing: { max_consecutive: 99 },
        tiers: {
          wire: {
            sources: {
              reddit: { subsources: { min_spacing: 3 } },
            },
          },
        },
      };
      const result = enforcer.enforce(items, config);
      const scienceIndices = result
        .map((it, idx) => (it.source === 'reddit' && it.meta?.subreddit === 'science') ? idx : -1)
        .filter(i => i >= 0);
      for (let i = 1; i < scienceIndices.length; i++) {
        expect(scienceIndices[i] - scienceIndices[i - 1]).toBeGreaterThanOrEqual(3);
      }
    });

    test('returns empty array for empty input', () => {
      const result = enforcer.enforce([], { spacing: { max_consecutive: 1 }, sources: {} });
      expect(result).toEqual([]);
    });

    test('enforces subsource max_per_batch for headline sourceId', () => {
      const items = [
        item('headline', null, 'a'),
        item('headline', null, 'b'),
        item('headline', null, 'c'),
        item('headline', null, 'd'),
      ];
      // Simulate headline items with sourceId instead of subreddit
      items[0].meta = { sourceId: 'cnn', sourceName: 'CNN' };
      items[1].meta = { sourceId: 'cnn', sourceName: 'CNN' };
      items[2].meta = { sourceId: 'cnn', sourceName: 'CNN' };
      items[3].meta = { sourceId: 'nyt', sourceName: 'NYT' };

      const config = {
        spacing: { max_consecutive: 99 },
        tiers: {
          wire: {
            sources: {
              headline: { subsources: { max_per_batch: 2 } },
            },
          },
        },
      };
      const result = enforcer.enforce(items, config);
      const cnnCount = result.filter(i => i.meta?.sourceId === 'cnn').length;
      expect(cnnCount).toBe(2);
    });

    test('enforces max_consecutive_subsource globally', () => {
      const items = [
        item('headline', null, 'a'),
        item('headline', null, 'b'),
        item('headline', null, 'c'),
        item('headline', null, 'd'),
        item('headline', null, 'e'),
      ];
      items[0].meta = { sourceId: 'cnn' };
      items[1].meta = { sourceId: 'cnn' };
      items[2].meta = { sourceId: 'cnn' };
      items[3].meta = { sourceId: 'nyt' };
      items[4].meta = { sourceId: 'bbc' };

      const config = {
        spacing: { max_consecutive: 99, max_consecutive_subsource: 2 },
        tiers: {},
      };
      const result = enforcer.enforce(items, config);

      // Check no 3+ CNN items in a row
      for (let i = 2; i < result.length; i++) {
        const sub0 = result[i - 2].meta?.sourceId;
        const sub1 = result[i - 1].meta?.sourceId;
        const sub2 = result[i].meta?.sourceId;
        if (sub0 && sub0 === sub1 && sub1 === sub2) {
          throw new Error(`3 consecutive items from subsource "${sub0}" at indices ${i-2},${i-1},${i}`);
        }
      }
    });

    test('max_consecutive_subsource works across different source types', () => {
      const items = [
        item('reddit', 'science', 'a'),
        item('reddit', 'science', 'b'),
        item('reddit', 'science', 'c'),
        item('reddit', 'tech', 'd'),
        item('headline', null, 'e'),
      ];
      items[4].meta = { sourceId: 'nyt' };

      const config = {
        spacing: { max_consecutive: 99, max_consecutive_subsource: 2 },
        tiers: {},
      };
      const result = enforcer.enforce(items, config);

      // No 3+ consecutive from r/science
      let maxRun = 0, run = 0, lastSub = null;
      for (const it of result) {
        const sub = it.meta?.subreddit || it.meta?.sourceId;
        if (sub === lastSub) { run++; } else { run = 1; lastSub = sub; }
        maxRun = Math.max(maxRun, run);
      }
      expect(maxRun).toBeLessThanOrEqual(2);
    });

    test('enforces subsource min_spacing for headline sourceId', () => {
      const items = [
        item('headline', null, 'a'),
        item('headline', null, 'b'),
        item('headline', null, 'c'),
        item('headline', null, 'd'),
      ];
      items[0].meta = { sourceId: 'cnn' };
      items[1].meta = { sourceId: 'nyt' };
      items[2].meta = { sourceId: 'cnn' };
      items[3].meta = { sourceId: 'bbc' };

      const config = {
        spacing: { max_consecutive: 99 },
        tiers: {
          wire: {
            sources: {
              headline: { subsources: { min_spacing: 3 } },
            },
          },
        },
      };
      const result = enforcer.enforce(items, config);
      const cnnIndices = result
        .map((it, idx) => it.meta?.sourceId === 'cnn' ? idx : -1)
        .filter(i => i >= 0);
      for (let i = 1; i < cnnIndices.length; i++) {
        expect(cnnIndices[i] - cnnIndices[i - 1]).toBeGreaterThanOrEqual(3);
      }
    });
  });
});
