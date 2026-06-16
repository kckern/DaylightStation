# ArtMode Immich People Filter (`kids` preset) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Immich `people` + `minPeople` collection selector (photos containing ≥N of a set of people) and a `kids` preset (≥2 of Felix/Milo/Alan/Soren), then trigger it on the office TV.

**Architecture:** `immichSource` gains a `people` selector that resolves names→face ids, runs one Immich metadata search per `minPeople`-sized id-combination (Immich ANDs each combo server-side), and unions the assets by id — expressing "≥N of the set" at the Immich query level. Config adds a `kids` collection (`art.yml`) and a `kids` preset (`artmode.yml`).

**Tech Stack:** Node ESM (`.mjs`), Vitest, YAML config.

**Test runner:** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`.

---

## File Structure

- `backend/src/1_adapters/content/art/sources/immichSource.mjs` (modify) — add `combinations` (exported, pure) + a `people` branch in `resolveAssets`.
- `tests/unit/art/immichSource.test.mjs` (modify) — add combinations + people-selector tests.
- `data/household/config/art.yml` (modify, data volume) — `kids` collection.
- `data/household/config/artmode.yml` (modify, data volume) — `kids` preset.

---

### Task 1: `immichSource` — `people` + `minPeople` selector

**Files:**
- Modify: `backend/src/1_adapters/content/art/sources/immichSource.mjs`
- Test: `tests/unit/art/immichSource.test.mjs`

- [ ] **Step 1: Add failing tests** to `tests/unit/art/immichSource.test.mjs`.

(a) Add `combinations` to the existing import from immichSource. Change the import line:
```js
import { createImmichSource } from '../../../backend/src/1_adapters/content/art/sources/immichSource.mjs';
```
to:
```js
import { createImmichSource, combinations } from '../../../backend/src/1_adapters/content/art/sources/immichSource.mjs';
```

(b) Add these tests (inside the top-level `describe`, or as a new `describe` block at the end of the file):
```js
describe('combinations', () => {
  it('returns all k-sized combinations (C(4,2) = 6 pairs)', () => {
    const c = combinations(['a', 'b', 'c', 'd'], 2);
    expect(c).toHaveLength(6);
    expect(c).toContainEqual(['a', 'b']);
    expect(c).toContainEqual(['c', 'd']);
  });
  it('k === length returns the whole set once', () => {
    expect(combinations(['a', 'b'], 2)).toEqual([['a', 'b']]);
  });
  it('k === 1 returns singletons', () => {
    expect(combinations(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
  });
  it('k > length or k <= 0 returns []', () => {
    expect(combinations(['a'], 2)).toEqual([]);
    expect(combinations(['a', 'b'], 0)).toEqual([]);
  });
});

describe('createImmichSource people selector', () => {
  const img = (id) => ({ id, type: 'IMAGE', width: 1600, height: 1000, localDateTime: '2020-01-01T00:00:00Z' });
  const vid = (id) => ({ id, type: 'VIDEO', width: 1600, height: 1000 });

  const makePeopleClient = (over = {}) => ({
    getPeople: vi.fn(async () => ([
      { id: 'felix-id', name: 'Felix' }, { id: 'milo-id', name: 'Milo' },
      { id: 'alan-id', name: 'Alan' }, { id: 'soren-id', name: 'Soren' },
    ])),
    searchMetadata: vi.fn(async ({ personIds }) => {
      // The Felix+Milo pair returns a1 (image) + v1 (video); every other pair returns a1 (dup) + a2.
      if (personIds.includes('felix-id') && personIds.includes('milo-id')) {
        return { items: [img('a1'), vid('v1')] };
      }
      return { items: [img('a1'), img('a2')] };
    }),
    ...over,
  });

  it('runs one search per pair, unions/dedupes, drops video, maps dims', async () => {
    const client = makePeopleClient();
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath: '/api/v1/proxy/immich' });
    const c = await src.resolveCandidates({ source: 'immich', people: ['Felix', 'Milo', 'Alan', 'Soren'], minPeople: 2 });
    // C(4,2) = 6 searches, each with a 2-id personIds.
    expect(client.searchMetadata).toHaveBeenCalledTimes(6);
    expect(client.searchMetadata.mock.calls[0][0].personIds).toHaveLength(2);
    // Union → a1 (deduped) + a2; v1 (video) dropped.
    const ids = c.map((x) => x.id).sort();
    expect(ids).toEqual(['immich:a1', 'immich:a2']);
    expect(c[0].width).toBe(1600);
  });

  it('skips names that do not resolve and combines the rest', async () => {
    const client = makePeopleClient({
      getPeople: vi.fn(async () => ([
        { id: 'felix-id', name: 'Felix' }, { id: 'milo-id', name: 'Milo' }, { id: 'alan-id', name: 'Alan' },
      ])),
    });
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath: '/api/v1/proxy/immich' });
    await src.resolveCandidates({ source: 'immich', people: ['Felix', 'Milo', 'Alan', 'Soren'], minPeople: 2 });
    // Only 3 resolve → C(3,2) = 3 searches.
    expect(client.searchMetadata).toHaveBeenCalledTimes(3);
  });

  it('returns [] when fewer than minPeople resolve', async () => {
    const client = makePeopleClient({ getPeople: vi.fn(async () => ([{ id: 'felix-id', name: 'Felix' }])) });
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath: '/api/v1/proxy/immich' });
    const c = await src.resolveCandidates({ source: 'immich', people: ['Felix', 'Milo'], minPeople: 2 });
    expect(c).toEqual([]);
    expect(client.searchMetadata).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/immichSource.test.mjs` (no `combinations` export; no `people` branch).

- [ ] **Step 3: Add the `combinations` export** to `backend/src/1_adapters/content/art/sources/immichSource.mjs`. Near the top (after the existing `const` helpers like `fmtDate`), add:
```js
// All k-sized combinations of arr (order-independent). [] if k<=0 or k>arr.length.
export function combinations(arr, k) {
  if (k <= 0 || k > arr.length) return [];
  if (k === arr.length) return [arr.slice()];
  const result = [];
  const rec = (start, combo) => {
    if (combo.length === k) { result.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); rec(i + 1, combo); combo.pop(); }
  };
  rec(0, []);
  return result;
}

