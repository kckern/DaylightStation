# FileIO public boundary and original consumer baseline

Status: selected source/import specification; no migration approval or candidate
parity claim. Exact names, source spans, factory-preserving edits, package
fragments and hashes are in [fileio-boundary.json](fileio-boundary.json).

## Ownership and interface

FileIO remains the platform's system-layer filesystem mechanism. It does not own
the household records, namespace policy, codec choices or transaction semantics
of callers. Applications and domains still cannot import it through a public
package; D5/D10 and the adapter guidelines remain binding.

| Artifact | Proposed disposition |
|---|---|
| `backend/src/0_system/utils/FileIO.mjs` | Move once to `platform/server/system/utils/FileIO.mjs`; preserve its body and all 77 private exports |
| Public entry | `@daylight/platform/server/system/utils/file-io` |
| Public facade source | `platform/public/server/system/utils/file-io.mjs`; 73 explicit named re-exports, no default or wildcard |
| Same-owner facet entry | `@daylight-internal/platform--server/system/utils/file-io`; resolves to the one implementation |
| Private-only names | `createImageIO`, `findYamlByPrefix`, `isFile`, `resolveContainedYaml` remain unchanged in the implementation, not published by the new public facade |

The 73 selected public names have actual named import bindings. Keep a binding
even when its current body reference count is zero: removing it while leaving
the import can still break module loading. Five namespace imports have 43
statically resolved property uses, all within these 73 names; preserve their
namespace access and dynamic-import timing rather than rewriting them to eager
destructuring. No current bound namespace access selects the other four names.
The repository source/reference/runbook search for `createImageIO`,
`resolveContainedYaml` and `findYamlByPrefix` finds only implementation/barrel
declarations and FileIO's internal `loadYamlByPrefix` call. General `isFile`
occurrences include unrelated filesystem/Dirent methods; their spelling alone is
not an import of FileIO's function.

This is a deliberate **new public surface**, not a claim that its namespace has
all 77 keys of the implementation. The Workout test's existing `importOriginal`
spread must be tested against the selected facade; its original assertions
observe the relevant writer functions, not every export key. Full reference and
original-suite narrowed-namespace checks remain gates. Do not delete private helpers or
interpret absence of an application consumer as permission for unrelated cleanup.

Backend dependency fragments preserve the declared `axios: ^1.4.0` and
`js-yaml: ^4.1.0` ranges. The observed backend installation is axios 1.10.0 and
js-yaml 4.1.0; preserving ranges alone does not preserve those versions or module
instances. A new range resolution or accidental root axios 1.7.4 selection is
not certified by these fragments. Full lock/installation adoption remains open.

## Exact source changes

The 321 carrier edges reconcile without duplicate work:

- **281 FileIO import replacements**, including all 23 previously inventoried
  literal dynamic imports. Only the literal value changes; quotes, imported/local
  names, laziness, arguments and function bodies remain unchanged.
- **One barrel re-export disappears** with the already planned mixed utility
  barrel retirement; it is not a second FileIO move or new facade.
- **39 clock-only barrel edges** already have utility-boundary dispositions;
  none is promoted into a filesystem dependency.
- **22 additional mock-target replacements**, retaining the entire original
  factory and hoisting behavior. These are not extra import edges.

The resulting **303 edit groups touch 281 existing files** and parse in memory.
Each has an exact baseline span/before/after value and source hash. A syntactic
location under API/application folders does not make a colocated `.test.mjs`
file production code; the checker distinguishes these explicitly. No production
domain/application/API/composition FileIO import is approved by this mapping.

The [combined proof](combined-boundary-review.md) applies these changes alongside
utility/reference/HTTP/Feed/Homebot/household specifications, including the seven
supplemental FileIO reference/guard edits. It records the current total and unique
facade paths. This remains a string-based edit proof, not applied imports or an
installed candidate.

## Unchanged original tests actually run

