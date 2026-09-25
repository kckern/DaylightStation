# Nutrition Auditor Transparency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every nutrition-auditor run visible (why it ran, what it read,
changed, noticed and cost), make every Mastra agent's spend reach the AI usage
ledger, and let the Health app configure the auditor's model, budget, cadence,
triggers and permissions.

**Design:** `docs/_wip/plans/2026-09-25-nutrition-auditor-transparency-design.md`
(read it first).

**Architecture:** Mastra usage is recorded by a composition-built
`usageRecorder` injected into every `MastraAdapter` (adapters may not import
each other, so pricing stays in composition). Auditor policy (settings,
permissions, trigger classification) is pure domain code; `NutritionCleanup`
applies it and appends one row per run to a new JSONL run journal behind a port.
The Health app gets `/health/auditor`, reading four new endpoints.

**Tech stack:** Node ESM backend (DDD layers, `#alias` imports), Vitest,
supertest, React + Mantine, Playwright.

**Work in:** `.worktrees/nutrition-auditor-transparency` (branch
`feat/nutrition-auditor-transparency`). Run tests from the worktree root with
`npx vitest run <paths>`; vitest now runs inside worktrees (commit 41a1f013f).

**Defaults (approved 2026-09-25, "move it off gpt-4o"):** `model:
'gpt-4.1-mini'`, `minGapMinutes: 15`, `dailyCapUsd: 1.00`, every trigger on,
every permission on. All editable on the page.

**Layer rules the pre-commit audit enforces:** `1_adapters` may not import
another adapter folder; `3_applications` may not touch fs, config internals,
global timers or `process`; `4_api` may not import apps/domains/adapters. Keep
new code on the right side of these or the commit is rejected.

---

## Phase A: Agent spend reaches the ledger

### Task 1: Cached-input rates for the 4o / 4.1 families

**Files:**
- Modify: `backend/src/1_adapters/ai/aiPricing.mjs` (the `gpt-4.1*` / `gpt-4o*` entries, ~lines 42-46)
- Test: `backend/src/1_adapters/ai/aiPricing.test.mjs`

The table has no `cachedInput` for these, so cache hits are billed at the full
input rate. The auditor's export showed 1.78M cached gpt-4o tokens.

**Step 1: failing test** (append to the existing describe):

```js
it('bills cached prompt tokens at the published cached rate for gpt-4o and gpt-4.1', () => {
  expect(estimateCostUsd('gpt-4o-2024-08-06', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBe(1.25);
  expect(estimateCostUsd('gpt-4.1-2025-04-14', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBe(0.5);
  expect(estimateCostUsd('gpt-4.1-mini', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBe(0.1);
  expect(estimateCostUsd('gpt-4o-mini', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBe(0.075);
});
```

**Step 2:** `npx vitest run backend/src/1_adapters/ai/aiPricing.test.mjs` → FAIL (2.5 ≠ 1.25).

**Step 3:** set the entries:

```js
'gpt-4.1': { input: 2.00, cachedInput: 0.50, output: 8.00 },
'gpt-4.1-mini': { input: 0.40, cachedInput: 0.10, output: 1.60 },
'gpt-4.1-nano': { input: 0.10, cachedInput: 0.025, output: 0.40 },
'gpt-4o': { input: 2.50, cachedInput: 1.25, output: 10.00 },
'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.60 },
```

**Step 4:** rerun → PASS.

**Step 5:** `git commit -m "fix(ai): cached-input rates for gpt-4o and gpt-4.1 families"`

### Task 2: Composition-side agent usage recorder

**Files:**
- Create: `backend/src/5_composition/agentUsageRecorder.mjs`
- Test: `backend/src/5_composition/agentUsageRecorder.test.mjs`

**Step 1: failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { createAgentUsageRecorder } from './agentUsageRecorder.mjs';