const PEOPLE_SEARCH_SIZE = 250;  // cap per combination search (bounded pool fetch)
```

- [ ] **Step 4: Add the `people` branch** in `resolveAssets(def)`. Insert it immediately AFTER the existing `if (def.person) { ... }` block and BEFORE the `if (def.search) { ... }` block:
```js
    if (Array.isArray(def.people) && def.people.length > 0) {
      const minPeople = (Number.isInteger(def.minPeople) && def.minPeople > 0) ? def.minPeople : 2;
      const people = await client.getPeople({ withStatistics: false });
      const ids = def.people.map((name) => {
        const m = (people || []).find((p) => p.id === name || p.name === name);
        if (!m) logger.warn?.('art.immich.person-unresolved', { name });
        return m?.id || null;
      }).filter(Boolean);
      if (ids.length < minPeople) {
        logger.warn?.('art.immich.too-few-people', { resolved: ids.length, minPeople });
        return [];
      }
      const seen = new Map();
      for (const combo of combinations(ids, minPeople)) {
        let items = [];
        try {
          items = (await client.searchMetadata({ personIds: combo, size: PEOPLE_SEARCH_SIZE })).items || [];
        } catch (err) {
          logger.warn?.('art.immich.people-search-failed', { error: err.message });
          continue;
        }
        for (const a of items) if (a && a.id && !seen.has(a.id)) seen.set(a.id, a);
      }
      logger.info?.('art.immich.people-resolved', { requested: def.people.length, resolved: ids.length, minPeople, assets: seen.size });
      return [...seen.values()];
    }
```

- [ ] **Step 5: Run to confirm PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/immichSource.test.mjs` → all green (existing + new).

- [ ] **Step 6: Commit**
```bash
git add backend/src/1_adapters/content/art/sources/immichSource.mjs tests/unit/art/immichSource.test.mjs
git commit -m "feat(art): immich people selector (>=N of a set via combination searches)"
```

---

### Task 2: Config — `kids` collection + preset (data volume)

**Files (container data volume — not the git repo):**
- Modify: `data/household/config/art.yml`
- Modify: `data/household/config/artmode.yml`

- [ ] **Step 1: Add the `kids` collection to `art.yml`.** Read the file, then rewrite it complete with the `kids` collection added under `collections:` (heredoc; preserve all existing collections exactly):
```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/art.yml'   # READ first
```
Add this entry under `collections:` (alongside `all`, the periods, etc.):
```yaml
  kids:
    source: immich
    people: [Felix, Milo, Alan, Soren]
    minPeople: 2
```
Write the COMPLETE file back via `sudo docker exec daylight-station sh -c "cat > data/household/config/art.yml << 'YAML' ... YAML"` with that block included.

