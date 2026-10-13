# Station Sequences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shuffled radio-station playlists in the Music menu that always open with their jingle and drop station IDs between songs.

**Architecture:** A YAML sidecar keyed by playlist content id carries a `sequence:` block. A pure domain module splits off the head, lets the existing queue ordering handle the rest, and interleaves station IDs. A small `YamlSequenceStore` indexes the sidecars; `ContentAccessService.queue` (menu tiles) and `ListAdapter` (programs) consult it and fail open.

**Tech Stack:** Node ESM backend (`.mjs`), vitest, YAML data on the Docker data volume.

**Spec:** `__docs/superpowers/specs/2026-10-11-station-sequence-design.md`

## Global Constraints

- Fails open: any sequence error returns the queue exactly as it is without a sidecar.
- No frontend, menu-schema, or Player change. Station tiles are ordinary `action: Queue`, `shuffle: true` items.
- `head` default is `1`; `every` is an integer ≥ 1 or `[min, max]`; ids are compound (`plex:757863`).
- Backend structured logger only; events `station.sequence.applied` (info), `station.ident.unresolved` (warn), `station.sequence.failed` (warn), `station.sequence.invalid` (warn), `station.sequence.duplicate` (warn), `station.sequence.indexed` (info).
- Data volume is written only via `sudo docker exec daylight-station sh -c 'cat > … <<EOF'`; never `sed -i` YAML there; never `rm` in the data tree.
- Deploy only after `./scripts/deploy-gate.sh` exits 0, chained in one command.

## Review Focus

1. A playlist shorter than `head` (or empty) → whole playlist is head, no crash, no idents.
2. `shuffle: false` → songs in playlist order, idents still inserted.
3. Head jingle heavily played → still item 0 (head never enters the watch-aware ordering).
4. A pool id Plex no longer has → dropped with a warn; queue still plays.
5. A sequence-only sidecar in the surround tree → surround index unchanged, no `surround.sidecar.invalid` spam.

---

### Task 1: Domain sequencing functions

**Files:**
- Create: `__backend/src/2_domains/content/utils/stationSequence.mjs`
- Test: `__backend/src/2_domains/content/utils/stationSequence.test.mjs`

**Interfaces — Produces:**
- `normalizeSequence(raw) → { sequence: {head: number|string[], idents: {every:[number,number], pool:string[]}|null}|null, problems: string[] }`
- `splitHead(items, head) → { head: Array<{id:string, item:Object|null}>, rest: Object[] }`
- `interleaveIdents(songs, every, pool, random) → Object[]`
- `shuffleItems(items, random) → Object[]` (in place, returns same array)
- `sequenceQueue({ items, sequence, orderRest, resolveIds, random }) → Promise<{ items, stats: {head, songs, idents, unresolved: string[]} }>` where `orderRest(rest) → Promise<Object[]>`, `resolveIds(ids) → Promise<Map<string, Object|null>>`

- [ ] **Step 1: Write failing tests** covering: normalize defaults/head forms/every forms/bad shapes; splitHead by count (incl. count > length, 0) and by ids (incl. missing id); interleave fixed + ranged spacing with seeded random, no ident after last song, no back-to-back repeat for pool > 1, single-item pool repeats; sequenceQueue order, rest passed to orderRest without head, unresolved reported, empty pool = head + songs.
- [ ] **Step 2:** `npx vitest run __backend/src/2_domains/content/utils/stationSequence.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** per the spec's rules (see code in the commit; algorithm: gap = draw(min,max); after each song count++; when count ≥ gap and not last song push next ident, reset, redraw; idents drawn from a shuffled bag, refilled when empty, swapping so the next pick ≠ last when pool > 1).
- [ ] **Step 4:** re-run → PASS.
- [ ] **Step 5:** commit `feat(content): station sequence domain functions`.

### Task 2: `YamlSequenceStore` + surround store guard

**Files:**
- Create: `__backend/src/3_applications/content/ports/ISequenceStore.mjs`
- Create: `__backend/src/1_adapters/content/sequence/YamlSequenceStore.mjs`
- Test: `__backend/src/1_adapters/content/sequence/YamlSequenceStore.test.mjs`
- Modify: `__backend/src/1_adapters/content/surround/YamlSurroundStore.mjs` (`#resolvePerformance` guard + `#build` skip)
- Test: `__backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs` (one case)

**Interfaces — Consumes:** `normalizeSequence`. **Produces:** `new YamlSequenceStore({ rootDir, logger })`, `.lookup(contentId) → sequence|null` (clone).