describe('agent usage recorder', () => {
  it('prices Mastra usage and writes one ledger row per agent turn', () => {
    const ledger = { record: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const record = createAgentUsageRecorder({ ledger, logger });
    const entry = record({ agentId: 'nutrition-auditor', runId: 'audit_1', turnId: 't1',
      model: { provider: 'openai', name: 'gpt-4o' }, durationMs: 900, status: 'ok',
      usage: { inputTokens: 40_000, cachedInputTokens: 10_000, outputTokens: 500, reasoningTokens: 0 } });
    expect(entry.costUsd).toBeCloseTo((30_000 * 2.5 + 10_000 * 1.25 + 500 * 10) / 1e6, 9);
    expect(ledger.record).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai', endpoint: 'agent', model: 'gpt-4o', agentId: 'nutrition-auditor', runId: 'audit_1',
      promptTokens: 40_000, cachedTokens: 10_000, completionTokens: 500, totalTokens: 40_500, status: 'ok' }));
    expect(logger.info).toHaveBeenCalledWith('agent.usage', expect.objectContaining({ agentId: 'nutrition-auditor' }));
  });

  it('records a failed turn with no usage at zero cost and never throws', () => {
    const ledger = { record: vi.fn(() => { throw new Error('disk'); }) };
    const record = createAgentUsageRecorder({ ledger, logger: { info() {}, warn: vi.fn() } });
    expect(() => record({ agentId: 'a', model: { provider: 'openai', name: 'gpt-4o' }, status: 'error', error: 'boom' })).not.toThrow();
  });
});
```

**Step 2:** run → FAIL (module missing).

**Step 3: implementation**

```js
/**
 * Agent usage recorder — prices one Mastra agent turn and appends it to the AI
 * usage ledger. Built here, not in the adapter, because 1_adapters/agents may
 * not import 1_adapters/ai (pricing). Every MastraAdapter receives it as
 * `usageRecorder`; without it agent spend never reached the ledger (2026-09-25:
 * ~$21 of gpt-4o in 13 days, zero ledger rows).
 */
import { estimateCostUsd } from '#adapters/ai/aiPricing.mjs';

export function createAgentUsageRecorder({ ledger = null, logger = console, pricing = null } = {}) {
  return function recordAgentUsage({ agentId, runId = null, turnId = null, model, usage = null, durationMs = null, status = 'ok', error = null }) {
    try {
      const promptTokens = usage?.inputTokens ?? null;
      const completionTokens = usage?.outputTokens ?? null;
      const cachedTokens = usage?.cachedInputTokens ?? null;
      const costUsd = usage ? estimateCostUsd(model?.name, { promptTokens, completionTokens, cachedTokens }, pricing) : 0;
      const entry = {
        provider: model?.provider || 'unknown', endpoint: 'agent', model: model?.name || null, requestedModel: model?.name || null,
        agentId, runId, turnId, promptTokens, completionTokens,
        totalTokens: usage ? (promptTokens || 0) + (completionTokens || 0) : null,
        ...(cachedTokens != null ? { cachedTokens } : {}),
        ...(usage?.reasoningTokens ? { reasoningTokens: usage.reasoningTokens } : {}),
        costUsd, durationMs, status, ...(error ? { error } : {}),
      };
      logger.info?.('agent.usage', entry);
      ledger?.record(entry);
      return entry;
    } catch (recordError) {
      logger.warn?.('agent.usage.record-failed', { agentId, error: recordError.message });
      return null;
    }
  };
}
```

**Step 4:** run → PASS. **Step 5:** commit `feat(agents): composition-side agent usage recorder`.

### Task 3: MastraAdapter records usage and accepts a per-call model

**Files:**
- Modify: `backend/src/1_adapters/agents/MastraAdapter.mjs` (constructor ~line 50; `execute` ~168-275; `stream` finish ~405-415)
- Test: `tests/isolated/adapters/agents/MastraAdapter.usage.test.mjs` (new; copy the `adapter()` helper and `AgentExecutionPolicy` import from `MastraAdapter.modern.test.mjs:1-20`)

**Step 1: failing test**

```js
class FakeAgent {
  constructor(opts) { FakeAgent.last = opts; }
  async generate() { return { text: 'ok', finishReason: 'stop', totalUsage: { inputTokens: 1000, outputTokens: 20, cachedInputTokens: 100 } }; }
}
it('records usage for every execute and returns it with cost', async () => {
  const usageRecorder = vi.fn(() => ({ costUsd: 0.0025 }));
  const runtime = adapter({ agentClass: FakeAgent, usageRecorder, model: 'openai/gpt-4o' });
  const result = await runtime.execute({ agentId: 'nutrition-auditor', input: 'x', tools: [], context: { userId: 'u', runId: 'audit_1' } });
  expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'nutrition-auditor', runId: 'audit_1',
    model: { provider: 'openai', name: 'gpt-4o' }, status: 'ok', usage: expect.objectContaining({ inputTokens: 1000 }) }));
  expect(result).toMatchObject({ costUsd: 0.0025, model: { provider: 'openai', name: 'gpt-4o' } });
});
it('uses a per-call model override', async () => {
  const runtime = adapter({ agentClass: FakeAgent, usageRecorder: vi.fn(() => null), model: 'openai/gpt-4o' });
  await runtime.execute({ agentId: 'a', input: 'x', tools: [], model: 'openai/gpt-4.1-mini' });
  expect(FakeAgent.last.model).toBe('openai/gpt-4.1-mini');
});
it('records a failed turn', async () => {
  class Boom { async generate() { throw new Error('boom'); } }
  const usageRecorder = vi.fn();
  await expect(adapter({ agentClass: Boom, usageRecorder }).execute({ agentId: 'a', input: 'x', tools: [] })).rejects.toThrow('boom');
  expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: 'boom' }));
});
```

**Step 2:** run `npx vitest run tests/isolated/adapters/agents/MastraAdapter.usage.test.mjs` → FAIL.

**Step 3:** in `MastraAdapter`:
- add `#usageRecorder` = `deps.usageRecorder || null`.
- in `execute`, destructure `model: modelOverride` from `options`; `const model = modelOverride || this.#model;` and use `model` for both `agentOpts.model` and `parseModelDescriptor(model)` in the transcript.
- after the response succeeds:

