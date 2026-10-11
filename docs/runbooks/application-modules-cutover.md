# Application modules cutover and rollback

Status: preparation only; this runbook has not been executed and no production container, data or tag was changed. The earlier read-only inventory and live/local comparison phase is supplemented by isolated, synthetic actual-image tests. The previously serving backend image `sha256:fd7060b3…` and production-Dockerfile candidate `sha256:956f343e…` passed the initial nine selected API IDs (two basic, seven populated), one configured School lesson journey, scoped populated Fitness/Piano browser journeys, one synthetic WebSocket lifecycle, one disabled Gratitude configuration write/restart/old-image read, and one task-local archive rotation. These are separate receipts, not complete daily-use or production acceptance. An intermittent blocked Fitness boot report, Piano peripheral/config errors, the School stale-sweep wiring defect and scheduler job-options loss remain unresolved. The tested candidate image binds source `95aa5b0`; later documentation commit `23f28fc` is not a rebuilt image. Main has advanced to `c9a3ea9bd2` with four Fitness changes that are not in that image; the branch-only merge integrates that pinned main source, and a new image build and affected retest remain open. Focused incoming Fitness checks passed: 31 Node, 29 new Vitest and 120 existing Vitest tests. Structural checkpoint `7c0936d1b5` and the isolated passes do not authorize deployment.

