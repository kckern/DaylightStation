# Drama Surround Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `drama` surround domain (parallel to `classical`) so a stage
production locks into a 16:9-or-declared-aspect box with chrome synchronized
to the playhead — Act/Scene rail, a play-identity card, hierarchy-scoped
character cards, and Act-left/Scene-right commentary — and hydrate it
end-to-end for the BBC Television Shakespeare pilot, *The Taming of the
Shrew* (`plex:697661`).

**Architecture:** Reuse classical's existing generic machinery
(`groups:`/`segments:` with folding, the band's two-register split, the
segment/fact hierarchy walk) unchanged. Add five small, additive,
backward-compatible pieces: a corpus-declared aspect ratio, a new `PlayCard`
rail module, a `PlaceCarousel` fallback generalization (+ one caption
correctness fix), a `characterPool()` hierarchy walk parallel to the
existing `factPool()`, and a new `playhouse` presentation definition. Then
author the `drama` corpus/sidecar for the pilot play and validate live.

**Tech Stack:** React (frontend/src/modules/Surround), Node.js backend
adapter (`YamlSurroundStore.mjs`), Vitest + Testing Library, YAML content
authored directly in the Dropbox-backed data volume.

**Spec:** `docs/superpowers/specs/2026-09-16-drama-surround-design.md`
(commits `8b590dfba`, `6f35f3aff`, and the character-cards addition)

## Global Constraints

- **No domain-specific vocabulary in code.** "Act," "Scene," "Shakespeare,"
  "play" must never appear in frontend/backend logic — only as
  corpus-authored `kind:`/`title:` values. Every new field (`genre`,
  `setting`, `characters`, `aspectRatio`) is domain-agnostic and usable by
  `classical` too.
- **Additive and backward-compatible.** Every change must default to
  today's `classical` behavior when the new field is absent. Run the full
  existing Surround test suite after every task; a regression there blocks
  the task.
- **Repo split.** Code changes (frontend/backend/docs) live in
  `/opt/Code/DaylightStation` (git). Content authoring (corpus, sidecar,
  presentation definition) lives in
  `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data`, which is
  **not** a git repo — never `rm` there; the store watches mtimes, so
  authoring is edit-and-refresh; back up before overwriting.
- **`characters:` merge rule differs from `facts:`.** `facts:` accumulates
  (every distinct string across the hierarchy rotates); `characters:`
  overrides by `name` (nearest level wins per name, not both).
- Follow TDD for every code task: failing test first, minimal implementation,
  passing test, commit.

---

### Task 1: Backend — extend the piece-fields allowlist

**Files:**
- Modify: `backend/src/1_adapters/content/surround/YamlSurroundStore.mjs:151`
- Test: `backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs`

**Interfaces:**
- Produces: `piece.aspectRatio`, `piece.genre`, `piece.setting` reach the
  resolved payload wherever a work file authors them.

- [ ] **Step 1: Write the failing test**

Add to `YamlSurroundStore.test.mjs`, near the existing "carries
piece.short_title through the whitelist" test (~line 1478):

```js
it('carries aspectRatio, genre and setting through the whitelist', () => {
  writeLib('classical/beethoven/symphony-3-eroica.yml',
    'title: Symphony No. 3\nopus: Op. 55\naspectRatio: "4 / 3"\ngenre: Comedy\nsetting: "Padua, Italy"\n'
    + 'segments:\n  - { n: 1, name: Allegro con brio }\n');
  const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
  const r = store.lookup('plex:663134', '');
  expect(r.piece.aspectRatio).toBe('4 / 3');
  expect(r.piece.genre).toBe('Comedy');
  expect(r.piece.setting).toBe('Padua, Italy');
});

it('leaves aspectRatio/genre/setting undefined when the corpus has not authored them', () => {
  const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
  const r = store.lookup('plex:663134', '');
  expect(r.piece.aspectRatio).toBeUndefined();
  expect(r.piece.genre).toBeUndefined();
  expect(r.piece.setting).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/1_adapters/content/surround/YamlSurroundStore.test.mjs -t "aspectRatio"`
Expected: FAIL — `r.piece.aspectRatio` is `undefined` in the first test.

- [ ] **Step 3: Add the fields to the allowlist**

In `YamlSurroundStore.mjs`, line 151:

```js
const PIECE_FIELDS = ['title', 'short_title', 'opus', 'composed', 'year', 'period', 'period_note', 'city', 'premiered', 'aspectRatio', 'genre', 'setting'];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/1_adapters/content/surround/YamlSurroundStore.test.mjs -t "aspectRatio"`
Expected: PASS, both tests.

- [ ] **Step 5: Run the full backend surround suite**

