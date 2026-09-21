# Task 4 — RELY.9a + RELY.10a focused navigation tranche

## Scope delivered

- `NavProvider` now validates all Media views, exposes primary `area` and `backDestination`, and provides `goToArea` for canonical Home/Browse/Devices selection.
- Reselecting an area traverses to an existing canonical browser-history entry when available; a deep-link without one is replaced in place.
- Primary controls use `goToArea`; Now Playing, Peek, and Browse Breadcrumb Back controls show the actual prior area and still call `pop`.
- Escape-layer behavior is pinned separately from route Back.

## TDD evidence

- RED: focused suite reported 9 expected failures: missing area/goToArea/backDestination, direct primary `push`, generic Back labels, and unknown URL retention.
- GREEN: `npx vitest run frontend/src/modules/Media/shell/NavProvider.test.jsx frontend/src/modules/Media/shell/DismissStackProvider.test.jsx frontend/src/modules/Media/shell/PrimaryNav.test.jsx frontend/src/modules/Media/shell/NowPlayingView.test.jsx frontend/src/modules/Media/shell/PeekPanel.test.jsx frontend/src/modules/Media/browse/BrowseView.dispatch-header.test.jsx` — 6 files, 50 tests passed.
- Scoped ESLint with the frontend binary and `git diff --check` passed.

## Remaining evidence

- The three-viewport Playwright history matrix was intentionally not started before the close 29% checkpoint. RELY acceptance remains unchanged.
- Happy DOM drops the forward entry after `history.go(-1)`. The unit test therefore records history length at the synchronous traversal seam and separately proves the route landing plus the following Back to Home; real-browser runtime proof remains required.

## Review round 1/5

- Addressed the rejected Detail gap: Detail now has `detail-back`, labels its actual provider destination, and invokes `pop`; a focused component test covers the Home depth-one fallback label.
- Addressed the async traversal race: `goToArea` leaves React state unchanged while `history.go` is pending; only `popstate` restores the traversed stack. The provider test holds `history.go` pending to prove state/URL/history remain Detail, then the real-history case waits for Browse URL/state coherence before its next Back reaches Home.
- Added Home/Browse/Devices origin-label matrix and Rail ownership assertions.
- GREEN: focused navigation suite — 7 files, 55 tests passed. Scoped ESLint and `git diff --check` passed. Full Playwright remains intentionally deferred.

## Review round 2/5

- Addressed competing commands during a same-area traversal: `push`, `replace`, `pop`, and `goToArea` now retain only the latest intent while browser traversal is pending, then replay it from the authoritative `popstate` stack. This prevents an old traversal from overwriting the user's later navigation.
- Added a provider RED/GREEN that holds `history.go` pending, selects Devices, delivers the Browse popstate, and proves the final Fleet URL/state stack is `Home → Browse → Fleet`.
- Detail Back now appears in loaded, loading, error, and empty Detail states; tests assert its label and `pop` seam in every state.
- RED: 4 focused failures. GREEN: focused navigation suite — 7 files, 59 tests passed. Scoped ESLint and `git diff --check` passed. Full Playwright remains intentionally deferred.

## Review round 3/5

- Addressed the remaining programmatic-Back race: direct `pop()` and queued-pop replay now mark traversal pending before every `history.back()`. Latest `push`/`replace`/area intent is therefore held until that specific authoritative popstate arrives.
- Added RED/GREEN coverage for direct Back followed by a latest push and for a queued second Back followed by a latest push; both prove the later intent wins only after the correct popstate. The depth-one replace-to-Home case remains synchronous and covered by its existing provider test.
- RED: 2 focused failures. GREEN: focused navigation suite — 7 files, 61 tests passed. Scoped ESLint and `git diff --check` passed. Full Playwright remains intentionally deferred.

## Detached runtime acceptance — blocked

