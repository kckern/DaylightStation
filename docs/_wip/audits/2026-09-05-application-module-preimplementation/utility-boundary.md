# Selected utility boundary — source specification, not migration approval

`utility-boundary.json` is the exact source/export/import specification for the
17 utility/core files previously listed as foundation candidates. It refines
the generated proposals in `boundary-review.json`; neither table authorizes a
move. Its source hashes, import spans, planned text hashes and six baseline case
links are reproducible through `review-utility-boundary.mjs`.

## Ownership and selected surface

All selected facilities remain platform-owned. Ownership does not erase their
layers: pure core time and errors retain domain context `core`, rank 0; clocks,
entropy and infrastructure errors remain system code. The D4 time dependency is
specific, not permission for arbitrary system-to-domain imports. D8's default
Los Angeles timezone is unchanged; D5/D10 still constrain the separate FileIO
boundary. None of these utilities belongs to Gratitude merely because it uses
them.

The proposal contains **11 public entries / 31 named symbols**: thirty have
current runtime/test consumers, and `parseToDate` preserves the active adapter
guide's documented helper API. Public facades have explicit
named re-exports through the private `platform--server` sibling package; there
is no wildcard, default export or facade back to a retained old implementation.
The JSON contains all eleven facade source texts and both package export-map
fragments. These are fragments, not approval of complete manifests or locks.

All entries below start with `@daylight/platform/server/`:

| Entry suffix | Published symbols |
|---|---|
| `system/utils/time` | `formatLocalTimestamp`, `getCurrentDate`, `nowDate`, `nowMonth`, `nowTs`, `nowTs24` |
| `system/utils/id` | `entropyBytes`, `hexId`, `shortId`, `shortIdFromUuid`, `shortIdLower`, `uuid` |
| `system/utils/errors/configuration-error` | `ConfigurationError` |
| `system/utils/errors/event-bus-error` | `EventBusError` |
| `system/utils/errors/file-io-error` | `FileIOError` |
| `system/utils/errors/scheduler-error` | `SchedulerError` |
| `system/utils/errors/infrastructure-error` | `ExternalServiceError`, `InfrastructureError`, `PersistenceError`, `RateLimitError`, `TimeoutError` |
| `system/utils/errors/vendor-error` | `isTransientStatus`, `translateVendorError` |
| `domain/core/errors` | `DomainInvariantError`, `EntityNotFoundError`, `ValidationError` |
| `domain/core/utils/time` | `formatIsoLocal`, `formatLocalTimestamp`, `getDateInTimezone`, `parseToDate` |
| `domain/core/utils/timezone` | `DEFAULT_TIMEZONE` |

`file-io-error` deliberately corrects the mechanically generated `file-ioerror`
proposal. It names an error class, not the FileIO storage primitive entry.

There is no selected public `system/utils` or aggregate `system/utils/errors`
entry. The latter would make an otherwise clock-free configuration-error import
load the clocked infrastructure-error closure. The three-class domain error
aggregate remains valid: all three classes are pure and share rank/layer.

`closureReview` follows the proposed source edges for every entry: none reaches
the retiring barrels or FileIO; each of the four clock-free system-error entries
loads only its own source module; domain entries stay wholly within core.
This is a source-graph proof, not installed-loader or runtime-instance evidence.

Private leaf defaults, error predicates and `IdUtils`/`TimeUtils` objects remain
unchanged. They are not public merely because baseline modules export them.
`parseToDate` is one imported binding re-exported by the clock module; the
runtime `formatLocalTimestamp` is a **different function**, adding a clock
default. Resolving only `export ... from` statements would miss this distinction.
The old `ShortId` alias equals `IdUtils`, but has no current external importer.

The [reference review](utility-reference-review.md) supplements import edges with
762 matched references, 26 exact mock/comment/guide/predicate edits and explicit
FileIO/global-scanner follow-ups. The [combined source review](combined-boundary-review.md)
verifies those changes with utility, FileIO, Feed, Homebot and household edits:
all selected groups apply and source parses in memory; see that report for current counts. Neither report proves
a candidate.

