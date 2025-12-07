# Volume Persistence Redo

## Goals
- Zero runtime regressions: no undefined refs/vars; hook-order stable.
- Deterministic volume apply: volume/mute applied before playback on every media load/reload.
- Robust persistence: localStorage with in-memory fallback; safe on SSR/blocked storage/quota errors.
- Predictable sibling reuse: best-match fallback ordering with timestamps; single-season handled.
- Minimal API surface: one hook + one provider; clear contracts for player/UI.

## Data Model
- Volume state: `{ level: number (0-1), muted: boolean, updatedAt: number }`.
- Storage key: `volume:fitness:<showId>:<seasonId>:<trackId>` where parts are strings; seasonId can be `unknown` when absent.
- Global default key: `volume:global` with default `{ level: 0.6, muted: false }`.

## Fallback Resolution
1) Exact track match.
2) Most-recent sibling with same showId + seasonId (seasonId may be `unknown`).
3) Most-recent sibling with same showId (ignore seasonId).
4) Global default.
- Tie-break by `updatedAt` (latest wins); ignore malformed entries.

## Storage & Hygiene
- Guard `typeof window !== 'undefined'` before touching storage.
- Hydrate all `volume:fitness:*` + `volume:global` on provider mount.
- Validate shape; drop malformed entries; keep in-memory map even if storage is unavailable.
- Writes update memory first; best-effort write to storage; on error, log once and continue in-memory.
- Optional debounce for non-critical writes (e.g., 150ms), but immediate write on user change.

## Context API (VolumeProvider)
- `getVolume(showId, seasonId, trackId)` → `{ level, muted, source }` using fallback chain.
- `setVolume(showId, seasonId, trackId, { level, muted? })` → updates map, sets `updatedAt = now`, writes through; returns resolved state.
- `applyToPlayer(playerRef, state)` → calls `setVolume`/`setMuted` on player if available.
- Provider holds map state and storage health flag.

## Hook API (`usePersistentVolume`)
Input: `{ showId, seasonId, trackId, playerRef? }`.
Returns:
- `volume`, `muted`, `setVolume(level)`, `toggleMute()`, `applyToPlayer(volume?, muted?)`, `source`.
Behavior:
- On identity change, resolve via `getVolume`, set local state, and `applyToPlayer` if `playerRef` ready.
- `setVolume`/`toggleMute` update context (and storage) then apply to player immediately.
- Guard hook for missing IDs by falling back to global key only.

## Player Integration
- Player owns `playerRef` and passes to `usePersistentVolume` with media identity:
  - `showId`: `enhancedCurrentItem.showId || currentItem.showId || currentItem.seriesId || currentItem.plex || 'fitness'`.
  - `seasonId`: `enhancedCurrentItem.seasonId || currentItem.seasonId || 'unknown'`.
  - `trackId`: `currentMediaIdentity` (plex/media_key/id/guid/media_url fallback).
- On media change/resilience reload:
  - After source load/`loadedmetadata`, call `applyToPlayer()` to reapply stored state (covers recreated elements).
  - Keep `useEffect` keyed on `{ showId, seasonId, trackId, playerRef }` to re-run apply.
- Do not recreate refs/hooks across renders; no inline hook calls conditional on media presence.

## UI Integration (e.g., TouchVolumeButtons, Sidebar Music Player)
- Consume `usePersistentVolume` with same identity inputs and `playerRef` when available.
- Drive sliders/toggles from hook state; call `setVolume`/`toggleMute` on user input.
- No direct `playerRef` volume mutations outside the hook.
- Sliders must hydrate from persisted volume on mount/identity change so the UI shows the real stored level before user interaction. Apply the resolved volume to the media element immediately to avoid flashing defaults. Ensure both Fitness video slider (sidebar/player) and music slider use this path to prevent divergent implementations.

## Resilience & Edge Cases
- If storage fails, continue with in-memory map; log once.
- If IDs are missing, use global default and persist once user adjusts.
- Seasonless content uses `seasonId='unknown'` to enable sibling reuse.
- Non-Plex items: trackId falls back to `id`/`thumb_id`/`guid`/`media_url` stringified.
- Avoid infinite loops: `applyToPlayer` is idempotent and ignores `undefined` volume.

## Testing Plan
- Unit: fallback ordering, timestamp tie-break, malformed storage pruning, storage-failure fallback, idempotent apply.
- Integration/manual: next-track and resilience reload retain volume; seasonless reuse; non-Plex items persist; global default honored when nothing else exists.

## Rollout Steps
1) Implement `VolumeProvider` + storage module (hydrate, validate, get/set, write-through).
2) Implement `usePersistentVolume` consuming provider.
3) Wire player and sidebar/music UI to the hook; remove ad-hoc volume mutations.
4) Add defensive apply-after-load effect in Player.
5) Validate manually (reloads, next track, seasonless, non-Plex).
6) Add targeted unit tests around storage and fallback resolution.

## Common Mistakes and Pitfalls
- Referencing hooks/vars before initialization (e.g., using `enhancedCurrentItem` or controller helpers before they are declared).
- Forgetting to declare refs/state used across effects (`governanceInitialPauseRef`, `loggedVideoMediaRef`, `seekIntentRef`, thumbnail refs).
- Recreating or conditionally skipping hooks when media changes, causing hook-order violations.
- Not guarding storage for SSR/blocked localStorage, leading to crashes instead of falling back to memory.
- Failing to reapply volume after media reload/resilience, so recreated elements reset to defaults.
- Missing fallback identity pieces (show/season/track) leading to lost persistence for non-Plex or seasonless items.

## Implementation Phases (fresh plan)
1) Storage core: add a dedicated storage module (hydrate, validate, get/set, write-through, in-memory fallback, optional debounce) and unit tests covering malformed entries, tie-breaks, and storage failures.
2) Context/provider: implement `VolumeProvider` with the map, storage health flag, `getVolume`/`setVolume`/`applyToPlayer`, and a strict fallback resolver; wire provider into the Fitness app tree near the root.
3) Hook: build `usePersistentVolume` that consumes the provider, owns local state, re-resolves on identity changes, applies to `playerRef` immediately, and guards missing IDs to the global default.
4) Integration: refactor `FitnessPlayer.jsx`, `FitnessSidebar.jsx`, and `FitnessSidebar/FitnessMusicPlayer.jsx` to consume the hook, remove ad-hoc volume mutations, and add apply-after-load effects to handle recreated media elements.
5) Validation: add targeted unit tests for storage and resolver, plus manual regression passes (reload, next track, seasonless, non-Plex, blocked storage) before toggling rollout; keep telemetry/logging for storage failures minimal but visible.
