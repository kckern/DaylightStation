# Shared storage consumers and binding contracts

`storage-consumer-review.json` expands the FileIO import index into a source-only
binding census. This supplements [storage authorities](storage-authorities.md),
not a claim that every persisted namespace or security boundary is verified.

## Accounted population

| Population | Count / meaning |
|---|---|
| FileIO exports | 77 individually linked to source spans, parameter lists, hashes and reviewed effect/error/write contracts |
| Direct FileIO edges | 282, unchanged from the initial graph |
| Direct plus re-export-carrier edges | 321 across 306 source files; two carrier files are FileIO and the existing system utility barrel |
| Imported filesystem bindings | 918, resolved with lexical scope, including supported dynamic destructuring |
| Direct calls | 1,410, with source-addressed arguments and referenced binding definitions |
| Non-call references | 252: 51 production/operator references and 201 test references |
| Production non-call dispositions | All 51 assigned to 14 source-reviewed policies, including four unused bindings |
| Parse failures / unbound dynamic imports | Zero in this selected population |

The 1,410 direct calls include 79 test calls and 51 operator CLI calls. Production
system/adapter code accounts for the other 1,280. These are static call sites,
not invocation counts or passing assertions. No indexed CLI or product module
was executed by the census. Its counts are separate from the selected runtime
cases added in the first-move review below.

## First-move path review

`firstMoveImpact` intersects these consumers with the exact Gratitude and
foundation source destinations. Seven consumer files would move. Only two
contain imported FileIO calls: the Gratitude YAML datastore (eight calls) and
temporary-image printer adapter (two). Five others have clock/barrel dependencies
but no imported IO calls. The other 299 consumer files remain at their present
locations for this candidate set; their 1,400 direct calls still have import and
module-identity impact. Retained location is not automatic approval.

The ten moving call sites now have source-linked path dispositions:

- Snapshots resolve the household directory through the injected DataService,
  strip its appended `.yml`, then retain existing timestamp/ID naming. The
  directory is independent of the adapter source location. Listing includes
  malformed files with fallback metadata. Filename-substring lookup, not stored
  `id`, selects a requested snapshot; an absent match uses the latest filename.
  If that file is malformed, loading returns null, not an older valid record.
- Temporary printing uses `os.tmpdir()` and `gratitude_card_<clock()>.png`, not
  a household/source directory. It writes raw bytes before the cleanup scope,
  passes all non-buffer options to the printer, and preserves the awaited result
  or exception. Cleanup inside `finally` is best-effort; a write failure occurs
  before that scope. Filename collisions are not fixed by this migration.

Two new `registrations` cases characterize snapshot fallback/listing and the
printer's class/port identity, bytes, options, result and job-construction failure.
Existing successful/failed-print cleanup cases remain linked, and the original
one-case adapter Vitest suite now passes unchanged in isolation. Native candidate
package identity, broader namespaces and crash/concurrency behavior remain open.
The adapter guideline's existing raw `path` prohibition also requires a policy
disposition under IMP-BASE.02; current imports do not grant a migration exemption.

The parser resolves imported bindings, not every identifier with the same name.
A miniature independent source probe verifies that a shadowing parameter's call
is excluded while supplying the real imported function as a value is retained.
Argument and definition records use byte positions, source spans and hashes;
they do not copy runtime data or private absolute source literals into the packet.

## Indirect references do not disappear at the package boundary

`nonCallPolicies` records exact files, primitive names and reference locations:

- Content directory selection passes `dirExists` to `Array.find`; gaming effect
  construction passes `ensureDir` to `forEach`. Both still perform filesystem
  operations even though the imported symbol is not the call's callee.
- Canvas and Health archive-mirror adapters install whole default IO objects.
  Supplying an override replaces that object. School catalogs, records and
  calculator stores instead select defaults per method with `??`. These are
  different injection contracts and must retain their current selection rules.
- Fitness emergency lock, household shutdown and profile stores capture
  individual constructor defaults. Their paths, loaders and failure treatment
  differ: malformed shutdown configuration is an invalid state, whereas a bad
  Fitness emergency-lock record becomes null. A common storage helper must not
  erase that difference.
