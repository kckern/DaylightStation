# Media redesign execution

**Objective:** Build and verify all 82 stories, starting with P0, with no presumed functional baseline.
**Spec:** `2026-09-14-media-app-redesign-requirements.md` and taxonomy §3.
**Ownership:** `2026-09-14-media-app-story-implementation-map.md`.

## Global constraints

- Every story begins unverified. Unit passes are supporting evidence, not end-to-end acceptance.
- Demonstrate a behavioral failure before changing implementation; preserve working behavior with regression tests.
- Validate interaction → destination → command → actual player → returned state → accurate UI and feedback.
- Office screen is the only authorized physical test screen. Browser contexts may simulate additional screens. Preserve/restore office state; do not disturb other kiosks.
- P0 first, then P1/P2. Minimum undo moves into P0; expires 10 seconds after tap, cancels pending dispatch, returns live sources to live. Cross-device restoration and notes remain P1.
- Keep the bridge-owned media node stable across navigation; Content modules never import Media modules.
- Structured logs, design-system tokens, existing local/remote controller seam, additive API compatibility.
- Root agent owns tracking docs and end-to-end harness. Task workers own only their named implementation scope. Do not spawn subagents from workers. Commit only owned files; do not deploy from workers.

## Task 1: Four immediate defects

Implement handoff P0 step 1 with test-first behavior checks. Read its Step 1 plus original AC for PLACE.2b, STEER.7a, RELY.6a, PLACE.1a/STEER.1b.

1. D1: Phone destination picker must offer This device; selecting it clears remote targets immediately, with valid accessible UI. Preserve explicit one-off dispatch pickers; This device is the global aim operation, not a fake remote target.
2. D2: Stop keeps the queue accessible through MiniPlayer in ready state; clicking it opens Now Playing/Queue, Play restarts retained queue, clear/reset removes the empty handle. Avoid undefined item accesses.
3. D3: Store exact attempt parameters per dispatchId and expose retry(dispatchId); update tray rows and search failure notices to retry their own target/content/options/snapshot, not the last attempt. A retry of one failed multi-target row must not replay successful siblings. Retain compatibility only for actual remaining callers. Explicit retry bypasses failed-attempt dedupe; repeated taps on an in-flight retry must not duplicate it.
4. D4: Remove implicit peek destination override in all search dispatch functions: single play, collection play/shuffle, collection append. Displayed aim controls destination. Opening/closing Remote never changes aim.

Owned files: Media/cast dispatch/provider/picker files and tests; Media/search/useContentDispatch.js and tests; Media/shell/MiniPlayer.jsx and tests. Do not change PlayerBridge, LocalSessionController, or root-owned ledger/harness. Root will cover live acceptance separately. Add original story IDs to test names. Test through real providers/controllers where practical; mock only external transport. Run focused tests RED then GREEN, related existing tests once after implementation. Update a concise factual reference-doc paragraph for this slice; no claim that full stories passed.

Run `npx vitest run <changed-test-files> --maxWorkers=2`; commands run from this worktree. Main baseline captured separately.

Browser acceptance exposed an additional D1 junction failure: on a phone, the destination modal opens but the Search Mode layer intercepts ordinary taps on its device buttons. Fix the destination-modal/search-layer integration as part of D1; ownership extends to DestinationLine.jsx and necessary search/cast styling. Preserve ordinary pointer and keyboard interaction; do not use forced or synthetic browser clicks. Root-owned `tests/live/flow/media/media-app-aim-journey.runtime.test.mjs` is the RED and GREEN browser check. Root reruns it after implementation.

## Task 2: Disclosure Day playback wiring

Reproduce the real Player journey from search with metadata lacking duration. Reconcile resolved metadata, currentTime, paused/playing state, duration and media capabilities back into the session without remounting Player. Repeated Play on running content must not arm a false startup stall. Seek and progress need real media evidence, including DASH/shadow DOM. Focused playback and Stop must be reachable. Test initial play, seek ±10s/scrub, pause/resume, repeat Play, host expand/shrink, stop/retained queue. Root prepares the browser scenario before dispatching this task.

Confirmed browser RED: `tests/live/flow/media/media-app-playback-journey.runtime.test.mjs` starts the actual movie via the real catalog and ordinary input. Video advances while the Seek slider has maximum zero, unknown length, and disabled interaction. Search metadata lacks duration/format; Player's real progress includes duration but PlayerBridge ignores it. Today’s logs also show Play on already-running content changing session state to loading, then stalled at the watchdog boundary while video continues rendering. A normal pause/resume browser journey currently passes and must remain passing.

