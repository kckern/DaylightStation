# NewsReporter Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Build a config-driven framework for scheduled, LLM-generated reports that gather from pluggable sources, consolidate via an agent, and render to pluggable sinks (thermal printer first), with an ad-hoc CLI/endpoint to trigger or override runs.

**Architecture:** A `3_applications/newsreporter` bounded context orchestrates `gather (N sources) → consolidate (LLM) → render+emit (M sinks)`. Source/sink implementations are `1_adapters`; receipt layout is `1_rendering`; ports live in `3_app`. Reporters surface to the existing scheduler via a composite job datastore + executor. Full design: `docs/_wip/plans/2026-06-21-newsreporter-framework-design.md`.

**Tech Stack:** Node ESM (`.mjs`), Jest unit tests (`@jest/globals`, `node tests/unit/harness.mjs --pattern=NewsReporter`), `zod`, existing `IAgentRuntime`/`MastraAdapter`, `ThermalPrinterRegistry`, `createLogger` from `#system/logging`, `SchedulerOrchestrator`.

**Conventions (read before starting):**
- DDD layering rules: `docs/reference/core/layers-of-abstraction/ddd-reference.md`. Dependencies point inward. `1_adapters` MUST NOT import `1_rendering`.
- Logging: structured events via injected logger (`logger.info?.('newsreporter.x', {...})`), never raw console in new code.
- Import aliases: `#apps/...` (3_applications), `#adapters/...`, `#domains/...`, `#system/...`, `#rendering/...` (verify alias in `package.json` `imports`; if `#rendering` is absent, use a relative import and note it).
- TDD: write the failing test, see it fail, implement minimal, see it pass, commit. One logical unit per commit.
- Commit message footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 0: Branch + scaffolding

**Step 1:** Confirm working tree clean (`git status`). Work proceeds on `main` (user directive: push to main), committing per task.

**Step 2:** Verify the `#rendering` import alias exists:
Run: `node -e "console.log(require('./package.json').imports)"`
If no `#rendering/*`, use relative paths from `1_rendering` files and flag it in the final summary.

**Step 3:** Create directories:
```bash
mkdir -p backend/src/3_applications/newsreporter/{ports,sinks} \
  backend/src/1_rendering/newsreporter \
  backend/src/1_adapters/newsreporter/sources \
  tests/unit/applications/newsreporter \
  tests/unit/rendering/newsreporter \
  docs/reference/newsreporter
```
No commit (empty dirs).

---

## Task 1: `reportSchema` (published-language contract)

**Files:**
- Create: `backend/src/3_applications/newsreporter/reportSchema.mjs`
- Test: `tests/unit/applications/newsreporter/reportSchema.test.mjs`

**Step 1: Failing test** — valid sections parse; unknown section type rejected; empty sections array allowed.
```js
import { describe, it, expect } from '@jest/globals';
import { reportSchema, parseReport } from '#apps/newsreporter/reportSchema.mjs';

describe('reportSchema', () => {
  it('accepts heading/lines/table/note sections', () => {
    const r = parseReport({ sections: [
      { type: 'heading', text: 'A' },
      { type: 'lines', lines: ['x', 'y'] },
      { type: 'table', headers: ['H'], rows: [['1']] },
      { type: 'note', text: 'n' },
    ]});
    expect(r.sections).toHaveLength(4);
  });
  it('allows empty sections (empty report)', () => {
    expect(parseReport({ sections: [] }).sections).toEqual([]);
  });
  it('rejects unknown section type', () => {
    expect(() => parseReport({ sections: [{ type: 'bogus' }] })).toThrow();
  });
});
```

**Step 2:** Run `node tests/unit/harness.mjs --pattern=reportSchema` → FAIL (module missing).

