# Storage authorities and preserved behavior

`storage-authorities.json` maps 12 reviewed authorities: four DataService scopes,
Gratitude arrays and snapshots, app configuration, Admin editing, household/user
lookup, temporary printing and two browser storage keys. It records source hashes,
readers/writers, codecs, cache policy, file modes, atomicity and selected case IDs.
The 282 incoming FileIO edges and 337 lexical storage/resolver references are
inspection indexes, not 282 approved APIs or 337 proven storage operations.
The separate [binding review](storage-consumer-review.md) now resolves the
direct/barrel imports, helper contracts, direct argument sources and all 51
production indirect function references. It does not turn every generic path
supplier into an approved namespace.

This is substantial PRE-2.3.1 evidence, not completion of every shared caller's
namespace classification. Broader FileIO and generic-path callers still need
review before approval of the entire foundation move. Three named central profile
writers and all 20 matched named-profile reference files are now adjudicated.
No private records were
read or copied; all executed disk tests used temporary synthetic households.

## Paths are contracts, not source-folder conventions

| Authority | Current path/scope |
|---|---|
| DataService household | ConfigService resolves the requested/default household's `_folderName`, falling back to its ID. Unknown households throw. |
| DataService user | `<dataDir>/users/<username>`; omitted username uses the default head of household. |
| DataService system/content | Separate shared `<dataDir>/system` and `<dataDir>/content` trees. Neither follows application source location. |
| Gratitude arrays | Six explicit dotted `.yml` filenames under household `gratitude/`. A dotted basename without `.yml` is **not** automatically fixed by DataService. |
| Gratitude snapshots | Household `gratitude/snapshots`, with wall-clock/UUID filenames. Listing includes malformed files with fallback metadata; loading a malformed selected/latest file returns null without trying older valid data. Source relocation must not relocate persisted snapshots. |
| App config lookup | Registry-relative app path under the configured household folder; existing `.yml` is preferred to `.yaml`. |
| Admin editor | Literal `household/<registry-path>.yml` from the data root, not the configured household folder resolver. |
| Temporary printing | OS temp directory and `gratitude_card_<clock()>.png`, not a package asset directory. |

The registry entry for Gratitude is `gratitude/config`. The root project-context
note describing flat `config/<app>.yml` paths does not match this frozen source.
Do not change either persisted paths or protected reference files during this
preparation; use the actual registry/resolver as evidence.

Boot and reload are also different. `configLoader.loadHouseholdApps` still merges
legacy `apps/<name>.yml` and `apps/<name>/config.yml`, then truthy registry values.
`reloadHouseholdAppConfig` reads only the registry path. Removing boot legacy
lookup is a behavior change, not implied by reorganizing the source tree.

## Verified Admin/config differences

Five new `CASE-GR-ADMIN-DISK-*` cases run the original Admin router, application
service and YAML adapter, with actual Express JSON serialization over an in-memory
HTTP stream and real ConfigService against temporary files:

1. A successful editor save changes disk and returns metadata, not a parsed/raw
   payload. The cached runtime config stays unchanged until explicit reload.
2. Admin writes literal `household/` even when ConfigService uses `household-a/`.
   The latter's cache therefore does not change on reload of its missing file.
   The editor rejects the alternate folder through its existing allowlist.
3. An existing `config.yaml` is the runtime lookup target until Admin writes
   `config.yml`; the new `.yml` then takes precedence. Both files still exist.
4. `raw` wins over `parsed` and preserves comments. Invalid YAML, empty bodies,
   masked paths and missing files retain their current HTTP errors; rejected
   writes leave the previously written bytes intact.
5. DataService's in-place write preserves an existing restrictive file mode.
   Admin's atomic replacement creates a new inode whose mode follows the process
   umask; it does not copy the old target's mode. Successful replacement leaves
   no staging file in the inspected synthetic directory.

These are baseline characterizations, not recommendations to retain undesirable
behavior forever. Household-aware Admin paths, extension unification, automatic
reload and mode preservation each require a separate explicit behavior-change
decision. The current migration must not accidentally implement any of them.

