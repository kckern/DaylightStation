import { describe, it, expect } from 'vitest';
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';

// Phase E deleted LEGACY_TRIGGER_ROOT along with household/config/. This file
// was the two-root resolution suite; its cases are INVERTED rather than deleted
// — they now prove the retired root is IGNORED, which is the assertion that
// would catch the fallback being reintroduced.
const RETIRED = 'config/triggers';
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
  // Retargeted to the grouped root (was the same scenario on a legacy tree).
  // The regression it guards is unchanged and still reachable: a write that
  // flushes only ONE group file must not make the sibling group disappear on
  // the next load. That is a within-root hazard, not a cross-root one.
  it('does not lose sibling group files when a tag is edited', async () => {
    const io = makeDisk({
      [`${GROUPED}/sources`]: SOURCES,
      [`${GROUPED}/bindings/nfc/books`]: { '838e6806': { plex: 620707 } },
      [`${GROUPED}/bindings/nfc/cards`]: { '04669c0fcb2a81': { note: 'personal card' } },
      // Machine-written runtime state living beside the config. It must not
      // disturb the bindings resolution.
      [`${GROUPED}/nfc.observed`]: {},
    });

    const first = load(io);
    expect(first.repo.root).toBe(GROUPED);

    await first.repo.setNfcNote('838e6806', 'Star Wars', '2026-08-21 10:00:00');
    expect(io.disk[`${GROUPED}/bindings/nfc/books`]['838e6806'].note).toBe('Star Wars');

    // Reload from the very same disk: BOTH groups must still resolve.
    const second = load(io);
    expect(second.repo.root).toBe(GROUPED);
    expect(Object.keys(second.registry.nfc.tags).sort()).toEqual(['04669c0fcb2a81', '838e6806']);
    expect(second.registry.nfc.tags['838e6806'].global.note).toBe('Star Wars');
    expect(second.registry.nfc.tags['04669c0fcb2a81'].global.note).toBe('personal card');
  });

  it('uses the grouped root for reads AND writes', async () => {
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
    expect(Object.keys(io.disk).filter((k) => k.startsWith(`${RETIRED}/`))).toEqual([]);
  });

  // INVERTED (was 'nfc.observed.yml alone never selects the grouped root' /
  // 'does not lose sibling group files ... on a legacy tree'): config sitting
  // under the retired root is now simply not seen.
  it('IGNORES trigger config under the retired config/triggers/ root', () => {
    const io = makeDisk({
      [`${RETIRED}/sources`]: SOURCES,
      [`${RETIRED}/bindings/nfc`]: { '838e6806': { plex: 620707 } },
    });
    const { repo, registry } = load(io);
    expect(repo.root).toBe(GROUPED);
    expect(registry.nfc.tags).toEqual({});
  });

  // INVERTED (was 'refuses to boot when trigger config exists under BOTH roots'
  // / 'names both roots in the ambiguity error'). With one root there is no
  // ambiguity to detect: the retired root is inert, so a stale copy left behind
  // must NOT block boot — and must not be merged in either.
  it('boots normally when a stale copy still sits under the retired root', () => {
    const io = makeDisk({
      [`${RETIRED}/sources`]: SOURCES,
      [`${RETIRED}/bindings/nfc/cards`]: { '04669c0fcb2a81': { note: 'stale copy' } },
      [`${GROUPED}/sources`]: SOURCES,
      [`${GROUPED}/bindings/nfc/books`]: { '838e6806': { plex: 620707 } },
    });
    const { repo, registry } = load(io);
    expect(repo.root).toBe(GROUPED);
    expect(Object.keys(registry.nfc.tags)).toEqual(['838e6806']);
    expect(registry.nfc.tags['04669c0fcb2a81']).toBeUndefined();
  });

  // INVERTED (was 'falls back to the legacy root when neither root holds any
  // config'). An empty tree now resolves to the grouped root, so a first write
  // lands there instead of recreating config/triggers/.
  it('resolves to the grouped root on an empty tree, never the retired one', async () => {
    const io = makeDisk({});
    const { repo, registry } = load(io);
    expect(repo.root).toBe(GROUPED);
    expect(registry.nfc.tags).toEqual({});

    await repo.setNfcNote('838e6806', 'first write', '2026-08-21 10:00:00');
    expect(Object.keys(io.disk).every((k) => k.startsWith(`${GROUPED}/`))).toBe(true);
    expect(Object.keys(io.disk).filter((k) => k.startsWith(`${RETIRED}/`))).toEqual([]);
  });
});
