# Korean 3-2 choice revision QA

The immutable choice repair covers Lessons 2–16 (30 revised forms, 15 repinned units). Lesson 1 remains exactly BCDABC / DABCDA, at revisions f98f3af32 / 88cc84fc9. No question IDs, prompts, keyed answer text, cards, media, deck order, enrollment, issued snapshots or allocations change.

The new deterministic authoring schedule requires all four answer-position counts to differ by at most one, rejects three consecutive repetitions of blocks of length one through four, and requires paired forms to differ at at least half of the question positions. Rebuilding from a completed lexicon reuses existing canonical cards and produces the same course.

`cli/korean-course-repair.cli.mjs --base <content-base> --out <stage>` defaults to preview. It verifies the current source against each pinned immutable artifact, expands each live deck against the lexicon, validates the exact card/question roster and publishes the old and new pairs in staging. The revision manifest records byte hashes for every source/unit, prior/new revision IDs and prior/new keys. `choice-quality.json` records all 32 QA results.

Activation uses the same command plus `--apply`. It requires a matching previous preview and unchanged staging/base hashes, completes every append-only publication before changing sources or unit pins, and rechecks the base immediately before those changes. The ordinary install operation remains append-only and rejects differing existing sources/units. Existing published answers and allocations remain untouched. A filesystem interruption during the final file replacements is not a multi-file transaction; retained immutable artifacts and the before/after manifest provide the recovery references.

Evidence:

- RED: course-wide key quality failed with position-count difference 6 (all-A six-question form); after repair, the assembly quality/determinism/canonical reuse regression passes.
- RED: repair scope and preparation functions were absent; GREEN: permutation-only/pins-only guards, immutable pilot, deterministic/idempotent 32-form preparation pass.
- RED: the dedicated activation CLI was absent; GREEN: preview leaves base untouched, stale saves are refused, apply retains the original published all-A bank, repeat preview/apply succeeds.
- Ten focused authoring/enrollment/repair tests pass across four files.
- Read-only household preview validates 32 forms, stages 30 immutable new revisions and 15 unit pin updates.
- The actual PDF renderer produced 32 full forms plus 16 two-question retries. Their 48 actual allocated row mappings were decoded as correct bubbles and passed through `ResolveCardScan` with 100% earned points and every row correct. Evidence is in `proofs/report.json` and `print-scan-quality.json` beside the staging revision manifest. No physical printing or live grading occurred.
