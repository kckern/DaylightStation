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
      'config/triggers/bindings/nfc': { '838e6806': { plex: 620707 } },
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
    expect(registry.nfc.tags['838e6806'].global).toEqual({ plex: 620707 });
    expect(registry.state.locations.livingroom.states.off).toEqual({ action: 'clear' });
  });

  it('returns an empty-shape registry when all files are missing', () => {
    const loadFile = () => null;
    const repo = new YamlTriggerConfigRepository();
    expect(repo.loadRegistry({ loadFile })).toEqual({
      nfc: { locations: {}, tags: {} },
      state: { locations: {} },
      barcode: { locations: {} },
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

  // ---- grouped tag files -------------------------------------------------
  // One monolith mixed audiobooks with personal identity cards. Grouping splits
  // them; these guard the two ways a split silently undoes itself.
  describe('grouped NFC bindings directory', () => {
    const SOURCES = {
      'livingroom-nfc': { modality: 'nfc', location: 'livingroom', target: 'tv', action: 'play-next' },
    };

    function harness(dirFiles, { single = null } = {}) {
      const saved = {};
      const blobs = {
        'config/triggers/sources': SOURCES,
        'config/triggers/bindings/nfc': single,
        ...Object.fromEntries(
          Object.entries(dirFiles).map(([f, blob]) => [`config/triggers/bindings/nfc/${f.replace(/\.ya?ml$/, '')}`, blob])
        ),
      };
      const repo = new YamlTriggerConfigRepository({ saveFile: (p, data) => { saved[p] = data; } });
      const registry = repo.loadRegistry({
        loadFile: (p) => blobs[p] ?? null,
        listDir: () => Object.keys(dirFiles),
      });
      return { repo, registry, saved };
    }

    it('merges every grouped file into one registry', () => {
      const { registry } = harness({
        'books.yml': { '83_8e_68_06': { plex: 620707 } },
        'cards.yml': { '04669C0FCB2A81': { note: 'personal card', school_learner: 'test-learner' } },
      });
      expect(Object.keys(registry.nfc.tags).sort()).toEqual(['04669c0fcb2a81', '838e6806']);
      expect(registry.nfc.tags['04669c0fcb2a81'].global.school_learner).toBe('test-learner');
    });

    it('rejects one uid claimed by two files instead of letting readdir order decide', () => {
      expect(() => harness({
        'books.yml': { '04_66_9c_0f_cb_2a_81': { plex: 1 } },
        'cards.yml': { '04669C0FCB2A81': { note: 'personal card' } },
      })).toThrow(/appears in both.*books\.yml.*cards\.yml/i);
    });

    it('refuses to boot when the single file AND the directory both hold entries', () => {
      // The exact trap this household already hit: two plausible tag files
      // diverging with nothing to say which was authoritative.
      expect(() => harness(
        { 'books.yml': { '838e6806': { plex: 1 } } },
        { single: { aabb: { plex: 2 } } }
      )).toThrow(/BOTH/i);
    });

    it('writes a note back to the file the tag came from, not into one monolith', async () => {
      const { repo, saved } = harness({
        'books.yml': { '838e6806': { plex: 620707 } },
        'cards.yml': { '04669c0fcb2a81': { note: 'personal card' } },
      });
      await repo.setNfcNote('04_66_9C_0F_CB_2A_81', 'a personal card', '2026-07-29 20:19:17');

      expect(Object.keys(saved)).toEqual(['config/triggers/bindings/nfc/cards']);
      expect(saved['config/triggers/bindings/nfc/cards']['04669c0fcb2a81'].note).toBe('a personal card');
      // Books must not be dragged into the cards file — collapsing groups back
      // together is exactly what the old whole-registry flush did.
      expect(saved['config/triggers/bindings/nfc/cards']['838e6806']).toBeUndefined();
      expect(saved['config/triggers/bindings/nfc/books']).toBeUndefined();
    });

    it('files a never-before-seen tag into unsorted.yml', async () => {
      const { repo, saved } = harness({ 'books.yml': { '838e6806': { plex: 620707 } } });
      await repo.setNfcNote('0a_0b_0c_0d', 'mystery tag', '2026-07-29 21:00:00');
      expect(saved['config/triggers/bindings/nfc/unsorted']).toEqual({
        '0a0b0c0d': { note: 'mystery tag' },
      });
    });

    it('still writes to the single file when no directory exists', async () => {
      const saved = {};
      const repo = new YamlTriggerConfigRepository({ saveFile: (p, d) => { saved[p] = d; } });
      repo.loadRegistry({
        loadFile: (p) => (p === 'config/triggers/sources' ? SOURCES
          : p === 'config/triggers/bindings/nfc' ? { '838e6806': { plex: 620707 } } : null),
        listDir: () => [],
      });
      await repo.setNfcNote('838e6806', 'renamed', '2026-07-29 21:00:00');
      expect(saved['config/triggers/bindings/nfc']['838e6806'].note).toBe('renamed');
    });
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
    const result = await repo.recordObserved('04a1b2c3', '2026-04-26 14:32:18');
    expect(result.created).toBe(true);
    expect(disk['history/triggers/nfc.observed']['04a1b2c3']).toEqual({
      first_seen: '2026-04-26 14:32:18',
      last_seen: '2026-04-26 14:32:18',
      count: 1,
    });
    expect(disk['config/triggers/bindings/nfc']['04a1b2c3']).toBeUndefined();
  });

  it('recordObserved on a repeat sighting returns created:false but still updates history', async () => {
    const { repo, disk } = makeRepo({
      observedHistory: {
        '04a1b2c3': { first_seen: '2026-04-26 10:00:00', last_seen: '2026-04-26 10:00:00', count: 1 },
      },
    });
    const result = await repo.recordObserved('04a1b2c3', '2026-04-26 14:32:18');
    expect(result.created).toBe(false);
    expect(disk['history/triggers/nfc.observed']['04a1b2c3']).toEqual({
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
    const result = await repo.setNfcNote('04a1b2c3', 'kids favorite', '2026-04-26 14:32:18');
    expect(result.created).toBe(true);
    expect(registry.nfc.tags['04a1b2c3'].global).toEqual({ note: 'kids favorite' });
    expect(disk['config/triggers/bindings/nfc']).toEqual({
      '04a1b2c3': { note: 'kids favorite' },
    });
    expect(disk['config/triggers/bindings/nfc']['04a1b2c3'].scanned_at).toBeUndefined();
    expect(disk['history/triggers/nfc.observed']['04a1b2c3'].last_seen).toBe('2026-04-26 14:32:18');
  });

  it('setNfcNote overwrites an existing note; still records a history timestamp', async () => {
    const { repo, registry, disk } = makeRepo({
      initialTags: { '04a1b2c3': { note: 'old' } },
    });
    const result = await repo.setNfcNote('04a1b2c3', 'new', '2026-04-26 14:32:18');
    expect(result.created).toBe(false);
    expect(registry.nfc.tags['04a1b2c3'].global).toEqual({ note: 'new' });
    expect(disk['config/triggers/bindings/nfc']).toEqual({
      '04a1b2c3': { note: 'new' },
    });
    expect(disk['history/triggers/nfc.observed']['04a1b2c3'].last_seen).toBe('2026-04-26 14:32:18');
  });

  it('setNfcNote on a promoted tag preserves intent fields and overrides', async () => {
    const { repo, registry, disk } = makeRepo({
      initialTags: {
        '838e6806': {
          plex: 620707,
          livingroom: { shader: 'blackout' },
        },
      },
    });
    await repo.setNfcNote('838e6806', 'star wars', '2026-04-26 14:32:18');
    expect(registry.nfc.tags['838e6806']).toEqual({
      global: { plex: 620707, note: 'star wars' },
      overrides: { livingroom: { shader: 'blackout' } },
    });
    expect(disk['config/triggers/bindings/nfc']).toEqual({
      '838e6806': {
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
