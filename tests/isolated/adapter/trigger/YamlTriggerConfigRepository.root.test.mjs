import { describe, it, expect } from 'vitest';
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';

const LEGACY = 'config/triggers';
const GROUPED = 'triggers';

/**
 * A fake disk that behaves like the real one: `listDir` is DERIVED from the
 * keys rather than hardcoded, so a write genuinely changes what a later load
 * sees. That is the whole point — the bug this file guards only appears across
 * a write/reload boundary.
 */
function makeDisk(initial = {}) {
  const disk = { ...initial };
  const loadFile = (p) => (p in disk ? disk[p] : null);
  const saveFile = (p, d) => { disk[p] = d; };
  const listDir = (dir) => Object.keys(disk)
    .filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/'))
    .map((k) => `${k.slice(dir.length + 1)}.yml`)
    .sort();
  return { disk, loadFile, saveFile, listDir };
}

const load = (io) => {
  const repo = new YamlTriggerConfigRepository({ saveFile: io.saveFile });
  const registry = repo.loadRegistry({ loadFile: io.loadFile, listDir: io.listDir });
  return { repo, registry };
};

const SOURCES = { livingroom: { modality: 'nfc', location: 'livingroom', target: 'tv', action: 'play-next' } };

describe('YamlTriggerConfigRepository root resolution', () => {
  // The regression this file exists for. Under "read falls back to legacy but
  // write always targets the grouped root", the note edit below creates
  // triggers/bindings/nfc/books.yml; on the next load that non-empty grouped
  // directory wins outright and every cards.yml tag silently disappears.
  it('does not lose sibling group files when a tag is edited on a legacy tree', async () => {
    const io = makeDisk({
      [`${LEGACY}/sources`]: SOURCES,
      [`${LEGACY}/bindings/nfc/books`]: { '838e6806': { plex: 620707 } },
      [`${LEGACY}/bindings/nfc/cards`]: { '04669c0fcb2a81': { note: 'personal card' } },
      // Machine-written runtime state, already living under the grouped root
      // today. It must NOT make the grouped root look like it owns config.
      [`${GROUPED}/nfc.observed`]: {},
    });

    const first = load(io);
    expect(first.repo.root).toBe(LEGACY);

    await first.repo.setNfcNote('838e6806', 'Star Wars', '2026-08-21 10:00:00');

    // The write stayed on the resolved root — nothing was half-migrated.
    expect(Object.keys(io.disk).filter((k) => k.startsWith(`${GROUPED}/bindings/`))).toEqual([]);
    expect(io.disk[`${LEGACY}/bindings/nfc/books`]['838e6806'].note).toBe('Star Wars');

    // Reload from the very same disk: BOTH groups must still resolve.
    const second = load(io);
    expect(second.repo.root).toBe(LEGACY);
    expect(Object.keys(second.registry.nfc.tags).sort()).toEqual(['04669c0fcb2a81', '838e6806']);
    expect(second.registry.nfc.tags['838e6806'].global.note).toBe('Star Wars');
    expect(second.registry.nfc.tags['04669c0fcb2a81'].global.note).toBe('personal card');
  });

  it('nfc.observed.yml alone never selects the grouped root', () => {
    const io = makeDisk({
      [`${LEGACY}/sources`]: SOURCES,
      [`${LEGACY}/bindings/nfc`]: { '838e6806': { plex: 620707 } },
      [`${GROUPED}/nfc.observed`]: { '838e6806': { count: 3 } },
    });
    const { repo, registry } = load(io);
    expect(repo.root).toBe(LEGACY);
    expect(registry.nfc.tags['838e6806'].global.plex).toBe(620707);
  });

  it('uses the grouped root once the config actually lives there, for reads AND writes', async () => {
    const io = makeDisk({
      [`${GROUPED}/sources`]: SOURCES,
      [`${GROUPED}/bindings/nfc/books`]: { '838e6806': { plex: 620707 } },
      [`${GROUPED}/bindings/nfc/cards`]: { '04669c0fcb2a81': { note: 'personal card' } },
      [`${GROUPED}/nfc.observed`]: {},
    });

    const { repo, registry } = load(io);
    expect(repo.root).toBe(GROUPED);
    expect(Object.keys(registry.nfc.tags).sort()).toEqual(['04669c0fcb2a81', '838e6806']);

    await repo.setNfcNote('04669c0fcb2a81', 'renamed', '2026-08-21 10:00:00');
    expect(io.disk[`${GROUPED}/bindings/nfc/cards`]['04669c0fcb2a81'].note).toBe('renamed');
    expect(Object.keys(io.disk).filter((k) => k.startsWith(`${LEGACY}/`))).toEqual([]);
  });

  it('refuses to boot when trigger config exists under BOTH roots', () => {
    const io = makeDisk({
      [`${LEGACY}/sources`]: SOURCES,
      [`${LEGACY}/bindings/nfc/cards`]: { '04669c0fcb2a81': { note: 'personal card' } },
      [`${GROUPED}/bindings/nfc/books`]: { '838e6806': { plex: 620707 } },
    });
    expect(() => load(io)).toThrow(/BOTH triggers\/.*and config\/triggers\//is);
  });

  it('names both roots in the ambiguity error so the fix is obvious', () => {
    const io = makeDisk({
      [`${LEGACY}/sources`]: SOURCES,
      [`${GROUPED}/sources`]: SOURCES,
    });
    try {
      load(io);
      throw new Error('expected a ValidationError');
    } catch (err) {
      expect(err.code ?? err.details?.code ?? err.context?.code).toBe('TRIGGER_ROOTS_AMBIGUOUS');
      expect(err.message).toMatch(/triggers\/sources/);
      expect(err.message).toMatch(/config\/triggers\/sources/);
    }
  });

  it('falls back to the legacy root when neither root holds any config', () => {
    const io = makeDisk({});
    const { repo, registry } = load(io);
    expect(repo.root).toBe(LEGACY);
    expect(registry.nfc.tags).toEqual({});
  });
});
