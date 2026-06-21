# NewsReporter Framework

> Bounded context: `newsreporter` — config-driven, scheduled, LLM-generated reports.
> Current as of: 2026-06-21.

## What it is

A *reporter* is a declarative pipeline that runs on a schedule:

```
gather (N sources)  →  consolidate (LLM)  →  render + emit (M sinks)
```

Each reporter is a key in `data/household/config/newsreporter.yml`. Sources and
sinks are pluggable through type-keyed registries — adding a new kind is
add-a-class-and-register, never edit-the-core. The first reporter,
`world-cup-reporter`, fetches yesterday's football results each morning and
prints a receipt to the upstairs thermal printer.

Not built on `CanvasService`: printer output is plain receipt/text formatting via
the existing `ThermalPrinter*` adapter, with layout owned by a `1_rendering`
renderer.

## Run outcomes

Every run records exactly one outcome (also surfaced to the scheduler):

| Status  | Meaning | Paper? |
|---------|---------|--------|
| `ok`    | At least one sink succeeded. | yes |
| `empty` | All sources returned `[]`, or the LLM returned no sections. | no |
| `error` | A source threw, consolidation failed (after one retry), or every sink failed. | no |

The scheduler marks the job **succeeded** on `empty` (it ran correctly); only
`error` propagates as a job failure so retry/missed-run logic engages.

## Config schema

`data/household/config/newsreporter.yml` — each top-level key is a reporter id
(also its scheduler job id). Loaded via `ConfigService.getHouseholdAppConfig(null,
'newsreporter')`, cached and hot-reloadable.

```yaml
my-reporter:
  enabled: true                       # gates both scheduling and manual run
  purpose: "One-line description of what this reporter prints."
  schedule: "50 7 * * *"              # cron (household TZ); SSOT — surfaced to scheduler

  sources:                            # 1..N; gathered in PARALLEL, items merged
    - type: http                      # http (built) | rss | harvester | agent (stubbed)
      id: matches                     # used for per-source item counts in history
      url: "https://api.example.com/results?date={{yesterday}}"
      jsonPath: "$.events"            # optional `$.a.b` dot-path pluck; omit to use whole body
      # auth_ref: some-secret         # optional secret ref for authenticated sources

  consolidate:
    model: "openai/gpt-4o"            # optional; omit to use the framework default LLM
    prompt: |
      System prompt for the editor persona. Receives the merged source items as
      a JSON array. MUST return ONLY a JSON object { "sections": [ ... ] }
      (no prose, no code fences). Return { "sections": [] } for an empty report.

  sinks:                              # 1..M output targets, independent
    - type: printer                   # printer (built); others stubbed
      printer: upstairs               # ThermalPrinterRegistry name; omit => default printer
      template:
        header: "⚽  WORLD CUP"        # large bold centered banner
        divider: true                 # horizontal rule under the header
        footer: "daylight · {{date}}" # centered footer (placeholders resolved)
        autoCut: true                 # cut paper after print (default true)

  on_empty: skip                      # skip (default). Documented; only `skip` implemented.
  on_error: log                       # log (default). Documented; only `log` implemented.
```

### Placeholders

Resolved by the framework in the **household timezone** before source fetch and
template render — reporters never compute dates themselves (avoids TZ traps).

| Token           | Value (calendar date, `YYYY-MM-DD`) |
|-----------------|-------------------------------------|
| `{{today}}`     | The reference day (now, or the `--date` override). |
| `{{yesterday}}` | Reference day − 1. |
| `{{date}}`      | Same as `{{today}}`. |

Placeholders are deep-walked through every string in `sources` and `sinks`
blocks (so `url`, `footer`, etc. all resolve).

## Sources

A source implements `ISource.gather(ctx) → { items: any[], meta }`. `items = []`
means "contributed nothing" (NOT an error); a `throw` is a real failure that
records `error` and skips printing. `ctx.config` is the source's YAML block with
placeholders already resolved.

| Type        | Status  | Adapter |
|-------------|---------|---------|
| `http`      | built   | `1_adapters/newsreporter/sources/HttpSourceAdapter.mjs` |
| `rss`       | stub    | `RssSourceAdapter.mjs` (throws on `gather`) |
| `harvester` | stub    | `HarvesterSourceAdapter.mjs` (throws on `gather`) |
| `agent`     | stub    | `AgentSourceAdapter.mjs` (throws on `gather`) |

**HttpSourceAdapter:** GETs `cfg.url`; optional `jsonPath` (`$.a.b`) pluck; returns
`{ items }` (empty array on `null`/`[]` payload, single-element array on a non-array
object). Throws `InfrastructureError` on non-2xx/transport failure. Stubs throw so a
misconfigured reporter fails loudly (recorded as `error`).

### Adding a source type

