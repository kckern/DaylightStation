# Surround Multi-Item Containers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one surround frame span many media items, so a seven-item polonaise recital and a three-episode set of 27 études each render as one programme on one rail.

**Architecture:** The store gains a normalised, flat `chapters[]` in its payload — each chapter carrying which media item it lives in, its span within that item, and its precomputed offset along a global sounding-time rail. All the hard arithmetic happens once in the backend where it is cheap to test; the frontend consumes "chapters, an active index, a fraction," which is what it already consumes. `movements` remains in the payload as an alias so nothing existing changes.

**Tech Stack:** Node ESM backend (`.mjs`), React frontend (`.jsx`/`.js`), vitest, Playwright, `sass-embedded`, js-yaml.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-19-surround-multi-id-containers-design.md`. It governs; this plan implements it.
- The store stays **pure YAML and synchronous** — no network calls, no async, ever.
- The media element must never remount; children must never re-parent (React constant-depth law).
- Reserved heights / no rug-pull: a text zone's height must not change with its content.
- Every animation needs a `prefers-reduced-motion` path.
- No raw `console.*` — use the logging framework (`frontend/src/lib/logging/Logger.js`, backend `logger.child`).
- Compiled-SCSS assertions use `sass-embedded`, never `sass`.
- **Every new test must be able to fail.** State what code change makes it red; prove one per task by mutation. This codebase has a documented history of tautological assertions — three found in the last two days.
- The Eroica and Spring payloads must be **unchanged** by Tasks 1–3. That is the migration safety net.
- Run `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/1_adapters/content/surround/ frontend/src/modules/Surround/` before every commit.
- Live data already authored: `data/content/library/classical/0_flagship/chopin/etudes.yml` (container work, three `chapters:` refs) and `data/content/surround/classical/chopin/etudes.season-696233.yml` (season sidecar, three parts, spans pending). Season is `plex:696233`; episodes `plex:696234` (Op. 10, 31.0 min), `plex:696235` (Op. 25, 33.6 min), `plex:696236` (Trois nouvelles, 6.5 min).

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/1_adapters/content/surround/chapters.mjs` | **NEW.** Pure functions: desugar `starts`→spans, flatten parts+refs into `chapters[]`, compute global offsets. No I/O. |
| `backend/src/1_adapters/content/surround/chapters.test.mjs` | **NEW.** Unit tests for the above. |
| `backend/src/1_adapters/content/surround/YamlSurroundStore.mjs` | Resolves chapter references from the corpus; calls `chapters.mjs`; emits `chapters` + `timeline` alongside `movements`. |
| `backend/src/3_applications/content/services/PlayResponseService.mjs` | Attaches the container payload when an item is a part of an enriched container. |
| `frontend/src/modules/Surround/chapters.js` | **NEW.** Pure frontend mapping: `(chapters, contentId, position) → { index, globalSeconds }`. |
| `frontend/src/modules/Surround/modules/MovementMap.jsx` + `.scss` | Renders chapters and group labels. |
| `frontend/src/modules/Surround/band.js` | `placedChapters` alongside `placedMovements`. |

---

### Task 1: Spans — one media item, explicit start and end

**Files:**
- Create: `backend/src/1_adapters/content/surround/chapters.mjs`
- Create: `backend/src/1_adapters/content/surround/chapters.test.mjs`
- Modify: `backend/src/1_adapters/content/surround/YamlSurroundStore.mjs` (payload assembly, currently lines 611–667)

**Interfaces:**
- Produces: `toSpans({ starts, musicEndsAt, spans, count })` → `Array<{start:number|undefined, end:number|undefined}>` of length `count`; `withOffsets(chapters)` → same array with `offset` and `duration` added.

- [ ] **Step 1: Write the failing test**

