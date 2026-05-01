# Personalized Pattern-Aware Coaching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Layer documented user-specific behavioral patterns and longitudinal history over the existing HealthCoachAgent so coaching is grounded in personal precedent rather than generic 7-day windows.

**Architecture:** Hexagonal/DDD-aligned, additive only. New domain entities + services in `backend/src/2_domains/health/`, new tool factories registered with the existing `HealthCoachAgent`, new assignments under `backend/src/3_applications/agents/health-coach/assignments/`, ingestion CLI under `cli/`. Per-user namespaced data lands in `data/users/{userId}/lifelog/archives/` (structured) and `media/archives/` (raw bulk binaries) — no new top-level paths.

**Tech Stack:** Node ESM (`.mjs`), Vitest for unit/isolated tests, `js-yaml`/`yaml` for YAML I/O, existing `BaseAgent` / `Assignment` / `ToolFactory` framework, `WorkingMemory` with TTLs.

**Source PRD:** `docs/roadmap/2026-05-01-personalized-pattern-aware-coaching-design.md`

---

## Priority Order (drives task ordering)

The PRD explicitly defines a priority slot order. This plan follows it:

1. **Slot 1 — Foundation:** F-100 (ingestion), F-101 (PersonalContext bootstrap), F-103 (longitudinal queries), F-104 (SimilarPeriod finder). Without this, everything else delivers diminished value.
2. **Slot 2 — Compliance:** F-001 (daily compliance fields), F-002 (ComplianceSummary tool), F-003 (gap detection in MorningBrief).
3. **Slot 3 — Patterns:** F-004 (PatternDetector domain service), F-005 (playbook in system prompt).
4. **Slot 4 — Calibration:** F-006 (HealthScan entity), F-007 (CalibrationConstants service).
5. **Deferred (later milestones):** F-008 (RMREstimator), F-009 (StrengthSelfTest), F-010–F-013 (goal-aware), F-014–F-016 (maintenance phase).

The deferred features have outline-level task lists at the end of this plan, intentionally less granular until Slots 1–4 land and the surface area stabilizes.

---

## Conventions Used Throughout

- **TDD discipline:** Every step group begins with a failing test, then minimal implementation, then green test, then commit. Never write implementation without a failing test first. (See `superpowers:test-driven-development`.)
- **Test runner:** `npx vitest run <path>` for a single file. `npm run test` for the full suite.
- **Commit style:** `feat(<scope>): <subject>` for additive features, `test(<scope>): <subject>` for tests-only commits when batched separately, `chore(<scope>):` for tooling. Match recent commits (e.g. `feat(wake-and-load): ...`).
- **YAML write rule:** Use the existing DataService-style YAML writers; for new datastores follow `Yaml*Datastore.mjs` patterns under `backend/src/1_adapters/persistence/yaml/`. **Files with dots in their names** (e.g. `nutrition.primary.yml`) need explicit `.yml` suffixes when passed to DataService — see `MEMORY.md` "DataService ensureExtension Bug Pattern".
- **Path traversal safety:** Every new tool that takes a user-supplied path arg MUST normalize and verify the resolved absolute path is inside the whitelist before reading. Add a dedicated test for traversal attempts (`../../etc/passwd`).
- **User-namespaced everywhere:** every persistence call, tool, and entity carries `userId`. Default user comes from `configService.getHeadOfHousehold()` — already wired in `HealthCoachAgent.runAssignment`.
- **No raw `console.log` for diagnostics** (per `CLAUDE.md` Logging section). Use the framework's logger passed into `gather`/`act`/`execute`.
- **No PII in committed test fixtures.** Tests use `'test-user'` as the userId placeholder, NOT the real head-of-household identifier. Real userIds belong in private config under `data/users/{userId}/`, never in test code that lands in git history. (Pre-existing tests with the real userId are an existing problem; do not propagate it.)

---

# Slot 1 — Foundation: Ingestion + Longitudinal Access

## Task 1: Health-archive ingestion config + manifest entity

**Goal:** Define the per-user ingestion config schema and a tiny manifest entity used by every ingested category. This is the smallest stand-alone unit and unblocks all later F-100* tasks.

**Files:**
- Create: `backend/src/2_domains/health/entities/HealthArchiveManifest.mjs`
- Create: `tests/unit/domains/health/HealthArchiveManifest.test.mjs`
- Reference (read-only): `backend/src/2_domains/health/entities/HealthMetric.mjs` (for entity style)

**Step 1: Write the failing test**

