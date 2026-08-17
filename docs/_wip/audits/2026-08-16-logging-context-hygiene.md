# Logging Context Hygiene Audit — 2026-08-16

Ahead of routing the general event stream into a queryable log store, five
parallel sweeps audited every logging call site in the repo against one
question: **once these events land in a database, can they be filtered by
subsystem?**

The grouping keys are `context.source`, `context.app`, and
`context.module`/`context.component`. An event missing them is not merely
untidy — it is unfindable.

**Verdict: the framework is sound; the call sites are not.** The store will
work, but a large share of events would arrive uncategorized.

---

## The one defect that matters most

**~690 call sites default an injected logger to raw `console`.**

```javascript
constructor({ logger = console }) { ... }      // or: deps.logger || console
```

| Layer | `logger = console` | `logger \|\| console` |
|-------|--------------------|-----------------------|
| `1_adapters` | 215 of 416 files (52%) | included |
| `3_applications` | 289 sites / 272 files | included |
| `4_api` | 98 | 5 |
| `5_composition` | 59 | 2 |
| `0_system` (excl. `logging/`) | 4 | 6 |
| `1_rendering` | 4 | 1 |
| `2_domains` | 0 | 3 |
| `cli` | 8 | 0 |

In production most of these *are* injected correctly from the composition root,
so this is a latent defect rather than an active one. But the failure mode is
silent: any wiring gap drops that class to raw `console`, which has **no
`source`, no `app`, no `module`, and never reaches the dispatcher at all**. It
cannot appear in the log store, and nothing reports that it went missing.

Largest concentrations: `school/` (52), `nutribot/` (32), `fitness/` (23),
`journalist/` (21).

**Recommendation:** replace the `console` default with a no-op logger, or make
the parameter required. Two files already model this — `emulator/` uses
`NOOP_LOGGER`. A no-op loses the line; `console` loses the line *and* pretends
it didn't.

---

## Backend: almost nothing is scoped

- `1_adapters`: **zero** `createLogger()` calls and **zero** `.child()` calls
  across 416 files. Adapters only ever receive an injected logger.
- `3_applications`: exactly **one** file calls `.child()`
  (`home/EventAggregationService.mjs` — the model to copy).
- All 11 live `createLogger()` sites build a base context with **no**
  `module`/`component` key.

Consequence: every class inside one `app` — all of `school/usecases/*`, say —
is indistinguishable from its siblings. Filtering can reach the app, then stops.

### `source` is wrong for scheduled and inbound work

| Entry point | Reports | Should be |
|---|---|---|
| `0_system/scheduling/Scheduler.mjs` | `backend` | `cron` |
| Agents `Scheduler` (`bootstrap.mjs:2449`), driving 10 tasks | `backend` / `module:agents-api` | `cron` + own module |
| Telegram webhook routers (`homebot`, `nutribot`, `journalist`) | `backend` | `webhook` |
| `cli/*.cli.mjs` batch scripts | none | `cli` |

Scheduled task output is currently indistinguishable from HTTP request traffic.

### Inconsistent `(source, app)` pairs for one subsystem

Four HTTP middleware files disagree with each other:

| File | Current |
|---|---|
| `middleware/idempotency.mjs:11` | `source:'middleware', app:'http'` |
| `middleware/validation.mjs:12` | `source:'middleware', app:'http'` |
| `middleware/errorHandler.mjs:18` | `source:'middleware', app:'http'` |
| `middleware/requestLogger.mjs:21` | **reversed** — `source:'http', app:'middleware'` |
| `http/httpClient.mjs:18` | `source:'backend', app:'http'` |

`source` should be one of `backend`/`frontend`/`cron`/`webhook`; a module name
there fragments the subsystem across buckets. Also
`0_system/users/UserResolver.mjs:29` uses `source:'user-resolver'`.

---

## Frontend: attribution is structurally broken

### Two parallel logging singletons

| Entry | Default base context | Files importing |
|---|---|---|
| `lib/logging/Logger.js` (`getLogger`) — the CLAUDE.md-documented one | `{}` — **no default `app`** | 264 |
| `lib/logging/singleton.js` (`getChildLogger`) | `{ app: 'daylight-frontend' }` | 45 |

They do not communicate. Piano, Fitness, Player, Admin and Media all use **both**,
so identical-looking `component` values land in different `app` buckets
depending on which import a file happened to pick.

### Only three apps set `app` globally

`configure()` on `Logger.js` is what makes every independently-created
descendant logger inherit an `app`. Only **Fitness, Piano, Feed** do it.

| Entry point | `app` | `sessionLog` |
|---|---|---|
| FitnessApp, PianoApp, FeedApp | global ✅ | ✅ |
| LifeApp | global (via the *other* system) | ✅ |
| AdminApp, FinanceApp, HealthApp, HomeApp, RootApp | local instance only ❌ | ❌ |
| AutoApp, GameDemoApp, GamingApp, LiveStreamApp, MediaApp | none ❌ | ❌ |
| CallApp | `.child({component})`, no `app` ❌ | ❌ |

"Local instance only" means hooks that call `getLogger()` themselves inherit
nothing — verified at `hooks/admin/useAdminAgents.js:16`.

### Stale `app` leaks between routes

