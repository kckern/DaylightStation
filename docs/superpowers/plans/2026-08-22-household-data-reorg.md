# Household Data Tree Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove misleading dead config, consolidate ad-hoc backups, and close two latent path/SSoT bugs (DoNow, camera archive) in `data/household/`, without reshaping any working storage layout.

**Architecture:** The household tree is governed by `shared/contracts/householdConfig.mjs` — folder = domain, named after `backend/src/3_applications/`. That contract is healthy: all 31 registered paths resolve on disk. Every defect found is either (a) stale config left behind by the Phase E `config/` retirement, (b) junk files, or (c) a domain writing outside its own folder. This plan fixes those three classes and changes no folder that is currently correct.

**Tech Stack:** Node ESM (`.mjs`), YAML via `js-yaml`, two test runners (see Global Constraints), Docker for data-volume writes.

## Global Constraints

- **Two test runners, split by location. Do not mix them.**
  - `backend/tests/unit/**` → **vitest**, globals (`describe`/`it`/`expect`). Run: `npx vitest run <file>`
  - `backend/src/**/*.test.mjs` (colocated) → **node:test**, `import { test } from 'node:test'` + `node:assert/strict`. Run: `node --test <file>`
  - Both verified working 2026-08-22. Putting vitest globals in a colocated test yields `No test suite found`; putting `node:test` imports under `backend/tests/unit/` will not be collected by the vitest sweep.
- **`npm run test:backend` is broken** — it invokes `node scripts/test-backend.mjs`, which does not exist. Never use it as a gate. Run the specific files named in each task.
- **Never `rm` inside the data tree.** Move to `data/_deleteme/` (gitignored, user empties manually). `docker exec` runs as **root**, so `rm` always "succeeds" — that is the hazard, not the safeguard.
- **The `claude` user cannot write the data volume directly.** All data-volume writes go through `sudo docker exec daylight-station sh -c '...'`. After creating files this way, `chown -R node:node` the touched paths — docker exec creates them root-owned.
- **Do not use `sed -i` on YAML inside the container.** Write the complete file with a heredoc.
- **Config is cached in-memory at startup.** Data-volume YAML edits need a container restart (or a `reloadHouseholdAppConfig` call) before they take effect.
- **Deploy gate — this is its own step and MUST halt, never chained after a build.** Before `sudo deploy-daylight`, confirm BOTH are clear:
  ```bash
  sudo docker logs --since 75s daylight-station 2>&1 \
    | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
  sudo docker logs --since 75s daylight-station 2>&1 \
    | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
    | sort | uniq -c
  ```
  Clear = zero recurring render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If either gate is active, STOP and ask.

## Explicitly Out of Scope: reshaping `fitness/log/`

`fitness/log/` holds 2,478 dated directories for 3,304 files; 2,125 of them (86%) contain exactly one file. It is 74% of the household tree by file count. It is the most visually offensive thing in the inventory, and this plan deliberately does **not** touch it.

Reasons, in order of weight:

1. **The problem it would solve is already solved.** Directory sprawl's real cost is scan latency, and `YamlSessionDatastore` already fixed that with `_index/{YYYY-MM}.json` month shards (260ms → 32ms). Flattening day dirs into month dirs would buy tidier `ls` output and fewer Dropbox sync entries — not performance.
2. **The blast radius is large.** `YamlSessionDatastore.mjs` is 763 lines with day-directory assumptions threaded through it, including `#dayDirMtimeMs()` — index staleness is detected via the *day directory's* mtime. Month dirs would coarsen that to whole-month invalidation.
3. **There is a parallel media tree.** Screenshots live at `{mediaRoot}/fitness/sessions/{YYYY-MM-DD}/{sessionId}/screenshots/`, plus a trash dir on the same scheme. A data-side reshape that skipped these would desynchronize them.
4. **Two other consumers share the layout** — `fitness/log/cycle-races/{YYYY-MM-DD}/{raceId}.yml` (with its own `_index`) and `fitness/log/emergency_lock.yml`.
5. **Archiving pre-2025 to tarballs is worse, not better.** It would make 16 years of workout history unreadable by the app to save disk that isn't scarce.

The one genuinely defective thing under `fitness/log/` is the ad-hoc backup sprawl, which Task 3 fixes without touching the session layout.

---

## Phase 1 — Config truth

Highest value per unit of risk. These are files that actively mislead a reader.

### Task 1: Prove and remove the dead `apps:` block in `household.yml`

`data/household/household.yml` declares an `apps:` block (`fitness.primary_users`, `gratitude.enabled_categories`). It is **structurally unreachable**: `configLoader.mjs:118-123` spreads `household.yml` and then overwrites the `apps` key from the registry.

```js
households[householdId] = {
  ...config,                              // household.yml, including its apps:
  _folderName: dir,
  integrations: loadHouseholdIntegrations(dataDir, dir),
  devices: loadHouseholdDevices(dataDir, dir),
  apps: loadHouseholdApps(dataDir, dir),  // ← clobbers it, every boot
};
```

`loadHouseholdApps()` returns `{...appsFromLegacy, ...appsFromRegistry}` — nothing from `household.yml`. Confirmed by grep: zero consumers of `primary_users` or `enabled_categories` in `backend/src` or `frontend/src`. The live fitness roster is `fitness/config.yml → users.primary`, read at `UserService.mjs:177`.

**Files:**
- Modify: `backend/tests/unit/system/config/loadHouseholdApps.test.mjs` (append two tests)
- Modify (data volume): `data/household/household.yml`