- [ ] **Step 1: Failing tests** (temp dir fixtures like `YamlSurroundStore.test.mjs`): indexes `radio/salt-lake/fm100.yml` by `match.contentId`; ignores files without `sequence:` (e.g. a performance sidecar); ignores `_`-prefixed dirs/files; warns `station.sequence.invalid` for a missing contentId and for bad fields; warns `station.sequence.duplicate`; returns a clone (mutating result does not leak); an edit with a newer mtime is picked up after the freshness window (inject `now`); lookup on a miss → null; never throws when rootDir is missing. Surround store: a sequence-only file produces no `surround.sidecar.invalid` warn and `surround.index.built` `skipped` stays 0.
- [ ] **Step 2:** run both test files → new cases FAIL.
- [ ] **Step 3: Implement.** Store walks recursively with `listDirs` / `listYamlFiles(dir, {stripExtension:false})` / `loadYamlFromPath`; `#refreshIfStale` = 2s window + newest-mtime check (floored) over every walked dir and file. Surround guard, right after the `isPlainObject(doc)` check: `if (!doc.surround && isPresent(doc.sequence)) return SEQUENCE_ONLY;` and in `#build`, `if (resolved === SEQUENCE_ONLY) continue;` before the `!resolved` skip.
- [ ] **Step 4:** run → PASS; also run the full `YamlSurroundStore.test.mjs` and `surroundQueuePlan.test.mjs` → PASS.
- [ ] **Step 5:** commit `feat(content): YamlSequenceStore; surround store skips sequence-only sidecars`.

### Task 3: Queue route (menu tiles) — `ContentAccessService`

**Files:**
- Modify: `__backend/src/3_applications/content/ContentAccessService.mjs`
- Modify: `__backend/src/5_composition/modules/contentApi.mjs` (construct store, pass `sequenceStore`, `random: Math.random`, `logger` to the queue router's `ContentAccessService`)
- Test: `__backend/src/3_applications/content/ContentAccessService.test.mjs`

**Interfaces — Consumes:** `sequenceQueue`, `ISequenceStore.lookup`. **Produces:** constructor accepts `{ sequenceStore = null, random = Math.random, logger = null }`.

- [ ] **Step 1: Failing tests:** with a fake store returning `{head:1, idents:{every:[2,2], pool:['plex:j2']}}` and a catalog whose container resolves to `[J1,S1..S4]` (array) and `plex:j2` to `[J2]`: result items[0] is J1; `queueService.resolveQueue` received exactly `[S1..S4]` with `{shuffle:true}`; J2 appears after every 2 songs, not last. A heavily-"watched" J1 cannot move (resolveQueue mock reverses its input — J1 still first). Store throwing → plain `resolveQueue(playables…)` result. Unresolvable pool id → `station.ident.unresolved` warn, queue = head + songs. No store → existing behaviour (existing tests stay green).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `#orderQueue(playables, source, finalId, shuffle)` and `#resolveIds(ids)` (resolver.resolve → catalog.resolvePlayables(resolved, id) → first item; null on any failure). Carry `preserveOrder` onto the rest array. Log `station.sequence.applied {containerId, path:'queue', shuffle, head, songs, idents}`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(content): queue route applies station sequences`.

### Task 4: Program path — `ListAdapter`

**Files:**
- Modify: `__backend/src/1_adapters/content/list/ListAdapter.mjs` (constructor: `sequenceStore`, `logger`; Queue-expansion task; `_applySequence`, `_resolveIdsToPlayables`)
- Modify: `__backend/src/5_composition/bootstrap.mjs` (pass `sequenceStore: new YamlSequenceStore({ rootDir: path.join(listDataPath,'content','surround'), logger })`, `logger`)
- Test: `tests/isolated/adapter/content/list/ListAdapter.stationSequence.test.mjs`

- [ ] **Step 1: Failing test:** program `music-queue` with one `action: Queue`, `shuffle: true` item over `plex:757556`; registry resolves container → `[J1,S1..S6]`, `plex:j2` → `[J2]`; store returns head 1 + idents every 3. Result[0] is J1, J2 appears, songs are a permutation of S1..S6. Without a store: today's behaviour (J1 can move).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** (shuffle the rest with `shuffleItems`, not by hand; log `path:'list'`).
- [ ] **Step 4:** run → PASS; run all `tests/isolated/adapter/content/list/` → PASS.
- [ ] **Step 5:** commit `feat(content): programs apply station sequences`.

### Task 5: Data, docs, deploy, live verify

- [ ] **Step 1:** Write 11 sidecars to `data/content/surround/radio/salt-lake/` (pools per the spec table) via `docker exec … cat >`.
- [ ] **Step 2:** Append 11 tiles to `data/content/lists/menus/music.yml` (write the whole file; `label`, `uid` (uuid), `shuffle: true`, `input: plex:<id>`, `action: Queue`).
- [ ] **Step 3:** Docs: new `__docs/reference/player/surround/sequences.md`; CLAUDE.md nav row. Commit.
- [ ] **Step 4:** `npm run test:unit:vitest` relevant subsets green; merge to main.
- [ ] **Step 5:** `./scripts/deploy-gate.sh && ./scripts/build-daylight.sh && ./scripts/deploy-gate.sh && sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`.
- [ ] **Step 6:** Live: `curl -s 'localhost:3111/api/v1/queue/plex/757556?shuffle=1'` → item 0 `plex:757863`, FM100 IDs spaced 3–5; same for 757564 (3-ID pool, no back-to-back); `shuffle=0` keeps playlist order with IDs; log store shows `station.sequence.applied`; `/api/v1/list/menu/music` (or the admin page) shows the 11 tiles.