The generic editor and managed-app service also differ: managed-app writes refuse
when their parent directory does not exist; the generic editor creates it through
FileIO. Both obtain editable paths from the same registry, but they are not the
same operation. The allowlist is a security boundary: adding a registry entry
grants editor access, subject to masks. Lexical path containment is not proof of
symlink confinement.

## Atomicity, cache and cleanup are separate properties

DataService and Gratitude snapshot writes use synchronous, whole-file in-place
YAML writes. They do not use the available atomic helper. Multi-file transfers
and restore have no encompassing transaction/lock. A caught DataService write
failure returns `false`; Gratitude's private write helper does not inspect it.

Admin uses same-directory text staging and rename. It has no optimistic lock,
compare-and-swap or fsync step. The separate YAML atomic helper offers an optional
durable mode, but that option is not used by Admin's text writer. Availability
of a stronger helper does not prove a caller already uses it.

DataService rereads on every read. ConfigService caches app/roster/profile values.
A missing app-config reload retains its old cached value; a malformed app YAML
throws through `loadYaml`. A missing/falsy user-profile reload instead deletes the
profile cache entry. A generic shared cache wrapper must not erase these differences.

The print gateway writes before entering its `try/finally`, then performs
best-effort deletion after printer success/failure. It does not use an exclusive
filename; same-clock concurrency and initial write failure are not covered by
the cleanup guarantee. Existing temporary-print cases verify only their named
success/failure paths.

## Browser and memory identity

`ds_token` belongs to browser-origin authentication, not Gratitude. Its auth helper
writes/removes it; the shared API client and additional consumers read it.
`ds_device_id` is browser identity, memoized in its module, with explicit fleet
override and ephemeral fallback. Five current non-test files contain references
to these storage keys; the JSON records their exact lines and source hashes.

Admin edit/revert state, logger/transport singletons and the console reentrancy
guard are memory authorities, not new persistent stores. Their module identity
must survive packaging even though no YAML path is involved. Lifecycle behavior
is cross-linked in [lifecycle accounting](lifecycle-closure.md).

## Shared profile authority: three writers, different observable behavior

`profileMutations` in the JSON records exact source anchors for the following
paths. All three reach `users/<username>/profile.yml`; moving source into an owner
does not grant it a separate copy of that record.

| Workflow | Writes | Cache behavior |
|---|---|---|
| Admin create/update/remove member | Text staging/rename; create writes profile before household roster; removal keeps profile/login/templates | No refresh of cached profile or roster |
| Fitness fingerprint writer | In-place read/transform/write, followed by explicit `reloadUserProfile` | Current profile entry replaced; old returned objects/Maps and platform identity index unchanged |
| Auth setup/invite acceptance | DataService in-place writes; multiple documents written sequentially | Fresh individual account reads coexist with cached profile enumeration and fresh login reads |

The six `CASE-STORE-PROFILE-*` cases run original services/stores with synthetic
temporary YAML or explicit failing synchronous dependencies. They verify:

1. Admin edits are visible to fresh reads but not cached user/roster consumers;
   removing membership leaves the file. Update ignores a replacement `username`
   but accepts other supplied keys. This is not HTTP authorization certification.
2. Fitness refresh replaces the current profile, without mutating previously
   returned profile objects or Maps. The boot-built platform identity index still
   resolves the old platform ID. Malformed profile reload deletes the cache entry.
3. A thrown save prevents refresh. A thrown refresh rejects after the saved
   fingerprint already exists; it does not roll back the write.
4. Auth `getAccount` reads the current disk profile. `listAccounts` and
   `findInvite` use cached profiles with fresh login records. Disk-only profiles
   are individually readable but absent from enumeration until cache changes.
5. Auth setup ignores `false` write results and continues in order: profile,
   login, household, system auth. Its household ID is a payload field, not an
   explicit household scope argument. A thrown write stops later operations.
6. Admin creation can leave a persisted profile if the subsequent roster write
   throws. Validation failure occurs before those writes.

Additional source findings remain distinct from executed assertions: Fitness
read/parse failure collapses to `{}` before mutation; device enrollment/deletion
precedes profile persistence and is not compensated after profile failure;
missing optional profile-writer wiring can still produce a success outcome.
`reloadUserProfile` attempts an assignment to a frozen top-level object when
`users` was absent at construction. These are future explicit behavior decisions,
not fixes or new semantics authorized by this migration.

