# Plex hardware-acceleration validation — 2026-09-20

## Change applied

Plex preference `HardwareAcceleratedCodecs` was changed from `false` to `true`
through Plex's authenticated local preferences API, followed by a Plex container
restart. The restarted server answered the preferences API with
`hardwareAcceleration: true`.

The Plex container has `/dev/dri` mapped, and host VA-API reports:

- HEVC Main and HEVC Main 10 decode and encode support;
- VP9 Profile 0 and Profile 2 decode support;
- H.264 encode support.

## Real library controls

| Content | Source | Normal delivery observed | Conclusion |
|---|---|---|---|
| P90X3 — Total Synergistics (`plex:53361`) | 720p H.264 Main, AAC, MP4 | Plex decision: video **copy**, audio **copy** | No video re-encode. |
| The Super Mario Galaxy Movie (`plex:697377`) | 1080p HEVC Main 10, EAC3, MKV | VAAPI HEVC decode + `h264_vaapi` encode, capped at 7,469 kbps | The former CPU-heavy path is hardware accelerated. Final measured segments took 136–228 ms to produce about 1,001 ms of media: 4.4–7.4× realtime. |
| Game 6: The Movie (`plex:355765`) | 1080p VP9 Profile 2, AAC, MP4 | VAAPI VP9 decode + `h264_vaapi` encode | Existing VP9 gate selects browser-compatible H.264 and the GPU executes the fallback. |

## What is proven and what remains

The server setting is enabled, the GPU advertises the necessary HEVC Main 10
capabilities, and the server logs prove the complete VAAPI path for Mario and
VP9. Mario's measured segment production is comfortably above realtime while
P90X stays a zero-re-encode control.

Remaining operational check: play Mario normally on the target device long
enough to confirm it stays smooth. The server-side root cause is addressed; no
application gate change is warranted unless that client still exhibits a real
failure.
