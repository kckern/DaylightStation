import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SurroundStore } from './SurroundStore.mjs';

let root;
const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

function writeFixture() {
  mkdirSync(path.join(root, '_surrounds'), { recursive: true });
  mkdirSync(path.join(root, 'classical/beethoven'), { recursive: true });
  writeFileSync(path.join(root, '_surrounds/concert-hall.yml'),
    'id: concert-hall\nregions:\n  right: { width: 20%, module: composer-card }\n  bottom:\n    - { module: movement-map, height: 60 }\ncollapse: { footerFloor: 90 }\n');
  writeFileSync(path.join(root, 'classical/beethoven/_composer.yml'),
    'name: Ludwig van Beethoven\nborn: 1770\ndied: 1827\nbirthplace: Bonn\nportrait: beethoven/portrait.jpg\n');
  writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
    'surround: concert-hall\nmatch:\n  contentId: plex:663134\n  title: "Beethoven: 3. Sinfonie"\npiece:\n  title: Symphony No. 3\n  opus: Op. 55\nmovements:\n  - { n: 1, name: Allegro con brio, start: 0 }\ncomposer:\n  birthplace: Bonn (Electorate of Cologne)\n');
}

// Add a file to the fixture tree before constructing the store under test.
function write(relPath, body) {
  const full = path.join(root, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'surround-')); writeFixture(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('SurroundStore exact lookup', () => {
  it('returns a resolved payload for an exact contentId match', () => {
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    const r = store.lookup('plex:663134', 'anything');
    expect(r).not.toBeNull();
    expect(r.id).toBe('concert-hall');
    expect(r.definition.regions.right.module).toBe('composer-card');
    expect(r.piece.title).toBe('Symphony No. 3');
    expect(r.movements).toHaveLength(1);
    expect(r.assetBase).toBe('surround/classical');
  });

  it('merges _composer.yml under the piece composer block, piece winning per key', () => {
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.composer.name).toBe('Ludwig van Beethoven');
    expect(r.composer.born).toBe(1770);
    expect(r.composer.birthplace).toBe('Bonn (Electorate of Cologne)');
  });

  it('returns exactly null for a miss', () => {
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    expect(store.lookup('plex:999999', 'Nothing')).toBeNull();
  });
});

describe('SurroundStore totality', () => {
  it('never throws on a hostile rootDir and looks up as a miss', () => {
    const filePath = path.join(root, '_surrounds/concert-hall.yml');
    for (const rootDir of [undefined, null, '', '/definitely/not/here', filePath]) {
      const logger = makeLogger();
      let store;
      expect(() => { store = new SurroundStore({ rootDir, logger }); }).not.toThrow();
      expect(store.lookup('plex:663134', 'Eroica')).toBeNull();
      expect(logger.info).toHaveBeenCalledWith('surround.index.built',
        expect.objectContaining({ pieces: 0 }));
    }
  });

  it('constructs with a logger that has no info method', () => {
    let store;
    expect(() => { store = new SurroundStore({ rootDir: root, logger: {} }); }).not.toThrow();
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
  });

  it('emits surround.index.built with the documented payload', () => {
    const logger = makeLogger();
    new SurroundStore({ rootDir: root, logger });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [event, payload] = logger.info.mock.calls[0];
    expect(event).toBe('surround.index.built');
    expect(payload).toMatchObject({ pieces: 1, skipped: 0, composers: 1, definitions: 1 });
    expect(typeof payload.ms).toBe('number');
  });

  it('keeps indexing after a malformed sidecar', () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    expect(store.lookup('plex:663134', '')).not.toBeNull();
  });
});

describe('SurroundStore reserved names', () => {
  it('never indexes _-prefixed domains, composers, piece files, or _composer.yml', () => {
    const piece = (id) => `surround: concert-hall\nmatch:\n  contentId: ${id}\npiece:\n  title: Trap\n`;
    write('_surrounds/fake-composer/trap.yml', piece('plex:trap-domain'));
    write('classical/_draft/wip.yml', piece('plex:trap-composer'));
    write('classical/beethoven/_scratch.yml', piece('plex:trap-file'));
    write('classical/haydn/_composer.yml', piece('plex:trap-composer-file'));

    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    for (const id of ['plex:trap-domain', 'plex:trap-composer', 'plex:trap-file', 'plex:trap-composer-file']) {
      expect(store.lookup(id, '')).toBeNull();
    }
    expect(store.lookup('plex:663134', '')).not.toBeNull();
  });
});