```js
const usage = response.totalUsage ?? response.usage ?? null;
const recorded = this.#usageRecorder?.({ agentId: name, runId: context.runId ?? null, turnId,
  model: parseModelDescriptor(model), usage, durationMs: Date.now() - startedAt, status: 'ok' }) || null;
```

  add `model: parseModelDescriptor(model), costUsd: recorded?.costUsd ?? null` to `result`, and `usage` / `costUsd` to the `agent.execute.complete` log.
- in the `catch`, call `this.#usageRecorder?.({ agentId: name, runId: context.runId ?? null, turnId, model: parseModelDescriptor(model), usage: null, durationMs: Date.now() - startedAt, status: 'error', error: error?.message })`.
- in `stream`, apply the same model override and record once after the loop with the captured `usage`.

**Step 4:** run the new test plus `tests/isolated/adapters/agents/` → all PASS.
**Step 5:** commit `feat(agents): MastraAdapter records every turn's usage; per-call model`.

### Task 4: Wire the recorder into every MastraAdapter, with a guard

**Files:**
- Modify: `backend/src/app.mjs` (after `createAiUsageLedger`, ~line 664): `const agentUsageRecorder = createAgentUsageRecorder({ ledger: aiUsageLedger, logger: rootLogger.child({ module: 'agent-usage' }) });` and pass `agentUsageRecorder` in the config objects of `createAgentsServices` (~5996), `createConciergeServices`, `createNewsReporterServices`, `createCardLadderTuning` (~3306), `createNutritionCleanup` (~6030).
- Modify: `backend/src/5_composition/bootstrap.mjs` lines ~2648, ~2857, ~3187, ~3354: add `usageRecorder: config.agentUsageRecorder` (read it from each function's `config`).
- Modify: `backend/src/5_composition/modules/cardLadderTuning.mjs` (`defaultRuntime` gains `usageRecorder`), `backend/src/5_composition/modules/nutritionCleanup.mjs:32`.
- Test: `backend/src/5_composition/agentUsageRecorder.wiring.test.mjs`

**Step 1: failing guard test**

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname);
const files = fs.readdirSync(root, { recursive: true }).filter(f => f.endsWith('.mjs') && !f.includes('.test.'));

