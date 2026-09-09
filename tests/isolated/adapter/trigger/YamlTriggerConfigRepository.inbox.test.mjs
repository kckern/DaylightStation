import { describe, it, expect } from 'vitest';
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';

/**
 * `unsorted.yml` is the inbox the curated files are curated OUT OF, not a peer
 * of them. Naming a book means pasting it into books.yml while the app's own
 * auto-discovery stub is still sitting in the inbox — so that workflow produces
 * a duplicate every single time, and treating it as ambiguity took the entire
 * tag registry down until a human hand-edited the inbox.
 */
function harness(nfcFiles = {}) {
  const disk = {
    'triggers/sources': { livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next' } },
    'triggers/responses': {},
    'triggers/endpoints': {},
    'triggers/nfc.observed': {},
  };
  for (const [file, blob] of Object.entries(nfcFiles)) {
    disk[`triggers/bindings/nfc/${file}`] = blob;
  }
  const loadFile = (p) => disk[p];
  const saveFile = (p, d) => { disk[p] = d; };
  // Directory mode: the single-file path must read as absent.
  const listDir = (p) => (p === 'triggers/bindings/nfc' ? Object.keys(nfcFiles).map((f) => `${f}.yml`) : []);
  const repo = new YamlTriggerConfigRepository({ saveFile, observedStore: null });
  const registry = repo.loadRegistry({ loadFile, listDir });
  return { repo, disk, registry };
}

describe('NFC bindings: the inbox is staging, not a peer', () => {
  it('lets the curated entry win when a uid is in BOTH the inbox and books.yml', () => {
    const { registry } = harness({
      books: { '04ea9e72cc2a81': { note: 'Lady and tramp', plex: 620713 } },
      unsorted: { '04ea9e72cc2a81': { note: 'Lady and tramp' } },
    });
    // The curated entry, with its plex id — not the note-only inbox stub.
    expect(registry.nfc.tags['04ea9e72cc2a81'].global.plex).toBe(620713);
  });

  it('does not throw on that collision — naming a book must not unregister every tag', () => {
    expect(() => harness({
      books: { aa: { plex: 1 }, bb: { plex: 2 } },
      cards: { cc: { learner: 'test-learner' } },
      unsorted: { aa: { note: 'dup' } },
    })).not.toThrow();
  });

  it('keeps every OTHER tag working when the inbox duplicates one of them', () => {
    const { registry } = harness({
      books: { aa: { plex: 1 }, bb: { plex: 2 } },
      cards: { cc: { learner: 'test-learner' } },
      unsorted: { aa: { note: 'dup' } },
    });
    expect(Object.keys(registry.nfc.tags).sort()).toEqual(['aa', 'bb', 'cc']);
  });

  it('sweeps the curated-out stub off disk, leaving genuinely unnamed tags alone', async () => {
    const { repo, disk } = harness({
      books: { aa: { plex: 1 } },
      unsorted: { aa: { note: 'dup' } , zz: { note: 'nobody has named me' } },
    });
    const { swept } = await repo.sweepInbox();
    expect(swept).toEqual(['aa']);
    expect(disk['triggers/bindings/nfc/unsorted']).toEqual({ zz: { note: 'nobody has named me' } });
  });

  it('sweeps nothing when there is nothing to sweep', async () => {
    const { repo } = harness({ books: { aa: { plex: 1 } }, unsorted: { zz: { note: 'unnamed' } } });
    expect((await repo.sweepInbox()).swept).toEqual([]);
  });

  it('still HARD ERRORS on a duplicate between two CURATED files', () => {
    // Nothing here says which file the author meant, so this one must stay loud.
    expect(() => harness({
      books: { aa: { plex: 1 } },
      cards: { aa: { learner: 'test-learner' } },
    })).toThrow(/appears in both/);
  });

  it('is order-independent — the inbox loses even when it is read first', () => {
    // `listDir` order follows object key order here, so this puts the inbox
    // first; the curated entry must still win.
    const { registry } = harness({
      unsorted: { aa: { note: 'stub' } },
      books: { aa: { note: 'Lady and tramp', plex: 620713 } },
    });
    expect(registry.nfc.tags.aa.global.plex).toBe(620713);
  });
});
