// tests/isolated/adapter/content/list/ListAdapter.loadList.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock FileIO
vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => true),
  listEntries: vi.fn(() => ['test-list.yml']),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(),
}));

const FileIO = await import('#system/utils/FileIO.mjs');
const { ListAdapter } = await import('#adapters/content/list/ListAdapter.mjs');

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