```javascript
// tests/unit/domains/health/HealthArchiveManifest.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthArchiveManifest } from '../../../../backend/src/2_domains/health/entities/HealthArchiveManifest.mjs';

describe('HealthArchiveManifest', () => {
  it('constructs with valid fields', () => {
    const m = new HealthArchiveManifest({
      userId: 'test-user',
      category: 'scans',
      lastSync: '2026-05-01T10:00:00Z',
      sourceLocations: [{ path: '/external/scans', fileCount: 4, lastModified: '2026-04-29T08:00:00Z' }],
      schemaVersions: { primary: 'v1' },
      recordCounts: { totalFiles: 4, dateRange: { earliest: '2018-01-01', latest: '2026-04-01' } },
    });
    expect(m.userId).toBe('test-user');
    expect(m.category).toBe('scans');
    expect(m.recordCounts.totalFiles).toBe(4);
  });

  it('rejects unknown category', () => {
    expect(() => new HealthArchiveManifest({ userId: 'test-user', category: 'email' })).toThrow(/category/);
  });

  it('serialize() returns a YAML-shaped plain object', () => {
    const m = new HealthArchiveManifest({ userId: 'test-user', category: 'scans' });
    const out = m.serialize();
    expect(out.manifest_version).toBe(1);
    expect(out.user_id).toBe('test-user');
    expect(out.category).toBe('scans');
  });

  it('staleness returns days since lastSync', () => {
    const m = new HealthArchiveManifest({
      userId: 'test-user',
      category: 'scans',
      lastSync: new Date(Date.now() - 3 * 86400000).toISOString(),
    });
    expect(m.stalenessDays()).toBeGreaterThanOrEqual(2);
    expect(m.stalenessDays()).toBeLessThanOrEqual(4);
  });
});
```

**Step 2: Run test, verify it fails**

```bash
npx vitest run tests/unit/domains/health/HealthArchiveManifest.test.mjs
```
Expected: FAIL with module-not-found.

**Step 3: Implement minimal entity**

```javascript
// backend/src/2_domains/health/entities/HealthArchiveManifest.mjs
const VALID_CATEGORIES = new Set(['nutrition-history', 'scans', 'notes', 'playbook', 'weight', 'workouts']);

export class HealthArchiveManifest {
  constructor({ userId, category, lastSync, sourceLocations = [], schemaVersions = {}, recordCounts = {} }) {
    if (!userId) throw new Error('HealthArchiveManifest requires userId');
    if (!VALID_CATEGORIES.has(category)) throw new Error(`HealthArchiveManifest: invalid category "${category}"`);
    this.userId = userId;
    this.category = category;
    this.lastSync = lastSync || null;
    this.sourceLocations = sourceLocations;
    this.schemaVersions = schemaVersions;
    this.recordCounts = recordCounts;
  }

  serialize() {
    return {
      manifest_version: 1,
      user_id: this.userId,
      category: this.category,
      last_sync: this.lastSync,
      source_locations: this.sourceLocations,
      schema_versions: this.schemaVersions,
      record_counts: this.recordCounts,
    };
  }

  stalenessDays() {
    if (!this.lastSync) return Infinity;
    return Math.floor((Date.now() - new Date(this.lastSync).getTime()) / 86400000);
  }
}

export default HealthArchiveManifest;
```

**Step 4: Run test, verify pass**

```bash
npx vitest run tests/unit/domains/health/HealthArchiveManifest.test.mjs
```
Expected: PASS, 4 tests green.

**Step 5: Commit**

```bash
git add tests/unit/domains/health/HealthArchiveManifest.test.mjs \
        backend/src/2_domains/health/entities/HealthArchiveManifest.mjs
git commit -m "feat(health): add HealthArchiveManifest entity"
```

---

## Task 2: HealthArchiveIngestion service (path-whitelisted, content-hashed)

**Goal:** A pure-domain service that, given a config + filesystem adapter, performs an incremental copy of whitelisted files into `data/users/{userId}/lifelog/archives/` (structured) or `media/archives/` (raw). Hard-fails on excluded paths.

**Files:**
- Create: `backend/src/2_domains/health/services/HealthArchiveIngestion.mjs`
- Create: `tests/unit/domains/health/HealthArchiveIngestion.test.mjs`

**Step 1: Write failing tests**

Test cases (one `it()` block per case):
- `copies new files when destination does not exist`
- `skips files whose mtime + content-hash match existing destination`
- `hard-fails when source path matches exclusion (email|chat|finance|journal|search|calendar|social)`
- `respects whitelist categories — rejects unknown category`
- `dry-run reports planned ops without writing`
- `returns structured report with copied/skipped/failed counts`