- [ ] **Step 2: Validate art.yml + the kids collection:**
```bash
sudo docker exec daylight-station node -e "const y=require('js-yaml');const c=y.load(require('fs').readFileSync('data/household/config/art.yml','utf8')).collections;console.log('kids:', JSON.stringify(c.kids), '| total collections:', Object.keys(c).length);"
```
Expected: `kids: {"source":"immich","people":["Felix","Milo","Alan","Soren"],"minPeople":2}` and the prior collection count + 1.

- [ ] **Step 3: Add the `kids` preset to `artmode.yml`.** Append a `kids` preset under `presets:` (the artmode.yml already has gallery-silent, classical-evening, and the 7 periods — preserve them). The `kids` preset:
```yaml
  kids:        { collection: kids, music: null, placard: true, matMargin: 4, cropMaxPerSide: 8, frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }, ambient: { defaultLux: 80, curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ] } }
```
Rewrite the COMPLETE `artmode.yml` with this preset added (read it first; preserve every existing preset byte-for-byte).

- [ ] **Step 4: Validate artmode.yml + the kids preset:**
```bash
sudo docker exec daylight-station node -e "const y=require('js-yaml');const p=y.load(require('fs').readFileSync('data/household/config/artmode.yml','utf8')).presets;console.log('kids preset collection:', p.kids?.collection, '| music:', p.kids?.music, '| total presets:', Object.keys(p).length);"
```
Expected: `kids preset collection: kids | music: null | total presets: 10`.

- [ ] **Step 5: No git commit** (data-volume files are not tracked).

---

### Task 3: Deploy + trigger on office

**Files:** none.

- [ ] **Step 1: Run the art suite**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/
```
Expected: all green.

- [ ] **Step 2: Build + deploy** (stash unrelated WIP first, restore after — per prior plans).

- [ ] **Step 3: Verify the kids preset + collection resolve over HTTP**
```bash
curl -s "http://localhost:3111/api/v1/art/preset/kids" | python3 -c "import sys,json;d=json.load(sys.stdin);print('kids preset -> collection:',d.get('collection'),'music:',d.get('music'))"
curl -s "http://localhost:3111/api/v1/art/featured?collection=kids" | python3 -c "import sys,json;d=json.load(sys.stdin);p=d['panels'][0];print('featured kids ->', d['mode'], '| image:', p['image'][:60], '| date:', p['meta'].get('date'))"
```
Expected: the preset resolves (`collection: kids`, `music: None`); `featured?collection=kids` returns an Immich `?size=preview` image (a photo containing ≥2 kids). If the Immich query is slow/empty it falls back to the art pool — re-run; a non-`/proxy/immich/` image means the fallback fired (investigate).

- [ ] **Step 4: Trigger on office (office Brave is on the new bundle)**
```bash
curl -s "http://localhost:3111/api/v1/device/office-tv/load?display=art:kids" | python3 -c "import sys,json;d=json.load(sys.stdin);print('dispatch ok:', d.get('ok'))"
sleep 10
sudo docker logs --since 1m daylight-station 2>&1 | grep -iE "websocket.load.display|commands.display|action.scene.show|art.immich.people-resolved|artmode.loaded" | tail -8
```
Expected: `dispatch ok: True`; logs show the display command → `action.scene.show {preset: kids}` → `artmode.loaded`, with `art.immich.people-resolved` reporting the asset count. The office TV shows photos with ≥2 of the kids.

(Deploy is the operator's call; the plan ends at green tests + the dispatch verification.)

---

## Notes for the implementer
- Run specs with `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` (NOT `npm test`).
- `combinations` is pure and exported for testing; the `people` branch uses the injected client (`getPeople` + `searchMetadata`), faked in tests — no real Immich needed for the unit tests.
- "≥N of a set" is done at the Immich query level: each combination search ANDs its people server-side; the source only unions/dedupes the result sets.
- Task 2 edits the container data volume — `sudo docker exec daylight-station sh -c "cat > ... << 'YAML' ... YAML"` (heredoc, never `sed`); read each file first and preserve all existing entries.
