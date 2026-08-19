# Classical Library Corpus Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the classical-music knowledge (composer bios, work histories, movement
commentary) out of `data/content/surround/classical/` into a new subject-neutral
corpus at `data/content/library/classical/`, and turn the existing surround sidecars
into thin performance records that reference a work by id. `YamlSurroundStore` merges
the two trees at load time so `frontend/src/modules/Surround/*` needs zero changes.

**Architecture:** Two data trees, one loader. `YamlSurroundStore` gains a second root
(`libraryDir`) that it walks the same way it already walks `rootDir` — same
`domain/composer/*.yml` shape, same `_`-prefix reserved-name rule, same mtime-based
freshness. A performance sidecar (`rootDir`) carries a `work:` ref; the loader resolves
it against the library index, deep-merges composer ← work ← performance, and
synthesizes movement-anchored `cues` from the work's per-movement `note` fields paired
positionally with the sidecar's `starts` array. This is a full design doc at
`docs/_wip/plans/2026-08-19-classical-library-corpus-design.md` — read it first if
anything below is ambiguous.

**Tech Stack:** Node.js backend, vitest, YAML content on a Dropbox-synced data path
(not in git — see `CLAUDE.local.md` for how to find it locally).

**Before starting:** the content data lives outside this git repo, on the Dropbox
path from `.env`'s `DAYLIGHT_BASE_PATH` (see `CLAUDE.local.md` → "Reading app
config/auth locally"). Resolve that path once:

```bash
DATA=$(grep DAYLIGHT_BASE_PATH .env | cut -d= -f2)/data
echo "$DATA"   # confirm it prints a real, existing path before continuing
```

Every task below that touches content data uses `$DATA` as the root. Tasks that touch
code use the git checkout at `/Users/kckern/Documents/GitHub/DaylightStation`.

---

### Task 1: Migrate the content data (Dropbox tree, no git)

**Files (all under `$DATA`, none tracked in git):**
- Create: `content/library/classical/{beethoven,vivaldi,handel,mozart,sibelius,wagner,bach}/_composer.yml` (moved)
- Create: `content/library/classical/beethoven/symphony-3-eroica.yml` (split from the old sidecar)
- Create: `content/library/classical/vivaldi/four-seasons-spring.yml` (split from the old sidecar)
- Modify: `content/surround/classical/beethoven/symphony-3-eroica.yml` → rename to
  `content/surround/classical/beethoven/symphony-3-eroica.hr-2016.yml`, slimmed to a
  performance record
- Modify: `content/surround/classical/vivaldi/four-seasons-spring.yml` → rename to
  `content/surround/classical/vivaldi/four-seasons-spring.amsterdam-1725-ref.yml` — see
  note below on naming; slimmed to a performance record
- Move: `media/img/surround/classical/` → `media/img/library/classical/`
- Delete: `content/school/culture/` (empty; not a valid subject shelf)

**Step 1: Create the library tree and move composer files**

```bash
mkdir -p "$DATA/content/library/classical"
for c in beethoven vivaldi handel mozart sibelius wagner bach; do
  mkdir -p "$DATA/content/library/classical/$c"
  git -C /tmp mv 2>/dev/null; # no-op guard, these aren't git-tracked
  mv "$DATA/content/surround/classical/$c/_composer.yml" \
     "$DATA/content/library/classical/$c/_composer.yml"
done
```

**Step 2: Move the asset tree**

```bash
mkdir -p "$DATA/../media/img/library"
mv "$DATA/../media/img/surround/classical" "$DATA/../media/img/library/classical"
```
(Adjust the `../media` relative path if `$DATA` already resolves to the `data`
directory sibling of `media` — confirm with `ls "$DATA/.." ` first; it should list
both `data` and `media`.)

**Step 3: Write the Eroica work file**

Create `$DATA/content/library/classical/beethoven/symphony-3-eroica.yml`:

