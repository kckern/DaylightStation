# NewsReporter Framework

> Bounded context: `newsreporter` — config-driven, scheduled, LLM-generated reports.
> Current as of: 2026-11-23 (edition reporters added).

## What it is

A *reporter* is a declarative pipeline that runs on a schedule:

```
gather (N sources)  →  consolidate (LLM)  →  render + emit (M sinks)
```

Each reporter is a key in `data/household/newsreporter/config.yml`. Sources and
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

`data/household/newsreporter/config.yml` — each top-level key is a reporter id
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
| `http`      | built   | `server/adapters/sources/HttpSourceAdapter.mjs` |
| `rss`       | stub    | `RssSourceAdapter.mjs` (throws on `gather`) |
| `harvester` | stub    | `HarvesterSourceAdapter.mjs` (throws on `gather`) |
| `agent`     | stub    | `AgentSourceAdapter.mjs` (throws on `gather`) |

**HttpSourceAdapter:** GETs `cfg.url`; optional `jsonPath` (`$.a.b`) pluck; returns
`{ items }` (empty array on `null`/`[]` payload, single-element array on a non-array
object). Throws `InfrastructureError` on non-2xx/transport failure. Stubs throw so a
misconfigured reporter fails loudly (recorded as `error`).

### Adding a source type

1. Implement `ISource` (`server/application/ports/ISource.mjs`) in a new
   adapter under `server/adapters/sources/`. Wrap external calls so "no
   data" (`[]`) stays distinct from "failure" (throw).
2. Register it in `createSourceRegistry` (`sources/sourceRegistry.mjs`) under its
   `type` key. Unknown types throw a `ValidationError` at `create()`.

## Sinks & rendering

A sink implements `ISink.emit(sections, cfg, ctx) → { status, detail? }`. Sinks are
independent: one failing sink does not abort siblings.

| Type      | Status | Glue |
|-----------|--------|------|
| `printer` | built  | `server/application/sinks/PrinterSink.mjs` |

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

