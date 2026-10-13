# Plex Playback Failure Triage (Loggly → Server Logs)

A short runbook to chase a playback failure reported in Loggly down to the Plex logs on the server.

## 1) Gather the failing request in Loggly
- Narrow to the time window of the report (user complaint or alert). Use exact timestamps when possible.
- Filter by Plex app host/IP or message terms like `start.mpd`, `transcode`, `terminated session`, `decoder-stall`.
- Capture: exact timestamp (UTC and local), client IP, session/connection IDs, media key (e.g., `/library/metadata/670148`).

## 2) Map the Loggly event to session identifiers
- Note `X-Plex-Session-Identifier` (short token) and any long `sessionId`/`machineIdentifier` if present.
- Save the media metadata key and client IP; they help match in Plex logs even if session IDs rotate.

## 3) Check Plex server logs on the host
Logs live at `/media/{username}/DockerDrive/Docker/Media/plex/Logs/`.

Primary files:
- `Plex Media Server.log` (rotated: `.1.log`, `.2.log`, ...)
- `Plex Transcoder Statistics*.log` (per-transcode XML summaries)
- `Plex Media Scanner*.log` (usually not needed for playback issues)

Common grep patterns (adjust time window):
```bash
ssh server "grep -E 'Dec 09, 2025 12:35:0[0-9]|Dec 09, 2025 12:35:1[0-9]' '/media/{username}/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log'"
```
Add filters to focus:
```bash
# Session IDs / metadata key
grep -E '0mm4uvgb6qq6s5tbpvxxc|/library/metadata/670148'

# Termination/cleanup markers
grep -E 'terminated session|Conversion failed|Transcoder exited|Cleaning directory'

# Hardware failures (VAAPI/NVENC/QuickSync)
grep -Ei 'vaapi|nvenc|qsv|hwaccel|hardware transcod'
```

## 4) Inspect the transcode session report
If a session is present in `Plex Transcoder Statistics*.log`, cat the matching file:
```bash
ssh server "grep -n 'Dec 09, 2025 12:35' /media/{username}/DockerDrive/Docker/Media/plex/Logs/Plex\ Transcoder\ Statistics*.log"
ssh server "cat /media/{username}/DockerDrive/Docker/Media/plex/Logs/Plex\ Transcoder\ Statistics.2.log"
```
Look for:
- `transcode="<id>"` and `session="<id>"`
- Decisions: `videoDecision="transcode"`, `audioDecision="copy"`, `subtitleDecision="burn/transcode"`
- Hardware flags: `transcodeHwDecoding="vaapi"`, `transcodeHwEncoding="vaapi"`

## 5) Identify the failure cause
In `Plex Media Server.log`, failures often show as:
- `Streaming Resource: Terminated session ... reason Conversion failed. The transcoder exited due to an error.`
- Hardware path errors: `Direct mapping disabled: deriving image does not work: 1 (operation failed)` (VAAPI), or NVENC/QSV errors.
- Disk/temp issues: errors writing to `/transcode`.
- Auth/session: `Denying access ... due to terminated session` after a failure.

## 6) Remediation playbook (fastest first)
- Retry with hardware-accelerated *encoding* off (keep decode on if available).
- If still failing, disable all hardware acceleration and retry.
- Retry without burning subtitles (set subs off or external) to bypass subtitle burn pipeline.
- Verify `/transcode` has space and is local/fast.
- Refresh Plex codecs cache (delete `Codecs` dir; Plex redownloads).
- Check GPU/VAAPI health on host: `vainfo`, driver updates, `/dev/dri/renderD128` perms.
- If reproducible, enable more verbose transcode logging and capture the exact ffmpeg error.

## 7) Confirm fix
- Re-run the same title with the same subtitle settings.
- Ensure `Plex Media Server.log` shows no new `Conversion failed` lines and that `start.mpd` (DASH) is served without `terminated session` warnings.

## Quick reference commands
```bash
# Core search in the main log for a window and key
ssh server "grep -E 'Dec 09, 2025 12:35' '/media/{username}/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log' | grep -E '/library/metadata/670148|terminated session'"

# List logs
ssh server "ls -lh /media/{username}/DockerDrive/Docker/Media/plex/Logs"

# Restart Plex container
ssh server "docker restart plex"
```