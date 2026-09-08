# FileIO facade identity and mock exposure

Status: mechanism verified; actual consumer-suite migration remains pending.
This is preparation, not a FileIO move or approval of a new public export list.

Evidence: [77-name experiment](evidence/fileio-identity-2026-09-06T07-43-45.690Z.json),
[selected 73-name experiment](evidence-index.json)
and [22-site source exposure ledger](fileio-mock-review.json). Each experiment has
eight steps. Earlier receipts remain history, with stale wrapper/fixture hashes
distinguished in `evidence-index.json`.

## What the experiment establishes

The default fixture uses byte-identical original `FileIO.mjs`, a public facade with
all 77 existing named functions explicitly re-exported, one private implementation
package, and two synthetic readers. One reader imports through the public entry;
the other imports its same-owner implementation relatively. Manual links exist
only under a task-owned temporary root. No preparation resolver loader, production
consumer, ordinary root test configuration or npm installation is involved.

Selected mode uses the exact 73-name facade source bytes in `fileio-boundary.json`.
All four excluded helpers remain private; public and private prefix operations
still share the cache. Its simplified facade file location and manually linked
package manifests are a mechanism fixture, not adoption of the full specification.

Observed versions: Node 22.22.0, root Vitest 4.1.10/Vite 6.4.2, backend axios
1.10.0 and js-yaml 4.1.0. These are the inspected local runtime, not an assertion
about another machine or a future lock graph.

| Property | Observed result |
|---|---|
| Exported function bindings | All 77 in default mode and exactly 73 in selected mode equal their private references; selected mode keeps four helpers private |
| Module namespaces | Public and private namespaces differ; repeated imports of each namespace are stable |
| Actual FileIO directory cache | Public then private prefix lookup performs one directory read |
| Accidental implementation copy | Byte-identical duplicate fails the binding-identity assertion; restoration passes |
| Hoisted partial mock of public facade | External reader and dynamic public import see the mock; private reader reads the synthetic actual YAML and fails the named assertion |
| Hoisted partial mock of canonical private leaf | Both readers and dynamic public import see the same mock function |
| Private-leaf `importOriginal` spread factory | Also passes, but is unnecessary for this partial factory and would add original-module evaluation |

The public-target failure was reproduced twice, with exactly
`FILEIO_MOCK_INTERNAL` failing and the other two assertions passing. Restoring the
canonical partial target restores all three. Arbitrary runner errors, missing
tests and extra/skipped assertions do not qualify as this counterexample.

The wrapper's overall success means the expected observations were reproduced,
including intentional failures. It does **not** mean public-target mocking works
through private imports. Each mode's eight subprocess records and three repeated
mechanism assertions are separate from the selected baseline assertion totals and
product red/restored pairs. The duplicate control fails before the cache
assertion; it is not a separate cache-specific mutation proof.

## Actual first-move impact: narrower than the counterexample

The full 50-file foundation candidate set has only one direct FileIO import:
the existing mixed utility barrel's re-export. The selected utility plan retires
that barrel; the projected foundation therefore has **zero private FileIO reader
imports**. The synthetic same-owner reader is not a demonstrated existing
first-move regression. Do not add a universal mock shim, new private-import
exception, duplicate module, or public-to-private alias to solve an unobserved
consumer failure.

All 22 recognized mock sites have source hashes, exact call spans and original
edge-ID witnesses in `fileio-mock-review.json`. Their source-import closures
reach ten distinct non-test IO consumers before the utility projection and nine
after the mixed barrel disappears:

- `backend/src/1_adapters/fitness/YamlWorkoutRepository.mjs`
- `backend/src/1_adapters/persistence/files/FilesystemFreshVideoMediaStore.mjs`
- `backend/src/1_adapters/persistence/yaml/YamlComposerSongStore.mjs`
- `backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs`
- `backend/src/1_adapters/content/list/ListAdapter.mjs`
- `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs`
- `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs`
- `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`
- `backend/src/1_adapters/strava/StravaWebhookJobStore.mjs`

These are retained adapter imports in the broader 321-edge FileIO census, not
nine newly discovered imports or nine independently certified suites. Retargeting
each affected adapter and test to the same selected public entry remains the
candidate first-move treatment; actual mock scopes/factories and unchanged
assertions must prove it before approval.

Three Fitness tests have no reachable production FileIO reader, but are not dead
mocks: `ActivityReconciliationService.test.mjs` and
`FitnessActivityEnrichmentService.test.mjs` build test-local history repositories
from the mocked functions; `sliverAbsorption.test.mjs` builds history records and
passes them to the pure operation. Their helper source anchors are recorded.
Keep these fixtures. They do not justify application-layer FileIO access.

## Required implementation treatment

1. Preserve one canonical implementation/cache. Resolve actual public/private
   files; equal exported function references do not mean equal namespace objects
   or interchangeable mock targets.
2. For each of the 22 sites, preserve the factory, hoisting, partial exports and
   subsequent dynamic imports. Match the subject's actual resolved entry, not
   merely a similarly named public path. Do not widen every mock with
   `importOriginal`, which can load dependencies/effects the old factory avoided.
3. Keep the 23 dynamic-import edges linked to the existing storage census.
   Preserve lazy timing and test namespace access, not just destructured names.
4. If later foundation changes introduce same-owner private readers, reopen this
   decision. A narrowly owned test mechanism targeting the canonical leaf is an
   experimentally viable option, not adopted cross-owner private access. Domain,
   application and composition restrictions, including D5/D10, remain unchanged.
5. Run safely isolated original suites before and after the exact approved
   package/import changes; validate the actual runner transformation and native
   production resolution independently. The synthetic reader result cannot
   certify the nine adapters or the other FileIO consumers.

The source scan is an overapproximation: it follows resolved static/literal
dynamic source edges without executing other mocks, branches or package code.
There are no unresolved source edges in these selected closures, but runtime
computed loads, mock suppression and external-package behavior remain outside
that claim. The later [FileIO public specification](fileio-boundary.md) selects
73 names and records 36 passing unchanged original cases in six suites. The new
selected-mode fixture verifies those exact facade bytes, but neither fixture
establishes original-suite narrowed-package candidate parity.
Full manifest/lock/build, remaining consumer contracts and namespace authority
work remain open. See `IMP-SHARED.04.2`.