Owned implementation: Media/session PlayerBridge, LocalSessionController, reducer/store interfaces and their tests; Media/shell NowPlayingView, SeekBar, TransportBar, related styling and tests. MiniPlayer integration edits are allowed after Task 1 review. Root owns browser harness and tracking docs. Read actual Player media-access/progress contracts; preserve the shared Player for other apps. Add unit RED before implementation for metadata enrichment without media remount, repeated Play while playing, actual paused/playing reconciliation, and DASH media access. Cover stale callbacks from old content and zero/unknown/live duration without inventing seekability.

Provide an accessible `Expand video` control in Now Playing and `Shrink video` while expanded, with focused rendering and reachable transport/Stop. Expansion/shrinking and host navigation must retain the same advancing media element. Use the existing focused shader capability and design-system styling. Avoid a new parallel player. Full-screen mode may fill the app viewport; browser fullscreen is optional. Changes to metadata must not become a new playback identity or reset position. Ensure real-player duration and progress update the visible bar, and scrub changes the actual position. Do not optimistically claim playback has changed when only a command has been issued.

Run focused RED/GREEN unit coverage and existing relevant session/shell tests. Root reruns real browser acceptance, including unchanged normal pause/resume and stop/retained-queue cases. Update a factual reference paragraph and write task report with exact commands, output, red evidence, changed interfaces and concerns. Commit only owned implementation/test/reference files; no deploy.

## Task 3: Shared aim, idle lifetime and safe moves

Read handoff Step 2 and original PLACE.1a, PLACE.2a/2b, PLACE.5a/6a/7a/8a criteria. Deliver one shared aim model and label, not independent destination state in each surface. Preserve additive adapters for existing cast consumers until the common item-actions migration. Required model: selected target IDs, remembered stop-or-keep choice and persisted activity time; idle timeout 2 hours. Restore synchronously without first persisting a blank default. Track real interaction; pause the idle clock while the selected screen is playing an item this device sent or is actively steering. Reload after expired idle selects this device. Opening Remote alone never changes aim.

Replace duplicated label/chip behavior with one accessible aim surface used in search, browse, details, start and controls' add entry. This device always available at phone/tablet/laptop sizes. Show name/room, busy warning and stop-or-keep consequence before Play. Opening or selecting aim alone must send no playback. Use fleet state rather than treating an absent snapshot as confirmed idle. Origin/naming interfaces are additive dependencies on Task 7; do not mark those AC accepted with guessed origin or fabricated device names.

Moves must preserve source until destination actually acknowledges starting the same queue/item at the current position (live starts fresh). Current useTakeOver calls claim, which stops the source before local adoption: demonstrate a failed-local-start RED and repair the transaction. Protect against stale source identity before stopping it; never stop newer playback after a slow handoff. Failure must explain what happened and leave the original usable. Respect the remembered keep/stop choice for Move to; expose moves in the handle, house rows and full controls. Preserve media-node identity for local playback, including Task 2 metadata enrichment. Use the controller and existing API seams, adding backward-compatible acknowledgment/transaction fields where required; no parallel Player or separate aim route.

Ownership: aim provider/hook/label and consumer wiring; move hooks and transaction/controller/API tests; necessary device session application/API contract additions; factual reference docs. Root owns ledger and runtime harness. Unit RED/GREEN must cover idle boundary/reload/active-playing exemption, all label consumers, one-off state isolation, move failed startup/late response/source changed, queue/position and live-edge preservation. Browser acceptance must observe real source and destination players in isolated contexts or office only; intermediate unit success is not full story acceptance. Run changed tests and relevant controller/dispatch regressions; backend edits require layer and composition gates. Write report and commit scoped files, no deploy.

## Remaining sequence

4. Shared item verbs, receiver queue parity, minimum undo.
5. Unified search/browse.
6. Unified control surface and handle.
7. Browser registry, origin, fleet liveness, routine idempotency.
8. Shared outcomes, command expiry/cancellation.
9. Paused persistence, partial reset, navigation.
10. Accessibility, device parity, budgets, complete P0 acceptance and gated release.
11. P1 household history/spots/favourites, shared undo/notes, timers/queue end, multiple screens, system controls, durable receivers.
12. P2 suggestions/history, brief overlays, slideshow music, tracks, admin, screen power/alignment.

Expand each remaining slice into exact implementation/test tasks before executing it. Requirements and acceptance criteria are binding; no scaffolding-only completion.