Run: `cd backend && npx vitest run src/1_adapters/content/surround/`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/content/surround/YamlSurroundStore.mjs backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs
git commit -m "feat(surround): allowlist aspectRatio, genre and setting on piece"
```

---

### Task 2: Backend — `characters:` hierarchy plumbing

**Files:**
- Modify: `backend/src/1_adapters/content/surround/YamlSurroundStore.mjs`
  (add a `characterList` helper near `textList` at line 34; extend
  `nestedGroupSegments`'s ancestor object at line ~90-95; extend the
  top-level payload at line ~1421)
- Test: `backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs`

**Interfaces:**
- Produces: `payload.characters` (work-level array), and each flattened
  segment's `ancestors[i].characters` (group-level array) — both
  `{ name, role, description }[]`, same shape `facts:`/`textList` already
  produce for strings but object-shaped.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `YamlSurroundStore.test.mjs`:

```js
describe('YamlSurroundStore — characters (drama)', () => {
  it('carries work-level characters on the payload', () => {
    writeLib('drama/shakespeare/taming-of-the-shrew.yml',
      'title: The Taming of the Shrew\n'
      + 'characters:\n  - { name: Petruchio, role: "a gentleman of Verona", description: "A fortune-hunter." }\n'
      + 'groups:\n  - kind: act\n    title: "Act I"\n    segments:\n      - { n: 1, label: "Scene 1" }\n');
    write('drama/shakespeare/taming-of-the-shrew.bbc1980.yml',
      'work: shakespeare/taming-of-the-shrew\nsurround: concert-hall\nmatch:\n  contentId: plex:697661\n  title: "The Taming of the Shrew"\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:697661', '');
    expect(r.characters).toEqual([
      { name: 'Petruchio', role: 'a gentleman of Verona', description: 'A fortune-hunter.' },
    ]);
  });

  it('carries group-level characters on each flattened segment’s ancestors', () => {
    writeLib('drama/shakespeare/taming-of-the-shrew.yml',
      'title: The Taming of the Shrew\n'
      + 'groups:\n  - kind: act\n    title: "Act IV"\n'
      + '    characters:\n      - { name: Petruchio, role: "a gentleman of Verona", description: "Deep into the taming." }\n'
      + '    segments:\n      - { n: 1, label: "Scene 1" }\n');
    write('drama/shakespeare/taming-of-the-shrew.bbc1980.yml',
      'work: shakespeare/taming-of-the-shrew\nsurround: concert-hall\nmatch:\n  contentId: plex:697661\n  title: "The Taming of the Shrew"\n');
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:697661', '');
    expect(r.pieceSegments[0].ancestors[0].characters).toEqual([
      { name: 'Petruchio', role: 'a gentleman of Verona', description: 'Deep into the taming.' },
    ]);
  });

  it('produces an empty characters array when the work authors none', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').characters).toEqual([]);
  });
});
```

This needs a `_surrounds/concert-hall.yml`-style definition and a
`drama` library folder both already writable via the fixture's `writeLib`/
`write` helpers (see Task 1's context) — `writeFixture()` already creates
`_surrounds/concert-hall.yml`, so no new fixture setup is needed; the tests
above reuse it by naming `surround: concert-hall`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/1_adapters/content/surround/YamlSurroundStore.test.mjs -t "characters"`
Expected: FAIL — `r.characters` is `undefined`.

- [ ] **Step 3: Add the `characterList` helper**

Beside `textList` (line 34):

```js
const characterList = (v) => asArray(v)
  .filter((c) => isPlainObject(c) && typeof c.name === 'string' && c.name.trim())
  .map((c) => ({
    name: c.name.trim(),
    ...(typeof c.role === 'string' && c.role.trim() ? { role: c.role.trim() } : {}),
    ...(typeof c.description === 'string' && c.description.trim() ? { description: c.description.trim() } : {}),
  }));
```

- [ ] **Step 4: Carry group-level characters through `nestedGroupSegments`**

In the `ancestor` object (line ~90-95), add one line after the existing
`facts` line:

```js
const ancestor = {
  index: indexAtDepth[depth] ?? 0, title,
  ...(typeof group.mini === 'string' && group.mini.trim() ? { mini: group.mini.trim() } : {}),
  ...(typeof group.kind === 'string' && group.kind.trim() ? { kind: group.kind.trim() } : {}),
  ...(textList(group.facts).length ? { facts: textList(group.facts) } : {}),
  ...(characterList(group.characters).length ? { characters: characterList(group.characters) } : {}),
};
```

- [ ] **Step 5: Carry work-level characters on the top-level payload**

At line ~1421, beside `facts: asArray(work.facts)`:

```js
facts: asArray(work.facts),
characters: characterList(work.characters),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/1_adapters/content/surround/YamlSurroundStore.test.mjs -t "characters"`
Expected: PASS, all three.

- [ ] **Step 7: Run the full backend surround suite**

Run: `cd backend && npx vitest run src/1_adapters/content/surround/`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add backend/src/1_adapters/content/surround/YamlSurroundStore.mjs backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs
git commit -m "feat(surround): carry characters: through the group hierarchy"
```

---

### Task 3: Frontend — `characterPool()` in `segments.js`

**Files:**
- Modify: `frontend/src/modules/Surround/segments.js` (add beside the
  existing `factPool`/`factPools`, ~line 204-248)
- Test: `frontend/src/modules/Surround/segments.test.mjs`

**Interfaces:**
- Consumes: `data.segments[i].ancestors[].characters`, `data.segments[i].characters`, `data.characters` — all `{name, role, description}[]`, as produced by Task 2.
- Produces: `characterPool(data, index)` returning `{name, role, description}[]`, deduped by `name` (nearest wins), for CueTicker and PlayCard (Tasks 5, 6) to format and rotate.

- [ ] **Step 1: Write the failing test**

Add to `segments.test.mjs`:

```js
import { characterPool } from './segments.js';