[The six-suite receipt](evidence/fileio-consumers-2026-09-06T07-30-14.830Z.json)
records 36 passing original assertions, including expanded parameterization:

| Original suite | Cases | Selected behavior |
|---|---:|---|
| `YamlWorkoutRepository.test.mjs` | 16 | Real temporary YAML, household paths, atomic writer spies, normalized shape, reads/order/updates/deletes and unsafe IDs |
| `FilesystemFreshVideoMediaStore.lock.test.mjs` | 2 | Hoisted partial mock; lock record, descriptor closure and release |
| `YamlComposerSongStore.test.mjs` | 7 | In-memory YAML/blob mocks; create/read, revision/history/conflict/sharing/traversal/removal |
| `YamlPianoStudioDatastore.test.mjs` | 3 | Preset shape/path and known/unknown users |
| `YamlMediaProgressMemory.readCache.test.mjs` | 4 | Dynamic namespace mocks; mtime, write invalidation and independent cache paths |
| `StravaWebhookJobStore.test.mjs` | 4 | Pending/unmatched inclusion and completed/abandoned exclusion |

Exact paths and safety dispositions are in the dedicated
`fixtures/fileio-consumers.json`; `contracts.json` links each actual case under
`CTR-FILEIO-CONSUMERS-01`. No test/assertion body was copied or changed. Only the
Workout suite uses real disk under the task-owned temporary root; other suites
retain their original mocks. The runner refuses missing/skipped/extra cases.

These are **baseline** results. They are not the 73-name facade candidate, all
22 mock sites, all 306 consumers, production layer compliance or deployment proof.
The separate [native/mock mechanism probes](fileio-mock-review.md) do not replace
these original-suite candidate checks.

## Selected facade fixture actually run

[The current selected-mode receipt](evidence-index.json)
records eight native/Vitest steps using facade source bytes identical to this
specification, byte-identical original FileIO and manually linked disposable
packages. Exactly 73 public bindings equal their private implementation bindings;
all four private-only helpers remain present privately and absent publicly.
Public `findFileByPrefix` then private `findYamlByPrefix` performs one directory
read, demonstrating a shared cache despite distinct public/private namespaces.
Dynamic imports retain identity and an unexported package path is rejected.

A duplicate implementation fails `FILEIO_BINDING_IDENTITY`, then restoration
passes. In both public-target mock attempts, only `FILEIO_MOCK_INTERNAL` fails;
external and dynamic public readers receive the mock. Canonical-leaf partial and
spread mocks pass all three assertions; the partial factory restores green at
the end. This observes a synthetic private reader, not an existing first-move
regression or permission for production private imports.

The fixture uses a simplified facade file location, manual links and installed
backend dependencies. It proves the selected export bytes/bindings/cache and
mock behavior, **not** the proposed manifests/locks, all original consumer suites,
full relocation or build. Both the default 77-name and selected 73-name receipts
are audited separately from the selected baseline assertions and product
red/restored pairs.

## Open gates and handoff

The [supplemental reference census](fileio-reference-review.md) adjudicates all
778 matching tracked-text occurrences and specifies seven extra edits, including
the exercise-library corpus guard that otherwise fails the new import spelling.
It retains authoritative rulings and old-path regression fixtures. Computed paths,
external scripts and relocation-aware enforcement remain separate obligations.

The six named gates in the JSON cover complete references, package/lock/runtime
identity, original-suite candidate mock behavior, full combined migration,
storage authorities and layers. Preserve the narrower first-move finding: after
utility retirement no foundation-private FileIO reader remains, so do not add a
universal private mock alias or `importOriginal` spread workaround.

The next implementer uses `IMP-SHARED.04.2`, with exact imports/mock targets and
unchanged assertion IDs from this packet. Approval must cover the complete
source/package/test changeset. Rollback restores old source paths, imports,
factory targets and dependency identities together, with no duplicate writer,
data-format migration or permanent compatibility directory.