Use a mock filesystem object with methods `stat`, `readFile`, `writeFile`, `mkdir`, `readdir` so the service is pure.

**Step 2: Run, verify fail**

```bash
npx vitest run tests/unit/domains/health/HealthArchiveIngestion.test.mjs
```

**Step 3: Implement**

```javascript
// backend/src/2_domains/health/services/HealthArchiveIngestion.mjs
import path from 'node:path';
import crypto from 'node:crypto';

const EXCLUSION_PATTERNS = [/email/i, /chat/i, /finance/i, /journal\b/i, /search-history/i, /calendar/i, /social/i, /\bbanking\b/i];
const VALID_CATEGORIES = new Set(['nutrition-history', 'scans', 'notes', 'playbook', 'weight', 'workouts']);

export class HealthArchiveIngestion {
  constructor({ fs, logger }) {
    if (!fs) throw new Error('HealthArchiveIngestion requires fs adapter');
    this.fs = fs;
    this.logger = logger || console;
  }

  async ingest({ userId, category, sourcePath, destPath, dryRun = false }) {
    if (!VALID_CATEGORIES.has(category)) throw new Error(`Unknown category: ${category}`);
    if (EXCLUSION_PATTERNS.some(p => p.test(sourcePath))) {
      throw new Error(`Source path matches exclusion pattern: ${sourcePath}`);
    }
    const report = { copied: [], skipped: [], failed: [] };
    const files = await this._listFiles(sourcePath);
    for (const file of files) {
      try {
        const action = await this._planFile({ file, sourcePath, destPath });
        if (action === 'skip') { report.skipped.push(file); continue; }
        if (!dryRun) await this._copyFile({ file, sourcePath, destPath });
        report.copied.push(file);
      } catch (err) {
        report.failed.push({ file, error: err.message });
      }
    }
    return report;
  }

  async _listFiles(root) { /* recursive, returns relative paths */ }
  async _planFile({ file, sourcePath, destPath }) { /* mtime + hash compare */ }
  async _copyFile({ file, sourcePath, destPath }) { /* mkdir + write */ }
  _hash(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
}

export default HealthArchiveIngestion;
```

(Implement the three private helpers using the injected `this.fs` adapter.)

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git commit -am "feat(health): add HealthArchiveIngestion service"
```

---

## Task 3: Wire ingestion CLI (`yarn ingest:health-archive`)

**Goal:** `cli/ingest-health-archive.cli.mjs` invokes the service for every category in the user's `data/users/{userId}/config/health-archive.yml`, writes per-category `manifest.yml`, and reports totals.

**Files:**
- Create: `cli/ingest-health-archive.cli.mjs`
- Create: `tests/unit/cli/ingest-health-archive.test.mjs`
- Modify: `package.json` — add `"ingest:health-archive": "node cli/ingest-health-archive.cli.mjs"` to `scripts`

**Step 1: Write failing CLI integration test**

Use Node's real fs against a `tmp/` fixture under `tests/_fixtures/health-archive/` containing tiny mock external files. Assert the CLI exits 0, files land in expected paths, and a `manifest.yml` is written per category.

**Step 2: Run, verify fail**

**Step 3: Implement CLI**

- Parse args (`--user`, `--source`, `--category`, `--dry-run`)
- Load user config (default `data/users/{userId}/config/health-archive.yml`)
- For each enabled category: instantiate `HealthArchiveIngestion`, run, write `manifest.yml`
- Print colored summary table

**Step 4: Run, verify pass**

**Step 5: Commit**

```bash
git commit -am "feat(health): add yarn ingest:health-archive CLI"
```

---

## Task 4: Sample external-archive config + fixture data

**Goal:** Provide `data/users/kckern/config/health-archive.yml` and a small fixture under `tests/_fixtures/health-archive/` so the rest of the plan has data to query against.

**Files:**
- Create: `data/users/kckern/config/health-archive.example.yml` (example only — KC fills in the real one with private paths)
- Create: `tests/_fixtures/health-archive/external/scans/2024-01-15-dexa.yml`
- Create: `tests/_fixtures/health-archive/external/notes/strength-plateau.md`
- Create: `tests/_fixtures/health-archive/external/playbook/playbook.yml`

**Step 1–2: skip TDD here — these are config and fixture files, not logic.**

**Step 3: Write the example config**

```yaml
# data/users/kckern/config/health-archive.example.yml
sources:
  scans:
    path: /Users/kckern/health-archive/scans
    enabled: true
  notes:
    path: /Users/kckern/health-archive/notes
    enabled: true
  playbook:
    path: /Users/kckern/health-archive/playbook
    enabled: true
  nutrition-history:
    path: /Users/kckern/health-archive/nutrition
    enabled: false