describe('every MastraAdapter is built with a usage recorder', () => {
  it('passes usageRecorder at each construction site', () => {
    const missing = [];
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      for (const match of text.matchAll(/new MastraAdapter\(\{/g)) {
        const body = text.slice(match.index, text.indexOf('});', match.index) + 3);
        if (!body.includes('usageRecorder')) missing.push(`${file}:${text.slice(0, match.index).split('\n').length}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
```

**Step 2:** run → FAIL listing 6 sites. **Step 3:** wire them. **Step 4:** run → PASS; also run `npm run test:composition-contracts`.
**Step 5:** commit `feat(agents): every Mastra runtime writes the AI usage ledger`.

### Task 5: Tests for the openai-usage CLI helpers

**Files:** Test `cli/openai-usage.cli.test.mjs`.

Cover `groupRows`, `readLedger` (write two JSONL files into a tmp dir, one bad line, check the date window and `writer`), and `reconcileByDay` (billed $2 and ledger $0.5 on one day → `gapUsd` 1.5). Also `node cli/openai-usage.cli.mjs ledger --since 2026-09-01 --by agentId` must run (prints `-` for pre-change rows). Commit `test(cli): openai-usage helpers`.

---

## Phase B: Auditor policy

### Task 6: Auditor settings, permissions, triggers (domain)

**Files:**
- Create: `backend/src/2_domains/nutrition/services/auditorPolicy.mjs`
- Test: `backend/src/2_domains/nutrition/services/auditorPolicy.test.mjs`

Exports:

```js
export const AUDITOR_MODELS = ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5.6-luna'];
export const TRIGGER_KINDS = ['captures', 'reviews', 'stabilization', 'scaleReconcile', 'artwork', 'dayRollover', 'edits', 'dailySweep'];
export const PERMISSION_KINDS = ['naming', 'identification', 'mealPlacement', 'grouping', 'artwork', 'portion', 'nutrients', 'estimates', 'completeCaptures', 'questions'];
export const DEFAULT_AUDITOR_SETTINGS = Object.freeze({ enabled: false, dryRun: true, telegram: false,
  model: 'gpt-4.1-mini', dailyCapUsd: 1, minGapMinutes: 15,
  triggers: Object.fromEntries(TRIGGER_KINDS.map(k => [k, true])),
  permissions: Object.fromEntries(PERMISSION_KINDS.map(k => [k, true])) });

const FIELD_KIND = { name: 'naming', label: 'naming', foodId: 'identification', date: 'mealPlacement', mealTime: 'mealPlacement',
  parentId: 'grouping', kind: 'grouping', icon: 'artwork', photoRef: 'artwork', amount: 'portion', unit: 'portion', grams: 'portion' };
// every other numeric field (calories, protein, …) is 'nutrients'

export function effectiveSettings(stored = {}) { /* deep-merge stored over DEFAULT_AUDITOR_SETTINGS; drop unknown keys */ }
export function validateSettingsChange(changes) { /* throws Error{status:400} on unknown key or wrong type:
  booleans for enabled/dryRun/telegram; model ∈ AUDITOR_MODELS; dailyCapUsd number 0..50 or null (no cap);
  minGapMinutes ∈ [0,15,30,60]; triggers/permissions: partial objects of known keys → booleans */ }
export function permissionKindsOf(proposal) { /* Set: 'completeCaptures' for mode complete; 'estimates' for mode estimate;
  'grouping' when createGroups non-empty; FIELD_KIND or 'nutrients' for each changed field */ }
export function blockedKinds(proposal, permissions) { return [...permissionKindsOf(proposal)].filter(k => permissions[k] === false); }
export function describeDisabled(permissions) { /* one prompt line naming disabled kinds, or '' */ }
```

Tests: defaults merge (stored `{enabled:true}` keeps defaults for the rest);
validation rejects `{model:'gpt-9'}`, `{minGapMinutes:7}`,
`{permissions:{fly:true}}`; `permissionKindsOf` for an icon-only update →
`{artwork}`, calories change → `{nutrients}`, `mode:'complete'` →
`{completeCaptures}`, createGroups → `{grouping}`; `blockedKinds` with
`nutrients:false`. TDD each, then commit `feat(nutrition): auditor settings and permission policy`.

### Task 7: Trigger classification and own-change detection (domain)

**Files:**
- Create: `backend/src/2_domains/nutrition/services/auditTrigger.mjs`
- Test: `backend/src/2_domains/nutrition/services/auditTrigger.test.mjs`

```js
/** Compact per-class view of an audit snapshot; `hash` is injected (domains do no crypto). */
export function snapshotDigest(snapshot, hash) {
  const rows = {};
  for (const row of [...snapshot.rows, ...snapshot.pending.flatMap(log => log.items)]) {
    const key = row.uuid || row.id;
    const { icon, photoRef, ...rest } = row;
    rows[key] = { body: hash(JSON.stringify(rest)), art: hash(JSON.stringify([icon, photoRef])),
      settled: row.settled ?? null, settledBy: row.settledBy ?? null, review: row.review?.status ?? null };
  }
  return { dates: snapshot.dates.join(','), rows, observations: hash(JSON.stringify(snapshot.observations || [])) };
}

/** Which kinds of change separate two digests. Empty set = nothing changed. */
export function classifyChange(prev, next) {
  const kinds = new Set();
  if (!prev) return new Set(['dailySweep']);
  if (prev.dates !== next.dates) kinds.add('dayRollover');
  if (prev.observations !== next.observations) kinds.add('scaleReconcile');
  for (const [key, row] of Object.entries(next.rows)) {
    const before = prev.rows[key];
    if (!before) { kinds.add('captures'); continue; }
    if (before.settled !== row.settled || before.review !== row.review) kinds.add(row.settledBy === 'user' ? 'reviews' : 'stabilization');
    else if (before.body !== row.body) kinds.add('edits');
    else if (before.art !== row.art) kinds.add('artwork');
  }
  return kinds;
}

/** True when every row difference is one of `ownIds` and nothing else moved. */
export function onlyOwnChanges(prev, next, ownIds) {
  if (!prev || prev.dates !== next.dates || prev.observations !== next.observations) return false;
  const keys = new Set([...Object.keys(prev.rows), ...Object.keys(next.rows)]);
  for (const key of keys) {
    const a = prev.rows[key]; const b = next.rows[key];
    if (JSON.stringify(a) !== JSON.stringify(b) && !ownIds.has(key)) return false;
  }
  return true;
}
```

Tests: new row → `captures`; observations change → `scaleReconcile`;
user-settled → `reviews`; auto-settled → `stabilization`; icon-only →
`artwork`; `onlyOwnChanges` true when the only diff is an own id and false when
another row or the observations changed. Note: a row that leaves the 72 h
window drops out of `next.rows`; `onlyOwnChanges` treats that as a foreign
change, which keeps today's safe behaviour. Commit `feat(nutrition): audit trigger classification`.

### Task 8: Run journal port and JSONL store

**Files:**
- Create: `backend/src/3_applications/nutrition/ports/IAuditJournalStore.mjs` (+ export in `ports/index.mjs`)
- Create: `backend/src/1_adapters/persistence/yaml/JsonlAuditJournalStore.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/JsonlAuditJournalStore.test.mjs`

Port (same style as `IArtworkQueueStore`):

```js
/** Append-only per-user journal of auditor runs and skips (design 2026-09-25). */
export class IAuditJournalStore {
  async append(_userId, _row) { throw new Error('IAuditJournalStore.append not implemented'); }
  /** Rows with `at` in [from, to), newest first. Dates are ISO strings. */
  async list(_userId, _range) { throw new Error('IAuditJournalStore.list not implemented'); }
}
```

Adapter: files at `dataService.user.resolveDir('lifelog/nutrition/auditor-journal', userId)` + `/YYYY-MM.<source>.jsonl`
(per-writer suffix, same reason as `AiUsageLedger`). `append` serializes through
a promise tail and uses `appendTextFile`; `list` reads every month file that
overlaps the range (use `listFiles` + `readTextFromPathAsync` from
`#system/utils/FileIO.mjs`), skips bad lines, filters, sorts desc. A row whose
`runId` repeats keeps the newest line (a completed row supersedes its started row).

Tests: append two rows across a month boundary, list a range, bad line
skipped, owner id validated like `YamlArtworkQueueStore.path`. Commit
`feat(nutrition): auditor run journal store`.

### Task 9: Settings, change log, permissions and model in NutritionCleanup

**Files:**
- Modify: `backend/src/3_applications/nutrition/NutritionCleanup.mjs` (`status`, `settings`, `#execute`, constructor)
- Modify: `backend/src/3_applications/agents/nutrition-auditor/NutritionAuditor.mjs` (`audit`)
- Modify: `backend/src/1_adapters/persistence/yaml/YamlAgentStateStore.mjs:18` (default state gets `settingsLog: []`)
- Test: `backend/src/3_applications/nutrition/NutritionCleanup.test.mjs`

Behaviour:
- `status()` returns `settings: effectiveSettings(state.settings)`.
- `settings(userId, { expectedVersion, ...changes })` calls `validateSettingsChange`, merges nested `triggers`/`permissions`, and appends `{ at, actor: 'user', field, from, to }` for each changed leaf to `state.settingsLog` (keep the newest 500). Add `settingsLog(userId)` returning it newest first.
- `request()` puts `{ snapshot, model, permissions }` in `runs.start` input.
- `NutritionAuditor.audit(input, …)` passes `model: 'openai/' + input.model` (when set) to `runtime.execute`, appends `describeDisabled(input.permissions)` to the system prompt, and returns `usage`, `costUsd`, `model`, `turnId`, and `toolCalls: digestToolCalls(result.toolCalls)` beside the normalized result. `digestToolCalls` keeps `{ name, args: JSON.stringify(args).slice(0, 200) }` per call, reading `toolName ?? name ?? payload?.toolName` defensively.
- `#execute`: before `repairs.apply`, `const blocked = blockedKinds(proposal, permissions)`; if non-empty push `{ status: 'blocked', kinds: blocked, proposal }`, log `nutrition.cleanup.blocked`, skip apply. When `permissions.questions === false`, do not `interactions.ask`; record the questions on the run as `suppressedQuestions`.

Tests (TDD, one `it` each): settings validation 400; change log records
`model gpt-4.1-mini → gpt-4o`; a calories proposal with `nutrients:false` is
`blocked` and the row is unchanged; `runs.start` receives the chosen model.
Commit `feat(nutrition): auditor model, permissions and settings history`.

### Task 10: Journal rows, gates, and the self-trigger fix

**Files:**
- Modify: `backend/src/3_applications/nutrition/NutritionCleanup.mjs` (`tick`, `request`, `#execute`, `#launch` catch)
- Modify: `backend/src/5_composition/modules/nutritionCleanup.mjs` (inject `journal: new JsonlAuditJournalStore({ dataService, source })`, `hash: sha256Text`)
- Test: `backend/src/3_applications/nutrition/NutritionCleanup.test.mjs`

Behaviour:
1. **Trigger:** `tick` computes `digest = snapshotDigest(snapshot, hash)` and `kinds = classifyChange(state.checkedDigest, digest)`. Startup and 03:00 runs use `['dailySweep']`; manual uses `['manual']`. `request(userId, { trigger })` stores `trigger` on the run.
2. **Filter:** when every kind is disabled in `settings.triggers`, set `checkedFingerprint`/`checkedDigest` to the current values and journal `{ skipped: 'filtered', kinds }` once per fingerprint.
3. **Gap:** automatic runs wait until `now - state.lastAutoRunAt >= minGapMinutes * 60000`; the dirty entry stays, so pending changes run together when the gap opens. Journal nothing for gap waits (they are frequent); the header shows "next eligible".
4. **Cap:** before an automatic run, sum `costUsd` of today's journal rows (household timezone via `timezoneFor`); at or over `dailyCapUsd`, journal `{ skipped: 'cap' }` once per day and return. Manual runs ignore the cap and carry `overCap: true`.
5. **Journal:** append a row on completion `{ runId, at: startedAt, completedAt, trigger, model, usage, costUsd, turnId, toolCalls, outcomes, questions, suppressedQuestions, summary, dryRun, manual }` and on failure `{ runId, at, status: 'failed', error, attempt }`. Wrap in try/catch → `logger.warn('nutrition.cleanup.journal_failed')`.
6. **Self-trigger fix:** after a completed run take `post = await this.auditor.snapshot(userId)` (call `refreshReferences()` first); collect `ownIds` from each applied outcome's `affectedIds`; if `onlyOwnChanges(preDigest, postDigest, ownIds)` store the post fingerprint/digest, else the pre ones (today's behaviour).

Tests:
- rewrite `deduplicates simultaneous requests … concurrent capture` (line ~275) into two cases: own repair only → `checkedFingerprint === post.fingerprint` and the next `tick` does not start a run; a capture added while `runs.start` is pending → `checkedFingerprint === pre.fingerprint`.
- gap: two changes 5 min apart with `minGapMinutes: 15` → one run at 15 min.
- cap: journal already holds $1.20 today → automatic run skipped, `skipped: 'cap'` row once; manual still runs.
- filter: observations-only change with `scaleReconcile:false` → no run, one `filtered` row.
- keep `reconciles at startup … debounces` (line ~226) passing; set `minGapMinutes: 0` in its settings if it needs to.

Commit `feat(nutrition): auditor journal, spend/cadence/trigger gates, no self-triggered re-audits`.

### Task 11: Backfill CLI from transcripts

**Files:**
- Create: `cli/nutrition-auditor-backfill.cli.mjs`
- Test: `cli/nutrition-auditor-backfill.cli.test.mjs`

Reads `<mediaDir>/logs/agents/nutrition-auditor/<day>/<user>/*.json`
(transcript shape: `input.context.runId`, `startedAt`, `completedAt`,
`model.name`, `output.usage`, `toolCalls[]`, `output.text` = JSON with
`summary`, `repairs`, `questions`). Writes journal rows
`{ runId, at, completedAt, trigger: ['unknown'], backfilled: true, model, usage, costUsd, turnId, toolCalls, proposals, questions, summary }`
through `JsonlAuditJournalStore`, pricing with `estimateCostUsd`. Skips runIds
already in the journal. Flags: `--since`, `--user`, `--dry-run`, `--media-dir`.
Test with two fixture transcripts in a tmp dir (one duplicate run). Commit
`feat(cli): backfill auditor journal from agent transcripts`.

---

## Phase C: API

### Task 12: Journal, spend and settings-log endpoints

**Files:**
- Modify: `backend/src/3_applications/nutrition/NutritionCleanup.mjs` (add `journal`, `journalEntry`, `spend`)
- Modify: `backend/src/1_adapters/agents/AgentTranscriptFileStore.mjs` (add `find({ agentId, userId, startedAt, turnId })` → parsed transcript or null)
- Modify: `backend/src/5_composition/modules/nutritionCleanup.mjs` (inject `transcripts: { find }`)
- Modify: `backend/src/4_api/v1/routers/health.mjs` (after line ~211)
- Test: `backend/src/4_api/v1/routers/health.auditorJournal.test.mjs` (pattern: `health.artworkQueue.test.mjs`, `cleanupProvider: () => service`)

Routes (owner from `getDefaultUsername(req)`, never the payload):

```
GET /nutrition/cleanup/journal?from=YYYY-MM-DD&to=YYYY-MM-DD&trigger=<kind>&changed=1&offset=0
    → { rows, total }            400 on bad dates/offset; default range = last 7 days; page size 50
GET /nutrition/cleanup/journal/:runId
    → row + { transcript: { toolCalls, systemPromptChars, input: { rows, pending } } | null, transcriptExpired: bool }
GET /nutrition/cleanup/spend?days=30
    → { days: [{ date, costUsd, runs, changed }], today, week, month, byTrigger: [{ trigger, runs, costUsd, avgUsd }], byModel: [{ model, runs, avgUsd }] }
GET /nutrition/cleanup/settings/log → { entries }
```

`journal` rows are counted as "changed" when any outcome is `applied` or
`proposed`. Router tests: owner forced, 400 validation, 404 unknown runId,
spend shape. Commit `feat(health): auditor journal and spend API`.

---

## Phase D: Health app

Frontend rules: Mantine + `lib/ui` primitives (`SectionCard`, `Sheet`,
`LoadingState`, `ErrorState`), design tokens only (the UI audit counts raw
colors), `useApiResource` for reads, `DaylightAPI` for writes, and a
`getLogger().child({ component: 'health-auditor' })` logger for mount,
filter changes and each settings mutation (success/failure). Tests mirror
`frontend/src/modules/Health/cleanup/CleanupQuestions.test.jsx`.

### Task 13: Route, link and shared diff component

**Files:**
- Create: `frontend/src/modules/Health/auditor/AuditorPage.jsx` (skeleton: header + sections)
- Create: `frontend/src/modules/Health/cleanup/RepairChanges.jsx` (move `Changes` out of `HealthSettings.jsx`, export it)
- Modify: `frontend/src/Apps/HealthApp.jsx` (lazy import; `<Route path="auditor" …>`; `tabForPath`: `/health/auditor` → `'settings'`)
- Modify: `frontend/src/modules/Health/cleanup/HealthSettings.jsx` (the "Nutrition cleanup" card gets a status line "Last run … · $X today" and an "Open auditor" button → `/health/auditor`; the run-history and repair-history cards move to the auditor page)

Test: route renders `AuditorPage`; Settings link navigates. Commit.

### Task 14: Header and run timeline

**Files:** Create `auditor/AuditorHeader.jsx`, `auditor/RunTimeline.jsx`, tests.

- Header reads `cleanup` status + `spend`: state (On / Preview only / Off), model, last run, next eligible (last auto run + gap), today / 7 d / month vs cap with an "over cap" badge.
- Timeline reads `journal`; filters: Changed only, trigger select, min cost. Row: time, trigger chips, duration, model, `$0.0123`, counts (changed · proposed · rejected · blocked · asked); skip rows render muted ("Skipped: over daily cap"). Load more via `offset`.

Tests: renders counts from a fixture row; filter toggles re-query with `changed=1`; skip row text. Commit.

### Task 15: Run detail sheet

**Files:** Create `auditor/RunDetail.jsx`, test.

Sections in order: **Why it ran** (trigger kinds in words: "New food captured", "You reviewed food", "Scale readings updated", …), **What it looked at** (rows in scope count; tool calls list, args collapsed; "Transcript expired" when null), **What it noticed** (summary; questions it asked or suppressed), **What it changed** (applied outcomes → `RepairChanges` + Undo via existing `undo/:id`; proposed in preview), **Rejected / blocked** (reason, blocked kinds, full proposal via `RepairPreview`), **Cost** (input / cached / output tokens, $). Test with a fixture journal entry covering each outcome type. Commit.

### Task 16: Spend panel

**Files:** Create `auditor/SpendPanel.jsx`, test.

Load the `dataviz` skill before building it. 30-day daily cost bars (inline
SVG, token colors), cap as a reference line, and a table of cost per run by
trigger and by model. Test: bar count, cap line present when a cap is set. Commit.

### Task 17: Configuration and change log

**Files:** Create `auditor/AuditorConfig.jsx`, `auditor/SettingsLog.jsx`, tests.

- Existing switches (enabled, dryRun, telegram) and Run now move here.
- Model `Select` with "≈ $0.0xx / run" from `spend.byModel` (or "no runs yet").
- Daily cap `NumberInput` ($, blank = no cap), gap `SegmentedControl` (Off/15/30/60), trigger `Checkbox` group, permission `Switch` list with one-line descriptions.
- Each change → `PATCH settings` with `expectedVersion`; on 409 show "Settings changed. Reload first." and reload.
- Change log: newest first, "`model`: gpt-4.1-mini → gpt-4o · Sep 25 10:42".

Tests: toggling a permission sends `{ expectedVersion, permissions: { nutrients: false } }`; 409 message; log renders. Commit.

### Task 18: Playwright flow

**File:** `tests/live/flow/health/health-auditor.runtime.test.mjs` (pattern: `health-context.runtime.test.mjs`).

Load `/health/auditor`; assert header, at least one timeline row (prod data is
backfilled; locally, fail if none — no skipping); open a row and see "Why it
ran"; toggle one permission, see it in the change log, toggle it back.
Never start a second backend (CLAUDE.local.md). Commit.

---

## Phase E: Docs, merge, deploy, verify

### Task 19: Docs

- Create `docs/reference/health/nutrition-auditor.md`: what triggers a run, gates, permissions, journal location and shape, cost path (Mastra → recorder → ledger), backfill CLI, `openai-usage` CLI.
- Add a row to the CLAUDE.md navigation table and link from `docs/reference/health/README.md`.
- Commit `docs(health): nutrition auditor reference`.

### Task 20: Merge, deploy, backfill, verify

1. Full relevant suites green: `npx vitest run backend/src/1_adapters/ai backend/src/5_composition backend/src/2_domains/nutrition backend/src/3_applications/nutrition backend/src/3_applications/agents/nutrition-auditor backend/src/4_api/v1/routers tests/isolated/adapters/agents frontend/src/modules/Health cli/openai-usage.cli.test.mjs cli/nutrition-auditor-backfill.cli.test.mjs`.
2. Sync with homeserver first (CLAUDE.local.md), merge to `main`, deploy per `reference_homeserver_deploy_procedure` memory.
3. `docker exec daylight-station node cli/nutrition-auditor-backfill.cli.mjs --since 2026-09-06 --dry-run`, then without `--dry-run`.
4. Verify: within an hour `node cli/openai-usage.cli.mjs ledger --since <today> --by agentId,model` shows `nutrition-auditor` rows on gpt-4.1-mini; `/health/auditor` shows new runs with a trigger; the log store has `agent.usage` events.
5. After 24 h compare the OpenAI usage export for that day against `ledger --by model` for the same day (gpt-4o should be ~0; totals should agree within a few percent). Record the result in the reference doc.
