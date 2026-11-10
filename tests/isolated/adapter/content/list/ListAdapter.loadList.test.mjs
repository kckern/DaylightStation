// tests/isolated/adapter/content/list/ListAdapter.loadList.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock FileIO
vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => true),
  listEntries: vi.fn(() => ['test-list.yml']),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(),
  getStats: vi.fn(() => ({ mtimeMs: 0 })),
}));

const FileIO = await import('#system/utils/FileIO.mjs');
const { ListAdapter } = await import("../../../../../__capabilities/content-catalog/server/adapters/providers/list/ListAdapter.mjs");

describe('ListAdapter._loadList normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FileIO.fileExists.mockReturnValue(true);
  });

  function makeAdapter() {
    return new ListAdapter({ dataPath: '/fake/data' });
  }

  it('normalizes bare array YAML into sections', () => {
    FileIO.loadYaml.mockReturnValue([
      { label: 'Bluey', input: 'plex: 59493' },
      { label: 'Yoda', input: 'plex: 530423' }
    ]);

    const adapter = makeAdapter();
    const data = adapter._loadList('menus', 'test-list');

    expect(data.sections).toBeDefined();
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].items).toHaveLength(2);
    expect(data.sections[0].items[0].title).toBe('Bluey');
  });

  it('normalizes {title, items} YAML into sections', () => {
    FileIO.loadYaml.mockReturnValue({
      title: 'FHE',
      fixed_order: true,
      items: [
        { title: 'Opening Hymn', play: { contentId: 'hymn:166' } }
      ]
    });

    const adapter = makeAdapter();
    const data = adapter._loadList('menus', 'fhe');

    expect(data.title).toBe('FHE');
    expect(data.metadata.fixed_order).toBe(true);
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].items[0].title).toBe('Opening Hymn');
  });

  it('passes through {sections} YAML unchanged', () => {
    FileIO.loadYaml.mockReturnValue({
      title: 'Scripture',
      sections: [
        { title: 'BP', items: [{ title: 'Gen', play: { plex: '1' } }] },
        { title: 'Yale', items: [{ title: 'Intro', play: { plex: '2' } }] }
      ]
    });

    const adapter = makeAdapter();
    const data = adapter._loadList('watchlists', 'scripture');

    expect(data.sections).toHaveLength(2);
    expect(data.sections[0].title).toBe('BP');
    expect(data.sections[1].title).toBe('Yale');
  });

  it('caches normalized result', () => {
    FileIO.loadYaml.mockReturnValue([{ label: 'A', input: 'plex:1' }]);

    const adapter = makeAdapter();
    const data1 = adapter._loadList('menus', 'cached-test');
    const data2 = adapter._loadList('menus', 'cached-test');

    expect(data1).toBe(data2); // Same reference from cache
    expect(FileIO.loadYaml).toHaveBeenCalledTimes(1); // Only loaded once
  });
});

describe('menu playback start defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FileIO.fileExists.mockReturnValue(true);
  });

  it('starts menu videos at zero instead of their saved position', async () => {
    FileIO.loadYaml.mockReturnValue({
      title: 'Family evening',
      metadata: { resume: false, seconds: 0 },
      items: [
        { title: 'Lesson', input: 'plex:123' },
        { title: 'Clip', input: 'files:clips/example.mp4' },
        { title: 'Host', input: 'app:party-games/jeopardy:example', action: 'Open' },
      ],
    });
    const list = await new ListAdapter({ dataPath: '/fake/data' }).getList('menu:test-list');
    expect(list.children[0].actions.play).toMatchObject({ contentId: 'plex:123', resume: false, seconds: 0 });
    expect(list.children[1].actions.play).toMatchObject({ contentId: 'files:clips/example.mp4', resume: false, seconds: 0 });
    expect(list.children[2].actions.open).toEqual({ app: 'party-games/jeopardy:example' });
  });

  it('keeps explicit item start settings and ordinary menu defaults', async () => {
    FileIO.loadYaml.mockReturnValue({
      metadata: { resume: false, seconds: 0 },
      items: [{ title: 'Excerpt', input: 'plex:123', resume: true, seconds: 37 }],
    });
    const adapter = new ListAdapter({ dataPath: '/fake/data' });
    const custom = await adapter.getList('menu:custom');
    expect(custom.children[0].actions.play).toMatchObject({ resume: true, seconds: 37 });
    FileIO.loadYaml.mockReturnValue({ items: [{ title: 'Movie', input: 'plex:456' }] });
    const ordinary = await adapter.getList('menu:ordinary');
    expect(ordinary.children[0].actions.play).not.toHaveProperty('resume');
    expect(ordinary.children[0].actions.play).not.toHaveProperty('seconds');
  });

  it('preserves explicit action overrides on queued media', async () => {
    FileIO.loadYaml.mockReturnValue({
      metadata: { resume: false, seconds: 0 },
      items: [{ title: 'Excerpt', queue: { contentId: 'plex:123', resume: true, seconds: 15 } }],
    });
    const list = await new ListAdapter({ dataPath: '/fake/data' }).getList('menu:test-list');
    expect(list.children[0].actions.queue).toMatchObject({ resume: true, seconds: 15 });
  });
});