sync:
  cadence: manual
```

**Step 4: Verify CLI runs against fixture**

```bash
npx node cli/ingest-health-archive.cli.mjs --user kckern --source tests/_fixtures/health-archive/external --dry-run
```
Expected: prints planned ops, exits 0.

**Step 5: Commit**

```bash
git commit -am "feat(health): add example health-archive config and fixtures"
```

---

## Task 5: PersonalContext loader (F-101)

**Goal:** Load `data/users/{userId}/lifelog/archives/playbook/playbook.yml` and emit a 1.5–3K-token context bundle the agent can splice into its system prompt.

**Files:**
- Create: `backend/src/3_applications/health/PersonalContextLoader.mjs`
- Create: `tests/unit/applications/health/PersonalContextLoader.test.mjs`

**Step 1: Write failing tests**

Cases:
- `loads playbook.yml from per-user path`
- `produces a string with patterns section, calibration constants, named periods`
- `respects token budget — output ≤ 3000 tokens (use rough char-count proxy: ≤ 12000 chars)`
- `returns empty bundle gracefully when playbook missing`
- `path traversal blocked — userId with "../" rejected`

**Step 2: Run, verify fail**

**Step 3: Implement**

The loader takes `{ userId, dataService, tokenBudget }`. Reads YAML, projects into a structured markdown bundle suitable for system-prompt injection.

**Step 4: Run, verify pass**

**Step 5: Commit**

```bash
git commit -am "feat(health): add PersonalContextLoader (F-101)"
```

---

## Task 6: Inject PersonalContext into HealthCoachAgent system prompt

**Goal:** Update `HealthCoachAgent.getSystemPrompt()` to call the loader and append the bundle. Cache per agent boot.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/prompts/system.mjs`
- Create: `tests/isolated/agents/health-coach/SystemPromptPersonalContext.test.mjs`

**Step 1: Failing test**

Asserts the assembled system prompt contains both the existing static text and a `## Personal Context` section sourced from a stubbed `PersonalContextLoader`.

**Step 2: Run, verify fail**

**Step 3: Implement**

Add `personalContextLoader` to `deps`. In `getSystemPrompt()` return `${systemPrompt}\n\n${this.deps.personalContextLoader.load(userId)}`. Note: `BaseAgent` calls `getSystemPrompt()` during execute — this needs a `userId` parameter; if base doesn't pass it, fall back to lazy load on first `runAssignment`.

**Step 4: Wire `personalContextLoader` in `bootstrap.mjs` composition root.**

**Step 5: Run, verify pass**

**Step 6: Commit**

```bash
git commit -am "feat(health-coach): inject PersonalContext into system prompt (F-101)"
```

---

## Task 7: Longitudinal query tools — weight (F-103.1)

**Goal:** Add `query_historical_weight` to a new `LongitudinalToolFactory`. Aggregations: `daily | weekly_avg | monthly_avg | quarterly_avg`. Reads from existing `data/users/{userId}/lifelog/archives/weight.yaml`.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Create: `tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs`
- Reference: `backend/src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs` for tool style

**Step 1: Failing test for `query_historical_weight`**

Cases: daily granularity returns one row per date; weekly_avg returns ≤ 1 row per ISO week with avg weight; respects from/to bounds; returns empty array for empty range.

**Step 2: Verify fail**

**Step 3: Implement just `query_historical_weight`**

**Step 4: Verify pass**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): add query_historical_weight tool (F-103)"
```

---

## Task 8: Longitudinal query tools — nutrition (F-103.2)

**Goal:** Add `query_historical_nutrition` reading `data/users/{userId}/lifelog/archives/nutrition-history/{primary,secondary}/`.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs`

**Step 1: Add failing test cases for `query_historical_nutrition`**

Cover: filter by `protein_min`; filter by `contains_food`; redaction (no `implied_intake` for days < 14d old) — reuse existing reconciliation rule.

**Step 2: Run, verify fail**

**Step 3: Implement**

**Step 4: Verify pass**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): add query_historical_nutrition tool (F-103)"
```

---

## Task 9: Longitudinal query tools — workouts (F-103.3)

**Goal:** Add `query_historical_workouts` reading `data/users/{userId}/lifelog/archives/strava/` and falling back to `media/archives/strava/` for pre-2026 depth.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Modify: tests

**Step 1: Failing tests** (filter by `type`, `name_contains`, date range)

**Step 2–4: implement, verify**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): add query_historical_workouts tool (F-103)"
```

---

## Task 10: `query_named_period` convenience wrapper (F-103.4)

