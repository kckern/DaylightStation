import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlSurroundStore } from './YamlSurroundStore.mjs';

let root;      // performance-sidecar tree (old rootDir)
let library;   // knowledge-corpus tree (new libraryDir)
const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

function writeFixture() {
  mkdirSync(path.join(root, '_surrounds'), { recursive: true });
  mkdirSync(path.join(root, 'classical/beethoven'), { recursive: true });
  mkdirSync(path.join(library, 'classical/beethoven'), { recursive: true });
  writeFileSync(path.join(root, '_surrounds/concert-hall.yml'),
    'id: concert-hall\nregions:\n  right: { width: 20%, module: composer-card }\n  bottom:\n    - { module: movement-map, height: 60 }\ncollapse: { footerFloor: 90 }\n');
  writeFileSync(path.join(library, 'classical/beethoven/_composer.yml'),
    'name: Ludwig van Beethoven\nborn: 1770\ndied: 1827\nbirthplace: Bonn\nportrait: beethoven/portrait.jpg\n');
  writeFileSync(path.join(library, 'classical/beethoven/symphony-3-eroica.yml'),
    'title: Symphony No. 3\nopus: Op. 55\nmovements:\n  - { n: 1, name: Allegro con brio }\n');
  writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
    'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch:\n  contentId: plex:663134\n  title: "Beethoven: 3. Sinfonie"\nstarts: [0]\ncomposer:\n  birthplace: Bonn (Electorate of Cologne)\n');
}

// Add a file to the performance-sidecar fixture tree.
function write(relPath, body) {
  const full = path.join(root, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

// Add a file to the knowledge-corpus fixture tree.
function writeLib(relPath, body) {
  const full = path.join(library, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'surround-'));
  library = mkdtempSync(path.join(tmpdir(), 'library-'));
  writeFixture();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(library, { recursive: true, force: true });
});

describe('YamlSurroundStore exact lookup', () => {
  it('returns a resolved payload for an exact contentId match', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', 'anything');
    expect(r).not.toBeNull();
    expect(r.id).toBe('concert-hall');
    expect(r.definition.regions.right.module).toBe('composer-card');
    expect(r.piece.title).toBe('Symphony No. 3');
    expect(r.movements).toHaveLength(1);
    expect(r.assetBase).toBe('surround/classical');
  });

  it('merges _composer.yml under the piece composer block, piece winning per key', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.composer.name).toBe('Ludwig van Beethoven');
    expect(r.composer.born).toBe(1770);
    expect(r.composer.birthplace).toBe('Bonn (Electorate of Cologne)');
  });

  it('returns exactly null for a miss', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:999999', 'Nothing')).toBeNull();
  });
});

describe('YamlSurroundStore totality', () => {
  it('never throws on a hostile rootDir and looks up as a miss', () => {
    const filePath = path.join(root, '_surrounds/concert-hall.yml');
    for (const rootDir of [undefined, null, '', '/definitely/not/here', filePath]) {
      const logger = makeLogger();
      let store;
      expect(() => { store = new YamlSurroundStore({ rootDir, libraryDir: library, logger }); }).not.toThrow();
      expect(store.lookup('plex:663134', 'Eroica')).toBeNull();
      expect(logger.info).toHaveBeenCalledWith('surround.index.built',
        expect.objectContaining({ pieces: 0 }));
    }
  });

  it('constructs with a logger that has no info method', () => {
    let store;
    expect(() => { store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: {} }); }).not.toThrow();
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
  });

  it('emits surround.index.built with the documented payload', () => {
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [event, payload] = logger.info.mock.calls[0];
    expect(event).toBe('surround.index.built');
    expect(payload).toMatchObject({ pieces: 1, skipped: 0, composers: 1, definitions: 1 });
    expect(typeof payload.ms).toBe('number');
  });

  it('keeps indexing after a malformed sidecar', () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '')).not.toBeNull();
  });
});

describe('YamlSurroundStore reserved names', () => {
  it('never indexes _-prefixed domains, composers, piece files, or _composer.yml', () => {
    const piece = (id) => `surround: concert-hall\nmatch:\n  contentId: ${id}\npiece:\n  title: Trap\n`;
    write('_surrounds/fake-composer/trap.yml', piece('plex:trap-domain'));
    write('classical/_draft/wip.yml', piece('plex:trap-composer'));
    write('classical/beethoven/_scratch.yml', piece('plex:trap-file'));
    write('classical/haydn/_composer.yml', piece('plex:trap-composer-file'));

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    for (const id of ['plex:trap-domain', 'plex:trap-composer', 'plex:trap-file', 'plex:trap-composer-file']) {
      expect(store.lookup(id, '')).toBeNull();
    }
    expect(store.lookup('plex:663134', '')).not.toBeNull();
  });
});

