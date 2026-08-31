import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlSurroundStore } from './YamlSurroundStore.mjs';
import { listYamlFiles } from '#system/utils/FileIO.mjs';

let root;      // performance-sidecar tree (old rootDir)
let library;   // knowledge-corpus tree (new libraryDir)
const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

function writeFixture() {
  mkdirSync(path.join(root, '_surrounds'), { recursive: true });
  mkdirSync(path.join(root, 'classical/beethoven'), { recursive: true });
  mkdirSync(path.join(library, 'classical/beethoven'), { recursive: true });
  writeFileSync(path.join(root, '_surrounds/concert-hall.yml'),
    'id: concert-hall\nregions:\n  right: { width: 20%, module: composer-card }\n  bottom:\n    - { module: segment-map, height: 60 }\ncollapse: { footerFloor: 90 }\n');
  writeFileSync(path.join(library, 'classical/beethoven/_composer.yml'),
    'name: Ludwig van Beethoven\nborn: 1770\ndied: 1827\nbirthplace: Bonn\nportrait: beethoven/portrait.jpg\n');
  writeFileSync(path.join(library, 'classical/beethoven/symphony-3-eroica.yml'),
    'title: Symphony No. 3\nopus: Op. 55\nsegments:\n  - { n: 1, name: Allegro con brio }\n');
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
    expect(r.pieceSegments).toHaveLength(1);
    expect(r.assetBase).toBe('library/classical');
  });

  it('leaves segments untouched when a work gains segments', () => {
    // Two segments, not one: a single-segment fixture would make offset:0
    // trivially true for every segment regardless of whether the rail logic
    // ran at all. The second segment's offset only lands on 976 if the
    // sounding-time rail actually accumulated the first segment's duration.
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments:\n  - { n: 1, name: Allegro con brio }\n  - { n: 2, name: Marcia funebre }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n'
      + 'starts: [0, 976]\nmusicEndsAt: 1925\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.pieceSegments).toEqual([
      { n: 1, name: 'Allegro con brio', start: 0 },
      { n: 2, name: 'Marcia funebre', start: 976 }
    ]);
    expect(r.segments[0]).toMatchObject({
      n: 1, name: 'Allegro con brio', start: 0, end: 976, offset: 0, duration: 976
    });
    expect(r.segments[1]).toMatchObject({
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

/**
 * ONE BAD SIDECAR COSTS ONE SIDECAR — the walk loop's own guard, as against
 * `#composeContainers`' (already per-container; see the "composition isolation"
 * block below). Before this the whole per-file loop sat under ONE try/catch, so
 * the FIRST sidecar to throw silently dropped every piece indexed after it —
 * walk order, an accident of the filesystem, decided how much of a ~1,500-file
 * corpus one bad file was allowed to take with it. That is the exact shape that
 * put a real screen dark twice in one production day: `surround.index.built
 * pieces: 0` with nothing in the log store naming why.
 */
describe('YamlSurroundStore — sidecar-walk isolation', () => {
  it('keeps indexing after one sidecar throws, and names the one that did', () => {
    // THE THROW ITSELF is forced honestly, at a real call site inside
    // `#resolvePerformance` — the sidecar has no `match.title`, which is a SOFT
    // defect that still indexes the piece but calls `this.logger.warn(...)` to
    // report it. Making `warn` explode for exactly that one file's warning is a
    // real exception coming out of the method under test, not a hook added to
    // the store for the test's benefit — the store cannot tell this apart from
    // a bug in some future warning, which is the point: ANY throw from
    // resolving one sidecar must cost only that sidecar.
    write('classical/beethoven/good.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:good, title: Good }\n');
    write('classical/beethoven/bad.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:bad }\n');
    const badFile = 'classical/beethoven/bad.yml';
    const logger = makeLogger();
    logger.warn.mockImplementation((event, data) => {
      if (event === 'surround.sidecar.invalid' && data?.file === badFile) {
        throw new Error('logger exploded mid-warn');
      }
    });

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

    // The good sidecar, walked alphabetically after the bad one, still resolves.
    expect(store.lookup('plex:good', '')).not.toBeNull();
    // The bad one itself is dropped, not half-indexed.
    expect(store.lookup('plex:bad', '')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('surround.sidecar.threw', {
      file: badFile,
      message: 'logger exploded mid-warn'
    });
  });

  it('does not warn twice for the sidecar that threw', () => {
    write('classical/beethoven/bad.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:bad }\n');
    const badFile = 'classical/beethoven/bad.yml';
    const logger = makeLogger();
    logger.warn.mockImplementation((event, data) => {
      if (event === 'surround.sidecar.invalid' && data?.file === badFile) {
        throw new Error('logger exploded mid-warn');
      }
    });
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.error.mock.calls.filter((c) => c[0] === 'surround.sidecar.threw')).toHaveLength(1);
  });

  it('counts the thrown sidecar as skipped in the index line', () => {
    write('classical/beethoven/bad.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:bad }\n');
    const badFile = 'classical/beethoven/bad.yml';
    const logger = makeLogger();
    logger.warn.mockImplementation((event, data) => {
      if (event === 'surround.sidecar.invalid' && data?.file === badFile) {
        throw new Error('logger exploded mid-warn');
      }
    });
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    // The fixture's own eroica sidecar (1) plus the thrown one counted as skipped.
    expect(logger.info).toHaveBeenCalledWith('surround.index.built',
      expect.objectContaining({ pieces: 1, skipped: 1 }));
  });

  it('logs the walk failure instead of swallowing it when the root itself faults mid-walk', () => {
    // `rootDir: undefined` makes `path.join` throw inside `#loadDefinitions`,
    // before the per-file loop ever runs — the OUTER guard's own case, kept
    // deliberately distinct from the per-sidecar one above.
    const logger = makeLogger();
    let store;
    expect(() => { store = new YamlSurroundStore({ rootDir: undefined, libraryDir: library, logger }); }).not.toThrow();
    expect(store.lookup('plex:663134', '')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('surround.index.walk-failed', expect.any(Object));
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
    first.pieceSegments.push({ n: 99 });
    first.piece.title = 'mutated';
    expect(store.lookup('plex:663134', '').pieceSegments).toHaveLength(1);
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
    // The malformed fields sit on whichever side now owns them: segments and
    // facts are corpus-level, cues/composer/piece stay on the performance.
    writeLib('classical/vivaldi/spring.yml', 'segments: not a list\nfacts: { a: 1 }\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch:\n  contentId: plex:663146\n  title: Spring\npiece: just a string\ncues: 5\ncomposer: nope\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663146', '');
    expect(r.pieceSegments).toEqual([]);
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
    expect(r).toMatchObject({ pieceSegments: [], cues: [], facts: [], composer: {}, assetBase: 'library/classical' });
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

  it('refuses a one-word live title that is only a substring of an authored title', () => {
    writeLib('classical/vivaldi/spring.yml', 'title: Spring\n');
    write('classical/vivaldi/spring.yml',
      'work: vivaldi/spring\nsurround: concert-hall\nmatch:\n  contentId: plex:663146\n  title: "Violin Concerto No. 1 in E Major, RV 269 Spring"\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

    expect(store.lookup('plex:622243', 'Spring')).toBeNull();
    expect(logger.warn).not.toHaveBeenCalledWith('surround.match.rebound', expect.anything());
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
    store.lookup('plex:999999', live).pieceSegments.push({ n: 99 });
    store.lookup('plex:999999', live).piece.title = 'mutated';
    expect(store.lookup('plex:663134', '').pieceSegments).toHaveLength(1);
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

  it('ignores a one-word authored title when a strong exact title identifies one sidecar', () => {
    // A one-word title is too weak for stale-id recovery. It must not turn a
    // strong exact match into ambiguity, or match unrelated media named Spring.
    writeLib('classical/vivaldi/spring-short.yml', 'title: Spring (short)\n');
    writeLib('classical/vivaldi/spring-full.yml', 'title: Spring (full)\n');
    write('classical/vivaldi/spring-short.yml',
      'work: vivaldi/spring-short\nsurround: concert-hall\nmatch:\n  contentId: plex:3\n  title: Spring\n');
    write('classical/vivaldi/spring-full.yml',
      'work: vivaldi/spring-full\nsurround: concert-hall\nmatch:\n  contentId: plex:4\n  title: "Violin Concerto No. 1 in E Major, RV 269 Spring"\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:999999', 'Violin Concerto No. 1 in E Major, RV 269 Spring').piece.title)
      .toBe('Spring (full)');
    expect(logger.warn).not.toHaveBeenCalledWith('surround.match.ambiguous', expect.anything());
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

  // Only the fields the performance sidecar still owns. `segments` and `facts`
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
      'surround.titles.ambiguous',
      // `four-seasons.yml` is a title and nothing else, so the two sidecars
      // pointing at it resolve to an empty rail — the family added after a
      // corpus migrated ahead of its deploy left every rail blank in silence.
      'surround.segments.none'
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

  // The edit an author actually makes in this loop is a segment timing, which
  // lives in the performance sidecar as `starts`.
  it('picks up an edited sidecar after the guard window without a restart', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').pieceSegments[0].start).toBe(0);

    writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134, title: "Beethoven: 3. Sinfonie" }\nstarts: [42]\n');
    touchAhead('classical/beethoven/symphony-3-eroica.yml');
    vi.advanceTimersByTime(3000);   // past the 2s guard

    expect(store.lookup('plex:663134', '').pieceSegments[0].start).toBe(42);
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
    expect(store.lookup('plex:663134', '').pieceSegments[0].start).toBe(0);
    expect(logger.info.mock.calls).toHaveLength(1);

    vi.advanceTimersByTime(1500);
    expect(store.lookup('plex:663134', '').pieceSegments[0].start).toBe(42);
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
    expect(store.lookup('plex:663134', '').pieceSegments[0].start).toBe(42);
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
    expect(r.pieceSegments).toHaveLength(1);
    expect(r.pieceSegments[0]).toMatchObject({ n: 1, name: 'Allegro con brio', start: 0 });
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
      'title: Nocturnes\nsegments:\n  - n: 1\n    name: "Op. 9 No. 1"\n');

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

  it('pairs starts positionally with segments and synthesizes cues from segment notes', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments:\n  - { n: 1, name: One }\n  - { n: 2, name: Two, note: "Second segment begins." }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [0, 976]\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.pieceSegments.map((m) => m.start)).toEqual([0, 976]);
    expect(r.cues).toEqual([{ at: 976, render: 'docked', text: 'Second segment begins.' }]);
  });

  it('appends explicit sidecar cues after synthesized segment cues, sorted by time', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments:\n  - { n: 1, name: One, note: "First." }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [0]\ncues:\n  - { at: 500, render: docked, text: "Extra." }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.cues.map((c) => c.text)).toEqual(['First.', 'Extra.']);
  });

  it('warns surround.starts.mismatch when starts length differs from segment count, but still resolves', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments:\n  - { n: 1, name: One }\n  - { n: 2, name: Two }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [0]\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:663134', '');
    expect(r).not.toBeNull();
    expect(r.pieceSegments[1].start).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('surround.starts.mismatch',
      { file: 'classical/beethoven/symphony-3-eroica.yml', starts: 1, segments: 2 });
  });

  it('resolves a sidecar with no starts at all — Tier B, media not yet timed', () => {
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:663134', '');
    expect(r).not.toBeNull();
    expect(r.pieceSegments[0].start).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalledWith('surround.starts.mismatch', expect.anything());
  });

  it('lets the work-level composer block override the shared _composer.yml', () => {
    writeLib('classical/beethoven/_composer.yml', 'name: Ludwig van Beethoven\nbirthplace: A\n');
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments: []\ncomposer:\n  birthplace: B\n');
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
      'title: Symphony No. 3\nsegments: []\ncomposer:\n  birthplace: B\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\ncomposer:\n  birthplace: C\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.composer.birthplace).toBe('C');
    expect(r.composer.name).toBe('Ludwig van Beethoven');
  });

  it('drops a negative, null, or non-numeric start and warns starts-entry-invalid', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments:\n  - { n: 1, name: One, note: "First." }\n  - { n: 2, name: Two, note: "Second." }\n'
      + '  - { n: 3, name: Three, note: "Third." }\n  - { n: 4, name: Four, note: "Fourth." }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [-30, null, "12:00", 900]\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:663134', '');

    // Garbage never reaches the payload verbatim; positions are preserved, so the
    // one good start still lands on the segment it was authored for.
    expect(r.pieceSegments.map((m) => m.start)).toEqual([undefined, undefined, undefined, 900]);
    // ...and no cue is synthesized at a dropped index.
    expect(r.cues).toEqual([{ at: 900, render: 'docked', text: 'Fourth.' }]);
    expect(logger.warn).toHaveBeenCalledWith('surround.sidecar.invalid',
      expect.objectContaining({
        file: 'classical/beethoven/symphony-3-eroica.yml',
        reasons: expect.arrayContaining(['starts-entry-invalid'])
      }));
    // `segments` desugars from the same rawStarts array as `segments`, so it is
    // just as exposed to a filter-instead-of-map regression. If a bad entry were
    // ever dropped rather than mapped to undefined, the fourth segment's start
    // would slide down to index 0 (or the array would run short); a filtering
    // bug here would silently shift every segment after the first bad entry.
    expect(r.segments.map((c) => c.start)).toEqual([undefined, undefined, undefined, 900]);
  });

  it('keeps the segment after a malformed spans entry at its own position', () => {
    // `spans` is the other timing shape `toSpans` accepts, and it goes through a
    // separate branch (array-of-pairs, not starts+musicEndsAt). A one-element
    // entry — an author who wrote a start with no end — is malformed the same
    // way a bad `starts` value is: if it were filtered out instead of mapped to
    // {start, end:undefined}, segment 3's span would shift into segment 2's
    // slot instead of staying at index 2.
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments:\n  - { n: 1, name: One }\n  - { n: 2, name: Two }\n'
      + '  - { n: 3, name: Three }\n  - { n: 4, name: Four }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n'
      + 'spans:\n  - [0, 10]\n  - [20]\n  - [30, 40]\n  - [50, 60]\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    // The malformed entry (segment 2, a one-element pair) keeps its own start
    // and gets no end. The entries after it — segment 3 and segment 4 — keep
    // the start authored for their own position, not shifted up.
    expect(r.segments.map((c) => c.start)).toEqual([0, 20, 30, 50]);
    expect(r.segments[1].end).toBeUndefined();
  });

  it('keeps a zero start, which is a valid offset and not a dropped one', () => {
    // Every real work's first segment starts at 0, so a falsy check anywhere in
    // the coercion would break the primary case while every edge-case test above
    // still passed. The cue assertion matters as much as the start: the cue
    // filter is a second place a zero could be dropped as falsy.
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments:\n  - { n: 1, name: One, note: "Opens here." }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\nstarts: [0]\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:663134', '');
    expect(r.pieceSegments[0].start).toBe(0);
    expect(r.cues).toEqual([{ at: 0, render: 'docked', text: 'Opens here.' }]);
    expect(logger.warn).not.toHaveBeenCalledWith('surround.sidecar.invalid',
      expect.objectContaining({ reasons: expect.arrayContaining(['starts-entry-invalid']) }));
  });

  it('warns surround.work.invalid when a corpus work has a non-list segments or facts', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments: { n: 1 }\nfacts: not-a-list\n');
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

    expect(logger.warn).toHaveBeenCalledWith('surround.work.invalid', {
      file: 'classical/beethoven/symphony-3-eroica.yml',
      reason: 'segments-not-a-list',
      reasons: ['segments-not-a-list', 'facts-not-a-list']
    });
    // Warn-then-continue: the work still indexes, with the bad lists coerced empty.
    const r = store.lookup('plex:663134', '');
    expect(r).not.toBeNull();
    expect(r.pieceSegments).toEqual([]);
    expect(r.facts).toEqual([]);
  });

  it('rebuilds when only the library tree changes, not just the performance tree', () => {
    vi.useFakeTimers();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');

    writeLib('classical/beethoven/symphony-3-eroica.yml', 'title: Retitled\nsegments: []\n');
    const when = new Date(Date.now() + 3000);
    utimesSync(path.join(library, 'classical/beethoven/symphony-3-eroica.yml'), when, when);
    vi.advanceTimersByTime(3000);

    expect(store.lookup('plex:663134', '').piece.title).toBe('Retitled');
    vi.useRealTimers();
  });
});

