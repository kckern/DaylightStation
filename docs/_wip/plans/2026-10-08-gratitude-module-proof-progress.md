# SDD ledger — plan: docs/_wip/plans/2026-10-08-gratitude-module-proof.md

## Current goal blocker

The isolated-runner prerequisite has persisted through the implementation turn and two goal continuations. The first two turns made verified preparation progress; the latest recheck still returns exit 1, `RUNNER_BLOCKED`, because `/usr/local/sbin/daylight-module-runner` is absent. The current user cannot access the root/docker-owned socket. No live runner job exists to wait for.

The available prerequisite-independent discovery, stylesheet and static import work is complete for this checkpoint. Further extraction is gated on the approved isolated behavioral baseline; additional speculative runner scaffolding would not establish it. Goal status is blocked, not complete. Operator provisioning is the external prerequisite; afterward, integrate the actual source/dependency workloads, verify live controls, establish baseline behavior, finish native/build coverage, synchronize main and perform the extraction. Provisioning alone is not baseline certification.

All existing changes remain in the isolated worktree, uncommitted. No product code, main branch, production service or host privileges were changed by this blocker audit.

## Execution state

- Baseline and branch verified: `b304cdf810`, `refactor/application-modules`; initially clean.
- Task 1: complete (preparation only, uncommitted; scoped review clean). Real execution blocked by provisioning and workload integration.
- Task 2: complete (preparation only, uncommitted; scoped review clean).
- Tasks 3–5: pending isolated runner/baseline prerequisite. Product source remains unchanged.

## Preflight cross-task checks

| Tasks | Shared interface or file | Finding |
| --- | --- | --- |
| 1 / 3 | Runner invocation and preparation cases | Unit policy tests cannot substitute for actual container denial controls; Task 3 requires live pass. |
| 2 / 3 | Architecture paths/public entries | Task 2 covers scanner traversal/layers; resolution/discovery/build remain Task 3. |
| 3 / 4 | Destination layout/dependency identity | Root package versions differ; preserve canonical dependency resolution before moves. |
| 4 / 5 | Composition and external consumers | Include Fitness print consumer, Feed raw data, HomeBot command and household projections. |
| 1 | Setup versus execution | Preparation can be tested without Docker; no host permission modification. |
| 2 | Synthetic controls versus runtime | Only safe tooling imports and temporary synthetic trees permitted. |
| 3 | Baseline versus historical packet | Current named assertions required; historical receipts are not reused as green evidence. |
| 4 | Ownership versus runtime behavior | Explicit installed assembly stays; no activation/discovery change. |
| 5 | Certification versus deployment | Branch-only checkpoint, no production cutover. |

Ruling: Preserve the approved milestone but complete only safe prerequisite-independent work while runner access is blocked — execution denial is a real boundary, not an invitation to bypass it — cost if wrong: delayed extraction, not unsafe runtime access.

Superseded ruling: Keep changes uncommitted and maintain this tracked ledger alongside skill scratch artifacts. The original claim that the worktree lacked commit authority was incorrect; see the continuation correction below. No commit occurred during that preparation checkpoint.

## Task 1 dispatch

Fresh Sol 6.1 implementer, high reasoning, receives the task brief and global constraints. Scope: dedicated-runner package, focused tooling-only tests and narrow README integration notes. No product fixtures or privileged commands. Parent reconfirmed a sanitized runner-only build context, not the repository production Docker context. Operator provisioning may authorize a fixed audited wrapper; preparation must not grant general Docker access.

Ruling: Both runner profiles deny network socket operations, including loopback; the build profile may allow its bounded subprocesses — this follows the selected no-network constraint — cost if wrong: a future tool needing local IPC sockets requires a separately reviewed profile change.

Task 1 initial evidence: 9/9 safe Node tests passed; both invocation profiles returned `RUNNER_BLOCKED` before transport because the approved wrapper is absent. No live isolation or product-baseline claim.

Task 1 review: changes requested for root-filesystem denial accepting a permission error, discarded live-control receipt, and outer timeout shorter than the permitted build sequence. Fix round 1 dispatched to the implementer with focused test requirements and an independent in-container expiry guard.

Ruling: Future operator provisioning may use the local Docker engine solely for the fixed dedicated runner containers; it must not access or alter production containers or grant the user socket access — parent confirmed this interpretation of the selected local runner — cost if wrong: deployment topology must be adjusted before provisioning, which has not occurred.

Integration note: main has concurrent staged work belonging to another agent. Do not touch it or claim main is clean. No integration is attempted in this preparation checkpoint.

