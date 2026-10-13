# ArtMode Background Music — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Purpose

Play config-driven ambient background music while ArtMode is showing, and display a
static brass nameplate on the top frame rail with the current track + artist —
mirroring the artwork nameplate on the bottom rail.

## Scope

ArtMode only. Configured via the screensaver's props. No backend changes — the
existing queue endpoint already resolves a playlist with audio metadata.

Out of scope: interactive transport (play/pause/seek/skip), per-screen reusable audio
layer, volume UI, visualizers. Music is ambient and hands-off.

## Music source

Config names a queue / Plex playlist key. The frontend resolves it through the
existing endpoint:

```
GET /api/v1/queue/<key>?shuffle=1
→ { items: [ { mediaUrl, title, artist | grandparentTitle, album, ... } ] }
```

`mediaUrl` is a directly playable stream URL; `artist`/`title` come from Plex
metadata. Items without a `mediaUrl` are dropped.

## Architecture

```
screensaver.props.music { queue, shuffle, volume }
  → useBackgroundMusic(audioRef, music)
      → GET /api/v1/queue/<queue>?shuffle=<shuffle>   (existing)
      → toTracks(items) → tracks[] { mediaUrl, title, artist }
      → wires <audio>: src + volume + play(); on 'ended' → advance (loops);
        on 'error' → skip; reshuffles on wrap when shuffle
      → returns { track: { title, artist } | null }
  → ArtMode renders the hidden <audio> + a top-rail music plaque from `track`
```

## New units (all under `frontend/src/lib/Player/`)

### `playlist.js` — pure helpers (no DOM)

- `toTracks(queueResponse) → [{ mediaUrl, title, artist }]` — maps `response.items`,
  using `artist || grandparentTitle` for the artist, dropping any item without a
  `mediaUrl`. Returns `[]` for missing/empty input.
- `advanceIndex(i, len) → number` — `(i + 1) % len`; returns `0` when `len` is `0`.
- `shuffleOrder(len) → number[]` — a shuffled `[0..len-1]` (Fisher–Yates). Returns
  `[]` for `len <= 0`. (Frontend code may use `Math.random`.)

### `useBackgroundMusic.js` — the hook

Signature: `useBackgroundMusic(audioRef, music) → { track }`.

- When `music` is falsy/empty → does nothing, returns `{ track: null }` (so ArtMode
  renders no audio and no plaque).
- On mount (and when `music.queue` changes): `DaylightAPI('api/v1/queue/' + queue +
  (shuffle ? '?shuffle=1' : ''))`, then `toTracks(...)`. Empty/failed → `track: null`,
  logged; no throw.
- Builds a play order: identity, or `shuffleOrder(len)` when `shuffle`. Tracks a
  current position; the current track is `tracks[order[pos]]`.
- Wires the element at `audioRef.current`: set `volume` (config `volume`, default
  `0.25`, clamped `[0,1]`), set `src` to the current track's `mediaUrl`, call `play()`.
  - `play()` rejection (autoplay blocked) → log `artmode.music.autoplay-blocked` and
    attach a one-time `keydown` listener that retries `play()`.
  - `ended` event → advance position (wrap with `advanceIndex`); on wrap, re-derive the
    order (reshuffle when `shuffle`); set next `src`; `play()`.
  - `error` event → skip to the next track (same advance path), logged.
- Cleanup on unmount / queue change: pause the element, clear `src`, remove all
  listeners, drop the gesture listener.
- Lifecycle logs: `artmode.music.loaded` (count), `artmode.music.track` (title/artist
  on each change), `artmode.music.empty`, `artmode.music.error`.

## ArtMode changes

- New prop `music` (from `screensaver.props.music`): `{ queue, shuffle, volume }`.
- When `music` is present: render a hidden `<audio ref={musicRef}
  data-testid="artmode-music">` and call `useBackgroundMusic(musicRef, music)`.
- Render a **music plaque** on the top frame rail when there is a current `track`:
  - Reuses the brass nameplate look via a `.artmode__music-plaque` variant, fixed at
    top-center (static — never moves, no scrolling). Distinct element from the
    artwork's bottom nameplate.
  - Two lines mirroring the artwork plaque: a title line (`.artmode__placard-title`,
    prefixed with a ♪) and an artist line (`.artmode__placard-artist`), each
    `smartQuotes`-formatted and using the shared `.artmode__placard-line` ellipsis
    rule.
  - Shown only in framed modes (the same `mode.frame` gate as the frame image and
    artwork placards); hidden in the bare modes (4-5) since it sits on the frame.
    Music keeps playing regardless of view mode.

## ArtMode CSS

Add `.artmode__music-plaque`: the brass plaque styling positioned at the top rail
(`top:` small %, `left: 50%`, `transform: translateX(-50%)`), z-index above the frame
(same band as the artwork plaque). Reuses the existing `.artmode__placard-title` /
`.artmode__placard-artist` / `.artmode__placard-line` rules for the text.

## Playback behavior (defaults)

- Autoplay on load; loop forever (wrap at end; reshuffle on wrap when `shuffle`).
- `volume` from config, default `0.25`, clamped `[0,1]`.
- No interactive controls. ArtMode's existing keys are unchanged: Up/Down brightness,
  ←/→ art shuffle, Tab view-mode, Enter/Space/Escape exit.

## Error handling

- Queue fetch fails or resolves empty → no audio, no plaque; logged.
- A track that fails to load (`error` event) → skip to the next track.
- Autoplay blocked → log + retry `play()` on the next keypress (no overlay).
- Unmount → pause, clear `src`, remove listeners.

## Testing

**Pure — `playlist.js`:** `toTracks` maps fields and drops items without `mediaUrl`;
`[]` for empty/missing; `artist` falls back to `grandparentTitle`. `advanceIndex`
wraps and returns `0` for `len 0`. `shuffleOrder` returns a permutation of
`[0..len-1]` and `[]` for `len <= 0`.

**Hook — `useBackgroundMusic`:** with a mocked `DaylightAPI` and a fake audio element
(an object with `play()` returning a resolved promise, `volume`, `src`, and
add/removeEventListener): builds the playlist and exposes the first track; sets
`volume`; advancing the fake element's `ended` listener moves to the next track and
wraps at the end; `track` is `null` on empty/failed queue; an `error` event skips
forward. (Run via the vitest command below.)

**Component — `ArtMode`:** renders `<audio data-testid="artmode-music">` only when the
`music` prop is present (absent otherwise); the music plaque renders the current
track's title + artist on the top rail; the plaque is hidden in bare modes (Tab to a
bare mode → gone) and when there is no track. Use a `measureText`-style seam if
needed; mock the hook's fetch via the existing `DaylightAPI` mock.

**Test command:**
```
./node_modules/.bin/vitest run --config vitest.config.mjs <file ...>
```

## Config

```yaml
screensaver:
  type: art
  props:
    music: { queue: ambient-piano, shuffle: true, volume: 0.25 }
```

Absent `music` → no audio, no plaque (fully backward compatible).

## Open items / future

- Reusable per-screen background-audio layer; interactive mute/skip; crossfade between
  tracks; reading the now-playing from the interactive player when one is active.
