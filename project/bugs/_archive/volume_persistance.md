#Description
Scope frontend/src/modules/Fitness/FitnessSidebar/TouchVolumeButtons.jsx 
Works fine for setting volume.  However, if the video or audio reloads due to #useMediaResiliance, or moves to the next track, the volume resets to default. Volume should persist across media reloads and track changes.  Local storage or context can be used to store the volume level.  If there is already a volume set for a sibling track in the same show, season, or album or playlist, that volume should be used as the default for the new/next track, even if the user has not explicitly set volume for that track yet.  No need to save to backend, but the local storage or context should persist across page reloads and never expire or clear unless the user explicitly resets it via developer tools or similar, but nothing the ux should allow them to reset or clear it.


## Architecture Suggestions

- Add a persistent volume store (context + localStorage) keyed by the real IDs we have in `FitnessShow.jsx`.
	- Key shape: `volume:fitness:<showId>:<seasonId>:<trackId>` where `trackId` = `episode.plex` (or fallback to `episode.id`/`episode.thumb_id` if plex is absent). `seasonId` can be `null`/`unknown` for single-season feeds. Fall back order: exact track → sibling in same show+season → global default.
	- Persist `{ level: number (0-1), muted: boolean, updatedAt }` in localStorage; hydrate into context on load.
	- On media change (next track, resilience reload), read from context/localStorage and apply before play starts.

- Introduce a lightweight `usePersistentVolume` hook used by `TouchVolumeButtons` and the player:
	- Inputs: `showId`, `seasonId` (optional), `trackId` (`episode.plex` preferred).
	- Expose: `volume`, `muted`, `setVolume(level)`, `toggleMute()`, `applyToPlayer(playerApi)`.
	- On `setVolume`, update context state, write through to localStorage, and call player API (`setVolume`, `setMuted`).
	- On hydrate: resolve best match (track → sibling in same show/season → global) and set initial volume before playback resumes.

- Player integration:
	- On source change or resilience reload, call `usePersistentVolume.applyToPlayer` with resolved volume/mute before `play()`.
	- Avoid resetting when the media element is recreated by reapplying stored volume after `loadedmetadata`.

- Context design:
	- `VolumeContext` with map `{ key: VolumeState }` plus helper `getVolumeFor(showId, seasonId, trackId)` to implement the fallback chain.
	- Debounce writes to localStorage to avoid churn; but write immediately on user change to feel snappy.

- Sibling reuse logic:
	- When no track-specific entry exists, scan entries for the same `showId` + `seasonId` (or just `showId` when seasonless) and use the most recent `updatedAt`.
	- If none, use global default (e.g., 0.6, muted false) and persist after first user change.

- Resilience considerations:
	- Ensure the hook rehydrates on mount and on route changes; guard against SSR/undefined `window`.
	- Handle malformed storage by pruning invalid entries during hydrate.

- No UX reset: no UI to clear storage; only manual dev-tools clearing resets it.

## Detailed Design

### Data model
- Volume state: `{ level: number (0-1), muted: boolean, updatedAt: number }`.
- Storage keys: `volume:fitness:<showId>:<seasonId>:<trackId>` (all parts stringified; `seasonId` may be `unknown`/`-` for single-season content); global default key `volume:global`.
- Fallback resolution order: exact track → most-recent sibling in same show/season → global default.

### LocalStorage schema and hygiene
- On hydrate, load all `volume:*` entries, validate shape, and drop malformed ones.
- Keep an in-memory map mirror for fast lookups; writes update both map and localStorage.
- Debounce batched writes (e.g., 150ms) but apply immediate write on user-initiated changes.

### Context and hook API
- `VolumeProvider` holds the map and exposes:
	- `getVolume(showId, seasonId, trackId)` → resolved state with fallback and a `source` hint (`exact|sibling|global`).
	- `setVolume(showId, seasonId, trackId, { level, muted })` → updates map + storage and returns the resolved state.
