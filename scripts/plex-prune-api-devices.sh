#!/usr/bin/env bash
# Prune Plex's throwaway `api-*` device rows. Run as root: ./plex-prune-api-devices.sh
#
# Does everything: preflight, stop Plex, back up, prune, vacuum, verify integrity,
# auto-restore on failure, restart Plex, and confirm the lock is actually gone.
#
# WHY
#   Plex records one `devices` row per distinct X-Plex-Client-Identifier and never
#   prunes them. Until the fix in PlexAdapter._generateSessionIds (commit 819a7247),
#   every backend-initiated stream minted `api-${random}`, so the table grew without
#   bound: 81,009 rows on 2026-09-16, 73,994 of them `api-*`.
#
#   Plex's periodic per-device statistics pass (Statistics/Device.cpp) holds a write
#   transaction while it grinds that table — measured at ~26s held out of every ~56s,
#   CPU-bound, with zero active streams. Every request that opens a streaming session
#   blocks behind it: a child's book took 24.7s to start where the same book three
#   minutes earlier took 0.8s; a piano lesson took 14.7s.
#
# WHY A THROWAWAY CONTAINER
#   The schema uses a custom collation (`index_title_sort_naturalsort`). The host's
#   sqlite3 does not know it, and VACUUM rewrites every index — so a host-sqlite3
#   VACUUM aborts partway through rewriting the database. Plex ships its own SQLite
#   at /usr/lib/plexmediaserver/Plex SQLite, but it is an ELF needing the image's
#   libraries, and `docker exec` dies with the stopped container. A throwaway
#   container from the same image is the only way to reach it while Plex is down.
#   `--entrypoint sh` is required: the image entrypoint is [/init] (s6-overlay).
#
# MEASURED (rehearsed on a copy of the live DB, 2026-09-16)
#   delete 3s, vacuum 36s, integrity ok
#   devices 81,001 -> 7,007 ; statistics_bandwidth 368,940 -> 49,386
#   Watch history is untouched: metadata_item_views on api-* devices = 0.
set -uo pipefail

DB_DIR="${PLEX_DB_DIR:-/opt/plex-db/Databases}"
DB_NAME="com.plexapp.plugins.library.db"
DB="$DB_DIR/$DB_NAME"
BACKUP_DIR="${PLEX_BACKUP_DIR:-/opt/plex-db}"
IMAGE="${PLEX_IMAGE:-lscr.io/linuxserver/plex:latest}"
PLEX_SQLITE="/usr/lib/plexmediaserver/Plex SQLite"
PLEX_LOG="${PLEX_LOG:-/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUP_DIR/pre-prune-$STAMP.db"
SQL_FILE="$(mktemp /tmp/plex-prune.XXXXXX.sql)"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

cleanup() { rm -f "$SQL_FILE"; }
trap cleanup EXIT

# ── Preflight ──────────────────────────────────────────────────────────────
say "Preflight"
[ "$(id -u)" -eq 0 ] || die "must run as root (it stops and starts the plex container)"
command -v docker >/dev/null || die "docker not found"
[ -f "$DB" ] || die "database not found: $DB"
docker image inspect "$IMAGE" >/dev/null 2>&1 || die "image not present locally: $IMAGE"
docker inspect plex >/dev/null 2>&1 || die "no container named 'plex'"
# Plex must be RUNNING when this starts: the safety check below reads the live
# database through `docker exec`, which dies with a stopped container. The script
# stops Plex itself once the readings are taken — do not stop it beforehand.
[ "$(docker inspect -f '{{.State.Running}}' plex 2>/dev/null)" = "true" ] \
  || die "the plex container is stopped. Start it first (docker start plex) — this script stops it itself once it has read the safety counts."

AVAIL_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2{print $4}')
DB_KB=$(( $(stat -c%s "$DB") / 1024 ))
[ "$AVAIL_KB" -gt "$((DB_KB + 1048576))" ] || die "not enough free space for a backup in $BACKUP_DIR"
info "database:  $DB ($(( DB_KB / 1024 )) MB)"
info "backup to: $BACKUP"
info "image:     $IMAGE"

# Counts up front, while Plex is still serving (read-only, via the live container).
BEFORE=$(docker exec plex sh -c "'$PLEX_SQLITE' '/config/Library/Application Support/Plex Media Server/Plug-in Support/Databases/$DB_NAME' \
  \"SELECT (SELECT count(*) FROM devices)||' devices, '||(SELECT count(*) FROM devices WHERE identifier LIKE 'api-%')||' api-*, '||(SELECT count(*) FROM statistics_bandwidth)||' bandwidth';\"" 2>/dev/null)
info "current:   ${BEFORE:-unknown}"

