# Round 4: recovered reviewer response

Reviewer: `architecture_review_r2`. Recorded: `2026-09-05T22:18:04.119Z`.
Source event: reviewer session line 344. Paths normalized as described in the evidence index.

---

Round 4: **two high-severity release-design gaps**. The package, provider-layer and R3 contract/subowner repairs remain sound at plan level.

### R4-01 — High: Cutover and rollback omit already-loaded browser clients

Plan locations: §11.2, §14.2, §15.

Source evidence:

- `frontend/src/lib/appRegistry.js:14` onward loads applications lazily.
- `backend/src/app.mjs:6438` serves the current image’s `frontend/dist`; it does not retain previous build assets.
- `frontend/public/sw.js:23` limits its cache to 120 entries; lines 73–75 fetch an uncached hashed asset from the server.
- `frontend/index.html:223` explicitly disarms boot-error recovery after React mounts.

A long-lived kiosk can retain the previous bundle and request a previously unopened lazy chunk after cutover. Source relocation changes chunk hashes, and the new image may no longer contain the requested asset. Successful fresh-page tests and unchanged APIs do not cover that failure. Reverting the server image creates the symmetric problem for browsers that loaded the candidate.

Recommended correction:

- Specify a client/asset handoff for both deployment and rollback.
- The proposed additive asset closure is viable: certify candidate and rollback delivery artifacts containing the immutable hashed assets required by supported loaded client builds.
- Preserve the original known-good image separately. A rollback delivery variant containing added assets needs its own digest and verification that previous application code, HTML, SW and native tools remain unchanged.
- Require same-URL/hash collision checks; equal hashed URLs must contain identical bytes.
- Treat stable-name assets, HTML and service-worker scripts separately; never overwrite conflicting stable assets by blindly unioning directories.
- Define supported client builds, retention/retirement evidence and authorized reloads after sessions are quiesced/checkpointed. Asset retention is not a forbidden legacy source shim.

Objective acceptance:

1. Load baseline UI without visiting a lazy application; deploy candidate; launch that application successfully.
2. Load candidate UI; activate rollback delivery; repeat the lazy-navigation test.
3. Exercise warm/cold caches, SW-controlled clients, reconnects and relevant worker/style dependencies.
4. Preserve existing offline behavior; do not interpret this as requiring previously uncached features to work offline.
5. Asset closure cannot be retired until its supported clients are retired or safely refreshed.

### R4-02 — High: Dependency preservation excludes floating image inputs and actual build-context provenance

Plan locations: §9, §14.1–14.2, §15.

Source evidence:

- `docker/Dockerfile:3` uses a tag, not a base-image digest.
- Lines 18 and 25 install unpinned OS/native packages.
- Line 29 installs yt-dlp from Git HEAD.
- Line 33 installs an unpinned global `forever`.
- `scripts/build-daylight.sh:9` records `git rev-parse HEAD`, while lines 16–20 build the current directory as `latest` without proving it matches that commit.

A clean build can therefore change downloader, printer, media, native-library or process-supervisor behavior independently of the filesystem migration. A recorded commit does not identify dirty/untracked inputs actually copied into the image. The plan’s detailed npm version/instance preservation does not yet close these external provenance gaps.

Recommended correction:

- Capture the deployed known-good toolchain and effective build-input baseline: base digest/architecture, OS/native package versions, yt-dlp commit/version, global supervisor, engine/font artifacts and relevant installation flags.
- Pin those inputs or reuse a verified immutable dependency/toolchain layer for migration comparisons.
- Require a clean pinned source checkout plus declared generated inputs, or an explicit content manifest proving every authorized deviation. A HEAD label alone is insufficient.
- Record immutable candidate/previous/rollback-delivery image digests; preserve the known-good artifact before replacing mutable tags.
- Treat unavoidable toolchain changes as separately reviewed deltas with their own baseline and tests.

Objective acceptance:

1. Candidate provenance matches the approved source/content manifest and dependency/toolchain baseline.
2. A deliberate changed tool version, base digest or undeclared build-context file fails certification.
3. Before/after comparison uses equivalent upstream inputs rather than two builds resolving floating dependencies at different times.
4. Linux native/media/printing checks run against the actual certified image.
5. Rollback selects the certified immutable artifact without rebuilding old code against current upstream dependencies.

### Other review conclusions

- R3’s declarative-contract category remains closed and reference-backed; it does not create a general shared-code exception or override D1–D10.
- Subowner-private imports and composition-owned presenter registration are now explicitly distinguished.
- Test-discovery omissions, runner preservation, inherited failures and CI population recording are adequately specified as future blocking work packages.
- Satellite relocation versus permanent logical ownership mapping is explicit and does not require surprise device deployment.
- One monorepo dependency installation is expressly allowed; focused installation is not falsely promised.
- No repository changes, live controller, deployment or live tests were performed.