```yaml
title: Symphony No. 3 in E-flat major, “Eroica”
opus: Op. 55
composed: 1803-1804
year: 1804
period: "Classical to Romantic"
period_note: "Written at the hinge — Classical forms stretched to Romantic scale and feeling. Many date the Romantic era from this symphony."
city: Vienna
premiered: Theater an der Wien, 7 April 1805
set: symphonies
set_index: 3
tier: flagship
movements:
  - n: 1
    name: "Allegro con brio"
    translation: "Fast, with spirit"
    listen:
      - "Two hammered E-flat chords, then the cellos sing the heroic theme — built from a plain broken chord."
      - "The theme slides onto a strange note almost at once — that small wrongness powers the whole movement."
      - "Before the main theme returns, a lone horn sneaks it in early over hushed strings — early audiences thought the player had miscounted."
      - "Huge off-beat chords batter against the bar line — the music fighting its own meter."
  - n: 2
    name: "Marcia funebre. Adagio assai"
    translation: "Funeral march — very slow"
    listen:
      - "Basses mutter like muffled drums beneath the violins' grief — a state funeral in sound."
      - "The major-key middle section turns mourning into consolation, the oboe leading."
      - "Midway a fugue builds grief into architecture; at the very end the theme breaks apart into fragments."
    note: "The funeral march. Beethoven puts a death at the centre of a symphony — nobody had done that before."
  - n: 3
    name: "Scherzo. Allegro vivace"
    translation: "Playful — fast and lively"
    listen:
      - "A whispering moto perpetuo in the strings detonates into full orchestra — twice."
      - "The trio is three horns in hunting-call harmony — an extravagance in 1804."
    note: "The scherzo. Its trio uses three horns — the first time that had ever happened in a symphony."
  - n: 4
    name: "Finale. Allegro molto"
    translation: "Finale — very fast"
    listen:
      - "Variations that start with only the bass line — the tune itself arrives later, borrowed from his own Prometheus ballet."
      - "The theme becomes a fugue midway; a slow, hymn-like transformation gathers before the whirlwind coda."
    note: "The finale takes a tune Beethoven had already used three times before, and builds a set of variations on it."
facts:
  - "Beethoven meant to dedicate this symphony to Napoleon. When his secretary brought word that Napoleon had declared himself Emperor, Beethoven tore the title page in half and threw it on the floor. The page had to be recopied."
  - "It is twice as long as a symphony by Haydn or Mozart. The first movement alone runs about as long as a whole Classical symphony."
  - "The published title page reads: composed to celebrate the memory of a great man."
  - "A surviving copy of the score still shows the dedication to Bonaparte scratched out — twice, in two languages."
  - "The second movement was played at state funerals for more than a century after his death."
themes: [heroism, napoleon, deafness]
```

