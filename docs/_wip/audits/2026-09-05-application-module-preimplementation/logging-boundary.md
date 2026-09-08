# Server logging boundary — selected design and native fixture evidence

[logging-boundary.json](logging-boundary.json) specifies three unchanged body
moves, four narrow entries, 37 incoming-edge dispositions and 32 exact edit
groups across 27 existing files. All implementation files remain platform-owned,
server-runtime, system-layer code with no domain context/rank. This is not a
browser/server logger unification, new SDK or logging behavior redesign.

## Exact owner and export choices

Move `logger.mjs`, `dispatcher.mjs` and `localTimestamp.mjs` from
`backend/src/0_system/logging/` to `platform/server/system/logging/`, preserving
their bodies, filenames, relative imports and all private named/default exports.

Entries below have the prefix `@daylight/platform/server/system/logging/`:

| Entry suffix | Public names | Permitted consumers |
|---|---|---|
| `logger` | `createLogger` | Runtime, subject to system-layer rules |
| `dispatcher` | `getDispatcher`, `isLoggingInitialized`, `initializeLogging` | Runtime, subject to system-layer rules |
| `local-timestamp` | `formatLocalTimestamp` | Runtime, subject to system-layer rules |
| `testing` | `LogDispatcher`, `LEVEL_PRIORITY`, `resetLogging` | Tests only |

The four facade paths are `platform/public/server/system/logging/<suffix>.mjs`.
Both dispatcher-related facades forward the **same** private
`@daylight-internal/platform--server/system/logging/dispatcher` entry. There is
no second dispatcher implementation or private testing module. The other two
private entries map to their original leaf basenames. Exact facet manifest
export/dependency fragments and facade bytes/hashes are in the specification.

The public `testing` entry is a usage restriction, not another executable layer.
Keep its system classification, identify the facade as test support, and reject
production imports/re-exports through it in the future semantic checker. Do not
mark the whole dispatcher implementation test-only: runtime code internally uses
its class and priority table. Node exports by themselves cannot prevent a runtime
caller from importing the testing subpath. No NODE_ENV switch or private-import
exception is introduced to approximate that policy.

Five existing dispatcher test imports split into runtime and test-only imports:
API status, dispatcher, ingestion, logger and session-file suites. Preserve every
local binding and assertion; no case moves or fixture widening. Five same-facet
relative links stay unchanged, including the two HTTP module-created loggers.
Thirty source import groups change, plus two spelling-only links in `CLAUDE.md`
and `ScanIngressCoordinator.mjs`. Neither existing file is edited in preparation.

The broad `backend/src/0_system/logging/index.mjs` has **zero incoming source
edges**. Select its gated retirement because its leaf implementations move;
do not establish an old-path forwarding facade. This one-file retirement is
explicitly outside the original three-file foundation candidate set. Its five
outgoing re-exports disappear with the unused aggregate. Configuration, utility,
ingestion and transport implementations remain at their current locations; this
is not authority to delete or move those subsystems.

## References and loading

The selected spelling census checks all 13,083 protected artifacts: 12,983 UTF-8
text files, 98 binary bodies and two unfollowed symlinks. It finds **91 references
in 42 files**: 32 exact edit references, five preserved private imports, three
sibling/history comments, two references inside the retiring aggregate, 44
historical plan/audit occurrences and five unrelated browser `_lib` examples.
All have dispositions. Split/computed names and untracked external operators
remain global reference gates; zero incoming source edges alone is not permission
to delete the barrel.

The three moved runtime modules import only each other and Node `os`. Retained
consumers include HTTP client/middleware, session-file transport, ingestion,
API/life routers, application services, composition and a CLI. Their separate
loading/side-effect closures are not made safe by the logger being small. In
particular do not load `serverMain`, `app` or session transports merely to inspect
these functions. No third-party runtime dependency is added by this sub-boundary.

`formatLocalTimestamp` here defaults to the runtime clock and timezone. It is
not the D4 pure-time SSOT or the D8 household-default `nowTs` family. Existing
guideline examples are not permission to change these actual defaults.

## Native evidence and compatibility obligations

The [current native receipt](evidence-index.json), under `logging-identity`, uses
the exact selected facade paths/bytes and manifest export fragments, three
unchanged original runtime bodies and manual sibling-package links in an
OS-sandboxed disposable root. No preparation dependency loader, external package,
controller, real sink or household record is involved. The fixed clock and
temporary stderr spy are restored before each child exits.

Twelve distinct probes pass in each restored green process:

1. Exact runtime/test export sets; runtime dispatcher excludes test-only names.
2. Public/private function, class, mutable priority and default-alias identity.
3. Stable dynamic namespaces, distinct public/private namespaces and rejection
   of a non-exported public file path.
4. Initialization flag and get-before-initialize rejection.
5. Loggers created before initialization look up the new dispatcher after
   reinitialization; replacing a dispatcher does not flush its transports.
6. Logger events use runtime-zone timestamps while unstamped direct events use
   configured timezone; a truthy caller timestamp wins unchanged.
7. Even a non-singleton dispatcher constructor changes module-global timezone;
   reset/reinitialize without a timezone keeps that setting.
8. Reset starts flush but clears the singleton and returns synchronously while
   a deliberately deferred transport is still flushing.
9. Existing logger sampling budgets survive reset; the next window emits the
   old aggregate through the new dispatcher. Child loggers have separate budgets.
10. Rejected flush promises are caught; synchronous throws/non-promise flush
    results reject the overall flush, with the existing iteration behavior.
11. Synchronous send failures increment metrics and allow later transports.
12. The priority table remains mutable and is the same object through both entries.

The five-step sequence is green → duplicate-dispatcher red → restored green →
leaked-test-export red → restored green. The duplicate fails `LOGGING-BINDING`;
the wildcard export fails `LOGGING-PUBLIC-EXPORTS`. These are native mechanism/
state observations, **not** additions to the 345 selected baseline assertions
or seven earlier product mutation pairs. The unchanged original server-foundation
suites separately supply 54 logging and ten error cases.

## Remaining gates

- Production/test usage enforcement, including re-export chains and alias/native
  resolution; a successful native import does not implement that policy.
- Same original affected suites after split imports, including safe ingestion,
  session-file, API status and CLI verification. This fixture is not their candidate.
- Complete actual package installation/lock, contributor targets, build/watch/
  delivery and combined relocation/retirement proof. Manual links do not prove npm
  workspace adoption or a complete application installation.
- Full retained transport/provider effects, privacy/field contracts, asynchronous
  send rejection and remaining sampling/error matrix. Preserve observed quirks;
  any behavior repair needs its own decision rather than an import-cleanup fix.

See **IMP-SHARED.04.4** in [implementation-backlog.md](implementation-backlog.md).
The selected source changes compose with the other eight specifications in
[combined-boundary-review.md](combined-boundary-review.md); that report does not
perform the three moves or the gated retirement.
