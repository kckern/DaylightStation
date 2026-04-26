import { describe, it, expect, vi } from 'vitest';
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';

describe('YamlTriggerConfigRepository', () => {
  it('reads three YAML paths via injected loadFile and returns the registry', () => {
    const blobs = {
      'config/triggers/nfc/locations': { livingroom: { target: 'livingroom-tv', action: 'play-next' } },
      'config/triggers/nfc/tags': { '83_8e_68_06': { plex: 620707 } },
      'config/triggers/state/locations': { livingroom: { target: 'livingroom-tv', states: { off: { action: 'clear' } } } },
    };
    const loadFile = vi.fn((p) => blobs[p] ?? null);

    const repo = new YamlTriggerConfigRepository();
    const registry = repo.loadRegistry({ loadFile });

    expect(loadFile).toHaveBeenCalledWith('config/triggers/nfc/locations');
    expect(loadFile).toHaveBeenCalledWith('config/triggers/nfc/tags');
    expect(loadFile).toHaveBeenCalledWith('config/triggers/state/locations');
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
    });
  });

  it('throws ValidationError when a parser rejects the YAML (does not swallow)', () => {
    const loadFile = (p) => p === 'config/triggers/nfc/locations'
      ? { livingroom: 'oops' }   // invalid: location must be an object
      : null;
    const repo = new YamlTriggerConfigRepository();
    expect(() => repo.loadRegistry({ loadFile })).toThrow(/location "livingroom".*object/i);
  });
});

describe('YamlTriggerConfigRepository write methods', () => {
  function makeRepo({ initialTags = {}, locations = { livingroom: { target: 'livingroom-tv' } } } = {}) {
    const blobs = {
      'config/triggers/nfc/locations': locations,
      'config/triggers/nfc/tags': initialTags,
      'config/triggers/state/locations': null,
    };
    const loadFile = vi.fn((p) => blobs[p] ?? null);
    const saveFile = vi.fn();
    const repo = new YamlTriggerConfigRepository({ saveFile });
    const registry = repo.loadRegistry({ loadFile });
    return { repo, registry, saveFile };
  }

  it('upsertNfcPlaceholder creates a new entry with scanned_at', async () => {
    const { repo, registry, saveFile } = makeRepo();
    const result = await repo.upsertNfcPlaceholder('04_a1_b2_c3', '2026-04-26 14:32:18');
    expect(result.created).toBe(true);
    expect(registry.nfc.tags['04_a1_b2_c3']).toEqual({
      global: { scanned_at: '2026-04-26 14:32:18' },
      overrides: {},
    });
    expect(saveFile).toHaveBeenCalledWith(
      'config/triggers/nfc/tags',
      { '04_a1_b2_c3': { scanned_at: '2026-04-26 14:32:18' } }
    );
  });

  it('upsertNfcPlaceholder is a no-op when entry already exists', async () => {
    const { repo, registry, saveFile } = makeRepo({
      initialTags: { '04_a1_b2_c3': { scanned_at: '2026-04-26 10:00:00' } },
    });
    const result = await repo.upsertNfcPlaceholder('04_a1_b2_c3', '2026-04-26 14:32:18');
    expect(result.created).toBe(false);
    // Original timestamp preserved (init time, never updated):
    expect(registry.nfc.tags['04_a1_b2_c3'].global.scanned_at).toBe('2026-04-26 10:00:00');
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('setNfcNote upserts: creates entry with scanned_at + note when missing', async () => {
    const { repo, registry, saveFile } = makeRepo();
    const result = await repo.setNfcNote('04_a1_b2_c3', 'kids favorite', '2026-04-26 14:32:18');
    expect(result.created).toBe(true);
    expect(registry.nfc.tags['04_a1_b2_c3'].global).toEqual({
      scanned_at: '2026-04-26 14:32:18',
      note: 'kids favorite',
    });
    expect(saveFile).toHaveBeenCalledWith(
      'config/triggers/nfc/tags',
      { '04_a1_b2_c3': { scanned_at: '2026-04-26 14:32:18', note: 'kids favorite' } }
    );
  });

  it('setNfcNote overwrites existing note, preserves scanned_at', async () => {
    const { repo, registry, saveFile } = makeRepo({
      initialTags: { '04_a1_b2_c3': { scanned_at: '2026-04-26 10:00:00', note: 'old' } },
    });
    const result = await repo.setNfcNote('04_a1_b2_c3', 'new', '2026-04-26 99:99:99');
    expect(result.created).toBe(false);
    expect(registry.nfc.tags['04_a1_b2_c3'].global).toEqual({
      scanned_at: '2026-04-26 10:00:00',
      note: 'new',
    });
    expect(saveFile).toHaveBeenLastCalledWith(
      'config/triggers/nfc/tags',
      { '04_a1_b2_c3': { scanned_at: '2026-04-26 10:00:00', note: 'new' } }
    );
  });

  it('setNfcNote on a promoted tag preserves intent fields and overrides', async () => {
    const { repo, registry, saveFile } = makeRepo({
      initialTags: {
        '83_8e_68_06': {
          plex: 620707,
          livingroom: { shader: 'blackout' },
        },
      },
    });
    await repo.setNfcNote('83_8e_68_06', 'star wars', '2026-04-26 14:32:18');
    expect(registry.nfc.tags['83_8e_68_06']).toEqual({
      global: { plex: 620707, note: 'star wars', scanned_at: '2026-04-26 14:32:18' },
      overrides: { livingroom: { shader: 'blackout' } },
    });
    expect(saveFile).toHaveBeenCalledWith(
      'config/triggers/nfc/tags',
      {
        '83_8e_68_06': {
          plex: 620707,
          note: 'star wars',
          scanned_at: '2026-04-26 14:32:18',
          livingroom: { shader: 'blackout' },
        },
      }
    );
  });

  it('serializes concurrent writes through a mutex (no lost writes)', async () => {
    const { repo, registry, saveFile } = makeRepo();
    // Make saveFile slow to expose race conditions
    let resolveOrder = [];
    saveFile.mockImplementation((path, data) => {
      resolveOrder.push(Object.keys(data));
      return new Promise((r) => setImmediate(r));
    });

    await Promise.all([
      repo.upsertNfcPlaceholder('aa', '2026-04-26 14:00:00'),
      repo.upsertNfcPlaceholder('bb', '2026-04-26 14:00:01'),
      repo.upsertNfcPlaceholder('cc', '2026-04-26 14:00:02'),
    ]);
    expect(Object.keys(registry.nfc.tags)).toEqual(['aa', 'bb', 'cc']);
    // Each write saw the cumulative state of prior writes:
    expect(resolveOrder[0]).toEqual(['aa']);
    expect(resolveOrder[1]).toEqual(['aa', 'bb']);
    expect(resolveOrder[2]).toEqual(['aa', 'bb', 'cc']);
  });

  it('throws if write methods called before loadRegistry', async () => {
    const repo = new YamlTriggerConfigRepository({ saveFile: vi.fn() });
    await expect(repo.upsertNfcPlaceholder('aa', '2026-04-26 14:00:00'))
      .rejects.toThrow(/registry not loaded/i);
  });

  it('throws if constructed without saveFile and a write is attempted', async () => {
    const repo = new YamlTriggerConfigRepository();
    repo.loadRegistry({ loadFile: () => null });
    await expect(repo.upsertNfcPlaceholder('aa', '2026-04-26 14:00:00'))
      .rejects.toThrow(/saveFile not configured/i);
  });
});