Note the two content changes from the old single file: `translation`/`listen`/`note`
moved under each movement (no `start:` — that's performance data now); `musicEndsAt`
and `performance` (the orchestra/conductor/venue string) are gone from here — they
move to the performance sidecar in Step 5.

**Step 4: Write the Spring work file**

Create `$DATA/content/library/classical/vivaldi/four-seasons-spring.yml`:

```yaml
title: "Violin Concerto in E major, “Spring”"
opus: Op. 8 No. 1, RV 269
composed: by 1725
year: 1725
city: Venice
premiered: "Published Amsterdam, 1725"
set: four-seasons
set_index: 1
tier: flagship
movements:
  - n: 1
    name: "Allegro"
    translation: "Fast and lively"
    listen:
      - "Three solo violins trade birdcalls in the opening — each bird its own figure."
      - "A soft murmuring in the violins is the brook; the storm breaks in with tremolo and racing scales."
      - "The opening theme keeps returning between episodes — count its comebacks."
    note: "Spring has arrived, and the birds greet it with a happy song — the first line of the sonnet printed with this concerto."
  - n: 2
    name: "Largo e pianissimo sempre"
    translation: "Slow, and always very soft"
    listen:
      - "The solo violin is the sleeping goatherd; the murmuring violins are leaves in the breeze."
      - "The violas bark twice a bar, all the way through — Vivaldi marked the part 'the dog that barks'."
    note: "The slow movement: a goatherd sleeps in a meadow. The violas bark like his dog, over and over."
  - n: 3
    name: "Allegro pastorale"
    translation: "Fast, in a pastoral style"
    listen:
      - "A drone in the low strings imitates bagpipes under the dance — a rustic musette."
      - "The solo violin leads the country dance — nymphs and shepherds celebrating the season."
    note: "A shepherd's dance. The bass drones like bagpipes throughout."
facts:
  - "Spring opened Il cimento dell'armonia e dell'inventione — The Contest of Harmony and Invention — the 1725 collection that made the Four Seasons famous."
  - "Each of the Four Seasons was published alongside a sonnet describing the scene. Vivaldi may have written the poems himself."
  - "The score is marked with the things it depicts: birdsong, a thunderstorm, a barking dog."
themes: [nature, seasons, programmatic-music]
```

**Step 5: Write the two performance sidecars**

Delete the two old sidecar files and replace with:

`$DATA/content/surround/classical/beethoven/symphony-3-eroica.hr-2016.yml`:

```yaml
work: beethoven/symphony-3-eroica
surround: concert-hall
match:
  contentId: plex:663134
  title: "Beethoven: 3. Sinfonie"
performance: "hr-Sinfonieorchester · Andrés Orozco-Estrada · Alte Oper Frankfurt, 11 February 2016"
starts: [0, 976, 1925, 2278]
musicEndsAt: 2955
```

`$DATA/content/surround/classical/vivaldi/four-seasons-spring.plex663146.yml`:

```yaml
work: vivaldi/four-seasons-spring
surround: concert-hall
match:
  contentId: plex:663146
  title: "Violin Concerto No. 1 in E Major, RV 269 Spring"
starts: [0, 225, 385]
musicEndsAt: 613
```

```bash
rm "$DATA/content/surround/classical/beethoven/symphony-3-eroica.yml"
rm "$DATA/content/surround/classical/vivaldi/four-seasons-spring.yml"
# then write the two files above at their new paths
```

(File naming for performances: `<work-slug>.<short-performance-tag>.yml`. There's no
real second performance yet, so the tag is free-form — pick something that will still
make sense once a second Vivaldi Spring performance shows up.)

**Step 6: Delete the empty `school/culture` placeholder**

```bash
rmdir "$DATA/content/school/culture"
```

**Step 7: Sanity-check the tree**

```bash
find "$DATA/content/library/classical" "$DATA/content/surround/classical" -type f | sort
```

Expected: 7 `_composer.yml` under `library/classical/*`, 2 work files, 2 performance
sidecars under `surround/classical/*`, and `_surrounds/concert-hall.yml` untouched at
`surround/_surrounds/`.

This task has no test to run — it's data, verified in Task 8's end-to-end check.

---

### Task 2: Write failing tests for library-tree resolution

**Files:**
- Modify: `backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs`

Add a new `libraryDir` param everywhere a store is constructed in this file, and add
a second fixture writer. Do this as one mechanical pass across the whole file — every
`new YamlSurroundStore({ rootDir, logger })` call becomes
`new YamlSurroundStore({ rootDir, libraryDir, logger })`.

**Step 1: Replace the fixture setup at the top of the file**

Replace lines 1–29 (imports through `beforeEach`/`afterEach`) with:

```javascript
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
```

This changes the base fixture's Eroica sidecar shape (`work:` ref, `starts:` instead
of inline `movements`/`piece`) and moves `_composer.yml` into `library`. Every existing
test in the file that relied on the old shape will now fail — that's expected and is
what Task 6 fixes. Don't touch the rest of the file yet.