describe('YamlSurroundStore payload isolation', () => {
  it('does not let a caller mutate the index through a returned payload', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const first = store.lookup('plex:663134', '');
    first.movements.push({ n: 99 });
    first.piece.title = 'mutated';
    expect(store.lookup('plex:663134', '').movements).toHaveLength(1);
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
  });

  it('does not leak a definition edit into another piece sharing that definition', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:663146\npiece:\n  title: Spring\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    store.lookup('plex:663134', '').definition.regions.right.width = '99%';
    expect(store.lookup('plex:663146', '').definition.regions.right.width).toBe('20%');
  });
});

describe('YamlSurroundStore field resolution', () => {
  it('deep-merges nested composer blocks instead of replacing them', () => {
    write('classical/haydn/_composer.yml',
      'name: Joseph Haydn\nlinks: { wiki: base-wiki, imslp: base-imslp }\n');
    write('classical/haydn/symphony-94.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:94\npiece:\n  title: Surprise\ncomposer:\n  links: { wiki: piece-wiki }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:94', '');
    expect(r.composer.links.wiki).toBe('piece-wiki');
    expect(r.composer.links.imslp).toBe('base-imslp');
    expect(r.composer.name).toBe('Joseph Haydn');
  });

  it('coerces a numeric match.contentId to a string key', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: 663146\npiece:\n  title: Spring\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('663146', '').piece.title).toBe('Spring');
  });

  it('coerces wrong-typed list and object fields to safe empties', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:663146\npiece: just a string\nmovements: not a list\ncues: 5\nfacts: { a: 1 }\ncomposer: nope\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
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
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663146', '');
    expect(r).toMatchObject({ movements: [], cues: [], facts: [], composer: {}, assetBase: 'surround/classical' });
  });
});

describe('YamlSurroundStore logging identity', () => {
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
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: parent });
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
    expect(() => { store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: bare }); }).not.toThrow();
    expect(bare.info).toHaveBeenCalledWith('surround.index.built', expect.any(Object));
    expect(store.lookup('plex:663134', '')).not.toBeNull();
  });

  it('logs a lookup miss at debug with the contentId that was asked for', () => {
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:999999', 'Nothing')).toBeNull();
    expect(logger.debug).toHaveBeenCalledWith('surround.lookup.miss', { contentId: 'plex:999999' });
  });

  it('does not log a miss on a hit', () => {
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger }).lookup('plex:663134', '');
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('counts rejected piece files as skipped in the index line', () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    write('classical/beethoven/no-definition.yml',
      'surround: does-not-exist\nmatch:\n  contentId: plex:1\npiece:\n  title: Orphan\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.info).toHaveBeenCalledWith('surround.index.built',
      expect.objectContaining({ pieces: 1, skipped: 2 }));
  });
});

describe('YamlSurroundStore title rebind', () => {
  it('matches a real Plex title with an orchestra suffix when the contentId is stale', () => {
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:999999', 'Beethoven: 3. Sinfonie (»Eroica«) ∙ hr-Sinfonieorchester ∙ Andrés Orozco-Estrada');
    expect(r).not.toBeNull();
    expect(r.piece.title).toBe('Symphony No. 3');
    const warned = logger.warn.mock.calls.find(c => c[0] === 'surround.match.rebound');
    expect(warned).toBeDefined();
    expect(warned[1].staleContentId).toBe('plex:999999');
  });

  it('does not rebind an unrelated title', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:999999', 'Vivaldi: Spring')).toBeNull();
  });

  it('names the sidecar file and the live contentId in the rebound warning', () => {
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger })
      .lookup('plex:999999', 'Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester');
    const [, data] = logger.warn.mock.calls.find((c) => c[0] === 'surround.match.rebound');
    expect(data.file).toContain('symphony-3-eroica.yml');
    expect(data.matchedTitle).toBe('Beethoven: 3. Sinfonie');
    expect(data.contentId).toBe('plex:663134');
  });

  it('returns a clone on the rebind path too, so the index cannot be mutated', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const live = 'Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester';
    store.lookup('plex:999999', live).movements.push({ n: 99 });
    store.lookup('plex:999999', live).piece.title = 'mutated';
    expect(store.lookup('plex:663134', '').movements).toHaveLength(1);
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
  });

  it('survives a non-string or absent title without throwing', () => {
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    for (const title of [null, undefined, 123, '', {}, [], NaN]) {
      expect(() => store.lookup('plex:999999', title)).not.toThrow();
      expect(store.lookup('plex:999999', title)).toBeNull();
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('leaves a sidecar without match.title indexed but unrebindable', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:663146\npiece:\n  title: Spring\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    // The build warns `missing-match-title` about this very file; what must stay
    // silent is the lookup, which treats the piece as merely unrebindable.
    const afterBuild = logger.warn.mock.calls.length;
    expect(store.lookup('plex:663146', '').piece.title).toBe('Spring');
    expect(store.lookup('plex:999999', 'Vivaldi: Spring ∙ Concerto No. 1')).toBeNull();
    expect(logger.warn.mock.calls.length).toBe(afterBuild);
  });

  it('rebinds when the authored title is the longer side', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:663146\n  title: "Vivaldi: The Four Seasons ∙ Spring ∙ Concerto in E major"\npiece:\n  title: Spring\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:000000', 'Vivaldi: The Four Seasons').piece.title).toBe('Spring');
  });

  it('normalizes away case, guillemets, interpuncts, and stray whitespace', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:999999', '  BEETHOVEN:  »3.«  ∙   sinfonie  ');
    expect(r).not.toBeNull();
    expect(r.piece.title).toBe('Symphony No. 3');
  });

  it('does not warn about a rebind when the contentId matched exactly', () => {
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:663134', 'Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester').piece.title)
      .toBe('Symphony No. 3');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });
});

