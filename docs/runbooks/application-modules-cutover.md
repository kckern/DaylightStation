# Application modules cutover and rollback

Status: preparation only. The current user-requested phase is read-only API inventory and live/local comparison; a separate local candidate is sufficient, and Docker is not a prerequisite for that phase. The deployment gates below apply later, before actual cutover. This runbook has not been executed. Actual production-Dockerfile candidate image `sha256:956f343e…` and retained backend image `sha256:fd7060b3…` passed nine selected isolated API IDs (two basic, seven populated). Root HTML/static JavaScript observations are separate. A paired Playwright probe passed one configured School learner/catalog/lesson read-only path; Piano and Fitness were shell observations only, and an intermittent blocked Fitness boot report is unresolved. Broader browser/WebSocket journeys, writes/jobs/restart and disposable rollback rehearsal remain open. Structural checkpoint `7c0936d1b5` alone does not authorize or establish a safe deployment.

The separately reviewed local cohorts account for 640 disjoint healthy cases while preserving their raw failures and source/harness provenance. See [the current read-only accounting](../_wip/plans/2026-10-09-application-modules-cutover-readiness.md#reviewed-local-read-only-accounting--2026-10-11) for the 373/396 static template scope and open production/release gates.

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

A private exact old-image restoration argv proposal exists at `/tmp/readiness-production-runtime95aa-v1/rollback-restoration-argv.private.json`. The verified durable old backend/browser image archive is `/home/ds/.local/state/daylight-readiness/cutover-2026-10-11/rollback-images.tar` (SHA-256 `0f245ef3cf0f931e1991040d8eb6acffbc7bc03121ebf9168bdd74646b7501a7`; receipt `ROLLBACK-RETENTION.json` alongside it). The proposal has not been executed; disposable restoration rehearsal and candidate-created data compatibility remain release blockers. Reinspect production containers and the host script immediately before any later cutover.