describe('YamlSurroundStore library grouping folders', () => {
  it('resolves a composer filed under a grouping folder exactly as a flat one', () => {
    // The corpus shelves 354 composers under period folders. If the grouping
    // leaked into the key, every `work:` ref in every sidecar would need
    // rewriting whenever a composer were reshelved — so the key must stay
    // <composer>/<work> no matter how deep the folder sits.
    writeLib('classical/5_romantic/brahms/_composer.yml', 'name: Johannes Brahms\nborn: 1833\ndied: 1897\n');
    writeLib('classical/5_romantic/brahms/symphony-4.yml', 'title: Symphony No. 4\nopus: Op. 98\n');
    write('classical/brahms/symphony-4.yml',
      'work: brahms/symphony-4\nsurround: concert-hall\nmatch: { contentId: plex:900 }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:900', '');
    expect(r.piece.title).toBe('Symphony No. 4');
    expect(r.composer.name).toBe('Johannes Brahms');
  });

  it('reshelving a composer does not change the work key', () => {
    // The same composer and work, one level deeper. Same ref, same result:
    // this is the property that makes the period folders cosmetic.
    writeLib('classical/0_flagship/a/b/mahler/_composer.yml', 'name: Gustav Mahler\nborn: 1860\ndied: 1911\n');
    writeLib('classical/0_flagship/a/b/mahler/symphony-2.yml', 'title: Resurrection\n');
    write('classical/mahler/symphony-2.yml',
      'work: mahler/symphony-2\nsurround: concert-hall\nmatch: { contentId: plex:901 }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:901', '').piece.title).toBe('Resurrection');
  });

  it('indexes composers deeper than the former grouping-depth bound', () => {
    // Traversal is depth-free and guards against cycles by real path, so corpus
    // shelving can grow without silently making a deeply filed work unreachable.
    const deep = 'classical/g1/g2/g3/g4/g5/buried';
    writeLib(`${deep}/_composer.yml`, 'name: Buried\nborn: 1900\ndied: 1950\n');
    writeLib(`${deep}/work.yml`, 'title: Unreachable\n');
    write('classical/buried/work.yml',
      'work: buried/work\nsurround: concert-hall\nmatch: { contentId: plex:902 }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:902', '').piece.title).toBe('Unreachable');
  });

  it('warns when two grouping folders claim the same composer slug', () => {
    // Last write wins in the Map, so the loser's works disappear with no symptom
    // but a short index. The warning is the only way an author learns why.
    writeLib('classical/4_classical/haydn/_composer.yml', 'name: Joseph Haydn\nborn: 1732\ndied: 1809\n');
    writeLib('classical/4_classical/haydn/symphony-94.yml', 'title: Surprise\n');
    writeLib('classical/5_romantic/haydn/_composer.yml', 'name: Wrong Haydn\nborn: 1800\ndied: 1850\n');
    writeLib('classical/5_romantic/haydn/other.yml', 'title: Other\n');
    const logger = makeLogger();
    // eslint-disable-next-line no-new
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger }).lookup('plex:663134', '');
    expect(logger.warn).toHaveBeenCalledWith('surround.composer.duplicate',
      expect.objectContaining({ composer: 'haydn' }));
  });

  it('treats a folder holding YAML as a composer, not a grouping folder', () => {
    // The obvious rule — "a composer directory has _composer.yml" — is wrong:
    // composer identity is optional, and a works-only folder is legitimate. If
    // that rule were used, this lookup would return null.
    writeLib('classical/3_baroque/telemann/tafelmusik.yml', 'title: Tafelmusik\n');
    write('classical/telemann/tafelmusik.yml',
      'work: telemann/tafelmusik\nsurround: concert-hall\nmatch: { contentId: plex:903 }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:903', '');
    expect(r.piece.title).toBe('Tafelmusik');
    expect(r.composer).toEqual({});
  });
});