describe('YamlSurroundStore rebind ambiguity', () => {
  // Two sidecars that both match one live title. Whichever the walk reaches first
  // is an accident of the filesystem, so the store must refuse rather than pick.
  const twoSeasons = () => {
    write('classical/vivaldi/four-seasons.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:1\n  title: "Vivaldi: The Four Seasons"\npiece:\n  title: The Four Seasons\n');
    write('classical/vivaldi/seasons-alt.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:2\n  title: The Four Seasons\npiece:\n  title: Alt\n');
  };

  it('refuses to rebind when two sidecars match the same live title', () => {
    twoSeasons();
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:999999', 'Vivaldi: The Four Seasons ∙ Il Giardino Armonico')).toBeNull();
    expect(logger.warn).not.toHaveBeenCalledWith('surround.match.rebound', expect.anything());
    const [, data] = logger.warn.mock.calls.find((c) => c[0] === 'surround.match.ambiguous');
    expect(data.staleContentId).toBe('plex:999999');
    expect(data.liveTitle).toBe('Vivaldi: The Four Seasons ∙ Il Giardino Armonico');
    expect(data.candidates.map((c) => c.file).sort())
      .toEqual(['classical/vivaldi/four-seasons.yml', 'classical/vivaldi/seasons-alt.yml']);
    expect(data.candidates.map((c) => c.title).sort())
      .toEqual(['The Four Seasons', 'Vivaldi: The Four Seasons']);
  });

  it('refuses a short authored title that over-matches a real Four Seasons title', () => {
    // The PoC corpus: one sidecar authored sloppily as `Spring`, which is a
    // substring of every live title carrying that word.
    write('classical/vivaldi/spring-short.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:3\n  title: Spring\npiece:\n  title: Spring (short)\n');
    write('classical/vivaldi/spring-full.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:4\n  title: "Violin Concerto No. 1 in E Major, RV 269 Spring"\npiece:\n  title: Spring (full)\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:999999', 'Violin Concerto No. 1 in E Major, RV 269 Spring')).toBeNull();
    const warned = logger.warn.mock.calls.find((c) => c[0] === 'surround.match.ambiguous');
    expect(warned).toBeDefined();
    expect(warned[1].candidates).toHaveLength(2);
  });

  it('still rebinds, and does not cry ambiguity, when exactly one sidecar matches', () => {
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:999999', 'Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester').piece.title)
      .toBe('Symphony No. 3');
    expect(logger.warn.mock.calls.map((c) => c[0])).toEqual(['surround.match.rebound']);
  });

  it('leaves the exact-contentId fast path untouched by an ambiguous title', () => {
    twoSeasons();
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    // The build already pre-warned `surround.titles.ambiguous` about this pair;
    // the assertion is that the fast path itself adds nothing.
    const afterBuild = logger.warn.mock.calls.length;
    const r = store.lookup('plex:1', 'Vivaldi: The Four Seasons ∙ Il Giardino Armonico');
    expect(r.piece.title).toBe('The Four Seasons');
    expect(logger.warn.mock.calls.length).toBe(afterBuild);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs ambiguity instead of a plain miss, so the refusal is not mistaken for no sidecar', () => {
    twoSeasons();
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger }).lookup('plex:999999', 'The Four Seasons');
    expect(logger.debug).not.toHaveBeenCalled();
  });
});