Task 1: fix round 1/5 — all three findings addressed, zero open. Read-only-root requires EROFS; result envelope preserves named live receipts; fixed in-container expiry and a 260-second outer budget cover the bounded sequence. Safe tests: 12/12 passed with no skips. Scoped Sol re-review found no new breakage. Real container/watchdog compatibility remains unverified. Runner report: `.superpowers/sdd/2026-10-08-gratitude-module-proof/task-1-report.md` (local scratch).

Task 1: complete (uncommitted, preparation review clean). This is not completion of the runnable Gratitude baseline lane.

Task 2 dispatch: fresh Sol 6.1, high reasoning; only layer/FS scripts, narrowly required classification helper, focused tooling-only tests and minimal docs. Existing ratchet unchanged. No product imports, source moves, real index writes, installs or dependency symlinks. This is the final independent implementation task before reporting the runner prerequisite.

Task 2 initial evidence: 22/22 destination/index Node cases and 65/65 existing scanner Vitest cases passed. Full static layer audit retained 44 legacy success-false findings and 46 zero counters; filesystem gate checked 2871 files with zero findings. Parent independently passed the 34-case runner+destination aggregate on that version.

Task 2 review: one P2 — destination `.js`/`.cjs` ports were discovered but the port-governance classifier only recognized `.mjs`. Fix round 1 adds consistent destination port recognition and red/green controls. The original implementation thread was unavailable at followup; the still-available Sol investigator accepted the narrow fix.

Ruling: Legacy physical-path-specific waivers remain at their existing paths and are not automatically granted to new owners — extending those exceptions by filename could silently weaken enforcement — cost if wrong: an explicitly reviewed exemption migration may be needed for a future owner extraction. The stricter destination behavior is documented.

Latest integration state (parent-verified): main advanced independently to `ac17f417a5` and is clean; this worktree and comparison tag remain at `b304cdf810`. Main changed tests and `.gitignore`; reconcile those committed changes and invalidate affected evidence before extraction. No merge occurs during this uncommitted preparation checkpoint.

Task 2 fix evidence: destination port recognition now covers `.mjs`, `.js` and `.cjs`, including legal index/barrel parity. Added eight direct-extension and four barrel controls. Final focused results: 34/34 destination Node cases and 65/65 original scanner Vitest cases; diff check clean. The 12 runner cases are unchanged. No unrelated static audit rerun was performed after the extension-only fix.

Task 2: fix round 1/5 — P2 extension recognition addressed; P3 waiver behavior explicitly documented. Scoped review found no direct fix breakage.

Task 2: complete (uncommitted, preparation review clean).

Parent final verification after the extension fixes: combined runner/destination Node tests 46/46 passed with no skips; full filesystem audit passed 2871 runtime files; final layer audit exited 0 with success-false 44 matching baseline 44 and all other counters zero. Final checks: diff whitespace clean, no backend/frontend/shared tracked changes, and an empty real worktree index.

## Checkpoint handoff

Tasks 1–2 preparation is complete; **Milestone 1 is not complete**. No Gratitude source moved and no product fixture executed. The dedicated runner is synthetic-only: provisioning alone does not make it a Gratitude baseline runner. Remaining prerequisites are approved operator setup, live denial-control success, actual source/dependency staging and selected workload integration, then destination discovery/resolver/build/artifact certification and a current behavioral baseline. Main synchronization is required before extraction.

Keep this plan's local skill workspace while the milestone remains unfinished; its reports and review packages support the uncommitted preparation. No host privilege changes, commits, merge or deployment occurred.

## Goal continuation — destination test discovery

Parent revalidated that the dedicated wrapper remains absent; no new runtime access is available. A small independent Task 3 substep is authorized: extend the real Vitest gate population to destination roots and expose a deterministic read-only listing, with synthetic filesystem/CLI controls. This does not execute discovered tests or establish baseline parity.

Commit-authority correction: host/session authority persists into this worktree and permits branch commits. The earlier lack-of-authority claim was mistaken. The actual present blocker is `.githooks/pre-commit`, whose normal sequence invokes `npm run test:composition-contracts` (product composition tests). Those tests cannot run before the approved isolation prerequisite, and hooks must not be bypassed. Thus a clean checkpoint/merge remains pending a permitted hook execution environment, not renewed user permission.

Task 3 discovery substep: the real Vitest gate now includes `modules`/`capabilities` and has a read-only JSON `--list` path. Two initial synthetic CLI controls passed (legacy/destination population, other-runner and symlink exclusions, no child/report/baseline mutation). A real read-only inventory then exposed buffered stdout truncation from immediate `process.exit`; the implementer is fixing it with synchronous output and a population larger than pipe capacity. No discovered test has executed.