**ReportReceiptRenderer** (`server/rendering/ReportReceiptRenderer.mjs`,
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
(`server/application/reportSchema.mjs`) — an ordered list of typed
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

1. **`NewsReporterJobDatastore`** (`server/adapters/`) reads the
   `newsreporter` config and synthesizes one `Job` per enabled reporter
   (`id = reporterId`, `name = newsreporter:<id>`, `schedule` from the reporter,
   `timeout = 120s`, 600s for an edition reporter, `bucket = newsreporter`). It also exposes `reporterIds() →
   Set<string>` (re-read each call, so new reporters register without a restart).
2. **`CompositeJobDatastore`** (`1_adapters/scheduling/`) concatenates the canonical
   `YamlJobDatastore` jobs with the synthesized reporter jobs. Order is
   `[yaml, newsreporter]`, so on a duplicate id the **jobs.yml entry wins** and a
   `scheduler.jobStore.id_collision` warning is logged. The orchestrator keeps
   calling `loadJobs()` unchanged (dependency checks, missed-run handling,
   `nextRun` all come for free).
3. **`NewsReporterJobExecutor`** (`server/application/`) is added to
   `SchedulerOrchestrator` ahead of the harvester/media executors:
   `canHandle(jobId) → reporterIds.has(jobId)`; `execute(jobId) →
   NewsReporterService.run(jobId)`. It rethrows on failure so the scheduler records
   the job as failed.
4. **Wiring:** `createNewsReporterServices` (`server/composition.mjs`, re-exported
   by `5_composition/bootstrap.mjs`) builds the adapters and renderers and hands
   them to `NewsReporterContainer.build`, which builds the consolidator, sink
   registry, service, edition service, executor and reporter directory. `app.mjs`
   calls it near the scheduler bootstrap. An edition reporter's job runs
   `NewsReporterService.run`, which delegates to `EditionService.compose`.

## Manual run: endpoint + CLI

The reporter service is already wired into the running app, so ad-hoc triggers
drive a thin HTTP endpoint rather than reconstructing services.

**Endpoint** (`server/api/newsreporter.mjs`):

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
__app_modules/media/newsreporter/
  server/composition.mjs                 # composition root: adapters, renderers, container
  server/api/newsreporter.mjs            # router: /run + edition routes
  server/application/
    NewsReporterService.mjs              # report pipeline (delegates edition runs to compose)
    NewsReporterContainer.mjs            # wires services, executor, reporter directory
    NewsReporterJobExecutor.mjs          # scheduler bridge
    Consolidator.mjs                     # report LLM step + one-retry validation
    reportSchema.mjs                     # zod sections schema (published language)
    placeholders.mjs                     # TZ-aware {{date}} resolver
    EditionService.mjs                   # edition compose / deliver / reads
    edition/
      editionConfig.mjs                  # edition config schema + source/page check
      editionSelect.mjs                  # candidates, dedupe, module plan + rotation
      decisionPick.mjs                   # per-story pick on the decision gateway
      editionContracts.mjs               # zod pick/write contracts + checks
      editionPrompts.mjs                 # pick (fallback) and write prompts, word budget
      structuredCall.mjs                 # chatStructured + zod + one corrective retry
      editionGather.mjs                  # headlines, day modules, article reads
      editionLayout.mjs                  # layout contract + fit drop order
      editionTime.mjs                    # household-local dates, seeded PRNG
    ports/{ISource,ISink,IReportRunHistory,IEditionStore}.mjs
    sinks/{PrinterSink,sinkRegistry}.mjs
  server/rendering/
    ReportReceiptRenderer.mjs            # pure: sections → PrintJob
    NewspaperRenderer.mjs                # pure: edition layout → 576-dot canvas
  server/adapters/
    NewsReporterConfigProjection.mjs     # reporter config + household TZ
    NewsReporterJobDatastore.mjs         # reporters → scheduler Jobs
    sources/{HttpSourceAdapter, RssSourceAdapter, HarvesterSourceAdapter,
             AgentSourceAdapter, sourceRegistry}.mjs
    persistence/YamlReportRunDatastore.mjs
    persistence/YamlEditionDatastore.mjs # edition records + PNGs
  cli/newsreporter.cli.mjs               # ad-hoc trigger (cli/newsreporter.cli.mjs re-exports it)
__backend/src/1_adapters/scheduling/CompositeJobDatastore.mjs
data/household/newsreporter/config.yml   # reporter configs (data tree, not in git)
data/household/newsreporter/editions/<id>/<date>.yml   # edition records
<media>/newsreporter/<id>/<date>.png                   # edition images
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

## Edition reporters (the office paper)

A reporter with `kind: edition` is a different pipeline: a one-page newspaper
composed each morning, rendered to a PNG, held, and printed once when delivery
is triggered (Home Assistant's office arrival automation, the newsstand page at
`/feed/paper`, or the CLI). The `report` kind above is unchanged; the two kinds
share the config file, the scheduler surfacing and the router.

### Config

```yaml
office-paper:
  enabled: true
  kind: edition
  title: "The Daylight Ledger"
  tagline: "optional line under the masthead"
  schedule: "30 5 * * *"          # COMPOSE time (household TZ); delivery is separate
  deliver:
    printer: office
    fallback: false               # true → the registry's routed printer (may print elsewhere)
    once_per_day: true
    expires_after: "12:00"        # no unforced print after this local time
  length: { target_cm: 50, max_cm: 60 }
  model: null                     # write-step model; null → gateway default
  voice: |
    Wry, plain-spoken morning paper. ...
  news:
    user: <username>              # whose feed.yml headline pages to read
    pages: [mainstream]           # headline page ids; omit for all
    max_age_hours: 18
    dedupe_editions: 3
    lead: { enabled: true, sentences: 4 }
    categories:
      - { id: us, label: Nation, topic: "...", stories: 3, balance: lean }
      - { id: tech, label: Technology, sources: [arstechnica, bbc], stories: 2 }
      - { id: local, label: Utah, sources: [ksl], stories: 2, optional: true }
  day:
    weather:    { show: always }
    calendar:   { show: always, max: 5 }
    todoist:    { show: always, max: 4 }
    yesterday:  { show: rotate, weight: 2, parts: [strava, health] }
    school:     { show: weekdays }
    reflective: { show: rotate, weight: 1, parts: [immich, journal, gratitude] }
    rotation:   { slots: 1 }
```

`show` is `always | weekdays | weekends | rotate | when_notable | never`.
`rotate` modules are drawn into `rotation.slots`, weighted, seeded by the
reporter id and date (a recompose draws the same), never repeating a module the
previous edition carried. `when_notable` keeps a module only when its gatherer
flags it: weather on a freeze (low ≤ 32 °F), heat (high ≥ 95 °F) or a wet day
(≥ 60 % of the day's hours with precipitation); todoist when anything is
overdue.

The config is validated with zod when an edition reporter is used (unknown keys
and modules, bad policies, repeated category ids, a bad expiry). The error is a
`ValidationError` naming the key, e.g. `news.categories[2].id: category id "us"
repeats`. Page and source ids are checked against the feed right after the
headlines are read, before any model call.

### Compose

```
gather → select → pick (decisions) → read → write (LLM) → layout → fit → store
```

1. **Gather**, in parallel: every configured headline page
   (`HeadlineService.getAllHeadlines`) and the day modules: weather, todoist,
   strava, health, immich, journal and gratitude through the feed's source
   adapters (`fetchItems`); the calendar from the user's `current/calendar`
   (today, plus the next two days when today has fewer than two events); school
   from `SchoolParentDigest.summarize` for the latest earlier day that asked for
   work. Each module has a 15 s timeout; one that fails is left out and listed
   in `inputs.missing`. Headlines failing fails the compose.
2. **Select** (code): age filter, undated items dropped, de-duplication within
   the feed and against the previous `dedupe_editions` editions (canonical URL,
   then normalized title), newest first, capped at 250. Candidates get short ids
   (`h1`…) for the models.
3. **Pick** on the typed-decision gateway (Jev, `IDecisionGateway`). One unit
   per story: each briefing cluster, plus each remaining single headline. Each
   unit gets one `evaluate` with two questions: `category`, a choice over the
   categories it is eligible for (its sources pass `sources` / `exclude`) plus
   `none`; and `interest`, a five-level score (routine, minor, notable, major,
   historic). Value = score + 0.15 per extra outlet (at most +0.6). A unit joins
   its category unless `none` has the largest probability. The lead is the
   highest-valued unit with two or more outlets (any unit if none has), taken
   out of its category; each category keeps its top `stories`, and
   `balance: lean` breaks ties toward coverage spanning more grid columns.
   `confidence` is not used. Concurrency 8, 20 s per call; a failed unit is
   skipped and counted. When the decision gateway is missing or unconfigured,
   or more than half the calls fail, the pick falls back to one
   `chatStructured` call (zod-checked, one corrective retry, unknown ids
   dropped). The edition records `inputs.pick = { method: 'decision'|'chat',
   units, failed }`, and each stored story its `interest`.
4. **Read**: the first two article URLs of each picked story through the feed's
   `WebContentAdapter.extractReadableContent`, 8 s each, 6 at a time, 6,000
   characters kept. A story with no readable text is written short (`thin`).
5. **Write** (`IAIGateway.chatStructured`, zod contract, one corrective retry):
   lead, sections, optional briefs and the day notes. The word budget comes
   from `length.target_cm`. Stories may cite only picked ids.
6. **Layout** (code): masthead, the "Your day" box (weather | agenda, tasks),
   lead, sections in config order, briefs, notes (yesterday, school,
   reflective), footer. A module the writer gave no note for gets the code's
   own line.
7. **Fit** (code): measure; while over `max_cm` drop briefs, then the
   lowest-ranked story of the section with the most stories, then optional
   sections, then notes, tasks and trailing sections. The masthead, weather,
   agenda and lead are never dropped. A page that still overflows prints long
   (`fit.overflow`, logged).
8. **Store**: the record at `data/household/newsreporter/editions/<id>/<date>.yml`
   and the image at `<media>/newsreporter/<id>/<date>.png`. `number` is the
   previous edition's plus one and is kept on a recompose, which also keeps the
   day's deliveries. A failed compose records `status: failed` only when the day
   has no good edition.

Both gateways are scoped `{ app: 'newsreporter', feature: 'office-paper' }`.
`costUsd` is the sum of the AI usage ledger's rows for that app and feature
during the compose (null when the ledger has none). Timeouts go through the
injected `IApplicationScheduler`.

`NewspaperRenderer` is pure node-canvas, 576 dots wide (72 mm at 8 dots/mm, so
80 dots per cm), Roboto Condensed Regular and SemiBold from
`__backend/assets/fonts/roboto-condensed/`, black on white.

### Deliver

`deliver` prints the stored PNG as one `{ type: 'image', width: 576 }` item (the
printer adapter rotates it for upside-down printers) with the text transcript
attached, on `printerRegistry.get(printer)` (unrouted) unless
`deliver.fallback: true`. Deliveries are serialized per reporter. It always
answers HTTP 200 with a status:

| Status | Meaning |
|---|---|
| `printed` | Printed and recorded in `deliveries[]` (`{ at, printer, trigger, confirmed }`). |
| `already_delivered` | `once_per_day` and already printed; nothing printed unless `force`. |
| `expired` | Past `expires_after` (or a past day) and not forced. |
| `composed_then_printed` | No good edition existed; composed now, then printed. |
| `print_failed` | The printer refused, faulted or is unknown; the edition stays undelivered so a later deliver retries. |
| `compose_failed` | No edition existed and composing it failed; nothing printed. |

### API

| Route | Does |
|---|---|
| `GET /api/v1/newsreporter/` | bare array `[{ id, kind, title, enabled }]` |
| `GET /:id/editions?limit=30` | bare array of `{ date, number, status, composedAt, deliveredAt, printer, costUsd, leadHeadline, missing }`, newest first |
| `GET /:id/editions/:date` | the full record (layout, inputs, stories `[{ ids, urls, titles, … }]`, deliveries); 404 when none |
| `GET /:id/editions/:date/image.png` | the stored PNG |
| `POST /:id/compose` `{ date?, dryRun? }` | `{ status, edition }`; a dry run stores nothing and adds `png` (base64, no `data:` prefix) |
| `POST /:id/deliver` `{ date?, printer?, force?, trigger? }` | `{ status, edition }` (statuses above) |
| `GET /:id/printers` | bare array of printer names |
| `POST /:id/run` | for an edition reporter: compose |

`date` defaults to today in the household timezone. An unknown, disabled or
report-kind id on an edition route is a 404.

### CLI

```
node cli/newsreporter.cli.mjs office-paper --compose --dry-run --out /tmp/paper.png
node cli/newsreporter.cli.mjs office-paper --compose            # real compose; --out fetches the stored image
node cli/newsreporter.cli.mjs office-paper --deliver [--printer upstairs] [--force] [--date YYYY-MM-DD]
```

### Logs

`newsreporter.edition.compose.start|complete|error`, `.gather.module_failed`,
`.pick.unit_failed|fallback|unknown_ids|balance|complete`, `.read.failed`,
`.write.dropped`, `.fit.dropped|overflow`, `.deliver.printed|skipped|failed`,
`.cost.unavailable`, each with `reporterId` and `date`.
