# Piano Music Mode (Plexamp-style jukebox) — Design

> Approved design (2026-06-22). Adds a 5th Piano-kiosk mode.

## Goal

A "Music" tile in the Piano kiosk that browses albums + playlists and plays them
in a Plexamp-style jukebox: album art + progress as the hero, transport controls
that vanish on idle and return on touch. No piano keys, no staff.

- Albums: Plex collection `plex:359812` (10 classical albums).
- Playlists `plex:622894` + `plex:642120`, shown as album tiles ("treat playlists
  as albums").

## Navigation

`Grid → Album → Now-Playing` (mirrors the Videos mode drill-down):
1. **AlbumGrid** — poster grid of the collection's albums plus the configured
   playlists as tiles. Tap → album.
2. **AlbumDetail** — cover + "Play All" + numbered track list. Tap a track (or
   Play All) → now-playing, starting at that track.
3. **MusicPlayer** — full-screen now-playing.

## Data

- Albums: `GET api/v1/list/plex/359812` → `{ items:[{id,title,image,...}] }`.
- Playlist tile: `GET api/v1/list/plex/{playlistId}` → single container item
  (title/image) used as a tile.
- Tracks (album OR playlist): `GET api/v1/queue/plex:{id}` →
  `{ items:[{ contentId,title,grandparentTitle(artist),parentTitle(album),
  duration,mediaUrl,image,thumbnail }] }`. Filtered to items with `mediaUrl`.

No backend changes.

## Engine

Plain `<audio>` element owned by `MusicPlayer`, driven via the `lib/Player`
helpers (`playlist.js`, `mediaTransportAdapter.js`, `useMediaKeyboardHandler.js`),
modeled on `useBackgroundMusic.js`. Chosen over `modules/Player` so the jukebox
UI (album-art hero, vanishing controls) is fully custom, with no built-in
AudioPlayer chrome. The `<audio>` `ended` event advances the queue.

## Controls

play/pause, next/prev, seek (tap progress bar), **shuffle**, **repeat**
(repeat-album when it ends), **volume** (discrete tap buttons — no slider, per the
house touch rule), and a **queue drawer** (track list + jump-to-track + now-
playing marker). Controls + track title fade after ~3s idle while playing; any
tap reveals them. Album art + progress persist.

## Components (under `PianoKiosk/modes/Music/`)

| File | Responsibility |
|---|---|
| `Music.jsx` | Controller — 3 views (grid → album → player), reads `config.music`. |
| `AlbumGrid.jsx` | Collection albums + playlist tiles → poster grid. |
| `AlbumDetail.jsx` | Cover + Play All + track list for one album/playlist. |
| `MusicPlayer.jsx` | `<audio>` jukebox: art/progress hero, vanishing transport, queue drawer. |
| `musicTracks.js` | Pure: `toMusicTracks(queueResponse)` (map+filter), `formatTime(s)`. |
| `musicQueue.js` | Pure: `buildOrder(len, shuffle)`, `nextPos(order, pos, repeat)`, `prevPos(...)`. |
| `useVanishingControls.js` | Hook: visible state, reveal on activity, hide after idle while playing. |

Reuses `playlist.js` (`shuffleOrder`) and the poster grid styles from the Videos
mode.

## Config

`household/config/piano.yml` (the served config — see
[[reference_piano_config_two_files]]):
```yaml
music:
  collection: plex:359812
  playlists: [plex:622894, plex:642120]
```
`PianoConfig.resolvePianoConfig` adds `music: { collection, playlists }` (defaults
`{ collection: null, playlists: [] }`).

## Menu

`PIANO_MODES` += `{ id:'music', label:'Music', blurb:'Albums & playlists', icon:'🎵' }`;
`PianoApp` route `music` → `Music`.

## Testing

- `musicQueue.test.js` — shuffle/order, next/prev with repeat wrap + end-stop.
- `musicTracks.test.js` — mapping (artist=grandparentTitle, album=parentTitle),
  mediaUrl filter, `formatTime`.
- `Music.test.jsx` — grid lists albums+playlists; tap → track list; Play All /
  track tap transitions (no `<audio>` autoplay assertions in jsdom).

---

*Code at `frontend/src/modules/Piano/PianoKiosk/modes/Music/`; engine helpers at
`frontend/src/lib/Player/`.*
