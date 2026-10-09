# Gratitude module proof

Approved 2026-10-08. Baseline: `b304cdf810`; branch: `refactor/application-modules`.
This is the first implementation checkpoint, not authorization for the whole migration or a production cutover.

## Global constraints

- Work only in the application-modules worktree. No main edits, deployment, production-container actions or changes to host privileges. Commits on this branch are authorized by persistent host/session authority, but normal hooks must pass in a permitted execution environment; never bypass them.
- Preserve HTTP, UI, storage/configuration, permissions, events and lifecycle behavior. No runtime discovery/enablement or data migration.
- Do not relocate product source or execute product fixtures until a synthetic isolated baseline gate passes.
- Use verified kernel isolation with synthetic fixtures, no production data, host devices, Docker socket, secrets or network. The user's subsequent instruction to overcome blockers authorizes the proven unprivileged Landlock+seccomp path in place of the original container-only choice. Availability alone is not isolation proof.
- Denied runner access must fail closed. Do not fall back to unsandboxed execution, sudo, group changes or alternate privileged access.
- Preserve canonical dependency identity/version; root and backend uuid/moment versions differ, while React/Mantine belong to frontend dependencies.
- One owned implementation, runtime registration and writable data authority. No blanket legacy re-export tree.
- Sol implements; Luna may inventory; Astra decides/reviews. Serialize implementation edits and retain explicit evidence of tests actually run.

## Task 1 — Dedicated runner preparation (historical approach, superseded)

The original approved approach was to create a concrete local dedicated container setup/run contract, denial-control fixture and fail-closed invocation under `tests/preimplementation/application-modules/`. Provisioning is an operator prerequisite, not an action to take through existing production infrastructure. Specify an exact immutable image reference requirement, read-only source, task-owned scratch/output, restricted process/filesystem/network/device access and resource bounds. Explicitly distinguish fixture execution and build profiles. Invocation must not accept arbitrary privileged Docker flags, host mounts or a fallback transport.

Add focused Node tooling tests using injected process execution/synthetic files. They must verify argument policy, invalid configuration, denied execution, and that no product process starts before preflight success. Actual container denial controls must test the claimed boundary, including synthetic denied filesystem access and network/device/process behavior; mock tests must not be described as isolation proof. Provide reproducible provisioning and invocation instructions without granting access to a broad Docker socket.

Exit: preparation artifacts and safe unit tests pass; live runner gate remains visibly blocked until authorized provisioning and real controls succeed.

## Task 2 — Destination architecture gate preparation (independent safe work)

Extend actual layer and direct-filesystem enforcement to `modules/<owner>/server/{domain,application,adapters,api,rendering,composition}` and equivalent `capabilities` trees. Exercise working-tree and staged paths with synthetic temporary repositories/in-memory fixtures. Preserve the existing legacy ratchet and illegal-FS policy. Add meaningful red/restored controls; no product relocation or runtime imports.

Exit: focused tooling tests pass and existing static audits report no regressions. This prepares only these gates; discovery, build, package and full artifact certification remain Task 3.

## Task 3 — Complete destination tooling and baseline (runner prerequisite)

Before product moves, prove test discovery (`scripts/gate-vitest.mjs`, Vitest/Jest configurations), resolution, SCSS/assets, relevant UI/CSS/ESM checks, and `docker/Dockerfile` inputs see destination trees. Use actual tools plus broken/restored controls. Preserve canonical backend dependencies through narrowly enumerated composition-owned migration facades with explicit consumer/removal lists; anchor browser dependencies to frontend resolution and deduplicate React. Do not introduce repository-wide npm workspace conversion.

Run selected current Gratitude preparation cases and existing tests: stored-shape and PrintSelectionService tests; colocated card-print, presentation, router-card and temporary-print tests; HomeBot ProcessGratitudeInput/AssignItemToUser/EventRouter, infrastructure-seams-contract and Feed AdapterProvides tests. Close explicit gaps for router dispatch, raw Feed data, browser/admin registration and Fitness printing. Record named assertion inventories and current source hashes; no skipped or unexecuted assertion counts as parity.

## Task 4 — Full-stack extraction (green baseline prerequisite)

Create `modules/gratitude/server/{domain,application,adapters,api,rendering,composition}` and explicit `public.mjs`/`print-gateway.mjs` entries; browser implementation, SCSS, admin editor, assets and public/admin entries live under `modules/gratitude/browser`. Move owned implementation/tests once.

Extract the ordered household user projection to `capabilities/household-identity/{server,browser}/public` entries. Preserve the existing bootstrap URL/response/default-versus-query semantics and independent HomeBot household repository.

Inject the actual `dataService` into the owner factory (current bootstrap closes over it despite receiving an unused `userDataService`). Keep explicit installed composition/mount order and renderer import-failure behavior in app/composition.

Feed receives only `readSelectionQuotes`, preserving its literal default-household raw selection read, shuffle, output and errors. HomeBot receives only `addSelections` with unchanged arguments/batch semantics. Move GratitudeEvents with unchanged publication payload/count/return. Move TemporaryImagePrintGateway with its current owner and expose its narrow composition entry to existing Fitness composition consumer. Preserve temporary filename and cleanup behavior.

Update appRegistry/Admin editor imports, retaining catalog IDs, labels, paths and `gratitude/config` authority. Keep shared rendering helpers/fonts canonical. No duplicate implementation or runtime activation redesign.

## Task 5 — Proof certification and checkpoint

Run the same named before/after assertions, destination controls, discovery inventory, architecture/FS/ESM/parse/SCSS checks, frontend build and image import/assets checks in the provisioned runner. Review the whole diff. Incorporate committed main changes at agreed integration checkpoints, never while another agent has uncommitted shared-file work; invalidate affected receipts and rerun relevant checks.

Deliver evidence, remaining failures, migration-facade removal conditions, and actual effort/model usage. Stop at this checkpoint before scaling. Production cutover is outside this milestone.

## Known execution prerequisite

Docker access, sudo, bubblewrap and unshare remain unavailable, but those mechanisms are no longer prerequisites. Landlock ABI 8 and a real unprivileged Landlock+seccomp Node proof succeeded: scratch operations and Node threads work; outside/host file contents, writes, symlink escapes, networking, process spawning and cross-process privileged channels are denied. The actual Gratitude harness now passes all 59 cases under explicit source-file/dependency allowlists with live denial controls and input integrity checks. Existing browser/selected Vitest baselines and confined hooks are next. Tasks 4–5 remain gated on relevant current behavior baseline success; no namespace or container is required merely for its own sake.