describe('YamlSurroundStore multi-note movements', () => {
  // A movement's note may be a LIST. The notes fan across that movement's own
  // span rather than stacking on its downbeat, so a set of short pieces (the
  // Chopin etudes: 12 movements, one per etude) can carry several timed lines
  // each. Spans are derived from neighbouring starts, so a re-timing that
  // shifts every start moves the notes with the music.
  const lib = (movements) => writeLib('classical/beethoven/symphony-3-eroica.yml',
    `title: Symphony No. 3\nmovements:\n${movements}`);
  const side = (body) => write('classical/beethoven/symphony-3-eroica.yml',
    `work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n${body}`);
  const cues = () => new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() })
    .lookup('plex:663134', '').cues;

  it('spreads a list of notes evenly across the movement, first note on the downbeat', () => {
    lib('  - { n: 1, name: One, note: ["A", "B", "C"] }\n  - { n: 2, name: Two }\n');
    side('starts: [0, 300]\n');
    // Span 0->300 over three notes: one every 100s.
    expect(cues()).toEqual([
      { at: 0, render: 'docked', text: 'A' },
      { at: 100, render: 'docked', text: 'B' },
      { at: 200, render: 'docked', text: 'C' },
    ]);
  });

  it('keeps a single string note exactly where it was — one cue on the start', () => {
    lib('  - { n: 1, name: One }\n  - { n: 2, name: Two, note: "Second movement begins." }\n');
    side('starts: [0, 976]\n');
    expect(cues()).toEqual([{ at: 976, render: 'docked', text: 'Second movement begins.' }]);
  });

  it('bounds the final movement with musicEndsAt when the sidecar names one', () => {
    lib('  - { n: 1, name: One }\n  - { n: 2, name: Two, note: ["X", "Y"] }\n');
    side('starts: [0, 100]\nmusicEndsAt: 300\n');
    expect(cues().map((c) => c.at)).toEqual([100, 200]);
  });

  it('falls back to a fixed gap for a final movement with no known end', () => {
    lib('  - { n: 1, name: One, note: ["X", "Y", "Z"] }\n');
    side('starts: [0]\n');
    const at = cues().map((c) => c.at);
    expect(at[0]).toBe(0);
    expect(at[1] - at[0]).toBe(at[2] - at[1]);   // evenly spaced
    expect(at[1] - at[0]).toBeGreaterThan(12);   // wider than the ticker's dwell
  });

  it('drops blank and non-string entries without shifting the notes that remain', () => {
    lib('  - { n: 1, name: One, note: ["A", "   ", 42, null, "B"] }\n  - { n: 2, name: Two }\n');
    side('starts: [0, 200]\n');
    expect(cues()).toEqual([
      { at: 0, render: 'docked', text: 'A' },
      { at: 100, render: 'docked', text: 'B' },
    ]);
  });

  it('never lands two notes of one movement on the same second', () => {
    // Three notes in a two-second movement would round onto one instant, where
    // the ticker picks a single winner and the rest are never seen.
    lib('  - { n: 1, name: One, note: ["A", "B", "C"] }\n  - { n: 2, name: Two }\n');
    side('starts: [0, 2]\n');
    const at = cues().map((c) => c.at);
    expect(new Set(at).size).toBe(3);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('still sorts explicit sidecar cues in among the fanned-out notes', () => {
    lib('  - { n: 1, name: One, note: ["A", "B"] }\n  - { n: 2, name: Two }\n');
    side('starts: [0, 200]\ncues:\n  - { at: 50, render: docked, text: "Mid." }\n');
    expect(cues().map((c) => c.text)).toEqual(['A', 'Mid.', 'B']);
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
      + 'opus: Op. 55\nsegments:\n  - { n: 1, name: Allegro con brio }\n');
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
      + '  bottom:\n    - { module: segment-map, height: 60 }\n'
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
 * SEGMENT REFERENCES — a segment may name another work instead of restating it.
 *
 * The corpus already authors this: `chopin/etudes.yml` lists its three opus sets
 * as `- work: chopin/etudes-op-10` rather than copying twenty-seven études into
 * one file. A reference resolves to a SUBTREE, so the rail stays flat while
 * `group` records which part each segment arrived from.
 */
describe('YamlSurroundStore — segment references', () => {
  // The corpus files the flagship sets under an era folder; the sidecar tree
  // does not. Both shapes are exercised here because the reference key is
  // `<composer>/<slug>` at whatever depth the corpus filed the work.
  const writeChopinSet = (body) => {
    writeLib('classical/0_flagship/chopin/_composer.yml', 'name: Frédéric Chopin\n');
    writeLib('classical/0_flagship/chopin/etudes.yml', body);
    write('classical/chopin/set.yml',
      'work: chopin/etudes\nsurround: concert-hall\nmatch: { contentId: plex:set }\n');
  };

  it('resolves a segment that references another work, bringing its own segments with it', () => {
    writeLib('classical/0_flagship/chopin/_composer.yml', 'name: Frédéric Chopin\n');
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Études, Op. 10"\nsegments:\n  - { n: 1, name: "No. 1 in C major" }\n  - { n: 2, name: "No. 2 in A minor" }\n');
    writeLib('classical/0_flagship/chopin/etudes.yml',
      'title: "Études"\nsegments:\n  - work: chopin/etudes-op-10\n');
    write('classical/chopin/set.yml',
      'work: chopin/etudes\nsurround: concert-hall\nmatch: { contentId: plex:set }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:set', '');

    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]).toMatchObject({ name: 'No. 1 in C major' });
    expect(r.segments[0].group).toEqual({ work: 'chopin/etudes-op-10', title: 'Études, Op. 10', index: 0 });
  });

  it('breaks a reference cycle instead of recursing forever', () => {
    writeLib('classical/0_flagship/chopin/a.yml', 'title: A\nsegments:\n  - work: chopin/b\n');
    writeLib('classical/0_flagship/chopin/b.yml', 'title: B\nsegments:\n  - work: chopin/a\n');
    write('classical/chopin/cyc.yml',
      'work: chopin/a\nsurround: concert-hall\nmatch: { contentId: plex:cyc }\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:cyc', '')).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('surround.segment.cycle',
      expect.objectContaining({ work: 'chopin/a' }));
  });

  it('numbers groups by part, not by whatever the previous segment happened to carry', () => {
    // Three segments, and the middle one is authored inline rather than
    // referenced — the shape a container takes when a stray segment sits
    // between two published sets. The index of the SECOND reference is the
    // assertion that matters: derived from the previous segment it reads that
    // inline entry, which belongs to no part and carries no group at all.
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Op. 10"\nsegments:\n  - { n: 1, name: "Op. 10 No. 1" }\n');
    writeLib('classical/0_flagship/chopin/etudes-op-25.yml',
      'title: "Op. 25"\nsegments:\n  - { n: 1, name: "Op. 25 No. 1" }\n');
    writeChopinSet('title: "Études"\nsegments:\n  - work: chopin/etudes-op-10\n'
      + '  - { n: 0, name: "Interlude" }\n  - work: chopin/etudes-op-25\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:set', '');

    expect(r.segments.map((c) => c.name)).toEqual(['Op. 10 No. 1', 'Interlude', 'Op. 25 No. 1']);
    // The inline segment is ungrouped; the two referenced parts are 0 and 1.
    expect(r.segments.map((c) => c.group?.index)).toEqual([0, undefined, 1]);
    expect(r.segments[2].group).toEqual({ work: 'chopin/etudes-op-25', title: 'Op. 25', index: 1 });
  });

  it('breaks an INDIRECT reference cycle too (a -> b -> c -> a), not just a direct one', () => {
    // Deferred from Task 2: the direct case above (a -> b -> a) proves the
    // `seen` set catches a hop that comes straight back; this proves it also
    // catches one that takes the scenic route. Same guard, one more hop, so the
    // coverage is by ASSERTION rather than by reading `#resolveSegments` and
    // trusting the set works for N hops because it worked for one.
    writeLib('classical/0_flagship/chopin/a.yml', 'title: A\nsegments:\n  - work: chopin/b\n');
    writeLib('classical/0_flagship/chopin/b.yml', 'title: B\nsegments:\n  - work: chopin/c\n');
    writeLib('classical/0_flagship/chopin/c.yml', 'title: C\nsegments:\n  - work: chopin/a\n');
    write('classical/chopin/cyc3.yml',
      'work: chopin/a\nsurround: concert-hall\nmatch: { contentId: plex:cyc3 }\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(store.lookup('plex:cyc3', '')).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('surround.segment.cycle',
      expect.objectContaining({ work: 'chopin/a' }));
  });

  it('expands the same work twice when two segments reference it — a repeat is not a cycle', () => {
    // The guard has to unwind: a set that opens and closes with the same piece
    // is a legitimate container, and a `seen` that only ever grew would drop the
    // second appearance and warn a cycle that does not exist.
    writeLib('classical/0_flagship/chopin/nocturne.yml',
      'title: Nocturne\nsegments:\n  - { n: 1, name: Nocturne }\n');
    writeChopinSet('title: Recital\nsegments:\n  - work: chopin/nocturne\n  - work: chopin/nocturne\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:set', '');

    expect(r.segments.map((c) => c.name)).toEqual(['Nocturne', 'Nocturne']);
    expect(r.segments.map((c) => c.group.index)).toEqual([0, 1]);
    expect(logger.warn).not.toHaveBeenCalledWith('surround.segment.cycle', expect.anything());
  });

  it('warns and drops a reference to a work the corpus does not hold', () => {
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Op. 10"\nsegments:\n  - { n: 1, name: "Op. 10 No. 1" }\n');
    writeChopinSet('title: "Études"\nsegments:\n  - work: chopin/etudes-op-10\n  - work: chopin/etudes-op-99\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:set', '');

    expect(r.segments.map((c) => c.name)).toEqual(['Op. 10 No. 1']);
    expect(logger.warn).toHaveBeenCalledWith('surround.segment.missing',
      expect.objectContaining({ work: 'chopin/etudes-op-99' }));
  });

  it('follows a reference through a work that is itself a container', () => {
    // A reference resolves to a subtree, not a leaf: naming a container brings
    // everything the container names, however deep it nests.
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Op. 10"\nsegments:\n  - { n: 1, name: "Op. 10 No. 1" }\n');
    writeLib('classical/0_flagship/chopin/inner.yml',
      'title: Inner\nsegments:\n  - work: chopin/etudes-op-10\n');
    writeChopinSet('title: Outer\nsegments:\n  - work: chopin/inner\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:set', '');

    expect(r.segments.map((c) => c.name)).toEqual(['Op. 10 No. 1']);
    // The innermost part is the one that owns the segment: the rail labels a
    // segment with the work it was written in, not the container above it.
    expect(r.segments[0].group.work).toBe('chopin/etudes-op-10');
  });

  it('accepts an inline segments: list with no references in it at all', () => {
    // A work may author `segments:` as a plain list, with no `work:` entries.
    // It must time exactly as a referenced set does.
    writeChopinSet('title: "Études"\nsegments:\n  - { n: 1, name: One }\n  - { n: 2, name: Two }\n');
    write('classical/chopin/set.yml',
      'work: chopin/etudes\nsurround: concert-hall\nmatch: { contentId: plex:set }\n'
      + 'starts: [0, 60]\nmusicEndsAt: 150\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:set', '');

    expect(r.pieceSegments).toEqual([{ n: 1, name: 'One', start: 0 }, { n: 2, name: 'Two', start: 60 }]);
    expect(r.segments[1]).toMatchObject({ n: 2, name: 'Two', start: 60, end: 150, offset: 60, duration: 90 });
    expect(r.timeline.totalSounding).toBe(150);
  });

  it('leaves a work with no references in its list resolving ungrouped', () => {
    // Every corpus file that predates the reference feature takes this path. If
    // it ever stopped firing, all of them would render an empty rail — so
    // assert the Eroica payload is byte-for-byte what it was.
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');

    expect(r.pieceSegments).toEqual([{ n: 1, name: 'Allegro con brio', start: 0 }]);
    // `part` is on every segment, container or not: a lone media item is part 0
    // of a one-part rail, so nothing downstream has to special-case its absence.
    expect(r.segments).toEqual([
      { n: 1, name: 'Allegro con brio', start: 0, end: undefined, contentId: 'plex:663134', duration: 0, offset: 0, part: 0 }
    ]);
    expect('group' in r.segments[0]).toBe(false);
  });
});

