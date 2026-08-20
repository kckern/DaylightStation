import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
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
    expect(r.assetBase).toBe('library/classical');
  });

  it('leaves movements untouched when a work gains chapters', () => {
    // Two movements, not one: a single-movement fixture would make offset:0
    // trivially true for every chapter regardless of whether the rail logic
    // ran at all. The second movement's offset only lands on 976 if the
    // sounding-time rail actually accumulated the first movement's duration.
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements:\n  - { n: 1, name: Allegro con brio }\n  - { n: 2, name: Marcia funebre }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n'
      + 'starts: [0, 976]\nmusicEndsAt: 1925\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.movements).toEqual([
      { n: 1, name: 'Allegro con brio', start: 0 },
      { n: 2, name: 'Marcia funebre', start: 976 }
    ]);
    expect(r.chapters[0]).toMatchObject({
      n: 1, name: 'Allegro con brio', start: 0, end: 976, offset: 0, duration: 976
    });
    expect(r.chapters[1]).toMatchObject({
      n: 2, name: 'Marcia funebre', start: 976, end: 1925, offset: 976, duration: 949
    });
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
    // Every trap is a sidecar that would resolve if it were walked — a real work
    // ref, a real definition — so the only reason it stays out of the index is
    // the reserved-name rule under test.
    const piece = (id) =>
      `work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch:\n  contentId: ${id}\n  title: Trap\n`;
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
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch:\n  contentId: plex:663146\n  title: Spring\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    store.lookup('plex:663134', '').definition.regions.right.width = '99%';
    expect(store.lookup('plex:663146', '').definition.regions.right.width).toBe('20%');
  });
});

