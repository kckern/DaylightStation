# Media refusal recovery — design

**Date:** 2026-10-07 · **Owner ruling:** screens HOLD until healed (no auto-skip on refusal).
**Extends:** `docs/reference/player/media-source-healing.md`.

## Incident (2026-10-07, living-room Shield)
Bluey episodes were refused by Plex (NFS per-user "ghost": `Permission denied`), each stalled, recovery exhausted, and the queue auto-skipped episode after episode (~6 burned). The ghost lasted ≥25 min untouched; the host heal (ctime refresh) clears it in <1 s. Recovery existed but never ran:
- **A — wrong item asked.** `useMediaResilience` passes `meta?.contentId || null` + `plexId`; `/play` responses carry `id`/`assetId`, not `contentId`, so `toHealableContentId` fell back to `plexId` = the queue ROOT (show 59493). The healer classified a show (no Media/Part) as `unknown` → Player decision `normal` → stall ladder → auto-skip.
- **B — part not mappable.** `PlexAdapter.#rememberPart` runs only in `loadMediaUrl`; direct-play URLs built by `getItem`/`toPlayable` and queue builders (`/library/parts/<id>/…`) are never indexed, and the index is empty after every restart → `media.source.heal.proxy-unmapped`.
- **C — "readable" skips the host rung.** If `checkFiles` says accessible and the one-byte probe isn't 403/404, the healer stops, although a per-user ghost refuses Plex's transcoder/streamer.
- **D — HLS refusals invisible.** On transcode the refusal is a segment (`.ts`) 404 after a 200 manifest; hls.js logs `networkError` (no MediaError), no resilience branch asks the backend, and the proxy's 404→503 replacement covers only `/library/parts/…`.

## Design
1. **Leaf identity.** The resilience/source-check id is `meta.contentId || meta.assetId || meta.id`, then `plexId` only as a last resort (and never a container). Backend healer rejects container ratingKeys (show/season/album/collection) with `not-a-leaf` (logged), never silently `unknown`.
2. **Part → item.** Remember the part→ratingKey mapping wherever a `/library/parts/…` URL is built (toPlayable, queue/list builders, stream mints). Unknown parts resolve via `GET /library/all?type=4&media.part.id=<id>` (then type 1, 10), cached (bounded LRU). The proxy-replacement trigger awaits this before logging `proxy-unmapped`.
3. **Proxy-observed refusal always refreshes.** With `origin: 'proxy'` (or a Player report of a proxied refusal) the healer runs the host ctime refresh for the mapped path even when Plex's probe says readable; per-file cooldown (e.g. 60 s); re-check after.
4. **HLS joins the path.** Player: hls.js `networkError` on manifest/fragment with status 403/404/5xx (repeated ≥2 for the same session, or fatal) → "suspected refusal" → `/media-source/check` for the leaf item → wait/heal/resume. Log hls `details`, response status and URL kind. Proxy: a transcode **segment** 404 for a session whose input was refused is replaced with 503 `source-unreadable` (same as parts) so the backend trigger fires; mapping via the session's ratingKey.
5. **Screens hold until healed (owner ruling).** On any confirmed/suspected refusal a screen enters the source-unavailable wait: quiet "Fixing this video…" note (TV-legible, no page space beyond the existing overlay), heal + re-check at 2/4/8/15 s, resume at the saved spot when readable; cap 30 min (existing default); **Skip** offered on OK/D-pad and from the Remote; a refusal NEVER auto-skips through a queue on screens. Media app on phones keeps its 60 s cap + storm guard. Fitness/piano keep current waits.

## Testing
Unit: queue-root plexId resolves to the leaf; healer rejects containers; part index populated by every builder + fallback resolution + cache; proxy-origin refresh despite "readable"; HLS error classification → refusal; screen wait never auto-skips; Skip from OK/Remote. Journey (acceptance fixture): fixture refuses one episode's part (503 source-unreadable / segment 404), screen shows the fixing note and does NOT skip; fixture flips to readable; playback resumes at the spot. Logs: `heal.not-a-leaf`, `heal.part-resolved`, `heal.proxy-refresh`, `playback.refusal-hls`.

## Out of scope
The NAS-side cause of the ghost; drop_caches watchdog tuning.

## Notes (review round, 2026-10-07)
- **Hold-until-healed is screen-only (owner ruling).** It applies to TV/kiosk screens rendered by the screen-framework (living-room, office, Portal screen pages), via an explicit `holdOnRefusal` opt-in by `ScreenPlayer`/`MenuStack`. Fitness, piano and school-lesson Players keep their pre-existing behaviour exactly (30 min wait, then the previous cap action) and get no Skip keys and no new park-forever. Earlier wording in this spec that says "every owner without `onResilienceEvent`" is superseded.
- A held screen treats four consecutive `unknown` answers as missing so a deleted item is not held for 30 minutes.
- Skip keys are Enter/NumpadEnter/MediaTrackNext only, and only act when the Skip pill is visible and focus is on the page or the Player.
- Transcode session mapping: Plex's segment path carries Plex's own session uuid; it is resolved lazily from `GET /status/sessions` (`TranscodeSession.key`), not indexed at mint time.
