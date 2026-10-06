# STEER.2a batch 1 report

**Status:** implementation and focused unit GREEN; ready for independent review. This does not accept STEER.2a. Browser GREEN is deliberately deferred until review produces an exact clean snapshot containing only the reviewed packet and excluding parked F3e/Task8b changes.

## Scope

- Changed: `frontend/src/modules/Media/shell/NowPlayingView.jsx`, `frontend/src/modules/Media/shell/NowPlayingView.test.jsx`, and additive `tests/live/flow/media/media-app-playback-journey.runtime.test.mjs`.
- Unchanged: Player, session, bridge, screen-framework, backend, and stylesheet (existing expanded-surface CSS already presents the retained metadata block).
- Brief corrected: `2026-09-19-media-app-batch-1.md` now says immutable `5a054a11c` is RED/existing-evidence only; new-code GREEN requires the later clean snapshot.

## Behavior and evidence

`NowPlayingView` now treats local `format`/`mediaType: audio` as expandable, with accessible **Expand audio** / **Shrink audio** labels. Expanded audio retains the existing metadata block, so it visibly supplies artwork (or its existing music placeholder) and title while the same ambient player host and transport remain mounted. Video labels/behavior are unchanged.

The new component test names the missing-production-branch break: removal of audio expand or metadata during expanded audio. It uses a literal audio item and asserts the consumer-visible accessible control, artwork URL, and title; it was RED because no `Expand audio` control existed.

Read-only catalog discovery against the existing immutable preview found Plex Music track **Faith**, `plex:584614`, `mediaType: audio`, with a thumbnail and stream route. It was **not** allowlisted by that old preview: `GET /api/v1/play/plex:584614` returned `403 Acceptance play read restricted to authorized test titles`. The packet therefore adds this exact rating key only to the branch acceptance-server fixture allowlist (not product configuration). The additive runtime case no longer selects by title: desktop/tablet require exactly one row containing `result-more-plex:584614`; phone requires `search-mode-result-plex:584614`; it asserts the resulting Now Playing content id and successful exact play-read before observing the real `<audio>` node. It then expands through ordinary input, sees artwork/title, and verifies the original audio node remains connected and advancing after shrink. It supports desktop/tablet and phone search paths; it performs no device writes or fabricated player state.

## Commands and results

| Stage | Command | Result |
|---|---|---|
| RED | `npx vitest run frontend/src/modules/Media/shell/NowPlayingView.test.jsx` | Expected failure: no accessible button named `Expand audio`; 12 passed, 1 failed. |
| GREEN | `npx vitest run frontend/src/modules/Media/shell/NowPlayingView.test.jsx` | **13 passed, 0 failed** in 1.22s. |
| Harness RED | `npx vitest run tests/_lib/media-redesign-server.test.mjs` | Expected failure: `BRANCH_ALLOWED_TITLES` was absent, so the reviewed audio fixture could not be authorized. |
| Harness GREEN | `npx vitest run tests/_lib/media-redesign-server.test.mjs` | **8 passed, 0 failed** in 1.03s; the only new authorization is `584614`. |
| Clean-snapshot preparation | `git worktree add --detach /tmp/daylight-media-steer2a-green 5a054a11c...` | Detached clean base created. Its isolated dependency tree lacks `frontend/node_modules/@vitejs/plugin-react`; no browser or replacement install was run. Per root direction, snapshot/clean-runtime GREEN follows review rather than using the dirty worktree or old preview. |

## Required post-review focused GREEN

Create an exact reviewed clean snapshot excluding parked changes, then run only:

```
npx vitest run frontend/src/modules/Media/shell/NowPlayingView.test.jsx
MEDIA_ACCEPTANCE_VIEWPORT=desktop npx playwright test tests/live/flow/media/media-app-playback-journey.runtime.test.mjs --grep 'STEER\\.2a' --reporter=line --workers=1
MEDIA_ACCEPTANCE_VIEWPORT=phone npx playwright test tests/live/flow/media/media-app-playback-journey.runtime.test.mjs --grep 'STEER\\.2a' --reporter=line --workers=1
MEDIA_ACCEPTANCE_VIEWPORT=tablet npx playwright test tests/live/flow/media/media-app-playback-journey.runtime.test.mjs --grep 'STEER\\.2a' --reporter=line --workers=1
```

Those commands cover the pre-existing focused video AC1/2 case and the added audio AC3 case only. Record the clean snapshot revision and native observations before any acceptance decision.

## Commit/snapshot blocker

The reviewed packet was staged with exactly the seven files listed in Scope; no ledger, F3e, Task8b, or review-diff file was staged. Normal `git commit -m "feat(media): expand local audio controls"` ran its hooks and was stopped by the global layer audit: `apps-no-node-infrastructure 1 (baseline 0) REGRESSION`. The packet makes no application-layer source change; the shared worktree still contains parked F3e Player/Media/session/screen-framework edits, so this global worktree gate cannot establish a packet-only clean commit. No hook bypass or retry was attempted. Consequently there is no new SHA, clean snapshot, or browser/native observation for this batch yet.