Task 3 SCSS substep: same bounded Sol worker is extending actual stylesheet discovery to `modules/<owner>/browser` and `capabilities/<owner>/browser`, using real Sass on synthetic invalid/restored styles. No product style compilation or source relocation is required for this check. Docker source-copy changes remain deferred until actual source/dependency staging exists; adding nonexistent roots would break the current image build.

Discovery verification: 3/3 synthetic cases pass, including a population larger than 128 KiB. Synchronous pipe writes were unsuitable (EAGAIN); the final listing awaits the stdout callback before exiting. A real piped inventory parsed successfully: 3,988 unique files, 262,035 bytes, including 7 Gratitude files. This is enumeration only, not execution.

SCSS initial verification: 3/3 synthetic real-Sass cases pass (invalid/restored destination styles, shared partials, aliases and preserved legacy entries). Review identified that a new global vendor exclusion would change legacy frontend behavior; it is being restricted to destination browser traversal with a legacy parity assertion.

Task 3 ESM substep: parent authorized the same worker to extend the existing static link gate to destination server files, with synthetic working/index source and package-alias controls. Source evaluation, native runtime resolution, image building and product baselines remain outside this safe static work.

Continuation completion: Vitest inventory (3 cases), real synthetic Sass compilation (3 cases) and static ESM source/index resolution (7 cases) are implemented and reviewed. The SCSS vendor correction preserves legacy frontend traversal while filtering destination vendor paths. ESM discovery covers both destination server roots, all three supported JavaScript extensions and unlayered entries; working-tree repairs do not hide staged broken exports/imports or staged package aliases. Its existing resolver behavior remains unchanged. Browser JSX is not added to this server gate.

Executed evidence: discovery suite 3/3; final combined ESM+SCSS suite 10/10; focused tooling Vitest config 71/71 assertions across the existing layer, filesystem and ESM suites. Diff whitespace check passed. Reports: `task-3-discovery-report.md`, `task-3-scss-report.md`, `task-3-esm-report.md` in this plan's local skill workspace. Controller reviewed the small implementation diffs; no broader review chain or full existing SCSS/product suite ran.

Remaining gates are unchanged: the local operator wrapper is absent; its current profiles are synthetic-only and not provisioned or sized/integrated for Gratitude/build workloads. Actual dependency/source staging, native runtime resolution, production build/image inputs, live denial controls and the behavioral baseline remain unverified. No source relocation, commit, main synchronization or deployment has occurred. The parent's operator-provisioning question is pending; no privilege bypass is attempted.

Parent final fresh verification for this continuation: combined new Node suites 13/13 passed with no skips; focused existing tooling Vitest suites 71/71 passed across three files; diff whitespace clean and product-directory diff empty. No additional work or test execution while provisioning is pending.

## Resumed execution — unprivileged isolation

The user explicitly instructed the agent to overcome the blocker and proceed. The former container-only choice is superseded; no weakening of filesystem/network protections is authorized. Parent confirmed Landlock ABI 8. A bounded Sol worker produced and executed a 147-line Landlock+seccomp proof: Node and scratch read/write/thread creation work; outside/host content access, outside writes, symlink escapes, socket creation, process spawning and cross-process privileged channels fail as intended. Scoped signal/abstract-socket protection, TRUNCATE/IOCTL handling, closed inherited descriptors, clean environment and resource bounds were inspected by the parent with no blocking finding for trusted-repository fixtures. Metadata visibility and lack of aggregate thread/disk quotas remain explicit limits.

The same worker is adapting the existing Gratitude Node case pack to explicit source-file and canonical dependency allowlists, then running its real baseline. There will be no deleted packet restoration, host privilege changes or product source changes. Protected denial sentinels remain outside writable scratch. The earlier operator-provisioning blocker is no longer the execution prerequisite.

Actual Linux Gratitude baseline now passes: 59 named TAP assertions, zero failures/skips/todos/cancellations; live denial controls and protected-input hashes pass. Receipt: `.superpowers/sdd/2026-10-08-gratitude-module-proof/landlock-runs/gratitude-5nwv0n/receipt.json`. The only fixture adaptation initializes its file with exclusive open mode0600 before writing, preserving existing mode/inode assertions; product code is unchanged. Candidate/unknown pack requests fail closed. Same worker proceeds to existing browser coverage, followed by selected stored-shape and confined hook execution.