**Goal:** Lookup a named period from the personal-context playbook and call the underlying queries with pre-computed bounds.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Modify: tests

**Step 1: Failing test**

Asserts: given playbook with `named_periods.cut-2024 = { from, to }`, calling `query_named_period({ name: 'cut-2024' })` returns aggregated stats for that range.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): add query_named_period tool (F-103)"
```

---

## Task 11: Path-traversal hardening across longitudinal tools (F-106)

**Goal:** Single shared whitelist module enforced by every longitudinal tool. Hard-coded list per F-106.

**Files:**
- Create: `backend/src/2_domains/health/services/HealthArchiveScope.mjs`
- Create: `tests/unit/domains/health/HealthArchiveScope.test.mjs`
- Modify: `LongitudinalToolFactory.mjs` to call `HealthArchiveScope.assertReadable(path, userId)` before any `readFile`

**Step 1: Failing tests**

Cases:
- `allows whitelisted health-archive paths`
- `blocks paths outside whitelist (../, /etc, absolute outside data root)`
- `blocks attempts to read another user's archive`
- `blocks paths matching exclusion patterns`

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health): enforce HealthArchiveScope whitelist (F-106)"
```

---

## Task 12: NotesReader tool (F-102)

**Goal:** `read_notes_file({ filename, section? })` reads markdown from `notes/` and YAML scans from `scans/`. Section extraction by markdown anchor. Per-conversation cache.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Modify: tests

**Step 1: Failing tests**

Cases: read full file; read by section anchor; reject paths outside whitelist; cache returns same instance for same filename.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): add read_notes_file tool (F-102)"
```

---

## Task 13: SimilarPeriod finder (F-104) — domain service

**Goal:** Pure scoring service that, given a current 30-day signature object and a list of named periods (each with their own aggregated stats), returns ranked similar periods.

**Files:**
- Create: `backend/src/2_domains/health/services/SimilarPeriodFinder.mjs`
- Create: `tests/unit/domains/health/SimilarPeriodFinder.test.mjs`

**Step 1: Failing tests**

Cases:
- `ranks periods by composite score (weight, protein, calorie, tracking-rate dimensions)`
- `respects max_results`
- `returns similarity score 0–1 with explanation per dimension`
- `handles missing dimensions gracefully (partial score)`

Use seeded fixtures so the score values are deterministic.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health): add SimilarPeriodFinder service (F-104)"
```

---

## Task 14: SimilarPeriod tool (F-104) — agent integration

**Goal:** Expose `find_similar_period({ pattern_signature, max_results })` to the agent.

**Files:**
- Modify: `LongitudinalToolFactory.mjs`
- Modify: tests
- Modify: `HealthCoachAgent.mjs` to register the factory if not already

**Step 1: Failing test**

Tool registered with correct schema; calls `SimilarPeriodFinder` with normalized signature; returns array.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): expose find_similar_period tool (F-104)"
```

---

## Task 15: Wire `LongitudinalToolFactory` into `HealthCoachAgent`

**Goal:** Make all the new tools live in production.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (composition root — inject `personalContextLoader`, `similarPeriodFinder`, `dataService` configured for archive paths)

**Step 1: Update the integration test**

`tests/isolated/agents/health-coach/HealthCoachAgent.tools.test.mjs` (create if missing) asserts the agent's tool list contains `query_historical_weight`, `query_historical_nutrition`, `query_historical_workouts`, `query_named_period`, `read_notes_file`, `find_similar_period`.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): wire LongitudinalToolFactory + PersonalContextLoader"
```

---

## Task 16: Update MorningBrief to use `find_similar_period` (F-105.1)

**Goal:** When the gather phase detects a notable pattern signal (e.g., calorie-surplus streak ≥3 days OR protein-shortfall streak ≥3 days), call `find_similar_period` and include the top match in the prompt.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs`
- Modify: `tests/isolated/agents/health-coach/MorningBrief.test.mjs`

**Step 1: Failing test**

When `gather` is given mock tools that simulate a 3-day calorie surplus, the prompt produced by `buildPrompt` contains a `## Similar Period` section.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): MorningBrief grounds patterns in similar periods (F-105)"
```

---

## Task 17: Update WeeklyDigest similarly (F-105.2)

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/assignments/WeeklyDigest.mjs`
- Modify: `tests/isolated/agents/health-coach/WeeklyDigest.test.mjs`

Same shape as Task 16 but at weekly cadence.

**Commit:** `feat(health-coach): WeeklyDigest references named periods (F-105)`

---

# Slot 2 — Compliance Tracking