**Step 3: Implement.**
```js
import { z } from 'zod';

const heading = z.object({ type: z.literal('heading'), text: z.string() });
const lines = z.object({ type: z.literal('lines'), lines: z.array(z.string()) });
const table = z.object({
  type: z.literal('table'),
  headers: z.array(z.string()).default([]),
  rows: z.array(z.array(z.string())),
});
const note = z.object({ type: z.literal('note'), text: z.string() });

export const reportSchema = z.object({
  sections: z.array(z.discriminatedUnion('type', [heading, lines, table, note])),
});

/** @returns {{sections: Array}} validated; throws ZodError on mismatch */
export function parseReport(obj) { return reportSchema.parse(obj); }
```

**Step 4:** Run → PASS. **Step 5:** Commit `feat(newsreporter): report sections schema`.

---

## Task 2: Ports (`ISource`, `ISink`, `IReportRunHistory`)

**Files:**
- Create: `backend/src/3_applications/newsreporter/ports/ISource.mjs`, `ISink.mjs`, `IReportRunHistory.mjs`
- Test: `tests/unit/applications/newsreporter/ports.test.mjs`

**Step 1: Failing test** — base methods throw "must be implemented"; type guards detect shape.
```js
import { describe, it, expect } from '@jest/globals';
import { ISource, isSource } from '#apps/newsreporter/ports/ISource.mjs';
import { ISink, isSink } from '#apps/newsreporter/ports/ISink.mjs';

describe('newsreporter ports', () => {
  it('ISource.gather throws when not implemented', async () => {
    await expect(new ISource().gather({})).rejects.toThrow('must be implemented');
  });
  it('isSource detects a valid impl', () => {
    expect(isSource({ gather: () => {} })).toBe(true);
    expect(isSource({})).toBe(false);
  });
  it('ISink.emit throws when not implemented', async () => {
    await expect(new ISink().emit([], {}, {})).rejects.toThrow('must be implemented');
  });
});
```

**Step 2:** Run `--pattern=ports` → FAIL.

**Step 3: Implement** each port following the `IMessagingGateway` pattern in the DDD reference.
- `ISource`: `async gather(ctx)` → `{ items, meta }`; export `isSource(obj)` checking `typeof obj?.gather === 'function'`.
- `ISink`: `async emit(sections, cfg, ctx)` → `{ status, detail }`; export `isSink`.
- `IReportRunHistory`: `async record(reporterId, runResult)`; export `isReportRunHistory`.

Each method body: `throw new Error('I<Name>.<method> must be implemented');`

**Step 4:** Run → PASS. **Step 5:** Commit `feat(newsreporter): source/sink/history ports`.

---

## Task 3: Placeholder resolver (date/TZ util)

**Files:**
- Create: `backend/src/3_applications/newsreporter/placeholders.mjs`
- Test: `tests/unit/applications/newsreporter/placeholders.test.mjs`

**Behavior:** Pure function `resolvePlaceholders(str|obj, ctx)` replacing `{{yesterday}}`, `{{today}}`, `{{date}}` with ISO `YYYY-MM-DD` strings computed from `ctx.referenceDate` (a Date) in `ctx.timezone` (IANA string). Deep-walks strings in nested objects/arrays (for source `url`, template `footer`). `{{date}}` == today (or override date); `{{yesterday}}` == referenceDate − 1 day; `{{today}}` == referenceDate. Use `Intl.DateTimeFormat` with `timeZone` for TZ-correct calendar date (do NOT use raw `Date` local methods — avoids the Strava TZ trap noted in the design).

**Step 1: Failing test** (inject a fixed reference date — never call `Date.now()` in tests):
```js
import { resolvePlaceholders, toCalendarDate } from '#apps/newsreporter/placeholders.mjs';
const ctx = { referenceDate: new Date('2026-06-21T06:50:00Z'), timezone: 'America/Denver' };

it('resolves yesterday/today/date', () => {
  expect(resolvePlaceholders('d={{date}} y={{yesterday}}', ctx))
    .toBe('d=2026-06-21 y=2026-06-20');  // 06:50Z = 00:50 MDT, still the 21st
});
it('deep-walks objects', () => {
  expect(resolvePlaceholders({ url: 'a?d={{yesterday}}' }, ctx))
    .toEqual({ url: 'a?d=2026-06-20' });
});
```
(Verify the exact MDT expectation when implementing; adjust the asserted dates to match correct TZ math, do not fudge the implementation to fit a wrong expectation.)