describe('YamlSurroundStore sidecar validation', () => {
  // Every one of these files is dropped or coerced today with no signal at all.
  // The assertions are on the warning, because the drop itself is invisible.
  const invalidWarns = (logger) =>
    logger.warn.mock.calls.filter((c) => c[0] === 'surround.sidecar.invalid').map((c) => c[1]);

  it('warns with the offending file and a reason when the YAML will not parse', () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(invalidWarns(logger)).toEqual([
      { file: 'classical/beethoven/broken.yml', reason: 'yaml-unparseable', reasons: ['yaml-unparseable'] }
    ]);
  });

  it('still indexes the siblings of a malformed sidecar', () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
    expect(invalidWarns(logger)).toHaveLength(1);
  });

  it('warns when a sidecar parses to something that is not a mapping', () => {
    write('classical/beethoven/scalar.yml', 'just a bare string\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(invalidWarns(logger)).toContainEqual(
      expect.objectContaining({ file: 'classical/beethoven/scalar.yml', reason: 'not-a-mapping' }));
  });

  it.each([
    ['missing-surround', 'nosurround.yml', 'match:\n  contentId: plex:1\n  title: T\npiece: { title: X }\n'],
    ['missing-match', 'nomatch.yml', 'surround: concert-hall\npiece: { title: X }\n'],
    ['match-not-a-mapping', 'strmatch.yml', 'surround: concert-hall\nmatch: plex:1\npiece: { title: X }\n'],
    ['missing-match-contentId', 'noid.yml', 'surround: concert-hall\nmatch:\n  title: T\npiece: { title: X }\n']
  ])('warns %s and drops the piece', (reason, file, body) => {
    write(`classical/beethoven/${file}`, body);
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(invalidWarns(logger)).toContainEqual(
      expect.objectContaining({ file: `classical/beethoven/${file}`, reason }));
    // Empty live title, so the rebind lane cannot answer for the dropped piece.
    expect(store.lookup('plex:1', '')).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('surround.index.built',
      expect.objectContaining({ pieces: 1, skipped: 1 }));
  });

  it('warns about a missing match.title but still indexes the piece', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:663146\npiece:\n  title: Spring\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:663146', '').piece.title).toBe('Spring');
    expect(invalidWarns(logger)).toContainEqual(
      expect.objectContaining({ file: 'classical/vivaldi/spring.yml', reason: 'missing-match-title' }));
    expect(logger.info).toHaveBeenCalledWith('surround.index.built',
      expect.objectContaining({ pieces: 2, skipped: 0 }));
  });

  it.each([
    ['missing-piece', 'surround: concert-hall\nmatch: { contentId: plex:9, title: T }\n'],
    ['piece-not-a-mapping', 'surround: concert-hall\nmatch: { contentId: plex:9, title: T }\npiece: a string\n'],
    ['movements-not-a-list', 'surround: concert-hall\nmatch: { contentId: plex:9, title: T }\npiece: {}\nmovements: nope\n'],
    ['cues-not-a-list', 'surround: concert-hall\nmatch: { contentId: plex:9, title: T }\npiece: {}\ncues: 5\n'],
    ['facts-not-a-list', 'surround: concert-hall\nmatch: { contentId: plex:9, title: T }\npiece: {}\nfacts: { a: 1 }\n'],
    ['composer-not-a-mapping', 'surround: concert-hall\nmatch: { contentId: plex:9, title: T }\npiece: {}\ncomposer: nope\n']
  ])('warns %s without dropping the piece, since the coercion is silent data loss', (reason, body) => {
    write('classical/vivaldi/odd.yml', body);
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:9', '')).not.toBeNull();
    expect(invalidWarns(logger)).toContainEqual(
      expect.objectContaining({ file: 'classical/vivaldi/odd.yml', reason }));
  });

  it('does not warn about optional blocks that are simply absent', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch: { contentId: plex:663146, title: Spring }\npiece: { title: Spring }\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(invalidWarns(logger)).toEqual([]);
  });

  it('reports every problem in one warning, leading with the first', () => {
    write('classical/vivaldi/messy.yml',
      'surround: concert-hall\nmatch:\n  contentId: plex:9\nmovements: nope\ncues: 5\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const [warned, ...rest] = invalidWarns(logger);
    expect(rest).toEqual([]);
    expect(warned.file).toBe('classical/vivaldi/messy.yml');
    expect(warned.reason).toBe('missing-match-title');
    expect(warned.reasons).toEqual(
      ['missing-match-title', 'missing-piece', 'movements-not-a-list', 'cues-not-a-list']);
  });

  it('reports only the blocking problem when the file is rejected outright', () => {
    write('classical/vivaldi/messy.yml', 'match: { title: T }\nmovements: nope\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(invalidWarns(logger)).toEqual([{
      file: 'classical/vivaldi/messy.yml',
      reason: 'missing-surround',
      reasons: ['missing-surround', 'missing-match-contentId']
    }]);
  });

  it('warns once per build, not once per lookup', () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const afterBuild = logger.warn.mock.calls.length;
    for (let i = 0; i < 5; i += 1) store.lookup('plex:663134', 'Beethoven: 3. Sinfonie');
    expect(logger.warn.mock.calls.length).toBe(afterBuild);
  });
});

