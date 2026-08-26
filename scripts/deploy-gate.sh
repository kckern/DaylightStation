#!/bin/bash
# deploy-gate.sh — refuse to restart daylight-station while someone is using it.
#
# Redeploying restarts the container, and the app is unreachable for ~45s while
# it comes up. Whoever is mid-activity gets a 502 or a dead screen.
#
# On 2026-08-25 the garage half of this gate passed cleanly and a child at the
# school Portal entered a companion code 5.1 seconds after the container
# started. Nginx had no upstream yet, so `school.selfservice.act.failed`
# came back status 502 and the read-along never opened. The gate was watching
# the garage and nothing else — hence the Portal check below.
#
# Exit 0 = clear to deploy. Exit 1 = someone is using it; WAIT.
#
#   ./scripts/deploy-gate.sh && ./scripts/build-daylight.sh && sudo deploy-daylight
#
# Never chain the gate into the same command as the deploy in a way that lets
# the deploy run regardless — it must be able to HALT the sequence.
set -uo pipefail

CONTAINER="${DAYLIGHT_CONTAINER:-daylight-station}"
LOGS="${DAYLIGHT_LOGSTORE:-http://localhost:9428}"
GARAGE_WINDOW="${GARAGE_WINDOW:-75s}"
PORTAL_WINDOW="${PORTAL_WINDOW:-3m}"
blocked=0

recent_logs() { sudo docker logs --since "$GARAGE_WINDOW" "$CONTAINER" 2>&1; }

# ── 1. Garage: a live workout, or a video actually PLAYING ──────────────────
# A paused/idle tab is fine to deploy over (progress saves on unmount), and a
# stray sensor connecting without a session must not block — deviceCount alone
# is deliberately not consulted.
garage="$(recent_logs)"
fps="$(printf '%s' "$garage" | grep -cE '"event":"playback.render_fps"|dash.buffer-level')"
playing="$(printf '%s' "$garage" | grep -c '"videoState":"playing"')"
session="$(printf '%s' "$garage" | grep -c '"sessionActive":true')"
roster="$(printf '%s' "$garage" | grep -oE '"rosterSize":[1-9][0-9]*' | head -1)"

[ "$fps" -gt 0 ]     && { echo "BLOCKED: video rendering ($fps frame lines in $GARAGE_WINDOW)"; blocked=1; }
[ "$playing" -gt 0 ] && { echo "BLOCKED: videoState=playing"; blocked=1; }
[ "$session" -gt 0 ] && { echo "BLOCKED: a fitness session is active"; blocked=1; }
[ -n "$roster" ]     && { echo "BLOCKED: riders on the roster ($roster)"; blocked=1; }

# ── 2. Portal: a child part-way through a self-service flow ─────────────────
# Any selfservice traffic means someone is standing at the Portal right now:
# scanning a card, entering a code, or inside a companion. The window is
# deliberately wider than the garage's — entering a code takes longer than a
# frame, and the cost of waiting is far lower than the cost of a dead code.
portal="$(curl -s --max-time 5 "$LOGS/select/logsql/query" \
  -d "query=_time:$PORTAL_WINDOW AND school.selfservice" -d 'limit=1' 2>/dev/null | head -c 1 | wc -c)"
if [ "${portal:-0}" -gt 0 ]; then
  echo "BLOCKED: school Portal active in the last $PORTAL_WINDOW"
  blocked=1
elif ! curl -s --max-time 5 -o /dev/null "$LOGS/select/logsql/query" -d 'query=_time:1s' 2>/dev/null; then
  # Fail loud, not open: an unreachable log store means the Portal check did
  # not run, and "I could not tell" must never be reported as "nobody home".
  echo "BLOCKED: log store unreachable at $LOGS — cannot check the Portal"
  blocked=1
fi

if [ "$blocked" -ne 0 ]; then
  echo "GATE BLOCKED — do not deploy. Wait and re-run."
  exit 1
fi
echo "GATE CLEAR (garage idle; no Portal activity in $PORTAL_WINDOW)"
exit 0
