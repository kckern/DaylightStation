#!/bin/bash
# media-source-heal.sh — the ONE command the app's media-heal SSH key may run.
#
# Installed on the prod host as the forced command of a restricted key in the
# host user's authorized_keys:
#
#   restrict,from="172.16.0.0/12",command="$HOME/bin/media-source-heal.sh" ssh-ed25519 AAAA... daylight-media-heal
#
# The backend's MediaSourceHealer calls it when Plex refuses to open a media
# file ("Permission denied (13)" -> 404 on /library/parts/...). It takes one
# argument, a HOST path under the NAS media mount, and reports what the host
# sees. When the file's mode has been zeroed (the 2026-09-25 incident: 1,320
# files set to 0000 on the NAS) it restores 0777, which the NAS accepts from
# this user because it squashes users. It cannot remount — that needs root and
# stays with nfs-watchdog.sh.
#
# Output: one JSON object on stdout. Exit 0 whenever a report was produced.
# See docs/reference/player/media-source-healing.md.

set -u

ROOT="${MEDIA_HEAL_ROOT:-/media/kckern/Media}"
IO_TIMEOUT=10

# Forced command: the requested path arrives in SSH_ORIGINAL_COMMAND. A direct
# invocation (testing) passes it as $1.
REQ="${SSH_ORIGINAL_COMMAND:-${1:-}}"

json_err() {
  printf '{"ok":false,"error":"%s"}\n' "$1"
  exit 0
}

[ -n "$REQ" ] || json_err "no-path"
# Paths are passed base64-encoded so spaces, quotes and '&' in media titles
# survive the SSH command line without any shell quoting.
P=$(printf '%s' "$REQ" | base64 -d 2>/dev/null) || json_err "bad-encoding"
[ -n "$P" ] || json_err "bad-encoding"

case "$P" in
  *'/../'*|*'/..'|'../'*) json_err "path-traversal" ;;
esac
case "$P" in
  "$ROOT"/*) ;;
  *) json_err "outside-root" ;;
esac

if ! timeout "$IO_TIMEOUT" test -e "$P"; then
  rc=$?
  [ "$rc" -eq 124 ] && json_err "stat-timeout"
  printf '{"ok":true,"exists":false}\n'
  exit 0
fi

MODE=$(timeout "$IO_TIMEOUT" stat -c '%a' "$P" 2>/dev/null) || json_err "stat-timeout"
[ -f "$P" ] || json_err "not-a-file"

CHMOD=false
SIBLINGS=0
if [ "$MODE" = "0" ] || [ "$MODE" = "000" ]; then
  if timeout "$IO_TIMEOUT" chmod 0777 "$P" 2>/dev/null; then
    CHMOD=true
  fi
  # A burst zeroes whole folders (all 58 Max Built episodes on 2026-09-28), so
  # the next episode would fail the same way. Restore zeroed siblings in the
  # same folder only — never recursive, never outside ROOT.
  SIBLINGS=$(timeout 30 find "$(dirname "$P")" -maxdepth 1 -type f -perm 0000 -print0 2>/dev/null \
    | xargs -0 -r chmod 0777 -v 2>/dev/null | grep -c . || true)
fi
MODE_AFTER=$(timeout "$IO_TIMEOUT" stat -c '%a' "$P" 2>/dev/null || echo "")

START=$(date +%s%3N)
if timeout "$IO_TIMEOUT" head -c 65536 "$P" >/dev/null 2>&1; then
  READABLE=true
else
  READABLE=false
fi
READ_MS=$(( $(date +%s%3N) - START ))

printf '{"ok":true,"exists":true,"mode":"%s","chmodApplied":%s,"siblingsFixed":%s,"modeAfter":"%s","readable":%s,"readMs":%s}\n' \
  "$MODE" "$CHMOD" "${SIBLINGS:-0}" "$MODE_AFTER" "$READABLE" "$READ_MS"