- Runtime spec commit: `d33153933a5adb234557816db19f533c8c254669` (`test(media): cover navigation history acceptance`). Detached clean source: `/tmp/daylight-media-navigation-acceptance` at that SHA. Build passed; preview artifact: `/tmp/daylight-media-preview-CAHkv9`; server: `http://127.0.0.1:40479`.
- Command: `BASE_URL=http://127.0.0.1:40479 npx playwright test tests/live/flow/media/media-app-navigation-history.runtime.test.mjs --workers=1 --reporter=line`.
- Result: 6 passed, 1 failed in 1.3m. The phone/tablet/laptop primary ownership, actual-origin Back, reselect, and direct-link cases passed before the failure; the phone SearchMode overlay case failed at `media-app-navigation-history.runtime.test.mjs:90`.
- Defect: after opening phone SearchMode, opening Destination Sheet, then pressing Escape, `destination-sheet` closes **and `search-mode` is absent**. Required behavior is that Escape closes only the sheet while SearchMode remains mounted; this blocks RELY.10a/AC3 acceptance. No product patch was attempted.
- Raw artifacts retained: `/tmp/daylight-media-navigation-acceptance/test-results/live-flow-media-media-app--266b1--sheet-Escape-keeps-it-open/error-context.md` and `test-failed-1.png`; build provenance is in `/tmp/daylight-media-preview-CAHkv9/acceptance-preview-provenance.json`.

## Runtime defect repair RED/GREEN

- Root cause: Mantine Modal's capture-phase Escape closed/unregistered DestinationLine's managed layer before `DismissStackProvider` saw the same event at document bubble, allowing base route Back to fire and unmount SearchMode.
- Repair: `DestinationLine` disables Mantine `closeOnEscape` and registers as an unmanaged shell layer, giving the shell exactly one Escape owner.
- Browser RED is the detached runtime failure above. A real-component DestinationLine + Mantine Modal + DismissStack integration test validates sheet-first then base-second Escape ownership; Happy DOM does not reproduce Mantine's production capture/bubble flush timing pre-fix, so that test passes on both sides while the browser result remains the causal RED.
- Focused GREEN: DestinationLine integration/component, ContentCombobox, and DismissStack suites — 44 tests passed. Scoped ESLint and `git diff --check` passed. Ledger unchanged; detached runtime re-run remains required.

## Final detached runtime acceptance

- Exact detached source SHA: `3cb5103a691e3836798230c3c0b9fa654c4bdfa2`; clean build artifact: `/tmp/daylight-media-preview-s3oM44`; preview server: `http://127.0.0.1:39825` (stopped after the run).
- Build command: `MEDIA_ACCEPTANCE_EXPECTED_SHA=3cb5103a691e3836798230c3c0b9fa654c4bdfa2 node tests/_lib/media-redesign-server.mjs --build` — passed. Existing Sass/static-asset/chunk warnings did not fail the build.
- Runtime command: `BASE_URL=http://127.0.0.1:39825 npx playwright test tests/live/flow/media/media-app-navigation-history.runtime.test.mjs --workers=1 --reporter=line` — **7 passed (1.0m)**.
- The serial proof covers phone/tablet/laptop primary ownership, truthful actual-origin Back, canonical reselect plus one real browser Back, phone SearchMode/Destination Sheet Escape ownership, and valid depth-one plus unknown direct-link fallback.
- Earlier RED artifacts remain preserved under `/tmp/daylight-media-navigation-acceptance/test-results/`; the repaired run produced no test failure. The acceptance ledger remains unchanged pending review.

## Final review evidence repair

- Review-strengthening commit `fcad84323` added exact nested Browse URL and restored-row proof, real `peek-back` return to Fleet, retained phone `Frozen` query after Destination Sheet Escape, and retained tablet/laptop search-popup Escape before route Back. Its initial exact run exposed only a catalog timing seam: the nested Browse request takes 2.6–4.1 seconds and the target row is at index 137, after the former five-second row assertion budget.
- Test-only repair commit `8168218d719aa1a3c486c28430cd1708093732af` waits for `browse-view-loading` to be hidden with a 30-second live-catalog budget before asserting the same exact `browse-row-plex:55854`; it does not weaken the URL, breadcrumb, or row proof.
- Exact detached build provenance: `/tmp/daylight-media-preview-5Zthlh/acceptance-preview-provenance.json` (`sourceSha` `8168218d719aa1a3c486c28430cd1708093732af`). The serial command `BASE_URL=http://127.0.0.1:33503 npx playwright test tests/live/flow/media/media-app-navigation-history.runtime.test.mjs --workers=1 --reporter=line` completed all **9** cases without a Playwright failure directory or `error-context.md`; the preview server was stopped afterward. Raw Playwright artifacts are preserved at `/tmp/daylight-media-navigation-acceptance/test-results/.playwright-artifacts-0/`.
- The acceptance ledger remains unchanged pending review.