1. Implement `ISource` (`3_applications/newsreporter/ports/ISource.mjs`) in a new
   adapter under `1_adapters/newsreporter/sources/`. Wrap external calls so "no
   data" (`[]`) stays distinct from "failure" (throw).
2. Register it in `createSourceRegistry` (`sources/sourceRegistry.mjs`) under its
   `type` key. Unknown types throw a `ValidationError` at `create()`.

## Sinks & rendering

A sink implements `ISink.emit(sections, cfg, ctx) → { status, detail? }`. Sinks are
independent: one failing sink does not abort siblings.

| Type      | Status | Glue |
|-----------|--------|------|
| `printer` | built  | `3_applications/newsreporter/sinks/PrinterSink.mjs` |

**PrinterSink** (3_app glue — the only layer allowed to import both `1_rendering`
and the printer adapter):

```
emit(sections, cfg, ctx):
  job = ReportReceiptRenderer.render(sections, cfg.template, ctx)   # 1_rendering
  if ctx.dryRun: return { status:'ok', detail:{ preview: renderer.renderText(...) } }
  printer = printerRegistry.resolve(ctx.printerOverride ?? cfg.printer)
  ok = await printer.print(job)
  return { status: ok ? 'ok' : 'error' }
```

**ReportReceiptRenderer** (`1_rendering/newsreporter/ReportReceiptRenderer.mjs`,
pure — no I/O, no `1_adapters` import) maps sections → a `PrintJob` POJO
(`{ items: PrintItem[], footer: { paddingLines, autoCut } }`). It is the single
owner of layout: tables are pre-expanded into fixed-width text rows (mirroring the
printer adapter's column math) at the default width of 48. `renderText()` produces
a plain-text approximation for `--dry-run` previews.

### Adding a sink type

1. Implement `ISink` (`ports/ISink.mjs`); never throw for "nothing to show".
2. Register it in `createSinkRegistry` (`sinks/sinkRegistry.mjs`) under its `type`.

## Section schema (the LLM contract)

The consolidator must emit — and zod-validates against
(`3_applications/newsreporter/reportSchema.mjs`) — an ordered list of typed
sections:

```js
{ sections: [
    { type: 'heading', text: string },
    { type: 'lines',   lines: [string] },
    { type: 'table',   headers: [string], rows: [[string]] },
    { type: 'note',    text: string },
] }
```

An empty `sections: []` is honored as `empty` (nothing printed). The Consolidator
appends a strict "respond ONLY with JSON matching this shape" instruction, strips
code fences, parses, and validates. It retries **once** on a parse/validation
failure, then records `error`.

## Scheduler integration

Reporters surface as scheduler jobs without duplicating cron in `jobs.yml`:

1. **`NewsReporterJobDatastore`** (`1_adapters/newsreporter/`) reads the
   `newsreporter` config and synthesizes one `Job` per enabled reporter
   (`id = reporterId`, `name = newsreporter:<id>`, `schedule` from the reporter,
   `timeout = 120s`, `bucket = newsreporter`). It also exposes `reporterIds() →
   Set<string>` (re-read each call, so new reporters register without a restart).
2. **`CompositeJobDatastore`** (`1_adapters/scheduling/`) concatenates the canonical
   `YamlJobDatastore` jobs with the synthesized reporter jobs. Order is
   `[yaml, newsreporter]`, so on a duplicate id the **jobs.yml entry wins** and a
   `scheduler.jobStore.id_collision` warning is logged. The orchestrator keeps
   calling `loadJobs()` unchanged (dependency checks, missed-run handling,
   `nextRun` all come for free).
3. **`NewsReporterJobExecutor`** (`3_applications/newsreporter/`) is added to
   `SchedulerOrchestrator` ahead of the harvester/media executors:
   `canHandle(jobId) → reporterIds.has(jobId)`; `execute(jobId) →
   NewsReporterService.run(jobId)`. It rethrows on failure so the scheduler records
   the job as failed.
4. **Wiring:** `NewsReporterContainer.build({ configService, agentRuntime,
   printerRegistry, dataService, logger })` is the composition root — it builds the
   renderer, source/sink registries, consolidator, history store, service, job
   datastore, and executor, and is wired into `app.mjs` near the scheduler
   bootstrap.

## Manual run: endpoint + CLI

The reporter service is already wired into the running app, so ad-hoc triggers
drive a thin HTTP endpoint rather than reconstructing services.

**Endpoint** (`4_api/v1/routers/newsreporter.mjs`):

```
POST /api/v1/newsreporter/:id/run
body: { date?, printer?, dryRun?, force? }
→ NewsReporterService.run(id, overrides)
200 → { status, sourceCounts, sinkResults, sections?, preview? }
404 → unknown/disabled reporter (EntityNotFoundError)
```

`run(reporterId, overrides = {})` — `{}` is exact scheduled behavior. Overrides:

| Override               | Effect |
|------------------------|--------|
| `date: "2026-06-20"`   | Resolve `{{yesterday}}`/`{{date}}` against this day (backfill/replay). |
| `printer: "downstairs"`| Override every printer sink's target. |
| `dryRun: true`         | Gather + consolidate + render, but return the receipt text instead of printing. |
| `force: true`          | Bypass `on_empty: skip` (pair with `dryRun` to see rendered output even when empty). |

**CLI** (`cli/newsreporter.cli.mjs`) POSTs to the endpoint (works locally or via
`docker exec`/ssh against a deployed app):

```
node cli/newsreporter.cli.mjs <reporter-id> [options]
  --date <YYYY-MM-DD>   run for a specific day
  --printer <name>      override printer sink target
  --dry-run             render to stdout, no paper
  --force               ignore on_empty:skip
  --base-url <url>      default $DAYLIGHT_BASE_URL or http://localhost:<app-port>
  -h, --help

# preview without printing:
node cli/newsreporter.cli.mjs world-cup-reporter --dry-run --force
# re-print a past day to a test printer:
node cli/newsreporter.cli.mjs world-cup-reporter --date 2026-06-19 --printer downstairs
```

The CLI prints the returned `status` + `sourceCounts`, plus the rendered receipt
text on `--dry-run`. It exits non-zero on HTTP error or `status === 'error'`.

## Run history & observability

**History** (`1_adapters/persistence/yaml/YamlReportRunDatastore.mjs`) writes one
file per reporter per day:

```
data/household/history/newsreporter/{reporterId}/{date}.yml
  = { startedAt, status, sourceCounts, sinkResults, error }
```

The `{date}` is the calendar date of `startedAt`. Recording never throws into the
run path — a write failure logs `newsreporter.history.write_failed` and is
swallowed.

**Structured log events** (all via the injected logger):

| Event | When |
|-------|------|
| `newsreporter.run.start` / `newsreporter.run.complete` | Run boundaries. |
| `newsreporter.source.fetch` | Per HTTP source, with `itemCount`. |
| `newsreporter.consolidate.parse_retry` | LLM output failed validation; retrying. |
| `newsreporter.run.empty` | No source items, or no sections. |
| `newsreporter.run.error` | A source threw or consolidation failed. |
| `newsreporter.sink.emit` / `newsreporter.sink.error` | Per-sink outcome. |
| `newsreporter.executor.start` / `.complete` / `.error` | Scheduler dispatch. |
| `newsreporter.api.run` / `.not_found` | Manual-run endpoint. |
| `scheduler.jobStore.newsreporter_loaded` / `scheduler.jobStore.id_collision` | Job surfacing / collision. |

## File map

```
backend/src/3_applications/newsreporter/
  NewsReporterService.mjs        # orchestration core
  NewsReporterContainer.mjs      # composition root (app wiring)
  NewsReporterJobExecutor.mjs    # scheduler bridge
  Consolidator.mjs               # LLM step + one-retry validation
  reportSchema.mjs               # zod sections schema (published language)
  ports/{ISource,ISink,IReportRunHistory}.mjs
  sinks/{PrinterSink,sinkRegistry}.mjs
  placeholders.mjs               # TZ-aware {{date}} resolver

backend/src/1_rendering/newsreporter/
  ReportReceiptRenderer.mjs      # pure: sections → PrintJob

backend/src/1_adapters/newsreporter/
  sources/{HttpSourceAdapter, RssSourceAdapter, HarvesterSourceAdapter,
           AgentSourceAdapter, sourceRegistry}.mjs
  NewsReporterJobDatastore.mjs   # reporters → scheduler Jobs
backend/src/1_adapters/scheduling/CompositeJobDatastore.mjs
backend/src/1_adapters/persistence/yaml/YamlReportRunDatastore.mjs

backend/src/4_api/v1/routers/newsreporter.mjs   # manual-run endpoint
cli/newsreporter.cli.mjs                          # ad-hoc trigger
data/household/config/newsreporter.yml            # reporter configs (gitignored data)
```

## Example: world-cup-reporter

The shipped `world-cup-reporter` prints yesterday's FIFA World Cup 2026 results at
07:50 daily. Its source is TheSportsDB's keyless `eventsday` endpoint
(`.../eventsday.php?d={{yesterday}}&s=Soccer`, `jsonPath: $.events`), which returns
all soccer events for the day; the consolidate prompt filters to
`strLeague == "FIFA World Cup"` and emits a `heading` + a `Match | Score` table,
returning `{ sections: [] }` when no World Cup matches were played. `on_empty: skip`
means no-match mornings print nothing. (The data-path config carries TheSportsDB's
public test API key, which is fine — `data/` is gitignored and not committed.)
