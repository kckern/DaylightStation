# Plex media accessibility safeguards

## What failed
- Transcode for `670148` failed because the source file had mode `000` (no read bits), so Plex terminated the session.
- Fixing the permissions to `644` resolved playback immediately.

## Safeguard plan
1) **Automated audit + repair**
- Script: `scripts/plex-perms-audit.sh` (inside the `plex` container; defaults: files `0644`, dirs `0755`).
- Scope control: set `MEDIA_ROOTS` to specific library roots; for large libraries use `MTIME_HOURS=4` (or similar) to scan only recently touched files instead of the full 30TB.
- Usage: `./scripts/plex-perms-audit.sh` (fix) or `DRY_RUN=1 ./scripts/plex-perms-audit.sh` (report only).
- Schedule: run via cron/systemd on the host (e.g., every 30–60 minutes) with explicit `MEDIA_ROOTS` and `PLEX_CONTAINER=plex`; run a broader scan less frequently (e.g., nightly) if desired.

2) **Log-driven remediation**
- Monitor Plex logs (or reverse-proxy logs) for denial patterns: `"Denying access to transcode"`, `"terminated session"`, `403/404` on media parts.
- On detection, trigger `scripts/plex-perms-audit.sh` (DRY_RUN first, then fix if issues found).
- If errors persist after a fix run, mark the container unhealthy (see health check below) so orchestrator can restart/alert.

3) **Health check for accessibility**
- Add a lightweight health check that fails if any unreadable media exists:
  - Example command (concept): `find /data/media -type f ! -perm -0444 | head -1` — exit 1 if a result exists.
  - Wire into container `HEALTHCHECK` or an external watcher; failing health should alert and optionally restart Plex.

4) **Ingest-time guardrail**
- After new media is added (download/import), run the audit script on the affected path to normalize permissions before Plex scans.
- Optionally enforce a sane umask (e.g., 0022) wherever files are created to avoid zeroed permissions.

## Recommendation summary
- Put `scripts/plex-perms-audit.sh` on a frequent schedule (cron/systemd timer).
- Add log-based hooks so a permission-related error auto-runs the audit and can flag the Plex container as unhealthy if issues remain.
- Add or tighten an accessibility health check so inaccessible media cannot go unnoticed.