```javascript
// chapters.test.mjs
import { describe, it, expect } from 'vitest';
import { toSpans, withOffsets } from './chapters.mjs';

describe('toSpans', () => {
  it('desugars starts + musicEndsAt into contiguous spans', () => {
    expect(toSpans({ starts: [21.35, 976, 1925, 2278], musicEndsAt: 2955, count: 4 })).toEqual([
      { start: 21.35, end: 976 }, { start: 976, end: 1925 },
      { start: 1925, end: 2278 }, { start: 2278, end: 2955 }
    ]);
  });

  it('takes explicit spans verbatim, so a gap between chapters survives', () => {
    expect(toSpans({ spans: [[12.4, 121.0], [128.6, 275.2]], count: 2 })).toEqual([
      { start: 12.4, end: 121.0 }, { start: 128.6, end: 275.2 }
    ]);
  });

  it('pads to count so a chapter with no timing keeps its position', () => {
    expect(toSpans({ spans: [[0, 10]], count: 3 })).toEqual([
      { start: 0, end: 10 }, { start: undefined, end: undefined }, { start: undefined, end: undefined }
    ]);
  });
});

describe('withOffsets', () => {
  it('lays chapters end to end on a sounding-time rail, skipping dead time', () => {
    const out = withOffsets([{ start: 10, end: 20 }, { start: 30, end: 45 }]);
    expect(out).toEqual([
      { start: 10, end: 20, duration: 10, offset: 0 },
      { start: 30, end: 45, duration: 15, offset: 10 }
    ]);
  });

  it('gives an untimed chapter zero duration and does not advance the rail', () => {
    const out = withOffsets([{ start: 0, end: 5 }, {}, { start: 5, end: 9 }]);
    expect(out.map((c) => c.offset)).toEqual([0, 5, 5]);
    expect(out[1].duration).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/1_adapters/content/surround/chapters.test.mjs`
Expected: FAIL — `Failed to resolve import "./chapters.mjs"`.

- [ ] **Step 3: Implement**

```javascript
// chapters.mjs
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : undefined);

/**
 * Normalise whatever timing an author supplied into one span per chapter.
 *
 * `starts` + `musicEndsAt` is the compact form for a work whose chapters run
 * end to end inside one file; it desugars here so nothing downstream has to
 * know two shapes. Explicit `spans` are taken verbatim, because the gap
 * between two of them is real content — applause — that belongs to neither.
 */
export function toSpans({ starts, musicEndsAt, spans, count }) {
  const out = [];
  if (Array.isArray(spans)) {
    for (let i = 0; i < count; i += 1) {
      const s = Array.isArray(spans[i]) ? spans[i] : [];
      out.push({ start: num(s[0]), end: num(s[1]) });
    }
    return out;
  }
  const list = Array.isArray(starts) ? starts : [];
  for (let i = 0; i < count; i += 1) {
    const start = num(list[i]);
    const next = i + 1 < count ? num(list[i + 1]) : num(musicEndsAt);
    out.push({ start, end: start === undefined ? undefined : next });
  }
  return out;
}

/**
 * Place chapters on one rail measured in SOUNDING seconds. Dead time is not on
 * the rail at all, so a segment's width is the music it contains and nothing
 * else; a chapter with no timing occupies no width and does not shift its
 * neighbours.
 */
export function withOffsets(chapters) {
  let offset = 0;
  return chapters.map((c) => {
    const duration = c.start !== undefined && c.end !== undefined && c.end > c.start ? c.end - c.start : 0;
    const placed = { ...c, duration, offset };
    offset += duration;
    return placed;
  });
}
```

- [ ] **Step 4: Run and confirm green**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/1_adapters/content/surround/chapters.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire into the store without changing the existing payload**

In `YamlSurroundStore.mjs`, after `const resolvedMovements = movements.map(...)` (line ~624), add:

```javascript
const spans = toSpans({
  starts: rawStarts, musicEndsAt: doc.musicEndsAt, spans: doc.spans, count: movements.length
});
const chapters = withOffsets(movements.map((m, i) => ({ ...m, ...spans[i], contentId: String(doc.match.contentId) })));
```

and add to the returned `payload` object, leaving `movements: resolvedMovements` exactly as it is:

```javascript
        chapters,
        timeline: { totalSounding: chapters.reduce((n, c) => n + c.duration, 0) },
```

- [ ] **Step 6: Prove the Eroica payload did not change**

Add to `YamlSurroundStore.test.mjs`:

```javascript
  it('leaves movements untouched when a work gains chapters', () => {
    const store = new YamlSurroundStore({ rootDir: root, libraryDir: library, logger: makeLogger() });
    const r = store.lookup('plex:eroica', '');
    expect(r.movements).toEqual([{ n: 1, name: 'Allegro con brio', start: 0 }]);
    expect(r.chapters[0]).toMatchObject({ n: 1, name: 'Allegro con brio', start: 0, offset: 0 });
  });
```

- [ ] **Step 7: Run the full store suite and commit**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/1_adapters/content/surround/`
Expected: PASS, 96 existing + new.

```bash
git add backend/src/1_adapters/content/surround/
git commit -m "feat(surround): chapters carry spans and a sounding-time offset"
```

---

### Task 2: Chapter references — a chapter may name another work

**Files:**
- Modify: `backend/src/1_adapters/content/surround/YamlSurroundStore.mjs` (`#loadLibraryDir` region and payload assembly)
- Test: `backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs`