describe('YamlSurroundStore missing definition', () => {
  const orphan = () => write('classical/vivaldi/spring.yml',
    'surround: does-not-exist\nmatch: { contentId: plex:663146, title: Spring }\npiece: { title: Spring }\n');

  it('names the definition id and the file that asked for it', () => {
    orphan();
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).toHaveBeenCalledWith('surround.definition.missing',
      { id: 'does-not-exist', file: 'classical/vivaldi/spring.yml' });
  });

  it('excludes the piece entirely rather than shipping a half payload', () => {
    orphan();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663146', '')).toBeNull();
    expect(store.lookup('plex:000', 'Spring')).toBeNull();
  });

  it('does not fire for a piece whose definition exists', () => {
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).not.toHaveBeenCalledWith('surround.definition.missing', expect.anything());
  });
});

describe('YamlSurroundStore duplicate contentIds', () => {
  // Walk order is a filesystem accident, so a silent last-write-wins is
  // non-deterministic across machines. Resolution stays as it was; the
  // collision just stops being invisible.
  const duplicates = () => {
    write('classical/vivaldi/a-first.yml',
      'surround: concert-hall\nmatch: { contentId: plex:dup, title: First }\npiece: { title: First }\n');
    write('classical/vivaldi/b-second.yml',
      'surround: concert-hall\nmatch: { contentId: plex:dup, title: Second }\npiece: { title: Second }\n');
  };

  it('names both the kept and the dropped file', () => {
    duplicates();
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).toHaveBeenCalledWith('surround.sidecar.duplicate', {
      contentId: 'plex:dup',
      keptFile: 'classical/vivaldi/b-second.yml',
      droppedFile: 'classical/vivaldi/a-first.yml'
    });
  });

  it('keeps last-wins resolution unchanged', () => {
    duplicates();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:dup', '').piece.title).toBe('Second');
  });

  it('does not fire when every contentId is unique', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch: { contentId: plex:663146, title: Spring }\npiece: { title: Spring }\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).not.toHaveBeenCalledWith('surround.sidecar.duplicate', expect.anything());
  });
});

describe('YamlSurroundStore index-time title ambiguity', () => {
  // A pre-warning. Once #byTitle is built the collision is knowable, so nobody
  // should have to play the video to discover the rebind lane will refuse.
  const ambiguousWarns = (logger) =>
    logger.warn.mock.calls.filter((c) => c[0] === 'surround.titles.ambiguous').map((c) => c[1]);

  const twoSeasons = () => {
    write('classical/vivaldi/four-seasons.yml',
      'surround: concert-hall\nmatch: { contentId: plex:1, title: "Vivaldi: The Four Seasons" }\npiece: { title: The Four Seasons }\n');
    write('classical/vivaldi/seasons-alt.yml',
      'surround: concert-hall\nmatch: { contentId: plex:2, title: The Four Seasons }\npiece: { title: Alt }\n');
  };

  it('warns once for the colliding group, naming every file and title', () => {
    twoSeasons();
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const warns = ambiguousWarns(logger);
    expect(warns).toHaveLength(1);
    expect(warns[0].candidates.map((c) => c.file).sort())
      .toEqual(['classical/vivaldi/four-seasons.yml', 'classical/vivaldi/seasons-alt.yml']);
    expect(warns[0].candidates.map((c) => c.title).sort())
      .toEqual(['The Four Seasons', 'Vivaldi: The Four Seasons']);
  });

  it('groups a three-way collision into a single warning', () => {
    twoSeasons();
    write('classical/vivaldi/seasons-third.yml',
      'surround: concert-hall\nmatch: { contentId: plex:3, title: "Vivaldi: The Four Seasons ∙ complete" }\npiece: { title: Third }\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const warns = ambiguousWarns(logger);
    expect(warns).toHaveLength(1);
    expect(warns[0].candidates).toHaveLength(3);
  });

  it('warns separately for two independent colliding groups', () => {
    twoSeasons();
    write('classical/beethoven/eroica-alt.yml',
      'surround: concert-hall\nmatch: { contentId: plex:4, title: "Beethoven: 3. Sinfonie ∙ alternate cut" }\npiece: { title: Alt Eroica }\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(ambiguousWarns(logger)).toHaveLength(2);
  });

  it('stays silent for a corpus of unrelated titles', () => {
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch: { contentId: plex:663146, title: "Vivaldi: Spring" }\npiece: { title: Spring }\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(ambiguousWarns(logger)).toEqual([]);
  });

  it('changes no lookup behavior: the unambiguous piece still resolves both ways', () => {
    twoSeasons();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
    expect(store.lookup('plex:999999', 'Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester').piece.title)
      .toBe('Symphony No. 3');
    expect(store.lookup('plex:1', '').piece.title).toBe('The Four Seasons');
  });

  it('fires at build time, not on the lookup that trips the rebind lane', () => {
    twoSeasons();
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(ambiguousWarns(logger)).toHaveLength(1);
    store.lookup('plex:999999', 'Vivaldi: The Four Seasons ∙ Il Giardino Armonico');
    expect(ambiguousWarns(logger)).toHaveLength(1);
    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.match.ambiguous')).toHaveLength(1);
  });
});

describe('YamlSurroundStore warning totality', () => {
  // Every new warning runs through the same optional-call guard as the old ones,
  // so a logger that predates warn() cannot take the index build down with it.
  const brokenCorpus = () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    write('classical/vivaldi/orphan.yml',
      'surround: does-not-exist\nmatch: { contentId: plex:5, title: Orphan }\npiece: {}\n');
    write('classical/vivaldi/a-dup.yml',
      'surround: concert-hall\nmatch: { contentId: plex:dup, title: "Vivaldi: The Four Seasons" }\npiece: {}\n');
    write('classical/vivaldi/b-dup.yml',
      'surround: concert-hall\nmatch: { contentId: plex:dup, title: The Four Seasons }\npiece: {}\n');
  };

  it.each([
    ['no warn method', { info: () => {}, debug: () => {}, error: () => {} }],
    ['no methods at all', {}],
    ['absent', undefined],
    ['null', null]
  ])('builds and looks up with a logger that has %s', (_label, logger) => {
    brokenCorpus();
    let store;
    expect(() => { store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger }); }).not.toThrow();
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
    expect(store.lookup('plex:dup', '')).not.toBeNull();
    expect(store.lookup('plex:5', '')).toBeNull();
  });

  it('emits every warning family for one broken corpus', () => {
    brokenCorpus();
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(new Set(logger.warn.mock.calls.map((c) => c[0]))).toEqual(new Set([
      'surround.sidecar.invalid',
      'surround.definition.missing',
      'surround.sidecar.duplicate',
      'surround.titles.ambiguous'
    ]));
  });
});