## Exact source impact

The proposal adjudicates **551 incoming source edges**, including 534 from
outside the selected 17 files. It specifies **541 edit groups in 473 existing
files**, with baseline source spans and destination paths. Every resulting file
parses after applying its edits in memory. No source file was changed.

- Fourteen utility/core implementation files move once to their classified
  `platform/server/system` or `platform/server/domain/core` destinations.
- Two obsolete system barrels retire only after the full source/tool/mock/path
  reference gate. All 38 external imports of the broad utilities barrel use
  only the four `now*` clock functions. The infrastructure-error class's own
  clock import also stops passing through that barrel, breaking its import cycle.
- `0_system/utils/strings.mjs` stays untouched. Its only recognized importer is
  the retiring barrel; it does not need a speculative public entry or prerequisite
  move. Any later dead-code removal is a separately accountable decision, not a
  hidden cleanup in this changeset.
- Named imports preserve local names. Moving platform-server consumers use
  relative paths inside the same private facet; retained consumers use public
  package entries. Existing `#system/*` mappings must not be retargeted wholesale.
- Two School tests lazily import/destructure `EntityNotFoundError`. Their literal
  specifiers change, but import timing and constructor identity do not.
- No external namespace/default/export-all import is present in this selected
  source-edge population. This statement does not cover FileIO's separate
  namespace consumers or unknown runtime-generated strings.

Two of the 541 edit groups are **prerequisite test repairs**, not relocations:
`ActivateDashboardScene.test.mjs` and `ToggleDashboardEntity.test.mjs` import
`AuthorizationError` from the system error barrel, which does not export it.
Their use cases import the existing application-layer class from
`#apps/common/errors/SemanticErrors.mjs`. The proposed repair changes only those
two test import specifiers to that existing target, after separate approval and
safe runner characterization. A missing export may cause a load failure or an
undefined matcher depending on the runner; do not assume either outcome without
observing it. The repair does not add a platform authorization type, change either
assertion or weaken application-layer rules. The original tests were not run in
this utility pack; a source-confirmed broken import is not a passing test.

## Compatibility evidence and remaining proof

Six `CASE-UTILITY-*` cases execute original modules under the existing isolated
registration runner. They assert explicit-date validation, invalid-timezone
fallbacks and fractional-second behavior; LA clock defaults and Intl failure;
ID lengths/formats and a known deterministic hash vector; default/named/barrel
constructor identity; error JSON/context/subtype/retry policies; and vendor
status precedence/message filtering. All six pass. The full registration pack
now has 78 passing cases. No new utility red-control or candidate claim is made.

The report keeps five accountable gates open:

1. `UTILITY-GATE-REFERENCES`: reconcile mocks, source-text/AST assertions, tooling,
   operator paths and documentation. Source import enumeration alone cannot
   authorize deleting the old barrels.
2. `UTILITY-GATE-PACKAGE`: merge complete platform manifests and dependency/lock
   changes; prove native resolution and loaded identity, not merely facade syntax.
3. `UTILITY-GATE-LAYERS`: enforce each facade's actual target/transitive layer
   and the narrow D4 rule; reject clock/entropy/clocked-error imports from domains.
4. `UTILITY-GATE-COMBINED`: compose these exact edits with Feed/Homebot/household,
   other foundation edits and relocation. Per-file parse results are not proof
   that all independently drafted changesets compose.
5. `UTILITY-GATE-IDENTITY`: run affected original consumer suites and the actual
   candidate, including deliberate duplicate-class, changed-UTC-default and
   wrong-time-helper negatives with restored greens.

Implementation task and rollback: **IMP-SHARED.04.1** in
`implementation-backlog.md`. No claim of completed PRE-3/4, complete foundation
classification, full contract coverage or migration readiness follows from this
selected utility specification.