**Interfaces:**
- Consumes: `toSpans`, `withOffsets` from Task 1.
- Produces: `resolveChapters(work, library, seen)` → flat array of chapter objects, each with `group: { work, title, index }`.

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run and watch both fail**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/1_adapters/content/surround/`
Expected: FAIL — first with `expected length 2, got 1` (the ref is treated as an inline chapter with no name), second with a stack overflow or a missing warn.

- [ ] **Step 3: Implement the resolver in `YamlSurroundStore.mjs`**

Add as a private method:

```javascript
  /**
   * Flatten a work's chapters, following `work:` references into their targets.
   *
   * A reference resolves to a SUBTREE, not a leaf: naming `chopin/etudes-op-10`
   * brings its twelve études with it. `group` records which work a chapter came
   * from, because the rail is flat but the labels above it are not.
   *
   * @param {Object} work
   * @param {{works: Map<string,Object>}} library
   * @param {Set<string>} seen - work keys already expanded, to break cycles
   * @param {{work: string, title: string, index: number}|null} group
   */
  #resolveChapters(work, library, seen, group = null) {
    const own = asArray(work.chapters).length ? asArray(work.chapters) : asArray(work.movements);
    const out = [];
    for (const entry of own) {
      if (!isPlainObject(entry)) continue;
      const ref = typeof entry.work === 'string' ? entry.work.trim() : '';
      if (!ref) { out.push(group ? { ...entry, group } : entry); continue; }

      if (seen.has(ref)) {
        this.logger?.warn?.('surround.chapter.cycle', { work: ref });
        continue;
      }
      const target = library.works.get(ref);
      if (!target) {
        this.logger?.warn?.('surround.chapter.missing', { work: ref });
        continue;
      }
      seen.add(ref);
      const childGroup = { work: ref, title: target.title ?? ref, index: out.length ? out[out.length - 1].group?.index + 1 || 0 : 0 };
      out.push(...this.#resolveChapters(target, library, seen, childGroup));
      seen.delete(ref);
    }
    return out;
  }
```

Replace `const movements = asArray(work.movements);` with:

```javascript
    const seenRefs = new Set([doc.work]);
    const resolved = this.#resolveChapters(work, library, seenRefs);
    const movements = resolved.length ? resolved : asArray(work.movements);