## Task 18: Coaching field schema in daily health entry (F-001)

**Goal:** Document and validate the `coaching` field shape that the existing daily entry already nominally supports (currently `null`).

**Files:**
- Create: `backend/src/2_domains/health/entities/DailyCoachingEntry.mjs`
- Create: `tests/unit/domains/health/DailyCoachingEntry.test.mjs`

**Step 1: Failing tests**

Cases: parses object with `post_workout_protein`, `daily_strength_micro`, `daily_note`; rejects unknown top-level keys; trims `daily_note`; validates `reps` is a non-negative integer.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health): add DailyCoachingEntry value object (F-001)"
```

---

## Task 19: Persist coaching field via existing health datastore

**Files:**
- Modify: `backend/src/3_applications/health/HealthDashboardUseCase.mjs` (or the appropriate write path; verify by `grep -r "saveHealthData" backend/src` first)
- Add a `setDailyCoaching({ userId, date, coaching })` method on the appropriate use case
- Modify: relevant test

**Step 1: Failing test** that round-trips through the in-memory adapter.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health): persist daily coaching field (F-001)"
```

---

## Task 20: Frontend HealthHub one-tap entry (F-001 UI)

**Goal:** A small panel on HealthHub for tapping `post_workout_protein.taken`, entering `daily_strength_micro.reps`, and recording a one-line note.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CoachingComplianceCard.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CoachingComplianceCard.scss`
- Modify: the HealthHub composition (locate via `grep -r "HealthHub" frontend/src` — likely under `frontend/src/Apps/HealthHub/` or similar)
- Create: `tests/live/flow/health/coaching-compliance-entry.runtime.test.mjs`

**Step 1: Playwright test** — taps the button, expects compliance row to appear in dashboard read API.

**Step 2: Verify fail (server isn't returning the value yet because the write path hits the API).**

**Step 3: Implement**

Includes a backend API route under `backend/src/4_api/v1/routers/health.mjs` for `POST /api/v1/health/{userId}/coaching/{date}` if not already present.

**Step 4: Verify pass with `npm run test:live:flow`**

**Step 5: Commit**

```bash
git commit -am "feat(health-hub): add coaching compliance one-tap entry (F-001)"
```

Make sure to manually open the dev server and confirm the UI works in a browser before declaring done — per `CLAUDE.md` "For UI or frontend changes, start the dev server and use the feature in a browser." Use **logger** (not `console.log`) for the new component.

---

## Task 21: ComplianceSummary tool (F-002)

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/ComplianceToolFactory.mjs`
- Create: `tests/isolated/agents/health-coach/ComplianceToolFactory.test.mjs`

`get_compliance_summary({ userId, days })` returns counts, percentages, current streak, and longest gap for each tracked dimension.

**Step 1: Failing test** with synthetic 30-day data covering varying compliance shapes.

**Step 2–4: TDD cycle**

**Step 5: Commit + register the factory in `HealthCoachAgent.registerTools()`.**

```bash
git commit -am "feat(health-coach): add get_compliance_summary tool (F-002)"
```

---

## Task 22: MorningBrief consumes ComplianceSummary (F-003)

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs`
- Modify: tests

**Logic to add:**
- N consecutive missed `post_workout_protein` days (threshold from playbook config) → CTA referencing the playbook's documented "highest-leverage daily action"
- Multi-day gap on `daily_strength_micro` → CTA referencing the chronic-stagnation pattern

Threshold values come from playbook config, NOT hardcoded.

**Step 1: Failing test** — given mock compliance with 4 consecutive misses on protein, prompt contains a CTA section referencing the playbook value.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): MorningBrief surfaces compliance gaps (F-003)"
```

---

# Slot 3 — Pattern Detection

## Task 23: PatternDetector domain service (F-004)

**Goal:** Pure function. Inputs: 30-day windows of nutrition, weight, workouts, compliance. Outputs: array of `{ name, confidence, evidence, recommendation, memoryKey, severity }`.

**Files:**
- Create: `backend/src/2_domains/health/services/PatternDetector.mjs`
- Create: `tests/unit/domains/health/PatternDetector.test.mjs`

**Pattern set (initial):** `cut-mode`, `if-trap-risk`, `same-jog-rut`, `bike-commute-trap`, `maintenance-drift`, `on-protocol-tracked-cut`, `on-protocol-coached-bulk`. Each has its own threshold values pulled from playbook config (passed in).

**Step 1: Failing tests — one per pattern**

For each pattern, hand-craft a synthetic 30-day window known to trigger it and assert the detector returns it with high confidence; provide a counter-fixture that should not match.

