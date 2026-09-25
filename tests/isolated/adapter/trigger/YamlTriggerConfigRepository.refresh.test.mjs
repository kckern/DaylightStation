import { describe, it, expect } from 'vitest';
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';

/**
 * The registry is read at boot. A tag named afterwards used to need a container
 * restart; now an unknown tap re-reads the files once. That re-read happens on
 * the hot path of a child tapping a book, so it must never cost a tag that
 * already works — a failed or half-synced read changes nothing.
 */
function harness(nfcFiles = {}) {
  const disk = {
    'triggers/sources': { livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next' } },
    'triggers/responses': {},
    'triggers/endpoints': {},
  };
  const setFile = (file, blob) => { disk[`triggers/bindings/nfc/${file}`] = blob; };
  for (const [file, blob] of Object.entries(nfcFiles)) setFile(file, blob);
  const files = () => Object.keys(disk)
    .filter((k) => k.startsWith('triggers/bindings/nfc/'))
    .map((k) => `${k.slice('triggers/bindings/nfc/'.length)}.yml`);
  const hooks = { loadFile: (p) => disk[p] };
  const loadFile = (p) => hooks.loadFile(p);
  const saveFile = (p, d) => { disk[p] = d; };
  const listDir = (p) => (p === 'triggers/bindings/nfc' ? files() : []);
  const repo = new YamlTriggerConfigRepository({ saveFile, observedStore: null });
  const registry = repo.loadRegistry({ loadFile, listDir });
  return { repo, disk, registry, setFile, hooks };
}

describe('refreshNfcTags: a tag named after boot', () => {
  it('lands in the SAME registry object the dispatch service holds', async () => {
    const { repo, registry, setFile } = harness({ books: { aa: { plex: 1 } } });
    const tagsRef = registry.nfc.tags;
    setFile('books', { aa: { plex: 1 }, bb: { note: 'Goodnight moon', plex: 621333 } });

    const { added } = await repo.refreshNfcTags();

    expect(added).toEqual(['bb']);
    expect(registry.nfc.tags).toBe(tagsRef);
    expect(registry.nfc.tags.bb.global.plex).toBe(621333);
  });

  it('upgrades a note-only inbox stub to the curated entry and sweeps the stub', async () => {
    const { repo, registry, setFile, disk } = harness({ books: { aa: { plex: 1 } } });
    // The unknown-tag prompt names the book: a note-only stub, in memory and inbox.
    await repo.setNfcNote('bb', 'Goodnight moon', '2026-09-25 09:16:32');
    expect(registry.nfc.tags.bb.global.plex).toBeUndefined();

    // A person curates it into books.yml.
    setFile('books', { aa: { plex: 1 }, bb: { note: 'Goodnight moon', plex: 621333 } });
    const { added, updated } = await repo.refreshNfcTags();

    expect(added).toEqual([]);
    expect(updated).toBe(2);
    expect(registry.nfc.tags.bb.global.plex).toBe(621333);
    expect((await repo.sweepInbox()).swept).toEqual(['bb']);
    expect(disk['triggers/bindings/nfc/unsorted']).toEqual({});
  });

  it('routes a later note write for the refreshed tag back to its curated file', async () => {
    const { repo, setFile, disk } = harness({ books: { aa: { plex: 1 } } });
    setFile('books', { aa: { plex: 1 }, bb: { plex: 2 } });
    await repo.refreshNfcTags();

    await repo.setNfcNote('bb', 'renamed', '2026-09-25 10:00:00');

    expect(disk['triggers/bindings/nfc/books'].bb).toMatchObject({ note: 'renamed', plex: 2 });
    expect(disk['triggers/bindings/nfc/unsorted']).toBeUndefined();
  });
});

describe('refreshNfcTags: a bad read never costs a working tag', () => {
  it('keeps every tag when a file reads as missing mid-sync', async () => {
    const { repo, registry, hooks } = harness({ books: { aa: { plex: 1 } }, cards: { cc: { learner: 'test-learner' } } });
    const real = hooks.loadFile;
    hooks.loadFile = (p) => (p === 'triggers/bindings/nfc/books' ? undefined : real(p));

    await repo.refreshNfcTags();

    expect(Object.keys(registry.nfc.tags).sort()).toEqual(['aa', 'cc']);
  });

  it('rejects and changes nothing when the re-read throws', async () => {
    const { repo, registry, setFile, disk } = harness({ books: { aa: { plex: 1 } } });
    // Curated-vs-curated duplicate: a hard parse error.
    setFile('cards', { aa: { learner: 'test-learner' }, zz: { plex: 9 } });

    await expect(repo.refreshNfcTags()).rejects.toThrow(/appears in both/);

    expect(Object.keys(registry.nfc.tags)).toEqual(['aa']);
    // File bookkeeping is untouched too: a note on `aa` still goes to books.
    delete disk['triggers/bindings/nfc/cards'];
    await repo.setNfcNote('aa', 'still books', '2026-09-25 10:00:00');
    expect(disk['triggers/bindings/nfc/books'].aa).toMatchObject({ note: 'still books', plex: 1 });
  });
});
