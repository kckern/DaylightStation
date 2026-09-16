#!/usr/bin/env bash
# Prune the throwaway `api-*` device rows from Plex's library database.
#
# WHY
#   Plex records one `devices` row per distinct X-Plex-Client-Identifier and
#   never prunes them. Until the fix in PlexAdapter._generateSessionIds, every
#   backend-initiated stream minted `api-${random}`, so the table grew without
#   bound: 81,001 rows on 2026-09-16, 73,994 of them `api-*`.
#
#   Plex's periodic per-device statistics pass (Statistics/Device.cpp) holds a
#   write transaction while it grinds that table — measured at ~25s held out of
#   every ~55s, CPU-bound, with zero active streams. Every request that opens a
#   streaming session blocks behind it: a child's book took 24.7s to start, a
#   piano lesson 14.7s.
#
# SAFETY
#   Verified on 2026-09-16 against the live DB (read-only):
#     metadata_item_views on api-* devices  = 0   <- no watch history touched
#     statistics_media    on api-* devices  = 0
#     statistics_bandwidth on api-* devices = 319,554  (bandwidth graphs only)
#   Projected after: devices 81,001 -> 7,007; bandwidth 368,940 -> 49,386.
#
#   PLEX MUST BE STOPPED. Writing to a live Plex SQLite database risks
#   corruption. This script refuses to run while the container is up.
#
# USAGE
#   sudo docker stop plex
#   ./scripts/plex-prune-api-devices.sh
#   sudo docker start plex
#
set -euo pipefail

DB="${PLEX_DB:-/opt/plex-db/Databases/com.plexapp.plugins.library.db}"
BACKUP_DIR="${PLEX_DB_BACKUP_DIR:-/opt/plex-db/Databases}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${BACKUP_DIR}/com.plexapp.plugins.library.db.pre-prune-${STAMP}"

die() { echo "ERROR: $*" >&2; exit 1; }

command -v sqlite3 >/dev/null || die "sqlite3 not installed"
[ -f "$DB" ] || die "database not found: $DB"

# Refuse to touch a live database.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx plex \
   || sudo docker ps --format '{{.Names}}' 2>/dev/null | grep -qx plex; then
  die "the plex container is RUNNING. Stop it first:  sudo docker stop plex"
fi

echo "== before =="
sqlite3 "$DB" "
  select 'devices              ', count(*) from devices
  union all select 'devices api-*        ', count(*) from devices where identifier like 'api-%'
  union all select 'statistics_bandwidth ', count(*) from statistics_bandwidth;"

echo
echo "== safety check: watch history on api-* devices (must be 0) =="
VIEWS=$(sqlite3 "$DB" "select count(*) from metadata_item_views v join devices d on d.id=v.device_id where d.identifier like 'api-%';")
MEDIA=$(sqlite3 "$DB" "select count(*) from statistics_media m join devices d on d.id=m.device_id where d.identifier like 'api-%';")
echo "  metadata_item_views: $VIEWS"
echo "  statistics_media:    $MEDIA"
[ "$VIEWS" = "0" ] || die "api-* devices carry $VIEWS watch-history rows; refusing to prune"
[ "$MEDIA" = "0" ] || die "api-* devices carry $MEDIA statistics_media rows; refusing to prune"

echo
echo "== backing up to $BACKUP =="
cp -- "$DB" "$BACKUP"
echo "  $(stat -c '%s bytes' "$BACKUP")"

echo
echo "== pruning =="
sqlite3 "$DB" <<'SQL'
PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
DELETE FROM statistics_bandwidth
 WHERE device_id IN (SELECT id FROM devices WHERE identifier LIKE 'api-%');
DELETE FROM devices WHERE identifier LIKE 'api-%';
COMMIT;
SQL

echo "== vacuum (reclaims pages; takes a minute on a 1.7GB db) =="
sqlite3 "$DB" "VACUUM;"

echo
echo "== after =="
sqlite3 "$DB" "
  select 'devices              ', count(*) from devices
  union all select 'devices api-*        ', count(*) from devices where identifier like 'api-%'
  union all select 'statistics_bandwidth ', count(*) from statistics_bandwidth;"

echo
echo "integrity: $(sqlite3 "$DB" 'PRAGMA integrity_check;' | head -1)"
echo
echo "Done. Start Plex again:  sudo docker start plex"
echo "Backup kept at: $BACKUP"
echo "Then confirm the lock is gone — this should print nothing new after a few minutes:"
echo "  grep 'Held transaction for too long' '/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log' | tail -3"
