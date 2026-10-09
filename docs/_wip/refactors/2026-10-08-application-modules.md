# Application modules: ownership cutover

Status: **Milestone 1 implemented and verified; local checkpoint uses the original confined commit hook.** Milestones2 and3 are authorized and in progress; this does not authorize deployment.

Gratitude backend, browser/admin UI and assets now have one owner under `modules/gratitude`. The ordered household projection and FamilySelector live under `capabilities/household-identity`. Explicit composition/public entries preserve existing HTTP/UI/storage/config/events and Feed, HomeBot and Fitness consumers; native rendering remains lazy. Canonical backend/frontend dependency identities are retained.

- [Approved scope](../plans/2026-10-08-gratitude-module-proof.md)
- [Execution ledger](../plans/2026-10-08-gratitude-module-proof-progress.md)
- [Owner boundaries and migration bridges](../../../modules/gratitude/README.md)
- [Reproducible confined Linux verification](../../../tests/preimplementation/application-modules/tooling/landlock-README.md)
- [Broader roadmap](../../roadmap/2026-08-31-full-stack-application-modules.md)

Verified:59 backend and25 browser assertions match the captured baseline by name;6 stored-shape and61 selected integration assertions pass. Ordinary native ESM import succeeds without the test loader. The actual sanitized Vite build transforms13,581 modules and includes the moved UI/styles/icons; artifact and protected-input checks pass. Working/index layer, filesystem and ESM destination controls, Vitest discovery and SCSS discovery are covered. UI token ratchets retain their pre-existing selected scope.

The branch incorporated main `6cf8670352` at its final checkpoint. Tag `pre-application-modules-cutover-2026-10-08` identifies the original comparison baseline `b304cdf810`; any future cutover rollback must preserve intervening main changes.

Limits: no Docker image build, deployment, real printer/device/provider or production data execution. The build stages tracked inputs without private `.env`, preserves canonical installed dependencies, and separately copies public assets byte-for-byte because the filesystem policy denies timestamp mutation; Vite-generated outputs supersede their exact public filename collisions. The unrelated TCP infrastructure suite was not run; its Gratitude envelope/publication behavior is exercised by CASE-GR-HTTP-14. Milestone2 Piano/host/playback implementation is under final verification; complete remaining ownership is Milestone3, still in progress.

- [Milestones2–3 execution plan and complete census](../plans/2026-10-08-application-modules-m2-m3.md)
- [Current execution ledger](../plans/2026-10-08-application-modules-m2-m3-progress.md)
