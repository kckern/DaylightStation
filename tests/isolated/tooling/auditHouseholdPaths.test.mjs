import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWriterReaderSplits, extractPathSites } from '../../../scripts/audit-household-paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('findWriterReaderSplits', () => {
  it('flags a subpath written in one place and read from another root', () => {
    const sites = [
      { file: 'a.mjs', line: 1, subpath: 'history/piano', mode: 'write' },
      { file: 'b.mjs', line: 2, subpath: 'piano/log', mode: 'read' },
    ];
    // Same domain ('piano'), disjoint write/read subpaths — the exact 2026-08-16 split.
    const splits = findWriterReaderSplits(sites);
    expect(splits.map(s => s.subpath).sort()).toEqual(['history/piano', 'piano/log']);
  });

  it('stays quiet when writer and reader agree', () => {
    const sites = [
      { file: 'a.mjs', line: 1, subpath: 'piano/log', mode: 'write' },
      { file: 'b.mjs', line: 2, subpath: 'piano/log', mode: 'read' },
    ];
    expect(findWriterReaderSplits(sites)).toEqual([]);
  });

  it('stays quiet for a write-only trail with no reader at all', () => {
    // barcode/log and pressure-mats/log are legitimately write-only.
    const sites = [{ file: 'a.mjs', line: 1, subpath: 'barcode/log', mode: 'write' }];
    expect(findWriterReaderSplits(sites)).toEqual([]);
  });

  it('stays quiet for a read-only tree with no writer', () => {
    const sites = [{ file: 'a.mjs', line: 1, subpath: 'config/devices', mode: 'read' }];
    expect(findWriterReaderSplits(sites)).toEqual([]);
  });
});

describe('extractPathSites', () => {
  // Code review finding: the guard was blind to two of the four path shapes
  // named in the migration plan's Global Constraints — getHouseholdPath(path.join(...))
  // (how YamlPianoStudioDatastore's producer-pool dir is built) and template-literal
  // arguments (how DataServicePianoGameRepository writes gaming/log). Both are real,
  // present-day sites, not hypotheticals.

  it('extracts a path.join(...) argument, stopping at the first non-literal segment', () => {
    // Mirrors YamlPianoStudioDatastore.mjs:76 — `family` is a variable, not a
    // literal, so only the two leading quoted segments should survive.
    const src = "return this.#configService.getHouseholdPath(path.join('piano', 'producer', family));";
    const { paths } = extractPathSites('YamlPianoStudioDatastore.mjs', src);
    expect(paths.has('piano/producer')).toBe(true);
  });

  it('carries read/write mode through a path.join(...) argument', () => {
    const src = "const data = this.dataService.household.read(path.join('piano', 'producer', family));";
    const { sites } = extractPathSites('x.mjs', src);
    expect(sites).toEqual([{ file: 'x.mjs', line: 1, subpath: 'piano/producer', mode: 'read' }]);
  });

  it('extracts a template-literal argument, truncating at the first interpolation', () => {
    // Mirrors DataServicePianoGameRepository.mjs:97-98 — the leaf (gameId/day/
    // userSegment/timestamp) is dynamic, but the domain ('gaming') and the
    // write intent are both statically knowable from the literal prefix.
    const src = 'return this.dataService.household.write(\n'
      + '  `gaming/log/${gameId}/${day}/${userSegment}-${Date.now()}.yml`, stamp(record, "archived_at"),\n'
      + ');';
    const { sites } = extractPathSites('DataServicePianoGameRepository.mjs', src);
    // Line points at where the match starts — the `household.write(` call on
    // line 1 — not the template literal's own line 2. Consistent with every
    // other site: the "location" is the call expression, not the argument.
    expect(sites).toEqual([{ file: 'DataServicePianoGameRepository.mjs', line: 1, subpath: 'gaming/log', mode: 'write' }]);
  });

  it('drops a template literal that interpolates before any literal segment', () => {
    // `${HISTORY_PREFIX}/${date}` has no literal prefix at all — nothing to
    // extract, and it must not be reported as touching the empty-string domain.
    const src = 'this.#dataService.household.read(`${HISTORY_PREFIX}/${date}`, this.#householdId);';
    const { paths, sites } = extractPathSites('x.mjs', src);
    expect(paths.size).toBe(0);
    expect(sites).toEqual([]);
  });

  it('reports the true original line for a site preceded by comments', () => {
    // Reproduces the reviewer's finding verbatim: WeatherFeedAdapter.mjs:38 is
    // `household.read('weather/current')`, preceded by 6 lines of leading
    // comments (a line comment pair + a 4-line block comment). Before the fix,
    // stripComments deleted those lines outright and the reported line drifted
    // down to 1.
    const src = [
      '// comment line 1',
      '// comment line 2',
      '/**',
      ' * block comment',
      ' * spanning multiple lines',
      ' */',
      "const data = this.#dataService.household.read('weather/current');",
    ].join('\n');
    const { sites } = extractPathSites('WeatherFeedAdapter.mjs', src);
    expect(sites).toEqual([{ file: 'WeatherFeedAdapter.mjs', line: 7, subpath: 'weather/current', mode: 'read' }]);
  });
});

