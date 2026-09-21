# Media stable-core release design

**Status:** Approved in chat on 2026-09-20; production deployment remains separately authorized.

## Intent

Create a trustworthy deployable baseline from the 11 fully accepted media stories, then continue the remaining 71 stories incrementally from that baseline. Deployability means the exact candidate is clean, reproducible, documented, and passes repository gates plus end-to-end regression of every accepted story. It does not mean the 82-story redesign is complete.

## Release boundary

- Product/test history freezes at `bf9edf3d21959c1a6afd8329b2065c9c2b4adba4`.
- The release candidate contains the 11 accepted stories and their committed supporting fixes/tests.
- Unfinished HOUSE.3a work and the older uncommitted queue/Previous work are preserved outside the release candidate and are not represented as shipped.
- The acceptance ledger and refactor status page must distinguish deployed/accepted stories from the unfinished 82-story objective.
- No production write, merge, push, container replacement, or kiosk reload occurs during candidate preparation.

## Isolation and provenance

Create a new named release-candidate worktree from exact `bf9edf3d`. Never clean or reset the dirty implementation worktree. Bring in only reviewed documentation changes needed to describe the stable core. Record the full SHA, clean `git status`, build artifact identity, commands, exits, and runtime logs.

## Verification gates

Run on the clean candidate, stopping on the first load-bearing failure:

1. Parse, SCSS, layer/filesystem, UI-token, and scoped lint gates.
2. The repository Vitest gate and the normal non-live test command.
3. A production frontend build from the exact candidate.
4. A serial end-to-end regression manifest covering all 11 accepted stories and all 32 accepted criteria, reusing the previously reviewed ordinary-device journeys. Every story must map to a passing runtime assertion; no skip or indirect component-only evidence is allowed.
5. `scripts/deploy-gate.sh` as a read-only household-activity check only after all code/test gates pass. A blocked gate means “not deployable now,” never permission to override it.

The full 82-story objective remains active even when this stable core passes.

## Failure handling

- Product failure: reproduce with a failing test, repair on the release-candidate branch, rerun the affected gate and the full accepted-story regression.
- Harness/provenance failure: repair test infrastructure only after proving product behavior was not bypassed; rebuild the exact candidate.
- Unrelated repository failure: record the exact pre-existing failure and determine whether it blocks safe deployment. Do not relabel a red gate as green.
- Household activity gate blocked: stop before build/deploy operations that affect production; retry only when authorized and safe.

## Handoff

When all gates are green, provide the candidate SHA, test counts, runtime manifest, artifact identity, remaining dirty-work location, and deploy-gate result. Then use the branch-finishing workflow to ask whether to merge, create a PR, or keep the branch. Actual deployment requires a separate explicit instruction and a fresh deploy gate immediately before replacement.
