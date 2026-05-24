# Fitness Music Player

Background music for fitness sessions. Independent of the video player but coordinated with it (auto-pauses when video pauses, auto-pauses when voice memo is recording). Renders compact in the sidebar and expands a controls panel on tap.

**Source:** `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx`

## Use Case

While the user does a workout video, music from a chosen Plex playlist plays underneath at a separate, persistently-remembered volume. The user can:

- Pick a playlist (modal selector)
- Tap album art to play/pause
- Tap track info to expand a controls panel with independent **Video Volume** and **Music Volume** sliders
- Skip to the next track
- Tap a retry affordance if loading is stuck
- Turn music off entirely

The music player is the **only** thing in the fitness UI that survives across video/playlist changes — it owns its own queue, its own volume, and its own Plex client session.

## Component API

```jsx
<FitnessMusicPlayer
  ref={musicPlayerRef}                    // exposes { pause, resume, isPlaying }
  selectedPlaylistId={playlistId}         // string | null — Plex playlist id
  videoPlayerRef={videoPlayerRef}         // ref to the fitness <Player>
  videoVolume={videoVolumeControls}       // { volume, setVolume, applyToPlayer }
/>
```

If `selectedPlaylistId` is null, the component renders nothing (`return null`).

### Imperative handle

External callers (notably the voice memo system) pause/resume music via the forwarded ref:

| Method      | Behavior |
|-------------|----------|
| `pause()`   | Pauses audio, records `wasPlayingBeforePauseRef` for later resume |
| `resume()`  | Resumes only if `wasPlayingBeforePauseRef` was set |
| `isPlaying()` | Returns current play state |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        FitnessMusicPlayer                            │
│                                                                      │
│  ┌─────────────────────┐   ┌────────────────────────────────────┐    │
│  │  Visible UI (sidebar)│   │  Hidden <Player> (offscreen)       │    │
│  │  • Album art         │   │  • Owns the queue                  │    │
│  │  • Title / artist    │◀──┤  • Fetches Plex playlist           │    │
│  │  • Progress bar      │   │  • Emits onProgress with media+time │    │
│  │  • Next button       │   │  • key={playlistId-attempt} to     │    │
│  │  • Expand controls   │   │    force remount on retry          │    │
│  └─────────────────────┘   └────────────────────────────────────┘    │
│                                                                      │
│  Expanded controls (controlsOpen)                                    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Video Volume   [TouchVolumeButtons]  (only if video present) │    │
│  │ Music Volume   [TouchVolumeButtons]                          │    │
│  │ Current Playlist  ▼  → FitnessPlaylistSelector modal         │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
            │                                  │
            ▼                                  ▼
   ┌──────────────────┐              ┌──────────────────────┐
   │ usePersistentVol │              │ useStuckLoadingDet.  │
   │ (per-track vol)  │              │ (15 s no-track → UI) │
   └──────────────────┘              └──────────────────────┘