describe('YamlSurroundStore freshness', () => {
  // Authoring a surround is an edit-refresh loop; the alternative to this is a
  // backend restart per timing tweak. Fake timers drive Date.now(), while file
  // mtimes keep coming from the real clock — which is exactly the relation the
  // guard has to survive in production too.
  afterEach(() => { vi.useRealTimers(); });

  // Fake timers freeze Date.now() while the filesystem clock keeps running, so an
  // edit made "three virtual seconds later" has to be stamped there as well.
  // Without it the write can land in the same real millisecond as the build and
  // read as older than the index it is meant to invalidate — the same
  // mtime-granularity race that the store's whole-millisecond floor exists for.
  const touchAhead = (rel) => {
    const when = new Date(Date.now() + 3000);
    utimesSync(path.join(root, rel), when, when);
  };

  it('picks up an edited sidecar after the guard window without a restart', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');

    writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
      'surround: concert-hall\nmatch: { contentId: plex:663134 }\npiece: { title: Edited Title }\n');
    touchAhead('classical/beethoven/symphony-3-eroica.yml');
    vi.advanceTimersByTime(3000);   // past the 2s guard

    expect(store.lookup('plex:663134', '').piece.title).toBe('Edited Title');
    vi.useRealTimers();
  });

  // The most important test here. Warning state is build-local, so every rebuild
  // re-emits the whole set: a store that rebuilt on window expiry alone would let
  // one sidecar nobody ever fixes warn every two seconds forever.
  it('does not rebuild, or re-warn, while the tree is unchanged', () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    vi.useFakeTimers();
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const warnsAfterBuild = logger.warn.mock.calls.length;
    expect(warnsAfterBuild).toBeGreaterThan(0);

    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(3000);
      expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
    }

    expect(logger.info.mock.calls.filter((c) => c[0] === 'surround.index.built')).toHaveLength(1);
    expect(logger.warn.mock.calls).toHaveLength(warnsAfterBuild);
  });

  it('holds an edit until the window expires, rather than stat-ing every lookup', () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
      'surround: concert-hall\nmatch: { contentId: plex:663134, title: "Beethoven: 3. Sinfonie" }\npiece: { title: Edited Title }\n');
    touchAhead('classical/beethoven/symphony-3-eroica.yml');

    vi.advanceTimersByTime(1000);
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
    expect(logger.info.mock.calls).toHaveLength(1);

    vi.advanceTimersByTime(1500);
    expect(store.lookup('plex:663134', '').piece.title).toBe('Edited Title');
    expect(logger.info.mock.calls).toHaveLength(2);
  });

  it('picks up a sidecar file that did not exist when the index was built', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663146', '')).toBeNull();

    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch: { contentId: plex:663146, title: "Vivaldi: Spring" }\npiece: { title: Spring }\n');
    touchAhead('classical/vivaldi/spring.yml');
    vi.advanceTimersByTime(3000);

    expect(store.lookup('plex:663146', '').piece.title).toBe('Spring');
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');
  });

  it('stops resolving a sidecar that was deleted from the tree', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '')).not.toBeNull();

    rmSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'));
    // A deletion leaves no file to stat; the parent directory's mtime is the record.
    touchAhead('classical/beethoven');
    vi.advanceTimersByTime(3000);

    expect(store.lookup('plex:663134', '')).toBeNull();
    expect(store.lookup('plex:000', 'Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester')).toBeNull();
  });

  it('re-warns about a file that is still broken after a rebuild', () => {
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    vi.useFakeTimers();
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const invalid = () => logger.warn.mock.calls.filter((c) => c[0] === 'surround.sidecar.invalid');
    const before = invalid().length;

    // A different file changes; the broken one is untouched and still broken.
    write('classical/vivaldi/spring.yml',
      'surround: concert-hall\nmatch: { contentId: plex:663146, title: "Vivaldi: Spring" }\npiece: { title: Spring }\n');
    touchAhead('classical/vivaldi/spring.yml');
    vi.advanceTimersByTime(3000);
    store.lookup('plex:663134', '');

    expect(invalid().length).toBeGreaterThan(before);
    expect(invalid().at(-1)[1]).toMatchObject({ file: 'classical/beethoven/broken.yml' });
  });

  it('keeps serving the last good index when the tree vanishes under it', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    rmSync(root, { recursive: true, force: true });
    vi.advanceTimersByTime(3000);

    let r;
    expect(() => { r = store.lookup('plex:663134', ''); }).not.toThrow();
    expect(r.piece.title).toBe('Symphony No. 3');
  });

  it('survives rootDir being replaced by a regular file, and recovers when the tree returns', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    rmSync(root, { recursive: true, force: true });
    writeFileSync(root, 'not a directory\n');
    vi.advanceTimersByTime(3000);

    // Either outcome is legal while the tree is nonsense — last-good or empty —
    // but not a throw, and not a wedged store.
    let r;
    expect(() => { r = store.lookup('plex:663134', ''); }).not.toThrow();
    expect(r === null || r.piece.title === 'Symphony No. 3').toBe(true);
    expect(() => store.lookup('plex:000', 'Beethoven: 3. Sinfonie')).not.toThrow();

    rmSync(root, { force: true });
    writeFixture();
    writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
      'surround: concert-hall\nmatch: { contentId: plex:663134, title: "Beethoven: 3. Sinfonie" }\npiece: { title: Restored }\n');
    touchAhead('classical/beethoven/symphony-3-eroica.yml');
    vi.advanceTimersByTime(3000);

    expect(store.lookup('plex:663134', '').piece.title).toBe('Restored');
  });

  it('swaps the contentId lane and the title lane together', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:000', 'Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester').piece.title)
      .toBe('Symphony No. 3');

    writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
      'surround: concert-hall\nmatch: { contentId: plex:663134, title: "Mozart: Jupiter" }\npiece: { title: Jupiter }\n');
    touchAhead('classical/beethoven/symphony-3-eroica.yml');
    vi.advanceTimersByTime(3000);

    // contentId lane rebuilt...
    expect(store.lookup('plex:663134', '').piece.title).toBe('Jupiter');
    // ...and the rebind lane with it: the old title is gone, the new one answers.
    expect(store.lookup('plex:000', 'Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester')).toBeNull();
    expect(store.lookup('plex:000', 'Mozart: Jupiter ∙ live').piece.title).toBe('Jupiter');
  });
});

