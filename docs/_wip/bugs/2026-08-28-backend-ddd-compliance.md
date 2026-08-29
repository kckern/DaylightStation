# Backend DDD Compliance — Remediation Report

**Opened:** 2026-08-28
**Status:** Remediated, independently signed off; integration pending
**Scope:** Production `backend/src/`
**Non-negotiable specification:** [`docs/reference/core/layers-of-abstraction/`](../../reference/core/layers-of-abstraction/)

## Contract Boundary

This work changes who owns and calls code, not what callers observe. The
following were frozen throughout remediation:

- API routes, methods, middleware order, statuses, headers, bodies, envelopes,
  and field values;
- WebSocket topics/messages and streaming/download/proxy behavior;
- YAML, JSON, and JSONL paths, shapes, optional fields, ordering, identifiers,
  date formats, and failure behavior;
- existing valid application result contracts, including `success: false`;
- existing route-specific HTTP 500 contracts.

No backup, rewrite, backfill, schema conversion, or data migration is required.

## Issue Register and Remediation

### DDD-01 — Raw filesystem access outside the system boundary

**Problem:** adapters, applications, and API modules imported `fs` directly.
This bypassed the centralized atomic filesystem primitives and was the highest
risk layer violation.

**Remediation:** all runtime filesystem mechanics now enter through
`0_system/utils/FileIO.mjs` or a system capability. Application/API callers use
narrow ports; adapters own infrastructure projections. The full-runtime scanner
reports zero violations across 2,384 files.

**Prevention:** `.githooks/pre-commit` scans the staged index and the entire
runtime tree on every commit, so an unstaged clean version cannot hide a staged
violation. It catches static, aliased, CommonJS, and literal dynamic imports,
then also runs the layer, ESM-link, and parse gates.

### DDD-02 — API modules performed wiring and infrastructure work

**Problem:** routers imported domains/applications/adapters/config/rendering,
constructed services, accessed files/processes/configuration, and contained
workflow decisions.

**Remediation:** router factories receive operations and presentation helpers
from composition. Filesystem, proxy, streaming, QR, emulator, image, content,
device, language, gaming, and administration mechanics were extracted behind
application-owned capabilities. Required dependencies fail clearly at assembly
instead of being silently reconstructed in handlers.

**Final evidence:** every `api-no-*` rule is zero, including Node infrastructure,
FileIO, global fetch, and global process access. Literal route comparison removed
no route.

### DDD-03 — Applications knew infrastructure and configuration structure

**Problem:** application services knew paths, YAML/JSON filenames, environment
variables, config-tree keys, concrete event buses, raw fetch/process/timer APIs,
and storage layouts.

**Remediation:** capability-oriented ports were added for persistence, runtime
scheduling/deadlines, process execution, content/catalog access, configuration
projections, realtime publication, device control, and external services.
Concrete adapters and resolved settings are injected by composition.

**Final evidence:** the application-infrastructure report is zero; all
application adapter/config/FileIO/Node/global-fetch/process/timer/generic-eventbus
and config-service rules are zero.

### DDD-04 — Domains read ambient time/entropy and serialized themselves

**Problem:** domain constructors/services supplied current-time, random-ID, or
serialization behavior, making domain decisions non-deterministic and assigning
storage/wire ownership to the wrong layer.

**Remediation:** timestamps, reference dates, IDs, and entropy now enter from
callers. `toJSON`/`fromJSON` projections moved to adapter/API boundaries. Domain
services operate only on supplied values.

**Final evidence:** domain ambient-clock, nondeterminism, Node-I/O, `toJSON`, and
`fromJSON` rules are all zero. Deterministic and stored-shape characterization
tests cover the moved construction and persistence boundaries.

### DDD-05 — Application ports had incorrect ownership or weak contracts

**Problem:** application-facing ports existed under domains, dead ports had no
consumers, and some concrete adapters relied on duck typing rather than declaring
their port contract.

**Remediation:** live ports moved to `3_applications/{context}/ports/`; unused
aspirational ports were removed; adapters explicitly extend the contracts they
implement; barrels/re-exports are included in graph analysis.

**Final evidence:** ports outside applications, zero-importer ports, domain-owned
application ports, and adapters lacking `extends` are all zero.

### DDD-06 — Peer adapters and rendering layers crossed boundaries

**Problem:** adapters imported peer adapters or rendering modules, and some
renderers depended on applications/adapters.

**Remediation:** shared mechanics moved downward or became application ports;
composition connects independent adapters and renderers. Storage codecs and
wire projections remain at the boundary that owns the representation.

**Final evidence:** adapter cross-adapter/rendering and rendering upward-import
rules are zero.

### DDD-07 — System services and registries owned application policy

**Problem:** config services, user/data services, registries, event transports,
authentication defaults, schedulers, and loaders mixed infrastructure with
application decisions.

**Remediation:** system retains generic primitives only. DataService, secrets,
registries/loaders, transports, and provider implementations moved to adapters;
feature decisions and projections moved to applications; composition binds them.

**Final evidence:** system upward imports and `UserDataService` references are
zero. A deployment-shaped test boots School from tracked files alone.

### DDD-08 — Composition root contained semantic policy

**Problem:** `app.mjs` performed filtering, mapping, sorting, stale/alert policy,
configuration merging, presentation projection, and feature-specific workflow
choices inline.

**Remediation:** those decisions moved into named domain/application services or
adapter projections, including media queue commands, gratitude presentation,
chess record/config handling, household/runtime projections, School gating,
wake-screen behavior, backlog/relay/playback alerts, weekly review transcription,
and artifact postview. Composition now constructs and connects capabilities.

