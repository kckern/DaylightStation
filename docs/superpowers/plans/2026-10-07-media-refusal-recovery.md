# Media refusal recovery — implementation plan

Spec: `docs/superpowers/specs/2026-10-07-media-refusal-recovery-design.md`.
TDD order; each task = failing test, change, green, targeted run only (no full suites while the household is on the TV).

## Backend

1. **Leaf identity (spec 1, backend).** `PlexSourceProbe` returns `state: unknown, reason: 'not-a-leaf'` for container types (show/season/artist/album/collection/playlist/…) i.e. an item with no `Media/Part`; `MediaSourceHealer` logs `heal.not-a-leaf` (`media.source.heal.not-a-leaf` + event name `heal.not-a-leaf`) and answers `reason: 'not-a-leaf'` rather than a silent `unknown`.
   Files: `PlexSourceProbe.mjs(.test)`, `MediaSourceHealer.mjs(.test)`, `sourceHealth.mjs`.
2. **Part -> item index (spec 2).** `PlexAdapter`: remember part->ratingKey in `toPlayable` (every `getItem`/list/queue builder funnels through it); `resolveRatingKeyForPart(partId)` async fallback via `GET /library/all?type=4&media.part.id=<id>` (then type 1, 10), bounded LRU positive cache (negative misses not cached long). Logs `heal.part-resolved`.
   Files: `PlexAdapter.mjs`, new `PlexAdapter.partIndex.test.mjs`.
3. **Proxy trigger awaits resolution (spec 2/3).** Extract app.mjs inline trigger into `3_applications/media/proxyRefusalTrigger.mjs` (`createProxyRefusalHandler`) taking `{healer, resolvePart, logger}`; awaits `resolvePart`, only then `proxy-unmapped`; calls `healer.check(id, {origin:'proxy'})`. Covers `/library/parts/...` AND transcode segment refusal (task 6).
4. **Proxy-origin refresh (spec 3).** `MediaSourceHealer.check(..., {origin:'proxy'})` runs the host ctime refresh even when Plex's probe says readable; per-file cooldown (default 60 s `proxyRefreshCooldownMs`), re-checks after; logs `heal.proxy-refresh`. Router forwards `origin` (`proxy` or `player-proxy`) from body.
5. **Container reject in router** returns the healer answer unchanged (covered in 1).
6. **HLS segment 404 -> 503 (spec 4, proxy).** `PlexProxyAdapter`: transcode segment path (`/video/:/transcode/universal/session/<sid>/<n>/<seg>.ts|.m4s`, also `/audio/...`) 404 -> retries then 503 `source-unreadable`; `ProxyService` event carries the path, trigger maps session -> ratingKey via a session index in `PlexAdapter` (record `X-Plex-Session-Identifier`/`path` ratingKey on minting transcode URLs in `loadMediaUrl`/`_buildTranscodeUrl`) with fallback to the part-index.

## Frontend

7. **Leaf identity (spec 1, frontend).** `resolveSourceContentId(meta, plexId)` in `sourceAvailability.js`: `meta.contentId || meta.assetId || meta.id`, `plexId` last resort; `useMediaResilience` uses it.
8. **HLS refusal classification (spec 4).** New `lib/hlsRefusal.js`: classify hls.js error `data` (network type, details manifest/level/frag load errors, response.code 403/404/5xx) with a per-session counter (>=2 or fatal). `VideoPlayer` dispatches `daylight:hls-refusal` DOM event on the element and logs `playback.refusal-hls` {details, status, urlKind}; `useSourceAvailability` listens (via `getMediaEl`+`registrationSignal`) -> `checkNow('hls-refusal', {suspected:true})`.
9. **Screens hold (spec 5).** `holdOnRefusal` (opt-in by the screen-framework owner only - ScreenPlayer, MenuStack; review-round owner ruling: fitness, piano and school-lesson Players keep previous behaviour): confirmed refusal + unknown/failed check keeps waiting; `handleResilienceExhausted` never advances on `source-unavailable-gave-up` for those owners (holds on Tap to Retry); notice text "Fixing this video…"; overlay Skip (button + Enter/OK/MediaTrackNext key while waiting; D-pad focus) wired to `manualAdvance`; Remote skip via `playerApi.advance` is unaffected (tested). Media (phones) keeps 60 s + storm guard (tested).
10. **Regression proofs.** Tests that fitness/piano/school-style owners (no `onResilienceEvent`, default 30 min) keep the documented wait, and Media options unchanged.

## Docs / journey

11. Update `docs/reference/player/media-source-healing.md` (also correct the part-index description: it was "every URL minted since startup" but only `loadMediaUrl` indexed).
12. Playwright journey `tests/live/flow/screen/media-refusal-hold.runtime.test.mjs` (refuse one episode part, assert fixing note, no skip, flip readable, resume at spot). Run only when `./scripts/deploy-gate.sh` exits 0 and 1-min load < 8, against an exact-SHA preview, `--workers=1`.
13. `npm run audit:layers`.