describe('YamlSurroundStore library resolution', () => {
  it('resolves a performance sidecar by merging composer, work, and performance', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r).not.toBeNull();
    expect(r.piece.title).toBe('Symphony No. 3');
    expect(r.piece.opus).toBe('Op. 55');
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0]).toMatchObject({ n: 1, name: 'Allegro con brio', start: 0 });
    expect(r.composer.name).toBe('Ludwig van Beethoven');
    expect(r.composer.birthplace).toBe('Bonn (Electorate of Cologne)'); // performance override wins
    expect(r.assetBase).toBe('library/classical');
  });

  it('excludes a sidecar whose work: ref does not resolve, and logs surround.work.missing', () => {
    write('classical/beethoven/ghost.yml',
      'work: beethoven/does-not-exist\nsurround: concert-hall\nmatch: { contentId: plex:ghost }\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:ghost', '')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('surround.work.missing',
      { work: 'beethoven/does-not-exist', file: 'classical/beethoven/ghost.yml' });
  });

  it('rejects a sidecar with no work: ref as invalid, blocking', () => {
    write('classical/beethoven/noref.yml', 'surround: concert-hall\nmatch: { contentId: plex:noref }\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:noref', '')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('surround.sidecar.invalid',
      expect.objectContaining({ file: 'classical/beethoven/noref.yml', reason: 'missing-work' }));
  });

  it('pairs starts positionally with movements and synthesizes cues from movement notes', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements:\n  - { n: 1, name: One }\n  - { n: 2, name: Two, note: "Second movement begins." }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [0, 976]\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.movements.map((m) => m.start)).toEqual([0, 976]);
    expect(r.cues).toEqual([{ at: 976, render: 'docked', text: 'Second movement begins.' }]);
  });

  it('appends explicit sidecar cues after synthesized movement cues, sorted by time', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements:\n  - { n: 1, name: One, note: "First." }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [0]\ncues:\n  - { at: 500, render: docked, text: "Extra." }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.cues.map((c) => c.text)).toEqual(['First.', 'Extra.']);
  });

  it('warns surround.starts.mismatch when starts length differs from movement count, but still resolves', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements:\n  - { n: 1, name: One }\n  - { n: 2, name: Two }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [0]\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:663134', '');
    expect(r).not.toBeNull();
    expect(r.movements[1].start).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('surround.starts.mismatch',
      { file: 'classical/beethoven/symphony-3-eroica.yml', starts: 1, movements: 2 });
  });

  it('resolves a sidecar with no starts at all — Tier B, media not yet timed', () => {
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:663134', '');
    expect(r).not.toBeNull();
    expect(r.movements[0].start).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalledWith('surround.starts.mismatch', expect.anything());
  });

  it('lets the work-level composer block override the shared _composer.yml', () => {
    writeLib('classical/beethoven/_composer.yml', 'name: Ludwig van Beethoven\nbirthplace: A\n');
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements: []\ncomposer:\n  birthplace: B\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.composer.birthplace).toBe('B');
    expect(r.composer.name).toBe('Ludwig van Beethoven'); // untouched keys still inherit
  });

  it('lets the performance composer block override both the work and the shared composer', () => {
    writeLib('classical/beethoven/_composer.yml', 'name: Ludwig van Beethoven\nbirthplace: A\n');
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements: []\ncomposer:\n  birthplace: B\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\ncomposer:\n  birthplace: C\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.composer.birthplace).toBe('C');
    expect(r.composer.name).toBe('Ludwig van Beethoven');
  });

  it('drops a negative, null, or non-numeric start and warns starts-entry-invalid', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements:\n  - { n: 1, name: One, note: "First." }\n  - { n: 2, name: Two, note: "Second." }\n'
      + '  - { n: 3, name: Three, note: "Third." }\n  - { n: 4, name: Four, note: "Fourth." }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [-30, null, "12:00", 900]\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:663134', '');

    // Garbage never reaches the payload verbatim; positions are preserved, so the
    // one good start still lands on the movement it was authored for.
    expect(r.movements.map((m) => m.start)).toEqual([undefined, undefined, undefined, 900]);
    // ...and no cue is synthesized at a dropped index.
    expect(r.cues).toEqual([{ at: 900, render: 'docked', text: 'Fourth.' }]);
    expect(logger.warn).toHaveBeenCalledWith('surround.sidecar.invalid',
      expect.objectContaining({
        file: 'classical/beethoven/symphony-3-eroica.yml',
        reasons: expect.arrayContaining(['starts-entry-invalid'])
      }));
  });

  it('keeps a zero start, which is a valid offset and not a dropped one', () => {
    // Every real work's first movement starts at 0, so a falsy check anywhere in
    // the coercion would break the primary case while every edge-case test above
    // still passed. The cue assertion matters as much as the start: the cue
    // filter is a second place a zero could be dropped as falsy.
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements:\n  - { n: 1, name: One, note: "Opens here." }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [0]\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:663134', '');
    expect(r.movements[0].start).toBe(0);
    expect(r.cues).toEqual([{ at: 0, render: 'docked', text: 'Opens here.' }]);
    expect(logger.warn).not.toHaveBeenCalledWith('surround.sidecar.invalid',
      expect.objectContaining({ reasons: expect.arrayContaining(['starts-entry-invalid']) }));
  });

  it('warns surround.work.invalid when a corpus work has a non-list movements or facts', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements: { n: 1 }\nfacts: not-a-list\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

    expect(logger.warn).toHaveBeenCalledWith('surround.work.invalid', {
      file: 'classical/beethoven/symphony-3-eroica.yml',
      reason: 'movements-not-a-list',
      reasons: ['movements-not-a-list', 'facts-not-a-list']
    });
    // Warn-then-continue: the work still indexes, with the bad lists coerced empty.
    const r = store.lookup('plex:663134', '');
    expect(r).not.toBeNull();
    expect(r.movements).toEqual([]);
    expect(r.facts).toEqual([]);
  });

  it('rebuilds when only the library tree changes, not just the performance tree', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');

    writeLib('classical/beethoven/symphony-3-eroica.yml', 'title: Retitled\nmovements: []\n');
    const when = new Date(Date.now() + 3000);
    utimesSync(path.join(library, 'classical/beethoven/symphony-3-eroica.yml'), when, when);
    vi.advanceTimersByTime(3000);

    expect(store.lookup('plex:663134', '').piece.title).toBe('Retitled');
    vi.useRealTimers();
  });
});