**Final evidence:** the independent review identified five residual composition
seams (screen fallback, receipt projection, Strava authorization, Telegram
identity, and kitchen relay liveness). They are now named operations/adapters;
composition only supplies dependencies and registers the watchdog. All import
gates remain zero.

### DDD-09 — Audit coverage could hide violations

**Problem:** the old scanner missed multiline/re-export/dynamic imports, ambient
clock reads, global infrastructure calls, config-service traversal, D3/D7 graph
issues, and domain hierarchy violations. Positive baselines could be mistaken
for compliance.

**Remediation:** AST and graph rules now cover those cases. Confirmed hard rules
are ratcheted at zero. Dedicated reports expose application infrastructure and
domain hierarchy. Rule tests include false-positive fixtures.

**Final evidence:** normal and AST reports agree exactly; every hard rule is zero.
The scanners enforce structural ownership, not every semantic decision. Semantic
composition/API review remains a required final signoff, not an automated claim.

### DDD-10 — Legacy failure counters were unclassified

**Problem:** handwritten API 500s and application `success:false` objects looked
like possible misplaced behavior. Replacing them globally would have changed
the public contract.

**Remediation:** each occurrence was classified. The 83 historical HTTP sites
documented in the [HTTP 500 ledger](../audits/2026-08-28-api-handwritten-500-classification.md)
now delegate to the API-owned `sendInternalError` presenter. Their exact status
and route-specific body values are preserved while the handwritten counter is
ratcheted to zero.
The 44 application matches are 43 executable use-case/tool/conversation/batch
outcomes plus one comment-only match. None performs infrastructure work. Both
counters are ratcheted against growth.

### DDD-11 — Compatibility needed explicit proof

**Problem:** broad ownership changes could accidentally alter route or persisted
record behavior even while the import graph improved.

**Remediation:** route-level, stored-shape, deterministic-time/ID, adapter
contract, application fake-port, streaming/proxy, and deployment-shaped tests
were added or updated. Fitness timeline RLE remains an array in the domain and
the historical JSON string only in YAML persistence. Conversation, gratitude,
media-progress, food-catalog, session, and other record projections remain owned
by adapters with their legacy shapes intact.

**Final evidence:** no literal route was removed; all contract/refactor/unit/
integrated/backend suites listed below pass. No migration tool or data rewrite
was introduced.

## Final Counts

| Audit family | Confirmed violations |
|---|---:|
| System/domain/application/adapter/rendering/API imports | 0 |
| Raw filesystem outside `0_system` | 0 |
| Application infrastructure/config knowledge | 0 |
| Domain clock/entropy/serialization | 0 |
| D3/D7 port governance | 0 |
| Domain hierarchy | 0 |
| Storage paths outside approved boundary | 0 |
| `UserDataService` runtime debt | 0 |

Contract counters: `api-handrolled-500=0`, `apps-success-false=44`.

## Verification Record

- `npm run audit:layers`: passed; all hard rules zero.
- `--ast-report`: agrees with the normal gate.
- `--application-infrastructure-report`: 0.
- `--domain-hierarchy-report`: 0.
- `npm run audit:fs`: 2,398 runtime files, zero violations.
- `npm run check:parse`: 8,758 parsed; 10,110 scanned.
- `npm run test:refactor`: 19 files, 192 tests passed.
- `npm run test:unit`: 74 suites, 480 tests passed before the final local
  semantic fixes; a sandbox rerun reaches 467 passing tests before Supertest is
  denied permission to bind an ephemeral listener (environmental, not an assertion failure).
- `npm run test:integrated`: 7 suites, 55 passed, 4 existing todos.
- `npm run test:integration`: 1 suite, 2 tests passed.
- isolated backend suite: 830 suites passed, 4 explicitly skipped; 10,602
  tests passed, 52 skipped, 3 todos.
- backend app import: passed.
- `git diff --check`: passed.

Live/smoke tests were intentionally not run: they can operate household devices
and do not add evidence for a dependency-ownership refactor.

## Final Semantic Review Follow-up

The fresh independent reviewer initially reported four residual P2 ownership
leaks: device-query/duration coercion in applications, approved/public
presentation selection in the router, Playback Hub wire-shape normalization in
the use case, and router-owned menu-selection timestamping. Those now reside
at the HTTP boundary or in named application operations as appropriate. During
the correction pass, the reviewer also caught a staged P1 compatibility issue:
Playback Hub domain entities do not expose `toYaml()`. The API uses its existing
boundary serializers instead, preserving the route's public YAML-compatible
response shape. Focused coverage passes 66 tests across the affected routers
and use case. The final reviewer rerun independently signed off with no
remaining P0/P1/P2 finding.

## Remaining Finish-Line Items

- Re-run the requested independent `gpt-5.6-sol` review of the final code and
  documentation. The first dispatched reviewer found and drove the resolved
  semantic seams above, then hit its service allowance before final signoff.
- Separate unrelated user work from the remediation's integration set.
- The staged Homeline composition/import overlap was resolved with explicit
  user authorization: the complete timer-free Call boundary is included in the
  remediation. The exact staged layer audit reports zero hard findings; no
  enforcement rule was weakened or bypassed.
- Fast-forward the clean homeserver source checkout (`3d497cf5`, currently
  seven commits behind local/origin `main` at `0673cdde6`) after the DDD commit
  has been merged and pushed; do not discard or overwrite source work.
- Commit the verified remediation, merge it to current `main`, and push `main`.

## Related Documents

- [Final audit](../audits/2026-08-28-backend-ddd-compliance-audit.md)
- [Finish-line checklist](../plans/2026-08-28-backend-ddd-finish-line.md)
- [HTTP 500 classification](../audits/2026-08-28-api-handwritten-500-classification.md)
- [DDD decision register](../../reference/core/layers-of-abstraction/decision-register.md)