`configure()` shallow-merges and **never clears keys**; unmount cleanups reset
only `sessionLog`, never `app`. So `screen-framework/` (~30 files, otherwise
excellent `component` hygiene, no baseline `app` of its own) inherits whatever
`app` the last-visited Fitness/Piano/Feed route left behind. **Events can be
attributed to the wrong subsystem** — worse than being unattributed.

### A first-render race, already solved once

`FitnessApp.jsx:97-104` calls `configureLogger` in a `useEffect`, which fires
*after* descendants' first-render `useMemo` loggers snapshot the context.
`PianoApp.jsx:473-490` documents this exact problem and fixes it by calling
during render in `useMemo`. Fitness should copy Piano.

### 13 of 35 module directories collapse into `'frontend'`

Auto, Displayer, Emulator, Feed*, Feedback, GameShow, Health, Input, Life*,
MusicNotation, School, VoiceCapture (58 logger sites).
(*Feed/Life set `app` at the app level but individual modules do not.)

| Module | Sites | Sets `app`? | Distinct component names |
|---|---|---|---|
| Piano | 121 | **4 of 121** | 91 |
| Fitness | 54 | 1 of 54 | 49 |
| Admin | 36 | 8 | 19 |
| Player | 22 | 1 | 20 |
| Input | 13 | 0 | 13 |
| Emulator | 11 | 0 | 10 |

Piano is the sharpest case: 121 sites, 91 component names, and a filter on
`app = "piano"` would miss ~117 of them.

### Fitness has no durable session logging

54 sites, 49 components, and **`sessionLog` is never set anywhere** — the
largest logging surface in the frontend is stdout-only and dies on restart.

---

## Raw `console.*` violations

Project rule: never raw console for diagnostics; the allowed exception is
pre-existing `console.error` inside `.catch()`.

| Area | Real violations |
|---|---|
| `frontend/src/services/` | 14 — **100% raw**, incl. `WebSocketService.js` (13 sites) |
| `frontend/src/hooks/` | 31 |
| `frontend/src/modules/` | 27 (+2 non-`error` calls inside `.catch()`) |
| `frontend/src/contexts/` | 3 — 100% raw |
| `0_system` (excl. logging) | 17 |
| `4_api` | 12 |
| `1_adapters` | 9 files with **no logger DI at all** |

Worst single files: `Health/NutritionDay.jsx` (14), `Health/Nutrition.jsx` (8),
`services/WebSocketService.js` (13).

`WebSocketService.js` needs care — it is the transport the WS log shipper itself
depends on, so routing it through the framework risks circularity. It likely
needs a console-only fallback logger rather than the full framework.

### Silent subsystems (no logging of any kind)

`1_adapters`: `lifeplan/`, `glossika/`, `schoolcalc/` (21 files).
`3_applications`: `canvas/`, `journaling/`, `gratitude/` (12 files).

---

## Naming inconsistency

- **Casing**: `Input/` and `Life/` use camelCase hook names (`useAudioProbe`);
  Piano/Admin/Emulator/School use kebab-case; `Fitness/` mixes PascalCase
  (`FitnessPlayer`) and kebab-case (`audio-cue-player`) in one directory.
- **Key name**: `component:` (most), `hook:` (`hooks/admin/*`, 7 files),
  `module:` (`FeedApp`), `router:` (`life/now|plan|log.mjs`),
  `channel:` (`Player/lib/playbackLogger.js`). Only `component`/`module` group.
- **Collision risk**: Piano `composer` (notation editor) vs `piano-composers`
  (browse-by-composer). A search for "composer" conflates two unrelated features.
- **Event names**: mostly good dotted vocabulary. Exceptions —
  `economy/EconomyService.mjs` uses hyphens (`economy-deposit`), and
  `content/services/ProgressSyncService.mjs:222` passes a prose template string
  as the event name *and* `err.message` as a bare string in the data slot,
  breaking the `(event, dataObject)` signature.

---

## Broken code found in passing

`cli/clickup.cli.mjs:32` imports `createLogger` from
`../backend/lib/logging/logger.js` — that path no longer exists. The file
throws `MODULE_NOT_FOUND` on import and cannot run. It also uses 45 prose event
names. Fix the import or delete it.

---

## Recommended order

Highest leverage first; the first three fix most of the categorization loss.

1. **Baseline `app` per frontend entry point**, set during render as PianoApp
   does, and **clear `app` on unmount** to stop the stale-leak. Fixes 13 module
   directories and the mis-attribution risk at once.
2. **Fix `source`** for the two Schedulers (`cron`) and the webhook routers
   (`webhook`). Small, isolated, high value.
3. **Replace the `console` default with a no-op** across the ~690 sites —
   mechanical, and converts a silent failure into a visible one.
4. Converge the two frontend logging singletons on one.
5. Add `sessionLog` to Fitness.
6. Add `.child({ module })` at adapter/use-case construction in the composition
   root, so the ~690 injected loggers arrive pre-scoped. Doing this at the
   composition root is far cheaper than editing every class.
7. Clean up the raw-console violations, starting with `services/`.
8. Settle one casing convention and one key name (`component`).

Item 6 is the structural one: because adapters and use cases only *receive*
loggers, scoping them is a composition-root change, not a 690-file change.