The profile reference census examines 3,033 tracked non-test JS/MJS/JSX/Python/
shell files across backend source, CLI, scripts and satellites. All 20 matched
files have individual dispositions, including media-stream `profile` false
positives and comments that are not actual writers. Satellite `profileStore`
helpers transform provided data; their names/comments do not prove a deployed
profile writer. Generic computed paths, other languages and installed/private
operators are not proven absent by this census.

## Generic path suppliers are not implicit storage authorities

The 12 named authorities above are the persistent/browser/temporary namespaces
whose paths are involved in the first-move and shared-boundary plan. The
FileIO-consumer census also finds 14 source-reviewed **supplier patterns**.
They are deliberately kept separate: a default or injected filesystem method
does not by itself establish one shared namespace, cache, codec or owner. The
following matrix gives each pattern a durable review ID and prevents a future
package move from treating its path source as invisible:

| Supplier ID | Current owner/path source | Classification for this plan |
|---|---|---|
| `IO-PREDICATE` | Content repository's ordered source/media/data candidates | Runtime content-root selection; retain ordered first-existing behavior, not a new data store. |
| `IO-DIRECTORY-CALLBACK` | Gaming effect store's injected effects directory | Product-owned injected root; receipts/audit/sessions remain separate children. |
| `IO-DEFAULT-CANVAS` | Canvas adapter `config.basePath` | Content adapter resource root; whole-object FS override is part of its contract. |
| `IO-DEFAULT-MIRROR` | Health archive source/destination roots | Operator-supplied archive copy path; reviewed with the health CLI, not household DataService. |
| `IO-DEFAULT-EMERGENCY` | Fitness `fitness/log/emergency_lock.yml` | A named household record with its own malformed-record/clear behavior; do not merge it with shutdown state. |
| `IO-DEFAULT-SHUTDOWN` | ConfigService household `shutdown/lockdown.yml` | A named household record with atomic-save default and distinct invalid-state semantics. |
| `IO-DEFAULT-PROFILE` | ConfigService shared `users/<username>/profile.yml` | Covered by `STORE-HOUSEHOLD-USERS` and its profile-writer cases. |
| `IO-DEFAULT-SCHOOL-CATALOG` | Three injected School catalog/document/surface-profile directories | Multiple product directories, each retaining its own scan/validation rules. |
| `IO-DEFAULT-SCHOOL-STATE` | Injected School allocation, held-scan, remediation and calculator paths | Multiple records; atomic individual files are not one transaction or shared state service. |
| `IO-DEFAULT-PRINT-DOCUMENTS` | School injected output/source directories | Product document roots with existing filtering rules. |
| `IO-DEFAULT-CALCULATOR-ARTIFACT` | School calculator injected artifact directory | Product artifact root; its paired YAML/binary writes are not a compound transaction. |
| `IO-DEFAULT-STATE-GATES` | State Gates injected file path/resolver | Product state/journal/projection authority; strict reader and writer semantics remain separate. |
| `IO-CLI-ARCHIVE` | Fitness reconstruction configured archive directories | Stable operator path and ordered lookup, never executed for inventory. |
| `IO-UNUSED` | Four unused imported bindings | No authority is inferred; other bindings in the same files still require their own review. |

This is a **classification boundary**, not completion by enumeration. The 1,280
remaining production direct FileIO call sites remain source-indexed but are not
licensed to move or to import a public FileIO facade. Before any such caller
moves, its concrete path supplier must be linked to one of these named
authorities or receive its own authority/card. That preserves D5/D10: an
application receives a semantic port; a system filesystem primitive does not
become an application dependency merely because the path is now documented.

Boundary constraint: keep roster order, profile reads, account enumeration,
platform identity lookup and explicit refresh as distinct contracts. Shared
identity owns the record; Admin and Fitness retain their workflow policy. Do not
replace them with an always-fresh universal `User`, merge the `profile/health`
namespace into `profile.yml`, or add transaction/locking semantics during a move.
Application code continues to consume semantic operations through injected ports;
publishing FileIO does not override D5/D10.

## Health archive CLI: explicit path supplier and alternate IO authority

