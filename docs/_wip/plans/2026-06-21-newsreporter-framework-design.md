# NewsReporter Framework — Design

> Date: 2026-06-21
> Status: Approved design (pre-implementation)
> Bounded context: `newsreporter` (Level 2 feature application)

## Overview

A config-driven framework for **scheduled, generated reports**. A *reporter* is a
declarative pipeline:

```
gather from N sources  →  consolidate via LLM  →  render to M sinks   (on a schedule)
```

Sources and sinks are pluggable through type-keyed registries, so new kinds are
add-a-class-and-register — never edit-the-core. The first reporter,
`world-cup-reporter`, fetches yesterday's match results each morning and prints a
receipt to the upstairs thermal printer. Future reporters (RSS headline roundup,
social-media digest, etc.) reuse the same machinery with different
sources/prompts/sinks.

Explicitly **not** built on `CanvasService`. Printer output uses standard
receipt/text formatting via the existing `ThermalPrinter*` adapter, with layout
owned by a `1_rendering` renderer.

## Key decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Data gathering | **Hybrid**: `source.type` = `http` \| `rss` \| `harvester` \| `agent`; LLM always does final consolidation/formatting |
| 2 | Scheduling | **Reuse the existing scheduler** via a `NewsReporterJobExecutor`; cron lives in `newsreporter.yml` |
| 3 | Print template | **Structured LLM sections + YAML layout chrome**; LLM supplies content, template owns layout/width |
| 4 | Empty / failure | **Skip print** on no-data; **log only** on failure. Never print junk. Both recorded in run history |
| 5 | Ad-hoc trigger | **CLI drives a manual-run HTTP endpoint** (regen-timelapse style) → reuses deployed wiring; supports date/printer/dry-run/force overrides |

## Architecture & layering (DDD — no leakage)

Dependencies point strictly inward. Rendering, transport, and orchestration are
separated per `docs/reference/core/layers-of-abstraction/ddd-reference.md`.

| Artifact | Layer | Path |
|----------|-------|------|
| `ISource`, `ISink`, `IReportRunHistory` (ports) | `3_app` | `3_applications/newsreporter/ports/` |
| `reportSchema` (zod; published language) | `3_app` | `3_applications/newsreporter/reportSchema.mjs` |
| `NewsReporterService`, `Consolidator` | `3_app` | `3_applications/newsreporter/` |
| `PrinterSink` (glue: render + transport) | `3_app` | `3_applications/newsreporter/sinks/PrinterSink.mjs` |
| `NewsReporterJobExecutor`, `NewsReporterContainer` | `3_app` | `3_applications/newsreporter/` |
| `ReportReceiptRenderer` (sections → PrintJob) | `1_rendering` | `1_rendering/newsreporter/ReportReceiptRenderer.mjs` |
| `HttpSourceAdapter`, `RssSourceAdapter`, … | `1_adapters` | `1_adapters/newsreporter/sources/` |
| `NewsReporterJobDatastore`, `CompositeJobDatastore` | `1_adapters` | `1_adapters/newsreporter/`, `1_adapters/scheduling/` |
| `YamlReportRunDatastore` (history) | `1_adapters` | `1_adapters/persistence/yaml/` |
| `newsreporter` router (manual-run endpoint) | `4_api` | `4_api/v1/routers/newsreporter.mjs` |
| `newsreporter.cli.mjs` (ad-hoc trigger) | `cli` (outside layers) | `cli/newsreporter.cli.mjs` |

**Rule compliance notes:**

- **Source/sink implementations are adapters** (they do I/O). Only their **ports**
  live in `3_app`. Source adapters implement `ISource` (port-only import of `3_app`,
  which the rule permits for `1_adapters`).
- **Receipt layout is rendering.** Sections → `PrintItem[]` lives in `1_rendering`
  (the DDD doc lists "Thermal receipts" there), not in a sink or adapter.
- **`1_adapters` cannot import `1_rendering`.** Therefore render-then-transport is
  composed at the application layer: `PrinterSink` (in `3_app`, which *may* import
  both `1_rendering` and `1_adapters`) calls `ReportReceiptRenderer.render(...) →
  PrintJob`, then hands the `PrintJob` to the injected printer transport (existing
  `ThermalPrinterRegistry`/`Adapter`).
- **`PrintJob`/`PrintItem`** is a plain-POJO **Published Language**: neither the
  renderer nor the printer adapter imports the other (matches how the existing
  `4_api/v1/routers/printer.mjs` already builds jobs).