describe('SurroundStore payload isolation', () => {
  it('does not let a caller mutate the index through a returned payload', () => {
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    const first = store.lookup('plex:663134', '');
    first.movements.push({ n: 99 });
    first.piece.title = 'mutated';
    expect(store.lookup('plex:663134', '').movements).toHaveLength(1);
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
  });

  it('does not leak a definition edit into another piece sharing that definition', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:663146\npiece:\n  title: Spring\n');
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    store.lookup('plex:663134', '').definition.regions.right.width = '99%';
    expect(store.lookup('plex:663146', '').definition.regions.right.width).toBe('20%');
  });
});

describe('SurroundStore field resolution', () => {
  it('deep-merges nested composer blocks instead of replacing them', () => {
    write('classical/haydn/_composer.yml',
      'name: Joseph Haydn\nlinks: { wiki: base-wiki, imslp: base-imslp }\n');
    write('classical/haydn/symphony-94.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:94\npiece:\n  title: Surprise\ncomposer:\n  links: { wiki: piece-wiki }\n');
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    const r = store.lookup('plex:94', '');
    expect(r.composer.links.wiki).toBe('piece-wiki');
    expect(r.composer.links.imslp).toBe('base-imslp');
    expect(r.composer.name).toBe('Joseph Haydn');
  });

  it('coerces a numeric match.contentId to a string key', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: 663146\npiece:\n  title: Spring\n');
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    expect(store.lookup('663146', '').piece.title).toBe('Spring');
  });

  it('coerces wrong-typed list and object fields to safe empties', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:663146\npiece: just a string\nmovements: not a list\ncues: 5\nfacts: { a: 1 }\ncomposer: nope\n');
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    const r = store.lookup('plex:663146', '');
    expect(r.movements).toEqual([]);
    expect(r.cues).toEqual([]);
    expect(r.facts).toEqual([]);
    expect(r.piece).toEqual({});
    expect(r.composer).toEqual({});
  });

  it('defaults optional blocks to empty when absent', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:663146\npiece:\n  title: Spring\n');
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    const r = store.lookup('plex:663146', '');
    expect(r).toMatchObject({ movements: [], cues: [], facts: [], composer: {}, assetBase: 'surround/classical' });
  });
});

describe('SurroundStore logging identity', () => {
  // Mirrors createLogger's child(): context spreads childContext over baseContext,
  // so `app` is genuinely overridden rather than ignored.
  const makeContextLogger = (context = { source: 'backend', app: 'api', module: 'content' }) => {
    const rec = { context, calls: [], children: [] };
    rec.child = vi.fn((childContext) => {
      const kid = makeContextLogger({ ...context, ...childContext });
      rec.children.push(kid);
      return kid;
    });
    for (const level of ['debug', 'info', 'warn', 'error']) {
      rec[level] = vi.fn((event, data) => rec.calls.push({ level, event, data }));
    }
    return rec;
  };

  it('claims its own context.app so surround events are filterable on their own', () => {
    const parent = makeContextLogger();
    const store = new SurroundStore({ rootDir: root, logger: parent });
    store.lookup('plex:missing', '');

    expect(parent.child).toHaveBeenCalledWith({ app: 'surround', module: 'surround-store' });
    expect(parent.calls).toEqual([]);

    const kid = parent.children[0];
    expect(kid.context).toMatchObject({ source: 'backend', app: 'surround', module: 'surround-store' });
    expect(kid.calls.map((c) => c.event)).toEqual(['surround.index.built', 'surround.lookup.miss']);
  });

  it('falls back to a logger without child(), such as bare console', () => {
    const bare = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let store;
    expect(() => { store = new SurroundStore({ rootDir: root, logger: bare }); }).not.toThrow();
    expect(bare.info).toHaveBeenCalledWith('surround.index.built', expect.any(Object));
    expect(store.lookup('plex:663134', '')).not.toBeNull();
  });

  it('logs a lookup miss at debug with the contentId that was asked for', () => {
    const logger = makeLogger();
    const store = new SurroundStore({ rootDir: root, logger });
    expect(store.lookup('plex:999999', 'Nothing')).toBeNull();
    expect(logger.debug).toHaveBeenCalledWith('surround.lookup.miss', { contentId: 'plex:999999' });
  });

  it('does not log a miss on a hit', () => {
    const logger = makeLogger();
    new SurroundStore({ rootDir: root, logger }).lookup('plex:663134', '');
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('counts rejected piece files as skipped in the index line', () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    write('classical/beethoven/no-definition.yml',
      'surround: does-not-exist\nmatch:\n  contentId: plex:1\npiece:\n  title: Orphan\n');
    const logger = makeLogger();
    new SurroundStore({ rootDir: root, logger });
    expect(logger.info).toHaveBeenCalledWith('surround.index.built',
      expect.objectContaining({ pieces: 1, skipped: 2 }));
  });
});