```

## Key Behaviors

### Track state from progress callback

The component does **not** maintain its own queue — that's the inner `<Player>`'s job. Instead, `handleProgress(progressData)` derives `currentTrack` from each progress tick by comparing `contentId | key | plex | assetId` against the previous track and only updating when it changes. This keeps local state in sync with the Player's internal index without dual sources of truth.

### Next button

`handleNext` calls `audioPlayerRef.current.advance(1)`. **It does not mutate local queue state.** The previous (buggy) approach of advancing local state caused desync between Player internals and local state — letting `handleProgress` pick up the new track via callback is the canonical path.

### Pause coordination

A single effect (FitnessMusicPlayer.jsx:123) watches two flags from `FitnessContext`:

| Flag                 | Source                             | Effect on music |
|----------------------|------------------------------------|-----------------|
| `videoPlayerPaused`  | Set by video player                | Pause music    |
| `voiceMemoOpen`      | `voiceMemoOverlayState.open`       | Pause music    |

`shouldPause = videoPlayerPaused || voiceMemoOpen`. Music resumes only if `wasPlayingBeforePauseRef` is true AND both signals are clear.

### Two volume curves

The music player owns **two** TouchVolumeButtons groups with **different volume curves**:

| Slider | Linear/Log | Why |
|--------|------------|-----|
| Video Volume | Linear (`linearVolumeFromLevel` / `linearLevelFromVolume`) | Video audio is the user's primary content; linear feels natural |
| Music Volume | Logarithmic (`logVolumeFromLevel` / `logLevelFromVolume`) | Music sits underneath video; perceptually flat steps at low volume require a log curve |

The log curve is calibrated so level 50 (midpoint) ≈ 10% output volume — math is at FitnessMusicPlayer.jsx:14-33.

### Persistent volume

Music volume is keyed by playlist and track via `usePersistentVolume`:

```
grandparentId: 'fitness-music'
parentId:      <selectedPlaylistId> || 'global'
trackId:       <contentId|key|plex|assetId|ratingKey|id> || 'music'
```

Volume choices persist across sessions and resolve per-track first, falling back up the hierarchy.

### Error surfacing (primary)

Failures between "playlist selected" and "first audio sample" flow back to the music player through an `onError({ kind, ...details })` callback on `<Player>`. Each kind maps to a specific user-visible message via `musicPlayerErrorFormat.js`:

| Kind                  | Source                                       | UI message                              |
|-----------------------|----------------------------------------------|-----------------------------------------|
| `fetch-failed`        | `useQueueController` (HTTP error on queue resolve) | `Music API error (HTTP <status>)` |
| `fetch-timeout`       | `useQueueController` (10 s client-side timeout)    | `Music load timed out`            |
| `empty-queue`         | `useQueueController` (API returned `items: []`)    | `Playlist empty`                  |
| `invalid-queue`       | `useQueueController` (no items survived validation) | `Playlist contains no playable items` |
| `media-error`         | `useMediaErrorReporter` (audio element `error` event) | `Media error (code <n>)`        |
| `media-load-timeout`  | `useMediaErrorReporter` (15 s without `canplay`/`playing`) | `Music load timed out`      |

The displayed text is always rendered as a tap-to-retry affordance: `<message> — tap to retry`. Tapping clears `playerError` and bumps `stuck.attempt`, which is woven into the hidden `<Player>`'s React `key` (`${selectedPlaylistId}-${stuck.attempt}`) — forcing a clean remount and fresh playlist fetch.

A structured `fitness.music.player_error` warn log fires for every kind with `{ kind, contentRef, httpStatus, timeoutMs, code, playlistId }`.

### Stuck-loading detector (backstop)

`useStuckLoadingDetector({ hasTrack, playlistId, thresholdMs: 15_000 })` is a **last-resort safety net**, no longer the primary failure UI. It flips `isStuck` true if a playlist is selected but no track has appeared after 15 seconds.

When stuck:
- If `playerError` is non-null, the explicit error message is already showing (no extra UI change).
- If `playerError` is null, the title area falls back to a generic `Music unavailable — tap to retry` affordance using `kind: 'unknown'`.
- A structured `fitness.music.stuck_loading` warning is emitted **once** per stuck episode (deduped via `stuckLoggedRef`) with a `silentFailure: <bool>` flag set to `!hasExplicitError`. **A `silentFailure: true` event is a bug indicator** — it means a failure path upstream of the explicit error channel was hit and needs to be instrumented. See `docs/_wip/bugs/2026-05-23-music-player-loading-and-unavailable-states-are-bugs.md`.

### Distinct Plex client session

```js
const musicPlexSession = useMemo(() => `fitness-music-${guid()}`, []);
```

The music player passes its own `plexClientSession` to `<Player>` so it has a distinct `X-Plex-Client-Identifier` from the video player. Without this, Plex sees a single client and the video and music players collide on session state.

### Marquee scrolling for long titles

Track title containers measure overflow on every `currentTrack.title` / `currentTrack.label` change using a double-`requestAnimationFrame` pattern (measure after paint to avoid layout thrashing). If the text is wider than its container, a CSS custom property `--scroll-distance` drives a marquee animation; otherwise it stays static.

### Controls auto-collapse

When the expanded panel is open, a 15-second inactivity timer (`INACTIVITY_MS`) collapses it. Every `onPointerDownCapture` inside the panel resets the timer via `scheduleCollapse`.

### Interaction lock (BUG-04)

`interactionLockRef` records a `performance.now()` timestamp at every major UI transition (expand/collapse, info tap, next). Subsequent pointer events that arrive **before** that timestamp are ignored. This guards newly-revealed UI from accidentally consuming the tap that revealed it.

### Auto-select first playlist

If the user lands on the fitness session with `selectedPlaylistId === null`, the component picks the first available playlist from `plexConfig.music_playlists` and enables music (`setMusicOverride(true)` if music is currently off). The `hasAutoSelectedRef` guard ensures this fires exactly once per mount.

## Data Sources

| Source                              | Used for                                          |
|-------------------------------------|---------------------------------------------------|
| `useFitnessContext()`               | Pause flags, playlist list, music-enabled state, session instance for telemetry |
| `usePersistentVolume`               | Per-track music volume hierarchy                  |
| `videoVolume` prop                  | Linear video volume control (passed through)      |
| `<Player>` via `audioPlayerRef`     | Queue ownership, playback, `advance(1)`, `toggle()` |
| `ContentDisplayUrl(trackKey)`       | Album artwork URL                                 |

## Telemetry

On each new track, a `media_start` event is logged via `sessionInstance.logEvent` with:

```
{
  source: 'music_player',
  contentId, title, artist, album,
  playlistId, plexId, mediaKey,
  durationSeconds,
  volume,        // rounded to 2 decimals
  musicEnabled
}
```

A matching `media_end` is emitted in the effect cleanup.

A `fitness.music.stuck_loading` warning is emitted once per stuck episode (see [Stuck-loading detector](#stuck-loading-detector)).

## Related Files

| File | Role |
|------|------|
| `frontend/src/modules/Player/Player.jsx` | The hidden queue-owning player |
| `frontend/src/modules/Fitness/player/panels/TouchVolumeButtons.jsx` | The button-row volume control + `linearVolumeFromLevel` / `linearLevelFromVolume` / `snapToTouchLevel` helpers |
| `frontend/src/modules/Fitness/player/panels/FitnessPlaylistSelector.jsx` | Modal playlist picker |
| `frontend/src/modules/Fitness/player/panels/useStuckLoadingDetector.js` | The 15 s stuck-loading hook |
| `frontend/src/modules/Fitness/nav/usePersistentVolume.js` | Persistent per-track/playlist volume |
| `frontend/src/modules/Fitness/nav/VolumeProvider.jsx` | The volume store backing `usePersistentVolume` |
| `frontend/src/context/FitnessContext.jsx` | Provides `videoPlayerPaused`, `voiceMemoOverlayState`, playlists, music-enabled state, session instance |
| `frontend/src/modules/Fitness/FitnessSidebar.scss` | Styles for `.fitness-music-player-container`, expanded controls, marquee |

## See Also

- [Voice Memo System](voice-memo.md) — pauses the music player via the imperative `pause()` / `resume()` ref
- [Fitness System Architecture](fitness-system-architecture.md) — overall context for how this fits the session UI