**Step 2:** Run `--pattern=placeholders` → FAIL.
**Step 3:** Implement with `Intl.DateTimeFormat('en-CA', { timeZone, year, month, day })` (en-CA yields `YYYY-MM-DD`). `toCalendarDate(date, tz)` helper; subtract a day by constructing from the formatted parts.
**Step 4:** Run → PASS. **Step 5:** Commit `feat(newsreporter): TZ-aware placeholder resolver`.

---

## Task 4: `ReportReceiptRenderer` (1_rendering, pure)

**Files:**
- Create: `backend/src/1_rendering/newsreporter/ReportReceiptRenderer.mjs`
- Test: `tests/unit/rendering/newsreporter/ReportReceiptRenderer.test.mjs`

**Behavior:** Pure class with `render(sections, template = {}, ctx = {})` → a **PrintJob POJO** `{ items: PrintItem[], footer: { paddingLines, autoCut } }`. No I/O, no imports from `1_adapters`. Mapping per design:
- `template.header` → `{ type:'text', content: header, align:'center', size:{width:2,height:2}, style:{bold:true} }`
- `template.divider` (truthy) → `{ type:'line', width:48 }`
- section `heading` → `{ type:'text', content:text, align:'center', style:{bold:true} }`
- section `lines` → one `{ type:'text', content:line, align:'left' }` per line
- section `table` → `{ type:'table', headers, rows, width:48 }` *(note: the printer adapter's `createTablePrint` consumes `{headers, rows}`; emit a `table` print item the PrinterSink expands — see Task 7 note, OR pre-expand here. Decision: pre-expand here into text rows using a shared `formatTable` helper so the renderer stays the single layout owner.)*
- section `note` → `{ type:'text', content:text, align:'center' }`
- `template.footer` → resolved via placeholders by caller; render as `{ type:'text', content:footer, align:'center' }`
- `footer.autoCut` ← `template.autoCut !== false`
- Also expose `renderText(sections, template, ctx)` → a plain-text string approximation (for `dryRun` CLI preview), reusing the same section walk.

**Step 1: Failing test** — header/divider/sections map to expected items; empty sections → minimal job; `renderText` returns readable text.
```js
import { ReportReceiptRenderer } from '#rendering/newsreporter/ReportReceiptRenderer.mjs';
const r = new ReportReceiptRenderer();
it('maps heading + lines to print items', () => {
  const job = r.render(
    [{ type:'heading', text:'WC' }, { type:'lines', lines:['BRA 2-1 ARG'] }],
    { header:'⚽ WORLD CUP', divider:true, footer:'daylight', autoCut:true }
  );
  expect(job.items[0]).toMatchObject({ type:'text', content:'⚽ WORLD CUP', align:'center' });
  expect(job.items.some(i => i.type==='line')).toBe(true);
  expect(job.items.some(i => i.content==='BRA 2-1 ARG')).toBe(true);
  expect(job.footer.autoCut).toBe(true);
});
```

**Step 2:** Run `--pattern=ReportReceiptRenderer` → FAIL.
**Step 3:** Implement (pure). If `#rendering` alias missing, use relative path and note it.
**Step 4:** Run → PASS. **Step 5:** Commit `feat(newsreporter): receipt renderer (1_rendering)`.

---

## Task 5: `HttpSourceAdapter` (1_adapters)

**Files:**
- Create: `backend/src/1_adapters/newsreporter/sources/HttpSourceAdapter.mjs`
- Test: `tests/unit/adapters/newsreporter/HttpSourceAdapter.test.mjs`

**Behavior:** `extends ISource`. Constructor `{ httpClient, logger }` (inject `HttpClient` from `#system/services/HttpClient.mjs` or the project's `httpClient`; for tests inject a fake with `.get`). `gather(ctx)`:
- `cfg = ctx.config` (the source YAML block, placeholders already resolved by the service before calling).
- GET `cfg.url`; on non-2xx or thrown → wrap in `InfrastructureError` and rethrow (real failure).
- Optional `cfg.jsonPath` (support a minimal `$.a.b` dot path; if absent, use the response body if it's an array, else `[body]`).
- Return `{ items, meta: { sourceId: cfg.id, type: 'http', fetchedAt } }`. Empty array when the payload is `[]`/null.
- Log `newsreporter.source.fetch { sourceId, type:'http', itemCount }`.

**Step 1: Failing test** with a fake httpClient: returns items on 200-array; `[]` on empty; throws on error status.
**Step 2:** Run `--pattern=HttpSourceAdapter` → FAIL.
**Step 3:** Implement.
**Step 4:** Run → PASS. **Step 5:** Commit `feat(newsreporter): http source adapter`.

---

## Task 6: `Consolidator` (3_app)

**Files:**
- Create: `backend/src/3_applications/newsreporter/Consolidator.mjs`
- Test: `tests/unit/applications/newsreporter/Consolidator.test.mjs`

**Behavior:** Constructor `{ agentRuntime, logger, defaultModel }`. `consolidate({ prompt, model, items, ctx })`:
- Build a strict instruction: system = `prompt` + `"\n\nRespond with ONLY a JSON object: { \"sections\": [...] } matching the allowed section types. No prose, no code fences."`
- user message = `JSON.stringify(items)`.
- Call `agentRuntime.execute({ agentId:'newsreporter-consolidator', input, systemPrompt, tools:[], context:{...ctx} })`; take `result.output`.
- Strip code fences if present; `JSON.parse`; `parseReport()` (zod). On parse/zod failure: log `newsreporter.consolidate.parse_retry`, retry ONCE with an appended "Your previous output was invalid JSON; return only the JSON object." On second failure throw `ApplicationError`.
- Log `newsreporter.consolidate.ok { sectionCount }`.
- Return `{ sections }`.

**Step 1: Failing test** with a fake agentRuntime:
- valid JSON first try → sections returned;
- invalid then valid → one retry, sections returned, `parse_retry` logged;
- invalid twice → throws.
```js
const fakeRuntime = (outputs) => { let i=0; return { execute: async () => ({ output: outputs[i++] }) }; };
```
**Step 2:** Run `--pattern=Consolidator` → FAIL.
**Step 3:** Implement.
**Step 4:** Run → PASS. **Step 5:** Commit `feat(newsreporter): LLM consolidator with one-retry validation`.

---

## Task 7: `PrinterSink` (3_app glue)

**Files:**
- Create: `backend/src/3_applications/newsreporter/sinks/PrinterSink.mjs`
- Test: `tests/unit/applications/newsreporter/PrinterSink.test.mjs`

**Behavior:** `extends ISink`. Constructor `{ renderer, printerRegistry, logger }` (renderer = `ReportReceiptRenderer` from `1_rendering`; printerRegistry = existing `ThermalPrinterRegistry`). `emit(sections, cfg, ctx)`:
- `job = renderer.render(sections, cfg.template, ctx)`.
- If `ctx.dryRun` → return `{ status:'ok', detail:{ preview: renderer.renderText(sections, cfg.template, ctx) } }` (NO print).
- `printerName = ctx.printerOverride ?? cfg.printer` (override wins); `printer = printerRegistry.resolve(printerName)`.
- `ok = await printer.print(job)`; log `newsreporter.sink.emit { type:'printer', printer:printerName, status: ok?'ok':'error' }`.
- Return `{ status: ok ? 'ok' : 'error' }`. Throw only if `printerRegistry.resolve` itself throws (misconfig).

**Step 1: Failing test** with fakes (`renderer` returns a stub job; `printerRegistry.resolve().print` returns true/false):
- normal → calls print, status ok;
- print returns false → status error;
- `ctx.dryRun` → does NOT call print, returns preview;
- `ctx.printerOverride` → resolve called with override.
**Step 2:** Run `--pattern=PrinterSink` → FAIL.
**Step 3:** Implement.
**Step 4:** Run → PASS. **Step 5:** Commit `feat(newsreporter): printer sink`.

---

## Task 8: `YamlReportRunDatastore` (1_adapters, history)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlReportRunDatastore.mjs`
- Test: `tests/unit/adapters/newsreporter/YamlReportRunDatastore.test.mjs`

**Behavior:** `extends IReportRunHistory`. Constructor `{ dataService, logger }`. `record(reporterId, runResult)` writes
`history/newsreporter/{reporterId}/{date}` (DataService household path) = `{ startedAt, status, sourceCounts, sinkResults, error }`. Date from `runResult.startedAt` calendar date. Mirror an existing yaml datastore for the DataService write call. Tolerate write failure (log `newsreporter.history.write_failed`, never throw into the run path).

**Step 1: Failing test** with a fake dataService capturing the write path + payload.
**Step 2–4:** TDD. **Step 5:** Commit `feat(newsreporter): yaml run-history datastore`.

---

## Task 9: `NewsReporterService` (3_app orchestration — core)

**Files:**
- Create: `backend/src/3_applications/newsreporter/NewsReporterService.mjs`
- Test: `tests/unit/applications/newsreporter/NewsReporterService.test.mjs`

**Behavior:** Constructor `{ configService, sourceRegistry, consolidator, sinkRegistry, history, logger, clock }` where:
- `sourceRegistry.create(type, cfg, deps)` → ISource; `sinkRegistry.create(type, cfg, deps)` → ISink.
- `clock` = injectable `{ now: () => Date }` (default `{ now: () => new Date() }`) so tests pass a fixed date — NEVER call `new Date()` directly in logic that tests assert on.

`async run(reporterId, overrides = {})`:
1. `cfg = configService.getHouseholdAppConfig(null, 'newsreporter')?.[reporterId]`; if missing/`enabled === false` → throw `EntityNotFoundError`.
2. Build `ctx`: `referenceDate` = `overrides.date ? new Date(overrides.date+'T12:00:00Z') : clock.now()`, `timezone` = household TZ (from config; fallback `America/Denver`), `dryRun = !!overrides.dryRun`, `printerOverride = overrides.printer ?? null`, child logger.
3. `startedAt = clock.now().toISOString()`. Log `newsreporter.run.start { reporterId }`.
4. **Gather:** `const resolvedSources = (cfg.sources||[]).map(s => resolvePlaceholders(s, ctx))`; create each via registry; `Promise.all(sources.map(s => s.gather({...ctx, config:s_cfg})))`. A thrown source → catch, record `error`, log `newsreporter.run.error`, return `{ status:'error', error }`.
5. Merge items; `if (!overrides.force && allEmpty)` → record `empty`, log `newsreporter.run.empty`, return `{ status:'empty', sourceCounts }`.
6. **Consolidate:** `{ sections } = await consolidator.consolidate({ prompt: cfg.consolidate.prompt, model: cfg.consolidate.model, items, ctx })`. On throw → record `error`, return error. If `sections.length === 0 && !overrides.force` → record `empty`, return empty.
7. **Emit:** for each `cfg.sinks` (placeholders resolved), create sink, `await sink.emit(sections, sinkCfg, ctx)` in a try/catch per sink; collect `sinkResults`. (Sinks independent; one failure doesn't abort others.)
8. `status = sinkResults.some(r => r.status==='ok') ? 'ok' : 'error'` (dryRun counts as ok).
9. Record history; log `newsreporter.run.complete { status, durationMs }`. Return `{ status, sourceCounts, sinkResults, sections: ctx.dryRun ? sections : undefined, preview: ctx.dryRun ? sinkResults.map(r=>r.detail?.preview).filter(Boolean).join('\n---\n') : undefined }`.

**Step 1: Failing tests** (fakes for everything; fixed clock) — cover each design case:
- normal run → `ok`, sink.emit called once, history recorded `ok`;
- all sources empty → `empty`, consolidator NOT called, no sink.emit;
- source throws → `error`, no print;
- consolidator returns empty sections → `empty`;
- one sink throws + one ok → `ok`, both attempted;
- `overrides.dryRun` → returns `sections`/`preview`, sink.emit receives `ctx.dryRun true`;
- `overrides.date` → ctx.referenceDate reflects it (assert placeholder resolution via a spy source capturing its resolved url);
- unknown reporter id → throws `EntityNotFoundError`.

**Step 2:** Run `--pattern=NewsReporterService` → FAIL.
**Step 3:** Implement against the design; keep it orchestration-only (no I/O except via injected deps).
**Step 4:** Run → PASS (all cases). **Step 5:** Commit `feat(newsreporter): orchestration service`.

---

## Task 10: Registries + stub source adapters

**Files:**
- Create: `backend/src/1_adapters/newsreporter/sources/sourceRegistry.mjs`, `RssSourceAdapter.mjs`, `HarvesterSourceAdapter.mjs`, `AgentSourceAdapter.mjs`
- Create: `backend/src/3_applications/newsreporter/sinks/sinkRegistry.mjs`
- Test: `tests/unit/adapters/newsreporter/sourceRegistry.test.mjs`

**Behavior:**
- `sourceRegistry`: factory `createSourceRegistry(deps)` returning `{ create(type, cfg) }`. Map `http → HttpSourceAdapter`; `rss/harvester/agent →` stub adapters that throw `not implemented` from `gather` (so a misconfigured reporter fails loudly, recorded as `error`). Unknown type → throw.
- Stub adapters: `extends ISource`, `gather()` throws `InfrastructureError('<type> source not implemented yet')`.
- `sinkRegistry`: `createSinkRegistry({ renderer, printerRegistry, logger })` → `{ create(type, cfg) }`; `printer → new PrinterSink(...)`; unknown → throw.

**Step 1: Failing test** — registry creates HttpSource for `http`; throws on unknown; stub source throws on gather.
**Step 2–4:** TDD. **Step 5:** Commit `feat(newsreporter): source/sink registries + source stubs`.

---

## Task 11: Scheduler bridge — `NewsReporterJobDatastore` + `CompositeJobDatastore`

**Files:**
- Create: `backend/src/1_adapters/newsreporter/NewsReporterJobDatastore.mjs`
- Create: `backend/src/1_adapters/scheduling/CompositeJobDatastore.mjs`
- Test: `tests/unit/adapters/newsreporter/NewsReporterJobDatastore.test.mjs`, `tests/unit/adapters/scheduling/CompositeJobDatastore.test.mjs`

**Behavior:**
- `NewsReporterJobDatastore extends IJobDatastore` (`#apps/scheduling/ports/IJobDatastore.mjs`). Constructor `{ configService, logger }`. `loadJobs()` reads `newsreporter` household config; for each enabled reporter build `Job.fromObject({ id, name:`newsreporter:${id}`, schedule: r.schedule, enabled: r.enabled !== false, timeout: 120000, bucket:'newsreporter' })`. Returns `Job[]`. Expose `reporterIds()` → `Set<string>` for the executor.
- `CompositeJobDatastore extends IJobDatastore`. Constructor `{ stores: IJobDatastore[], logger }`. `loadJobs()` concatenates all; on duplicate `id`, the EARLIER store wins (so `jobs.yml` precedes newsreporter) and logs `scheduler.jobStore.id_collision { id }`. Delegate any other `IJobDatastore` methods to the first store that implements them.

**Step 1: Failing tests:**
- `NewsReporterJobDatastore.loadJobs` with a fake configService → correct Job ids/schedules; disabled reporters excluded.
- `CompositeJobDatastore` merges two fakes; collision keeps first + logs.
**Step 2–4:** TDD (verify `Job.fromObject` required fields from `#domains/scheduling/entities/Job.mjs`).
**Step 5:** Commit `feat(newsreporter): scheduler job datastore + composite store`.

---

## Task 12: `NewsReporterJobExecutor` (3_app)

**Files:**
- Create: `backend/src/3_applications/newsreporter/NewsReporterJobExecutor.mjs`
- Test: `tests/unit/applications/newsreporter/NewsReporterJobExecutor.test.mjs`

**Behavior:** Mirror `HarvesterJobExecutor`. Constructor `{ newsReporterService, reporterIdProvider, logger }` where `reporterIdProvider()` → `Set<string>` (the `NewsReporterJobDatastore.reporterIds`, re-read each call so new reporters register without restart). `canHandle(jobId)` → `reporterIdProvider().has(jobId)`. `async execute(jobId, options = {}, context = {})` → `await newsReporterService.run(jobId)`; log start/complete; rethrow on error so the scheduler records failure.

**Step 1: Failing test** — `canHandle` true for known id / false otherwise; `execute` delegates to `service.run`.
**Step 2–4:** TDD. **Step 5:** Commit `feat(newsreporter): scheduler job executor`.

---

## Task 13: Wire into `SchedulerOrchestrator` + `app.mjs`

**Files:**
- Modify: `backend/src/3_applications/scheduling/SchedulerOrchestrator.mjs` (constructor + `executeJob` dispatch ~line 127-160)
- Modify: `backend/src/app.mjs` (printer registry ~1345; scheduler bootstrap ~2311)
- Create: `backend/src/3_applications/newsreporter/NewsReporterContainer.mjs`
- Test: `tests/unit/applications/scheduling/SchedulerOrchestrator.newsreporter.test.mjs`

**Step 1 (Orchestrator) — failing test:** with a fake `newsReporterExecutor.canHandle` returning true, `executeJob` calls it before harvester/media. Add `newsReporterExecutor` to constructor deps; add the dispatch branch FIRST:
```js
if (this.newsReporterExecutor?.canHandle(job.id)) {
  await Promise.race([ this.newsReporterExecutor.execute(job.id, job.options||{}, { executionId }),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error(`Job timeout after ${job.timeout}ms`)), job.timeout)) ]);
  execution.succeed(timestamp);
} else if (this.harvesterExecutor?.canHandle(job.id)) { /* existing */ }
```
Run `--pattern=SchedulerOrchestrator` → FAIL → implement → PASS. Commit `feat(scheduler): dispatch newsreporter jobs`.

**Step 2 (Container):** `NewsReporterContainer.build({ configService, agentRuntime, printerRegistry, dataService, logger })` constructs renderer, registries, consolidator, history, service, jobDatastore, executor; returns `{ service, jobDatastore, executor }`. (Composition root — imports concrete adapters; allowed in 3_app.) No standalone test required (covered by integration); optional smoke test.

**Step 3 (app.mjs):** after the printer registry block, and where the scheduler is assembled:
```js
const newsReporter = NewsReporterContainer.build({
  configService, agentRuntime, printerRegistry, dataService, logger: appLogger,
});
// composite job store
const compositeJobStore = new CompositeJobDatastore({
  stores: [ schedulingJobStore, newsReporter.jobDatastore ], logger,
});
// pass compositeJobStore where schedulingJobStore was given to the orchestrator,
// and add newsReporterExecutor: newsReporter.executor to SchedulerOrchestrator deps.
```
Verify the exact local variable names at those lines before editing. Keep `v1Routers`/service references consistent with existing patterns so the API task can reach the service.

**Step 4:** Run the unit suite `node tests/unit/harness.mjs --pattern=newsreporter` and `--pattern=Scheduler` → PASS. Boot the backend once to confirm no wiring throw: `node backend/index.js` (Ctrl-C after "listening"); check `dev.log`/stdout for `scheduler.jobStore.loaded` including reporter count.
**Step 5:** Commit `feat(newsreporter): app wiring + container`.

---

## Task 14: Manual-run API endpoint

**Files:**
- Create: `backend/src/4_api/v1/routers/newsreporter.mjs`
- Modify: wherever v1 routers are registered (find by grepping how `printer.mjs` router is mounted)
- Test: `tests/unit/api/newsreporter.router.test.mjs` (supertest-style if the project has one; else a thin handler unit test)

**Behavior:**
```
POST /api/v1/newsreporter/:id/run
body: { date?, printer?, dryRun?, force? }  → newsReporterService.run(id, body)
200 → { status, sourceCounts, sinkResults, sections?, preview? }
404 → EntityNotFoundError mapped by existing error middleware
```
Follow `printer.mjs` for router construction + how the service is injected into routers.

**Step 1–4:** TDD with a fake service; assert it passes overrides through and returns the service result. Map errors via the standard error handler.
**Step 5:** Commit `feat(newsreporter): manual-run API endpoint`.

---

## Task 15: Ad-hoc CLI

**Files:**
- Create: `cli/newsreporter.cli.mjs`
- Test: manual (CLI driver). Optionally `cli/newsreporter.cli.test.mjs` for the arg parser only.

**Behavior:** Copy the structure/header style of `cli/regen-timelapse.cli.mjs`. Parse `<reporter-id>` + `--date --printer --dry-run --force --base-url -h`. POST to `${baseUrl}/api/v1/newsreporter/${id}/run` with the override body. Print returned `status` + `sourceCounts`; on `--dry-run` print `preview`. Exit non-zero on error/`status==='error'`. Include the usage/examples block from the design doc.

**Step 1:** Implement parser + main. **Step 2 (verify):** start backend, run `node cli/newsreporter.cli.mjs world-cup-reporter --dry-run --force` → prints a rendered preview (using the example config from Task 16). **Step 3:** Commit `feat(cli): newsreporter ad-hoc trigger`.

---

## Task 16: Example config + reference doc

**Files:**
- Create: `data/household/config/newsreporter.yml` (the `world-cup-reporter` example from the design; pick a real or clearly-placeholder scores `url` + `jsonPath`; if no real API yet, set `enabled: false` and note it so the scheduler doesn't fire a broken job in prod). Write via SSH to prod path if mount perms block local write (see CLAUDE.md).
- Create: `docs/reference/newsreporter/newsreporter-framework.md` — the reference doc (architecture, config schema, source/sink types + how to add one, scheduler integration, CLI/endpoint usage, run history/observability). Link it from `docs/reference` navigation if an index exists.
- Update: `docs/reference/core/...` only if these changes alter documented layer structure (they add a `1_rendering/newsreporter` consumer — mention if the rendering layer doc enumerates consumers).

**Step 1:** Write the reference doc (concise, current-state, no instance-specific hostnames/IPs — use placeholders per CLAUDE.md docs rules).
**Step 2:** Commit `docs(newsreporter): framework reference + example config`.

---

## Task 17: Full suite + push

**Step 1:** `node tests/unit/harness.mjs --pattern=newsreporter` → all green. Then `node tests/unit/harness.mjs --pattern=Scheduler` → green (no regression).
**Step 2:** Boot backend once; confirm `scheduler.jobStore.loaded` count increased and no errors; run the CLI `--dry-run --force` end-to-end against the running app.
**Step 3:** Move the design + plan from `docs/_wip/plans/` to keep or archive per convention; update `docs/docs-last-updated.txt` if appropriate.
**Step 4:** `git push origin main`.
**Step 5:** Report: files created, test results (with the actual pass counts), anything stubbed, and whether the example config was left `enabled: false`.

---

## Notes for the executor

- **Never fudge a test to pass.** If TZ math or a mapping differs from the asserted value, verify which is correct and fix the real bug (per the "No Excuses" testing policy in CLAUDE.md).
- **Injectable clock + reference date everywhere** — no `new Date()`/`Date.now()` in asserted logic.
- **Layer rule is load-bearing:** if you find yourself importing `1_rendering` from a `1_adapters` file, stop — the composition belongs in `PrinterSink` (3_app).
- Keep each adapter's external call wrapped so "no data" (`[]`) is distinct from "failure" (throw).
