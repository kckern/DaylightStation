# Application modules cutover and rollback

## Current readiness and deployment boundary — 2026-10-12

Release pair: reference `2217a991` / candidate `160842c7`, candidate source `da5b8ec0`. The actual production Dockerfile build, 640 declared contracts and eight final-image renewals are independently reviewed. The [latest plan table](../_wip/plans/2026-10-09-application-modules-cutover-readiness.md#latest-readiness-checkpoint--2026-10-12) and [whole surface map](../../tests/readiness/application-modules/current-http-evidence-projection-v4.json.gz) supersede older image/count and alternate-build statements below while preserving their historical evidence.

| Gate | Readiness evidence | Deployment-time obligation |
| --- | --- | --- |
| Source and packaging | Current-main integration, stock Dockerfile, installed resources/dependencies, 390 active and 388 retained legacy assets reviewed | Refresh source/image/configuration drift immediately before deployment; changed runtime inputs need affected revalidation. |
| Application contracts | Current 640 accounting and representative daily-use/runtime scopes accepted; original failures and exact source-derived qualifications retained | Smoke the deployed immutable identity within the bounded readiness window; investigate concrete candidate regressions. |
| Inventory and risks | Whole-map IDs expose untested, effectful, provider, dynamic, opaque and hardware dispositions. Baseline defects match reference and receive zero healthy credit | Follow the reviewed scope; do not send arbitrary GETs, synthetic writes or provider refreshes to production. |
| Cutover/rollback preparation | Reviewed backend-only controller, captured configuration, seven failure-path controls, synthetic persistence/readback, retained images and read-only smoke command | Obtain separate deployment authorization, use an exclusive deployment lane, refresh usage-idle/log-permission gates, preserve live data and execute the bounded recovery procedure if needed. The controller has no common lock with `deploy-daylight`. |
| Final checkpoint | Direct-Docker/private fail-closed usage-gate preparation is reviewed; final documentation/evidence acceptance is being consolidated | Root must finish unchanged original commit hook, clean isolated release checkpoint and final source inclusion before declaring readiness. Unrelated user changes must remain preserved. |

The reviewed release-user controller is private `current-rollback-2217-new160-direct-gate-v3/backend-cutover-controller.private.py` (SHA-256 `f4a25265a789d7a7dddbd3f7b0111275744a79b59e8ebe442ea030a9919ef3b3`). It uses direct Docker, verifies all thirteen inputs, and invokes a pinned private usage gate that blocks when garage logs cannot be read; its three idle helpers match the originals. Seven rollback failure controls and the extracted log-failure control passed independently without production calls. Earlier sudo-based controller references below are historical.

Readiness preparation does **not** require production forward/rollback execution, activation of every source-inventoried site, or proof of all external hardware. None of those gains credit from the isolated tests. No unresolved candidate-only regression remains in the accepted executed paths; pre-existing Portal notes/examples, receipt/Journal failures, optional-service fallbacks and the extreme Gratitude label remain explicit limitations. Final scope acceptance is recorded in the coverage ledger; checkpoint acceptance is conditional on the genuine hook, clean state and main inclusion receipt. This update grants no production authorization; deployment, merging and readiness acceptance remain separate actions.

The prior pinned serving71/candidatef5 pair accepted all **640 API contracts**, independently revalidated by the root aggregate with zero duplicate, missing, extra or unresolved IDs. This includes 628 ordinary comparator passes, one guarded PDF contract, one independently authored built-image identity contract, nine approved generated-field comparisons and one time-bound PNG contract. These results belong to candidate source `828e8b9af5116603106176a447aa48e53aef9c6e` and reference main6ca; they do not provide current-release image credit. Durable root reviews are `ROOT-FINAL640-REVIEW.json` and `ROOT-MAIN-7D-PROJECTION.json`. Final lifecycle, persistence, browser, restoration, route inventory and replay gates remain open; this is not cutover acceptance.

Status: preparation only. No migration production restart, merge into main or deployment has occurred. Earlier image runs are historical evidence, retained with their failures and source identities in the readiness ledger. They establish selected API, browser, WebSocket and task-local persistence behavior, but do not replace final-release checks.

Historical static accounting linked cases to 373 of 396 eligible route templates and retained 23 source dispositions. A separately accepted current Playback Hub configuration contract closes one more template, leaving 22 unclosed templates before the next three default-branch reads. Those three now have independently reviewed current-image full-body/header/input/cleanup contracts, leaving 19 unclosed templates. Two further default contracts—AI metrics with no configured providers and media started-by with no playback—are now independently accepted, leaving 17 unclosed templates in that historical list. A fresh current-source declaration projection is still required; the historical potential count of 396 is not promoted to a current configured denominator. This is the historical potential-eligible source universe, not an observed production denominator; empty-channel/idle-scheduler/unsupported-loop coverage grants no populated feature credit. Installed route order and the configured production denominator remain separate proof requirements. Media metadata tests do not certify playback bytes or physical devices. A deliberately extreme Gratitude display label failed the unchanged browser assertion on both current images: a 320px label overflows a 101px header at the 12px font floor. That failure is retained and earns no healthy browser credit. Known baseline issues and external limitations must be reviewed separately from migration regressions, including the previous blocked Fitness boot report, Piano peripheral dependencies, School stale-sweep wiring and scheduler job-options loss.

## Release gate

Use [the readiness plan](../_wip/plans/2026-10-09-application-modules-cutover-readiness.md) and its coverage manifest. Require all of the following for the exact proposed source/image:

- Pinned main `7d0ffd25` is included, including School story-time `noRepeatDays`. Newer main changes must be reconciled into the owned paths or explicitly deferred before release; the tested image does not include `b0c66593`.
- Original and candidate images build from tracked, secret-free contexts with matching resolved dependency/toolchain layers. Pin image IDs/digests, source SHAs and context hashes.
- Actual startup, middleware and registered APIs are exercised on both images. Reviewed read-only cases meet explicit baseline expectations and exact differential comparison rules. Missing, errored, skipped and unconfigured cases are not passes.
- Required browser journeys, WebSocket lifecycle, configuration, jobs, write persistence and restart behavior are verified separately. Read-only API equivalence does not cover these.
- Already-open clients can fetch their old hashed lazy JavaScript/CSS URLs after replacement and reconnect without losing the intended workflow. Candidate `98b7bbfd` lacks 211 such serving-image assets; the proposed compatibility overlay and a warm-client cutover rehearsal must pass before acceptance. Cold browser loads and the existing delayed reload fallback do not prove this gate.
- Candidate-created data can be read by the retained rollback image in a disposable rehearsal; preserve production writes during rollback. If this fails, stop and design an explicit data recovery procedure before deployment.
- Original architecture/commit gates pass; worktree is clean; a final source review and exact runtime evidence identify no unresolved daily-use release blocker.

## Retained reference environment

Use the API comparator and isolation recipe under `tests/readiness/application-modules/` once their implementation and controls are verified. Retain the exact reference image and frozen synthetic fixture snapshot after cutover. Compare future candidates against that snapshot using separate data clones; a changing production database is not equivalent to an old frozen fixture.

The reference container must use a distinct name and loopback-only port, task-owned data/media/log storage, no production credentials, no host Docker socket, no physical devices and no production/provider network route. The Docker application expects data at `/usr/src/app/data`; mounting only `/data` does not configure the production entrypoint correctly. Validate every background activation path, including agent timers and piano-bridge supervision; `enableScheduler=false` alone is insufficient. Do not replace the real application with a test-only router to obtain green results.

A stopped retained image is sufficient for later replay; an always-running backup is unnecessary unless all autonomous effects are contained. Keep both the functional reference image and actual pre-cutover production image: they may differ if main has advanced since the previous deployment.

## Replay the final-image API baseline

Use the durable final `2217a991` / `160842c7` wrapper with a new, nonexistent private stage. The package pins candidate source `da5b8ec0`, the unchanged accepted replay/controller/template, both source archives and the fifteen-input current closure. It restores absent exact inputs and rejects changed bytes or symlinks before delegation.

```sh
python3 /home/ds/.local/state/daylight-readiness/cutover-2026-10-11/stock-new160-final640-replay-v1/restore-and-replay.private.py verify /tmp/readiness-final160-verify-new
python3 /home/ds/.local/state/daylight-readiness/cutover-2026-10-11/stock-new160-final640-replay-v1/restore-and-replay.private.py all /tmp/readiness-final160-native-new
```

`verify` prepares the exact 376/232/21/10/1 union without starting servers. `all` executes the five isolated lanes, renews source-specific date/auth/PNG admissions, retains raw failures and requires the reviewed derived/supplemental validators. Fresh verification and missing-input restoration/tamper/symlink controls passed independently; closure work did not repeat the accepted native 640 run. Same-host installed Node dependencies, Docker access, immutable image IDs and recorded archives remain prerequisites. These are task-only commands, not production smoke or deployment.

Private handoff: `stock-new160-final640-replay-v1/HANDOFF.json`, SHA-256 `0700103516c54de08efc1a76846d8e125908a3bc7210612ea858f7a882913a4d`; entrypoint SHA-256 `61875a07ff85f55f9e3a21de57b49ef252796468525a4a99c2a19cee1d5378a8`. Independent preparation review: `stock-new160-durable-replay-review-v1.json`, SHA-256 `51ff484d51a3a77f9327e5332e2c51a8f681089e4683ad6652ebaedfb9343f28`. Historical commands below retain their earlier image scopes and must not certify the final image.

### Historical replay controllers — not the final image

The private evidence directory contains `replay-current640.private.py` (SHA-256 `feaaa7017f0f1ef0856432539cbd71646a9f01cdde96184833944fc7bb569e04`). It restores both immutable source trees and hash-verified fixture/evidence archives into a new stage, renews source-derived date/auth expectations, and refuses mismatched dependencies, inputs or images. That historical controller pins reference `3fcbe290` / source `7d0ffd25` and candidate `0b0e1f18` / source `5c340395`. The reviewed successor for `2217a991` / `b1c4fdd7` is sealed; do not use the old controller to certify the current release. Its source-correct UTC repair must retain the original failed receipts and unique case accounting. The reviewed successor is `final640-bf-replay-v3-HANDOFF.json` (SHA-256 `d94f101f235ed935dd6377f5f51a0cedf3919c6fe10f6636ef061c06a3f097cf`) in the private evidence directory. It pins the source/image/input closure, fresh-directory offline verification, six-case native pilot, and missing-input restore checks.

```sh
python3 "{private_evidence_dir}/replay-current640.private.py" verify "{fresh_stage}"
python3 "{private_evidence_dir}/replay-current640.private.py" pilot "{another_fresh_stage}"
python3 "{private_evidence_dir}/replay-current640.private.py" all "{another_fresh_stage}"
```

Each stage must be new. `verify` checks the exact disjoint 376/232/21/10/1 population without booting servers. `pilot` executes six renewed PlayLedger contracts on the actual image pair. `all` executes all five lanes, refreshes finite-window expectations at the appropriate lane, preserves raw failures and requires the reviewed supplemental validators before aggregate acceptance. Keep installed immutable images and canonical dependency identities available. All native requests target isolated task containers; these commands are not production smoke tests.

Fresh-stage verification and the final standalone six-case pilot passed. Full renewed `all` execution is wired and independently reviewed, but has not been run; it grants no additional 640-case execution credit. Retain the original accepted current-pair results separately.

The historical `2217a991` / `b1c4fdd7` successor can run its preserved population with one command,
using a **new, nonexistent** private stage path:

```sh
python3 /home/ds/.local/state/daylight-readiness/cutover-2026-10-11/replay-final640-bf-v3.private.py all /tmp/readiness-release-replay-new
```

Use `verify` for source/input/admission checks without starting containers, or
`pilot` for the six existing UTC/auth/time contracts. The package reconstructs
missing pinned inputs and refuses changed bytes or symlinks. Same-host installed
Node dependencies, Docker access, retained image IDs and the recorded archives
remain prerequisites. Date/auth admissions expire and are regenerated before
requests. The full actual 640-case acceptance is recorded separately; `all` was
not repeated after the packaging-only closure repair, while fresh verification,
the native pilot and absent-input restoration were verified. No live-data or
production request is part of this command.

## Prepare the release record

Docker inspection is available and private receipts pin the serving backend/browser identities and configuration. Do not run deployment commands until the release gate passes and the cutover is authorized.

Record in a private release directory (never commit container environment or mount details):

```sh
umask 077
mkdir -p "$RELEASE_DIR"
docker inspect daylight-station > "$RELEASE_DIR/backend-container.json"
docker inspect daylight-browser > "$RELEASE_DIR/browser-container.json"
docker inspect --format '{{.Image}}' daylight-station > "$RELEASE_DIR/backend-image-id"
docker inspect --format '{{.Image}}' daylight-browser > "$RELEASE_DIR/browser-image-id"
sha256sum /usr/local/bin/deploy-daylight > "$RELEASE_DIR/deploy-script.sha256"
git rev-parse main > "$RELEASE_DIR/main-before"
git rev-parse refactor/application-modules > "$RELEASE_DIR/refactor-candidate"
```

Set `RELEASE_DIR` to a new private task-owned absolute path. Record the tested candidate image ID in `candidate-image-id` and the exact old/new fixture and test report identities. Retain image tags identifying the release, plus an exported image archive or approved registry digest when local image pruning could remove rollback material. Verify the archive/digest before removing any old container. The historical `pre-application-modules-cutover-2026-10-08` Git tag is a source comparison anchor, not the production image rollback target.

Inspect the existing host deployment script against captured container configuration before choosing the execution method. At review time `/usr/local/bin/deploy-daylight` uses `kckern/daylight-station:latest`, recreates BOTH backend and browser containers, and does not itself run the usage-idle gate. It must not accidentally deploy another agent’s mutable image or drop existing mounts/environment/logging. Record and review any configuration difference first. Do not infer production configuration from an old example compose file.

## Controlled cutover

1. Refresh main, reconcile any new commits in the isolated branch, and rerun affected comparison cases. Rebuild/retest if runtime source or packaging changed; do not reuse evidence for a different image.
2. Merge the reviewed branch into main only when separately authorized and when other agents have a clean integration point. Do not reset or overwrite their work. Record the resulting commit and tested image correspondence.
3. Preserve the actual running backend/browser image IDs and deployment configuration. Confirm retained images are locally available or retrievable by immutable digest.
4. As the actual release user, first confirm `sudo -n docker logs --since 75s daylight-station` exits zero; capture output privately. Unavailable logs or privileges block release. Confirm the log store is reachable, then run the existing usage gate immediately before restart: `scripts/deploy-gate.sh`. A failure, unavailable check, active fitness/playback/Portal/Piano/reading session or emergency lock blocks the restart. Repeat if there is any delay after it passes.
5. Deploy the exact tested candidate using the reviewed host procedure. If the host script’s mutable backend tag must be used, verify and record its image ID immediately before execution, exclude concurrent retag/deploy operations, and verify the created container’s image ID afterward. The browser image/configuration must match the reviewed release record too.
6. Confirm container health, build identity, expected mounts/configuration and application readiness. Run [the dedicated production-safe read-only smoke command](application-modules-production-smoke.md) against the newly deployed server; do not send synthetic writes or provider-generation requests to production.
7. Verify the highest-priority real browser flows at an idle time, watching for missing chunks, API errors and WebSocket disconnections. Record results and a clear observation window; a healthy root page alone is not acceptance.

Allow a bounded 360-second production readiness observation window from container start, checking actual API responses and frontend assets throughout. The serving `218ad422` image logged its API mounts 175.5 seconds after container start on 2026-10-11; the cause was not established. Container existence or a nominal 45-second restart estimate does not prove readiness. Preserve startup logs and perform the reviewed rollback if the deadline expires or a concrete regression appears. The separate isolated test allowance is 240 seconds for startup within a 360-second task-role wall; resource, response and cleanup limits remain enforced.

## Rollback

Rollback triggers include startup/readiness failure, missing routes/assets, authorization regression, sustained new API errors, broken core browser flows or unexpected device/job effects attributable to the release. Preserve logs and the failing comparison artifacts without delaying recovery.

1. Stop additional candidate work and preserve the current data; do not restore the original source tag or replace live data with the test fixture.
2. Select the retained **pre-cutover production image ID**, not a newly rebuilt old commit or whichever image `latest` currently names. Verify the image exists.
3. Restore the captured backend/browser deployment configuration and old image IDs using the reviewed procedure. Coordinate user activity where possible; if the candidate is already unusable, document the recovery urgency.
4. Verify actual container image IDs, health, build identity and production-safe smoke checks. Confirm recent user writes remain visible.
5. Keep the failed candidate image, exact source and reports for isolated reproduction. Repair and rerun the same contracts before another cutover attempt.

The historical private restoration argv is `production-refresh-2238/rollback-restoration-argv.private.json` in `/home/ds/.local/state/daylight-readiness/cutover-2026-10-11/`, SHA-256 `39f5564bd7c5db8a202ae36402ef40d32e2bcf7de8cf08cd43c00b912bb5a9f9`. It targets the captured serving3fc backend. A disposable rehearsal using task-only safety remaps passed startup, healthz and the candidate-written twelve-file configuration read contract. The `/ping` observation was SPA HTML and grants no API-ping credit; literal production restoration remains unexecuted. Earlier retained images remain available for historical comparisons. Before cutover, retain and verify the exact then-serving backend and browser images, rehearse restoration in disposable task containers, and refresh both the configuration capture and immutable image identities. A synthetic Gratitude configuration compatibility test does not certify compatibility of every candidate-created record or restore production data.

Historical b1c4fdd7 rollback records follow; they do not describe the current `160842c7` candidate. The reviewed current release-user controller is private `current-rollback-2217-new160-direct-gate-v3/backend-cutover-controller.private.py` (SHA-256 `f4a25265a789d7a7dddbd3f7b0111275744a79b59e8ebe442ea030a9919ef3b3`), as noted above. The historical reference `2217a991` restoration proposal is retained privately as `current-rollback-2217/rollback-restoration-argv.private.json` in the same evidence directory, SHA-256 `46ed046c17be097a15efead653fad3548a613a5fb37bf20f24789b45901ebec6`. Independent comparison confirms its 57 arguments preserve captured configuration; only the immutable backend image differs from the prior reviewed recipe. The `b1c4fdd7` candidate-write → restart → `2217a991` read and disposable captured-settings restoration rehearsals passed the full synthetic Gratitude configuration body/header and twelve-file hash/mtime contract. This certifies that format in task-only storage; literal production restoration and other mutation formats remain unproved. No deployment was executed.

The historical backend-only candidate reconstruction proposal is `current-rollback-2217/BACKEND-ONLY-CUTOVER-PROPOSAL.private.json`, SHA-256 `76e1cc2d3c1003359371c09d641cb206200616dfa776621750d12f372652f4a1`. Its 57 create arguments change only the immutable image to `b1c4fdd7`; browser recreation and stop/remove commands are absent. It remains unexecuted and requires the release gate, fresh drift/config capture, usage-idle checks, and reviewed stop/removal procedure above.

The historical `b1c4fdd7` final image used a separately reviewed dependency-preserving recipe based on the immutable serving image, followed by the verified asset-compatibility layer. It was not produced with the standard `docker/Dockerfile`. That standard file already copies the owned module/capability trees; an earlier standard build succeeded but resolved 20 different Alpine package versions. The current `160842c7` candidate uses the actual production Dockerfile, as recorded in the current readiness checkpoint above.

The historical backend-only controller is retained privately as `current-rollback-2217/backend-cutover-controller.private.py` (SHA-256 `d012879ee2894cf1957d41a802ccd8cab4fa27b3098615e69cd753f2806e612a`). Independent prepared-only review `backend-controller-prepared-review-v1.json` (SHA-256 `415acef1ce7044944ff7d580d1f29ae726034b5d48b66a1483a10a6e54c45718`) validates its captured configuration pins, unchanged 57-argument create recipe, fresh drift/usage gates, actual-start readiness deadline and seven offline failure paths. It has no common lock with the normal deploy script: an exclusive deployment lane is required. Recovery-command failures or foreign container ownership require manual recovery. It remains unexecuted; current readiness acceptance and the release checks above must precede use.

The cost-budget configured-unavailable branch also has independently reviewed full-body/header/input/cleanup parity. That leaves 16 rows in the historical gap list without an accepted native contract, while healthy budget-feature coverage remains unproved; this is not a claim of 100% healthy endpoint coverage.
