import { describe, it, expect, vi } from 'vitest';
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';
import { YamlObservedStateStore } from '#adapters/persistence/yaml/YamlObservedStateStore.mjs';

describe('YamlTriggerConfigRepository', () => {
  it('reads four YAML paths via injected loadFile and returns the registry', () => {
    const blobs = {
      'config/triggers/sources': {
        'livingroom-nfc': { modality: 'nfc', location: 'livingroom', target: 'livingroom-tv', action: 'play-next' },
        'livingroom-state': { modality: 'state', location: 'livingroom', target: 'livingroom-tv', states: { off: { action: 'clear' } } },
      },
      'config/triggers/bindings/nfc': { '83_8e_68_06': { plex: 620707 } },
      'config/triggers/responses': {},
      'config/triggers/endpoints': {},
    };
    const loadFile = vi.fn((p) => blobs[p] ?? null);

    const repo = new YamlTriggerConfigRepository();
    const registry = repo.loadRegistry({ loadFile });

    expect(loadFile).toHaveBeenCalledWith('config/triggers/sources');
    expect(loadFile).toHaveBeenCalledWith('config/triggers/bindings/nfc');
    expect(loadFile).toHaveBeenCalledWith('config/triggers/responses');
    expect(loadFile).toHaveBeenCalledWith('config/triggers/endpoints');
    expect(registry.nfc.locations.livingroom.target).toBe('livingroom-tv');
    expect(registry.nfc.tags['83_8e_68_06'].global).toEqual({ plex: 620707 });
    expect(registry.state.locations.livingroom.states.off).toEqual({ action: 'clear' });
  });

  it('returns an empty-shape registry when all files are missing', () => {
    const loadFile = () => null;
    const repo = new YamlTriggerConfigRepository();
    expect(repo.loadRegistry({ loadFile })).toEqual({
      nfc: { locations: {}, tags: {} },
      state: { locations: {} },
      responses: {},
      endpoints: {},
    });
  });

  it('throws ValidationError when a parser rejects the YAML (does not swallow)', () => {
    const loadFile = (p) => p === 'config/triggers/sources'
      ? { livingroom: 'oops' }   // invalid: source entry must be an object
      : null;
    const repo = new YamlTriggerConfigRepository();
    expect(() => repo.loadRegistry({ loadFile })).toThrow(/source "livingroom".*object/i);
  });
});