- **`Consolidator`** depends on the `IAgentRuntime` port; `MastraAdapter` is
  untouched.
- **`reportSchema`** stays an application-layer validation schema (YAGNI). It
  graduates to a `2_domains/newsreporter` value object only if real
  invariants/behavior emerge.

## File layout

```
backend/src/3_applications/newsreporter/
  NewsReporterService.mjs        # orchestrates one reporter run
  NewsReporterContainer.mjs      # wires concrete adapters into registries + service
  NewsReporterJobExecutor.mjs    # canHandle(id)/execute(id) → scheduler bridge
  Consolidator.mjs               # LLM step: prompt + items -> structured sections
  reportSchema.mjs               # zod schema for sections (published language)
  ports/
    ISource.mjs                  # gather(ctx) -> { items[], meta }
    ISink.mjs                    # emit(sections, cfg, ctx) -> { status, detail }
    IReportRunHistory.mjs        # record(reporterId, runResult)
  sinks/
    PrinterSink.mjs              # implements ISink: renderer + printer transport

backend/src/1_rendering/newsreporter/
  ReportReceiptRenderer.mjs      # pure: (sections, template, ctx) -> PrintJob

backend/src/1_adapters/newsreporter/
  sources/
    HttpSourceAdapter.mjs        # type: http      (built now)
    RssSourceAdapter.mjs         # type: rss       (stub)
    HarvesterSourceAdapter.mjs   # type: harvester (stub)
    AgentSourceAdapter.mjs       # type: agent     (stub)
  NewsReporterJobDatastore.mjs   # newsreporter.yml -> Job[] (IJobDatastore)

backend/src/1_adapters/scheduling/
  CompositeJobDatastore.mjs      # YamlJobDatastore + NewsReporterJobDatastore

backend/src/1_adapters/persistence/yaml/
  YamlReportRunDatastore.mjs     # run history
```

## Config schema (`data/household/config/newsreporter.yml`)

Each top-level key is a reporter id (also its scheduler job id).

```yaml
world-cup-reporter:
  enabled: true
  purpose: "Print yesterday's World Cup results each morning."
  schedule: "50 7 * * *"          # cron; SSOT here, surfaced to the scheduler

  sources:                         # 1..N; gathered in parallel, results merged
    - type: http
      id: matches
      url: "https://api.example.com/worldcup/results?date={{yesterday}}"
      jsonPath: "$.matches"        # optional pluck
      window: { from: "{{yesterday}}", to: "{{yesterday}}" }

  consolidate:
    model: "openai/gpt-4o"         # optional; framework default otherwise
    prompt: |
      You are a sports desk editor. Given yesterday's match results as JSON,
      produce a concise printed report grouped by competition. If there were
      no matches, return an empty sections array.

  sinks:                           # 1..M output targets
    - type: printer
      printer: upstairs            # registry name; omit => default printer
      template:
        header: "⚽  WORLD CUP"
        divider: true
        footer: "daylight · {{date}}"
        autoCut: true

  on_empty: skip                   # skip | (future: print) — default skip
  on_error: log                    # log  | (future: notify) — default log
```

- **Placeholders** (`{{yesterday}}`, `{{today}}`, `{{date}}`) are resolved by the
  framework in the configured **household timezone** before source fetch and template
  render. Reporters never compute dates themselves (avoids Strava-style TZ traps).
- `sources` and `sinks` are arrays.
- `on_empty`/`on_error` keys are documented now; only `skip`/`log` defaults are
  implemented (YAGNI).
- Loaded via `ConfigService` reading `config/newsreporter`, cached, hot-reloadable.

## Run pipeline (`NewsReporterService.run(reporterId)`)

```
load reporter cfg (from ConfigService)
resolve placeholders (household TZ)
  → gather: run each configured source in PARALLEL via sourceRegistry; merge items[]
            (each item tagged meta.sourceId)
  → if every source returned [] : record 'empty', stop (no LLM, no paper)
  → consolidate: Consolidator(prompt, items) -> { sections }   (zod-validated)
            if LLM returns empty sections      : record 'empty', stop
  → emit: for each configured sink, render + send (sinks independent)
  → record run result (ok | empty | error) to history
```

## Sources & consolidation

**`ISource.gather(ctx)`** → `{ items: any[], meta: { sourceId, type, fetchedAt } }`
- `items = []` → contributed nothing (NOT an error).
- `throw` → real failure; orchestrator records `error`, skips printing.
- `ctx` carries resolved placeholders, the source's YAML block, secrets access, and a
  child logger. Built by `sourceRegistry.create(cfg.type, cfg, deps)`.