**Step 2: Add `libraryDir` to every remaining `new YamlSurroundStore({ rootDir, ... })` call**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
grep -n "new YamlSurroundStore({ rootDir" backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs | wc -l
```

Each match needs `libraryDir` added after `rootDir`. Use your editor's find/replace:
`rootDir, logger` → `rootDir, libraryDir, logger` (only where it's the two-arg
constructor call, not elsewhere) and `rootDir })` → `rootDir, libraryDir })`. There
are ~35 call sites; do this now so Step 3's new tests aren't the only ones passing
`libraryDir`, but expect the rest of the suite to still be red until Task 6.

**Step 3: Add the new describe block for library resolution**

Append to the end of the file, before the final closing (i.e. as a new top-level
`describe`):

```javascript
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
```

**Step 2: Run the new tests and confirm they fail for the right reason**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx vitest run backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs -t "library resolution"
```

Expected: every test in the new describe block fails — the constructor doesn't accept
`libraryDir` yet, so `work:` refs never resolve. Confirm the failures are about missing
behavior, not a syntax error in the test file itself.

**Do not commit yet** — Task 3 makes these pass.

---

### Task 3: Implement library loading and performance merge in `YamlSurroundStore`

**Files:**
- Modify: `backend/src/1_adapters/content/surround/YamlSurroundStore.mjs`

**Step 1: Accept `libraryDir` in the constructor**

Replace the constructor (current lines 61–71):

```javascript
  /**
   * @param {Object} options
   * @param {string} options.rootDir - Root of the performance-sidecar tree (data/content/surround)
   * @param {string} options.libraryDir - Root of the knowledge corpus (data/content/library)
   * @param {Object} options.logger - Structured logger
   */
  constructor({ rootDir, libraryDir, logger }) {
    super();
    this.rootDir = rootDir;
    this.libraryDir = libraryDir;
    this.logger = logger?.child?.({ app: 'surround', module: 'surround-store' }) ?? logger;
    this.#build();
  }
```

**Step 2: Add a `#loadLibrary()` method**

Insert after `#loadDefinitions()` (after current line 346):

```javascript
  /**
   * Load the knowledge corpus: composers and works, keyed the same way a
   * performance sidecar references them (`<composer>/<work-slug>`).
   *
   * Mirrors #build's own walk (same domain/composer/*.yml shape, same
   * reserved-name rule) but over libraryDir instead of rootDir, since the two
   * trees are independent and a performance sidecar may reference a work whose
   * media doesn't exist under the same domain folder name coincidentally — they
   * just happen to share the convention today.
   *
   * @returns {{ composers: Map<string, Object>, works: Map<string, Object> }}
   * @private
   */
  #loadLibrary() {
    const composers = new Map();
    const works = new Map();
    if (!dirExists(this.libraryDir)) return { composers, works };

    for (const domain of listDirs(this.libraryDir).filter((d) => !isReserved(d))) {
      const domainDir = path.join(this.libraryDir, domain);

      for (const composer of listDirs(domainDir).filter((d) => !isReserved(d))) {
        const composerDir = path.join(domainDir, composer);
        const composerBase = loadYamlFromPath(path.join(composerDir, `${COMPOSER_FILE}.yml`));
        if (isPlainObject(composerBase)) composers.set(composer, composerBase);

        const files = listYamlFiles(composerDir, { stripExtension: false }).filter((f) => !isReserved(f));
        for (const file of files) {
          const work = loadYamlFromPath(path.join(composerDir, file));
          if (!isPlainObject(work)) continue;
          const slug = file.replace(/\.(yml|yaml)$/, '');
          works.set(`${composer}/${slug}`, work);
        }
      }
    }

    return { composers, works };
  }
```

**Step 3: Add the `pick` helper near the other module-level helpers**

Insert after `const isPresent = (v) => ...` (current line 38):