# Refuse to delete rows that carry real watch history.
VIEWS=$(docker exec plex sh -c "'$PLEX_SQLITE' '/config/Library/Application Support/Plex Media Server/Plug-in Support/Databases/$DB_NAME' \
  \"SELECT count(*) FROM metadata_item_views v JOIN devices d ON d.id=v.device_id WHERE d.identifier LIKE 'api-%';\"" 2>/dev/null)
[ "${VIEWS:-x}" = "0" ] || die "api-* devices carry ${VIEWS:-unknown} watch-history rows; refusing to prune"
info "safety:    0 watch-history rows attached to api-* devices"

cat > "$SQL_FILE" <<'SQL'
PRAGMA busy_timeout=60000;
BEGIN IMMEDIATE;
CREATE TEMP TABLE doomed AS SELECT id FROM devices
  WHERE identifier LIKE 'api-%' OR identifier LIKE 'probe%' OR identifier LIKE 'lockprobe%';
DELETE FROM statistics_bandwidth WHERE device_id IN (SELECT id FROM doomed);
DELETE FROM devices WHERE id IN (SELECT id FROM doomed);
COMMIT;
VACUUM;
SELECT 'after: '||(SELECT count(*) FROM devices)||' devices, '||(SELECT count(*) FROM statistics_bandwidth)||' bandwidth';
PRAGMA integrity_check;
SQL

# ── Stop ───────────────────────────────────────────────────────────────────
say "Stopping Plex"
docker stop plex >/dev/null || die "could not stop plex"
info "stopped"

restore_and_start() {
  printf '\n\033[1;31m!! restoring from backup\033[0m\n'
  cp -a "$BACKUP" "$DB"
  for s in -wal -shm; do
    [ -f "$BACKUP$s" ] && cp -a "$BACKUP$s" "$DB$s"
    [ -f "$BACKUP$s" ] || rm -f "$DB$s"
  done
  docker start plex >/dev/null
  die "restored the pre-prune database and restarted Plex. Nothing was lost."
}

# ── Backup ─────────────────────────────────────────────────────────────────
say "Backing up"
cp -a "$DB" "$BACKUP" || die "backup failed (Plex is stopped; start it with: docker start plex)"
for s in -wal -shm; do [ -f "$DB$s" ] && cp -a "$DB$s" "$BACKUP$s"; done
info "$(ls -la "$BACKUP" | awk '{print $5" bytes  "$NF}')"

# ── Prune ──────────────────────────────────────────────────────────────────
say "Pruning (delete ~3s, vacuum ~36s)"
OUT=$(docker run --rm --entrypoint sh \
  -v "$DB_DIR":/db \
  -v "$SQL_FILE":/sql/prune.sql:ro \
  "$IMAGE" -c "'$PLEX_SQLITE' /db/$DB_NAME < /sql/prune.sql" 2>&1)
RC=$?
printf '%s\n' "$OUT" | sed 's/^/   /'
[ $RC -eq 0 ] || { printf '   prune exited %s\n' "$RC"; restore_and_start; }
printf '%s' "$OUT" | grep -qx 'ok' || restore_and_start

# ── Restart ────────────────────────────────────────────────────────────────
say "Starting Plex"
docker start plex >/dev/null || die "prune succeeded but plex would not start; try: docker start plex"
for i in $(seq 1 60); do
  curl -sf --max-time 2 "http://localhost:32400/identity" >/dev/null 2>&1 && break
  sleep 2
done
curl -sf --max-time 3 "http://localhost:32400/identity" >/dev/null 2>&1 \
  && info "Plex is answering on :32400" \
  || info "Plex started but is not answering yet — give it a moment"

# ── Did it work? ───────────────────────────────────────────────────────────
say "Watching for the statistics lock (3 minutes)"
info "before the prune this logged a 'Held transaction' line every ~56s"
BASE=$(grep -c "Held transaction for too long" "$PLEX_LOG" 2>/dev/null || echo 0)
sleep 180
NOW=$(grep -c "Held transaction for too long" "$PLEX_LOG" 2>/dev/null || echo 0)
NEW=$(( NOW - BASE ))
say "Result"
info "was:  $BEFORE"
grep -E '^after: ' <<<"$OUT" | sed 's/^/   now:  /'
info "held-transaction warnings in the last 3 minutes: $NEW (expected ~3 before, 0 after)"
if [ "$NEW" -eq 0 ]; then
  printf '\n\033[1;32mThe lock is gone. Books should start immediately.\033[0m\n'
else
  printf '\n\033[1;33mThe lock is still cycling (%s warnings).\033[0m\n' "$NEW"
  info "Then device count was not the driver — next suspect is the Plex 1.43.4 build."
  info "Recent holds:"
  grep "Held transaction for too long" "$PLEX_LOG" | tail -3 | sed 's/^/     /'
fi
info "backup kept at: $BACKUP"
