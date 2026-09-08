# Combined selected-boundary edit proof

`combined-boundary-review.json` verifies that ten concrete source-edit plans
compose. It reads original protected source and applies edits to strings in
memory only. It never creates a candidate tree, changes imports on disk, installs
packages, executes a test body, evaluates proposed code or starts a controller.

The checked sequence is:

1. Merge the 541 utility, 26 utility-reference, 303 FileIO, seven FileIO-reference,
   87 HTTP middleware, 32 logging and 41 rendering/font edits by original source
   span; reject overlapping ranges and stale before-text.
2. Apply Feed's ten anchored changes.
3. Apply Homebot's eleven anchored/word-counted changes.
4. Apply the household boundary's eighteen anchored changes.

**Result: 1,076 edit groups across 835 existing files**, including 823 parsed
JavaScript/TypeScript files, eleven documentation files and one stylesheet-comment
edit. Eighty-two files receive changes from more than one specification,
including `app.mjs`, `bootstrap.mjs`, Gratitude API
composition, `GratitudeHouseholdService`, `AssignItemToUser`, system time,
`YamlObservationStore` and HTTP error middleware.

All resulting JavaScript/TypeScript texts parse; no Sass build is claimed.
The 35 proposed new source paths are unique: thirteen integration files,
twenty-one platform facades and one system locator. Each stored source hash
matches its specification, and Feed/Homebot agree on the same canonical Gratitude
factory. Full modified source is not copied into a second authoritative tree;
the report retains source/planned hashes and the ordered specification/edit IDs.

Four deliberate verifier defects fail as expected: wrong source-span text,
overlapping edits, a removed Feed anchor and the wrong Homebot rename count.
The unmodified selected sequence succeeds. These prove the edit verifier notices
those defects, not that migrated product behavior is correct. They are **not**
added to the selected assertion totals or product behavioral red/restored pairs.

## What this closes—and what it does not

The earlier household report checked only the 39 Feed/Homebot/household edits.
That evidence remains valid for its narrower scope. This report additionally
checks utility and FileIO rewrites, mock targets, comments, guide updates and
SchoolCalc's local predicate changes, including their shared-file overlap. The
prior five-specification 606-edit/494-file, six-specification 909-edit/711-file,
seven-specification 916-edit/712-file and eight-specification 1,001-edit/787-file
proofs are narrower historical subsets.
The nine-specification 1,035-edit/814-file result is likewise a retained narrower
checkpoint. Rendering adds 41 edits in 22 files, with one file already touched
by another specification. Its five new source files bring the total to 35.
The current report includes FileIO's 303 imports/mock targets, seven additional
reference/structural-guard edits, HTTP's 82 imports/four guide spellings/one School
HTTP permission predicate and
logging's 30 import groups/two source-guide links. Five logging test imports split
into runtime and test-only entries without overlapping other planned edits.
The unused logging index's gated retirement is specified separately; this proof
does not perform that deletion or any of the three logging implementation moves.
The same applies to rendering's three implementation moves, nine font/notice
moves and unused aggregate retirement. Its public system font locator replaces
the earlier conditional private-path proposals; they must not both be applied.
The School stylesheet change is a license-location comment only, not a Sass
compiler pass. All rendering source/guide edits are included in the joint proof.
The exercise-library source predicate is a real source-path consumer; its exact
proposal and extracted-predicate counterexample are in `fileio-reference-review.json`.
The exact School HTTP old-or-public permission in `http-boundary.json` composes
with the utility rules already proposed in the same School architecture test;
the joint proof rejects overlapping spans and preserves all other assertions.

The following remain mandatory:

- Remaining foundation exports/consumers and actual source relocations, not just
  destination projections for edited files.
- Complete manifest/dependency/lock, alias, build/watch, discovery and enforcement
  changes, combined with these edits.
- Candidate-selectable test drivers and real baseline/candidate contract runs.
- Native public/private package identity, FileIO mocks/lazy imports/cache,
  rendering/browser assets, controller activation and deployment-image proof.
- Separate approval/reproduction of the two stale Home Automation test repairs.

Thus the selected source-edit composition is verified; the full migration or
Gratitude rehearsal is **not** verified or authorized. See **IMP-SHARED.04.1**
and **IMP-SHARED.04.2/04.3/04.4/04.5** for acceptance and rollback. Reversal must restore the coherent source/import/
package graph, not leave a partial set of these edits in place.
