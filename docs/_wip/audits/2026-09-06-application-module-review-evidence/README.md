# Application-module review evidence

Recovered for the 2026-09-06 completeness audit. This packet closes the review
record's handoff, provenance and package-experiment evidence gaps. It does not
execute the pre-implementation checklist or any migration work package.

| Gap | Closure | Evidence |
|---|---|---|
| Stale WP-01/WP-02/03 handoff | Current handoff begins at PRE-1 and expressly defers protected-file repairs, package adoption and extraction | [Review record](../../plans/2026-09-05-application-module-adversarial-reviews.md) and [preparation scope](../../plans/2026-09-05-application-module-preimplementation-plan.md#scope-boundary) |
| Unversioned review sequence | Five dispatch inputs, their revision windows, seven original reviewer responses, and exact snapshot hashes are retained | [Index](index.json), [patch history](patches.json), rounds below |
| Unreproducible synthetic package results | Recovered fixture templates plus an isolated runner reproduce accepted and rejected layouts on the original Node/npm versions | [Instructions](../../../../tests/preimplementation/application-modules/experiments/review-package-resolution/README.md), [fresh output](package-results.json) |

## Provenance and limits

The original author and three reviewer session records were recovered locally.
Only task-relevant reviewer responses and document edits are preserved here;
private raw sessions, unrelated conversation and internal reasoning are not
published. `index.json` records source session/message identities, source line
numbers and UTC timestamps. Project and temporary path prefixes in exported
material were normalized; fixture recovery separately records hashes before and
after that normalization. These are recovered records, not cryptographic proof
of reviewer identity or independently signed approvals.

`changes/*.diff` provides context-free revision previews; `patches.json` retains
the original patch context used to reconstruct the historical documents.

`snapshots/*.txt` contains immutable historical document text reconstructed by
replaying the original edits. SHA-256 names identify content, not review dates.
They are evidence, not alternate active plans; their original relative links
are interpreted from the original repository path named in `index.json`.
The initial source/reference baseline is the full commit in that index. Eight
binding reference files have commit-qualified hashes there.

Dispatch snapshots identify the documents at each round's start. The timestamped
patch history also preserves changes made while reviewers were working, including
Round 2 inventory corrections and the Round 5 ordering fix. A round's `revised`
snapshot is the state before the next dispatch (or final closure record). For
Rounds 1–4 it is byte-identical to the next round's input. Reviewer responses
precede the following dispatch; Round 5 includes a separate response explicitly
closing its corrected finding. The five rounds reused three reviewers, as the
original requirement allowed.

The reconstruction also exposes later changes: the consolidated documentation
commit added the preparation checklist and its narrower scope links after the
five-round review. [The post-review plan diff](changes/post-review-2026-09-05-application-module-migration-plan.md.diff)
and [roadmap diff](changes/post-review-2026-08-31-full-stack-application-modules.md.diff)
separate those additions. This audit's evidence links are later documentation
edits too; the historical review does not certify arbitrary future plan edits.
The current source/reference/package state must be revalidated before execution.

## Sequential rounds

### Round 1

Reviewer: `architecture_review_r1`. Dispatch: `2026-09-05T21:55:01.755Z`.
Input plan: [375 lines](snapshots/1dec3bf77b21796bde0a0e70bef07a30ddd4e80866ee92b3eb1515967ee54023.txt); [revised plan](snapshots/2b4881702716b936670fafa7700b73b70589ed86daa2ba8795d4c719a7959766.txt).
All accompanying document snapshots and full hashes are indexed in
`index.json`; absent Round 1 inventory/review documents are not backfilled.

- [Original reviewer response 1](reviews/round-1-1.md), `2026-09-05T21:57:12.121Z`.
- Revisions: [PATCH-06](changes/PATCH-06.diff), [PATCH-07](changes/PATCH-07.diff), [PATCH-08](changes/PATCH-08.diff).

### Round 2

Reviewer: `architecture_review_r2`. Dispatch: `2026-09-05T22:02:37.189Z`.
Input plan: [1,162 lines](snapshots/2b4881702716b936670fafa7700b73b70589ed86daa2ba8795d4c719a7959766.txt); [revised plan](snapshots/2ee720a1c1511870206f057500f75ad3dd08f03708fdb6dffb045ba4cf85cc82.txt).
All accompanying document snapshots and full hashes are indexed in
`index.json`; absent Round 1 inventory/review documents are not backfilled.

- [Original reviewer response 1](reviews/round-2-1.md), `2026-09-05T22:06:47.915Z`.
- [Original reviewer response 2](reviews/round-2-2.md), `2026-09-05T22:11:30.425Z`.
- Revisions: [PATCH-09](changes/PATCH-09.diff), [PATCH-10](changes/PATCH-10.diff), [PATCH-11](changes/PATCH-11.diff), [PATCH-12](changes/PATCH-12.diff), [PATCH-13](changes/PATCH-13.diff), [PATCH-14](changes/PATCH-14.diff).

### Round 3

Reviewer: `architecture_review_r1`. Dispatch: `2026-09-05T22:12:15.072Z`.
Input plan: [1,259 lines](snapshots/2ee720a1c1511870206f057500f75ad3dd08f03708fdb6dffb045ba4cf85cc82.txt); [revised plan](snapshots/9f520f5dfc874403404732f3a0655ab285f38f428580e533dfbbc2148a8815f6.txt).
All accompanying document snapshots and full hashes are indexed in
`index.json`; absent Round 1 inventory/review documents are not backfilled.

- [Original reviewer response 1](reviews/round-3-1.md), `2026-09-05T22:14:46.056Z`.
- Revisions: [PATCH-15](changes/PATCH-15.diff).

### Round 4

Reviewer: `architecture_review_r2`. Dispatch: `2026-09-05T22:15:38.536Z`.
Input plan: [1,303 lines](snapshots/9f520f5dfc874403404732f3a0655ab285f38f428580e533dfbbc2148a8815f6.txt); [revised plan](snapshots/fd9523b3a759a7ceca9c7139a6e356da0273c49310d9824b5f1d5408c319939c.txt).
All accompanying document snapshots and full hashes are indexed in
`index.json`; absent Round 1 inventory/review documents are not backfilled.

- [Original reviewer response 1](reviews/round-4-1.md), `2026-09-05T22:18:04.119Z`.
- Revisions: [PATCH-16](changes/PATCH-16.diff).

### Round 5

Reviewer: `architecture_review_r5`. Dispatch: `2026-09-05T22:19:01.523Z`.
Input plan: [1,380 lines](snapshots/fd9523b3a759a7ceca9c7139a6e356da0273c49310d9824b5f1d5408c319939c.txt); [revised plan](snapshots/0a201ac91558f2709d2a151855052036a3a8bee8de23b355c12b3310d96234fe.txt).
All accompanying document snapshots and full hashes are indexed in
`index.json`; absent Round 1 inventory/review documents are not backfilled.

- [Original reviewer response 1](reviews/round-5-1.md), `2026-09-05T22:21:44.253Z`.
- [Original reviewer response 2](reviews/round-5-2.md), `2026-09-05T22:22:38.161Z`.
- Revisions: [PATCH-17](changes/PATCH-17.diff), [PATCH-18](changes/PATCH-18.diff), [PATCH-19](changes/PATCH-19.diff).

## Package reproduction

The [fixture](../../../../tests/preimplementation/application-modules/experiments/review-package-resolution/README.md)
preserves 33 source/manifest/lock files with only temporary path normalization.
Synthetic tarballs are rebuilt from those sources, so reproduction requires no
original cache, temporary folder or session access. Historical locks are retained;
each fresh install produces a new lock and clean `npm ci` consumes it.

The [captured output](package-results.json) records the exact Node/npm versions,
execution time, OS/architecture, input hashes, expanded commands, stdout/stderr
and exit codes. With Node 22.22.0/npm 10.9.4:

| Layout | Install | Clean reinstall | Forward/reverse import checks |
|---|---|---|---|
| Sibling facade and facets | Pass | Pass | Four passes; expected versions, separate cross-facet state, same-facet identity and private-path rejection |
| Recovered ancestor/local-link facade and descendant facets | Pass | Pass | Four expected `ERR_MODULE_NOT_FOUND` failures for `@probe/timezone` |

This fresh experiment does not reproduce every abandoned ancestor layout and
does not certify actual Moment versions, React identity, native modules, browser
bundles, lifecycle scripts or Linux images. The historical actual-dependency
observations remain historical; PRE-7.3/WP-03 must establish the applicable real
dependency evidence. No production installation policy is inferred from the
fixture's offline, script-disabled npm commands.

## Verify the packet

From the repository root:

```sh
python3 docs/_wip/audits/2026-09-06-application-module-review-evidence/verify.py
```

This read-only check verifies all indexed snapshot/response hashes, replays 19
document patches, checks five sequential review windows and final R5-01 closure,
compares post-review deltas with the consolidated commit, checks eight immutable
binding-reference hashes, and reconciles all eight captured package cases against
the preserved fixture and runner hashes. It does not rerun npm; use the fixture's
reproduction command for fresh execution. A verifier pass is evidence integrity,
not a claim that migration or preparation is complete.

The active handoff is [PRE-1](../../plans/2026-09-05-application-module-preimplementation-plan.md#phase-1--establish-scope-baseline-and-safe-execution),
starting at PRE-1.1.1. No PRE checkbox was changed by evidence recovery.