```javascript
// Work-level fields that surface as payload.piece, disjoint from
// performance-level fields (performance, musicEndsAt) the sidecar supplies.
const PIECE_FIELDS = ['title', 'opus', 'composed', 'year', 'period', 'period_note', 'city', 'premiered'];
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
};
```

**Step 4: Replace `#resolvePiece` with `#resolvePerformance`**

Replace the entire `#resolvePiece` method (current lines 413–476) with:

```javascript
  /**
   * Read one performance sidecar and resolve it against the knowledge corpus
   * into the payload the API attaches verbatim.
   *
   * Precedence, per the design doc: composer <- work <- performance, applied
   * separately to the composer block and the piece block. Movements and cues
   * come from the work; `starts` pairs with them positionally (starts[i] is
   * movements[i]'s start second), which is also how a movement's `note` becomes
   * a synthesized, movement-anchored cue.
   *
   * @returns {{ contentId: string, title: string, normalized: string, payload: Object }|null}
   * @private
   */
  #resolvePerformance(filePath, domain, definitions, library, file) {
    const doc = loadYamlFromPath(filePath);
    if (!isPlainObject(doc)) {
      this.#invalid(file, [isPresent(doc) ? 'not-a-mapping' : 'yaml-unparseable']);
      return null;
    }

    const blocking = [];
    if (!doc.surround) blocking.push('missing-surround');
    if (typeof doc.work !== 'string' || !doc.work.trim()) blocking.push('missing-work');
    if (!isPlainObject(doc.match)) blocking.push(isPresent(doc.match) ? 'match-not-a-mapping' : 'missing-match');
    else if (!doc.match.contentId) blocking.push('missing-match-contentId');
    if (blocking.length) { this.#invalid(file, blocking); return null; }

    const definition = definitions.get(doc.surround);
    if (!definition) {
      this.logger?.warn?.('surround.definition.missing', { id: doc.surround, file });
      return null;
    }

    const work = library.works.get(doc.work);
    if (!work) {
      this.logger?.warn?.('surround.work.missing', { work: doc.work, file });
      return null;
    }
    // The composer slug is the path segment before the work slug — the same
    // convention the sidecar's own folder placement already implies.
    const composerSlug = doc.work.split('/')[0];
    const composerBase = library.composers.get(composerSlug);

    const soft = [];
    if (typeof doc.match.title !== 'string' || !doc.match.title.trim()) soft.push('missing-match-title');
    if (isPresent(doc.starts) && !Array.isArray(doc.starts)) soft.push('starts-not-a-list');
    if (isPresent(doc.cues) && !Array.isArray(doc.cues)) soft.push('cues-not-a-list');
    if (isPresent(doc.composer) && !isPlainObject(doc.composer)) soft.push('composer-not-a-mapping');
    if (isPresent(doc.piece) && !isPlainObject(doc.piece)) soft.push('piece-not-a-mapping');
    if (soft.length) this.#invalid(file, soft);

    const starts = Array.isArray(doc.starts) ? doc.starts : [];
    const movements = asArray(work.movements);
    if (starts.length && starts.length !== movements.length) {
      this.logger?.warn?.('surround.starts.mismatch', { file, starts: starts.length, movements: movements.length });
    }

    const resolvedMovements = movements.map((m, i) => ({ ...m, start: starts[i] }));
    const movementCues = movements
      .map((m, i) => ({ at: starts[i], text: m.note }))
      .filter((c) => typeof c.at === 'number' && typeof c.text === 'string' && c.text.trim())
      .map((c) => ({ at: c.at, render: 'docked', text: c.text }));
    const explicitCues = asArray(doc.cues);
    const cues = [...movementCues, ...explicitCues].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

    const workPiece = pick(work, PIECE_FIELDS);
    const performancePiece = pick(doc, ['performance', 'musicEndsAt']);
    const piece = deepMerge(
      deepMerge(workPiece, performancePiece),
      isPlainObject(doc.piece) ? doc.piece : {}
    );

    const composer = deepMerge(
      deepMerge(isPlainObject(composerBase) ? composerBase : {}, isPlainObject(work.composer) ? work.composer : {}),
      isPlainObject(doc.composer) ? doc.composer : {}
    );

    return {
      contentId: String(doc.match.contentId),
      title: typeof doc.match.title === 'string' ? doc.match.title : '',
      normalized: normalizeTitle(doc.match.title),
      payload: {
        id: doc.surround,
        definition: { regions: definition.regions, collapse: definition.collapse },
        piece,
        movements: resolvedMovements,
        cues,
        facts: asArray(work.facts),
        composer,
        assetBase: `library/${domain}`
      }
    };
  }
```

