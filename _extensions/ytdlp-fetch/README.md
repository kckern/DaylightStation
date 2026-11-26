# ytdlp-fetch

The yt-dlp fetch service for the share router (`__docs/reference/core/share.md`).
`server.mjs` runs in the `ytdlp` sidecar, which shares the `vpn` container's network
namespace, so every fetch leaves through the VPN with PO tokens from `ytdlp-pot`.

- Install: copy `Dockerfile`, `server.mjs` and `docker-compose.yml` to the sidecar's
  compose folder, then `docker compose up -d --build` there. Gluetun must list the
  port (8790) in `FIREWALL_INPUT_PORTS` for the app to reach `http://vpn:8790`.
- App config: `services.ytdlp_fetch` in the system services map, or the
  `YTDLP_FETCH_URL` environment variable. With neither, the app fetches with its own
  yt-dlp into container-local temp storage.
- Files: `/fetch/<name>.mp4` (+ `<name>.json`), swept after `MAX_AGE_HOURS`. Never
  inside a synced folder.

API: see the header of `server.mjs`.