describe('characterPool', () => {
  const petruchioBaseline = { name: 'Petruchio', role: 'a gentleman of Verona', description: 'A fortune-hunter.' };
  const petruchioActFour = { name: 'Petruchio', role: 'a gentleman of Verona', description: 'Deep into the taming.' };
  const katherina = { name: 'Katherina', role: 'the shrew' };

  it('returns the work-level roster when no segment or group re-describes anyone', () => {
    const data = { characters: [petruchioBaseline, katherina], segments: [{ ancestors: [] }] };
    expect(characterPool(data, 0)).toEqual([petruchioBaseline, katherina]);
  });

  it('lets a nearer group entry replace one name without duplicating it', () => {
    const data = {
      characters: [petruchioBaseline, katherina],
      segments: [{ ancestors: [{ characters: [petruchioActFour] }] }],
    };
    expect(characterPool(data, 0)).toEqual([petruchioActFour, katherina]);
  });

  it('prefers the segment’s own characters over its ancestors’ and the work’s', () => {
    const onSegment = { name: 'Petruchio', role: 'a gentleman of Verona', description: 'Right this instant.' };
    const data = {
      characters: [petruchioBaseline],
      segments: [{ characters: [onSegment], ancestors: [{ characters: [petruchioActFour] }] }],
    };
    expect(characterPool(data, 0)).toEqual([onSegment]);
  });

  it('returns an empty list for an unplaced index or no authored characters', () => {
    const data = { segments: [{}] };
    expect(characterPool(data, -1)).toEqual([]);
    expect(characterPool(data, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Surround/segments.test.mjs -t "characterPool"`
Expected: FAIL — `characterPool` is not exported.

- [ ] **Step 3: Implement `characterPool`**

In `segments.js`, immediately after `factPool` (after line 223):

```js
/**
 * Every character card in scope at `index`, nearest-name-wins.
 *
 * Unlike `factPool`, which ACCUMULATES every distinct fact string across the
 * hierarchy, this OVERRIDES by name: a nearer level's card for "Petruchio"
 * replaces a farther one rather than both rotating through, because two
 * descriptions of one character are never both current — only one is.
 */
export function characterPool(data, index) {
  const list = Array.isArray(data?.segments) ? data.segments : [];
  const segment = Number.isInteger(index) && index >= 0 ? list[index] : null;
  const byName = new Map();
  const add = (items) => (Array.isArray(items) ? items : []).forEach((c) => {
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    if (!name || byName.has(name)) return;
    byName.set(name, c);
  });

  add(segment?.characters);
  [...(Array.isArray(segment?.ancestors) ? segment.ancestors : [])]
    .reverse().forEach((ancestor) => add(ancestor?.characters));
  add(data?.characters);
  return [...byName.values()];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/modules/Surround/segments.test.mjs -t "characterPool"`
Expected: PASS, all four cases.

- [ ] **Step 5: Run the full segments test file**

Run: `cd frontend && npx vitest run src/modules/Surround/segments.test.mjs`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Surround/segments.js frontend/src/modules/Surround/segments.test.mjs
git commit -m "feat(surround): add characterPool, name-override hierarchy walk"
```

---

### Task 4: Frontend — `SurroundFrame.jsx` corpus-declared aspect ratio

**Files:**
- Modify: `frontend/src/modules/Surround/SurroundFrame.jsx:527-537`
- Modify: `frontend/src/modules/Surround/SurroundFrame.scss:230-266`
  (publish a CSS custom property fallback)
- Test: `frontend/src/modules/Surround/SurroundFrame.test.jsx`

**Interfaces:**
- Consumes: `data.piece.aspectRatio` (a CSS `aspect-ratio` string, e.g.
  `"4 / 3"`), produced by Task 1.

- [ ] **Step 1: Write the failing test**

Add to `SurroundFrame.test.jsx`, near the existing "locks the media box to
16:9" test (~line 185):

```js
it('locks the media box to a corpus-declared aspect ratio when the piece authors one', () => {
  const data = { ...DATA, piece: { ...DATA.piece, aspectRatio: '4 / 3' } };
  const { getByTestId } = renderFrame({ data });
  expect(getByTestId('surround-media').style.aspectRatio).toBe('4 / 3');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Surround/SurroundFrame.test.jsx -t "corpus-declared"`
Expected: FAIL — the media box is `'16 / 9'` regardless of `data.piece.aspectRatio`.

- [ ] **Step 3: Generalize the inline style**

In `SurroundFrame.jsx`, replace the media box's inline style (~line 527-537):

```jsx
<div
  className={enabled ? 'surround-frame__media' : undefined}
  data-testid={enabled ? 'surround-media' : undefined}
  ref={mediaRef}
  style={enabled
    ? { aspectRatio: payload?.piece?.aspectRatio ?? '16 / 9', maxWidth: '100%', maxHeight: '100%' }
    : NO_BOX}
>
  {children}
</div>
```

- [ ] **Step 4: Publish the same value as a CSS custom property, for the SCSS fallback**

In the `rootStyle` object (~line 481-503), add one line alongside
`--surround-media-w`:

```js
const rootStyle = enabled
  ? {
    ...entranceVars(),
    '--surround-aspect-ratio': payload?.piece?.aspectRatio ?? '16 / 9',
    ...(mediaWidth ? { '--surround-media-w': `${mediaWidth}px` } : null),
    // ... rest unchanged
```

- [ ] **Step 5: Update the SCSS fallback**

In `SurroundFrame.scss`, line 247:

```scss
aspect-ratio: var(--surround-aspect-ratio, 16 / 9);
```

Update the comment above it (line 230) from "16:9 is inviolable" to "the
corpus's declared aspect ratio is inviolable — letterbox or pillarbox,
never distort."

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/modules/Surround/SurroundFrame.test.jsx -t "corpus-declared"`
Expected: PASS.

- [ ] **Step 7: Run the full SurroundFrame test file — confirm the default 16:9 test still passes**

Run: `cd frontend && npx vitest run src/modules/Surround/SurroundFrame.test.jsx`
Expected: PASS, all tests including "locks the media box to 16:9 and letterboxes rather than distorting" (unchanged fixture, no `aspectRatio` authored → still `'16 / 9'`).

- [ ] **Step 8: Sweep SurroundFrame.scss for other shape assumptions**

Read through the file for anything computed FROM the 16:9 ratio itself
(not just percentages/rem of the box). Confirm `--placard-inset`,
`--placard-straddle`, and the curtain-bleed values are constants relative to
the box's own dimensions (percentages, `rem`, `vh`) rather than derived from
16:9 specifically — they are (verified during spec research: none of these
values contain a 16:9-derived computation). No code change expected here;
this step is a documented verification, not a fix. If a genuine
shape-dependent value is found, add a task here before proceeding.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Surround/SurroundFrame.jsx frontend/src/modules/Surround/SurroundFrame.scss frontend/src/modules/Surround/SurroundFrame.test.jsx
git commit -m "feat(surround): generalize the media box to a corpus-declared aspect ratio"
```

---

### Task 5: Frontend — `PlaceCarousel` fallback chain + caption fix

**Files:**
- Modify: `frontend/src/modules/Surround/modules/countryMapPayload.js`
- Modify: `frontend/src/modules/Surround/modules/PlaceCarousel.jsx`
- Test: `frontend/src/modules/Surround/modules/PlaceCarousel.test.jsx`
- Test: `frontend/src/modules/Surround/modules/countryMapPayload.test.js`
  (create if it does not exist — check first)

**Interfaces:**
- Consumes: `data.piece.map`, `data.piece.city_image` (new, optional,
  same shape as the existing `composer.map`/`composer.city_image`).
- Produces: `mapPinFrom(data)` now also returns `source: 'piece'|'composer'`.

- [ ] **Step 1: Check for an existing `countryMapPayload` test file**

Run: `ls frontend/src/modules/Surround/modules/countryMapPayload.test.js 2>&1`

If it exists, add to it; if not, create it fresh with just the imports the
next step needs (`import { mapPinFrom } from './countryMapPayload.js';`
plus `describe`/`it`/`expect` from `vitest`).

- [ ] **Step 2: Write the failing tests**

```js
describe('mapPinFrom — piece/composer fallback', () => {
  it('prefers the piece’s own map over the composer’s', () => {
    const data = {
      piece: { map: { country: 'Italy', city: 'Padua', lat: 45.41, lon: 11.88 } },
      composer: { map: { country: 'United Kingdom', city: 'Stratford-upon-Avon', lat: 52.19, lon: -1.71 } },
    };
    expect(mapPinFrom(data)).toEqual({
      country: 'Italy', city: 'Padua', lat: 45.41, lon: 11.88, source: 'piece',
    });
  });

  it('falls back to the composer’s map when the piece authors none', () => {
    const data = { composer: { map: { country: 'United Kingdom', city: 'Stratford-upon-Avon', lat: 52.19, lon: -1.71 } } };
    expect(mapPinFrom(data)).toEqual({
      country: 'United Kingdom', city: 'Stratford-upon-Avon', lat: 52.19, lon: -1.71, source: 'composer',
    });
  });

  it('returns null when neither authors a map', () => {
    expect(mapPinFrom({})).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/modules/Surround/modules/countryMapPayload.test.js`
Expected: FAIL — no `source` field, and the piece-map case returns the
composer's pin instead.

- [ ] **Step 4: Generalize `mapPinFrom`**

Replace the body of `countryMapPayload.js`:

```js
export function mapPinFrom(data) {
  const pieceMap = data?.piece?.map ?? null;
  const composerMap = data?.composer?.map ?? null;
  const source = (typeof pieceMap?.country === 'string' && pieceMap.country.trim()) ? 'piece'
    : (typeof composerMap?.country === 'string' && composerMap.country.trim()) ? 'composer'
    : null;
  if (!source) return null;
  const map = source === 'piece' ? pieceMap : composerMap;
  return {
    country: map.country.trim(),
    city: typeof map?.city === 'string' && map.city.trim() ? map.city.trim() : null,
    lat: coord(map?.lat),
    lon: coord(map?.lon),
    source,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/modules/Surround/modules/countryMapPayload.test.js`
Expected: PASS.

- [ ] **Step 6: Write the failing PlaceCarousel tests (photo slide + caption gate)**

Add to `PlaceCarousel.test.jsx`, in the "the slides" describe block:

```js
it('prefers the piece’s own city photo and caption over the composer’s', () => {
  const data = {
    ...DATA,
    piece: { ...DATA.piece, city_image: 'shrew/padua.jpg', map: { country: 'Italy', city: 'Padua', caption: 'Padua — where the play is set' } },
  };
  const view = renderCarousel({ data });
  expect(view.kind()).toBe('photo');
  expect(view.getByTestId('surround-place-photo').getAttribute('src'))
    .toBe(`${window.location.origin}/api/v1/static/img/surround/classical/shrew/padua.jpg`);
  expect(view.caption().textContent).toBe('Padua — where the play is set');
});

it('captions a piece-sourced country map with the bare label, never a biographical sentence', async () => {
  const data = {
    ...DATA,
    piece: { ...DATA.piece, map: { country: 'Italy', city: 'Padua' } },
  };
  const view = renderCarousel({ data });
  view.at(0);
  await settle();
  // Advance past the photo slide to the map slide.
  await act(async () => { vi.advanceTimersByTime?.(PLACE_SLIDE_MS); });
  // If fake timers are not enabled in this file, drive the index directly
  // through the carousel's own interval by checking the SECOND built slide
  // instead of relying on wall-clock advance — see existing "shows the map
  // as its second slide" test above for the established pattern in this
  // file and mirror it exactly rather than introducing a new timer idiom.
});
```

The second test's exact mechanics (advancing to the map slide) must mirror
whatever idiom the existing "shows the map as its second slide, captioned by
the country alone" test in this same file already uses (fake timers vs.
`rerender`) — read that test first and copy its pattern precisely rather
than guessing; this plan intentionally does not restate it to avoid
duplicating a pattern it can drift from.

- [ ] **Step 7: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/modules/Surround/modules/PlaceCarousel.test.jsx -t "piece"`
Expected: FAIL — photo/caption still read from `composer`.

- [ ] **Step 8: Generalize the photo slide and gate the biographical captions**

In `PlaceCarousel.jsx`, inside the `slides` `useMemo` (~line 89-212):

```js
const pin = mapPinFrom(data);
const map = pin?.source === 'piece' ? (data?.piece?.map ?? null) : (data?.composer?.map ?? null);
const city = trimmed(map?.city);
const photoSrc = assetUrl(data?.assetBase, data?.piece?.city_image ?? composer?.city_image);
```

(Replace the existing `const map = composer?.map ?? null;` and the
`composer?.city_image` reference in the photo block with the two lines
above — `photoSrc` now prefers `data.piece.city_image`.)

For the country/city map captions, replace:

```js
const countryCaption = countryCaptionFor(composer);
```

with:

```js
const countryCaption = pin?.source === 'composer'
  ? countryCaptionFor(composer)
  : { text: pin.country, kind: 'label' };
```

and replace:

```js
const cityCaption = cityCaptionFor(composer, { photoTookCaption });
```

with:

```js
const cityCaption = pin?.source === 'composer'
  ? cityCaptionFor(composer, { photoTookCaption })
  : { text: pin.city, kind: 'label' };
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/modules/Surround/modules/PlaceCarousel.test.jsx`
Expected: PASS, including every pre-existing test (the composer-only path
is unchanged — `pin.source === 'composer'` is the default whenever no
`piece.map` is authored, which is every shipped classical work today).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/modules/Surround/modules/countryMapPayload.js frontend/src/modules/Surround/modules/countryMapPayload.test.js frontend/src/modules/Surround/modules/PlaceCarousel.jsx frontend/src/modules/Surround/modules/PlaceCarousel.test.jsx
git commit -m "feat(surround): piece-first map/city_image fallback, gate biographical captions to composer-sourced pins"
```

---

### Task 6: Frontend — new `PlayCard` module

**Files:**
- Create: `frontend/src/modules/Surround/modules/PlayCard.jsx`
- Create: `frontend/src/modules/Surround/modules/PlayCard.scss`
- Create: `frontend/src/modules/Surround/modules/playCardTiming.js`
- Test: `frontend/src/modules/Surround/modules/PlayCard.test.jsx`

**Interfaces:**
- Consumes: `data.piece.{title,genre,setting}`, `data.facts`,
  `characterPool(data, index)` (Task 3), `segmentAt` (`../segments.js`,
  already used by `CueTicker`/`WorkPlacard`), the module contract
  (`position, duration, playing, seeking, data, region, logger`).
- Produces: registered as `'play-card'` (Task 7) for the `right` region.

- [ ] **Step 1: Write the timing constant file**

```js
// frontend/src/modules/Surround/modules/playCardTiming.js
//
// PlayCard's rotation timing, split out so Fast Refresh can hot-reload the
// card on its own — same idiom as composerCardTiming.js.
import { DISSOLVE_FADE_MS, DISSOLVE_HOLD_MS } from '../dissolve.js';

export const PLAY_FACT_FADE_MS = DISSOLVE_FADE_MS;
export const PLAY_FACT_HOLD_MS = DISSOLVE_HOLD_MS;
/** Coprime with the footer ticker's 20s and the composer card's 27s. */
export const PLAY_FACT_INTERVAL_MS = 23000;
```

- [ ] **Step 2: Write the failing tests**

```jsx
// frontend/src/modules/Surround/modules/PlayCard.test.jsx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import * as sass from 'sass-embedded';
import PlayCard, { PLAY_FACT_INTERVAL_MS } from './PlayCard.jsx';
import { registerSurroundBuiltins, SURROUND_BUILTIN_MODULES } from '../builtins.js';
import { getSurroundRegistry, resetSurroundRegistry } from '../registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __sassCache = new Map();
const compileSheetOnce = (file) => {
  if (!__sassCache.has(file)) __sassCache.set(file, sass.compile(file));
  return __sassCache.get(file);
};

const makeLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() });

const DATA = {
  contentId: 'plex:697661',
  assetBase: 'surround/drama',
  piece: { title: 'The Taming of the Shrew', genre: 'Comedy', setting: 'Padua, Italy' },
  facts: ['Written around 1590-1592.'],
  characters: [
    { name: 'Petruchio', role: 'a gentleman of Verona', description: 'A fortune-hunter.' },
  ],
  segments: [{ n: 1, label: 'Scene 1', contentId: 'plex:697661', start: 0, duration: 100, ancestors: [] }],
};

const renderCard = ({ data = DATA, position = 0, logger = makeLogger() } = {}) => {
  const props = (p) => ({
    position: p, duration: 7567, playing: true, seeking: false,
    data, region: { module: 'play-card', width: '33%' }, logger,
  });
  const view = render(<PlayCard {...props(position)} />);
  return { ...view, logger, at: (p) => view.rerender(<PlayCard {...props(p)} />) };
};

describe('PlayCard', () => {
  beforeEach(() => { resetSurroundRegistry(); registerSurroundBuiltins(); });
  afterEach(() => { resetSurroundRegistry(); });

  it('is registered under play-card, for the right rail', () => {
    expect(getSurroundRegistry().has('play-card')).toBe(true);
    expect(SURROUND_BUILTIN_MODULES).toContain('play-card');
    expect(getSurroundRegistry().getMeta('play-card')).toEqual({ regions: ['right'] });
  });

  it('renders the play’s own identity — title, genre, setting', () => {
    const { container } = renderCard();
    expect(container.querySelector('.surround-play-card__title')).toHaveTextContent('The Taming of the Shrew');
    expect(container.querySelector('.surround-play-card__genre')).toHaveTextContent('Comedy');
    expect(container.querySelector('.surround-play-card__setting')).toHaveTextContent('Padua, Italy');
  });

  it('rotates through work-level facts and character cards in one pool', () => {
    const { container } = renderCard();
    const text = container.querySelector('.surround-play-card__fact-line')?.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  it('renders nothing when the payload carries no piece identity at all', () => {
    const { container } = renderCard({ data: { contentId: 'plex:1', assetBase: 'surround/drama' } });
    expect(container.querySelector('.surround-play-card')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/modules/Surround/modules/PlayCard.test.jsx`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 4: Implement `PlayCard.jsx`**

```jsx
// frontend/src/modules/Surround/modules/PlayCard.jsx
//
// The rail's identity panel for a stage work — what ComposerCard is to a
// composer, this is to the PLAY: title, genre, setting, and one rotating
// pool mixing work-level facts with hierarchy-scoped character cards
// (segments.js#characterPool). Unlike ComposerCard, this card is
// CLOCK-AWARE: which characters are in scope, and how they read, changes
// with the Act that is playing, so position/contentId are read rather than
// ignored.
import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { smartQuotes, smartQuotesAll, trimmed } from '../typography.js';
import { surroundLogger } from '../moduleKit.js';
import { useDissolve } from '../dissolve.js';
import { segmentAt, factPool, characterPool, isComposedContainer } from '../segments.js';
import { PLAY_FACT_INTERVAL_MS, PLAY_FACT_FADE_MS } from './playCardTiming.js';
import './PlayCard.scss';

const NO_FACT = Object.freeze({ key: 'empty', text: '' });
const FACT_DISSOLVE = Object.freeze({ hasContent: (v) => Boolean(v?.text) });

const formatCharacter = (c) => {
  const parts = [c.name];
  if (c.role) parts[0] = `${c.name}, ${c.role}`;
  const head = parts[0];
  return c.description ? `${head} — ${c.description}` : head;
};

export default function PlayCard({
  position = 0,
  // eslint-disable-next-line no-unused-vars
  duration = 0,
  // eslint-disable-next-line no-unused-vars
  playing = false,
  // eslint-disable-next-line no-unused-vars
  seeking = false,
  data = null,
  // eslint-disable-next-line no-unused-vars
  region = null,
  logger = null,
}) {
  const log = useMemo(() => surroundLogger(logger, 'play-card'), [logger]);
  const contentId = data?.contentId ?? null;
  const piece = data?.piece ?? null;

  // Which segment is sounding, so characterPool() reads the right hierarchy
  // level — same three-call shape WorkPlacard/CueTicker already use.
  const container = isComposedContainer(data);
  const rail = useMemo(() => (Array.isArray(data?.segments) ? data.segments : []), [data]);
  const mapped = useMemo(
    () => (rail.length ? segmentAt({ segments: rail, contentId, position }) : null),
    [rail, contentId, position],
  );
  const railIndex = container ? (mapped?.index ?? -1) : -1;

  const pool = useMemo(() => {
    const facts = smartQuotesAll(factPool(data, railIndex));
    const characters = characterPool(data, railIndex).map((c) => smartQuotes(formatCharacter(c)));
    return [...facts, ...characters];
  }, [data, railIndex]);

  const [factIndex, setFactIndex] = useState(0);
  useEffect(() => { setFactIndex(0); }, [railIndex, contentId]);
  useEffect(() => {
    if (pool.length < 2) return undefined;
    const id = setInterval(() => setFactIndex((i) => i + 1), PLAY_FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pool.length]);

  const nextFact = useMemo(() => {
    if (!pool.length) return NO_FACT;
    const i = ((factIndex % pool.length) + pool.length) % pool.length;
    return { key: `fact:${i}`, text: pool[i] };
  }, [pool, factIndex]);

  const [shownFact, factHidden] = useDissolve(nextFact, FACT_DISSOLVE);

  useEffect(() => {
    if (!shownFact.text) return;
    log.debug('surround.play-fact.shown', { contentId });
  }, [shownFact, contentId, log]);

  const title = smartQuotes(trimmed(piece?.title));
  const genre = smartQuotes(trimmed(piece?.genre));
  const setting = smartQuotes(trimmed(piece?.setting));
  const hasIdentity = Boolean(title || genre || setting);

  if (!hasIdentity && !shownFact.text) return null;

  return (
    <div className="surround-play-card" data-testid="surround-play-card">
      {hasIdentity && (
        <div className="surround-play-card__header" data-testid="surround-play-header">
          {title && <h2 className="surround-play-card__title">{title}</h2>}
          {genre && <p className="surround-play-card__genre">{genre}</p>}
          {setting && <p className="surround-play-card__setting">{setting}</p>}
        </div>
      )}
      {shownFact.text && (
        <div className="surround-play-card__fact-zone" data-testid="surround-play-fact-zone">
          <hr className="surround-play-card__fact-rule" />
          <p
            className={`surround-play-card__fact${factHidden ? ' surround-play-card__fact--hidden' : ''}`}
            data-testid="surround-play-fact"
            style={{ transition: `opacity ${PLAY_FACT_FADE_MS}ms ease` }}
          >
            <span className="surround-play-card__fact-line">{shownFact.text}</span>
          </p>
        </div>
      )}
    </div>
  );
}

PlayCard.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};

export { PLAY_FACT_INTERVAL_MS };
```

- [ ] **Step 5: Write `PlayCard.scss`**

Reuse `ComposerCard.scss`'s header/fact-zone structure verbatim (same
tokens, same class shapes, minus the portrait/nameplate markup this card
has no use for):

```scss
@use "../tokens" as *;

.surround-play-card {
  height: 100%;
  container-type: size;
  padding: 1rem 1rem 1.1rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--surround-display, "Cormorant Garamond", Georgia, serif);
  color: var(--ink, #2a1d07);
}

.surround-play-card__header {
  flex: 0 0 auto;
  text-align: center;
}

.surround-play-card__title {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 600;
  line-height: 1.2;
}

.surround-play-card__genre {
  margin: 0.35rem 0 0;
  font-size: var(--label-floor, #{$label-floor});
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-soft, #6b6152);
}

.surround-play-card__setting {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-soft, #6b6152);
}

.surround-play-card__fact-zone {
  flex: 0 0 auto;
  margin: auto 0;
  width: 100%;
}

.surround-play-card__fact-rule {
  width: 100%;
  height: 1px;
  margin: 0 0 0.6rem;
  border: 0;
  background: var(--programme-edge, #ddd0b4);
}

.surround-play-card__fact {
  margin: 0;
  flex: 0 0 auto;
  font-size: clamp(0.85rem, 5.4cqh, 1.35rem);
  line-height: 1.35;
  min-height: 4.05em;
  max-height: 4.05em;
  display: grid;
  align-content: center;
  overflow: hidden;
  text-align: center;
  font-family: var(--surround-body, "EB Garamond", Georgia, serif);
  font-weight: 500;
  color: var(--ink-soft, #6b6152);
  opacity: 1;
}

.surround-play-card__fact--hidden {
  opacity: 0;
}

.surround-play-card__fact-line {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .surround-play-card__fact {
    transition: none !important;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/modules/Surround/modules/PlayCard.test.jsx`
Expected: FAIL still on the two registration-related tests (`play-card`
is not registered yet — that's Task 7) but PASS on the identity/pool/
null-render tests. This is expected; do not skip ahead.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Surround/modules/PlayCard.jsx frontend/src/modules/Surround/modules/PlayCard.scss frontend/src/modules/Surround/modules/playCardTiming.js frontend/src/modules/Surround/modules/PlayCard.test.jsx
git commit -m "feat(surround): add PlayCard, the rail's play-identity module"
```

---

### Task 7: Frontend — register `play-card` in `builtins.js`

**Files:**
- Modify: `frontend/src/modules/Surround/builtins.js`
- Test: `frontend/src/modules/Surround/registry.test.js`

**Interfaces:**
- Consumes: `PlayCard` from Task 6.
- Produces: `'play-card'` resolvable via `getSurroundRegistry().get('play-card')`, region `['right']`.

- [ ] **Step 1: Update the exact-set test first (it will fail on purpose)**

In `registry.test.js`, the "declares the modules the frame resolves by
name" test (~line 98-105) asserts an exact sorted array. Add `'play-card'`
to it, alphabetically:

```js
expect([...SURROUND_BUILTIN_MODULES].sort())
  .toEqual([
    'composer-card', 'country-map', 'cue-ticker', 'libretto', 'movement-map',
    'place-carousel', 'play-card', 'script-rail', 'segment-map', 'work-placard',
  ]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/modules/Surround/registry.test.js`
Expected: FAIL — `play-card` is not yet in `SURROUND_BUILTIN_MODULES`, and
the "registers exactly the builtin names it declares" test fails too since
`PlayCard.test.jsx`'s own registration assertion (Task 6, Step 2) is also
still failing.

- [ ] **Step 3: Register the module**

In `builtins.js`, add the import and the registration row:

```js
import PlayCard from './modules/PlayCard.jsx';
```

```js
const BUILTIN_MODULES = [
  ['segment-map', SegmentMap, { regions: ['bottom'] }],
  ['cue-ticker', CueTicker, { regions: ['bottom'] }],
  ['composer-card', ComposerCard, { regions: ['right'] }],
  ['country-map', CountryMapModule, { regions: ['right', 'bottom'] }],
  ['place-carousel', PlaceCarousel, { regions: ['right'] }],
  ['play-card', PlayCard, { regions: ['right'] }],
  ['work-placard', WorkPlacard, { regions: ['top'] }],
  ['script-rail', ScriptRail, { regions: ['lyric'] }],
];
```

- [ ] **Step 4: Run the registry and PlayCard tests to verify they pass**

Run: `cd frontend && npx vitest run src/modules/Surround/registry.test.js src/modules/Surround/modules/PlayCard.test.jsx`
Expected: PASS, all tests in both files.

- [ ] **Step 5: Run the full frontend Surround test suite**

Run: `cd frontend && npx vitest run src/modules/Surround/`
Expected: PASS, no regressions anywhere in the module tree (including
`builtins.integration.test.jsx`, which iterates every builtin name).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Surround/builtins.js frontend/src/modules/Surround/registry.test.js
git commit -m "feat(surround): register play-card as a builtin rail module"
```

---

### Task 8: Docs — update design.md's aspect-ratio quality floor

**Files:**
- Modify: `docs/reference/player/surround/design.md`

- [ ] **Step 1: Update the Quality floor bullet**

Find (in the "Quality floor" section):

```
- 16:9 is inviolable — letterbox, never distort.
```

Replace with:

```
- The corpus's declared aspect ratio is inviolable — letterbox or
  pillarbox, never distort. 16:9 is the default when a work authors none.
```

- [ ] **Step 2: Commit**

```bash
git add docs/reference/player/surround/design.md
git commit -m "docs(surround): generalize the 16:9 quality-floor line to any declared aspect ratio"
```

---

### Task 9: Content — author the `drama` corpus for the pilot play

**Files (data volume, not git — `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data`):**
- Create: `data/content/library/drama/shakespeare/_composer.yml`
- Create: `data/content/library/drama/shakespeare/taming-of-the-shrew.yml`
- Create: `data/content/surround/_surrounds/playhouse.yml`

This is content authoring, not TDD — there is no failing test to write for
"is this fact about Shakespeare true." Each step is still a small, concrete,
independently-checkable action.

- [ ] **Step 1: Author `_composer.yml`**

Verify every fact against the offline Wikipedia service (`CLAUDE.local.md`
has the host) before writing it, same discipline as the classical skill:

```yaml
name: William Shakespeare
born: 1564
died: 1616
birthplace: Stratford-upon-Avon
nationality: English
period: "Elizabethan and Jacobean"
period_note: "The English theatre's golden age — the public playhouse, at the height of its popularity, in the years just before Puritan pressure closed it."
summary: >
  The most performed playwright in the English language, working across
  comedy, history and tragedy for the Lord Chamberlain's Men (later the
  King's Men) at the Globe and Blackfriars theatres.
map: { country: "United Kingdom", city: "Stratford-upon-Avon", lat: 52.19, lon: -1.71, caption: "Stratford-upon-Avon — his birthplace and the town he returned to" }
facts:
  - "..."   # verified against the offline Wikipedia service before writing
```

- [ ] **Step 2: Extract the Act/Scene structure and settings from the Cliffs Complete PDF**

Read `TV Shows/Shakespeare/Season 1/Shakespeare - S01E13 - The Taming Of
The Shrew (Cliffs Complete).pdf`'s table of contents (already captured
during spec research: Induction 2 scenes, Act I 2 scenes, Act II 1 scene,
Act III 2 scenes, Act IV 5 scenes, Act V 2 scenes) and each scene's setting
line (e.g. "Padua. A public place.").

- [ ] **Step 3: Author `taming-of-the-shrew.yml`**

Following the corpus schema exactly as the spec's example shows: `title`,
`genre: Comedy`, `setting: "Padua, Italy"`, `composed`, `year`,
`aspectRatio: "4 / 3"`, `summary`, work-level `characters:` (baseline
roster — cross-reference names/roles against the Cliffs Complete character
map AND the Plex show's own `Role` list captured during spec research,
e.g. "Sarah Badel — Katherina"), sparse work-level `facts:`, and one
`groups:` entry per Act (`kind: act`) each with `facts:` (Act-level
commentary, adapted from the Cliffs Complete commentary sections —
paraphrased, never copied verbatim, since the prose is copyrighted) and
`segments:` (one per Scene, `heading:` set to the scene's setting line,
`listen:` with 1-2 watch-for notes). Author the Induction as two segments
too, even though this production's timing for them will be `null` (see
Task 10) — the corpus describes the PLAY, independent of any one
recording.

Add a per-Act `characters:` override for at least one character whose
Cliffs Complete commentary marks a turning point (Petruchio at Act IV is
the documented example in the spec) to exercise the override-by-name path
for real, not just in a unit test fixture.

- [ ] **Step 4: Author `playhouse.yml`**

Exactly the definition from the spec's "New presentation definition"
section:

```yaml
id: playhouse
regions:
  top:
    module: work-placard
  right:
    - module: play-card
      width: "33%"
      side: left
    - module: place-carousel
  bottom:
    - { module: segment-map, height: 64 }
    - { module: cue-ticker, height: fill, collapse: first }
collapse:
  footerFloor: 90
```

- [ ] **Step 5: Verify the corpus loads without warnings**

```bash
curl -s "http://localhost:3111/api/v1/play/plex:697661" | jq '.surround.id, .surround.segments | length'
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=context.app:surround AND _time:15m' -d 'limit=50'
```

Expected: `surround.id` is `null` at this point (no sidecar yet — that's
Task 10), but `surround.index.built` should show the `drama` domain's
`pieces`/`composers` counts incrementing with no `surround.work.invalid` /
`surround.composer.duplicate` warnings naming the new files.

---

### Task 10: Content — derive Act/Scene timing, author the sidecar, validate e2e

**Files (data volume):**
- Create: `data/content/surround/drama/shakespeare/taming-of-the-shrew.bbc1980.yml`

- [ ] **Step 1: Extract the reference text for each scene's opening (and closing) line**

From the Cliffs Complete PDF, pull the first ~2 lines of dialogue for each
Scene (already captured for Act I Scene 1 during spec research: "Tranio,
since for the great desire I had / To see fair Padua, nursery of arts...").

- [ ] **Step 2: Fuzzy-match each scene's opening line against the SRT**

The SRT (`Shakespeare - S01E13 - The Taming Of The Shrew.srt`) is ASR
output with speaker labels only ("Speaker 1/2/3") and transcription noise
("Tranio" → "Trollio", confirmed during spec research). Match on content
words (ignore ASR-garbled function words), not exact string equality — a
simple normalized-token-overlap score against a sliding window of
consecutive SRT cues is sufficient given how distinctive Shakespeare's
verse is; do not require exact matches. Confirmed anchor: Act I Scene 1
begins at the SRT's cue 2 (`00:00:41,060`), matching "since for the great
desire I had to see Fair Padua, nurse" — use this as the first verified
`starts` entry and repeat the method for every remaining scene.

- [ ] **Step 3: Record `null` for anything not confidently placed**

This production cuts the Induction (confirmed during spec research — the
SRT opens directly on Act I Scene 1, no Sly/alehouse material anywhere in
the transcript). Both Induction scenes get `starts: null`. Sanity-check
every placed timestamp against the scene's approximate expected position
(Act V should not start before Act IV's scenes do) before writing it down.

- [ ] **Step 4: Author the sidecar**

```yaml
work: shakespeare/taming-of-the-shrew
surround: playhouse
match:
  contentId: plex:697661
  title: "The Taming of the Shrew"
performance: "BBC Television Shakespeare, 1980"
starts: [null, null, 42, ...]   # one entry per corpus segment, Induction scenes null
```

(The `starts` array's exact remaining values come from Step 2's method
applied to every scene — not predetermined by this plan, which cannot
transcribe the SRT in advance any more than the classical skill's audio
tiers can pre-derive a recording's timings before listening to it.)

- [ ] **Step 5: Validate live**

```bash
curl -s "http://localhost:3111/api/v1/play/plex:697661" | jq '.surround.id, .surround.segments | length, .surround.piece.aspectRatio'
```

Expected: `surround.id` is `"playhouse"`, segment count matches the
authored corpus (Induction's 2 + every Act's scenes), `piece.aspectRatio`
is `"4 / 3"`.

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=context.app:surround AND _time:15m' -d 'limit=50'
```

Expected: no `surround.sidecar.invalid`, `surround.work.missing`,
`surround.starts.mismatch`, or `surround.segments.none` naming this
sidecar. A `surround.segments.untimed` event naming the two null Induction
entries is expected and benign (per the classical README's own note on
this event).

- [ ] **Step 6: Confirm the rendered frame, if a browser session is available**

Using the `run` skill or a manual browser check against the household's
player: confirm the video pillarboxes (4:3 in a wider stage), `PlayCard`
shows title/genre/setting and rotates through facts and character cards,
the Act/Scene rail shows the current Act's scenes expanded with others
folded, and the band's left zone reads as Act commentary while the right
reads as the current scene's watch-for notes. If no interactive browser
session is available in this environment, record this step as
CLI-verified-only (the curl checks above) and flag the visual check as
outstanding for whoever next has kiosk/browser access — do not claim
visual confirmation that was not actually performed.

- [ ] **Step 7: Final full-suite regression check**

```bash
cd backend && npx vitest run src/1_adapters/content/surround/
cd frontend && npx vitest run src/modules/Surround/
```

Expected: PASS, zero regressions across both trees — this is the plan's
closing gate.
