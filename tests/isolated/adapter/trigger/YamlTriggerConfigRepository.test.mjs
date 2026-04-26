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
