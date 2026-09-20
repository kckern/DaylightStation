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
# On 2026-09-11 it happened again, in the third place nobody was watching. The
# gate reported CLEAR and the deploy went out 42 seconds after
# `game.mount {"game":"checkers","learnerId":...}` — a child was mid-game on the
# piano tablet. The container went down, his WebSocket dropped 1006, the kiosk
# reloaded under him, and from his side the game restarted for no reason. The
# garage was idle and the Portal was quiet and both halves passed honestly; the
# gate simply had no idea the piano kiosk existed. Hence section 3.
#
# On 2026-09-12 it was the fourth place. The gate reported CLEAR while someone
# stood at the garage display pressing their finger to the reader over and over,
# trying to release an emergency lockdown that `elizabeth` had committed four
# minutes earlier. Every existing check passed honestly: there was no workout,
# no roster and no video — because a person locked out of the app cannot start
# one. "No session" had been standing in for "nobody there", and a lockdown is
# exactly the state where those two come apart. Hence section 4.
#
# On 2026-09-18 it was the fifth place, and the quietest. A child tapped his
# card in the living room at 11:04:32; the reading session opened and the TV
# acknowledged the launch card. The container restarted at 11:05:01. He tapped
# his book at 11:06:01 and the broadcast hit `bus.topic.unknown:
# reading:livingroom` — the TV's socket had died with the restart and its
# replacement subscribed 0.79 s too late. Nothing played, his session idled out,
# and story time went uncredited. All four sections above passed honestly: a
# living-room reading session touches neither the garage, the Portal, nor the
# piano. Hence section 5.
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
# Shared with any future portal-reload script, and — the reason it moved out of
# here — an ALLOWLIST of events that mean a person is present. It used to match
# any `school.selfservice` line, including the panel putting itself to sleep,
# and blocked a deploy on an empty room. See that script for what counts.
if ! "$(dirname "$0")/school-portal-idle.sh"; then
  echo "BLOCKED: the school Portal is in use"
  blocked=1
fi

# ── 3. Piano kiosk: a child mid-game, or mid-anything ───────────────────────
# Shared with `reload-piano-kiosk.sh`, because a redeploy and a forced reload
# are the same interruption from the child's side and must answer to the same
# question. See that script for what counts and what deliberately does not.
if ! "$(dirname "$0")/piano-kiosk-idle.sh"; then
  echo "BLOCKED: the piano kiosk is in use"
  blocked=1
fi

# ── 4. Garage emergency lockdown ───────────────────────────────────────────
# An emergency lockdown means a person is at the garage display and CANNOT use
# it — so sections 1-3 are all quiet for the one reason that should block
# hardest. Restarting mid-ceremony drops the release scan they are part-way
# through and hands them a dead screen on top of a locked one.
#
# This does not leave the gate permanently red: a lock carries its own
# `lockedUntil` and expires on its own, so the block lifts without anyone
# doing anything.
EMERGENCY_URL="${DAYLIGHT_EMERGENCY_URL:-http://localhost:3111/api/v1/fitness/emergency}"
emergency="$(curl -s --max-time 5 "$EMERGENCY_URL" 2>/dev/null)"

if [ -z "$emergency" ]; then
  # Fail closed, as everywhere else here: "I could not ask" is not "nobody is
  # there". If the app is down this is moot anyway — there is nothing running
  # to interrupt, and the owner override exists for that case.
  echo "BLOCKED: cannot read the emergency lock state ($EMERGENCY_URL unreachable)"
  blocked=1
elif printf '%s' "$emergency" | grep -q '"locked":[[:space:]]*true'; then
  until_ts="$(printf '%s' "$emergency" | grep -oE '"lockedUntil":[0-9]+' | grep -oE '[0-9]+')"
  by="$(printf '%s' "$emergency" | grep -oE '"lockedBy":"[^"]*"' | cut -d'"' -f4)"
  when=""
  [ -n "${until_ts:-}" ] && when=" until $(date -d "@$until_ts" '+%H:%M:%S' 2>/dev/null || echo "$until_ts")"
  echo "BLOCKED: the garage is under an emergency lockdown (by ${by:-unknown}${when})"
  blocked=1
fi

# Release attempts are human-driven by definition, so a recent one means someone
# is standing at the reader right now even if the lock has since cleared.
release="$(printf '%s' "$garage" | grep -cE 'emergency\.release_(requested|hold|scan_start|denied)')"
[ "$release" -gt 0 ] && { echo "BLOCKED: someone is working the emergency release ($release events in $GARAGE_WINDOW)"; blocked=1; }

# ── 5. Living room: a child mid-story ──────────────────────────────────────
# Shared with any future living-room reload, and asked of the SERVER rather
# than the log alone: a story that is playing is silent for minutes at a time,
# so "no recent events" is not "no child". See that script for what counts.
if ! "$(dirname "$0")/livingroom-reading-idle.sh"; then
  echo "BLOCKED: a living-room reading session is in progress"
  blocked=1
fi

if [ "$blocked" -ne 0 ]; then
  echo "GATE BLOCKED — do not deploy. Wait and re-run."
  exit 1
fi
echo "GATE CLEAR (garage idle; Portal idle; piano kiosk idle; no emergency lock; living room idle)"
exit 0
