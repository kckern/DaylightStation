# Backend DDD Compliance Audit

**Date:** 2026-08-28
**Scope:** Production runtime code under `backend/src/`, composition, audit tooling,
and contract-characterization tests.
**Authority:** [`docs/reference/core/layers-of-abstraction/`](../../reference/core/layers-of-abstraction/)

## Verdict

The production backend satisfies every enforced layer rule. The normal gate,
AST report, application-infrastructure report, domain-hierarchy report, and
full runtime filesystem scanner all report zero confirmed violations.

This was an ownership-only remediation. It did not intentionally change any
route, method, status, header, response envelope/value, WebSocket/streaming
contract, stored YAML/JSON/JSONL shape, identifier, timestamp format, ordering,
or failure semantics. It requires no backup, rewrite, backfill, or migration.

Independent final review and branch integration are tracked separately in the
[finish-line checklist](../plans/2026-08-28-backend-ddd-finish-line.md).

## Final Machine Evidence

`npm run audit:layers` and `--ast-report` agree on these results:

| Concern | Final result |
|---|---:|
| System upward imports | 0 |
| Domain adapter/Node-I/O imports | 0 |
| Domain ambient clock and nondeterminism | 0 |
| Application adapter/config/FileIO/Node-infrastructure access | 0 |
| Application global fetch/process/timer/event-bus/config-service access | 0 |
| Adapter raw filesystem imports | 0 |
| Adapter config-singleton/rendering/cross-adapter imports | 0 |
| Rendering adapter/application imports | 0 |
| API adapter/application/domain/config/rendering/FileIO/Node imports | 0 |
| API global fetch/process access | 0 |
| Ports outside applications or with zero importers | 0 |
| Adapter port implementations lacking `extends` | 0 |
| `UserDataService` runtime references | 0 |
| Domain `toJSON` / `fromJSON` ownership | 0 / 0 |
| Storage paths declared outside allowed boundaries | 0 |
| Upward domain-hierarchy imports | 0 |

Additional gates:

- `npm run audit:fs`: 2,398 runtime files checked; no raw `fs` import outside
  `0_system`.
- `--application-infrastructure-report`: 0.
- `--domain-hierarchy-report`: 0.
- API literal route comparison against `HEAD`: no route removals. The six added
  Homeline call routes are unrelated pre-existing user work and excluded from
  this remediation's integration set.
- Backend app module imports successfully without starting a runtime.

## Semantic Review

The import graph alone was not treated as proof. Production modules were also
reviewed for misplaced decisions:

- API modules now parse HTTP input and translate injected operation results;
  they do not construct application services or perform filesystem, process,
  provider, configuration, or domain work.
- Application services express workflows through capability-oriented ports;
  they do not know YAML/JSON filenames, storage layouts, environment variables,
  config-tree keys, generic event-bus mechanics, global timers, or raw network
  calls.
- Adapters own hydration/dehydration and infrastructure mechanics. Workflow and
  business-selection policies found in adapters were moved to applications or
  domains.
- Composition owns concrete construction, provider selection, registry loading,
  runtime projections, and port binding. The large `app.mjs` policy blocks were
  extracted into named services and composition modules. The independent review
  additionally moved screen fallback, receipt projection, Strava authorization,
  Telegram identity, and kitchen relay liveness behind named operations/adapters.
- Domains are deterministic and serialization-free. Current time and IDs enter
  from callers; stored/wire projections occur at boundaries.
- Application-facing ports live under `3_applications/*/ports/`; production
  adapters explicitly implement their live contracts.

## Deliberate Non-Violations

- `api-handrolled-500`: **0**. The 83 historical sites documented in the
  [classification ledger](2026-08-28-api-handwritten-500-classification.md)
  now delegate to the API-owned `sendInternalError` presenter while preserving
  each route's exact status and body.
- `apps-success-false`: **44**, comprising 43 executable use-case/tool/batch
  outcomes and one comment-only match. They are existing application result
  contracts, not infrastructure access.

The remaining application results are public/use-case contracts, not
infrastructure access. Both counters are ratcheted at their current values.

## Verification

| Gate | Result |
|---|---|
| Parse/conflict-marker gate | 8,758 parsed; 10,110 scanned |
| Refactor/characterization suite | 19 files; 192 passed |
| Legacy unit harness | 74 suites; 480 passed |
| Integrated harness | 7 suites; 55 passed; 4 existing todos |
| Deployment-shaped integration | 1 suite; 2 passed |
| Isolated backend suite | 830 passed suites, 4 explicitly skipped; 10,602 passed tests, 52 skipped, 3 todos |
| Layer audit | all hard rules zero |
| Runtime filesystem audit | 2,398 files; zero violations |
| App import | passed |
| `git diff --check` | passed |

Focused final semantic-remediation coverage passes 66 tests across the affected
device, presentation, Playback Hub, and list-router paths. The independent
reviewer's four P2 leaks were moved to the correct boundary; it additionally
caught and the remediation fixed a P1 Playback Hub serializer regression before
integration. The fresh final independent reviewer signed off with no remaining
P0/P1/P2 finding.

The skipped/todo tests are pre-existing explicit exclusions; they are not hidden
failures or newly suppressed cases. Live/smoke tests were not run because they
can control household devices and are not required to prove a dependency-only
refactor.

## Enforcement Added

- The layer audit parses static, multiline, re-exported, CommonJS, and literal
  dynamic imports and performs graph-level port/hierarchy checks.
- A separate full-runtime scanner rejects `node:fs`, `fs`, `node:fs/promises`,
  and `fs/promises` outside `0_system`, including aliases and dynamic imports.
- `.githooks/pre-commit` scans both the staged index and the complete working
  tree for filesystem violations, then runs the layer, ESM-link, and parse
  gates; the installation script configures the repository hook path.
- Audit-rule tests cover true positives and false positives so pure path/date
  parsing is not confused with I/O or an ambient clock read.

## Conclusion

No confirmed production DDD violation remains in the audited scope. The code
and automated gates encode the structural non-negotiable rules; a final fresh
independent semantic review remains required before integration because the
first requested reviewer exhausted its service allowance after reporting the
findings resolved above.