**Step 2: Run, verify all tests fail**

**Step 3: Implement** — add detection methods one at a time so each test goes from red to green incrementally. **Commit after each pattern's test+impl pair lands** so the history reads as one detector at a time.

**Step 5: Final commit**

```bash
git commit -am "feat(health): add PatternDetector with 7 patterns (F-004)"
```

---

## Task 24: PatternDetector → MorningBrief (F-004/F-005 integration)

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs`
- Modify: tests

**Logic:** In `gather`, instantiate `PatternDetector` with the playbook config and 30-day windows pulled via the longitudinal tools. Detected patterns flow into the prompt under `## Detected Patterns` and into working memory with 7-day TTL keys (`pattern_<name>_last_flagged`).

**Step 1: Failing test** — when patterns are detected, the LLM prompt contains the pattern name and recommendation.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): wire PatternDetector into MorningBrief (F-004)"
```

---

## Task 25: System prompt references named patterns (F-005)

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/prompts/system.mjs`
- Modify: `tests/isolated/agents/health-coach/SystemPromptPersonalContext.test.mjs`

Add to the rules section: "When detected patterns are present in the prompt context, reference them by name (e.g. 'this matches the if-trap pattern') rather than restating raw data."

**Step 1: Failing test** asserts the new rule is present.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): system prompt references named patterns (F-005)"
```

---

# Slot 4 — DEXA Calibration

## Task 26: HealthScan entity (F-006)

**Files:**
- Create: `backend/src/2_domains/health/entities/HealthScan.mjs`
- Create: `tests/unit/domains/health/HealthScan.test.mjs`

Schema per PRD F-006. Validates `device_type`, ranges (body fat 0–60, lean ≥ 0), serializes to YAML shape.

**Step 1: Failing tests** for construction, validation, and `serialize()`.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health): add HealthScan entity (F-006)"
```

---

## Task 27: HealthScan datastore (F-006 persistence)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlHealthScanDatastore.mjs`
- Create: `backend/src/3_applications/health/ports/IHealthScanDatastore.mjs`
- Create: `tests/unit/adapters/persistence/YamlHealthScanDatastore.test.mjs`

Reads/writes `data/users/{userId}/lifelog/archives/scans/*.yml`. Heed the **dotted-filename gotcha** from `MEMORY.md` — explicitly append `.yml` rather than relying on `path.extname`.

**Step 1: Failing tests** — round-trip multiple scans; list scans for user; pull latest by date.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health): add YamlHealthScanDatastore (F-006)"
```

---

## Task 28: CalibrationConstants service (F-007)

**Files:**
- Create: `backend/src/2_domains/health/services/CalibrationConstants.mjs`
- Create: `tests/unit/domains/health/CalibrationConstants.test.mjs`

API per PRD F-007: `getCorrectedLean`, `getCorrectedBodyFat`, `getCalibrationDate`, `getStaleness`, `flagIfStale`.

Algorithm: load latest DEXA from `IHealthScanDatastore`, find consumer-BIA readings within ±7 days, compute mean offset on each dimension, store as `{ leanLbsOffset, bodyFatPctOffset }`. If no DEXA on file, `getCalibrationDate()` returns null and corrections become identity transforms (with a `warn` log).

**Step 1: Failing tests** — synthetic DEXA + adjacent BIA fixtures, expected offsets, staleness math, stale-flag boundary.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health): add CalibrationConstants service (F-007)"
```

---

## Task 29: Apply calibration in lean-mass-derived calculations

**Goal:** Find every place existing code derives anything from raw consumer-BIA lean and route through `CalibrationConstants.getCorrectedLean`.

**Files:**
- Run `grep -rn "lbs_lean\|lean_tissue_lbs\|leanLbs" backend/src/2_domains/health backend/src/3_applications/health` and audit each call site.
- Likely candidates: `WeightProcessor.mjs`, anything computing protein targets.
- Modify each + its test.

**Step 1: For each site, write a failing test** that asserts the corrected (post-calibration) value is used.

**Step 2–4: TDD cycle, one site at a time, commit between.**

**Step 5: Final aggregate commit if needed**

```bash
git commit -am "feat(health): apply DEXA calibration to lean-mass-derived calcs (F-007)"
```

---

