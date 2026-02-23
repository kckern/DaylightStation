// tests/unit/suite/adapters/RetroArchAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { RetroArchAdapter } from '#adapters/content/retroarch/RetroArchAdapter.mjs';

// Minimal fixture data matching catalog.yml + config.yml shapes
const mockConfig = {
  launch: {
    package: 'com.retroarch.aarch64',
    activity: 'com.retroarch.browser.retroactivity.RetroActivityFuture',
    device_constraint: 'android'
  },
  consoles: {
    n64: { label: 'Nintendo 64', core: '/data/local/tmp/mupen64plus.so', menuStyle: 'arcade' },
    snes: { label: 'Super Nintendo', core: '/data/local/tmp/snes9x.so', menuStyle: 'arcade' }
  },
  thumbnails: { base_path: '/data/retroarch/thumbnails' }
};

const mockCatalog = {
  sync: { last_synced: '2026-02-23T10:00:00Z', game_count: 3 },
  games: {
    n64: [
      { id: 'mario-kart-64', title: 'Mario Kart 64', rom: '/Games/N64/Mario Kart 64.n64', thumbnail: 'n64/mario-kart-64.png' },
      { id: 'star-fox-64', title: 'Star Fox 64', rom: '/Games/N64/Star Fox 64.n64', thumbnail: 'n64/star-fox-64.png' }
    ],
    snes: [
      { id: 'zelda-alttp', title: 'Zelda: A Link to the Past', rom: '/Games/SNES/Zelda.smc', thumbnail: 'snes/zelda-alttp.png' }
    ]
  },
  overrides: {
    'n64/mario-kart-64': { title: 'MK64 Custom' }
  }
};

describe('RetroArchAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new RetroArchAdapter({
      config: mockConfig,
      catalog: mockCatalog,
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  it('has source "retroarch" and correct prefix', () => {
    expect(adapter.source).toBe('retroarch');
    expect(adapter.prefixes).toEqual([{ prefix: 'retroarch' }]);
  });

  describe('getList', () => {
    it('returns consoles at root level (no arg)', async () => {
      const list = await adapter.getList();
      expect(list).toHaveLength(2);
      expect(list[0]).toEqual(expect.objectContaining({
        id: 'retroarch:n64',
        title: 'Nintendo 64',
        type: 'console'
      }));
    });

    it('returns consoles at root level (compound ID with empty localId)', async () => {
      const list = await adapter.getList('retroarch:');
      expect(list).toHaveLength(2);
    });

    it('returns games for a console (bare localId)', async () => {
      const list = await adapter.getList('n64');
      expect(list).toHaveLength(2);
      expect(list[0]).toEqual(expect.objectContaining({
        id: 'retroarch:n64/mario-kart-64',
        title: 'MK64 Custom', // override applied
        type: 'game'
      }));
    });

    it('returns games for a console (compound ID)', async () => {
      const list = await adapter.getList('retroarch:n64');
      expect(list).toHaveLength(2);
    });

    it('returns game items with launch action', async () => {
      const list = await adapter.getList('retroarch:n64');
      expect(list).toHaveLength(2);
      // Each game item should have actions.launch with its compound contentId
      expect(list[0].actions).toEqual({
        launch: { contentId: 'retroarch:n64/mario-kart-64' }
      });
      expect(list[1].actions).toEqual({
        launch: { contentId: 'retroarch:n64/star-fox-64' }
      });
    });

    it('returns console items with list action for drill-down', async () => {
      const list = await adapter.getList('retroarch:');
      expect(list[0].actions).toEqual({
        list: { contentId: 'retroarch:n64' }
      });
    });
  });

  describe('getItem', () => {
    it('returns LaunchableItem with launchIntent (bare localId)', async () => {
      const item = await adapter.getItem('n64/mario-kart-64');
      expect(item).not.toBeNull();
      expect(item.title).toBe('MK64 Custom'); // override
      expect(item.launchIntent).toEqual({
        target: 'com.retroarch.aarch64/com.retroarch.browser.retroactivity.RetroActivityFuture',
        params: {
          ROM: '/Games/N64/Mario Kart 64.n64',
          LIBRETRO: '/data/local/tmp/mupen64plus.so'
        }
      });
      expect(item.deviceConstraint).toBe('android');
      expect(item.console).toBe('n64');
    });

    it('returns LaunchableItem with compound ID', async () => {
      const item = await adapter.getItem('retroarch:n64/mario-kart-64');
      expect(item).not.toBeNull();
      expect(item.title).toBe('MK64 Custom');
    });

    it('returns null for unknown game', async () => {
      const item = await adapter.getItem('n64/nonexistent');
      expect(item).toBeNull();
    });
  });

  describe('resolvePlayables', () => {
    it('returns empty array (games are not playable)', async () => {
      const result = await adapter.resolvePlayables('n64/mario-kart-64');
      expect(result).toEqual([]);
    });
  });

  describe('resolveSiblings', () => {
    it('returns parent console and sibling games', async () => {
      const result = await adapter.resolveSiblings('retroarch:n64/mario-kart-64');
      expect(result.parent).toEqual(expect.objectContaining({
        id: 'retroarch:n64',
        title: 'Nintendo 64'
      }));
      expect(result.items).toHaveLength(2);
    });
  });

  describe('search', () => {
    it('finds games by text', async () => {
      const result = await adapter.search({ text: 'mario' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('MK64 Custom');
    });

    it('finds games by console filter', async () => {
      const result = await adapter.search({ text: '', console: 'snes' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Zelda: A Link to the Past');
    });
  });
});