describe('YamlSurroundStore — nested long-form works', () => {
  it('flattens arbitrary recursive groups while retaining the full ancestor path', () => {
    writeLib('classical/0_flagship/handel/grouped.yml',
      'title: Grouped\ngroups:\n'
      + '  - { kind: act, title: Act I, facts: ["Act fact."], groups: [{ kind: scene, title: The garden, facts: ["Scene fact."], groups: [{ kind: dance, title: Pas de deux, facts: ["Dance fact."], segments: [{ n: 1, name: Opening }] }] }] }\n');
    write('classical/handel/grouped.yml', 'work: handel/grouped\nsurround: concert-hall\nmatch: { contentId: plex:grouped }\nstarts: [0]\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const result = store.lookup('plex:grouped', '');
    expect(result.segments[0]).toMatchObject({
      n: 1,
      ancestors: [
        { kind: 'act', title: 'Act I', facts: ['Act fact.'] },
        { kind: 'scene', title: 'The garden', facts: ['Scene fact.'] },
        { kind: 'dance', title: 'Pas de deux', facts: ['Dance fact.'] },
      ],
    });
  });

  it('derives Part and Scene rail metadata from nested corpus structure', () => {
    writeLib('classical/0_flagship/handel/messiah.yml',
      'title: Messiah\nparts:\n'
      + '  - title: Part One\n'
      + '    facts: ["Part fact."]\n'
      + '    scenes:\n'
      + '      - title: Prophecy\n'
      + '        facts: ["Scene fact."]\n'
      + '        segments:\n'
      + '          - { n: 1, name: Sinfonia, heading: Instrumental, facts: ["Number fact."] }\n'
      + '          - { n: 2, name: Comfort ye }\n'
      + '      - title: Nativity\n'
      + '        segments:\n'
      + '          - { n: 3, name: Rejoice }\n'
      + '  - title: Part Two\n'
      + '    scenes:\n'
      + '      - title: Passion\n'
      + '        segments:\n'
      + '          - { n: 4, name: Behold the Lamb }\n');
    write('classical/handel/messiah.yml',
      'work: handel/messiah\nsurround: concert-hall\nmatch: { contentId: plex:messiah }\n'
      + 'starts: [0, 10, 30, 45]\nmusicEndsAt: 60\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const result = store.lookup('plex:messiah', '');

    expect(result.segments.map(({ n, group, hierarchy }) => ({ n, group, hierarchy }))).toEqual([
      { n: 1, group: { index: 0, title: 'Prophecy' }, hierarchy: { part: { index: 0, title: 'Part One' } } },
      { n: 2, group: { index: 0, title: 'Prophecy' }, hierarchy: { part: { index: 0, title: 'Part One' } } },
      { n: 3, group: { index: 1, title: 'Nativity' }, hierarchy: { part: { index: 0, title: 'Part One' } } },
      { n: 4, group: { index: 2, title: 'Passion' }, hierarchy: { part: { index: 1, title: 'Part Two' } } },
    ]);
    expect(result.segments[0]).toMatchObject({
      heading: 'Instrumental', start: 0, end: 10,
      facts: ['Number fact.'], sceneFacts: ['Scene fact.'], partFacts: ['Part fact.'],
    });
  });
});

/**
 * THE THREE NAMES THE AUTHORED LIST HAS WORN.
 *
 * `segments:` is the name. `chapters:` was the interim general form and
 * `movements:` the original, and roughly two hundred corpus files still carry
 * the original at any moment during a migration. The reader is bilingual so the
 * data may be renamed on its own schedule — the failure it exists to prevent is
 * every unmigrated file rendering an empty rail the instant the code lands.
 */
describe('YamlSurroundStore — the authored list reads under all three key names', () => {
  const eroica = (key) => writeLib('classical/beethoven/symphony-3-eroica.yml',
    `title: Symphony No. 3\n${key}:\n  - { n: 1, name: Allegro con brio }\n`);

  it.each(['segments', 'chapters', 'movements'])('reads a work authored with %s:', (key) => {
    eroica(key);
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');

    expect(r.pieceSegments).toEqual([{ n: 1, name: 'Allegro con brio', start: 0 }]);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ n: 1, name: 'Allegro con brio', part: 0 });
  });

  // FIRST NON-EMPTY WINS, in declaration order. Nothing authors two lists, but
  // "which one" must be a decision the code states rather than one YAML key
  // order happens to make — a merge would double every segment on the rail.
  it('prefers segments: over chapters: and movements: where a file carries more than one', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\n'
      + 'segments:\n  - { n: 1, name: Preferred }\n'
      + 'chapters:\n  - { n: 1, name: Interim }\n'
      + 'movements:\n  - { n: 1, name: Legacy }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');

    expect(r.segments.map((s) => s.name)).toEqual(['Preferred']);
  });

  // EVERY STEP OF THE FALL-THROUGH, not just the first and the last. The rule
  // is "first NON-EMPTY wins", and an implementation that tested presence
  // rather than emptiness, or that stopped after one hop, passes the
  // three-keys-in-isolation specs above and fails exactly here — on the
  // half-migrated file, which is the only shape a migration in flight makes.
  it.each([
    ['segments: []', 'segments: []\nchapters:\n  - { n: 1, name: Interim }\n', 'Interim'],
    ['segments: [] and chapters: []', 'segments: []\nchapters: []\nmovements:\n  - { n: 1, name: Legacy }\n', 'Legacy'],
    ['no segments: at all', 'chapters:\n  - { n: 1, name: Interim }\nmovements:\n  - { n: 1, name: Legacy }\n', 'Interim'],
    ['chapters: [] and no segments:', 'chapters: []\nmovements:\n  - { n: 1, name: Legacy }\n', 'Legacy'],
  ])('falls through %s to the next name that carries a list', (_label, body, expected) => {
    writeLib('classical/beethoven/symphony-3-eroica.yml', `title: Symphony No. 3\n${body}`);

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');

    expect(r.segments.map((s) => s.name)).toEqual([expected]);
  });

  it('falls through an empty segments: to the legacy movements: list', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments: []\nmovements:\n  - { n: 1, name: Legacy }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');

    expect(r.segments.map((s) => s.name)).toEqual(['Legacy']);
  });

  /**
   * THE OUTAGE'S SIGNATURE, MADE AUDIBLE.
   *
   * A corpus renamed to a key the running build does not read produces the one
   * fault shape that looks entirely healthy from the index: every sidecar
   * resolves, `surround.index.built` reports its usual piece count, nothing is
   * skipped, and every rail is empty. It was found on a screen. These specs are
   * what make it findable in the log store instead.
   */
  describe('an empty rail says why it is empty', () => {
    it('warns surround.segments.none, naming the key that won', () => {
      writeLib('classical/beethoven/symphony-3-eroica.yml',
        'title: Symphony No. 3\nfuturistic:\n  - { n: 1, name: Unreadable }\n');

      const logger = makeLogger();
      new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

      expect(logger.warn).toHaveBeenCalledWith('surround.segments.none', expect.objectContaining({
        file: 'classical/beethoven/symphony-3-eroica.yml',
        work: 'beethoven/symphony-3-eroica',
        // No recognised key carried a list, which is the whole message: this is
        // a work whose list is authored under a name this build does not read,
        // not a work that authored nothing.
        segmentKey: null,
        parts: 0,
      }));
    });

    it('names the key that DID win, so a half-migrated corpus is legible', () => {
      writeLib('classical/beethoven/symphony-3-eroica.yml',
        'title: Symphony No. 3\nmovements:\n  - { n: 1, name: Legacy }\n');

      const logger = makeLogger();
      new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

      expect(logger.info).toHaveBeenCalledWith('surround.index.built', expect.objectContaining({
        segmentKeys: { movements: 1 },
        empty: 0,
      }));
    });

    it('counts the whole-corpus-blank shape on surround.index.built', () => {
      writeLib('classical/beethoven/symphony-3-eroica.yml', 'title: Symphony No. 3\nfuturistic: []\n');

      const logger = makeLogger();
      new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

      // `pieces` stays at its normal number — that is what made this invisible.
      // `empty` and `segmentKeys.none` are what say the rail is dark.
      expect(logger.info).toHaveBeenCalledWith('surround.index.built', expect.objectContaining({
        pieces: 1, skipped: 0, empty: 1, segmentKeys: { none: 1 },
      }));
    });

    it('stays quiet for a piece whose rail actually has segments', () => {
      const logger = makeLogger();
      new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

      expect(logger.warn).not.toHaveBeenCalledWith('surround.segments.none', expect.anything());
    });
  });

  // The corpus visibility warning has to cover every name the key can take, or
  // a legacy file with a mapping where a list belongs goes back to being
  // invisible — an empty rail and nothing in the log store to explain it.
  it.each(['segments', 'chapters', 'movements'])('warns surround.work.invalid for a non-list %s:', (key) => {
    writeLib('classical/beethoven/symphony-3-eroica.yml', `title: Symphony No. 3\n${key}: { n: 1 }\n`);
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

    expect(logger.warn).toHaveBeenCalledWith('surround.work.invalid',
      expect.objectContaining({ reason: `${key}-not-a-list` }));
  });
});