**Step 5: Wire `#loadLibrary()` into `#build()` and update the call site**

In `#build()` (current lines 245–327):
1. After `definitions = this.#loadDefinitions();` add: `const library = this.#loadLibrary();`
2. Remove the `composers` counter and `composerBase` lookup from the domain/composer
   walk loop (composer counting now happens inside `#loadLibrary`) — replace:
   ```javascript
   const composerBase = loadYamlFromPath(path.join(composerDir, `${COMPOSER_FILE}.yml`));
   if (isPlainObject(composerBase)) composers += 1;
   ```
   with nothing (delete those two lines; `composerDir` is still used below for listing
   files).
3. Change the resolve call from
   `this.#resolvePiece(path.join(composerDir, file), domain, composerBase, definitions, relFile)`
   to
   `this.#resolvePerformance(path.join(composerDir, file), domain, definitions, library, relFile)`.
4. Change the final `composers` in the `surround.index.built` log line from the local
   counter to `library.composers.size`.

**Step 6: Include `libraryDir` in the freshness walk**

In `#newestMtime()` (current lines 177–210), after the existing `consider(this.rootDir)` /
definitions-dir block and before the domain loop, add a parallel walk over
`libraryDir`:

```javascript
    consider(this.libraryDir);
    for (const domain of listDirs(this.libraryDir).filter((d) => !isReserved(d))) {
      const domainDir = path.join(this.libraryDir, domain);
      consider(domainDir);
      for (const composer of listDirs(domainDir).filter((d) => !isReserved(d))) {
        const composerDir = path.join(domainDir, composer);
        consider(composerDir);
        for (const file of listYamlFiles(composerDir, { stripExtension: false })) {
          consider(path.join(composerDir, file));
        }
      }
    }
```

**Step 7: Run the new tests**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx vitest run backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs -t "library resolution"
```

Expected: all tests in the "YamlSurroundStore library resolution" describe block pass.
Ignore other failures in this file for now — that's Task 6.

**Step 8: Commit**

```bash
git add backend/src/1_adapters/content/surround/YamlSurroundStore.mjs
git add backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs
git commit -m "$(cat <<'EOF'
feat(surround): resolve performance sidecars against a separate knowledge corpus

Adds libraryDir alongside rootDir: composer/work knowledge lives in
data/content/library/<domain>/, performance sidecars in
data/content/surround/<domain>/ reference a work by id. Movement notes
become positionally-timed cues via the sidecar's starts array.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire `libraryDir` into the composition root

**Files:**
- Modify: `backend/src/5_composition/modules/contentApi.mjs:125`

**Step 1: Update the constructor call**

Find (around line 125):

```javascript
  const surroundStore = new YamlSurroundStore({ rootDir: path.join(dataPath, 'content/surround'), logger });
```

Replace with:

```javascript
  const surroundStore = new YamlSurroundStore({
    rootDir: path.join(dataPath, 'content/surround'),
    libraryDir: path.join(dataPath, 'content/library'),
    logger
  });
```