This source-only chain resolves the `IO-DEFAULT-MIRROR` downstream supplier
question in `storage-consumer-review.json` for the tracked operator entry:
`cli/ingest-health-archive.cli.mjs` →
`backend/src/3_applications/health/archive/HealthArchiveIngestion.mjs` →
`backend/src/1_adapters/health/FilesystemHealthArchiveMirror.mjs`.
The adapter actually extends the application-owned `IHealthArchiveMirror` port.
Its classification remains Health adapter/application, not platform merely
because it consumes shared filesystem utilities.

| Authority | Source-derived behavior to preserve |
|---|---|
| Operator root | `REPO_ROOT` is the parent of the CLI module directory. Relocating this CLI without changing root resolution changes defaults; moving only the adapter does not. Keep this stable operator path for the Gratitude migration. |
| Config and source | Default `data/users/<user>/config/health-archive.yml`; `--config` overrides it. Each enabled category uses `--source` or `sources[category].path`; `--source` requires `--category`. No DataService household resolution occurs in this chain. |
| Structured destination | Default `data/users/<user>/lifelog/archives/<category>`; `--data-root` replaces the archive root. The supplied override is not automatically user-scoped again. |
| Media destination | Default `media/archives/scans/<user>`; `--media-root` replaces the media archive root. Custom media categories use `<mediaRoot>/<category>/<user>`. |
| Playbook policy | Default `data/users/<user>/lifelog/archives/playbook/playbook.yml`; override via `--playbook`. Custom category routing takes precedence even over a built-in category name. Structured custom categories use `<dataRoot>/<category>`. Missing/unparseable playbook yields no additions; other read errors propagate. |
| IO selection | CLI injects the whole `node:fs/promises` object as `io`. The adapter's default FileIO table is therefore not used by this caller. Existing `HealthArchiveIngestion.test.mjs` also supplies an IO object. A public FileIO import rewrite alone cannot certify this operator path. |
| Bytes and metadata | Mirror reads and writes raw bytes. Destination absence requests a copy; older destination mtime requests a copy; otherwise SHA-256 byte comparison decides. Source mtime is not copied. Per-file writes are in-place, with default creation modes subject to umask, no explicit lock/fsync/atomic rename and no multi-file transaction. |
| Manifest | CLI separately writes `manifest.yml` using `js-yaml` and the manifest encoder after ingestion returns, including copied/skipped/failed counts and a current timestamp. This write is not atomic with file copies; a source file with the same relative name is not reserved by the mirror. |
| Cache and dry-run | No long-lived cache/reload service is involved. The playbook is read separately for category and privacy projections. Dry-run still lists/stats/reads inputs; it suppresses copy and manifest writes, and reports would-copy files in `copied`. It is not safe as a no-access inventory command. |

`listFiles` descends directory entries and accepts regular files, ignoring symlink
entries; that does not establish confinement of a supplied root or the destination
tree. The service applies category and raw-source-string privacy checks. Although
its comment mentions `HealthArchiveScope`, neither this CLI nor this service
imports or invokes that guard in the inspected chain. Do not infer normalized
path/user authorization or symlink-safe destination writes from that comment.
This is a source finding, not a reproduced exploit or permission to change the
contract during relocation.

Listing failure aborts ingestion; individual stat/read/copy errors are caught into
`report.failed`, allowing later files to proceed. Required later acceptance covers
default and overridden roots, custom routing precedence, default versus injected
IO, dry-run reads/no writes, copy/manifest partial failure and mode preservation.
Use only synthetic directories. Preserve stable operator invocation and current
data paths on rollback; never copy an old archive over post-cutover records.
This closes the named supplier review, not PRE-2.3.1's remaining namespace census
or runtime verification. No CLI, provider or live archive was executed.

## Open verification and decisions

Broader FileIO/generic-path consumer namespace and validation review,
installed/private operator writer provenance,
concurrent writers, crash durability, cross-platform modes and actual production
composition remain separate work. Source findings do not certify these cases.
The first storage generator run refused a misspelled source anchor before writing
its output; the new tool was corrected to the actual `#getSnapshotDir` method.
That tool-development failure is not a product failure or a controlled red test.