The separately reviewed local cohorts account for 640 disjoint healthy cases while preserving their raw failures and source/harness provenance. See [the current read-only accounting](../_wip/plans/2026-10-09-application-modules-cutover-readiness.md#reviewed-local-read-only-accounting--2026-10-11) for the 373/396 static template scope and open production/release gates.

Expanded historical actual-image API accounting records 370 unique scoped IDs across the original nine, the later 376-case lane and ten physical Fitness metadata cases; 366/407 first-cohort source IDs have passing actual-image contracts. The 376-case lane accepted 356 (353 raw plus three previously approved finite clock derivations), with 20 shared old/candidate failures; 21 first-cohort IDs remain deferred. See `/tmp/readiness-actual-expanded95aa-v1/ACCOUNTING.json` (SHA-256 `c2a3320d9dc0bc00887a28346077325bef8abcd8db52f12d7d95d83deabe826a`) and the physical-metadata receipt. These counts do not include the new serving `d5b64e88…` image or replace the separate 640 source-ledger accounting. The durable `evidence-expanded-api95aa-fd706.tar.gz` archive has SHA-256 `679f8e343599d92124e45c0d1d6c398bc993607333e9ca39f1ce56bd1542ed4e`; all 250 payload hashes and lengths were independently verified.

Fresh read-only production inspection found that the serving backend changed again to `sha256:d5b64e88b4fed0eab6d5bbd20fc3e4decc8c886e62ee983f4390b83b0031eaff` (started 2026-10-11 19:40:54 UTC); the browser retained image `sha256:ed48fdb2…` also restarted. The new backend image reports build `14261820397a7da679ff030b09948855e292a9a9`, between old main `026e3cb` and current main `c9a3ea9` (the latest recap-lock commit is not deployed). The earlier `fd7060…` image, private configuration capture and restoration proposal are historical; review the refreshed private current-image capture and restoration proposal (`production-refresh-1940/RESTORE-PROPOSAL-REFRESH.json`, SHA-256 `3d47577bd13e610affa14d71b24baff644b309745488da5702e107cd85073b7b`). The private exact restoration argv is pinned by SHA-256 `68e47399e79045f4c12435162bd30f171ff48327eb936ca5c664dcd1183d905c` and remains unexecuted. The current backend image retention receipt has SHA-256 `c1d5628ccaf8b4068731449e8cc51ad8e216f52a11242b4ac841698233fb4d98`; retained backend archive SHA-256 is `8df0cc9f14f8e414c8b72bb21d908e065daea290ceb4d1099daba93f8b846dbc` with all 23 manifest layers present. Keep the proposal unexecuted until a separate cutover decision. None of the `fd7060…` versus `956f…` isolated tests proves parity with the newly serving backend.

The exact-image disposable evidence is private and bounded: `evidence-websocket-lifecycle.tar.gz` (SHA-256 `7fa416e11ac403e51250098f137e8132da60ec09f32926e7d5d117bb632a6d3d`) proves one synthetic topic opened, acknowledged, exchanged transport/server ping and application heartbeat, then closed normally in both images; it does not prove every application subscription or production network path. `evidence-write-rollback.tar.gz` (SHA-256 `344b265da5230bcfb2b16804bfa63896eef8cb97f13f556bc0ddfe22b615186a`) proves one disabled synthetic Gratitude PUT persisted across candidate restart and remained readable after switching the same task data to the retained image. `evidence-archive-producer.tar.gz` (SHA-256 `e942f68c65b35f1a0138b19a7881b11590fc2108b312c0a2cd794bd3cffb6203`) proves a task-only dated lifelog record moved into a yearly archive and remained byte-stable after restart on both images. These are not live configuration, broad write, full job, or exact-container restoration checks.

Scoped paired browser results are in `evidence-fitness-browser-populated.tar.gz` (SHA-256 `10ebf76387e540c5d631df16f2bd107b6ab70b9c01a670f7af56df16dcd2d6a7`) and `evidence-piano-browser-populated.tar.gz` (SHA-256 `5d71bbb6ac74d16a2d5e934356d1f5f96245e9145bbd79cbf71a9c18ae9657ab`). Fitness displayed an authored session date, two stored session cards and the selected chart detail; Piano displayed a synthetic exercise catalog and the C–E–G staff preview. Both pair-specific driver assertions passed, while their reusable result envelopes retain `readinessAccepted:false` and `browserJourneyCredit:false`. Fitness retains a missing synthetic avatar and blocked external fonts; Piano ran as guest with missing app config/avatar, denied Web MIDI and blocked local bridge attempts. Audio, physical devices, providers, full browser coverage and production WebSocket behavior remain unverified.

## Release gate

Use [the readiness plan](../_wip/plans/2026-10-09-application-modules-cutover-readiness.md) and its coverage manifest. Require all of the following for the exact proposed source/image:

- Current main is included, including School story-time `noRepeatDays`; preserve intervening behavior in its new owned paths.
- Original and candidate images build from tracked, secret-free contexts with matching resolved dependency/toolchain layers. Pin image IDs/digests, source SHAs and context hashes.
- Actual startup, middleware and registered APIs are exercised on both images. Reviewed read-only cases meet explicit baseline expectations and exact differential comparison rules. Missing, errored, skipped and unconfigured cases are not passes.
- Required browser journeys, WebSocket lifecycle, configuration, jobs, write persistence and restart behavior are verified separately. Read-only API equivalence does not cover these.
- Candidate-created data can be read by the retained rollback image in a disposable rehearsal; preserve production writes during rollback. If this fails, stop and design an explicit data recovery procedure before deployment.
- Original architecture/commit gates pass; worktree is clean; a final source review and exact runtime evidence identify no unresolved daily-use release blocker.

## Retained reference environment

Use the API comparator and isolation recipe under `tests/readiness/application-modules/` once their implementation and controls are verified. Retain the exact reference image and frozen synthetic fixture snapshot after cutover. Compare future candidates against that snapshot using separate data clones; a changing production database is not equivalent to an old frozen fixture.

The reference container must use a distinct name and loopback-only port, task-owned data/media/log storage, no production credentials, no host Docker socket, no physical devices and no production/provider network route. The Docker application expects data at `/usr/src/app/data`; mounting only `/data` does not configure the production entrypoint correctly. Validate every background activation path, including agent timers and piano-bridge supervision; `enableScheduler=false` alone is insufficient. Do not replace the real application with a test-only router to obtain green results.

A stopped retained image is sufficient for later replay; an always-running backup is unnecessary unless all autonomous effects are contained. Keep both the functional reference image and actual pre-cutover production image: they may differ if main has advanced since the previous deployment.

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
4. Run the existing usage gate immediately before restart: `scripts/deploy-gate.sh`. A failure, unavailable check, active fitness/playback/Portal/Piano/reading session or emergency lock blocks the restart. Repeat if there is any delay after it passes.
5. Deploy the exact tested candidate using the reviewed host procedure. If the host script’s mutable backend tag must be used, verify and record its image ID immediately before execution, exclude concurrent retag/deploy operations, and verify the created container’s image ID afterward. The browser image/configuration must match the reviewed release record too.
6. Confirm container health, build identity, expected mounts/configuration and application readiness. Run the dedicated production-safe read-only smoke subset against the newly deployed server; do not send synthetic writes or provider-generation requests to production.
7. Verify the highest-priority real browser flows at an idle time, watching for missing chunks, API errors and WebSocket disconnections. Record results and a clear observation window; a healthy root page alone is not acceptance.

## Rollback

Rollback triggers include startup/readiness failure, missing routes/assets, authorization regression, sustained new API errors, broken core browser flows or unexpected device/job effects attributable to the release. Preserve logs and the failing comparison artifacts without delaying recovery.

1. Stop additional candidate work and preserve the current data; do not restore the original source tag or replace live data with the test fixture.
2. Select the retained **pre-cutover production image ID**, not a newly rebuilt old commit or whichever image `latest` currently names. Verify the image exists.
3. Restore the captured backend/browser deployment configuration and old image IDs using the reviewed procedure. Coordinate user activity where possible; if the candidate is already unusable, document the recovery urgency.
4. Verify actual container image IDs, health, build identity and production-safe smoke checks. Confirm recent user writes remain visible.
5. Keep the failed candidate image, exact source and reports for isolated reproduction. Repair and rerun the same contracts before another cutover attempt.

A historical private exact old-image restoration argv proposal exists at `/tmp/readiness-production-runtime95aa-v1/rollback-restoration-argv.private.json`. The verified durable old backend/browser image archive is `/home/ds/.local/state/daylight-readiness/cutover-2026-10-11/rollback-images.tar` (SHA-256 `0f245ef3cf0f931e1991040d8eb6acffbc7bc03121ebf9168bdd74646b7501a7`; receipt `ROLLBACK-RETENTION.json` alongside it). The proposal has not been executed and targets the formerly serving backend; the new `d5b64e88…` serving image now has a separate refreshed private restoration proposal, still unexecuted. The one Gratitude same-data rehearsal does not close exact container restoration or broader candidate-created data compatibility, which remain release blockers. Reinspect production containers and the host script immediately before any later cutover.