describe('YamlSurroundStore field resolution', () => {
  it('deep-merges nested composer blocks instead of replacing them', () => {
    writeLib('classical/haydn/_composer.yml',
      'name: Joseph Haydn\nlinks: { wiki: base-wiki, imslp: base-imslp }\n');
    writeLib('classical/haydn/symphony-94.yml', 'title: Surprise\n');
    write('classical/haydn/symphony-94.yml',
      'work: haydn/symphony-94\nsurround: concert-hall\nmatch:\n  contentId: plex:94\n  title: Surprise\ncomposer:\n  links: { wiki: piece-wiki }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:94', '');
    expect(r.composer.links.wiki).toBe('piece-wiki');
    expect(r.composer.links.imslp).toBe('base-imslp');
    expect(r.composer.name).toBe('Joseph Haydn');
  });

  it('coerces a numeric match.contentId to a string key', () => {
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch:\n  contentId: 663146\n  title: Spring\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('663146', '').piece.title).toBe('Spring');
  });

  it('coerces wrong-typed list and object fields to safe empties', () => {
    // The malformed fields sit on whichever side now owns them: movements and
    // facts are corpus-level, cues/composer/piece stay on the performance.
    writeLib('classical/vivaldi/spring.yml', 'movements: not a list\nfacts: { a: 1 }\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch:\n  contentId: plex:663146\n  title: Spring\npiece: just a string\ncues: 5\ncomposer: nope\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663146', '');
    expect(r.movements).toEqual([]);
    expect(r.cues).toEqual([]);
    expect(r.facts).toEqual([]);
    // The work authors no piece fields and the wrong-typed override is ignored.
    expect(r.piece).toEqual({});
    expect(r.composer).toEqual({});
  });

  it('defaults optional blocks to empty when absent', () => {
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch:\n  contentId: plex:663146\n  title: Spring\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663146', '');
    expect(r).toMatchObject({ movements: [], cues: [], facts: [], composer: {}, assetBase: 'library/classical' });
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
      'work: beethoven/symphony-3-eroica\nsurround: does-not-exist\nmatch:\n  contentId: plex:1\n  title: Orphan\n');
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
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch:\n  contentId: plex:663146\n');
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
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch:\n  contentId: plex:663146\n  title: "Vivaldi: The Four Seasons ∙ Spring ∙ Concerto in E major"\n');
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
    writeLib('classical/vivaldi/four-seasons.yml', 'title: The Four Seasons\n');
    writeLib('classical/vivaldi/seasons-alt.yml', 'title: Alt\n');
    write('classical/vivaldi/four-seasons.yml',
      'work: vivaldi/four-seasons\nsurround: concert-hall\nmatch:\n  contentId: plex:1\n  title: "Vivaldi: The Four Seasons"\n');
    write('classical/vivaldi/seasons-alt.yml',
      'work: vivaldi/seasons-alt\nsurround: concert-hall\nmatch:\n  contentId: plex:2\n  title: The Four Seasons\n');
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
    writeLib('classical/vivaldi/spring-short.yml', 'title: Spring (short)\n');
    writeLib('classical/vivaldi/spring-full.yml', 'title: Spring (full)\n');
    write('classical/vivaldi/spring-short.yml',
      'work: vivaldi/spring-short\nsurround: concert-hall\nmatch:\n  contentId: plex:3\n  title: Spring\n');
    write('classical/vivaldi/spring-full.yml',
      'work: vivaldi/spring-full\nsurround: concert-hall\nmatch:\n  contentId: plex:4\n  title: "Violin Concerto No. 1 in E Major, RV 269 Spring"\n');
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

  // Every body carries a work ref that resolves, so the named reason is the only
  // thing wrong with the file.
  it.each([
    ['missing-surround', 'nosurround.yml', 'work: beethoven/symphony-3-eroica\nmatch:\n  contentId: plex:1\n  title: T\n'],
    ['missing-match', 'nomatch.yml', 'work: beethoven/symphony-3-eroica\nsurround: concert-hall\n'],
    ['match-not-a-mapping', 'strmatch.yml', 'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: plex:1\n'],
    ['missing-match-contentId', 'noid.yml', 'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch:\n  title: T\n']
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
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch:\n  contentId: plex:663146\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:663146', '').piece.title).toBe('Spring');
    expect(invalidWarns(logger)).toContainEqual(
      expect.objectContaining({ file: 'classical/vivaldi/spring.yml', reason: 'missing-match-title' }));
    expect(logger.info).toHaveBeenCalledWith('surround.index.built',
      expect.objectContaining({ pieces: 2, skipped: 0 }));
  });

  // Only the fields the performance sidecar still owns. `movements` and `facts`
  // moved to the corpus, where the same silent coercion is reported as
  // surround.work.invalid instead (see the library-resolution block).
  it.each([
    ['piece-not-a-mapping', 'work: vivaldi/odd\nsurround: concert-hall\nmatch: { contentId: plex:9, title: T }\npiece: a string\n'],
    ['starts-not-a-list', 'work: vivaldi/odd\nsurround: concert-hall\nmatch: { contentId: plex:9, title: T }\nstarts: nope\n'],
    ['cues-not-a-list', 'work: vivaldi/odd\nsurround: concert-hall\nmatch: { contentId: plex:9, title: T }\ncues: 5\n'],
    ['composer-not-a-mapping', 'work: vivaldi/odd\nsurround: concert-hall\nmatch: { contentId: plex:9, title: T }\ncomposer: nope\n']
  ])('warns %s without dropping the piece, since the coercion is silent data loss', (reason, body) => {
    writeLib('classical/vivaldi/odd.yml', 'title: Odd\n');
    write('classical/vivaldi/odd.yml', body);
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:9', '')).not.toBeNull();
    expect(invalidWarns(logger)).toContainEqual(
      expect.objectContaining({ file: 'classical/vivaldi/odd.yml', reason }));
  });

  it('does not warn about optional blocks that are simply absent', () => {
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch: { contentId: plex:663146, title: Spring }\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(invalidWarns(logger)).toEqual([]);
  });

  it('reports every problem in one warning, leading with the first', () => {
    writeLib('classical/vivaldi/messy.yml', 'title: Messy\n');
    write('classical/vivaldi/messy.yml',
      'work: vivaldi/messy\nsurround: concert-hall\nmatch:\n  contentId: plex:9\nstarts: nope\ncues: 5\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const [warned, ...rest] = invalidWarns(logger);
    expect(rest).toEqual([]);
    expect(warned.file).toBe('classical/vivaldi/messy.yml');
    expect(warned.reason).toBe('missing-match-title');
    expect(warned.reasons).toEqual(
      ['missing-match-title', 'starts-not-a-list', 'cues-not-a-list']);
  });

  it('reports only the blocking problem when the file is rejected outright', () => {
    write('classical/vivaldi/messy.yml', 'match: { title: T }\nstarts: nope\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(invalidWarns(logger)).toEqual([{
      file: 'classical/vivaldi/messy.yml',
      reason: 'missing-surround',
      reasons: ['missing-surround', 'missing-work', 'missing-match-contentId']
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
  // The work ref resolves; only the definition is missing.
  const orphan = () => {
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: does-not-exist\nmatch: { contentId: plex:663146, title: Spring }\n');
  };

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
    writeLib('classical/vivaldi/first.yml', 'title: First\n');
    writeLib('classical/vivaldi/second.yml', 'title: Second\n');
    write('classical/vivaldi/a-first.yml',
      'work: vivaldi/first\nsurround: concert-hall\nmatch: { contentId: plex:dup, title: First }\n');
    write('classical/vivaldi/b-second.yml',
      'work: vivaldi/second\nsurround: concert-hall\nmatch: { contentId: plex:dup, title: Second }\n');
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
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch: { contentId: plex:663146, title: Spring }\n');
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
    writeLib('classical/vivaldi/four-seasons.yml', 'title: The Four Seasons\n');
    writeLib('classical/vivaldi/seasons-alt.yml', 'title: Alt\n');
    write('classical/vivaldi/four-seasons.yml',
      'work: vivaldi/four-seasons\nsurround: concert-hall\nmatch: { contentId: plex:1, title: "Vivaldi: The Four Seasons" }\n');
    write('classical/vivaldi/seasons-alt.yml',
      'work: vivaldi/seasons-alt\nsurround: concert-hall\nmatch: { contentId: plex:2, title: The Four Seasons }\n');
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
    // A third performance of a work the corpus already carries.
    write('classical/vivaldi/seasons-third.yml',
      'work: vivaldi/four-seasons\nsurround: concert-hall\nmatch: { contentId: plex:3, title: "Vivaldi: The Four Seasons ∙ complete" }\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const warns = ambiguousWarns(logger);
    expect(warns).toHaveLength(1);
    expect(warns[0].candidates).toHaveLength(3);
  });

  it('warns separately for two independent colliding groups', () => {
    twoSeasons();
    write('classical/beethoven/eroica-alt.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:4, title: "Beethoven: 3. Sinfonie ∙ alternate cut" }\n');
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(ambiguousWarns(logger)).toHaveLength(2);
  });

  it('stays silent for a corpus of unrelated titles', () => {
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch: { contentId: plex:663146, title: "Vivaldi: Spring" }\n');
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
    writeLib('classical/vivaldi/orphan.yml', 'title: Orphan\n');
    writeLib('classical/vivaldi/four-seasons.yml', 'title: The Four Seasons\n');
    write('classical/beethoven/broken.yml', 'surround: concert-hall\nmatch: [unclosed\n');
    write('classical/vivaldi/orphan.yml',
      'work: vivaldi/orphan\nsurround: does-not-exist\nmatch: { contentId: plex:5, title: Orphan }\n');
    write('classical/vivaldi/a-dup.yml',
      'work: vivaldi/four-seasons\nsurround: concert-hall\nmatch: { contentId: plex:dup, title: "Vivaldi: The Four Seasons" }\n');
    write('classical/vivaldi/b-dup.yml',
      'work: vivaldi/four-seasons\nsurround: concert-hall\nmatch: { contentId: plex:dup, title: The Four Seasons }\n');
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

  // The edit an author actually makes in this loop is a movement timing, which
  // lives in the performance sidecar as `starts`.
  it('picks up an edited sidecar after the guard window without a restart', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').movements[0].start).toBe(0);

    writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134, title: "Beethoven: 3. Sinfonie" }\nstarts: [42]\n');
    touchAhead('classical/beethoven/symphony-3-eroica.yml');
    vi.advanceTimersByTime(3000);   // past the 2s guard

    expect(store.lookup('plex:663134', '').movements[0].start).toBe(42);
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
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134, title: "Beethoven: 3. Sinfonie" }\nstarts: [42]\n');
    touchAhead('classical/beethoven/symphony-3-eroica.yml');

    vi.advanceTimersByTime(1000);
    expect(store.lookup('plex:663134', '').movements[0].start).toBe(0);
    expect(logger.info.mock.calls).toHaveLength(1);

    vi.advanceTimersByTime(1500);
    expect(store.lookup('plex:663134', '').movements[0].start).toBe(42);
    expect(logger.info.mock.calls).toHaveLength(2);
  });

  it('picks up a sidecar file that did not exist when the index was built', () => {
    // The corpus already carries the work; what appears mid-run is the
    // performance that points at it.
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663146', '')).toBeNull();

    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch: { contentId: plex:663146, title: "Vivaldi: Spring" }\n');
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
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    vi.useFakeTimers();
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const invalid = () => logger.warn.mock.calls.filter((c) => c[0] === 'surround.sidecar.invalid');
    const before = invalid().length;

    // A different file changes; the broken one is untouched and still broken.
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch: { contentId: plex:663146, title: "Vivaldi: Spring" }\n');
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
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134, title: "Beethoven: 3. Sinfonie" }\nstarts: [42]\n');
    touchAhead('classical/beethoven/symphony-3-eroica.yml');
    vi.advanceTimersByTime(3000);

    // Resolving against the corpus again, with the restored tree's own timings.
    expect(store.lookup('plex:663134', '').movements[0].start).toBe(42);
  });

  it('swaps the contentId lane and the title lane together', () => {
    writeLib('classical/mozart/jupiter.yml', 'title: Jupiter\n');
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:000', 'Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester').piece.title)
      .toBe('Symphony No. 3');

    // The sidecar is re-pointed at a different work, and re-titled with it.
    writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
      'work: mozart/jupiter\nsurround: concert-hall\nmatch: { contentId: plex:663134, title: "Mozart: Jupiter" }\n');
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
    // `expected` is a glob, not a path: the corpus may file the composer under
    // any number of grouping directories, so naming one path would send the
    // author to create a duplicate a level above the file they already have.
    expect(logger.warn).toHaveBeenCalledWith('surround.work.missing', {
      work: 'beethoven/does-not-exist',
      expected: 'classical/**/beethoven/does-not-exist.yml',
      file: 'classical/beethoven/ghost.yml'
    });
  });

  it('indexes a directory reachable twice through a symlink exactly once', () => {
    // `listDirs` deliberately includes symlinked directories, so a depth-free
    // walk can reach the same real folder by more than one route. Left alone it
    // does not hang — the joined path outgrows PATH_MAX after a few hundred
    // levels and the walk peters out — it re-reads the same corpus over and
    // over and re-keys every work it already had. The observable symptom is the
    // duplicate warning below firing against a file that exists only once.
    writeLib('classical/5_romantic/chopin/_composer.yml', 'name: Frédéric Chopin\n');
    writeLib('classical/5_romantic/chopin/nocturnes.yml', 'title: Nocturnes\n');
    symlinkSync(path.join(library, 'classical'), path.join(library, 'classical/5_romantic/loop'), 'dir');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

    expect(logger.warn).not.toHaveBeenCalledWith('surround.work.duplicate', expect.anything());
    write('classical/deep/ref.yml',
      'work: chopin/nocturnes\nsurround: concert-hall\nmatch: { contentId: plex:loop }\n');
    expect(new YamlSurroundStore({ rootDir: root, libraryDir: library, logger })
      .lookup('plex:loop', '')?.piece?.title).toBe('Nocturnes');
    expect(store).toBeDefined();
  });

  it('notices an edit to a work file nested below the composer level', () => {
    // The freshness check carried its own copy of the two-level walk. After the
    // corpus grew an era level it stopped reaching work files at all, so an
    // author could rewrite a piece's facts and the running backend would keep
    // serving the old ones until someone restarted it — silently, because a
    // directory's mtime does not move when a file inside it is rewritten.
    writeLib('classical/5_romantic/chopin/_composer.yml', 'name: Fr\u00e9d\u00e9ric Chopin\n');
    writeLib('classical/5_romantic/chopin/nocturnes.yml', 'title: Nocturnes\nfacts:\n  - "before"\n');
    write('classical/deep/ref.yml',
      'work: chopin/nocturnes\nsurround: concert-hall\nmatch: { contentId: plex:edit }\n');

    vi.useFakeTimers();
    try {
      const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
      expect(store.lookup('plex:edit', '')?.facts).toEqual(['before']);

      const when = new Date(Date.now() + 5000);
      writeLib('classical/5_romantic/chopin/nocturnes.yml', 'title: Nocturnes\nfacts:\n  - "after"\n');
      utimesSync(path.join(library, 'classical/5_romantic/chopin/nocturnes.yml'), when, when);
      vi.advanceTimersByTime(3000);   // past the 2s guard

      expect(store.lookup('plex:edit', '')?.facts).toEqual(['after']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('warns when two composer folders share a basename and collide on one work key', () => {
    // Identity is composer + slug, so a depth-free walk makes a collision
    // reachable between folders that never sat at the same level before.
    // Last-write-wins is the old behaviour; going quiet about it is not.
    writeLib('classical/4_classical/adams/prelude.yml', 'title: The Classical One\n');
    writeLib('classical/6_modern/adams/prelude.yml', 'title: The Modern One\n');

    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

    expect(logger.warn).toHaveBeenCalledWith('surround.work.duplicate', {
      work: 'adams/prelude',
      file: expect.stringContaining('adams/prelude.yml')
    });
  });

  it('resolves a work whose composer is filed under grouping directories', () => {
    // The corpus was reorganized from `classical/<composer>/` to
    // `classical/<era>/<composer>/` and every sidecar stopped resolving —
    // `surround.index.built` reported `pieces: 0, skipped: 5` in production.
    // A work's identity is `<composer>/<slug>`; the folders above the composer
    // are filing, and the walk must not encode a depth.
    write('classical/deep/ref.yml',
      'work: chopin/nocturnes\nsurround: concert-hall\nmatch: { contentId: plex:deep }\n');
    writeLib('classical/5_romantic/chopin/_composer.yml', 'name: Frédéric Chopin\n');
    writeLib('classical/5_romantic/chopin/nocturnes.yml',
      'title: Nocturnes\nmovements:\n  - n: 1\n    name: "Op. 9 No. 1"\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:deep', '');

    expect(r).not.toBeNull();
    expect(r.piece.title).toBe('Nocturnes');
    expect(r.composer.name).toBe('Frédéric Chopin');
    expect(logger.warn).not.toHaveBeenCalledWith('surround.work.missing', expect.anything());
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
    // `chapters` desugars from the same rawStarts array as `movements`, so it is
    // just as exposed to a filter-instead-of-map regression. If a bad entry were
    // ever dropped rather than mapped to undefined, the fourth movement's start
    // would slide down to index 0 (or the array would run short); a filtering
    // bug here would silently shift every chapter after the first bad entry.
    expect(r.chapters.map((c) => c.start)).toEqual([undefined, undefined, undefined, 900]);
  });

  it('keeps the chapter after a malformed spans entry at its own position', () => {
    // `spans` is the other timing shape `toSpans` accepts, and it goes through a
    // separate branch (array-of-pairs, not starts+musicEndsAt). A one-element
    // entry — an author who wrote a start with no end — is malformed the same
    // way a bad `starts` value is: if it were filtered out instead of mapped to
    // {start, end:undefined}, movement 3's span would shift into movement 2's
    // slot instead of staying at index 2.
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nmovements:\n  - { n: 1, name: One }\n  - { n: 2, name: Two }\n'
      + '  - { n: 3, name: Three }\n  - { n: 4, name: Four }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n'
      + 'spans:\n  - [0, 10]\n  - [20]\n  - [30, 40]\n  - [50, 60]\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    // The malformed entry (movement 2, a one-element pair) keeps its own start
    // and gets no end. The entries after it — movement 3 and movement 4 — keep
    // the start authored for their own position, not shifted up.
    expect(r.chapters.map((c) => c.start)).toEqual([0, 20, 30, 50]);
    expect(r.chapters[1].end).toBeUndefined();
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

/**
 * DESIGN WAVE 7 — the two fields the band's new layout consumes.
 *
 * `piece.short_title` is a whitelisted piece field (the frame's band prints it
 * as a standing label); `definition.band` is the third thing a definition says
 * about a frame, beside `regions` and `collapse`.
 */
describe('YamlSurroundStore — the band’s fields (design wave 7)', () => {
  it('carries piece.short_title through the whitelist', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3 in E-flat major, "Eroica"\nshort_title: Beethoven\'s Third Symphony\n'
      + 'opus: Op. 55\nmovements:\n  - { n: 1, name: Allegro con brio }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.piece.short_title).toBe("Beethoven's Third Symphony");
    // The frame curls it at the render seam; the store hands it over verbatim.
    expect(r.piece.title).toBe('Symphony No. 3 in E-flat major, "Eroica"');
  });

  it('leaves short_title undefined when the corpus has not authored one', () => {
    // The band renders NO header in that case — an absent short title is a
    // supported state, not a gap to fill with a truncated long one.
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').piece.short_title).toBeUndefined();
  });

  it('carries definition.band alongside regions and collapse', () => {
    write('_surrounds/concert-hall.yml',
      'id: concert-hall\nregions:\n  right: { width: 20%, module: composer-card }\n'
      + '  bottom:\n    - { module: movement-map, height: 60 }\n'
      + 'collapse: { footerFloor: 90 }\n'
      + 'band: { nowSide: dynamic, nowHeading: always, railDensity: bars }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const { definition } = store.lookup('plex:663134', '');
    expect(definition.band).toEqual({ nowSide: 'dynamic', nowHeading: 'always', railDensity: 'bars' });
    expect(definition.regions).toBeDefined();
    expect(definition.collapse).toBeDefined();
  });

  it('leaves definition.band undefined when unauthored — the frame owns the defaults', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').definition.band).toBeUndefined();
  });
});

/**
 * CHAPTER REFERENCES — a chapter may name another work instead of restating it.
 *
 * The corpus already authors this: `chopin/etudes.yml` lists its three opus sets
 * as `- work: chopin/etudes-op-10` rather than copying twenty-seven études into
 * one file. A reference resolves to a SUBTREE, so the rail stays flat while
 * `group` records which part each chapter arrived from.
 */
describe('YamlSurroundStore — chapter references', () => {
  // The corpus files the flagship sets under an era folder; the sidecar tree
  // does not. Both shapes are exercised here because the reference key is
  // `<composer>/<slug>` at whatever depth the corpus filed the work.
  const writeChopinSet = (body) => {
    writeLib('classical/0_flagship/chopin/_composer.yml', 'name: Frédéric Chopin\n');
    writeLib('classical/0_flagship/chopin/etudes.yml', body);
    write('classical/chopin/set.yml',
      'work: chopin/etudes\nsurround: concert-hall\nmatch: { contentId: plex:set }\n');
  };

  it('resolves a chapter that references another work, bringing its own chapters with it', () => {
    writeLib('classical/0_flagship/chopin/_composer.yml', 'name: Frédéric Chopin\n');
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Études, Op. 10"\nmovements:\n  - { n: 1, name: "No. 1 in C major" }\n  - { n: 2, name: "No. 2 in A minor" }\n');
    writeLib('classical/0_flagship/chopin/etudes.yml',
      'title: "Études"\nchapters:\n  - work: chopin/etudes-op-10\n');
    write('classical/chopin/set.yml',
      'work: chopin/etudes\nsurround: concert-hall\nmatch: { contentId: plex:set }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:set', '');

    expect(r.chapters).toHaveLength(2);
    expect(r.chapters[0]).toMatchObject({ name: 'No. 1 in C major' });
    expect(r.chapters[0].group).toEqual({ work: 'chopin/etudes-op-10', title: 'Études, Op. 10', index: 0 });
  });

  it('breaks a reference cycle instead of recursing forever', () => {
    writeLib('classical/0_flagship/chopin/a.yml', 'title: A\nchapters:\n  - work: chopin/b\n');
    writeLib('classical/0_flagship/chopin/b.yml', 'title: B\nchapters:\n  - work: chopin/a\n');
    write('classical/chopin/cyc.yml',
      'work: chopin/a\nsurround: concert-hall\nmatch: { contentId: plex:cyc }\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:cyc', '')).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('surround.chapter.cycle',
      expect.objectContaining({ work: 'chopin/a' }));
  });

  it('numbers groups by part, not by whatever the previous chapter happened to carry', () => {
    // Three chapters, and the middle one is authored inline rather than
    // referenced — the shape a container takes when a stray movement sits
    // between two published sets. The index of the SECOND reference is the
    // assertion that matters: derived from the previous chapter it reads that
    // inline entry, which belongs to no part and carries no group at all.
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Op. 10"\nmovements:\n  - { n: 1, name: "Op. 10 No. 1" }\n');
    writeLib('classical/0_flagship/chopin/etudes-op-25.yml',
      'title: "Op. 25"\nmovements:\n  - { n: 1, name: "Op. 25 No. 1" }\n');
    writeChopinSet('title: "Études"\nchapters:\n  - work: chopin/etudes-op-10\n'
      + '  - { n: 0, name: "Interlude" }\n  - work: chopin/etudes-op-25\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:set', '');

    expect(r.chapters.map((c) => c.name)).toEqual(['Op. 10 No. 1', 'Interlude', 'Op. 25 No. 1']);
    // The inline chapter is ungrouped; the two referenced parts are 0 and 1.
    expect(r.chapters.map((c) => c.group?.index)).toEqual([0, undefined, 1]);
    expect(r.chapters[2].group).toEqual({ work: 'chopin/etudes-op-25', title: 'Op. 25', index: 1 });
  });

  it('expands the same work twice when two chapters reference it — a repeat is not a cycle', () => {
    // The guard has to unwind: a set that opens and closes with the same piece
    // is a legitimate container, and a `seen` that only ever grew would drop the
    // second appearance and warn a cycle that does not exist.
    writeLib('classical/0_flagship/chopin/nocturne.yml',
      'title: Nocturne\nmovements:\n  - { n: 1, name: Nocturne }\n');
    writeChopinSet('title: Recital\nchapters:\n  - work: chopin/nocturne\n  - work: chopin/nocturne\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:set', '');

    expect(r.chapters.map((c) => c.name)).toEqual(['Nocturne', 'Nocturne']);
    expect(r.chapters.map((c) => c.group.index)).toEqual([0, 1]);
    expect(logger.warn).not.toHaveBeenCalledWith('surround.chapter.cycle', expect.anything());
  });

  it('warns and drops a reference to a work the corpus does not hold', () => {
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Op. 10"\nmovements:\n  - { n: 1, name: "Op. 10 No. 1" }\n');
    writeChopinSet('title: "Études"\nchapters:\n  - work: chopin/etudes-op-10\n  - work: chopin/etudes-op-99\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:set', '');

    expect(r.chapters.map((c) => c.name)).toEqual(['Op. 10 No. 1']);
    expect(logger.warn).toHaveBeenCalledWith('surround.chapter.missing',
      expect.objectContaining({ work: 'chopin/etudes-op-99' }));
  });

  it('follows a reference through a work that is itself a container', () => {
    // A reference resolves to a subtree, not a leaf: naming a container brings
    // everything the container names, however deep it nests.
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Op. 10"\nmovements:\n  - { n: 1, name: "Op. 10 No. 1" }\n');
    writeLib('classical/0_flagship/chopin/inner.yml',
      'title: Inner\nchapters:\n  - work: chopin/etudes-op-10\n');
    writeChopinSet('title: Outer\nchapters:\n  - work: chopin/inner\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:set', '');

    expect(r.chapters.map((c) => c.name)).toEqual(['Op. 10 No. 1']);
    // The innermost part is the one that owns the chapter: the rail labels a
    // chapter with the work it was written in, not the container above it.
    expect(r.chapters[0].group.work).toBe('chopin/etudes-op-10');
  });

  it('accepts an inline chapters: list as the alias movements: has always been', () => {
    // Neither key is being renamed. A work may author `chapters:` with no
    // references in it at all, and it must time exactly as `movements:` does.
    writeChopinSet('title: "Études"\nchapters:\n  - { n: 1, name: One }\n  - { n: 2, name: Two }\n');
    write('classical/chopin/set.yml',
      'work: chopin/etudes\nsurround: concert-hall\nmatch: { contentId: plex:set }\n'
      + 'starts: [0, 60]\nmusicEndsAt: 150\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:set', '');

    expect(r.movements).toEqual([{ n: 1, name: 'One', start: 0 }, { n: 2, name: 'Two', start: 60 }]);
    expect(r.chapters[1]).toMatchObject({ n: 2, name: 'Two', start: 60, end: 150, offset: 60, duration: 90 });
    expect(r.timeline.totalSounding).toBe(150);
  });

  it('leaves a work with no chapters: key resolving from movements, ungrouped', () => {
    // The 1,492 corpus files that predate this feature all take this path. If
    // the fallback ever stopped firing, every one of them would render an empty
    // rail — so assert the Eroica payload is byte-for-byte what it was.
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');

    expect(r.movements).toEqual([{ n: 1, name: 'Allegro con brio', start: 0 }]);
    // `part` is on every chapter, container or not: a lone media item is part 0
    // of a one-part rail, so nothing downstream has to special-case its absence.
    expect(r.chapters).toEqual([
      { n: 1, name: 'Allegro con brio', start: 0, end: undefined, contentId: 'plex:663134', duration: 0, offset: 0, part: 0 }
    ]);
    expect('group' in r.chapters[0]).toBe(false);
  });
});

/**
 * PARTS — one rail, several media items.
 *
 * A container's `parts` name contentIds, not timings. Each part is an ordinary
 * sidecar that already resolves and plays standalone; the container looks each
 * one up among the pieces the walk resolved and concatenates what it found. The
 * chapters keep their own media item's `start`/`end` and are laid back onto ONE
 * sounding rail, which is what lets a single frame span three étude episodes.
 */
describe('YamlSurroundStore — parts composed by contentId', () => {
  // Three sidecars that each resolve alone, plus the container that names them.
  // Op. 10 stands for the real twelve; the shape is what is under test.
  const writeEtudes = (containerBody) => {
    writeLib('classical/0_flagship/chopin/_composer.yml', 'name: Frédéric Chopin\n');
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Études, Op. 10"\nmovements:\n  - { n: 1, name: "Op. 10 No. 1" }\n  - { n: 2, name: "Op. 10 No. 2" }\n');
    writeLib('classical/0_flagship/chopin/etudes-op-25.yml',
      'title: "Études, Op. 25"\nmovements:\n  - { n: 1, name: "Op. 25 No. 1" }\n');
    writeLib('classical/0_flagship/chopin/etudes.yml',
      'title: "Études"\nchapters:\n  - work: chopin/etudes-op-10\n  - work: chopin/etudes-op-25\n');
    write('classical/chopin/etudes-op-10.yml',
      'work: chopin/etudes-op-10\nsurround: concert-hall\nmatch: { contentId: plex:ep1 }\n'
      + 'starts: [10, 110]\nmusicEndsAt: 310\n');
    write('classical/chopin/etudes-op-25.yml',
      'work: chopin/etudes-op-25\nsurround: concert-hall\nmatch: { contentId: plex:ep2 }\n'
      + 'starts: [5]\nmusicEndsAt: 45\n');
    write('classical/chopin/etudes.season.yml', containerBody);
  };
  const SEASON = 'work: chopin/etudes\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
    + 'parts:\n  - plex:ep1\n  - plex:ep2\n';

  it('concatenates the parts’ own chapters onto one sounding rail', () => {
    writeEtudes(SEASON);
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    // start/end stay in each part's OWN media clock — ep2's first chapter starts
    // at 5 seconds into ep2, not 5 seconds into the season. Only `offset` is
    // global, and it is the whole reason composition cannot be a concatenation
    // of already-placed chapters: MUTATION PROOF — drop the withOffsets call in
    // #composeContainers and ep2's chapter keeps its standalone offset of 0
    // instead of 300, so the rail draws it on top of Op. 10 No. 1.
    expect(r.chapters.map((c) => [c.name, c.contentId, c.start, c.offset, c.duration])).toEqual([
      ['Op. 10 No. 1', 'plex:ep1', 10, 0, 100],
      ['Op. 10 No. 2', 'plex:ep1', 110, 100, 200],
      ['Op. 25 No. 1', 'plex:ep2', 5, 300, 40]
    ]);
    expect(r.timeline).toEqual({
      totalSounding: 340,
      parts: [
        { contentId: 'plex:ep1', index: 0, sounding: 300 },
        { contentId: 'plex:ep2', index: 1, sounding: 40 }
      ]
    });
  });

  it('labels each part with the work that part plays, not the container above it', () => {
    writeEtudes(SEASON);
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    expect(r.chapters.map((c) => c.part)).toEqual([0, 0, 1]);
    expect(r.chapters[0].group).toEqual({ work: 'chopin/etudes-op-10', title: 'Études, Op. 10', index: 0 });
    expect(r.chapters[2].group).toEqual({ work: 'chopin/etudes-op-25', title: 'Études, Op. 25', index: 1 });
    // The container's own piece block still comes from its own work.
    expect(r.piece.title).toBe('Études');
  });

  it('composes a part whose sidecar the walk has not reached yet', () => {
    // The container sorts before its parts here (`a-season` < `z-part`), so a
    // store that composed while resolving a single file would find nothing.
    writeLib('classical/0_flagship/chopin/one.yml', 'title: One\nmovements:\n  - { n: 1, name: Solo }\n');
    writeLib('classical/0_flagship/chopin/set.yml', 'title: Set\nchapters:\n  - work: chopin/one\n');
    write('classical/chopin/a-season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:late }\nparts:\n  - plex:z\n');
    write('classical/chopin/z-part.yml',
      'work: chopin/one\nsurround: concert-hall\nmatch: { contentId: plex:z }\nstarts: [0]\nmusicEndsAt: 60\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:late', '');
    expect(r.chapters.map((c) => [c.name, c.contentId, c.duration])).toEqual([['Solo', 'plex:z', 60]]);
  });

  it('warns surround.part.missing and keeps the rest of the rail', () => {
    // MUTATION PROOF — make the missing part fault the whole container (return
    // early, or push a placeholder slot) and the two surviving chapters vanish
    // or renumber: Op. 25 would land at part 2 with a gap at index 1, and
    // timeline.parts[2] would accrue its sounding into an empty slot.
    writeEtudes('work: chopin/etudes\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - plex:ep1\n  - plex:gone\n  - plex:ep2\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:season', '');

    expect(logger.warn).toHaveBeenCalledWith('surround.part.missing', {
      file: 'classical/chopin/etudes.season.yml', contentId: 'plex:gone', index: 1
    });
    expect(r.chapters.map((c) => c.name)).toEqual(['Op. 10 No. 1', 'Op. 10 No. 2', 'Op. 25 No. 1']);
    // Surviving parts are numbered densely, so timeline.parts[c.part] is always
    // the slot that chapter's sounding belongs to.
    expect(r.chapters.map((c) => c.part)).toEqual([0, 0, 1]);
    expect(r.timeline.parts).toEqual([
      { contentId: 'plex:ep1', index: 0, sounding: 300 },
      { contentId: 'plex:ep2', index: 1, sounding: 40 }
    ]);
    expect(r.timeline.totalSounding).toBe(340);
  });

  it('refuses to compose a container that names itself', () => {
    writeEtudes('work: chopin/etudes\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - plex:season\n  - plex:ep2\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:season', '');

    expect(logger.warn).toHaveBeenCalledWith('surround.part.missing',
      expect.objectContaining({ contentId: 'plex:season' }));
    expect(r.chapters.map((c) => c.contentId)).toEqual(['plex:ep2']);
  });

  it('leaves each part still playable on its own', () => {
    // The parts are not consumed by the container: they are ordinary sidecars
    // and their own frames are exactly what they were before it existed.
    writeEtudes(SEASON);
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:ep2', '');

    expect(r.piece.title).toBe('Études, Op. 25');
    expect(r.chapters).toEqual([
      { n: 1, name: 'Op. 25 No. 1', start: 5, end: 45, contentId: 'plex:ep2', duration: 40, offset: 0, part: 0 }
    ]);
    expect(r.timeline).toEqual({ totalSounding: 40, parts: [{ contentId: 'plex:ep2', index: 0, sounding: 40 }] });
  });
});

describe('YamlSurroundStore.lookupByPart', () => {
  const writeSeason = () => {
    writeLib('classical/0_flagship/chopin/one.yml', 'title: One\nmovements:\n  - { n: 1, name: Solo }\n');
    writeLib('classical/0_flagship/chopin/set.yml', 'title: Set\nchapters:\n  - work: chopin/one\n');
    write('classical/chopin/part.yml',
      'work: chopin/one\nsurround: concert-hall\nmatch: { contentId: plex:ep1 }\nstarts: [0]\nmusicEndsAt: 60\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\nparts:\n  - plex:ep1\n');
  };

  it('answers with the container, not the item’s own standalone payload', () => {
    writeSeason();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });

    const hit = store.lookupByPart('plex:ep1');
    expect(hit.part).toBe(0);
    expect(hit.payload.piece.title).toBe('Set');
    // ...while the standalone frame is untouched and still reachable.
    expect(store.lookup('plex:ep1', '').piece.title).toBe('One');
  });

  it('treats an uncontained item as part 0 of its own rail', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const hit = store.lookupByPart('plex:663134');
    expect(hit).toEqual({ payload: store.lookup('plex:663134', ''), part: 0 });
  });

  it('returns null for an id no surround covers, and hands out a clone', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookupByPart('plex:nothing')).toBeNull();

    const first = store.lookupByPart('plex:663134');
    first.payload.piece.title = 'Vandalised';
    expect(store.lookupByPart('plex:663134').payload.piece.title).toBe('Symphony No. 3');
  });
});

/**
 * INLINE PARTS — the fallback for a one-off container with no per-part sidecars.
 *
 * Nothing in the authored corpus takes this path today; it exists so a container
 * assembled from media that was never authored separately can still state its
 * own timings, part by part, against the chapters its work already resolves.
 */
describe('YamlSurroundStore — parts timed inline', () => {
  it('places each part’s chapters in its own media item', () => {
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nmovements:\n  - { n: 1, name: "One" }\n  - { n: 2, name: "Two" }\n');
    writeLib('classical/0_flagship/chopin/p2.yml', 'title: P2\nmovements:\n  - { n: 1, name: "Three" }\n');
    writeLib('classical/0_flagship/chopin/set.yml',
      'title: Set\nchapters:\n  - work: chopin/p1\n  - work: chopin/p2\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - { work: chopin/p1, contentId: plex:ep1, spans: [[0, 10], [20, 35]] }\n'
      + '  - { work: chopin/p2, contentId: plex:ep2 }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    expect(r.chapters.map((c) => [c.name, c.contentId, c.offset, c.duration])).toEqual([
      ['One', 'plex:ep1', 0, 10], ['Two', 'plex:ep1', 10, 15], ['Three', 'plex:ep2', 25, 0]
    ]);
    expect(r.timeline.parts).toEqual([
      { contentId: 'plex:ep1', index: 0, sounding: 25 },
      { contentId: 'plex:ep2', index: 1, sounding: 0 }
    ]);
  });

  it('warns when a part times a different number of chapters than its work has', () => {
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nmovements:\n  - { n: 1, name: "One" }\n  - { n: 2, name: "Two" }\n');
    writeLib('classical/0_flagship/chopin/set.yml', 'title: Set\nchapters:\n  - work: chopin/p1\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:s2 }\n'
      + 'parts:\n  - { work: chopin/p1, contentId: plex:ep1, spans: [[0, 10]] }\n');

    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).toHaveBeenCalledWith('surround.spans.mismatch',
      expect.objectContaining({ work: 'chopin/p1', spans: 1, chapters: 2 }));
  });

  it('pairs a miscounted part’s spans with its OWN chapters, not the flat list', () => {
    // The reason the inline path groups by work first. Part 1 times one span for
    // a two-chapter work; if spans were consumed off the flat resolved list,
    // part 2's span would be eaten as part 1's second chapter and every later
    // timing would slide by one.
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nmovements:\n  - { n: 1, name: One }\n  - { n: 2, name: Two }\n');
    writeLib('classical/0_flagship/chopin/p2.yml', 'title: P2\nmovements:\n  - { n: 1, name: Three }\n');
    writeLib('classical/0_flagship/chopin/set.yml',
      'title: Set\nchapters:\n  - work: chopin/p1\n  - work: chopin/p2\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - { work: chopin/p1, contentId: plex:ep1, spans: [[0, 10]] }\n'
      + '  - { work: chopin/p2, contentId: plex:ep2, spans: [[0, 90]] }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    expect(r.chapters.map((c) => [c.name, c.contentId, c.duration])).toEqual([
      ['One', 'plex:ep1', 10], ['Two', 'plex:ep1', 0], ['Three', 'plex:ep2', 90]
    ]);
  });

  it('carries a part’s performance credit onto its own chapters only', () => {
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nmovements:\n  - { n: 1, name: One }\n');
    writeLib('classical/0_flagship/chopin/p2.yml', 'title: P2\nmovements:\n  - { n: 1, name: Two }\n');
    writeLib('classical/0_flagship/chopin/set.yml',
      'title: Set\nchapters:\n  - work: chopin/p1\n  - work: chopin/p2\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - { work: chopin/p1, contentId: plex:ep1, performance: Lortie }\n'
      + '  - { work: chopin/p2, contentId: plex:ep2 }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');
    expect(r.chapters.map((c) => c.performance)).toEqual(['Lortie', undefined]);
  });

  it('reports a parts: block that is not a list rather than coercing it', () => {
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n'
      + 'starts: [0]\nparts: plex:nope\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

    expect(logger.warn).toHaveBeenCalledWith('surround.sidecar.invalid',
      expect.objectContaining({ reasons: expect.arrayContaining(['parts-not-a-list']) }));
    // Warn-then-continue: it still resolves down the single-item path.
    expect(store.lookup('plex:663134', '').chapters).toHaveLength(1);
  });
});