/**
 * PARTS — one rail, several media items.
 *
 * A container's `parts` name contentIds, not timings. Each part is an ordinary
 * sidecar that already resolves and plays standalone; the container looks each
 * one up among the pieces the walk resolved and concatenates what it found. The
 * segments keep their own media item's `start`/`end` and are laid back onto ONE
 * sounding rail, which is what lets a single frame span three étude episodes.
 */
describe('YamlSurroundStore — parts composed by contentId', () => {
  // Three sidecars that each resolve alone, plus the container that names them.
  // Op. 10 stands for the real twelve; the shape is what is under test.
  const writeEtudes = (containerBody) => {
    writeLib('classical/0_flagship/chopin/_composer.yml', 'name: Frédéric Chopin\n');
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Études, Op. 10"\nsegments:\n  - { n: 1, name: "Op. 10 No. 1" }\n  - { n: 2, name: "Op. 10 No. 2" }\n');
    writeLib('classical/0_flagship/chopin/etudes-op-25.yml',
      'title: "Études, Op. 25"\nsegments:\n  - { n: 1, name: "Op. 25 No. 1" }\n');
    writeLib('classical/0_flagship/chopin/etudes.yml',
      'title: "Études"\nsegments:\n  - work: chopin/etudes-op-10\n  - work: chopin/etudes-op-25\n');
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

  it('concatenates the parts’ own segments onto one sounding rail', () => {
    writeEtudes(SEASON);
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    // start/end stay in each part's OWN media clock — ep2's first segment starts
    // at 5 seconds into ep2, not 5 seconds into the season. Only `offset` is
    // global, and it is the whole reason composition cannot be a concatenation
    // of already-placed segments: MUTATION PROOF — drop the withOffsets call in
    // #composeContainers and ep2's segment keeps its standalone offset of 0
    // instead of 300, so the rail draws it on top of Op. 10 No. 1.
    expect(r.segments.map((c) => [c.name, c.contentId, c.start, c.offset, c.duration])).toEqual([
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

  /**
   * `short:` — the crowded-rail form of a segment's name. Segment-level fields
   * are not allowlisted (only work-level ones are), so this asks the question
   * that matters for a new one: does it survive BOTH hops — the work's own
   * resolution, and the container's concatenation, which rebuilds every segment
   * object twice on its way to the rail.
   */
  it('carries an authored `short` label through to the composed rail', () => {
    writeEtudes(SEASON);
    writeLib('classical/0_flagship/chopin/etudes-op-25.yml',
      'title: "Études, Op. 25"\nsegments:\n  - { n: 1, name: "Op. 25 No. 1", short: "Aeolian" }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });

    expect(store.lookup('plex:season', '').segments[2].short).toBe('Aeolian');
    // And on the part played on its own, which is the same list one hop shorter.
    expect(store.lookup('plex:ep2', '').segments[0].short).toBe('Aeolian');
    expect(store.lookup('plex:ep2', '').pieceSegments[0].short).toBe('Aeolian');
  });

  /**
   * THREE LEVELS: a work whose segments reference works that themselves
   * reference works — Messiah's Part, Scene, Number.
   *
   * `#resolveSegments` already recurses to any depth, but `group` is ONE object
   * and the inner call overwrites it, so a segment three levels down kept only
   * its Scene and the Part was silently lost. `groupPath` carries the whole
   * chain, outermost first, while `group` stays the innermost so every existing
   * consumer reads exactly what it read before.
   */
  it('carries the whole ancestry when a work nests two levels deep', () => {
    writeLib('classical/0_flagship/handel/_composer.yml', 'name: George Frideric Handel\n');
    writeLib('classical/0_flagship/handel/scene-1.yml',
      'title: "Scene 1"\nsegments:\n  - { n: 1, name: "First" }\n  - { n: 2, name: "Second" }\n');
    writeLib('classical/0_flagship/handel/scene-2.yml',
      'title: "Scene 2"\nsegments:\n  - { n: 3, name: "Third" }\n');
    writeLib('classical/0_flagship/handel/part-1.yml',
      'title: "Part One"\nsegments:\n  - work: handel/scene-1\n  - work: handel/scene-2\n');
    writeLib('classical/0_flagship/handel/whole.yml',
      'title: "The Whole Thing"\nsegments:\n  - work: handel/part-1\n');
    write('classical/handel/whole.yml',
      'work: handel/whole\nsurround: concert-hall\nmatch: { contentId: plex:whole }\n'
      + 'starts: [0, 60, 120]\nmusicEndsAt: 180\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:whole', '');

    expect(r.segments.map((c) => c.name)).toEqual(['First', 'Second', 'Third']);
    // `group` is the INNERMOST — unchanged, so nothing downstream shifts.
    expect(r.segments[0].group.title).toBe('Scene 1');
    expect(r.segments[2].group.title).toBe('Scene 2');
    // `groupPath` is the ancestry, outermost first.
    expect(r.segments[0].groupPath.map((g) => g.title)).toEqual(['Part One', 'Scene 1']);
    expect(r.segments[2].groupPath.map((g) => g.title)).toEqual(['Part One', 'Scene 2']);
    // Both segments of Scene 1 share one Part and one Scene.
    expect(r.segments[0].groupPath[0]).toEqual(r.segments[1].groupPath[0]);
    expect(r.segments[0].groupPath[1]).toEqual(r.segments[1].groupPath[1]);
  });

  it('still gives a one-level work a single-entry ancestry', () => {
    writeEtudes(SEASON);
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:ep1', '');
    // A part played on its own has no group at all, and no path either.
    expect(r.segments[0].groupPath ?? null).toBeNull();
  });

  it('labels each part with the work that part plays, not the container above it', () => {
    writeEtudes(SEASON);
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    expect(r.segments.map((c) => c.part)).toEqual([0, 0, 1]);
    expect(r.segments[0].group).toEqual({ work: 'chopin/etudes-op-10', title: 'Études, Op. 10', index: 0 });
    expect(r.segments[2].group).toEqual({ work: 'chopin/etudes-op-25', title: 'Études, Op. 25', index: 1 });
    // The container's own piece block still comes from its own work.
    expect(r.piece.title).toBe('Études');
  });

  /**
   * THE FACTS OF THE WORKS A CONTAINER PLAYS, by slug — the middle rung of the
   * band's precedence (`frontend/src/modules/Surround/segments.js`, `factPool`).
   * Without them the polonaise season can only ever print the facts about the
   * SET while one polonaise is sounding, and the facts that work authored about
   * itself reach no screen at all.
   *
   * MUTATION PROOF: drop the assignment in `#referencedSegments` and this reads
   *   expected {} to deeply equal { 'chopin/etudes-op-10': [ 'Liszt.' ], … }
   */
  it('publishes each part work’s own facts, keyed by the slug its segments carry', () => {
    writeLib('classical/0_flagship/chopin/_composer.yml', 'name: Frédéric Chopin\n');
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Études, Op. 10"\nfacts:\n  - Liszt.\n  - Unplayable.\n'
      + 'segments:\n  - { n: 1, name: "Op. 10 No. 1" }\n');
    writeLib('classical/0_flagship/chopin/etudes-op-25.yml',
      'title: "Études, Op. 25"\nsegments:\n  - { n: 1, name: "Op. 25 No. 1" }\n');
    writeLib('classical/0_flagship/chopin/etudes.yml',
      'title: "Études"\nfacts:\n  - About the set.\n'
      + 'segments:\n  - work: chopin/etudes-op-10\n  - work: chopin/etudes-op-25\n');
    write('classical/chopin/etudes-op-10.yml',
      'work: chopin/etudes-op-10\nsurround: concert-hall\nmatch: { contentId: plex:ep1 }\n'
      + 'starts: [0]\nmusicEndsAt: 100\n');
    write('classical/chopin/etudes-op-25.yml',
      'work: chopin/etudes-op-25\nsurround: concert-hall\nmatch: { contentId: plex:ep2 }\n'
      + 'starts: [0]\nmusicEndsAt: 40\n');
    write('classical/chopin/etudes.season.yml', SEASON);
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    // The key is the slug the SEGMENTS are stamped with, so the frontend joins
    // on a value it already has.
    expect(r.segments[0].group.work).toBe('chopin/etudes-op-10');
    expect(r.groupFacts).toEqual({ 'chopin/etudes-op-10': ['Liszt.', 'Unplayable.'] });
    // A part that authored no facts gets no entry — an absence and an empty
    // list mean the same thing to the band, and an empty array on the wire is a
    // claim the corpus never made.
    expect(Object.keys(r.groupFacts)).not.toContain('chopin/etudes-op-25');
    // ...and the container's own facts are untouched beside them.
    expect(r.facts).toEqual(['About the set.']);
  });

  /** A piece that composes nothing still has the key, so the shape never moves. */
  it('gives a single work an empty groupFacts rather than none', () => {
    writeLib('classical/0_flagship/chopin/etudes-op-10.yml',
      'title: "Études, Op. 10"\nfacts:\n  - Liszt.\nsegments:\n  - { n: 1, name: "Op. 10 No. 1" }\n');
    write('classical/chopin/etudes-op-10.yml',
      'work: chopin/etudes-op-10\nsurround: concert-hall\nmatch: { contentId: plex:ep1 }\n'
      + 'starts: [0]\nmusicEndsAt: 100\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:ep1', '').groupFacts).toEqual({});
  });

  it('numbers groups by their position on the composed rail, not on whatever produced them', () => {
    // NO NESTING HERE — two perfectly ordinary part sidecars. Each one's own
    // corpus work uses a segment reference, and `#resolveSegments` counts parts
    // with a counter that is fresh per call, so both parts arrive carrying
    // `group.index: 0`. The band groups the rail by that index, so two
    // different works would print under one heading.
    writeLib('classical/0_flagship/chopin/leaf-a.yml', 'title: Leaf A\nsegments:\n  - { n: 1, name: Alpha }\n');
    writeLib('classical/0_flagship/chopin/leaf-b.yml', 'title: Leaf B\nsegments:\n  - { n: 1, name: Beta }\n');
    writeLib('classical/0_flagship/chopin/disc-one.yml', 'title: Disc One\nsegments:\n  - work: chopin/leaf-a\n');
    writeLib('classical/0_flagship/chopin/disc-two.yml', 'title: Disc Two\nsegments:\n  - work: chopin/leaf-b\n');
    writeLib('classical/0_flagship/chopin/season.yml',
      'title: Season\nsegments:\n  - work: chopin/disc-one\n  - work: chopin/disc-two\n');
    write('classical/chopin/ep1.yml',
      'work: chopin/disc-one\nsurround: concert-hall\nmatch: { contentId: plex:ep1 }\nstarts: [0]\nmusicEndsAt: 60\n');
    write('classical/chopin/ep2.yml',
      'work: chopin/disc-two\nsurround: concert-hall\nmatch: { contentId: plex:ep2 }\nstarts: [0]\nmusicEndsAt: 90\n');
    write('classical/chopin/season.yml',
      'work: chopin/season\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - plex:ep1\n  - plex:ep2\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    // Both parts kept the inner label their own work gave them — that is right,
    // it is more specific than the disc — but the NUMBER is the rail's to give.
    // MUTATION PROOF — drop the #renumberGroups call in #composeOne and these
    // read [0, 0]: two headings collapse into one over two different works.
    expect(r.segments.map((c) => [c.name, c.group.work, c.group.index])).toEqual([
      ['Alpha', 'chopin/leaf-a', 0],
      ['Beta', 'chopin/leaf-b', 1]
    ]);
  });

  it('gives a work played by two consecutive parts two headings, not one', () => {
    // Runs are detected by group identity, not by work slug. A set played twice
    // is two appearances — the same rule #resolveSegments follows when one
    // container names one work twice — so collapsing on the work would erase
    // the second disc's heading.
    writeLib('classical/0_flagship/chopin/leaf.yml', 'title: Leaf\nsegments:\n  - { n: 1, name: Solo }\n');
    writeLib('classical/0_flagship/chopin/set.yml', 'title: Set\nsegments:\n  - work: chopin/leaf\n');
    write('classical/chopin/ep1.yml',
      'work: chopin/leaf\nsurround: concert-hall\nmatch: { contentId: plex:ep1 }\nstarts: [0]\nmusicEndsAt: 60\n');
    write('classical/chopin/ep2.yml',
      'work: chopin/leaf\nsurround: concert-hall\nmatch: { contentId: plex:ep2 }\nstarts: [0]\nmusicEndsAt: 90\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - plex:ep1\n  - plex:ep2\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');
    expect(r.segments.map((c) => [c.contentId, c.group.work, c.group.index])).toEqual([
      ['plex:ep1', 'chopin/leaf', 0],
      ['plex:ep2', 'chopin/leaf', 1]
    ]);
  });

  it('composes a part whose sidecar the walk has not reached yet', () => {
    // The container sorts before its parts here (`a-season` < `z-part`), so a
    // store that composed while resolving a single file would find nothing.
    writeLib('classical/0_flagship/chopin/one.yml', 'title: One\nsegments:\n  - { n: 1, name: Solo }\n');
    writeLib('classical/0_flagship/chopin/set.yml', 'title: Set\nsegments:\n  - work: chopin/one\n');
    write('classical/chopin/a-season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:late }\nparts:\n  - plex:z\n');
    write('classical/chopin/z-part.yml',
      'work: chopin/one\nsurround: concert-hall\nmatch: { contentId: plex:z }\nstarts: [0]\nmusicEndsAt: 60\n');

    // Assert the premise the test rests on. `listYamlFiles` does not sort — it
    // hands back `readdirSync` order, which is filesystem-dependent — so on a
    // filesystem that returned these the other way round this test would go
    // VACUOUS rather than red, quietly proving nothing at all.
    expect(listYamlFiles(path.join(root, 'classical/chopin'), { stripExtension: false }))
      .toEqual(['a-season.yml', 'z-part.yml']);

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:late', '');
    expect(r.segments.map((c) => [c.name, c.contentId, c.duration])).toEqual([['Solo', 'plex:z', 60]]);
  });

  it('warns surround.part.missing and keeps the rest of the rail', () => {
    // MUTATION PROOF — make the missing part fault the whole container (return
    // early, or push a placeholder slot) and the two surviving segments vanish
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
    expect(r.segments.map((c) => c.name)).toEqual(['Op. 10 No. 1', 'Op. 10 No. 2', 'Op. 25 No. 1']);
    // Surviving parts are numbered densely, so timeline.parts[c.part] is always
    // the slot that segment's sounding belongs to.
    expect(r.segments.map((c) => c.part)).toEqual([0, 0, 1]);
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
    expect(r.segments.map((c) => c.contentId)).toEqual(['plex:ep2']);
  });

  it('leaves each part still playable on its own', () => {
    // The parts are not consumed by the container: they are ordinary sidecars
    // and their own frames are exactly what they were before it existed.
    writeEtudes(SEASON);
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:ep2', '');

    expect(r.piece.title).toBe('Études, Op. 25');
    expect(r.segments).toEqual([
      { n: 1, name: 'Op. 25 No. 1', start: 5, end: 45, contentId: 'plex:ep2', duration: 40, offset: 0, part: 0 }
    ]);
    expect(r.timeline).toEqual({ totalSounding: 40, parts: [{ contentId: 'plex:ep2', index: 0, sounding: 40 }] });
  });
});

describe('YamlSurroundStore.lookupByPart', () => {
  const writeSeason = () => {
    writeLib('classical/0_flagship/chopin/one.yml', 'title: One\nsegments:\n  - { n: 1, name: Solo }\n');
    writeLib('classical/0_flagship/chopin/set.yml', 'title: Set\nsegments:\n  - work: chopin/one\n');
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
 * own timings, part by part, against the segments its work already resolves.
 */
describe('YamlSurroundStore — parts timed inline', () => {
  it('places each part’s segments in its own media item', () => {
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nsegments:\n  - { n: 1, name: "One" }\n  - { n: 2, name: "Two" }\n');
    writeLib('classical/0_flagship/chopin/p2.yml', 'title: P2\nsegments:\n  - { n: 1, name: "Three" }\n');
    writeLib('classical/0_flagship/chopin/set.yml',
      'title: Set\nsegments:\n  - work: chopin/p1\n  - work: chopin/p2\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - { work: chopin/p1, contentId: plex:ep1, spans: [[0, 10], [20, 35]] }\n'
      + '  - { work: chopin/p2, contentId: plex:ep2 }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    expect(r.segments.map((c) => [c.name, c.contentId, c.offset, c.duration])).toEqual([
      ['One', 'plex:ep1', 0, 10], ['Two', 'plex:ep1', 10, 15], ['Three', 'plex:ep2', 25, 0]
    ]);
    expect(r.timeline.parts).toEqual([
      { contentId: 'plex:ep1', index: 0, sounding: 25 },
      { contentId: 'plex:ep2', index: 1, sounding: 0 }
    ]);
  });

  it('warns when a part times a different number of segments than its work has', () => {
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nsegments:\n  - { n: 1, name: "One" }\n  - { n: 2, name: "Two" }\n');
    writeLib('classical/0_flagship/chopin/set.yml', 'title: Set\nsegments:\n  - work: chopin/p1\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:s2 }\n'
      + 'parts:\n  - { work: chopin/p1, contentId: plex:ep1, spans: [[0, 10]] }\n');

    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).toHaveBeenCalledWith('surround.spans.mismatch',
      expect.objectContaining({ work: 'chopin/p1', spans: 1, segments: 2 }));
  });

  it('pairs a miscounted part’s spans with its OWN segments, not the flat list', () => {
    // The reason the inline path groups by work first. Part 1 times one span for
    // a two-segment work; if spans were consumed off the flat resolved list,
    // part 2's span would be eaten as part 1's second segment and every later
    // timing would slide by one.
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nsegments:\n  - { n: 1, name: One }\n  - { n: 2, name: Two }\n');
    writeLib('classical/0_flagship/chopin/p2.yml', 'title: P2\nsegments:\n  - { n: 1, name: Three }\n');
    writeLib('classical/0_flagship/chopin/set.yml',
      'title: Set\nsegments:\n  - work: chopin/p1\n  - work: chopin/p2\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - { work: chopin/p1, contentId: plex:ep1, spans: [[0, 10]] }\n'
      + '  - { work: chopin/p2, contentId: plex:ep2, spans: [[0, 90]] }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    expect(r.segments.map((c) => [c.name, c.contentId, c.duration])).toEqual([
      ['One', 'plex:ep1', 10], ['Two', 'plex:ep1', 0], ['Three', 'plex:ep2', 90]
    ]);
  });

  it('carries a part’s performance credit onto its own segments only', () => {
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nsegments:\n  - { n: 1, name: One }\n');
    writeLib('classical/0_flagship/chopin/p2.yml', 'title: P2\nsegments:\n  - { n: 1, name: Two }\n');
    writeLib('classical/0_flagship/chopin/set.yml',
      'title: Set\nsegments:\n  - work: chopin/p1\n  - work: chopin/p2\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - { work: chopin/p1, contentId: plex:ep1, performance: Lortie }\n'
      + '  - { work: chopin/p2, contentId: plex:ep2 }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');
    expect(r.segments.map((c) => c.performance)).toEqual(['Lortie', undefined]);
  });

  it('judges each entry on its own merits in a mixed list', () => {
    // One entry authored as an inline mapping used to demote the WHOLE list to
    // the inline path, where a bare contentId beside it matched no work
    // (grouped under null) and inherited the container's own id. A third of the
    // rail vanished and a phantom part pointed at the unplayable season.
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nsegments:\n  - { n: 1, name: One }\n');
    writeLib('classical/0_flagship/chopin/p2.yml', 'title: P2\nsegments:\n  - { n: 1, name: Two }\n');
    writeLib('classical/0_flagship/chopin/set.yml',
      'title: Set\nsegments:\n  - work: chopin/p1\n  - work: chopin/p2\n');
    write('classical/chopin/ep1.yml',
      'work: chopin/p1\nsurround: concert-hall\nmatch: { contentId: plex:ep1 }\nstarts: [0]\nmusicEndsAt: 30\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - plex:ep1\n  - { work: chopin/p2, contentId: plex:ep2, spans: [[0, 90]] }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:season', '');

    // The reference entry keeps its own sidecar's timing; the inline entry keeps
    // its authored span. Neither is stamped with the season's id.
    expect(r.segments.map((c) => [c.name, c.contentId, c.offset, c.duration])).toEqual([
      ['One', 'plex:ep1', 0, 30], ['Two', 'plex:ep2', 30, 90]
    ]);
    expect(r.timeline.parts).toEqual([
      { contentId: 'plex:ep1', index: 0, sounding: 30 },
      { contentId: 'plex:ep2', index: 1, sounding: 90 }
    ]);
    // Nothing on the rail claims the container itself — Task 4 expands these
    // into a queue, and the season is not a playable media item.
    expect(r.timeline.parts.map((p) => p.contentId)).not.toContain('plex:season');
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
    expect(store.lookup('plex:663134', '').segments).toHaveLength(1);
  });
});

/**
 * NESTING IS REFUSED — a part may not itself be a container.
 *
 * Composition runs in walk order over the resolved set, so an inner container
 * may still hold its provisional empty rail when an outer one reads it: the
 * same data composed or silently emptied depending on how the two files sorted.
 * The refusal is deliberate rather than an ordering fix — see the reasoning on
 * #referencedSegments. What matters here is that the outcome no longer depends
 * on the filename.
 */
describe('YamlSurroundStore — nested containers', () => {
  // Same fixture twice, differing only in which file sorts first.
  const nest = (outerFile, innerFile) => {
    writeLib('classical/0_flagship/chopin/one.yml', 'title: One\nsegments:\n  - { n: 1, name: Solo }\n');
    writeLib('classical/0_flagship/chopin/disc.yml', 'title: Disc\nsegments:\n  - work: chopin/one\n');
    writeLib('classical/0_flagship/chopin/season.yml', 'title: Season\nsegments:\n  - work: chopin/disc\n');
    write('classical/chopin/leaf.yml',
      'work: chopin/one\nsurround: concert-hall\nmatch: { contentId: plex:leaf }\nstarts: [0]\nmusicEndsAt: 60\n');
    write(`classical/chopin/${innerFile}`,
      'work: chopin/disc\nsurround: concert-hall\nmatch: { contentId: plex:inner }\nparts:\n  - plex:leaf\n');
    write(`classical/chopin/${outerFile}`,
      'work: chopin/season\nsurround: concert-hall\nmatch: { contentId: plex:outer }\nparts:\n  - plex:inner\n');
  };

  it.each([
    ['outer first', 'a-outer.yml', 'z-inner.yml'],
    ['inner first', 'z-outer.yml', 'a-inner.yml']
  ])('refuses a container as a part, and says so — %s', (_label, outerFile, innerFile) => {
    nest(outerFile, innerFile);
    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    const r = store.lookup('plex:outer', '');

    // MUTATION PROOF — delete the `if (part.parts)` guard in
    // #referencedSegments and this splits by filename: 'inner first' composes
    // one segment with totalSounding 60, 'outer first' yields an empty rail
    // with a phantom part slot and NO warning at all. That silent, sort-order
    // dependent split is exactly what the refusal exists to remove.
    expect(r.segments).toEqual([]);
    expect(r.timeline).toEqual({ totalSounding: 0, parts: [] });
    expect(logger.warn).toHaveBeenCalledWith('surround.part.nested',
      expect.objectContaining({ contentId: 'plex:inner', index: 0, partFile: `classical/chopin/${innerFile}` }));
  });

  it('leaves the inner container itself composing normally', () => {
    // Refusing the nesting must not damage the inner rail: it is a perfectly
    // good one-part container and still plays on its own.
    nest('a-outer.yml', 'z-inner.yml');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:inner', '');
    expect(r.segments.map((c) => [c.name, c.contentId, c.duration])).toEqual([['Solo', 'plex:leaf', 60]]);
  });

  it('keeps the parts either side of a refused one', () => {
    nest('a-outer.yml', 'z-inner.yml');
    write('classical/chopin/a-outer.yml',
      'work: chopin/season\nsurround: concert-hall\nmatch: { contentId: plex:outer }\n'
      + 'parts:\n  - plex:leaf\n  - plex:inner\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:outer', '');
    expect(r.segments.map((c) => c.contentId)).toEqual(['plex:leaf']);
    expect(r.timeline.parts).toEqual([{ contentId: 'plex:leaf', index: 0, sounding: 60 }]);
  });
});

describe('YamlSurroundStore — composition isolation and claims', () => {
  const twoContainers = () => {
    writeLib('classical/0_flagship/chopin/one.yml', 'title: One\nsegments:\n  - { n: 1, name: Solo }\n');
    writeLib('classical/0_flagship/chopin/set.yml', 'title: Set\nsegments:\n  - work: chopin/one\n');
    write('classical/chopin/leaf.yml',
      'work: chopin/one\nsurround: concert-hall\nmatch: { contentId: plex:leaf }\nstarts: [0]\nmusicEndsAt: 60\n');
    write('classical/chopin/a-broken.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:broken }\nparts:\n  - plex:gone\n');
    write('classical/chopin/z-good.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:good }\nparts:\n  - plex:leaf\n');
  };

  it('lets one container throw without emptying every container after it', () => {
    // A logger that throws on the missing-part warn stands in for any fault
    // inside one container's composition. The guard used to wrap the whole
    // pass, so the FIRST container to throw silently emptied the rail of every
    // container after it — the silent-partial-index shape this subsystem has
    // already been bitten by once.
    twoContainers();
    const logger = makeLogger();
    logger.warn.mockImplementation((event) => {
      if (event === 'surround.part.missing') throw new Error('logger exploded');
    });
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });

    expect(store.lookup('plex:broken', '').segments).toEqual([]);
    expect(store.lookup('plex:good', '').segments.map((c) => c.contentId)).toEqual(['plex:leaf']);
    expect(store.lookup('plex:good', '').timeline.totalSounding).toBe(60);
  });

  it('names both files when two containers claim the same part', () => {
    twoContainers();
    write('classical/chopin/a-broken.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:rival }\nparts:\n  - plex:leaf\n');

    const logger = makeLogger();
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).toHaveBeenCalledWith('surround.part.claimed', {
      contentId: 'plex:leaf',
      keptFile: 'classical/chopin/z-good.yml',
      droppedFile: 'classical/chopin/a-broken.yml'
    });
    // Still deterministic — last walk order wins, and it is now on the record.
    expect(store.lookupByPart('plex:leaf').payload.piece.title).toBe('Set');
  });

  it('does not cry claimed when a part belongs to exactly one container', () => {
    twoContainers();
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).not.toHaveBeenCalledWith('surround.part.claimed', expect.anything());
  });

  it('carries a performance credit authored on a reference-form part', () => {
    // `{ contentId, performance }` names no work and no spans, so it is a
    // reference — and the credit has to survive composition, because the
    // inline form honours the identical key.
    twoContainers();
    write('classical/chopin/z-good.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:good }\n'
      + 'parts:\n  - { contentId: plex:leaf, performance: Lortie }\n');

    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:good', '');
    expect(r.segments.map((c) => [c.contentId, c.performance])).toEqual([['plex:leaf', 'Lortie']]);
  });
});

/**
 * UNTIMED SEGMENTS — the successor to the container's spans.mismatch signal.
 *
 * A segment with no usable end occupies no width. That is correct (dead time is
 * not on the rail) and, for a single item's LAST segment, it is the normal
 * authored shorthand for "runs to the end of the file". In a container it is a
 * gap Task 10 has yet to fill, and it lands at a part boundary.
 */
describe('YamlSurroundStore — untimed segments', () => {
  it('warns for a container, naming the count and the parts', () => {
    writeLib('classical/0_flagship/chopin/one.yml', 'title: One\nsegments:\n  - { n: 1, name: Solo }\n');
    writeLib('classical/0_flagship/chopin/two.yml', 'title: Two\nsegments:\n  - { n: 1, name: Duo }\n');
    writeLib('classical/0_flagship/chopin/set.yml',
      'title: Set\nsegments:\n  - work: chopin/one\n  - work: chopin/two\n');
    // Neither part authors musicEndsAt, so each contributes one untimed segment
    // — exactly the live étude shape.
    write('classical/chopin/ep1.yml',
      'work: chopin/one\nsurround: concert-hall\nmatch: { contentId: plex:ep1 }\nstarts: [0]\n');
    write('classical/chopin/ep2.yml',
      'work: chopin/two\nsurround: concert-hall\nmatch: { contentId: plex:ep2 }\nstarts: [0]\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n'
      + 'parts:\n  - plex:ep1\n  - plex:ep2\n');

    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).toHaveBeenCalledWith('surround.segments.untimed',
      expect.objectContaining({
        file: 'classical/chopin/season.yml',
        untimed: 2,
        segments: 2,
        parts: ['plex:ep1', 'plex:ep2']
      }));
  });

  it('stays quiet for a single item whose only gap is its final bound', () => {
    // Eight of the nineteen authored pieces are in this state. Warning about
    // all of them would bury the cases that matter.
    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).not.toHaveBeenCalledWith('surround.segments.untimed', expect.anything());
  });

  it('warns for a piece whose timings were never authored at all', () => {
    writeLib('classical/beethoven/symphony-3-eroica.yml',
      'title: Symphony No. 3\nsegments:\n  - { n: 1, name: One }\n  - { n: 2, name: Two }\n  - { n: 3, name: Three }\n');
    write('classical/beethoven/symphony-3-eroica.yml',
      'work: beethoven/symphony-3-eroica\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n');

    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).toHaveBeenCalledWith('surround.segments.untimed',
      expect.objectContaining({ file: 'classical/beethoven/symphony-3-eroica.yml', untimed: 3, segments: 3 }));
  });
});