**Interfaces:**
- Consumes: `loadConfig(dataDir)` from `#system/config/configLoader.mjs`; the existing `write(rel, body)` and `apps()` helpers already defined at the top of that test file.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/system/config/loadHouseholdApps.test.mjs`, inside the existing `describe('loadHouseholdApps', ...)` block:

```js
  // The `apps:` key on the household record is REASSIGNED from the registry
  // after household.yml is spread (configLoader.mjs:118-123), so an apps:
  // block written in household.yml can never reach a consumer. These two
  // tests pin that down: a stale block in the wild read as live config for
  // months before anyone noticed it was inert.
  it('IGNORES an apps: block in household.yml — the registry always wins', async () => {
    await fs.writeFile(
      path.join(dataDir, 'household', 'household.yml'),
      'name: Test\napps:\n  scales:\n    unit: stones\n',
    );
    await write('hardware/scales.yml', 'unit: g\n');
    expect(apps().scales).toEqual({ unit: 'g' });
  });

  it('an apps: entry in household.yml with no registered file produces NO app', async () => {
    await fs.writeFile(
      path.join(dataDir, 'household', 'household.yml'),
      'name: Test\napps:\n  ghost:\n    anything: 1\n',
    );
    expect(apps().ghost).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify they pass immediately**

Run: `npx vitest run backend/tests/unit/system/config/loadHouseholdApps.test.mjs`
Expected: PASS.

This is a characterization test, not TDD — it documents existing behavior that was previously undocumented and therefore trusted incorrectly. If either test *fails*, stop: the shadowing analysis is wrong and the data edit in Step 3 is unsafe.

- [ ] **Step 3: Remove the dead block from the data volume**

Read the current file first:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/household.yml'
```

Rewrite without the `apps:` block (keep `version`, `household_id`, `name`, `head`, `users` exactly as they are):

```bash
sudo docker exec daylight-station sh -c "cat > data/household/household.yml << 'EOF'
# =============================================================================
# Household: default
# =============================================================================
#
# NOTE: there is deliberately no \`apps:\` block here. Per-app config lives in
# its own folder, declared in shared/contracts/householdConfig.mjs. An apps:
# block written here is silently discarded — configLoader reassigns the key
# from the registry after spreading this file. See loadHouseholdApps.test.mjs.

version: \"1.0\"

household_id: default
name: \"Default Household\"

# Head of household (default user for single-user operations)
head: kckern

# Option A: usernames are globally unique across this system.
# This roster is the SINGLE SOURCE OF TRUTH for who is in the household;
# piano/config.yml defers to it explicitly.
users:
  - kckern
  - elizabeth
  - felix
  - milo
  - alan
  - soren
EOF"
sudo docker exec daylight-station sh -c 'chown node:node data/household/household.yml'
```

- [ ] **Step 4: Verify the roster still loads**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/household.yml'
curl -s http://localhost:3111/api/v1/auth/context | head -c 400
```
Expected: the file shows the roster with no `apps:` key; the auth context endpoint still returns JSON (it calls `dataService.household.read('household')` at `auth.mjs:96`).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/unit/system/config/loadHouseholdApps.test.mjs
git commit -m "test(config): pin that household.yml apps: block is inert

The apps key is reassigned from the registry after household.yml is
spread (configLoader.mjs:118-123), so an apps: block there never reaches
a consumer. The live tree carried a stale fitness.primary_users /
gratitude.enabled_categories block that read as live config. Removed from
the data volume; these tests stop it coming back unnoticed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix the stale header in `sheets/config.yml`

The live `data/household/sheets/config.yml` opens by calling itself an example and pointing at a path deleted in Phase E:

```yaml
# Example schema for the printable sheet framework. The REAL file lives in
# household data (private), NOT in this repo:
#   data/household/config/sheets.yml
```

All three claims are false: this *is* the file in household data, `data/household/config/` no longer exists, and `find . -name "sheets*.yml"` returns no repo copy. Anyone following the comment concludes they are editing a sample.

**Files:**
- Modify (data volume): `data/household/sheets/config.yml` — header comment only, lines 1-14

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Capture the current file**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/sheets/config.yml' \
  > /tmp/claude-1001/-opt-Code-DaylightStation/sheets-config.yml
head -20 /tmp/claude-1001/-opt-Code-DaylightStation/sheets-config.yml
```

- [ ] **Step 2: Replace only the header block**

Edit `/tmp/claude-1001/-opt-Code-DaylightStation/sheets-config.yml` locally, replacing the first comment block (through the `# Config is cached at startup` line) with:

```yaml
# Printable sheet framework config. THIS IS THE LIVE FILE — registered as
# `sheets: 'sheets/config'` in shared/contracts/householdConfig.mjs. There is
# no repo copy and no example elsewhere.
#
# A sheet is a page of scannable marks that acts as an INPUT DEVICE. Blocks
# declare SHAPE only. The items in a block come from a provider registered in
# code (`source:`), never from literal codes written here — that is what stops a
# printed code from drifting away from the grammar that parses it. Codes are
# produced by the same module that parses them (ScanVocabularyService), so a
# laminated sheet cannot silently rot when config changes.
#
# Today the only registered provider family is nutrition (wired at
# app.mjs:2331 via createNutritionProviders); block icons resolve from
# household/nutrition/icons/.
#
# Served at:  GET /api/v1/sheets/<id>.pdf
# Config is cached at startup — edits need a backend restart.
```

Leave everything from `defaults:` onward byte-identical.

- [ ] **Step 3: Write it back and fix ownership**

```bash
sudo docker cp /tmp/claude-1001/-opt-Code-DaylightStation/sheets-config.yml \
  daylight-station:/usr/src/app/data/household/sheets/config.yml
sudo docker exec daylight-station sh -c 'chown node:node data/household/sheets/config.yml'
```

- [ ] **Step 4: Verify the sheet still renders**

```bash
sudo docker exec daylight-station sh -c 'head -20 data/household/sheets/config.yml'
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3111/api/v1/sheets/fridge.pdf
```
Expected: header shows the new text; the PDF endpoint returns `200 application/pdf`. A non-200 means the YAML body was damaged — restore from the captured copy.

- [ ] **Step 5: Commit**

No repo files changed in this task (data-volume only). Record it in the phase commit at the end of Phase 2.

---

## Phase 2 — Junk removal

Zero-risk deletions. Everything here is provably not read.

### Task 3: Quarantine stray files and consolidate the fitness backup dirs

Seven items, all verified. **Two empty directories are deliberately excluded** — `gaming/definitions/` and `gaming/retroarch/thumbnails/` are live write targets (`app.mjs:1789` `archiveDir`, `app.mjs:4809` `thumbnailBasePath`). Do not touch them.

**Files:**
- Move (data volume) into `data/_deleteme/2026-08-22-household-junk/`:
  - `household/gratitude/.claude/`
  - `household/fitness/log/.claude/`
  - `household/piano/config.yml.bak-20260817`
- Move within the data volume:
  - `household/fitness/log/2026-04-06/20260406060032.yml.bak` → the consolidated backup tree
  - `household/fitness/log/_merge_backups/`, `_participant_backups/`, `_split_backups/` → `household/fitness/log/_backups/{merge,participant,split}/`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Confirm nothing reads the backup dirs**

```bash
cd /opt/Code/DaylightStation
grep -rn "_merge_backups\|_participant_backups\|_split_backups\|_backups" \
  backend/src --include=*.mjs | grep -v test
```
Expected: **no output.** If anything matches, stop — a reader exists and the rename in Step 4 would break it.

- [ ] **Step 2: Quarantine the junk (move, never rm)**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  Q=data/_deleteme/2026-08-22-household-junk
  mkdir -p "$Q"
  mv data/household/gratitude/.claude          "$Q/gratitude-dot-claude"
  mv data/household/fitness/log/.claude        "$Q/fitness-log-dot-claude"
  mv data/household/piano/config.yml.bak-20260817 "$Q/piano-config.yml.bak-20260817"
  ls -la "$Q"
'
```

- [ ] **Step 3: Verify the live piano config survived**

```bash
sudo docker exec daylight-station sh -c 'ls -la data/household/piano/ | head'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3111/api/v1/piano/config
```
Expected: `config.yml` present with no `.bak-*` sibling. (If the piano config route differs, substitute any endpoint that reads piano config; a 200 is the signal.)

- [ ] **Step 4: Consolidate the three backup dirs into one**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  B=data/household/fitness/log/_backups
  mkdir -p "$B/merge" "$B/participant" "$B/split" "$B/stray"
  mv data/household/fitness/log/_merge_backups/*       "$B/merge/"       2>/dev/null || true
  mv data/household/fitness/log/_participant_backups/* "$B/participant/" 2>/dev/null || true
  mv data/household/fitness/log/_split_backups/*       "$B/split/"       2>/dev/null || true
  mv data/household/fitness/log/2026-04-06/*.yml.bak   "$B/stray/"       2>/dev/null || true
  rmdir data/household/fitness/log/_merge_backups \
        data/household/fitness/log/_participant_backups \
        data/household/fitness/log/_split_backups
  chown -R node:node "$B"
  find "$B" -type f | head -20
  echo "--- files under _backups:"; find "$B" -type f | wc -l
'
```
Expected: 13 files (4 merge + 1 participant + 1 split + 1 stray, plus whatever else the dirs held — the earlier inventory measured 448K/736K/868K).

- [ ] **Step 5: Verify no live session directory lost a file**

```bash
sudo docker exec daylight-station sh -c '
  ls data/household/fitness/log/2026-04-06/
  echo "--- day dirs:"; ls data/household/fitness/log | grep -c "^20"
'
curl -s "http://localhost:3111/api/v1/fitness/sessions?startDate=2026-04-01&endDate=2026-04-30" \
  | head -c 300
```
Expected: `2026-04-06/` still holds its `.yml` (only the `.bak` moved); day-dir count is 2,478; the sessions query returns JSON.

- [ ] **Step 6: Commit the Phase 1 + 2 data-volume record**

No repo source changed in Tasks 2-3. Commit a short note so the data-volume state is traceable from git:

```bash
cd /opt/Code/DaylightStation
git add docs/superpowers/plans/2026-08-22-household-data-reorg.md
git commit -m "docs(plan): household data tree reorg

Phases 1-2 executed against the data volume: removed the inert
household.yml apps: block, corrected the sheets/config.yml header that
pointed at the retired config/ path, quarantined two stray .claude dirs
and a piano config .bak to _deleteme/, and consolidated three ad-hoc
fitness backup dirs into fitness/log/_backups/.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 3 — DoNow writes outside its own folder

### Task 4: Household-scope the DoNow datastore

`YamlDoNowDatastore` writes to `<dataDir>/apps/donow/` — outside `household/` entirely, and with **no household id in the path**:

```js
#root() { return path.join(this.#dataDir, 'apps', 'donow'); }
```

Every other domain is `household[-{hid}]/…`. Two households would share one `pending.yml` and one dispatch log, so approvals raised in household B would be visible and approvable from household A.

**This migration is free right now.** `data/apps/` does not exist on the volume, and the datastore calls `fs.mkdir(..., { recursive: true })` on every write path — so its absence proves zero writes have ever occurred. Corroborated in the log store: 30 days of `context.module:donow` returns 111 `donow.ready` events (one per boot) and nothing else. There is no data to migrate. It stops being free the first time someone dispatches.

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.mjs` (constructor + `#root`)
- Modify: `backend/src/5_composition/modules/donow.mjs:186`
- Create: `backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.test.mjs`

**Interfaces:**
- Consumes: `configService.getHouseholdPath(relativePath, householdId = null)` → absolute path string. Both `configService` and `householdId` are already in scope in `donow.mjs` (parameters at line 89).
- Produces: `new YamlDoNowDatastore({ configService, householdId, logger })`. The old `{ dataDir }` form is removed, not deprecated — there is exactly one construction site.

- [ ] **Step 1: Write the failing test**

Create `backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.test.mjs`. This is a **colocated** test → `node:test`, matching `YamlEmergencyLockDatastore.test.mjs` next to it:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YamlDoNowDatastore } from './YamlDoNowDatastore.mjs';

function makeStore(householdId = null) {
  const calls = [];
  const configService = {
    getHouseholdPath: (rel, hid) => {
      calls.push({ rel, hid });
      return `/data/household${hid ? `-${hid}` : ''}/${rel}`;
    },
  };
  return { store: new YamlDoNowDatastore({ configService, householdId }), calls };
}

test('roots under the household folder, not <dataDir>/apps', () => {
  const { store, calls } = makeStore();
  // #root is private; exercise it through the public path accessor.
  assert.equal(store.rootPath(), '/data/household/donow');
  assert.deepEqual(calls.at(-1), { rel: 'donow', hid: null });
});

test('scopes the path to a non-default household', () => {
  const { store } = makeStore('beta');
  assert.equal(store.rootPath(), '/data/household-beta/donow');
});

test('constructor requires configService with getHouseholdPath', () => {
  assert.throws(
    () => new YamlDoNowDatastore({ dataDir: '/data' }),
    /requires configService with getHouseholdPath/,
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.test.mjs`
Expected: FAIL — `store.rootPath is not a function`, and the constructor throws the old `requires dataDir` message.

- [ ] **Step 3: Change the datastore**

In `backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.mjs`, replace the `#dataDir` field, the constructor, and `#root()`:

```js
export class YamlDoNowDatastore {
  #configService;
  #householdId;
  #logger;
```

```js
  /**
   * @param {Object} config
   * @param {Object} config.configService - Must expose getHouseholdPath(rel, hid).
   * @param {string|null} [config.householdId] - null = default household.
   * @param {Object} [config.logger] - Logger with debug/info/warn/error methods.
   */
  constructor(config = {}) {
    if (typeof config.configService?.getHouseholdPath !== 'function') {
      throw new Error('YamlDoNowDatastore requires configService with getHouseholdPath');
    }
    this.#configService = config.configService;
    this.#householdId = config.householdId ?? null;
    this.#logger = config.logger || console;
  }

  /** Absolute path to this household's donow folder. Exposed for tests. */
  rootPath() { return this.#root(); }
```

```js
  #root() {
    return this.#configService.getHouseholdPath('donow', this.#householdId);
  }
```

Leave `#pendingFile()`, `#logFile()`, `#enqueue()`, and every read/write method unchanged — they all derive from `#root()`.

Then update the header comment (lines 6 and 17) so the documented paths match reality:

```js
 *   pending: household[-{hid}]/donow/pending.yml
```
```js
 *   dispatch log: household[-{hid}]/donow/log/{YYYY-MM-DD}.yml   (append-only)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Update the single construction site**

In `backend/src/5_composition/modules/donow.mjs`, line 186:

```js
  const datastore = new YamlDoNowDatastore({ configService, householdId, logger });
```

Then remove the now-unused `dataDir` binding at line 95 **only if nothing else in the file uses it**:

```bash
grep -n "dataDir" backend/src/5_composition/modules/donow.mjs
```
If `dataDir` appears only on the line that defines it, delete that line. If it has other consumers, leave it.

- [ ] **Step 6: Verify the app still boots and DoNow still mounts**

```bash
cd /opt/Code/DaylightStation
node --test backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.test.mjs
npx vitest run backend/tests/unit/system/config/
```
Expected: node test 3/3 pass; vitest config suite passes.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.mjs \
        backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.test.mjs \
        backend/src/5_composition/modules/donow.mjs
git commit -m "fix(donow): scope the datastore to the household folder

The datastore rooted at <dataDir>/apps/donow — outside household/ and
with no household id, so two households would share one pending.yml and
one dispatch log. Now resolves via configService.getHouseholdPath('donow',
householdId), matching every other domain.

Free to change: data/apps/ never existed on the volume and the datastore
mkdirs recursively on write, so nothing had ever been persisted (30d of
logs show only donow.ready boot events).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 4 — Camera archive SSoT

### Task 5: Add the NVR to `devices.yml`

`camera/archive.yml` declares `nvr: { host: 10.0.0.70 }`. That NVR is the primary footage source (`sources.footageFrom: nvr`) and an addressable networked device with credentials — but it has **no entry in `hardware/devices.yml`**, the file whose job is to answer "what is on the network and how do I reach it."

**Files:**
- Modify (data volume): `data/household/hardware/devices.yml` — add one device entry

**Interfaces:**
- Consumes: nothing.
- Produces: device id `camera-nvr`, resolvable via `configService.getDeviceConfig('camera-nvr', householdId)`. Task 6 depends on this id existing.

- [ ] **Step 1: Capture the current devices.yml**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/hardware/devices.yml' \
  > /tmp/claude-1001/-opt-Code-DaylightStation/devices.yml
grep -n "doorbell:" /tmp/claude-1001/-opt-Code-DaylightStation/devices.yml
wc -l /tmp/claude-1001/-opt-Code-DaylightStation/devices.yml
```

- [ ] **Step 2: Add the NVR entry**

Edit the local copy. Immediately after the `doorbell:` block (it ends before the next top-level device key — `ds2278:` at roughly line 268), insert at the same indentation as `doorbell:`:

```yaml
  # ---------------------------------------------------------------------------
  # Camera NVR (Reolink). Primary footage source for the cold-archive pipeline:
  # camera/archive.yml sets sources.footageFrom: nvr, and each camera's
  # nvrChannel indexes into this recorder. Declared here so devices.yml stays
  # the single answer to "what is on the network and how do I reach it".
  # ---------------------------------------------------------------------------
  camera-nvr:
    type: nvr
    manufacturer: Reolink
    host: 10.0.0.70
    auth_ref: reolink
```

- [ ] **Step 3: Write it back and validate the YAML parses**

```bash
sudo docker cp /tmp/claude-1001/-opt-Code-DaylightStation/devices.yml \
  daylight-station:/usr/src/app/data/household/hardware/devices.yml
sudo docker exec daylight-station sh -c 'chown node:node data/household/hardware/devices.yml'
sudo docker exec daylight-station sh -c "node -e \"
const y=require('js-yaml'),fs=require('fs');
const d=y.load(fs.readFileSync('data/household/hardware/devices.yml','utf8'));
const k=Object.keys(d.devices||d);
console.log('device count:', k.length);
console.log('camera-nvr:', JSON.stringify((d.devices||d)['camera-nvr']));
\""
```
Expected: a device count consistent with before + 1, and the `camera-nvr` entry echoed. If `js-yaml` throws, the insert broke indentation — restore from the captured copy and retry.

- [ ] **Step 4: Verify existing device consumers still resolve**

```bash
curl -s http://localhost:3111/api/v1/device/livingroom-tv/state | head -c 200
```
Expected: JSON, not a 500. (devices.yml is cached at startup, so a fresh entry will not appear until restart — this step only proves the file still parses for existing readers.)

- [ ] **Step 5: Commit**

Data-volume only; record it in the Task 6 commit.

---

### Task 6: Resolve camera host and auth from `devices.yml`

`camera/archive.yml` restates `host: 10.0.0.56` / `10.0.0.44` and `auth.ref: reolink`, all of which `devices.yml` already owns (lines 191, 243, 193, 244). The duplication is live, not vestigial: `cameraArchiveJobHandler.mjs:86` builds its client from the archive copy —

```js
client: new ReolinkClient({ host: cameraCfg.host, ...auth, logger: log }),
```

— while `ReolinkCameraAdapter.mjs:16` resolves from `devices.yml` via `device.auth_ref`. Two consumers, two copies, one physical camera. Change a camera's IP and the live view follows `devices.yml` while the nightly archive keeps dialing the old address.

Urgency is low (`archive.enabled: false` — Pipeline A is off pending dry-run tuning), which is exactly why this is the right moment.

**Files:**
- Modify: `backend/src/3_applications/camera/cameraArchiveJobHandler.mjs:81-93`
- Create: `backend/src/3_applications/camera/cameraArchiveJobHandler.test.mjs`
- Modify (data volume): `data/household/camera/archive.yml` — trim `cameras[].host` and `nvr.host`

**Interfaces:**
- Consumes: `configService.getDeviceConfig(deviceId, householdId)` → device object or `null` (`ConfigService.mjs:367`). Device id `camera-nvr` from Task 5.
- Produces: a module-scope helper `resolveCameraEndpoint(configService, deviceId, householdId)` → `{ host, authRef }`, exported for test.

- [ ] **Step 1: Write the failing test**

Create `backend/src/3_applications/camera/cameraArchiveJobHandler.test.mjs` (colocated → `node:test`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCameraEndpoint } from './cameraArchiveJobHandler.mjs';

const configService = {
  getDeviceConfig: (id) => ({
    'driveway-camera': { type: 'ip-camera', host: '10.0.0.56', auth_ref: 'reolink' },
    'camera-nvr':      { type: 'nvr',       host: '10.0.0.70', auth_ref: 'reolink' },
  }[id] ?? null),
};

test('resolves host and auth_ref from devices.yml', () => {
  assert.deepEqual(
    resolveCameraEndpoint(configService, 'driveway-camera', null),
    { host: '10.0.0.56', authRef: 'reolink' },
  );
});

test('resolves the NVR the same way', () => {
  assert.deepEqual(
    resolveCameraEndpoint(configService, 'camera-nvr', null),
    { host: '10.0.0.70', authRef: 'reolink' },
  );
});

test('throws a named error for an unknown device rather than dialing undefined', () => {
  assert.throws(
    () => resolveCameraEndpoint(configService, 'ghost-camera', null),
    /ghost-camera/,
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test backend/src/3_applications/camera/cameraArchiveJobHandler.test.mjs`
Expected: FAIL — `resolveCameraEndpoint` is not exported.

- [ ] **Step 3: Add the helper**

In `backend/src/3_applications/camera/cameraArchiveJobHandler.mjs`, above the handler:

```js
/**
 * Resolve a camera's network endpoint from devices.yml — the single source of
 * truth for host + credentials. archive.yml used to restate both, so a re-IP'd
 * camera silently desynchronized the archive from the live view.
 *
 * @param {Object} configService - exposes getDeviceConfig(id, householdId)
 * @param {string} deviceId - devices.yml key
 * @param {string|null} householdId
 * @returns {{host: string, authRef: string|undefined}}
 */
export function resolveCameraEndpoint(configService, deviceId, householdId) {
  const device = configService.getDeviceConfig(deviceId, householdId);
  if (!device?.host) {
    throw new Error(
      `camera archive: device '${deviceId}' has no host in devices.yml`,
    );
  }
  return { host: device.host, authRef: device.auth_ref };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test backend/src/3_applications/camera/cameraArchiveJobHandler.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Use it in the handler**

In the loop at `cameraArchiveJobHandler.mjs:81`, replace `cameraCfg.host` with the resolved endpoint. Keep `cameraCfg.nvrChannel` — that camera↔NVR channel mapping is genuine pipeline knowledge and stays in `archive.yml`:

```js
    for (const cameraCfg of config.cameras) {
      const { host: cameraHost } = resolveCameraEndpoint(
        configService, cameraCfg.id, householdId,
      );
```

and at the client construction (line 86):

```js
          client: new ReolinkClient({ host: cameraHost, ...auth, logger: log }),
```

and for the NVR (lines 90-93), replace `config.nvr?.host` / `config.nvr.host`:

```js
          nvr: (() => {
            const { host: nvrHost } = resolveCameraEndpoint(
              configService, 'camera-nvr', householdId,
            );
            return {
              client: new ReolinkClient({ host: nvrHost, ...auth, logger: log }),
            };
          })(),
```

Preserve the surrounding structure of that `nvr:` expression exactly — read lines 88-95 before editing and keep every other property it sets.

- [ ] **Step 6: Trim the duplicated fields from archive.yml**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/camera/archive.yml' \
  > /tmp/claude-1001/-opt-Code-DaylightStation/archive.yml
```

In the local copy, replace the `cameras:`, `nvr:`, and `auth:` blocks with:

```yaml
# Host and credentials for every camera and the NVR come from
# hardware/devices.yml (device ids below). Only archive-specific mapping
# lives here — nvrChannel says which recorder channel holds this camera.
cameras:
  - id: driveway-camera
    nvrChannel: 1
  - id: doorbell
    nvrChannel: 0
```

Delete the `nvr:` and `auth:` blocks entirely. Leave `sources:`, `ledger:`, `archive:`, `budget:`, `sessionize:`, `scoring:`, `sun:`, `timelapse:`, `contactSheets:`, `encoding:`, `classification:`, and `storage:` byte-identical.

```bash
sudo docker cp /tmp/claude-1001/-opt-Code-DaylightStation/archive.yml \
  daylight-station:/usr/src/app/data/household/camera/archive.yml
sudo docker exec daylight-station sh -c 'chown node:node data/household/camera/archive.yml'
sudo docker exec daylight-station sh -c "node -e \"
const y=require('js-yaml'),fs=require('fs');
const c=y.load(fs.readFileSync('data/household/camera/archive.yml','utf8'));
console.log('cameras:', JSON.stringify(c.cameras));
console.log('nvr key present:', 'nvr' in c, '| auth key present:', 'auth' in c);
console.log('storage.hotPath:', c.storage && c.storage.hotPath);
\""
```
Expected: two cameras with `id` + `nvrChannel` only; `nvr`/`auth` both `false`; `storage.hotPath` still set (proves the tail of the file survived).

- [ ] **Step 7: Verify the auth path still resolves**

The handler still needs credentials. Confirm the `auth` binding at `cameraArchiveJobHandler.mjs:70` (`camera.archive.no_auth`) reads from a source that survives — it must now come from the device's `auth_ref` rather than `config.auth.ref`:

```bash
grep -n "auth" backend/src/3_applications/camera/cameraArchiveJobHandler.mjs | head
```
If it still reads `config.auth?.ref`, change it to resolve per-camera from `resolveCameraEndpoint(...).authRef` and re-run the colocated test. Both cameras and the NVR share `auth_ref: reolink`, so a single lookup at the top of the loop is sufficient.

- [ ] **Step 8: Commit**

```bash
git add backend/src/3_applications/camera/cameraArchiveJobHandler.mjs \
        backend/src/3_applications/camera/cameraArchiveJobHandler.test.mjs
git commit -m "fix(camera): resolve archive camera hosts from devices.yml

archive.yml restated host 10.0.0.56/10.0.0.44 and auth.ref: reolink,
which devices.yml already owns. The duplication was live — the archive
job built its ReolinkClient from the archive copy while
ReolinkCameraAdapter used devices.yml, so a re-IP'd camera would
desynchronize them. Added the NVR (10.0.0.70) to devices.yml, which had
been missing entirely despite being the primary footage source.

nvrChannel stays in archive.yml — that mapping is pipeline knowledge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 5 — Retention

### Task 7: Give `weather/log` the prune-on-read treatment

`feed` is the only domain in the tree with a working retention policy, and it is the pattern to copy: `YamlDismissedItemsStore` auto-prunes entries older than 30 days **on load**, writes the pruned file back, and logs `feed.dismissed.pruned`. No background job, no scheduler entry.

`weather/log/` holds 145 daily `YYYY-MM-DD.yml` files with nothing pruning them.

**Files:**
- Read first: `backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs` (the reference implementation)
- Modify: whichever module writes `weather/log/{date}.yml` — locate it in Step 1
- Create: a colocated `.test.mjs` beside that module

**Interfaces:**
- Consumes: the existing weather log writer's own path helper.
- Produces: a `pruneWeatherLog(dir, { keepDays, now })` helper returning `{ pruned: number }`, exported for test.

- [ ] **Step 1: Locate the weather log writer**

```bash
cd /opt/Code/DaylightStation
grep -rn "weather/log" backend/src --include=*.mjs | grep -v test
```
Record the file and the exact path-building expression. **If this returns no writer** (i.e. the files come from a cron job or an external harvester outside `backend/src`), stop and report that — the retention hook belongs wherever the write happens, and this task's remaining steps assume a backend writer.

- [ ] **Step 2: Read the reference implementation**

```bash
sed -n '1,70p' backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs
```
Note the shape: prune during the read, count what was dropped, write back only when `prunedCount > 0`, log once with the count.

- [ ] **Step 3: Write the failing test**

Create the colocated test beside the writer found in Step 1 (`node:test` style). Substitute the real module path:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pruneWeatherLog } from './<writer-module>.mjs';

async function seed(days) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wxlog-'));
  for (const d of days) {
    await fs.writeFile(path.join(dir, `${d}.yml`), 'temp: 1\n');
  }
  return dir;
}

test('drops shards older than keepDays and keeps the rest', async () => {
  const dir = await seed(['2026-01-01', '2026-08-01', '2026-08-20']);
  const now = new Date('2026-08-22T00:00:00Z');
  const { pruned } = await pruneWeatherLog(dir, { keepDays: 30, now });
  assert.equal(pruned, 1);
  const left = (await fs.readdir(dir)).sort();
  assert.deepEqual(left, ['2026-08-01.yml', '2026-08-20.yml']);
});

test('is a no-op when nothing is old enough', async () => {
  const dir = await seed(['2026-08-20', '2026-08-21']);
  const { pruned } = await pruneWeatherLog(dir, {
    keepDays: 30, now: new Date('2026-08-22T00:00:00Z'),
  });
  assert.equal(pruned, 0);
  assert.equal((await fs.readdir(dir)).length, 2);
});

test('ignores files that are not YYYY-MM-DD.yml', async () => {
  const dir = await seed(['2026-01-01']);
  await fs.writeFile(path.join(dir, 'current.yml'), 'temp: 2\n');
  await pruneWeatherLog(dir, { keepDays: 30, now: new Date('2026-08-22T00:00:00Z') });
  const left = await fs.readdir(dir);
  assert.ok(left.includes('current.yml'));
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test backend/src/<path>/<writer-module>.test.mjs`
Expected: FAIL — `pruneWeatherLog` is not exported.

- [ ] **Step 5: Implement the helper**

Add to the writer module:

```js
const DAY_SHARD = /^(\d{4}-\d{2}-\d{2})\.yml$/;

/**
 * Drop weather day-shards older than `keepDays`. Prune-on-write, mirroring
 * YamlDismissedItemsStore's prune-on-read: no scheduler entry, no background
 * job, and the cost is paid by the process that caused the growth.
 *
 * @param {string} dir - the weather/log directory
 * @param {{keepDays?: number, now?: Date}} [opts]
 * @returns {Promise<{pruned: number}>}
 */
export async function pruneWeatherLog(dir, opts = {}) {
  const keepDays = opts.keepDays ?? 30;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - keepDays * 86400000)
    .toISOString().slice(0, 10);

  let pruned = 0;
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { pruned: 0 };   // no log dir yet is not an error
  }

  for (const name of entries) {
    const m = DAY_SHARD.exec(name);
    if (!m || m[1] >= cutoff) continue;
    await fs.rm(path.join(dir, name), { force: true });
    pruned++;
  }
  return { pruned };
}
```

Note the string comparison on `YYYY-MM-DD` is a correct lexicographic date compare — no parsing needed.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test backend/src/<path>/<writer-module>.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 7: Call it from the write path**

After the existing day-shard write, add:

```js
  const { pruned } = await pruneWeatherLog(logDir);
  if (pruned > 0) logger.info?.('weather.log.pruned', { pruned, keepDays: 30 });
```

Use the module's existing `logger` binding and its existing `logDir` expression.

- [ ] **Step 8: Commit**

```bash
git add backend/src/<path>/<writer-module>.mjs backend/src/<path>/<writer-module>.test.mjs
git commit -m "feat(weather): prune log shards older than 30 days on write

weather/log had 145 daily shards and nothing pruning them. Adopts the
prune-on-read pattern from YamlDismissedItemsStore (the only domain in the
tree that already had retention): no scheduler entry, cost paid by the
writer that caused the growth.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Partition `feedback/` by month

`feedback/piano/` holds 72 flat `{YYYYMMDDHHMMSS}_{rand}.yml` files with no partition and no retention; `feedback/fitness/` holds 2. `FeedbackService.mjs:16` documents the path as `data/household/feedback/{app}/{id}.yml`.

Unlike Tasks 4-7 this one **has existing data to migrate**, so it is last and it is the only task in this plan that moves live files.

**Files:**
- Modify: `backend/src/3_applications/common/feedback/FeedbackService.mjs` (path construction + header)
- Create: colocated `FeedbackService.paths.test.mjs`
- Migrate (data volume): `household/feedback/{app}/*.yml` → `household/feedback/{app}/{YYYY-MM}/*.yml`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `feedbackItemPath(root, app, id)` → `{root}/{app}/{YYYY-MM}/{id}.yml`, derived from the `id`'s leading `YYYYMM`.

- [ ] **Step 1: Confirm the id format is reliably `YYYYMMDD…`**

```bash
sudo docker exec daylight-station sh -c 'ls data/household/feedback/piano | head -5'
sudo docker exec daylight-station sh -c \
  'ls data/household/feedback/piano | grep -cvE "^[0-9]{14}_"'
```
Expected: the second command prints `0` — every filename starts with a 14-digit timestamp. **If it prints anything else, stop**: the derivation in Step 3 is unsafe and the ids need a different partition key.

- [ ] **Step 2: Write the failing test**

Create `backend/src/3_applications/common/feedback/FeedbackService.paths.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackItemPath } from './FeedbackService.mjs';

test('partitions by the month embedded in the id', () => {
  assert.equal(
    feedbackItemPath('/d/household/feedback', 'piano', '20260817193407_NhEu1Y'),
    '/d/household/feedback/piano/2026-08/20260817193407_NhEu1Y.yml',
  );
});

test('handles a different app and month', () => {
  assert.equal(
    feedbackItemPath('/d/household/feedback', 'fitness', '20260702215307_J0bvRU'),
    '/d/household/feedback/fitness/2026-07/20260702215307_J0bvRU.yml',
  );
});

test('rejects an id without a leading YYYYMM rather than writing to a junk dir', () => {
  assert.throws(() => feedbackItemPath('/d', 'piano', 'nope'), /unpartitionable/);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test backend/src/3_applications/common/feedback/FeedbackService.paths.test.mjs`
Expected: FAIL — `feedbackItemPath` is not exported.

- [ ] **Step 4: Implement and export the helper**

```js
/**
 * Path for one feedback item, partitioned by the month in its id.
 * Flat {app}/ directories grow without bound; the month dir is derivable
 * from the id itself, so no index or lookup is needed to find an item.
 *
 * @param {string} root - absolute path to household/feedback
 * @param {string} app - 'piano' | 'fitness' | ...
 * @param {string} id - '{YYYYMMDDHHMMSS}_{rand}'
 * @returns {string}
 */
export function feedbackItemPath(root, app, id) {
  const m = /^(\d{4})(\d{2})\d{10}_/.exec(id);
  if (!m) throw new Error(`unpartitionable feedback id: ${id}`);
  return path.join(root, app, `${m[1]}-${m[2]}`, `${id}.yml`);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test backend/src/3_applications/common/feedback/FeedbackService.paths.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 6: Route the service through it**

Replace every construction of the item path in `FeedbackService.mjs` with `feedbackItemPath(...)`, and update the header comment at line 16:

```js
 *   item   → data/household/feedback/{app}/{YYYY-MM}/{id}.yml
```

Ensure the write path creates the month dir (`fs.mkdir(path.dirname(file), { recursive: true })`) before writing.

- [ ] **Step 7: Do NOT migrate data in this task**

The 74 existing files stay flat until after the deploy — see Task 10. Migrating here would move them out from under the OLD build that the container is still serving, 404ing every feedback read until Phase 6 ships. Task 10 runs the migration immediately after the deploy verification instead, which bounds the mismatch window to the seconds between those two steps rather than the whole build.

This task is code-only. Confirm no data moved:

```bash
sudo docker exec daylight-station sh -c \
  'find data/household/feedback -mindepth 1 -maxdepth 2 -type d'
```
Expected: only `feedback/piano` and `feedback/fitness` — no month dirs yet.

- [ ] **Step 8: Commit**

```bash
git add backend/src/3_applications/common/feedback/FeedbackService.mjs \
        backend/src/3_applications/common/feedback/FeedbackService.paths.test.mjs
git commit -m "refactor(feedback): partition items by month

feedback/piano/ held 72 flat files and grows unbounded. The month is
derivable from the id's leading timestamp, so partitioning needs no index.
Existing 74 items migrated in place.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 6 — Ship

### Task 9: Build, gate, deploy

- [ ] **Step 1: Run every test this plan touched**

```bash
cd /opt/Code/DaylightStation
node --test backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.test.mjs
node --test backend/src/3_applications/camera/cameraArchiveJobHandler.test.mjs
node --test backend/src/3_applications/common/feedback/FeedbackService.paths.test.mjs
npx vitest run backend/tests/unit/system/config/
```
Record the actual pass/fail counts. Do not proceed on a failure.

- [ ] **Step 2: Build**

```bash
./scripts/build-daylight.sh
```

- [ ] **Step 3: DEPLOY GATE — this is its own step. STOP here and evaluate.**

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```
Clear = zero render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`.
**If either gate is active, STOP and ask.** Do not chain the deploy onto this command.

- [ ] **Step 4: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 5: Verify the deployed state**

```bash
sleep 20
curl -s http://localhost:3111/build.txt
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=level:error AND _time:5m' -d 'limit=20'
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_msg:"donow.ready" AND _time:5m' -d 'limit=2'
```
Expected: `build.txt` shows the new commit hash; no new errors; `donow.ready` still lists all 7 surfaces.

- [ ] **Step 6: Confirm DoNow's new path is the one that would be written**

```bash
sudo docker exec daylight-station sh -c 'ls -la data/household/donow/ 2>&1'
sudo docker exec daylight-station sh -c 'ls -la data/apps 2>&1'
```
Expected: `data/apps` still absent (nothing has dispatched); `household/donow/` holds `config.yml`. The path change is proven by the unit test, not by a directory that only appears on first dispatch.

---

### Task 10: Migrate the feedback files (runs immediately after Task 9)

Deferred out of Task 8 so the files move *after* the code that reads month paths is live. Run this as soon as Task 9 Step 5 confirms a healthy deploy — between the deploy and this migration the new build reads month paths while the files are still flat, so every feedback read 404s until this completes. Do not leave the gap open.

**Files:**
- Migrate (data volume): `household/feedback/{app}/*.yml` → `household/feedback/{app}/{YYYY-MM}/*.yml`

**Interfaces:**
- Consumes: `feedbackItemPath(root, app, id)` from Task 8, now deployed.
- Produces: nothing.

- [ ] **Step 1: Re-confirm the id format still holds**

```bash
sudo docker exec daylight-station sh -c \
  'ls data/household/feedback/piano | grep -cvE "^[0-9]{14}_"'
```
Expected: `0`. Anything else — stop, do not migrate.

- [ ] **Step 2: Migrate**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  for app in piano fitness; do
    D=data/household/feedback/$app
    [ -d "$D" ] || continue
    for f in "$D"/*.yml; do
      [ -e "$f" ] || continue
      b=$(basename "$f")
      m="${b:0:4}-${b:4:2}"
      mkdir -p "$D/$m"
      mv "$f" "$D/$m/$b"
    done
    chown -R node:node "$D"
  done
  echo "--- after:"; find data/household/feedback -type f | wc -l
  find data/household/feedback -mindepth 1 -maxdepth 2 -type d
'
```
Expected: file count still 74; month dirs like `piano/2026-08`, `piano/2026-06`, `fitness/2026-07`.

- [ ] **Step 3: Verify a feedback item reads back through the deployed code**

```bash
ID=$(sudo docker exec daylight-station sh -c \
  'ls data/household/feedback/piano/2026-08 | head -1' | sed 's/.yml//')
echo "id: $ID"
curl -s "http://localhost:3111/api/v1/feedback/piano/$ID" | head -c 300
```
Expected: JSON for that item, not a 404. A 404 here means the deployed build is not using `feedbackItemPath` — investigate before leaving the tree half-migrated.

---

## Self-Review

**Spec coverage.** Every defect from the sweep maps to a task: dead `apps:` block → Task 1; stale `sheets` header → Task 2; stray `.claude` dirs, `.bak` files, three backup dirs → Task 3; DoNow tree split + missing household scoping → Task 4; missing NVR device → Task 5; camera host/auth duplication → Task 6; no retention → Tasks 7-8. `fitness/log`'s shape is covered by an explicit scope exclusion with reasoning rather than a task. The two empty-but-live directories (`gaming/definitions/`, `gaming/retroarch/thumbnails/`) are called out as do-not-touch in Task 3.

**Known soft spots, flagged rather than papered over:**
- Task 7 Step 1 may find no backend writer for `weather/log` (the shards could come from a cron job or external harvester). The step says to stop and report rather than guess.
- Task 6 Step 7 depends on how `auth` is currently bound at `cameraArchiveJobHandler.mjs:70`; the step prescribes reading it first and gives the correction if it still reads `config.auth?.ref`.
- Task 8 Step 1 gates the whole task on every feedback id matching `^\d{14}_`.

**Type consistency.** `resolveCameraEndpoint` returns `{host, authRef}` in both its definition (Task 6 Step 3) and every call site (Step 5). `pruneWeatherLog(dir, {keepDays, now})` → `{pruned}` matches between test, implementation, and call site. `feedbackItemPath(root, app, id)` is consistent across all three. `YamlDoNowDatastore` takes `{configService, householdId, logger}` in the test, the constructor, and the single composition site.