Current relevant baselines are green under Landlock+seccomp: Gratitude59/59 (`gratitude-r6fgsP`), browser25/25 (`browser-E49XBs`), stored-shape6/6 (`stored-shape-rqq7YT`), each with live controls and protected-input integrity. Browser characterization was corrected against current unchanged source: Piano passes msg.t as fourth argument; portal key-up is suppressed; FamilySelector emits structured warnings. No candidate parity is claimed yet. Installed esbuild replaces absent TypeScript for fixture JSX transformation; confined subprocesses inherit restrictions and only local AF_UNIX socketpair IPC is allowed, networking remains denied. Stored-shape uses exact native librt read grant and ancestor READ_DIR-only discovery. Next: execute the original complete pre-commit hook under inherited confinement, checkpoint and incorporate main, then actual extraction.

Main integration: verified the refactor branch had no commits beyond the original baseline and only `.gitignore` overlapped upstream changes. Saved only that owned patch, restored its worktree file, fast-forwarded this branch to `ac17f417a5`, and reapplied it. All prep retained; index remained empty; main was untouched. Main's product changes are unrelated test fixes, with no Gratitude/browser implementation changes, so existing behavior receipts remain useful baseline evidence; final certification must use the merged source. Normal confined hooks are deferred to the meaningful implementation checkpoint, not bypassed. The same Sol worker now implements the coherent backend ownership/public-seam extraction and candidate parity before the browser slice.

Backend extraction completed as a coherent slice: 24 owned implementation/colocated-test files moved, intact events and capability-owned ordered household projection, explicit public factories/print/lazy rendering entries, actual dataService injection and Feed/HomeBot/Fitness narrow seams. Candidate `gratitude-N2CPL5` passes the same59 named baseline assertions plus owner-factory raw-data/five-argument controls; selected stored-shape `stored-shape-IGjJGL` passes6/6. Layer, filesystem and ESM audits pass without ratchet changes; selected37 files parse. Canonical dependency paths are verified through the test loader; separate ordinary native ESM import remains required and must not be confused with that bridge evidence. Same worker proceeds to browser ownership, registration/assets/resolution and25-case candidate parity.

## Milestone 1 implementation checkpoint

Full-stack ownership and public consumers are implemented on merged base `ac17f417a5`. Root's bounded review compared moved product bodies and found no behavior regression: moves are import-only apart from the reviewed unchanged household projection extraction and explicit dependency seams. Minor JSDoc/fixture cleanup is applied. The obsolete authored Docker runner implementation is archived locally; only its superseded README pointer remains.

Final substantive evidence under the local plan workspace `landlock-runs/`: `gratitude-K8eQ5D`59/59 exact named parity; `browser-1QVSqj`25/25 exact named parity; `stored-shape-PsjFvQ`6/6; `integration-6I8Lmw`61/61 across10 selected files; `build-0Mmpiu` actual Vite build13,581 transformed modules with moved UI/styles/icons and manifest/output checks. Live denials and input integrity pass. Ordinary native ESM import (no test loader) passes with canonical backend UUID ESM identity. Build-specific options and byte-identical public-asset staging are disclosed in receipts; no Docker image or deployment is claimed.

The original unchanged commit hook runs through a temporary per-command hooksPath wrapper under inherited kernel confinement against actual Git index/HEAD/objects. Exact credential-free repository Git config is read-only; global/user credentials, private runtime files and network remain denied. Initial feasibility completed filesystem/layer/UI/CSS/ESM checks but its190-second bound expired during active parse work; no success is claimed for the remaining commands from that attempt. The final staged commit uses a bounded600-second inner/610-second outer watchdog and must pass all original commands; no extra feasibility rerun or hook bypass. Its receipt is generated during the commit.

Scope limitations: selected UI token ratchets are unchanged, the broader roadmap is not complete, and no real printer/provider/device/production data was exercised. The networked infrastructure suite remains unrun; its relevant Gratitude contract is covered by CASE-GR-HTTP-14 with stronger once-publication assertions. This checkpoint is ready for cost/complexity assessment before scaling.

Final freshness check found main advanced to `6cf8670352` with an unrelated HubStatusBroadcaster clock-test correction and branch archive note. No files overlapped the staged migration. A second fast-forward incorporated those changes while preserving the staged proof before final commit-hook execution; no affected Gratitude/browser/build implementation input changed.

First final staged-hook attempt `hook-9zV9mT` passed both11,171-file parse scans and348 SCSS entrypoints, then correctly blocked the commit at Vitest startup's Wasm virtual-memory reservation. A narrow confined composition probe (`composition-q9aydoha`) verifies the fixed inherited Node Wasm flag, numeric loopback test-server startup and existing integration-profile native library grants; all15 original composition tests pass with controls. The original complete commit hook is retried unchanged after restaging these four small runtime/test-configuration fixes. Failed receipts are retained, not relabelled successful.