## Task 30: DEXA staleness CTA in MorningBrief

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs`
- Modify: tests

When `flagIfStale(180)` returns true, add a CTA prompting a re-scan. Suppress for 14 days using working-memory TTL key `dexa_stale_warned`.

**Step 1: Failing test** asserts CTA appears + suppression works.

**Step 2–4: TDD cycle**

**Step 5: Commit**

```bash
git commit -am "feat(health-coach): warn when DEXA calibration is stale"
```

---

# Slot 1–4 Verification Pass

## Task 31: End-to-end live test

**Goal:** Single `live/agent` test runs MorningBrief end-to-end against a populated fixture archive and asserts the assembled output:
- references at least one named pattern
- references at least one similar period
- includes calibrated body composition values
- mentions a compliance dimension if a fixture gap was injected

**Files:**
- Create: `tests/live/agent/personalized-coaching-e2e.test.mjs`

**Step 1: Author the test using the existing live test patterns** — see `tests/live/agent/health-coach-assignment.test.mjs` for the harness.

**Step 2: Run** `npm run test:live` (with the dev server up — check `lsof -i :3112` first per `CLAUDE.md`).

**Step 3: Resolve any genuine integration regressions found.**

**Step 4: Commit**

```bash
git commit -am "test(health-coach): end-to-end personalized coaching live test"
```

---

## Task 32: Documentation refresh

**Files:**
- Update: `docs/reference/core/backend-architecture.md` (mention new domain services + agent tools)
- Update: `docs/ai-context/agents.md` (HealthCoachAgent now has personal context, longitudinal tools, compliance tools, pattern detector)
- Run: `git rev-parse HEAD > docs/docs-last-updated.txt`

**Step 1: Make the edits**

**Step 2: Commit**

```bash
git commit -am "docs: refresh agent + backend reference for personalized coaching"
```

---

# Deferred Phases (Outline-level)

These features are P1 or post-event-only per the PRD timeline. They get fleshed out into bite-sized steps in a follow-up plan once Slots 1–4 are in production. Listed here so the priority ordering is documented.

## F-008: Multi-formula RMR estimator
- New service `RMREstimator.mjs` returning `{ lower, expected, upper, primary_method }`
- Defaults to Katch-McArdle when calibrated lean is available
- Wire into existing tools that consume RMR (find via `grep -r "rmr\|RMR" backend/src`)

## F-009: StrengthTest entity & assignment
- New entity `StrengthTest.mjs`
- New assignment `StrengthSelfTest.mjs` on 8-week cadence
- Records results, compares to baselines + targets
- Frontend dashboard surface

## F-010: Event countdown widget
- `frontend/src/modules/Fitness/widgets/EventCountdown.jsx`
- Reads goal config; phase markers (build / peak / taper / event)

## F-011: Running variance widget
- `frontend/src/modules/Fitness/widgets/RunVarianceWidget.jsx`
- Computes pace stdev across last N runs; red flag at threshold

## F-012: Pre-event scan reminder
- MorningBrief CTA in lead-up to event

## F-013: EventWeekProtocol assignment
- Final-week assignment with tapering, pre-event nutrition, sleep, hydration, day-of plan

## F-014: MaintenanceMode coaching state
- New coaching state activated post-event; different system prompt segment
- Reduced tracking targets; rolling-weight escalation trigger

## F-015: ReboundEarlyWarning detection
- PatternDetector specialization, single high-confidence CTA on trigger

## F-016: AnnualPlaybookReview assignment
- End-of-year scheduled assignment
- Identifies new patterns, writes proposed YAML diffs (additions only)
- Triggers `yarn playbook:render` for markdown regeneration
- Surfaces a review summary the user accepts/rejects

---

# Notes for the Engineer Executing This Plan

1. **Start in a worktree** (`superpowers:using-git-worktrees`). The codebase is large and active; do not run this on `main` directly.
2. **Run unit tests on every commit** (`npx vitest run`). Live tests (`npm run test:live`) need the dev server up — check `lsof -i :3112` first; do not start a second one.
3. **Frequent small commits.** Every TDD cycle (red → green → refactor) is one commit.
4. **Path traversal is non-negotiable.** Tasks 11 and 27 land critical safety code. Don't merge longitudinal tools until they go through `HealthArchiveScope`.
5. **YAML-as-canonical principle.** Anything the agent writes is YAML. Markdown is read-only mirror. See `docs/roadmap/2026-05-01-personalized-pattern-aware-coaching-design.md` § "Format conventions: YAML for agent-writable artifacts".
6. **Composition root edits** belong in `backend/src/0_system/bootstrap.mjs` only. Resist the temptation to construct services inside agents/use cases.
7. **No raw `console.*` for diagnostics** in new code. Use the framework logger (`CLAUDE.md` Logging section).
8. **Open Questions** in the PRD (§ Open Questions for Engineering Review) are NOT blocking for Slots 1–4 — make the recommended choices listed inline in the PRD and document any deviations in the relevant task's commit message.
