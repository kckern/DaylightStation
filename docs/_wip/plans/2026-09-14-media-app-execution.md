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

## Task 2: Disclosure Day playback wiring

Reproduce the real Player journey from search with metadata lacking duration. Reconcile resolved metadata, currentTime, paused/playing state, duration and media capabilities back into the session without remounting Player. Repeated Play on running content must not arm a false startup stall. Seek and progress need real media evidence, including DASH/shadow DOM. Focused playback and Stop must be reachable. Test initial play, seek ±10s/scrub, pause/resume, repeat Play, host expand/shrink, stop/retained queue. Root prepares the browser scenario before dispatching this task.

## Remaining sequence

3. Shared aim, idle lifetime, safe moves.
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