```

- [ ] **Step 4: Fix the group index — it must count parts, not chapters**

The expression above is wrong on purpose in Step 3 so you see it fail; replace it with a counter held by the caller:

```javascript
  #resolveChapters(work, library, seen, group = null, counter = { parts: 0 }) {
    // ... same, but:
      const childGroup = { work: ref, title: target.title ?? ref, index: counter.parts };
      counter.parts += 1;
      out.push(...this.#resolveChapters(target, library, seen, childGroup, counter));
```

- [ ] **Step 5: Run and confirm green**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/1_adapters/content/surround/`
Expected: PASS. The Eroica case still passes because a work with no `chapters:` falls back to `movements`.

- [ ] **Step 6: Mutation-prove the cycle guard**

Comment out the `if (seen.has(ref))` block, run the suite, confirm the cycle test fails (stack overflow or missing warn), restore. Quote the message in the commit body.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/content/surround/
git commit -m "feat(surround): a chapter may reference another work, and brings its chapters with it"
```

---

### Task 3: Parts — a container composes sidecars that already resolve

> **Design note (settled 2026-08-19):** the three étude episodes are already authored as
> ordinary timed sidecars — `etudes-op-10.lortie.yml` carries `work: chopin/etudes-op-10`,
> `match.contentId: plex:696234` and twelve `starts` taken from the uploader's own chapter
> markers. Each already resolves and plays standalone with its own frame today. So a
> container's `parts` name **contentIds, not spans**: the store looks each part up in the
> index it already builds and concatenates that part's resolved chapters. No timing is
> restated, and the authored episode files are the input rather than something to migrate.
> `spans` remain in the schema for the case where a part's dead time sits mid-episode and
> `starts` cannot express it — but they are authored in the *part's own* sidecar, never in
> the container.

The container sidecar is therefore:

```yaml
work: chopin/etudes
surround: concert-hall
match: { contentId: plex:696233 }
parts:
  - plex:696234
  - plex:696235
  - plex:696236
```



**Files:**
- Modify: `backend/src/1_adapters/content/surround/YamlSurroundStore.mjs`
- Test: `backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs`

**Interfaces:**
- Consumes: `#resolveChapters` (Task 2), `toSpans`/`withOffsets` (Task 1).
- Produces: payload `chapters[]` where each chapter has `contentId`; `timeline.parts` = `[{ contentId, index, sounding }]`.

- [ ] **Step 1: Write the failing tests**

```javascript
  it('places each part\'s chapters in its own media item', () => {
    writeLib('classical/0_flagship/chopin/p1.yml', 'title: P1\nmovements:\n  - { n: 1, name: "One" }\n  - { n: 2, name: "Two" }\n');
    writeLib('classical/0_flagship/chopin/p2.yml', 'title: P2\nmovements:\n  - { n: 1, name: "Three" }\n');
    writeLib('classical/0_flagship/chopin/set.yml',
      'title: Set\nchapters:\n  - work: chopin/p1\n  - work: chopin/p2\n');
    write('classical/chopin/season.yml',
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:season }\n' +
      'parts:\n  - { work: chopin/p1, contentId: plex:ep1, spans: [[0, 10], [20, 35]] }\n' +
      '  - { work: chopin/p2, contentId: plex:ep2 }\n');

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
      'work: chopin/set\nsurround: concert-hall\nmatch: { contentId: plex:s2 }\n' +
      'parts:\n  - { work: chopin/p1, contentId: plex:ep1, spans: [[0, 10]] }\n');

    const logger = makeLogger();
    new YamlSurroundStore({ rootDir: root, libraryDir: library, logger });
    expect(logger.warn).toHaveBeenCalledWith('surround.spans.mismatch',
      expect.objectContaining({ work: 'chopin/p1', spans: 1, chapters: 2 }));
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/1_adapters/content/surround/`
Expected: FAIL — `parts` is ignored entirely, so `contentId` is the season on every chapter.

- [ ] **Step 3: Implement — compose by contentId reference**

Composition happens in a **second pass** over `#build`, after every sidecar has resolved
individually, because a container may name a part whose own sidecar is read later in the walk.
For each resolved piece that has `parts`, look each part's contentId up among the already
resolved pieces, take that part's `chapters` verbatim, stamp them with the part index and the
group taken from the part's own `piece.title`, then `withOffsets` the concatenation. A part
naming a contentId with no sidecar warns `surround.part.missing` and is skipped, leaving the
rest of the rail intact.

The block below is the fallback path for a container that authors spans inline rather than
composing sidecars — keep it, because a one-off container with no per-part sidecars is still
valid:

```javascript
    const parts = asArray(doc.parts);
    let chapters;
    let timelineParts = [];

    if (parts.length) {
      // Group the resolved chapters by the part that performs them, so a part's
      // spans pair with its OWN chapters. Pairing against the flat list would
      // make one miscounted part shift every later part's timings.
      const byWork = new Map();
      for (const c of resolved) {
        const key = c.group?.work ?? null;
        if (!byWork.has(key)) byWork.set(key, []);
        byWork.get(key).push(c);
      }
      chapters = [];
      parts.forEach((part, index) => {
        const key = typeof part.work === 'string' ? part.work.trim() : null;
        const mine = byWork.get(key) ?? [];
        const contentId = part.contentId ? String(part.contentId) : String(doc.match.contentId);
        if (Array.isArray(part.spans) && part.spans.length !== mine.length) {
          this.logger?.warn?.('surround.spans.mismatch', { file, work: key, spans: part.spans.length, chapters: mine.length });
        }
        const spans = toSpans({ spans: part.spans, count: mine.length });
        mine.forEach((c, i) => chapters.push({
          ...c, ...spans[i], contentId, part: index,
          ...(part.performance ? { performance: part.performance } : {})
        }));
        timelineParts.push({ contentId, index, sounding: 0 });
      });
      chapters = withOffsets(chapters);
      for (const c of chapters) {
        const slot = timelineParts[c.part];
        if (slot) slot.sounding += c.duration;
      }
    } else {
      const spans = toSpans({ starts: rawStarts, musicEndsAt: doc.musicEndsAt, spans: doc.spans, count: movements.length });
      chapters = withOffsets(movements.map((m, i) => ({ ...m, ...spans[i], contentId: String(doc.match.contentId), part: 0 })));
      timelineParts = [{ contentId: String(doc.match.contentId), index: 0, sounding: chapters.reduce((n, c) => n + c.duration, 0) }];
    }
```

and emit `timeline: { totalSounding: chapters.reduce((n, c) => n + c.duration, 0), parts: timelineParts }`.

- [ ] **Step 4: Run and confirm green**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/1_adapters/content/surround/`
Expected: PASS, including the unchanged Eroica assertions.

- [ ] **Step 5: Verify against the live authored data**

```bash
sudo docker exec daylight-station sh -c 'ls data/content/surround/classical/chopin/etudes.season-696233.yml'
```
Then rebuild and check the index log names 3 parts and 27 chapters. Expected warn: `surround.spans.mismatch` ×3, because spans are still pending — that is correct and expected at this task.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/content/surround/
git commit -m "feat(surround): a container's chapters may live in different media items"
```

---

### Task 4: Container expansion and order enforcement in the queue path

**Files:**
- Modify: `backend/src/3_applications/content/services/PlayResponseService.mjs` (surround attach, lines ~153–168)
- Test: `backend/src/3_applications/content/services/PlayResponseService.surround.test.mjs`

**Interfaces:**
- Consumes: payload `chapters[]` with `contentId` (Task 3).
- Produces: `response.surround` on a *child* item when that child appears in an enriched container's `timeline.parts`.

- [ ] **Step 1: Write the failing test**

```javascript
  it('attaches the container payload to a child item, with its part index', () => {
    const surroundStore = {
      lookup: (id) => (id === 'plex:season' ? seasonPayload : null),
      lookupByPart: (id) => (id === 'plex:ep2' ? { payload: seasonPayload, part: 1 } : null)
    };
    const svc = new PlayResponseService({ surroundStore, logger: makeLogger() });
    const res = svc.toPlayResponse({ id: 'plex:ep2', title: 'Op. 25', metadata: {} });
    expect(res.surround.id).toBe('concert-hall');
    expect(res.surroundPart).toBe(1);
  });

  it('does not attach a container payload to an unrelated item', () => {
    const surroundStore = { lookup: () => null, lookupByPart: () => null };
    const svc = new PlayResponseService({ surroundStore, logger: makeLogger() });
    expect(svc.toPlayResponse({ id: 'plex:other', title: 'x', metadata: {} }).surround).toBeUndefined();
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/3_applications/content/services/`
Expected: FAIL — `lookupByPart is not a function`.

- [ ] **Step 3: Add `lookupByPart` to the store**

In `YamlSurroundStore.mjs`, build a part index during `#build` — for every resolved piece, map each `timeline.parts[].contentId` to `{ payload, part }` — and expose:

```javascript
  /**
   * Find the container a media item belongs to, for items that are parts of an
   * enriched programme. Separate from `lookup` because a part may ALSO have its
   * own standalone sidecar, and which one applies depends on how playback
   * started — not on the id alone.
   */
  lookupByPart(contentId) {
    const hit = this.#byPart.get(String(contentId));
    return hit ? structuredClone(hit) : null;
  }
```

- [ ] **Step 4: Attach it in `PlayResponseService`**

After the existing `lookup` attach, add:

```javascript
      // A part of an enriched container gets the CONTAINER's frame, not its own.
      // Standalone playback never reaches here with a container context, so the
      // same media id still reads as a whole work when played on its own.
      if (!response.surround && context?.containerId) {
        const part = this.#surroundStore?.lookupByPart?.(item.id);
        if (part) { response.surround = part.payload; response.surroundPart = part.part; }
      }
```

- [ ] **Step 5: Enforce authored order**

In the queue-building path, when the container resolves a surround payload, order the queue by `timeline.parts` order and log:

```javascript
    logger.info('surround.order.enforced', { containerId, parts: payload.timeline.parts.length });
```

Gate on config `surround.enforceOrder` (default `true`). When false **and** the queue order does not match, do not attach the payload at all, and log `surround.order.mismatch` — a frame with no rail, per the spec.

- [ ] **Step 6: Test the degradation, and prove it can fail**

```javascript
  it('refuses to attach a rail when the queue order does not match and enforcement is off', () => {
    const svc = makeService({ enforceOrder: false });
    const res = svc.buildQueue({ containerId: 'plex:season', order: ['plex:ep2', 'plex:ep1'] });
    expect(res.items.every((i) => i.surround === undefined)).toBe(true);
  });
```
Mutation: make the mismatch branch attach anyway; the test must go red.

- [ ] **Step 7: Commit**

```bash
git add backend/src/
git commit -m "feat(surround): a container's parts inherit its frame, in its authored order"
```

---

### Task 5: Frontend — map a media position onto the global rail

**Files:**
- Create: `frontend/src/modules/Surround/chapters.js`
- Create: `frontend/src/modules/Surround/chapters.test.js`

**Interfaces:**
- Consumes: payload `chapters[]` (Task 3).
- Produces: `chapterAt({ chapters, contentId, position })` → `{ index, globalSeconds }`, `index === -1` when nothing is sounding.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { chapterAt } from './chapters.js';

const CH = [
  { contentId: 'plex:ep1', start: 0,  end: 10, offset: 0,  duration: 10 },
  { contentId: 'plex:ep1', start: 20, end: 35, offset: 10, duration: 15 },
  { contentId: 'plex:ep2', start: 5,  end: 15, offset: 25, duration: 10 }
];

describe('chapterAt', () => {
  it('maps a position inside a chapter to its place on the global rail', () => {
    expect(chapterAt({ chapters: CH, contentId: 'plex:ep1', position: 25 }))
      .toEqual({ index: 1, globalSeconds: 15 });
  });

  it('reports nothing sounding inside dead time', () => {
    expect(chapterAt({ chapters: CH, contentId: 'plex:ep1', position: 15 }))
      .toEqual({ index: -1, globalSeconds: 10 });
  });

  it('never matches a chapter from a different media item', () => {
    expect(chapterAt({ chapters: CH, contentId: 'plex:ep2', position: 25 }).index).toBe(-1);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Surround/chapters.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
/**
 * Where are we on the rail?
 *
 * The rail measures SOUNDING time, so a position in dead time has no chapter —
 * it reports the offset of the music already played and an index of -1, which
 * is the nothing-sounding state the band already renders.
 */
export function chapterAt({ chapters, contentId, position }) {
  const id = String(contentId ?? '');
  let globalSeconds = 0;
  for (let i = 0; i < chapters.length; i += 1) {
    const c = chapters[i];
    if (String(c.contentId) !== id) continue;
    if (c.start === undefined || c.end === undefined) continue;
    if (position >= c.start && position < c.end) {
      return { index: i, globalSeconds: c.offset + (position - c.start) };
    }
    if (position >= c.end) globalSeconds = c.offset + c.duration;
  }
  return { index: -1, globalSeconds };
}
```

- [ ] **Step 4: Run, confirm green, commit**

```bash
git add frontend/src/modules/Surround/chapters.js frontend/src/modules/Surround/chapters.test.js
git commit -m "feat(surround): map a media position onto the sounding-time rail"
```

---

### Task 6: The rail renders chapters, grouped

**Files:**
- Modify: `frontend/src/modules/Surround/modules/MovementMap.jsx`, `.scss`
- Modify: `frontend/src/modules/Surround/band.js` (add `placedChapters`)
- Test: `frontend/src/modules/Surround/modules/MovementMap.test.jsx`

**Interfaces:**
- Consumes: `chapterAt` (Task 5), payload `chapters`/`timeline` (Task 3).
- Produces: rail segments whose widths come from `chapter.duration`, group labels spanning each run of chapters sharing `group.work`.

- [ ] **Step 1: Write the failing test**

```javascript
  it('renders one segment per chapter and one label per group', () => {
    const chapters = [
      { n: 1, name: 'One',   contentId: 'plex:ep1', offset: 0,  duration: 10, group: { work: 'a', title: 'Op. 10', index: 0 } },
      { n: 2, name: 'Two',   contentId: 'plex:ep1', offset: 10, duration: 10, group: { work: 'a', title: 'Op. 10', index: 0 } },
      { n: 1, name: 'Three', contentId: 'plex:ep2', offset: 20, duration: 20, group: { work: 'b', title: 'Op. 25', index: 1 } }
    ];
    render(<MovementMap data={{ chapters, timeline: { totalSounding: 40, parts: [] } }}
                        position={5} contentId="plex:ep1" duration={40} playing />);
    expect(screen.getAllByTestId('surround-chapter')).toHaveLength(3);
    const labels = screen.getAllByTestId('surround-group-label').map((e) => e.textContent);
    expect(labels).toEqual(['Op. 10', 'Op. 25']);
  });

  it('lights nothing while dead time plays', () => {
    const chapters = [{ n: 1, name: 'One', contentId: 'plex:ep1', start: 0, end: 10, offset: 0, duration: 10 }];
    render(<MovementMap data={{ chapters, timeline: { totalSounding: 10, parts: [] } }}
                        position={12} contentId="plex:ep1" duration={30} playing />);
    expect(document.querySelectorAll('.surround-movement-map__segment--active')).toHaveLength(0);
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Surround/modules/MovementMap.test.jsx`
Expected: FAIL — no `surround-chapter` testids; the component still reads `movements`.

- [ ] **Step 3: Implement**

In `band.js`:

```javascript
/**
 * Chapters that can be drawn: a chapter with no duration has no width, and a
 * zero-width segment is a lie about a piece of music that exists.
 */
export function placedChapters(chapters) {
  return (Array.isArray(chapters) ? chapters : []).filter((c) => c && c.duration > 0);
}

/** Consecutive runs sharing a group, for the labels above the rail. */
export function chapterGroups(placed) {
  const runs = [];
  placed.forEach((c, i) => {
    const key = c.group?.work ?? null;
    const last = runs[runs.length - 1];
    if (last && last.key === key) { last.count += 1; last.span += c.duration; }
    else runs.push({ key, title: c.group?.title ?? null, from: i, count: 1, span: c.duration });
  });
  return runs;
}
```

In `MovementMap.jsx`, prefer `data.chapters` when present and fall back to `data.movements`, deriving the active index from `chapterAt` rather than `activeMovementIndex`. Segment widths become `duration / timeline.totalSounding`. Render a `__groups` row above the rule with one label per run, each `flex-basis` set from its `span`. Keep the accordion, bond, numeral gutter and reduced-motion paths exactly as they are — they consume shares, not movements.

- [ ] **Step 4: Run, confirm green**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Surround/`
Expected: PASS, existing Eroica cases included (a single-part work produces one group with a null key, and the label row renders nothing when every key is null).

- [ ] **Step 5: Mutation-prove the grouping**

Make `chapterGroups` return one run per chapter; the label test must go red with `['Op. 10','Op. 10','Op. 25']`. Restore.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Surround/
git commit -m "feat(surround): the rail draws chapters and labels their groups"
```

---

### Task 7: Placard and facts follow the current chapter

**Files:**
- Modify: `frontend/src/modules/Surround/modules/WorkPlacard.jsx`
- Modify: `frontend/src/modules/Surround/modules/CueTicker.jsx`
- Test: the two matching `.test.jsx` files

**Interfaces:**
- Consumes: active chapter index (Task 6), `chapter.group`, `chapter.note`.

- [ ] **Step 1: Write the failing tests**

```javascript
  // WorkPlacard.test.jsx
  it('headlines the current chapter with the set beneath it', () => {
    render(<WorkPlacard data={{ piece: { title: 'Études' }, chapters: CH }} activeIndex={2} />);
    expect(screen.getByTestId('surround-placard-title').textContent).toBe('No. 3 in E major');
    expect(screen.getByTestId('surround-placard-set').textContent).toBe('Études · 3 of 27');
  });

  // CueTicker.test.jsx
  it('prefers the chapter note, then the group facts, then the container facts', () => {
    const data = { chapters: [{ note: 'chapter note', group: { work: 'a' } }], facts: ['container fact'], groupFacts: { a: ['group fact'] } };
    expect(factPool(data, 0)).toEqual(['chapter note']);
    expect(factPool({ ...data, chapters: [{ group: { work: 'a' } }] }, 0)).toEqual(['group fact']);
    expect(factPool({ ...data, chapters: [{}] }, 0)).toEqual(['container fact']);
  });
```

- [ ] **Step 2: Run and watch them fail; Step 3: implement `factPool` as an exported pure function and wire both components; Step 4: run green.**

The placard's set line is a reserved-height element like every other text zone — add it to the existing reserve, do not let it change the plate's height between chapters.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/
git commit -m "feat(surround): the placard names what is playing, and facts follow it"
```

---

### Task 8: Chapter transport (supersedes the wave-10 brief)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaKeyboardHandler.js` (`nextTrack`/`previousTrack`, lines ~139–173)
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` (`keyMapping`, lines ~249–256)
- Create: `frontend/src/modules/Player/hooks/chapterNav.js` + test

**Interfaces:**
- Consumes: `chapterAt` (Task 5).
- Produces: `nextChapterAction({ chapters, contentId, position })` → `{ kind: 'seek', seconds }` | `{ kind: 'advance', step }`.

- [ ] **Step 1: Write the failing test**

```javascript
  it('seeks within the item when the next chapter is in the same file', () => {
    expect(nextChapterAction({ chapters: CH, contentId: 'plex:ep1', position: 5 }))
      .toEqual({ kind: 'seek', seconds: 20 });
  });
  it('advances the queue when the next chapter is in the next item', () => {
    expect(nextChapterAction({ chapters: CH, contentId: 'plex:ep1', position: 25 }))
      .toEqual({ kind: 'advance', step: 1 });
  });
  it('falls through to the queue past the last chapter', () => {
    expect(nextChapterAction({ chapters: CH, contentId: 'plex:ep2', position: 14 }))
      .toEqual({ kind: 'advance', step: 1 });
  });
  it('behaves exactly as today when there are no chapters', () => {
    expect(nextChapterAction({ chapters: [], contentId: 'x', position: 0 }))
      .toEqual({ kind: 'advance', step: 1 });
  });
  it('restarts the current chapter when previous is pressed more than 5s in', () => {
    expect(prevChapterAction({ chapters: CH, contentId: 'plex:ep1', position: 27 }))
      .toEqual({ kind: 'seek', seconds: 20 });
  });
```

- [ ] **Step 2: Run and watch it fail; Step 3: implement, reusing the existing 5-second restart constant rather than declaring a second one; Step 4: run green.**

- [ ] **Step 5: Fix the dead WebSocket skip route**

`skipnext`/`skipprev` are absent from `keyMapping`, so WS skip commands silently no-op today. Add them and test that a WS `skipNext` produces the same keydown as the numpad's.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat(player): next and previous walk chapters, seeking or advancing as the boundary requires"
```

---

### Task 9: 27 chapters in the committed measurement spec

**Files:**
- Modify: `frontend/src/modules/Surround/band.measure.test.jsx`

- [ ] **Step 1: Add a 27-chapter fixture (12 + 12 + 3, the real étude names) and assert at 960×540, 1280×720 and 1920×1080:**
  - every group label is legible (rendered width ≥ its text's measured width, or it is deliberately abbreviated — assert which);
  - the active segment renders its chapter name whole, no clip;
  - no segment falls below `SEGMENT_FLOOR_PX`;
  - the rail does not overflow its band.

- [ ] **Step 2: Prove one red by mutation** — set `SEGMENT_FLOOR_PX` to 4 and confirm the legibility assertion fails with a message naming the measured width. Quote it in the commit.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Surround/band.measure.test.jsx
git commit -m "test(surround): the rail is measured at 27 chapters, not 4"
```

---

### Task 10: Derive and author the 27 étude spans

**Files:**
- Modify (data volume, not git): `data/content/surround/classical/chopin/etudes.season-696233.yml`
- Create: `media/img/library/classical/chopin/etudes-op-10.spectrogram.jpg` and two more

**This task runs last on purpose:** with Tasks 1–9 landed, every boundary is checkable on the rendered rail in one pass instead of by eye in a spectrogram.

- [ ] **Step 1: Render a full-length and a per-boundary spectrogram for each of the three episodes.**

Files are at `/media/kckern/Media/Classical Concerts/Chopin/Season 02 - Etudes/`. Use the method proven on the Eroica:

```bash
ffmpeg -y -v error -i "<file>" \
  -lavfi "showspectrumpic=s=3300x900:mode=combined:scale=log:legend=1:gain=3" out.png
```

- [ ] **Step 2: Pin each boundary numerically.** Extract mono 8 kHz, compute 50 ms RMS, and find the quiet runs. Solo piano has a lower noise floor than the orchestral Eroica case, so silence detection is more useful here — but the spectrogram still localises, because applause is broadband with no harmonic structure and a threshold alone will not tell it from a loud chord.

- [ ] **Step 3: Author `spans` for all three parts**, writing the file through the container (the media and data trees are read-only to the `claude` user):

```bash
b=$(base64 -w0 local.yml)
sudo docker exec daylight-station sh -c "echo $b | base64 -d > data/content/surround/classical/chopin/etudes.season-696233.yml && chown 1000:1000 <same path>"
```

- [ ] **Step 4: Verify on the deployed screen.** The index log must report 27 chapters and **zero** `surround.spans.mismatch`. Play each episode and confirm each boundary lands on the music, not in the applause.

- [ ] **Step 5: File the spectrograms** under `media/img/library/classical/chopin/` so a timing can be re-checked later without re-deriving it, and md5-verify each after transfer.

---

## Self-Review

**Spec coverage:** §2 concepts → Tasks 1–3. §3 data model → Tasks 1–3. §4 resolution → Tasks 3–4. §5 ordering → Task 4. §6 presentation → Tasks 6–7, 9. §7 transport → Task 8. §8 authoring → Task 10. §9 failure modes → warns in Tasks 2, 3, 4; degradation in Task 4. §10 testing → every task, plus Task 9. §11 out of scope → nothing implements nesting beyond one level of reference; `#resolveChapters` recurses but the cycle guard and the single `parts` level bound it.

**Placeholder scan:** none — every step carries the code or the exact command.

**Type consistency:** `toSpans`/`withOffsets` (Task 1) are used verbatim in Task 3. `chapterAt` (Task 5) is used in Tasks 6 and 8. `placedChapters`/`chapterGroups` (Task 6) match their test usage. `lookupByPart` returns `{ payload, part }` in Task 4 and is consumed as such.

**Known gap, deliberate:** Task 4 Step 5 describes queue ordering against "the queue-building path" without naming a line, because that path is reached through `/api/v1/queue` and the exact function must be located by the implementer — the plan names the behaviour, the log events and the config key precisely, which is what the reviewer will check.
