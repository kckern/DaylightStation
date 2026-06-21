// tests/isolated/adapter/persistence/YamlMediaProgressMemory.readCache.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock FileIO so we can count parses (loadYamlSafe) and control mtime (getStats).
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlSafe: vi.fn(() => ({ 'plex:1': { percent: 50, playhead: 10 } })),
  saveYaml: vi.fn(),
  deleteYaml: vi.fn(),
  listYamlFiles: vi.fn(() => []),
  dirExists: vi.fn(() => false),
  resolveYamlPath: vi.fn(() => '/fake/base/plex.yml'),
  getStats: vi.fn(() => ({ mtimeMs: 100 })),
}));

const FileIO = await import('#system/utils/FileIO.mjs');
const { MediaProgress } = await import('#domains/content/entities/MediaProgress.mjs');
const { YamlMediaProgressMemory } = await import(
  '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs'
);

function makeMemory() {
  return new YamlMediaProgressMemory({ basePath: '/fake/base' });
}

describe('YamlMediaProgressMemory read cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FileIO.getStats.mockReturnValue({ mtimeMs: 100 });
    FileIO.loadYamlSafe.mockReturnValue({ 'plex:1': { percent: 50, playhead: 10 } });
  });

  it('parses the file once across repeated reads when mtime is unchanged', async () => {
    const memory = makeMemory();
    await memory.get('plex:1', 'plex');
    await memory.get('plex:1', 'plex');
    await memory.getAll('plex');
    expect(FileIO.loadYamlSafe).toHaveBeenCalledTimes(1);
  });

  it('re-parses when the file mtime changes', async () => {
    const memory = makeMemory();
    await memory.get('plex:1', 'plex'); // parse 1
    FileIO.getStats.mockReturnValue({ mtimeMs: 200 });
    await memory.get('plex:1', 'plex'); // parse 2
    expect(FileIO.loadYamlSafe).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache on write so a writer never reads stale data', async () => {
    const memory = makeMemory();
    await memory.get('plex:1', 'plex'); // parse 1, cache populated
    await memory.set(
      new MediaProgress({ contentId: 'plex:1', playhead: 20, duration: 100 }),
      'plex'
    ); // invalidates
    await memory.get('plex:1', 'plex'); // parse 2
    expect(FileIO.loadYamlSafe).toHaveBeenCalledTimes(2);
  });

  it('caches per storage path independently', async () => {
    const memory = makeMemory();
    await memory.get('plex:1', 'plex');
    await memory.get('plex:1', 'scripture');
    expect(FileIO.loadYamlSafe).toHaveBeenCalledTimes(2);
  });
});
