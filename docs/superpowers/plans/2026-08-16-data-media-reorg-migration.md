# Data/Media Reorganization Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every heavy, machine-generated tree out of `data/` into `media/`, and file every remaining `data/household/` folder under the domain, config, or hardware root it actually belongs to — changing the code paths and the data in the same commit each time.

**Architecture:** `data/` is the committable tree: hand-authored config, curated state, light history — small enough to zip and diff. `media/` is everything heavy and never source-controlled: binaries, renders, caches, logs, generated corpora. Each task repoints one subsystem's code path and moves its data together, then proves a reader returns data from the new location. A path-contract guard is built first so every later task is protected by it.

**Tech Stack:** Node 20 ESM (`.mjs`), Express 5, js-yaml, vitest (frontend + `tests/isolated/`), `node:test` (`backend/tests/`), Docker (`daylight-station`), bind-mounted `data/` and `media/` volumes.

## Global Constraints

- **Code and data move in the SAME task.** Never a task that moves data without repointing code, or vice versa. Two production regressions this session came from exactly that split.
- **Grep must cover four shapes**, not just `getHouseholdPath('x/y')`:
  1. `getHouseholdPath(path.join('a','b',...))` — never matches a literal `"a/b"` grep
  2. constructor defaults — `constructor({ path = 'a/b' } = {})`
  3. bare module consts — `const PATH = 'a/b';`
  4. inline template strings — `` `a/b/${id}.yml` ``
