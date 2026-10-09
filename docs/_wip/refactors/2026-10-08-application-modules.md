# Application modules: ownership cutover

Status: **Milestones 1 and 2 are checkpointed. Milestone 3 source ownership and selected compatibility are verified; native calculator artifact acceptance remains incomplete.** Source checkpoint `646caba119` passed the original confined commit hook. No deployment or merge into main is claimed.

Gratitude backend, browser/admin UI and assets now have one owner under `modules/gratitude`. The ordered household projection and FamilySelector live under `capabilities/household-identity`. Explicit composition/public entries preserve existing HTTP/UI/storage/config/events and Feed, HomeBot and Fitness consumers; native rendering remains lazy. Canonical backend/frontend dependency identities are retained.

- [Approved scope](../plans/2026-10-08-gratitude-module-proof.md)
- [Execution ledger](../plans/2026-10-08-gratitude-module-proof-progress.md)
- [Owner boundaries and migration bridges](../../../modules/gratitude/README.md)
- [Reproducible confined Linux verification](../../../tests/preimplementation/application-modules/tooling/landlock-README.md)
- [Broader roadmap](../../roadmap/2026-08-31-full-stack-application-modules.md)

Verified:59 backend and25 browser assertions match the captured baseline by name;6 stored-shape and61 selected integration assertions pass. Ordinary native ESM import succeeds without the test loader. The actual sanitized Vite build transforms13,581 modules and includes the moved UI/styles/icons; artifact and protected-input checks pass. Working/index layer, filesystem and ESM destination controls, Vitest discovery and SCSS discovery are covered. UI token ratchets retain their pre-existing selected scope.

The branch incorporated main `6cf8670352` at its final checkpoint. Tag `pre-application-modules-cutover-2026-10-08` identifies the original comparison baseline `b304cdf810`; any future cutover rollback must preserve intervening main changes.

Limits: no Docker image build, deployment, real printer/device/provider or production data execution. The build stages tracked inputs without private `.env`, preserves canonical installed dependencies, and separately copies public assets byte-for-byte because the filesystem policy denies timestamp mutation; Vite-generated outputs supersede their exact public filename collisions. The unrelated TCP infrastructure suite was not run; its Gratitude envelope/publication behavior is exercised by CASE-GR-HTTP-14. Milestone2 Piano/host/playback is committed as9f19f9f2f7 after original-hook verification; Milestone 3 source moves and selected final replay are implemented; 17 native calculator suites remain unrun because required tools or inputs are unavailable.

- [Milestones2–3 execution plan and complete census](../plans/2026-10-08-application-modules-m2-m3.md)
- [Current execution ledger](../plans/2026-10-08-application-modules-m2-m3-progress.md)

- [Complete ownership disposition and structural census](../plans/2026-10-09-application-modules-ownership-disposition.md)
- [Final selected compatibility, build, discovery, and native-gap evidence](../plans/2026-10-09-application-modules-final-verification.json)

Final M3 evidence covers 37 selected groups: 6,388 original passing case executions, 27 added guards, 39 additional existing Health cases, and the same 11 known failed executions. The production frontend build passes with 109 owner chunks. Normal frontend discovery includes 1,748 applicable tests. The ownership/cycle and import gates pass with unchanged layer ratchets. These facts do not certify the 17 unrun calculator suites or authorize production cutover.

The calculator continuation verifies eleven original/candidate cases with the authenticated scratch assembler and no assertion changes. Current calculator coverage is 29 suites/121 cases; the missing authoritative GUI/configuration sources remain a full-acceptance gap.
