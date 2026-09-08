# FileIO references beyond module imports

Status: tracked literal/reference census and exact additional edits specified;
no existing source, tests or guidance changed. Reproduce with the dedicated
`tooling/review-fileio-references.mjs`; machine evidence is
[fileio-reference-review.json](fileio-reference-review.json).

## Census and dispositions

All 13,083 protected artifacts are accounted for: 12,983 regular UTF-8 text
files, 98 binary files and two unfollowed symlinks. Exact `FileIO`/`file-io`
occurrences total **778 in 388 files**; all 297 matching JS/TS files parse.
The separate utility scan already parsed all 9,273 JS/TS sources, including valid
embedded-NUL strings. This scan does not evaluate modules or read private data.

| References | Disposition |
|---|---|
| 303 import/mock occurrences | Link the exact existing FileIO edit IDs; no duplicate changes |
| 48 namespace identifiers | Five declarations plus 43 property references; keep namespace access and lazy timing |
| 334 historical occurrences | Preserve dated plans, audits and roadmap examples as baseline evidence |
| Five authoritative ruling occurrences | Preserve D5/D10 text; facade names do not grant filesystem access to forbidden layers |
| Four occurrences in three enforcement regexes | `apps-no-fileio`, `api-no-fileio`, `composition-no-fileio` depend on old spellings; IMP-BASE.02 must enforce resolved semantics across old/new/public paths |
| Four old-path fixture occurrences | Keep current layer regression cases; new-path coverage supplements them |
| Three reference examples and three source links | Six exact spelling-only future edits, preserving behavior and layer rules |
| One corpus-isolation regex | Exact guard repair below; this is an executable source dependency, not a comment |
| Remaining 73 occurrences | 60 conceptual/source-header comments, five diagnostic labels, four distinct error-type references, three retiring-barrel occurrences and one utility import |

The JSON is the non-overlapping population authority. `FileIOError` is a separate
error class, not a filesystem API. The original FileIO source header stays intact
with its byte-preserved implementation. Generic mentions in reference prose and
the old layer-tree illustration do not justify changing authoritative rules;
global reference/tree alignment stays with IMP-BASE.02.

## A concrete hidden dependency: exercise-library corpus guard

`backend/src/1_adapters/reference/exercise-library/YamlExerciseLibraryRepository.test.mjs`
reads its sibling adapter's source and matches the exact old FileIO import.
It requires **only `fileExists` and `loadYamlSafe`**, then rejects ten filesystem
or corpus-walking spellings. This protects the manifest-only reader shared by
Fitness and School, avoiding traversal of an online-only media corpus.

The experiment extracts the original regex and forbidden-token array as data;
it never imports the test/adapter or reads that corpus. Observations:

1. The original predicate accepts original source.
2. Applying only the already specified public import causes the expected
   `FileIO import block` failure.
3. A proposed exact old-or-public regex accepts both original and retargeted
   source, without changing the two-symbol assertion or any forbidden token.
4. An additional `loadYaml` import, the private entry, and each of the ten
   forbidden tokens still fail their respective predicates.
5. Restoring the clean public source passes again.

These **17 extracted-predicate observations are not original Vitest execution**,
new product-contract cases or additions to the product mutation pairs.
The token-in-comment controls intentionally preserve the existing broad source
guard; this planning work does not relax it into an AST-only check.

The seventh additional edit is the exact regex replacement. Its before/after
text, original source span and hashes are recorded. Only the two intended
specifier spellings match; private, wildcard and unrelated platform entries are
not admitted. Execute the original suite after separate approval, preserving its
assertion body, corpus prohibition and test population.

## Combined changes and remaining gates

All seven additional edits join the other selected specifications in the
[combined proof](combined-boundary-review.md), which records the current exact
source/documentation/new-path and overlap counts. Everything composes in memory.
No application source or existing test is written.

This closes the named tracked-text occurrence adjudication, not arbitrary
computed/split/eval-generated paths, untracked operator scripts, installed writer
provenance or native package behavior. Three old-spelling layer predicates remain
an explicit enforcement prerequisite, and the original corpus-isolation suite
still needs safely isolated execution. Pair these records with
`IMP-BASE.02`, `IMP-BASE.03` and `IMP-SHARED.04.2`; migration approval is separate.