describe('YamlTriggerConfigRepository write methods', () => {
  function makeRepo({
    initialTags = {},
    sources = { livingroom: { modality: 'nfc', location: 'livingroom', target: 'livingroom-tv' } },
    observedHistory = {},
  } = {}) {
    const disk = {
      'config/triggers/sources': sources,
      'config/triggers/bindings/nfc': initialTags,
      'config/triggers/responses': null,
      'config/triggers/endpoints': null,
      'history/triggers/nfc.observed': observedHistory,
    };
    const loadFile = vi.fn((p) => disk[p] ?? null);
    const saveFile = vi.fn((p, d) => { disk[p] = d; });
    const observedStore = new YamlObservedStateStore({ loadFile, saveFile });
    observedStore.load();
    const repo = new YamlTriggerConfigRepository({ saveFile, observedStore });
    const registry = repo.loadRegistry({ loadFile });
    return { repo, registry, saveFile, disk, observedStore };
  }

  it('recordObserved writes history on first sighting, never touches bindings', async () => {
    const { repo, disk } = makeRepo();
    const result = await repo.recordObserved('04_a1_b2_c3', '2026-04-26 14:32:18');
    expect(result.created).toBe(true);
    expect(disk['history/triggers/nfc.observed']['04_a1_b2_c3']).toEqual({
      first_seen: '2026-04-26 14:32:18',
      last_seen: '2026-04-26 14:32:18',
      count: 1,
    });
    expect(disk['config/triggers/bindings/nfc']['04_a1_b2_c3']).toBeUndefined();
  });

  it('recordObserved on a repeat sighting returns created:false but still updates history', async () => {
    const { repo, disk } = makeRepo({
      observedHistory: {
        '04_a1_b2_c3': { first_seen: '2026-04-26 10:00:00', last_seen: '2026-04-26 10:00:00', count: 1 },
      },
    });
    const result = await repo.recordObserved('04_a1_b2_c3', '2026-04-26 14:32:18');
    expect(result.created).toBe(false);
    expect(disk['history/triggers/nfc.observed']['04_a1_b2_c3']).toEqual({
      first_seen: '2026-04-26 10:00:00',
      last_seen: '2026-04-26 14:32:18',
      count: 2,
    });
  });

  it('recordObserved resolves created:false (no-op) when no observedStore configured', async () => {
    const repo = new YamlTriggerConfigRepository({ saveFile: vi.fn() });
    const result = await repo.recordObserved('aa', '2026-04-26 14:00:00');
    expect(result).toEqual({ created: false });
  });

  it('setNfcNote upserts: creates a bindings entry with just the note; timestamp goes to history', async () => {
    const { repo, registry, disk } = makeRepo();
    const result = await repo.setNfcNote('04_a1_b2_c3', 'kids favorite', '2026-04-26 14:32:18');
    expect(result.created).toBe(true);
    expect(registry.nfc.tags['04_a1_b2_c3'].global).toEqual({ note: 'kids favorite' });
    expect(disk['config/triggers/bindings/nfc']).toEqual({
      '04_a1_b2_c3': { note: 'kids favorite' },
    });
    expect(disk['config/triggers/bindings/nfc']['04_a1_b2_c3'].scanned_at).toBeUndefined();
    expect(disk['history/triggers/nfc.observed']['04_a1_b2_c3'].last_seen).toBe('2026-04-26 14:32:18');
  });

  it('setNfcNote overwrites an existing note; still records a history timestamp', async () => {
    const { repo, registry, disk } = makeRepo({
      initialTags: { '04_a1_b2_c3': { note: 'old' } },
    });
    const result = await repo.setNfcNote('04_a1_b2_c3', 'new', '2026-04-26 14:32:18');
    expect(result.created).toBe(false);
    expect(registry.nfc.tags['04_a1_b2_c3'].global).toEqual({ note: 'new' });
    expect(disk['config/triggers/bindings/nfc']).toEqual({
      '04_a1_b2_c3': { note: 'new' },
    });
    expect(disk['history/triggers/nfc.observed']['04_a1_b2_c3'].last_seen).toBe('2026-04-26 14:32:18');
  });

  it('setNfcNote on a promoted tag preserves intent fields and overrides', async () => {
    const { repo, registry, disk } = makeRepo({
      initialTags: {
        '83_8e_68_06': {
          plex: 620707,
          livingroom: { shader: 'blackout' },
        },
      },
    });
    await repo.setNfcNote('83_8e_68_06', 'star wars', '2026-04-26 14:32:18');
    expect(registry.nfc.tags['83_8e_68_06']).toEqual({
      global: { plex: 620707, note: 'star wars' },
      overrides: { livingroom: { shader: 'blackout' } },
    });
    expect(disk['config/triggers/bindings/nfc']).toEqual({
      '83_8e_68_06': {
        plex: 620707,
        note: 'star wars',
        livingroom: { shader: 'blackout' },
      },
    });
  });

  it('serializes concurrent recordObserved writes through a mutex (no lost writes)', async () => {
    const { repo, disk, saveFile } = makeRepo();
    const resolveOrder = [];
    saveFile.mockImplementation((path, data) => {
      disk[path] = data;
      if (path === 'history/triggers/nfc.observed') resolveOrder.push(Object.keys(data));
      return new Promise((r) => setImmediate(r));
    });

    await Promise.all([
      repo.recordObserved('aa', '2026-04-26 14:00:00'),
      repo.recordObserved('bb', '2026-04-26 14:00:01'),
      repo.recordObserved('cc', '2026-04-26 14:00:02'),
    ]);
    expect(Object.keys(disk['history/triggers/nfc.observed'])).toEqual(['aa', 'bb', 'cc']);
    // Each write saw the cumulative state of prior writes:
    expect(resolveOrder[0]).toEqual(['aa']);
    expect(resolveOrder[1]).toEqual(['aa', 'bb']);
    expect(resolveOrder[2]).toEqual(['aa', 'bb', 'cc']);
  });

  it('serializes concurrent setNfcNote writes through a mutex (no lost writes)', async () => {
    const { repo, registry, saveFile } = makeRepo();
    let resolveOrder = [];
    saveFile.mockImplementation((path, data) => {
      if (path === 'config/triggers/bindings/nfc') resolveOrder.push(Object.keys(data));
      return new Promise((r) => setImmediate(r));
    });

    await Promise.all([
      repo.setNfcNote('aa', 'Note A', '2026-04-26 14:00:00'),
      repo.setNfcNote('bb', 'Note B', '2026-04-26 14:00:01'),
      repo.setNfcNote('cc', 'Note C', '2026-04-26 14:00:02'),
    ]);
    expect(Object.keys(registry.nfc.tags)).toEqual(['aa', 'bb', 'cc']);
    expect(resolveOrder[0]).toEqual(['aa']);
    expect(resolveOrder[1]).toEqual(['aa', 'bb']);
    expect(resolveOrder[2]).toEqual(['aa', 'bb', 'cc']);
  });

  it('throws if setNfcNote called before loadRegistry', async () => {
    const repo = new YamlTriggerConfigRepository({ saveFile: vi.fn() });
    await expect(repo.setNfcNote('aa', 'note', '2026-04-26 14:00:00'))
      .rejects.toThrow(/registry not loaded/i);
  });

  it('throws if constructed without saveFile and setNfcNote is attempted', async () => {
    const repo = new YamlTriggerConfigRepository();
    repo.loadRegistry({ loadFile: () => null });
    await expect(repo.setNfcNote('aa', 'note', '2026-04-26 14:00:00'))
      .rejects.toThrow(/saveFile not configured/i);
  });
});