// I1 (final-review fix wave, 2026-08-16): the guard was blind to
// `dataService.content.read/write(...)` — Task 10's accessor for the OTHER
// top-level committable-contract root this plan created (data/content/,
// sibling to household/). No PATTERN matched it, so a writer/reader split
// inside content/ would have gone undetected just like history/piano vs
// piano/log did for household/ before that fix.
describe('extractPathSites — content scope (DataService#content)', () => {
  it('extracts a literal-string dataService.content.read(...) argument with read mode', () => {
    const src = "return this.#dataService.content.read('lists/queries/komga');";
    const { sites } = extractPathSites('YamlTocCacheDatastore.mjs', src);
    expect(sites).toEqual([{ file: 'YamlTocCacheDatastore.mjs', line: 1, subpath: 'lists/queries/komga', mode: 'read' }]);
  });

  it('extracts a template-literal dataService.content.write(...) argument, truncating at interpolation, with write mode', () => {
    const src = 'this.#dataService.content.write(`komga/toc/${bookId}.yml`, tocData);';
    const { sites } = extractPathSites('YamlTocCacheDatastore.mjs', src);
    expect(sites).toEqual([{ file: 'YamlTocCacheDatastore.mjs', line: 1, subpath: 'komga/toc', mode: 'write' }]);
  });

  it('extracts a dataService.content.resolveDir(path.join(...)) argument (mode-ambiguous, still feeds the exists check)', () => {
    const src = "const dir = this.#dataService.content.resolveDir(path.join('lists', 'queries'));";
    const { paths } = extractPathSites('x.mjs', src);
    expect(paths.has('lists/queries')).toBe(true);
  });

  it('flags a write under one content/ subpath and a read under a different one, same domain, as a split', () => {
    // Mirrors the history/piano vs piano/log test above, but for the
    // content/ root: a write to komga/legacy-toc and a read from komga/toc
    // share the 'komga' domain but never agree on a subpath.
    const writeSrc = "this.#dataService.content.write('komga/legacy-toc', data);";
    const readSrc = "this.#dataService.content.read('komga/toc');";
    const writeSites = extractPathSites('writer.mjs', writeSrc).sites;
    const readSites = extractPathSites('reader.mjs', readSrc).sites;
    const splits = findWriterReaderSplits([...writeSites, ...readSites]);
    expect(splits.map((s) => s.subpath).sort()).toEqual(['komga/legacy-toc', 'komga/toc']);
  });

  it('reaches the real KomgaFeedAdapter / YamlTocCacheDatastore content.read/write pair and finds no split (proof, not a finding)', () => {
    const files = [
      'backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs',
      'backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs',
    ];
    const allSites = [];
    for (const rel of files) {
      const abs = path.join(REPO_ROOT, rel);
      const raw = fs.readFileSync(abs, 'utf8');
      const { sites } = extractPathSites(rel, raw);
      allSites.push(...sites);
    }

    // The pattern actually reaches real code: at least one write and one
    // read site were extracted under the 'komga' domain (the whole point of
    // I1 — before this fix, extractPathSites found NOTHING here because no
    // PATTERN matched `content.read(`/`content.write(`).
    const komgaSites = allSites.filter((s) => s.subpath.startsWith('komga/'));
    expect(komgaSites.some((s) => s.mode === 'write')).toBe(true);
    expect(komgaSites.some((s) => s.mode === 'read')).toBe(true);

    // And both halves agree (share at least the 'komga/toc' subpath) — this
    // pair was never the bug, the audit's blindness to it was.
    const splits = findWriterReaderSplits(allSites);
    expect(splits.find((s) => s.subpath.startsWith('komga/'))).toBeUndefined();
  });
});
