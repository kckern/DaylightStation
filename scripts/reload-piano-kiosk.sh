#!/bin/bash
# reload-piano-kiosk.sh — refresh the piano tablet's browser, safely.
#
#   ./scripts/reload-piano-kiosk.sh            # refuses if anyone is playing
#   ./scripts/reload-piano-kiosk.sh --force    # only with a person's say-so
#
# WHY THIS EXISTS. On 2026-09-11, thirty seconds after a redeploy had already
# reloaded the tablet under a child mid-checkers, this was done by hand:
#
#     clearCache  →  clearWebstorage  →  loadStartUrl
#
# `loadStartUrl` navigates to the START URL, not to wherever the kiosk is — so
# it took him off the board and back to the home screen — and `clearWebstorage`
# wiped localStorage, which on this kiosk holds the match-gate ladder position
# and the tablet's own captured device identity. From his side the game
# restarted for no reason and his progress was gone. Nothing about it was
# necessary; the reload was for MY convenience, verifying a deploy.
#
# So: two rules, both enforced below rather than remembered.
#
#   1. NEVER while someone is using it. `piano-kiosk-idle.sh` is the same
#      question `deploy-gate.sh` asks, and it fails closed.
#   2. NEVER `clearWebstorage`. It is not a cache; it is the child's state. A
#      stale BUNDLE is what `clearCache` is for, and since the chunk-reload
#      guard became a cooldown (lib/chunkReload.js) a stale tablet heals itself
#      on the next failed import anyway — the gate now also preflights the
#      game's chunk while the child is still playing for it, so a dead chunk is
#      found and repaired before anything is at stake. A manual reload should be
#      rare. If you find yourself reaching for one routinely, that is the bug.
set -uo pipefail

HERE="$(dirname "$0")"
FKB_HOST="${FKB_HOST:-10.0.0.245:2323}"
CONTAINER="${DAYLIGHT_CONTAINER:-daylight-station}"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

if [ "$FORCE" -ne 1 ]; then
  if ! "$HERE/piano-kiosk-idle.sh"; then
    echo "REFUSING: the piano kiosk is in use. Wait, or pass --force if a person told you to."
    exit 1
  fi
else
  echo "--force: reloading regardless. Reporting what is being interrupted:"
  "$HERE/piano-kiosk-idle.sh" || true
fi

FKB_PW="${FKB_PW:-$(sudo docker exec "$CONTAINER" sh -c \
  "node -e \"const y=require('js-yaml');console.log(y.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8')).password)\"")}"

FKB_HOST="$FKB_HOST" FKB_PW="$FKB_PW" node -e '
const host = process.env.FKB_HOST, pw = process.env.FKB_PW;
// URLSearchParams, never shell interpolation: the password carries characters
// that a shell-built URL mangles into a silent auth failure. `type=json` is
// required or FKB returns its HTML dashboard, which looks like an auth failure
// and is not.
const url = (cmd) => `http://${host}/?` + new URLSearchParams({ cmd, password: pw, type: "json" });
const call = async (cmd) => {
  const body = await fetch(url(cmd)).then((r) => r.text());
  // FKB answers errors with HTTP 200 and {"status":"Error"} — check the
  // envelope, not the status code.
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* HTML dashboard */ }
  const ok = parsed?.status === "OK";
  console.log(`  ${ok ? "✓" : "✗"} ${cmd}: ${parsed?.statustext ?? body.slice(0, 80)}`);
  return ok;
};
(async () => {
  // clearCache only. NOT clearWebstorage — see the header.
  await call("clearCache");
  await call("loadStartUrl");
})();
'
echo "Reloaded. Confirm with: curl -s \"$DAYLIGHT_LOGSTORE/select/logsql/query\" -d 'query=_msg:frontend-start AND _time:2m'"