**Step 2: Confirm no other composition site constructs `YamlSurroundStore`**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
grep -rn "new YamlSurroundStore" backend/src --include="*.mjs" | grep -v test
```

Expected: exactly one match, the line just edited. If there's a second site, apply
the same change there.

**Step 3: Commit**

```bash
git add backend/src/5_composition/modules/contentApi.mjs
git commit -m "$(cat <<'EOF'
feat(surround): pass libraryDir to the surround store composition root

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migrate the rest of `YamlSurroundStore.test.mjs` to the two-tree fixture

**Files:**
- Modify: `backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs`

This is mechanical but touches most of the file's ~60 existing tests, because the old
fixture wrote composer identity and piece content into one file under `root`, and the
new one splits them across `root` and `library`. Work through the file top to bottom,
one `describe` block at a time; after each block, re-run just that block and fix
before moving on.

**Step 1: Run the full file to see the current failure set**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx vitest run backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs 2>&1 | tail -80
```

Expect failures in every describe block except "library resolution". Use this output
as your worklist.

**Step 2: Fix each test, following these translation rules**

For every test that previously wrote a self-contained sidecar via `write('classical/.../x.yml', 'surround: concert-hall\nmatch: ...\npiece: {...}\nmovements: [...]\n...')`:

- Split the body: `surround:`, `match:`, `work:` (new, required), `starts:`
  (replacing inline `movements[].start`), `cues:`, `composer:` stay in the `write()`
  (performance) call.
- `piece:`, `movements:` (without `start`, with `listen`/`note` if the test cared
  about them), `facts:` move to a `writeLib()` call at
  `classical/<composer>/<slug>.yml`, where `<slug>` matches the `work:` ref.
- If the test's composer identity mattered (e.g. the Haydn deep-merge test), the
  `_composer.yml` write moves from `write(...)` to `writeLib(...)`.

Example translation — the deep-merge test (current lines 129–139):

```javascript
  it('deep-merges nested composer blocks instead of replacing them', () => {
    writeLib('classical/haydn/_composer.yml',
      'name: Joseph Haydn\nlinks: { wiki: base-wiki, imslp: base-imslp }\n');
    writeLib('classical/haydn/symphony-94.yml',
      'title: Surprise\nmovements: []\n');
    write('classical/haydn/symphony-94.yml',
      'work: haydn/symphony-94\nsurround: concert-hall\nmatch:\n  contentId: plex:94\ncomposer:\n  links: { wiki: piece-wiki }\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:94', '');
    expect(r.composer.links.wiki).toBe('piece-wiki');
    expect(r.composer.links.imslp).toBe('base-imslp');
    expect(r.composer.name).toBe('Joseph Haydn');
  });
```

Apply the same shape to the rest. A few tests need a small behavioral note, not just
a mechanical split:

- **"coerces wrong-typed list and object fields to safe empties"** (current lines
  148–158): `movements`/`facts` are now work-level, so write the malformed values
  into `writeLib(...)`'s work file instead of the sidecar; `cues`/`composer` stay
  malformed in the sidecar `write(...)`. Expect `r.piece` to be `{}` only if the work
  file's `title` etc. are also absent — adjust the fixture's work file to have no
  `title`/`opus` so `pick()` yields `{}`.
- **"emits `surround.index.built` with the documented payload"** (current lines
  76–84): `composers` and `definitions` counts are unaffected; add nothing new here
  unless your fixture added an extra composer.
- **"counts rejected piece files as skipped"** (current lines 219–227): unaffected —
  still counts sidecars, not corpus files.
- Any test asserting `assetBase === 'surround/classical'` must change to
  `assetBase === 'library/classical'` (the base path change from Task 3 Step 4).

**Step 3: Re-run the whole file until green**

```bash
npx vitest run backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs
```

Expected: all tests pass, none skipped.

**Step 4: Commit**

```bash
git add backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs
git commit -m "$(cat <<'EOF'
test(surround): migrate store tests to the two-tree corpus/performance fixture

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Run the full backend suite and fix stragglers