- `usePersistentVolume({ showId, seasonId, trackId, playerRef })` returns:
	- `volume`, `muted`, `setVolume(level)`, `toggleMute()`, `applyToPlayer()`
	- Internals: on mount/identity change, resolve state, set internal state, and optionally call `applyToPlayer` if playerRef is ready.

### Player integration points
- On media source change (next track, resilience reload), call `applyToPlayer` after `loadedmetadata` (or equivalent ready event) to reapply stored volume/mute before playback.
- For resilience where the element is recreated, re-run `applyToPlayer` when the ref changes or when `playerRef.current` emits readiness.
- Ensure `setVolume` also updates the player immediately so UI and playback stay in sync.

### Sibling reuse algorithm
- When resolving volume for a track with no exact entry:
	- Filter entries with same `showId` + `seasonId` (or just `showId` when season is unknown).
	- Pick the one with the latest `updatedAt`.
	- Fall back to global default if none exist.

### Default behavior
- Global default: `level = 0.6`, `muted = false` (configurable constant). Persist this once the user makes any change.

### TouchVolumeButtons wiring
- Replace direct player volume calls with `usePersistentVolume`:
	- Read resolved volume on mount; render slider at that level.
	- On slider change, call `setVolume(level)`; the hook writes through to context + storage + player.
	- On mute toggle, update context + storage + player.

### Resilience and safety
- Guard for `window` when accessing localStorage; no-ops on SSR.
- Catch and log storage errors (quota/full) but continue with in-memory map for the session.
- Prune stale/invalid entries during hydrate; keep data indefinitely otherwise.

### Testing notes
- Unit: fallback resolution (exact/sibling/global), storage hygiene, debounce behavior, applyToPlayer invocation ordering.
- Integration: simulate media reload/next track; verify volume persists and applies before playback.

## Implementation Phases

1) Storage + context foundation
- Build `VolumeContext` and in-memory map with localStorage sync keyed as `volume:fitness:<showId>:<seasonId>:<trackId>` (trackId = `episode.plex` → fallback `id`/`thumb_id`).
- Add helpers: `getVolume(showId, seasonId, trackId)` with sibling fallback; `setVolume(...)` write-through (immediate) + debounced batch; hydrate on load with shape validation and prune bad entries.
- Define constants for defaults (`level=0.6`, `muted=false`) and sentinel seasonId (`unknown` or `-`).

2) Hook wiring (`usePersistentVolume`)
- Implement hook taking `{ showId, seasonId, trackId, playerRef? }` that resolves initial state, exposes `volume`, `muted`, `setVolume(level)`, `toggleMute()`, `applyToPlayer()`.
- On identity change: resolve state with fallback (exact → show+season → show → global), update internal state, and optionally call `applyToPlayer` if player is ready.
- On setter calls: update context, persist, and immediately call player API (`setVolume`, `setMuted`).

3) Integrate in UI/player
- Wrap Fitness app tree with `VolumeProvider` (if not already) where `TouchVolumeButtons` and the player live.
- In `TouchVolumeButtons`, replace direct volume mutations with the hook; feed it `showId`, `seasonId`, `trackId=episode.plex` (fallbacks preserved).
- In player/resilience flow, call `applyToPlayer` after `loadedmetadata` or equivalent readiness on source change/reload so recreated elements get the stored volume.

4) Resilience + edge cases
- Guard for SSR/no-window and catch localStorage failures (quota) with in-memory fallback only.
- Ensure seasonless items still reuse by using `showId` + sentinel seasonId; keep sibling lookup to most recent `updatedAt`.
- Preserve behavior for non-Plex items by falling back to `id`/`thumb_id` and still persisting.

5) Tests and verification
- Unit: sibling fallback ordering, malformed storage pruning, debounce behavior, applyToPlayer ordering.
- Integration/manual: next-track and resilience reload keep volume/mute; seasonless and single-season shows reuse; global default respected when no siblings.