- **Verify with a reader returning data**, never with `npm run audit:paths` alone. That tool reports clean when a writer and a reader disagree about which root is canonical, because both roots exist and both have readers.
- **Never `rm` inside `data/` or `media/`.** Move to `data/_deleteme/<descriptive-name>` instead. `docker exec` runs as root, so `rm` always appears to succeed.
- **`chown -R node:node` any path written via `docker exec`** — the container app runs as `node`, `docker exec` writes as `root`.
- **The deploy gate is a HALT, not a print.** Before every `sudo deploy-daylight`: zero `playback.render_fps` lines in the last 75s, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`.
- **Test commands:** vitest binary is `/opt/Code/DaylightStation/node_modules/.bin/vitest` (worktree has no local install). `backend/tests/` needs `npm run test:backend` (`node:test`, not vitest). Pointing vitest at `backend/src/**/*.test.mjs` reports "No test suite found" for `node:test` files — that is not a failure.
- **Known pre-existing failures — do not attribute to your change:** `cli/lib/fitness/heal.test.mjs` (2), `cli/school-rekey-learner.cli.test.mjs` (2), and 5 golden page snapshots in `tests/isolated/rendering/school/golden/golden.test.mjs`. Verify by reverting your source change and re-running before blaming yourself.
- **Container paths** are `data/...` and `media/...` relative to `/usr/src/app`. Container `find` is BusyBox — **no `-newermt`**.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `scripts/audit-household-paths.mjs` | Path-contract audit; gains writer/reader disagreement detection | 1 |
| `backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs` | Piano MIDI write path | 2 |
| `backend/src/1_adapters/jamcorder/FsJamCorderArchive.mjs` | Jamcorder archive root | 2 |
| `backend/src/5_composition/bootstrap.mjs` | MP3/PNG harvester source dirs | 2 |
| `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs` | Draft chunks, finalize, sweep | 3 |
| `backend/src/3_applications/eink/EinkPanelService.mjs` | Panel telemetry + screen config reads | 4, 5 |
| `backend/src/4_api/v1/routers/screens.mjs` | Screen config API | 5 |
| `backend/src/app.mjs` | Composition root — screens, livestream, strava wiring | 5, 6, 7 |
| `backend/src/3_applications/livestream/ChannelManager.mjs` | Livestream program bodies | 6 |
| `cli/_bootstrap.mjs` | CLI audit log root | 8 |

---

## Task 1: Teach `audit:paths` to catch writer/reader disagreement

The guard goes first so every later task is protected by it. `audit:paths` currently verifies that each resolved path exists and each domain has a reader. It reported clean while the piano MIDI corpus was forked in two, because both roots existed and both had readers.

**Files:**
- Modify: `scripts/audit-household-paths.mjs`
- Test: `tests/isolated/tooling/auditHouseholdPaths.test.mjs` (create)

**Interfaces:**
- Produces: `findWriterReaderSplits(sites)` → `Array<{ subpath, writers: string[], readers: string[] }>` where `sites` is `Array<{ file, line, subpath, mode: 'read'|'write' }>`. Returns one entry per subpath whose writer set and reader set are disjoint and both non-empty.

- [ ] **Step 1: Read the existing script to learn its site-collection shape**

Run: `sed -n '1,80p' scripts/audit-household-paths.mjs`

Note the structure it already builds for resolved paths. You are adding a new check beside the existing ones, not rewriting them. If the script does not already record read-vs-write mode per site, add that field where sites are collected — the regexes already distinguish `.read(` / `.write(` for `dataService.household`, and `loadYaml`/`saveYaml` for FileIO.

- [ ] **Step 2: Write the failing test**

Create `tests/isolated/tooling/auditHouseholdPaths.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { findWriterReaderSplits } from '../../../scripts/audit-household-paths.mjs';

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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/tooling/auditHouseholdPaths.test.mjs`
Expected: FAIL — `findWriterReaderSplits is not a function`.

- [ ] **Step 4: Implement and export the check**

Add to `scripts/audit-household-paths.mjs`:

```javascript
/**
 * Find domains where the code WRITES one subpath and READS a different one.
 *
 * The existing checks ask "does every resolved path exist" and "does every
 * domain on disk have a reader". Both answered YES on 2026-08-16 while the
 * piano MIDI corpus was forked: the writer targeted history/piano, the render
 * jobs read piano/log, and both roots existed with readers. Nothing failed.
 *
 * A domain is the first path segment. Within one domain, if the set of
 * written subpaths and the set of read subpaths are both non-empty and share
 * nothing, the two halves disagree about which root is canonical.
 *
 * Write-only trails (barcode/log) and read-only trees (config/devices) are
 * NOT flagged — a missing counterpart is normal, a contradicting one is not.
 */
export function findWriterReaderSplits(sites) {
  const byDomain = new Map();
  for (const site of sites) {
    const domain = String(site.subpath).split('/')[0];
    if (!byDomain.has(domain)) byDomain.set(domain, { writes: new Map(), reads: new Map() });
    const bucket = byDomain.get(domain);
    const target = site.mode === 'write' ? bucket.writes : bucket.reads;
    if (!target.has(site.subpath)) target.set(site.subpath, []);
    target.get(site.subpath).push(`${site.file}:${site.line}`);
  }

  const splits = [];
  for (const { writes, reads } of byDomain.values()) {
    if (writes.size === 0 || reads.size === 0) continue;
    const shared = [...writes.keys()].some((p) => reads.has(p));
    if (shared) continue; // at least one path agrees — not a split
    for (const [subpath, files] of writes) splits.push({ subpath, writers: files, readers: [] });
    for (const [subpath, files] of reads) splits.push({ subpath, writers: [], readers: files });
  }
  return splits;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/tooling/auditHouseholdPaths.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire it into the audit report**

In the script's main reporting section, after the existing summary lines, add:

```javascript
const splits = findWriterReaderSplits(collectedSites);
if (splits.length > 0) {
  console.log('\nWRITER/READER SPLIT — one half of a domain writes where the other never reads:');
  for (const s of splits) {
    const role = s.writers.length ? `written by ${s.writers.join(', ')}` : `read by ${s.readers.join(', ')}`;
    console.log(`  ${s.subpath} — ${role}`);
  }
  process.exitCode = 1;
} else {
  console.log('no writer/reader splits');
}
```

- [ ] **Step 7: Run the real audit and record the baseline**

Run: `npm run audit:paths`
Expected: it now prints either `no writer/reader splits` or a list. **Record whatever it prints** — that is the baseline every later task compares against. If it flags something, investigate before proceeding; do not suppress it.

- [ ] **Step 8: Commit**

```bash
git add scripts/audit-household-paths.mjs tests/isolated/tooling/auditHouseholdPaths.test.mjs
git commit -m "feat(tooling): audit:paths detects writer/reader disagreement

The existing checks ask whether each resolved path exists and whether each
domain has a reader. Both answered yes while the piano MIDI corpus was forked
in two — writer on history/piano, render jobs on piano/log, both roots present.

A domain whose written subpaths and read subpaths are both non-empty and share
nothing is contradicting itself. Write-only trails and read-only trees are left
alone; a missing counterpart is normal, a contradicting one is not."
```

---

## Task 2: Move `piano/log` (59.6M of MIDI) to `media/`

Highest value-per-risk on the list. 2,687 binary `.mid` files with one write path and one batch-read path, both identified. No CLI tool touches this tree.

**Files:**
- Modify: `backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs:236`
- Modify: `backend/src/1_adapters/jamcorder/FsJamCorderArchive.mjs:12`
- Modify: `backend/src/5_composition/bootstrap.mjs:3522` and `:3540`
- Test: `backend/src/4_api/v1/routers/piano.history.test.mjs` (existing — it guards this exact path and was revived on 2026-08-16)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime; uses its guard for verification.
- Produces: MIDI history at `{mediaDir}/apps/piano/log/{userId}/{date}/{takeId}.mid`; jamcorder at `{mediaDir}/apps/piano/log/jamcorder/`.

- [ ] **Step 1: Confirm the datastore can reach the media root**

Run: `grep -n "getMediaDir" backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs`
Expected: at least one hit — the class already uses `configService.getMediaDir()` for lesson drills and effect-audit clips. If there are zero hits, stop and read the constructor; do not invent an accessor.

- [ ] **Step 2: Update the test to expect the media path**

In `backend/src/4_api/v1/routers/piano.history.test.mjs`, the mock config service already provides `getMediaDir: () => '/data/media'`. Change all four path assertions:

```javascript
expect(written[0].path).toBe('/data/media/apps/piano/log/kc/2026-06-26/10.00.00.mid');
```

and the guest one:

```javascript
expect(written[0].path).toBe('/data/media/apps/piano/log/guest/2026-06-26/10.00.00.mid');
```

and both entries in the duplicate-write assertion at lines 67-68 to the same `kc` media path.

- [ ] **Step 3: Run the test to verify it fails**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/4_api/v1/routers/piano.history.test.mjs`
Expected: FAIL — 3 of 6 assert the old `/data/household/piano/log/...` path.

- [ ] **Step 4: Repoint the writer**

`YamlPianoStudioDatastore.mjs:236`, replace:

```javascript
    const dir = this.#configService.getHouseholdPath(path.join('piano', 'log', userId, date));
```

with:

```javascript
    // MIDI takes are binary and unbounded — media, not the committable tree.
    // NOTE for future greps: this path is assembled with path.join, so a
    // literal search for "piano/log" does NOT find it. That is exactly how the
    // 2026-08-16 split-brain hid.
    const dir = path.join(this.#configService.getMediaDir(), 'apps', 'piano', 'log', userId, date);
```

Also update the docstring at line 9 to `<mediaDir>/apps/piano/log/{userId}/{date}/{takeId}.mid`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run backend/src/4_api/v1/routers/piano.history.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 6: Repoint the jamcorder archive**

`FsJamCorderArchive.mjs:12` — replace the const and its resolution at line 42:

```javascript
const REL_ROOT = path.join('apps', 'piano', 'log', 'jamcorder');
```

and at line 42:

```javascript
    return path.join(this.#configService.getMediaDir(), REL_ROOT);
```

Update the header comment on line 3 to `media/apps/piano/log/jamcorder/<relPath>`.

- [ ] **Step 7: Repoint both render harvesters**

`bootstrap.mjs:3522` and `:3540` — both currently read:

```javascript
    const sourceDir = configService.getHouseholdPath('piano/log');
```

Replace both with:

```javascript
    const sourceDir = path.join(configService.getMediaDir(), 'apps', 'piano', 'log');
```

Confirm `path` is already imported in `bootstrap.mjs` (`grep -n "^import path" backend/src/5_composition/bootstrap.mjs`); if not, add `import path from 'node:path';`.

- [ ] **Step 8: Verify no `piano/log` reference survives**

Run:
```bash
grep -rn "piano/log\|'piano', 'log'" backend/src cli frontend/src | grep -v node_modules | grep -v "apps/piano/log"
```
Expected: no hits other than comments you have already updated. If a hit appears in a file you have not touched, repoint it too — that is the fourth grep shape doing its job.

- [ ] **Step 9: Move the data**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p media/apps/piano
  mv data/household/piano/log media/apps/piano/log
  chown -R node:node media/apps/piano
  echo "moved: $(find media/apps/piano/log -name "*.mid" | wc -l) mid files"
  ls data/household/piano
'
```
Expected: the mid count matches ~2,687, and `data/household/piano` now lists only `devices`, `producer`, `studio`.

- [ ] **Step 10: Deploy — HALT on the gate**

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```
Proceed ONLY if render count is 0, `sessionActive:false`, `rosterSize:0`. Then:

```bash
./scripts/build-daylight.sh
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 11: Verify with a reader, not a checker**

```bash
sudo docker exec daylight-station sh -c 'find media/apps/piano/log -name "*.mid" | wc -l'
npm run audit:paths
```
Then record a take on the piano and confirm the new file lands under `media/apps/piano/log/{user}/{today}/`. If you cannot record one, assert the negative instead — confirm `data/household/piano/log` does **not** reappear after 10 minutes of uptime:

```bash
sudo docker exec daylight-station sh -c 'ls -d data/household/piano/log 2>/dev/null && echo "REGRESSION: writer recreated the old root" || echo "old root stays gone"'
```

- [ ] **Step 12: Commit**

```bash
git add backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs \
        backend/src/1_adapters/jamcorder/FsJamCorderArchive.mjs \
        backend/src/5_composition/bootstrap.mjs \
        backend/src/4_api/v1/routers/piano.history.test.mjs
git commit -m "refactor(piano): MIDI history is media, not committable data

2,687 binary .mid files, 59.6M, with no diffable value and no live reader —
the app only ever serves the derived MP3/PNG, which already live in media.

Writer, jamcorder archive root, and both render harvesters move together. The
writer's path is assembled with path.join, so it does not answer a literal
grep for piano/log; that shape is why the corpus forked once already."
```

---

## Task 3: Fix the weekly-review draft leak, then move `.drafts` to media

`.drafts/*.webm` is 36.9M of the 37.3M tree. There is a confirmed live leak: `sweepStaleDrafts()` only matches `{sessionId}.webm` via `.meta.json`, so `*.processing-*.webm` orphans are never swept — one is 26M and 60+ days old. Fix the sweep first so the leak does not simply follow the data to its new home.

**Files:**
- Modify: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs` — `#draftDir()` (new), `appendChunk` (:235), `listDrafts` (:294), `finalizeDraft` (:322,331), `sweepStaleDrafts` (:383-410), `deleteDraft` (:415)
- Test: `tests/isolated/flow/weekly-review/draftSweep.test.mjs` (create)

**Interfaces:**
- Produces: `#draftDir(week)` → `path.join(this.#mediaPath, 'weekly-review', week, '.drafts')`. Every draft-touching method routes through it.

- [ ] **Step 1: Write the failing test for the orphan sweep**

Create `tests/isolated/flow/weekly-review/draftSweep.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WeeklyReviewService } from '#apps/weekly-review/WeeklyReviewService.mjs';

const WEEK = '2026-06-13';
const OLD = Date.now() - 60 * 24 * 60 * 60 * 1000;

describe('sweepStaleDrafts', () => {
  let tmp; let svc; let draftDir;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-sweep-'));
    svc = new WeeklyReviewService({
      householdDir: path.join(tmp, 'household'),
      mediaPath: path.join(tmp, 'media'),
      logger: { warn() {}, info() {} },
    });
    draftDir = path.join(tmp, 'media', 'weekly-review', WEEK, '.drafts');
    fs.mkdirSync(draftDir, { recursive: true });
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('sweeps an orphaned .processing- file with no meta alongside it', async () => {
    // finalizeDraft renames the draft to .processing-<stamp>.webm, then deletes it
    // only AFTER transcription. If transcription throws, this is what is left —
    // and the meta.json is already gone, so the meta-driven sweep never sees it.
    const orphan = path.join(draftDir, `abc.processing-${OLD}.webm`);
    fs.writeFileSync(orphan, 'x');
    fs.utimesSync(orphan, OLD / 1000, OLD / 1000);

    await svc.sweepStaleDrafts({ maxAgeDays: 30 });

    expect(fs.existsSync(orphan)).toBe(false);
  });

  it('leaves a recent .processing- file alone', async () => {
    const fresh = path.join(draftDir, 'def.processing-999.webm');
    fs.writeFileSync(fresh, 'x');

    await svc.sweepStaleDrafts({ maxAgeDays: 30 });

    expect(fs.existsSync(fresh)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/flow/weekly-review/draftSweep.test.mjs`
Expected: FAIL — the orphan still exists after the sweep (and possibly a path failure, since drafts still live under `householdDir` until Step 4).

- [ ] **Step 3: Extend the sweep to cover orphaned processing files**

In `sweepStaleDrafts`, inside the per-week loop and **after** the existing `.meta.json` loop, add:

```javascript
      // Second pass: .processing-<stamp>.webm files have no meta beside them —
      // finalizeDraft removes the meta before transcribing. If transcription
      // throws, the renamed file is orphaned and the meta-driven pass above can
      // never see it. Sweep those on mtime instead. (A 26M orphan from
      // 2026-06-13 survived 60+ days this way.)
      for (const name of fs.readdirSync(draftDir)) {
        if (!name.includes('.processing-')) continue;
        const orphanPath = path.join(draftDir, name);
        try {
          if (fs.statSync(orphanPath).mtimeMs < cutoff) {
            fs.unlinkSync(orphanPath);
            deleted.push(name);
          }
        } catch (err) {
          this.#logger.warn?.('weekly-review.sweep.orphan-failed', { name, error: err.message });
        }
      }
```

- [ ] **Step 4: Route every draft path through media**

Add a private helper beside `#reviewPath` (line 47):

```javascript
  /**
   * Draft chunks are raw in-progress audio — heavy, transient, never diffed.
   * They belong beside the FINAL recording in media, which saveRecording and
   * finalizeDraft already write to. Keeping drafts in data/ while finals went to
   * media is what let a 26M orphan hide in the committable tree.
   */
  #draftDir(week) {
    return path.join(this.#mediaPath, 'weekly-review', week, '.drafts');
  }
```

Replace every `this.#reviewPath(week, '.drafts')` with `this.#draftDir(week)` — at lines 235, 294, 322, 415. In `sweepStaleDrafts`, replace `const baseDir = this.#reviewPath();` with `const baseDir = path.join(this.#mediaPath, 'weekly-review');` and drop the now-redundant `week` join for `draftDir`, using `this.#draftDir(week)`.

`transcript.yml` and `manifest.yml` keep using `#reviewPath` — they are the light, curated half and stay in `data/`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/flow/weekly-review/draftSweep.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the surrounding suite**

Run: `/opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/flow/weekly-review/`
Expected: all pass.

- [ ] **Step 7: Move the existing drafts**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  for wk in $(ls data/household/weekly-review/log); do
    if [ -d "data/household/weekly-review/log/$wk/.drafts" ]; then
      mkdir -p "media/weekly-review/$wk"
      mv "data/household/weekly-review/log/$wk/.drafts" "media/weekly-review/$wk/.drafts"
      echo "moved drafts for $wk"
    fi
  done
  chown -R node:node media/weekly-review
  echo "data/ weekly-review now:"; du -sh data/household/weekly-review
'
```
Expected: `data/household/weekly-review` drops from 37.3M to well under 1M.

- [ ] **Step 8: Deploy — HALT on the gate, then verify**

Run the gate check from Task 2 Step 10, build, deploy. Then:

```bash
curl -s "http://localhost:3111/api/v1/weekly-review/status" | head -c 200
sudo docker exec daylight-station sh -c 'du -sh data/household/weekly-review media/weekly-review'
```
Expected: the status endpoint still returns transcript state (it reads `transcript.yml`, which did not move), and the sizes have swapped.

- [ ] **Step 9: Commit**

```bash
git add backend/src/3_applications/weekly-review/WeeklyReviewService.mjs \
        tests/isolated/flow/weekly-review/draftSweep.test.mjs
git commit -m "fix(weekly-review): sweep orphaned processing files, and keep drafts with the finals

sweepStaleDrafts only matched {sessionId}.webm via its .meta.json. finalizeDraft
removes the meta before transcribing, so a transcription failure orphans a
.processing-<stamp>.webm that the sweep can never see — a 26M file from
2026-06-13 survived 60+ days that way. A second mtime-based pass covers them.

Drafts also move to media beside the final recording. Drafts in data/ while
finals went to media is the asymmetry that let the orphan hide in the tree that
is supposed to zip small; transcript.yml and manifest.yml stay in data/."
```

---

## Task 4: Move `eink/telemetry` under `hardware/`

Domain-less device health. Bounded snapshot cache (one record per panel, overwritten) — stays in `data/`, just files under the hardware root.

**Files:**
- Modify: `backend/src/3_applications/eink/EinkPanelService.mjs:28` (stale comment), `:31` (`TELEMETRY_PATH`)

- [ ] **Step 1: Repoint the constant and fix the stale comment**

Line 31:

```javascript
const TELEMETRY_PATH = 'hardware/eink/telemetry';
```

The comment on line 28 currently claims the file lives at `data/household/state/eink-telemetry.yml` — a root that no longer exists. Replace it with:

```javascript
// Panel battery/RSSI/uptime, one overwritten record per panel id. Device health
// with no domain, so it files under hardware/ — see data taxonomy audit.
// Lives at data/household/hardware/eink/telemetry.yml.
```

- [ ] **Step 2: Verify no other reference**

Run: `grep -rn "eink/telemetry" backend/src cli frontend/src | grep -v node_modules`
Expected: only the constant you just changed.

- [ ] **Step 3: Move the data**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p data/household/hardware/eink
  mv data/household/eink/telemetry.yml data/household/hardware/eink/telemetry.yml
  rmdir data/household/eink
  chown -R node:node data/household/hardware
  ls data/household/hardware/eink
'
```

- [ ] **Step 4: Deploy — HALT on the gate, then verify with a reader**

Gate, build, deploy. Then:

```bash
curl -s "http://localhost:3111/api/v1/eink/telemetry" | head -c 200
```
Expected: the two panel records (`upstairs-eink`, `kitchen-eink`), not `{}` or an error.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/eink/EinkPanelService.mjs
git commit -m "refactor(eink): file panel telemetry under hardware/

Battery/RSSI/uptime per panel is device health serving no domain — the case
hardware/ exists for. Also corrects a comment pointing at data/household/state/,
a root retired some time ago."
```

---

## Task 5: Move `screens/` to `config/screens/`

Hand-authored layout config, read on page load, never written by the app — the same shape as `config/devices.yml`. Four call sites, all bare inline literals with no shared constant, one of them easy to miss.

**Files:**
- Modify: `backend/src/4_api/v1/routers/screens.mjs:34,74`
- Modify: `backend/src/app.mjs:2622`
- Modify: `backend/src/3_applications/eink/EinkPanelService.mjs:103` and its comment on line 8

- [ ] **Step 1: Enumerate every site before editing**

Run: `grep -rn "'screens'\|screens/\`\|/screens\b" backend/src cli frontend/src | grep -v node_modules | grep -viE "\.test\.|api/v1/screens|screen-framework"`
Expected: exactly the four sites listed above. **The `EinkPanelService.mjs:103` one is the trap** — e-ink panels are served from the same directory as regular screens, so a reviewer thinking only about the screens router will miss it.

- [ ] **Step 2: Repoint the router**

`screens.mjs:34`:

```javascript
      const screensDir = path.join(householdDir, 'config', 'screens');
```

`screens.mjs:74`:

```javascript
      const screenPath = path.join(householdDir, 'config', 'screens', `${screenId}.yml`);
```

- [ ] **Step 3: Repoint the school surface-profile resolver**

`app.mjs:2622` — change `path.join(householdDir, 'screens', \`${screenId}.yml\`)` to:

```javascript
      loadYamlFromPath(path.join(householdDir, 'config', 'screens', `${screenId}.yml`))
```

- [ ] **Step 4: Repoint the e-ink panel reader**

`EinkPanelService.mjs:103`:

```javascript
      screen = this.#dataService.household.read(`config/screens/${panelId}`);
```

And its comment on line 8: `loads the panel's screen config (data/household/config/screens/<id>.yml)`.

- [ ] **Step 5: Move the data**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mv data/household/screens data/household/config/screens
  chown -R node:node data/household/config/screens
  ls data/household/config/screens
'
```
Expected: `kitchen-eink.yml living-room.yml office.yml portal.yml upstairs-eink.yml`.

- [ ] **Step 6: Deploy — HALT on the gate, then verify BOTH readers**

Gate, build, deploy. Then:

```bash
curl -s "http://localhost:3111/api/v1/screens/office" | head -c 200
curl -s "http://localhost:3111/api/v1/screens" | head -c 200
```
Expected: the office layout JSON and a list of five screen ids — not `404` or an empty list. The e-ink path shares the same directory, so a working screens read covers it; if an e-ink panel is reachable, confirm it renders too.

- [ ] **Step 7: Commit**

```bash
git add backend/src/4_api/v1/routers/screens.mjs backend/src/app.mjs \
        backend/src/3_applications/eink/EinkPanelService.mjs
git commit -m "refactor(screens): screen layouts are config

Hand-authored, read at page load, never written by the app — the same kind as
config/devices.yml, and config/ is correctly kind-first because one loader owns
it. Four sites each hardcoded the bare literal 'screens' with no shared
constant; the e-ink panel reader is one of them, which a screens-router-shaped
search would miss."
```

---

## Task 6: Move `livestream/programs/` to `config/livestream/programs/`

Hand-authored state machines that `config/livestream.yml` already declares by relative path.

**Files:**
- Modify: `backend/src/app.mjs:1250`
- Modify: `backend/src/3_applications/livestream/ChannelManager.mjs` (header comment only)

- [ ] **Step 1: Repoint the programs base path**

`app.mjs:1250`:

```javascript
  const programsBasePath = configService.getHouseholdPath('config/livestream/programs');
```

- [ ] **Step 2: Disambiguate the name collision in a comment**

`config/lists/programs/` holds playback lineups (`title` + `items[]`, e.g. `morning-program`). `config/livestream/programs/` holds state machines (`states` + `transitions`). Same basename, unrelated shapes. Add above the line you just changed:

```javascript
  // NOTE: not the same "programs" as config/lists/programs/ — those are playback
  // lineups (title + items[]). These are livestream state machines (states +
  // transitions), declared by config/livestream.yml's `programs:` key.
```

Add the mirror-image note to `ChannelManager.mjs`'s header comment.

- [ ] **Step 3: Move the data**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p data/household/config/livestream
  mv data/household/livestream/programs data/household/config/livestream/programs
  rmdir data/household/livestream
  chown -R node:node data/household/config/livestream
  ls data/household/config/livestream/programs
'
```

- [ ] **Step 4: Deploy — HALT on the gate, then verify**

Gate, build, deploy. Then confirm the channel resolves its program:

```bash
sudo docker logs --since 60s daylight-station 2>&1 | grep -iE "livestream" | grep -i "error\|not found" | head -3
```
Expected: no program-resolution errors. If a livestream channel can be started, start it and confirm `demo-tour` loads.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.mjs backend/src/3_applications/livestream/ChannelManager.mjs
git commit -m "refactor(livestream): program bodies live with the config that declares them

config/livestream.yml already names them by relative path; the bodies were the
only half outside config/. Also notes the basename collision with
config/lists/programs/ at both ends — playback lineups vs state machines."
```

---

## Task 7: Move `cli/log` to `media/logs/cli/`

Machine-written, append-only, unbounded, with no reader anywhere in the codebase — the textbook case for leaving `data/`.

**Files:**
- Modify: `cli/_bootstrap.mjs:259`

- [ ] **Step 1: Confirm the CLI bootstrap exposes a media accessor**

Run: `grep -n "getMediaDir" cli/_bootstrap.mjs`
Expected: at least one hit (line 172 uses `cfg.getMediaDir()`). If there are zero hits, stop — do not invent one.

- [ ] **Step 2: Repoint the audit log root**

`cli/_bootstrap.mjs:259`:

```javascript
        // Append-only audit trail, no reader in code — media, not the committable
        // tree. _writeAudit keeps its /tmp fallback for a read-only volume.
        const baseDir = path.join(cfg.getMediaDir(), 'logs', 'cli');
```

- [ ] **Step 3: Move the data**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p media/logs/cli
  mv data/household/cli/log/* media/logs/cli/ 2>/dev/null || true
  rmdir data/household/cli/log data/household/cli
  chown -R node:node media/logs/cli
  ls media/logs/cli
'
```

- [ ] **Step 4: Verify by writing a real audit entry**

Run any write-mode CLI command, then:

```bash
sudo docker exec daylight-station sh -c 'ls -la media/logs/cli; ls -d data/household/cli 2>/dev/null && echo "REGRESSION: old root recreated" || echo "old root gone"'
```
Expected: a dated `.ndjson` in the new location, no `data/household/cli`.

- [ ] **Step 5: Commit**

```bash
git add cli/_bootstrap.mjs
git commit -m "refactor(cli): the write-audit trail is a log, so it lives in media

Append-only, unbounded, no reader anywhere in backend/src, cli, or frontend/src.
'cli' also names the mechanism rather than a domain and 'log' is a lifecycle
stage, so it failed the folder rule twice over. media/logs/{app} is the
established shape."
```

---

## Task 8: Move `strava-webhooks` to `media/archives/`

A self-pruning 7-day job queue ("did we already process this webhook"), not curated state. The real Strava data already lives at `media/archives/strava/`.

**Files:**
- Modify: `backend/src/app.mjs:2823`
- Modify: `cli/lib/fitness/scan.mjs:248`
- Modify: `cli/scripts/recreate-may5-strava-session.mjs:198`
- Modify: `backend/src/1_adapters/strava/StravaWebhookJobStore.mjs:7` (stale docstring)

- [ ] **Step 1: Repoint the composition root**

`app.mjs:2823`:

```javascript
      basePath: path.join(configService.getMediaDir(), 'archives', 'strava-webhooks'),
```

- [ ] **Step 2: Repoint both CLI sites**

`cli/lib/fitness/scan.mjs:248` and `cli/scripts/recreate-may5-strava-session.mjs:198` both build the path with a bare `path.join` on `dataDir`. Replace each with the media equivalent, using whichever media accessor that file already has in scope (`configService.getMediaDir?.()` in `scan.mjs` — confirm with `grep -n "getMediaDir" cli/lib/fitness/scan.mjs` first; if absent, thread it from `ctx` the way `matchHome.mjs:84` does).

- [ ] **Step 3: Fix the docstring**

`StravaWebhookJobStore.mjs:7` currently documents `data/household/common/strava/strava-webhooks/...` — a `common/` root retired long ago. Replace with `media/archives/strava-webhooks/{activityId}.yml`.

- [ ] **Step 4: Move the data**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p media/archives
  mv data/household/strava/strava-webhooks media/archives/strava-webhooks
  rmdir data/household/strava
  chown -R node:node media/archives/strava-webhooks
  echo "moved: $(ls media/archives/strava-webhooks | wc -l) records"
'
```
Expected: ~285 records.

- [ ] **Step 5: Deploy — HALT on the gate, then verify**

Gate, build, deploy. Then confirm the job store initialises against the new root:

```bash
sudo docker logs --since 60s daylight-station 2>&1 | grep -i strava | head -5
```
Expected: no path or ENOENT errors from the webhook store.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app.mjs cli/lib/fitness/scan.mjs \
        cli/scripts/recreate-may5-strava-session.mjs \
        backend/src/1_adapters/strava/StravaWebhookJobStore.mjs
git commit -m "refactor(strava): the webhook ledger is operational state, not data

A self-pruning 7-day job queue recording which webhooks were already processed.
The substantive Strava data has lived at media/archives/strava/ for a while;
this ledger was simply never colocated with it. Also fixes a docstring naming a
common/ root that no longer exists."
```

---

## Task 9: Split `content-filter/`

Curated policy stays in `data/`; machine-fetched EDLs move to `media/`. This is the one task where a reader must consult two roots, so it costs a real code change rather than a path swap.

**Files:**
- Modify: `backend/src/4_api/v1/routers/contentFilter.mjs:20` (and the joins at :31,:35,:36)
- Modify: `cli/contentfilter.cli.mjs:88-92` (`filterCacheDir()`)

**Interfaces:**
- Produces: `contentFilter.mjs` takes both `householdDir` and `mediaDir`; `profiles/` and `overrides/` resolve under `householdDir/content-filter`, `edl/` under `mediaDir/content-filter`.

- [ ] **Step 1: Back up before moving 20M of hard-to-regenerate data**

VidAngel is an unofficial scraped API — "regenerable" is theoretical. Snapshot first:

```bash
sudo docker exec daylight-station sh -c '
  mkdir -p data/_deleteme
  cp -r data/household/content-filter data/_deleteme/content-filter-pre-split-backup
  chown -R node:node data/_deleteme
  du -sh data/_deleteme/content-filter-pre-split-backup
'
```

- [ ] **Step 2: Give the router a media root**

`contentFilter.mjs` — change the factory signature to accept `mediaDir`, and split the roots:

```javascript
export function createContentFilterRouter({ householdDir, mediaDir, logger }) {
  // Curated policy (hand-authored profiles, human-reviewed overrides) stays in
  // the committable tree. EDLs are machine-fetched from VidAngel and are 20M —
  // heavy and regenerable, so they live in media.
  const dataRoot = path.join(householdDir, 'content-filter');
  const mediaRoot = path.join(mediaDir, 'content-filter');
```

Then update the three joins: `edl` uses `mediaRoot`, `profiles` and `overrides` use `dataRoot`.

- [ ] **Step 3: Pass the media dir at the call site**

`app.mjs:1871` — add `mediaDir: configService.getMediaDir(),` to the `createContentFilterRouter({...})` call.

- [ ] **Step 4: Split the CLI's root helper**

`cli/contentfilter.cli.mjs` — replace the single `filterCacheDir()` with two helpers, keeping the existing name for the data half so the ~10 `profiles`/`overrides` call sites are untouched:

```javascript
/** Curated half — profiles, overrides, bad-words. Committable. */
const filterCacheDir = () => path.join(resolveDataDir(), 'household', 'content-filter');
/** Machine-fetched half — edl/, catalog, plex map. Heavy, lives in media. */
const filterMediaDir = () => path.join(resolveMediaDir(), 'content-filter');
```

Then change only the `edl`, `CATALOG_PATH`, and `MAP_PATH` sites to `filterMediaDir()`. Confirm a `resolveMediaDir` exists in that file (`grep -n "resolveMediaDir\|getMediaDir" cli/contentfilter.cli.mjs`); if not, add it mirroring `resolveDataDir`.

- [ ] **Step 5: Move only the machine-fetched half**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p media/content-filter
  mv data/household/content-filter/edl media/content-filter/edl
  mv data/household/content-filter/vidangel-catalog.json media/content-filter/
  mv data/household/content-filter/plex-vidangel-map.yml media/content-filter/
  chown -R node:node media/content-filter
  echo "data half:"; ls data/household/content-filter
  echo "media half:"; ls media/content-filter | head
'
```
Expected: data half shows `bad-words.yml overrides profiles`; media half shows `edl plex-vidangel-map.yml vidangel-catalog.json`.

- [ ] **Step 6: Deploy — HALT on the gate, then verify with a real title**

Gate, build, deploy. Pick a ratingKey that has an EDL (`ls media/content-filter/edl | head -1` gives e.g. `349222.edl.yml`):

```bash
curl -s "http://localhost:3111/api/v1/content-filter/349222" | head -c 250
```
Expected: JSON containing `cues` — proving the router reads EDLs from media AND merges the profile from data. An empty or 404 response means one of the two roots is wrong.

- [ ] **Step 7: Commit**

```bash
git add backend/src/4_api/v1/routers/contentFilter.mjs backend/src/app.mjs cli/contentfilter.cli.mjs
git commit -m "refactor(content-filter): split curated policy from fetched EDLs

profiles/ and overrides/ are hand-authored or human-reviewed — overrides carries
manual addCues entries gated behind an explicit --write after a human checks the
fit. Those stay committable. edl/ (499 files, 19.6M), the VidAngel catalog dump
and the Plex map are machine-fetched and move to media.

The router and CLI now resolve two roots instead of one, which is the real cost
of this split and the reason it is not just an mv."
```

---

## Task 10: Move `komga/cache/toc` to `data/content/komga/toc/`

**Decision required before starting.** Two analyses disagreed: one classified this as a regenerable cache bound for `media/`; the other found the producer is an LLM/vision agent (`3_applications/agents/paged-media-toc`) whose output costs vision calls per book and is not byte-reproducible. This plan implements the **stays-in-data** reading — 264K of text that is expensive and non-deterministic to rebuild does not belong in a tree whose contract is "safe to lose". If the owner prefers `media/`, the only change is the destination path; the two-call-path hazard below applies either way.

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs:194,231,283`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs:25,29,35,38`
- Modify: `cli/backfill-toc-offset.cli.mjs:178,186,232`

- [ ] **Step 1: Note the hazard before editing**

Two independent code paths read and write this same subtree — `KomgaFeedAdapter` directly, and `YamlTocCacheDatastore` wired at `bootstrap.mjs:2685`. Updating one and not the other reproduces the exact writer/reader split Task 1 now detects. Change both in this task.

- [ ] **Step 2: Repoint all three files**

Every site currently builds `komga/cache/toc/...`. Replace with `content/komga/toc/...` — note the `cache` segment is deliberately dropped, because the name invites treating LLM-extracted data as disposable. In `cli/backfill-toc-offset.cli.mjs:178`, the bare join becomes `join(dataDir, 'content', 'komga', 'toc')`.

- [ ] **Step 3: Verify no site survives**

Run: `grep -rn "komga/cache" backend/src cli frontend/src | grep -v node_modules`
Expected: zero hits.

- [ ] **Step 4: Move the data**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p data/content/komga
  mv data/household/komga/cache/toc data/content/komga/toc
  rmdir data/household/komga/cache data/household/komga
  chown -R node:node data/content/komga
  echo "moved: $(ls data/content/komga/toc | wc -l) toc files"
'
```
Expected: 30 files, and `data/household/komga` gone entirely (its `hero/` orphans were already retired).

- [ ] **Step 5: Deploy — HALT on the gate, then verify both paths**

Gate, build, deploy. Then exercise the feed path, which is the one that reads TOCs:

```bash
curl -s "http://localhost:3111/api/v1/feed?source=komga" | head -c 250
npm run audit:paths
```
Expected: article entries with page numbers, and no writer/reader split reported by Task 1's new check.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs \
        backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs \
        cli/backfill-toc-offset.cli.mjs
git commit -m "refactor(komga): TOC extraction is content metadata, not a disposable cache

Produced by the paged-media-toc LLM agent — vision calls per book, not
byte-reproducible. media/ implies safe-to-lose, which this is not: it is 264K of
text that costs real money and non-deterministic output to rebuild. Files under
content/ beside the article material it indexes, and drops the 'cache' segment
that invited exactly the wrong call.

Both code paths move together — KomgaFeedAdapter and YamlTocCacheDatastore
independently read and write this subtree."
```

---

## Task 11: Move `config/lists/` to `data/content/lists/`

Playlists, menus, watchlists and saved queries are authored content, not app settings. The codebase already agrees — the admin module is named `ContentLists` and routes at `/admin/content/lists/*`. The 41 `*.yml` directly in `config/` are mechanically bound there by `getHouseholdAppConfig` and stay.

**Files:**
- Modify: `backend/src/app.mjs:902,1336,1343`
- Modify: `backend/src/5_composition/bootstrap.mjs:618`
- Modify: `backend/src/0_system/config/UserDataService.mjs:408`
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs:115-117` (doc table)
- Modify: `backend/src/1_adapters/persistence/yaml/YamlListDatastore.mjs:42,69`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSavedQueryDatastore.mjs:14`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs:38` (`config/lists/queries/komga`)
- Modify: `backend/src/3_applications/content/services/ListManagementService.mjs:171`
- Modify: `backend/src/1_adapters/content/list/manifest.mjs:17`
- Modify: `cli/prefetch-abs-ebooks.mjs:69,74`

- [ ] **Step 1: Enumerate before editing**

Run: `grep -rn "config/lists\|'config', 'lists'" backend/src cli frontend/src | grep -v node_modules | grep -viE "\.test\."`
Expected: the sites above. Work from the live grep, not this list — if it disagrees, the grep wins.

- [ ] **Step 2: Repoint every site**

Replace `config/lists` with `content/lists` throughout, and `path.join(..., 'config', 'lists')` with `path.join(..., 'content', 'lists')`. Note `bootstrap.mjs:618` hardcodes `path.join(listDataPath, toFolderName('default'), 'config', 'lists', 'queries')` — a household-scoped path. Since `content/` is NOT household-scoped, that line becomes `path.join(listDataPath, 'content', 'lists', 'queries')`. Verify `listDataPath` is the data root (`app.mjs:902` passes `dataBasePath`) before making this change; if it is household-scoped, thread the data root instead.

- [ ] **Step 3: Move the data**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p data/content
  mv data/household/config/lists data/content/lists
  chown -R node:node data/content/lists
  ls data/content/lists
'
```
Expected: `menus programs queries watchlists`.

- [ ] **Step 4: Deploy — HALT on the gate, then verify each list type**

Gate, build, deploy. All four types must resolve, because they are served by different datastores:

```bash
curl -s "http://localhost:3111/api/v1/list/menu/music" | head -c 200
curl -s "http://localhost:3111/api/v1/list/program/morning-program" | head -c 200
curl -s "http://localhost:3111/api/v1/list/watchlist/scripture" | head -c 200
curl -s "http://localhost:3111/api/v1/admin/content/lists" | head -c 200
```
Expected: real items from each. An empty array is a FAILURE, not a pass — it is what a wrong root produces.

- [ ] **Step 5: Commit**

```bash
git add backend/src cli/prefetch-abs-ebooks.mjs
git commit -m "refactor(lists): playlists and menus are content, not settings

Menus, programs, watchlists and saved queries are material the household
consumes — the admin module is literally named ContentLists and routes at
/admin/content/lists/*. config/ stays kind-first for the 41 app-config files
that getHouseholdAppConfig mechanically binds there; this was the one subtree
inside it that was never settings."
```

---

## Task 12: File the orphaned `config/works/`

Two files with no reader. `config/school.yml:115-117` says so in the codebase's own words: *"'works' is authored but not yet wired — no reader resolves it."* Filing it correctly does not make it work; it still needs a reader.

**Files:**
- Modify: `data/household/config/school.yml` (comment only — update the path it cites)

- [ ] **Step 1: Confirm it is still orphaned**

Run: `grep -rn "config/works\|i-survived\|shakespeare-tales" backend/src cli frontend/src | grep -v node_modules | grep -viE "admin/art"`
Expected: zero hits. If a reader has appeared since this plan was written, STOP and repoint it instead of moving blind.

- [ ] **Step 2: Move the data**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p data/content/school/english/works
  mv data/household/config/works/*.yml data/content/school/english/works/
  rmdir data/household/config/works
  chown -R node:node data/content/school/english/works
  ls data/content/school/english/works
'
```

- [ ] **Step 3: Update the comment that references it**

In `config/school.yml`, the NOTE at lines 115-117 should now read `content/school/english/works/` where it cites the location, keeping the "not yet wired" warning intact.

```bash
sudo docker exec daylight-station sh -c "sed -i 's|config/works|content/school/english/works|g' data/household/config/school.yml"
```

- [ ] **Step 4: Deploy and verify nothing regressed**

No code changed, so no rebuild is strictly required — but confirm the school app still boots clean:

```bash
curl -s -o /dev/null -w "school materials %{http_code}\n" "http://localhost:3111/api/v1/school/materials"
sudo docker logs --since 60s daylight-station 2>&1 | grep -ic '"level":"error"'
```

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "chore(school): file the unwired works/ definitions under content

Two curriculum drill-down files with no reader — config/school.yml says so
itself. They are English/literature material, so they belong beside the other
subject shelves in content/school/, not in the settings tree. This files them
correctly; it does not wire them up."
```

---

## Task 13: Final reconciliation

- [ ] **Step 1: Run the full audit**

Run: `npm run audit:paths`
Expected: every contract resolves, nothing orphaned, and **no writer/reader splits**.

- [ ] **Step 2: Measure the result**

```bash
sudo docker exec daylight-station sh -c 'du -sh data/ media/; echo "--- household ---"; du -sh data/household/; ls data/household'
```
Expected: `data/` well under 900M (from 1.7G at the start of this work), `data/household/` under 30M, and no `piano/log`, `screens`, `livestream`, `cli`, `strava`, `komga`, or `eink` at the household root.

- [ ] **Step 3: Run the full test suites**

```bash
npm run test:backend
/opt/Code/DaylightStation/node_modules/.bin/vitest run
```
Expected: no NEW failures beyond the known pre-existing set listed in Global Constraints. Verify any surprise by reverting your source change and re-running before attributing it to yourself.

- [ ] **Step 4: Update the taxonomy audit to reflect what shipped**

Edit `docs/_wip/audits/2026-08-16-household-data-taxonomy.md`, marking each moved item done with its commit hash, and recording the final `data/` size. Leave the reasoning sections intact — they explain why, and the next person will need them.

- [ ] **Step 5: Commit**

```bash
git add docs/_wip/audits/2026-08-16-household-data-taxonomy.md
git commit -m "docs(audit): record what the data/media reorg actually moved"
```

---

## Deliberately Out of Scope

Each of these is real, was investigated, and is excluded with a reason. None should be silently folded into a task above.

| Item | Why not here |
|---|---|
| `fitness/log` `timeline.series` split (67M) | Correct end-state, but `heal`/`merge`/`split`/`push`/`reconstruct` all manipulate `series` via raw fs, bypassing the datastore. Needs its own plan that updates the CLI toolkit in the same change — the snapshots split already proved the failure mode |
| `content/readalong/scripture` live sets (198M) | Needs a `dataPath` repoint plus a legacy-fallback fix at `localContent.mjs:50-51`, and it is served to users daily. Own plan |
| `users/kckern/lifelog` archives (208M) | `archives/strava/` is a **stalled existing migration** — re-run `cli/migrations/migrate-strava-archives.mjs` rather than deciding anything new. `lastfm`/`nutrition` cold storage is an architecture call |
| `automotive/log` `trips/*/samples` split | Correct end-state but under 1M today; the read path renders trip maps from `samples` and would need sidecar rehydration. Low urgency |
| `barcode/log` domain split | Two analyses disagreed — domain purity (`ds2278`→trigger, `nutribot-upc`→nutrition) vs. keeping one scanner's history in one place for hardware debugging. Owner's call |
| `pressure-mats/log` → media | Two analyses disagreed on timing: proactive (fastest per-day growth) vs. wait (60K today). Owner's call |
| `data/_deleteme/` (263M), `data/_trash/` (42M) | Deliberately parked retired data. Largest single lever left, but purging is the owner's decision |
| `data/agents/memory.db` Dropbox conflicts | A live SQLite WAL is being synced — a corruption risk, not a placement problem. Needs its own fix |
| 4 pre-existing CLI test failures, 5 golden snapshots | Real, unrelated to placement. Track separately |