**HttpSourceAdapter** (built now): fetch `url` (placeholders resolved), optional
`auth_ref` secret, optional `jsonPath` pluck. `items: []` on 200-but-empty; throws on
non-2xx/timeout.

**Consolidator** (the generic "consolidation task"): sends `consolidate.prompt` as the
system prompt + merged `items[]` as the user message through the injected
`IAgentRuntime`. Because `MastraAdapter.execute` returns **plain text**, the
Consolidator appends a strict "respond ONLY with JSON matching this shape"
instruction, parses, and zod-validates against `reportSchema`. **One retry** on
parse/validation failure, then `error`. Shared `MastraAdapter` stays untouched.

**`reportSchema` (sections — the contract the renderer consumes):**

```js
{ sections: [
    { type: 'heading', text },
    { type: 'lines',   lines: [string] },
    { type: 'table',   headers: [string], rows: [[string]] },
    { type: 'note',    text },
] }
```

An empty `sections[]` is honored as `empty`.

## Sinks & rendering

**`ISink.emit(sections, cfg, ctx)`** → `{ status: 'ok'|'skipped'|'error', detail }`.
Never throws for "nothing to show"; throws only on real send failure. A sink failure
is recorded per-sink and does not abort sibling sinks.

**`PrinterSink`** (3_app glue):

```
emit(sections, cfg):
  job = ReportReceiptRenderer.render(sections, cfg.template, ctx)   # 1_rendering
  printer = printerRegistry.resolve(cfg.printer)                    # 1_adapters (injected)
  ok = await printer.print(job)
  return { status: ok ? 'ok' : 'error' }
```

**`ReportReceiptRenderer.render`** (pure, 1_rendering) maps sections → existing
`PrintItem[]`, reusing the adapter vocabulary (no new ESC/POS, no CanvasService):

```
template.header  -> { type:'text', align:'center', size:{w:2,h:2}, style:{bold:true} }
template.divider -> { type:'line', width:48 }
heading          -> bold centered text
lines            -> left text items (one per line)
table            -> createTablePrint rows (score columns)
note             -> small centered text
template.footer  -> centered text (placeholders resolved)
autoCut          -> footer.autoCut
```

Width is fixed by the template (32/48) — the LLM emits semantic sections and never
counts characters.

**Why a sink abstraction with one sink today:** a social digest later wants printer +
notification; an eink reporter wants a different renderer off the *same* `sections`.
The `sections` schema is the stable interface between consolidation and any sink.

## Scheduler integration

The existing `SchedulerOrchestrator` loads all jobs from a single
`jobStore.loadJobs()` and dispatches via `executor.canHandle(job.id)`.

1. **Surface reporters as jobs** — `NewsReporterJobDatastore` reads `newsreporter.yml`
   and synthesizes a `Job` (`2_domains/scheduling`) per reporter:
   `id = reporterId`, `schedule = reporter.schedule`, `enabled`, `timeout ≈ 120s`.
   Schedule stays SSOT in `newsreporter.yml`; no duplicate in `jobs.yml`.
2. **Compose, don't fork** — `CompositeJobDatastore` (implements `IJobDatastore`)
   concatenates `YamlJobDatastore` jobs + synthesized reporter jobs. The orchestrator
   keeps calling `loadJobs()`; dependency checks, missed-run handling, restart-safe
   state, and `nextRun` all come for free.
3. **Dispatch** — `NewsReporterJobExecutor` mirrors `HarvesterJobExecutor`:
   `canHandle(jobId) -> reporterIds.has(jobId)`; `execute(jobId) ->
   newsReporterService.run(jobId)`. Added to `SchedulerOrchestrator` as a third
   executor, slotted **before** the harvester/media checks.
4. **Wiring** — near the existing scheduler bootstrap (`app.mjs` ~line 2311):
   `NewsReporterContainer` builds the source/sink registries (PrinterSink gets the
   `printerRegistry` from ~line 1345), constructs `NewsReporterService`, and exposes
   `newsReporterExecutor` + the composite job store to the orchestrator.
5. **Id-collision guard** — reporter ids must not clash with `jobs.yml` ids; the
   composite store logs a warning and lets `jobs.yml` win.

## Ad-hoc CLI & manual-run endpoint