- State Gates captures an atomic-save default separately from its strict reader
  and path resolver. Fitness reconstruction supplies `loadYamlSafe` to a local
  archive helper through an object. Those dependencies remain caller-owned.
- Four imports have no lexical references. They remain import/loader impact,
  not evidence of an operation and not permission for unrelated cleanup.

These dispositions identify what each non-call reference does and where it
goes. They do not expand every downstream injected-method invocation or certify
every caller's path validation and concurrency behavior.

## FileIO itself is not one uniform storage contract

The 77-entry primitive catalog preserves distinctions that a facade must not
silently normalize:

1. Permissive reads, strict reads and extension-resolving reads differ. In
   particular `loadYamlFromPath` hides read/parse failures, while
   `readYamlFromPath` throws. Async existence checks suppress only ENOENT.
2. In-place writes, same-directory staging/rename, exclusive creation, appends
   and caller-owned streams/descriptors have different outcomes and lifetimes.
   Most helpers create parents, but strict text and exclusive async binary
   writes do not. Default creation modes are not a promise of restrictive modes.
3. Only the YAML atomic helper's explicit `durable` option fsyncs the staging
   file and containing directory. A directory-fsync failure can occur after
   rename made the new target visible. None of this supplies a transaction
   across a read/modify/write workflow or multiple files.
4. Lexical containment is not realpath confinement. The current helper strips
   leading parent traversal segments before checking the result; it does not
   reject every input containing `../`. Preserve behavior without declaring it
   a general authorization boundary.
5. `find*ByPrefix` shares a module-level directory listing cache keyed by path
   and directory mtime. A duplicated module can duplicate cache state. Matching
   uses existing enumeration order, numeric-prefix normalization and extension
   lists; it is not a freshly sorted content index.
6. `saveImage` performs HTTP and a direct stream write to `folder/uid.jpg`.
   The suffix is not image conversion. It reuses files younger than 24 hours,
   has no atomic replacement or failed-download cleanup, and a returned writer
   rejection is not turned into `false` by the surrounding synchronous catch.
   `createImageIO` captures a root for that callback; factory construction itself
   does not download. Inventory must never run it against real providers.

The image path is traced through the only direct external `saveImage` caller,
`HarvesterImageStore.save`, and its installed composition/factory chain into
Infinity's image handling. ConfigService supplies an explicit image root or the
media root's `img` child. The table key and item UID supply the filename parts.
Infinity treats a resolved `false` as completion and still rewrites its public
image URL; a rejection instead warns and retains the original URL. The callback,
configured root and extensionless public URL are separate preserved contracts.
This chain is source-reviewed, not an executed provider or image-serving test.

## Consequences for the proposed public entry

The proposed FileIO entry remains platform **system** code, with D5/D10 intact.
Its caller count does not make it legal inside an application or domain. Domain
workflows use semantic injected operations; adapters retain path/codec mechanics.

FileIO derives no data root from its own module directory. Its callers supply
paths; moving this implementation does not move their persistent trees. However,
its `js-yaml` and `axios` resolution and module/cache identity still require
package verification. A clock-only import from the current mixed barrel loads a
larger graph, but is not itself a call to FileIO or an image download. The later
approved per-symbol barrel split remains a distinct import change.

For IMP-SHARED.04, freeze each affected edge's imported/local spelling, carrier,
function reference, call arguments, constructor default and callback identity.
Use the source spans to approve caller-specific namespace/resource dispositions
and affected tests. Reversal restores the import/instance graph; it never copies
old data over records written since cutover.

The Health archive CLI's `IO-DEFAULT-MIRROR` supplier chain is now source-reviewed
in [storage authorities](storage-authorities.md#health-archive-cli-explicit-path-supplier-and-alternate-io-authority),
including its alternate injected IO, source-relative defaults and separate
manifest writer. This is not a runtime acceptance result.

Remaining work is explicit: classify the other generic path suppliers and the needed
downstream invocations; cover installed/private operator provenance separately;
finish the public-symbol/consumer acceptance matrix. The PRE-2.3.1 checkbox stays
open. A complete binding census is evidence toward that exit, not the exit itself.