**Step 1: Run backend tests**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npm run test:backend
```

**Step 2: Check the two integration test files that touch surround for any direct construction**

```bash
grep -n "YamlSurroundStore" backend/src/4_api/v1/routers/queue.surround.test.mjs backend/src/3_applications/content/services/PlayResponseService.surround.test.mjs
```

These were confirmed to use `ISurroundStore` doubles, not the real class, at plan-time
— if that's still true, no change needed. If either constructs a real
`YamlSurroundStore`, apply the same `libraryDir` fix as Task 3.

**Step 3: Fix anything red, then re-run to confirm green**

```bash
npm run test:backend
```

---

### Task 7: Update the surround docs

**Files:**
- Modify: `docs/reference/player/surround/classical/README.md`

**Step 1: Rewrite the "Structure" section**

Replace the "Structure" section's tree diagram and the "Composer file" / "Piece
sidecar" subsections with the two-tree shape from the design doc
(`docs/_wip/plans/2026-08-19-classical-library-corpus-design.md`) — the work-file
schema, the performance-sidecar schema, and the merge/cue-synthesis rule. Keep the
"Why `match` has two keys" section as-is (still accurate). Update the asset-path
mention (`media/img/surround/classical/...` → `media/img/library/classical/...`) and
the API route mention accordingly if the static route prefix also changed — check
whether `assetBase` is used to build a static URL prefix and whether that route needs
a matching update:

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
grep -rn "assetBase\|surround/classical" backend/src frontend/src --include="*.mjs" --include="*.jsx" | grep -v test
```

If a static file route hardcodes `img/surround/...`, update it to read from
`img/library/...` for the classical domain (or make it generic over `assetBase`, if
it already is — confirm before editing).

**Step 2: Add a short "Authoring ahead of Plex" note**

Document the `pending:<slug>` `match.contentId` convention from the brainstorming
conversation for Tier B works authored before any recording is ingested.

**Step 3: Commit**

```bash
git add docs/reference/player/surround/classical/README.md
git commit -m "$(cat <<'EOF'
docs(surround): document the corpus/performance split

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: End-to-end verification against the dev server

**Do not start a second backend instance** — per `CLAUDE.local.md`, a second
`node backend/index.js` makes real Home Assistant calls and fights the running
instance for device authority. Check first:

```bash
lsof -i :3111   # or :3112, per CLAUDE.md's port table for this machine
```

If nothing is running, start one (`npm run dev`) and wait for it to be ready. If one
is already running, use it — do not start a second.

**Step 1: Confirm both migrated pieces resolve**

```bash
curl -s "http://localhost:<port>/api/v1/play/plex:663134" | jq '.surround.piece, .surround.movements, .surround.cues, .surround.composer.name, .surround.assetBase'
curl -s "http://localhost:<port>/api/v1/play/plex:663146" | jq '.surround.piece, .surround.movements, .surround.cues, .surround.assetBase'
```

Expected: non-null `surround` on both, `piece.title` correct for each, `movements[].start`
populated with the timestamps from Task 1, `cues` including the movement-note cues,
`assetBase` reading `library/classical`.

**Step 2: Check the log store for new warnings**

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=context.app:surround AND _time:15m' -d 'limit=50'
```

Expected: a fresh `surround.index.built` line with `pieces: 2`, `composers: 7` (or
however many `_composer.yml` files were moved), and no `surround.sidecar.invalid`,
`surround.work.missing`, or `surround.starts.mismatch` warnings for the two migrated
pieces.

**Step 3: If anything's off, fix the data (Task 1) or the loader (Task 3) and re-check** — don't move on until both curls come back clean.

---

## Deferred (not in this plan)

- `ClassicalLibraryCatalogSource` (School's `arts`-shelf projection) — the design doc
  shapes the corpus so this needs no schema change, but building the source itself is
  separate School work.
- Authoring new composers/works (Tier A completions, Tier B long tail) — this plan is
  the migration only; content authoring follows once this is merged and verified.