The reporter service is already wired into the running app, so ad-hoc triggers
drive a thin **HTTP endpoint** (regen-timelapse pattern) rather than re-constructing
services in the CLI — deployed wiring stays the single source of truth.

**Endpoint** (`4_api/v1/routers/newsreporter.mjs`, mirrors harvester manual run):

```
POST /api/v1/newsreporter/:id/run
body: { date?, printer?, dryRun?, force? }
→ NewsReporterService.run(id, overrides)
→ { status, sourceCounts, sections?, preview?, sinkResults }
```

**`NewsReporterService.run(reporterId, overrides = {})`** — `{}` == exact scheduled
behavior. Overrides:

| Override | Effect |
|----------|--------|
| `date: "2026-06-20"` | Resolve `{{yesterday}}`/`{{date}}` against this day, not "now" (backfill/replay). |
| `printer: "downstairs"` | Override every printer sink's target. |
| `dryRun: true` | Gather + consolidate + render, but return the receipt **as text** in the response instead of printing paper. |
| `force: true` | Bypass `on_empty: skip` (pair with `dryRun` to see rendered output even when empty). |

`dryRun` reuses the same `ReportReceiptRenderer`, serialized to text instead of handed
to the printer transport.

**CLI** (`cli/newsreporter.cli.mjs`, regen-timelapse style; works locally or via
`docker exec`/ssh):

```
node cli/newsreporter.cli.mjs <reporter-id> [options]
  --date <YYYY-MM-DD>   run for a specific day
  --printer <name>      override printer sink target
  --dry-run             render to stdout, no paper
  --force               ignore on_empty:skip
  --base-url <url>      default $DAYLIGHT_BASE_URL or http://localhost:3111
  -h, --help

# preview without printing:
node cli/newsreporter.cli.mjs world-cup-reporter --dry-run
# re-print a past day to a test printer:
node cli/newsreporter.cli.mjs world-cup-reporter --date 2026-06-19 --printer downstairs
```

The CLI POSTs and prints the returned status (plus the rendered receipt text on
`--dry-run`). No service construction in the CLI.

## Errors, empty, history & observability

**Run outcomes** (recorded for every run):
- `ok` — printed; record sink results + item counts.
- `empty` — all sources `[]`, or LLM returned no sections → no print.
- `error` — a source threw, LLM parse/validate failed twice, or all sinks failed → no print.

Scheduler marks the job **succeeded** on `empty` (it ran correctly); only `error`
propagates as a job failure so retry/missed-run logic engages.

**History:** `YamlReportRunDatastore` →
`data/household/history/newsreporter/{reporterId}/{date}.yml` =
`{ startedAt, status, sourceCounts, sinkResults, error? }`.

**Structured log events:** `newsreporter.run.start/complete`,
`newsreporter.source.fetch`, `newsreporter.consolidate.{ok,parse_retry,error}`,
`newsreporter.sink.emit`, `newsreporter.run.empty/error`.

## Testing by layer

- `ReportReceiptRenderer` (1_rendering) — **pure unit**: sections → expected
  `PrintItem[]`; width/divider/table mapping.
- Source adapters (1_adapters) — **integration**: HttpSource vs mock server
  (200-empty → `[]`, non-2xx → throws).
- `NewsReporterService` (3_app) — **integration with fakes**: normal → print;
  all-empty → skip+`empty`; source throws → `error`/no print; LLM
  invalid-then-valid → one retry; one sink fails + one ok → `ok`.
- `NewsReporterJobExecutor` + `CompositeJobDatastore` — synthesized ids resolve;
  collision lets `jobs.yml` win.

## Build-now vs stub (YAGNI)

**Build:** `HttpSourceAdapter`, `Consolidator`, `ReportReceiptRenderer`,
`PrinterSink`, `NewsReporterService`, the scheduler bridge
(`NewsReporterJobDatastore` + `CompositeJobDatastore` + `NewsReporterJobExecutor`),
`NewsReporterContainer`, run history, and the `world-cup-reporter` config.

**Stub (port + registry entry only):** `RssSourceAdapter`,
`HarvesterSourceAdapter`, `AgentSourceAdapter`, and non-printer sinks.

## Open items / future

- Non-printer sinks (notification, eink, file) once a second output target is real.
- `on_empty: print` / `on_error: notify` branches when needed.
- `reportSchema` → `2_domains/newsreporter` value object if invariants emerge.
- Admin/API surface to trigger a reporter manually (mirror harvester's manual run).
