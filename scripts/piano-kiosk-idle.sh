#!/bin/bash
# piano-kiosk-idle.sh — is anyone using the piano kiosk right now?
#
# Exit 0 = idle, nobody there. Exit 1 = someone is using it; LEAVE IT ALONE.
#
# Extracted so the two things that can interrupt a child share one answer:
# `deploy-gate.sh` (a redeploy takes the backend away under them) and
# `reload-piano-kiosk.sh` (a forced reload takes the SCREEN away under them).
# Both did exactly that on 2026-09-11, inside two minutes of each other, to a
# child who was mid-game of checkers — first the container stopped 42s after
# `game.mount`, then a `loadStartUrl` threw him from the board back to the home
# screen. From his side the game restarted twice for no reason.
#
# TWO CONDITIONS, because they catch different people.
#
#   (a) A GAME IS ON SCREEN. `game.mount` with no `game.unmount` after it. It
#       does not depend on the child touching anything — someone staring at a
#       chessboard thinking is still playing, and taking it away is still taking
#       it away. This is the exact shape of the miss.
#
#   (b) SOMEONE IS AT THE PIANO. Any human-driven kiosk event in the window: a
#       move, a note, a match-gate attempt, an exercise observation. Catches the
#       child between games — at the gate, in an exercise, or just playing.
#
# WHAT IS DELIBERATELY NOT A SIGNAL. `perf.diagnostics` and `websocket.*` fire
# on a timer at an empty room, and `context.app:piano-bridge` heartbeats forever
# whether or not anyone is home. A check that counts those is never clear, and a
# gate that is never clear gets bypassed, which is worse than no gate.
#
# FAILS CLOSED. An unreachable log store blocks: "I could not tell whether a
# child was there" is not "no child was there".
set -uo pipefail

LOGS="${DAYLIGHT_LOGSTORE:-http://localhost:9428}"
PIANO_WINDOW="${PIANO_WINDOW:-5m}"
# How long a mounted game with nothing happening still counts as being played.
# `game.unmount` is the only thing that clears a mount, so a tab abandoned on a
# chessboard would otherwise hold the door shut forever. Two hours is longer
# than any real sitting and short enough that yesterday's tab is not still
# blocking today.
PIANO_GAME_MAX_AGE="${PIANO_GAME_MAX_AGE:-2h}"

HUMAN_EVENTS='"chess.move" OR "chess.rejected" OR "pickup" OR "move-played" OR "checkers.hint" OR "checkers.move" OR "piano.history.flush" OR "chord.identify" OR "piano.exercise-observation" OR "gate.presented" OR "gate.attempt" OR "game.mount"'

# The most recent time an event was logged, or empty if none in the window.
last_seen() {
  curl -s --max-time 5 "$LOGS/select/logsql/query" \
    -d "query=_time:$PIANO_GAME_MAX_AGE AND context.app:piano-kiosk AND \"$1\" | sort by (_time desc) | limit 1" \
    2>/dev/null | sed -n 's/.*"_time":"\([^"]*\)".*/\1/p' | head -1
}

if ! curl -s --max-time 5 -o /dev/null "$LOGS/select/logsql/query" -d 'query=_time:1s' 2>/dev/null; then
  echo "PIANO: log store unreachable at $LOGS — cannot tell if anyone is there"
  exit 1
fi

busy=0

mounted_at="$(last_seen game.mount)"
unmounted_at="$(last_seen game.unmount)"
if [ -n "$mounted_at" ] && { [ -z "$unmounted_at" ] || [[ "$mounted_at" > "$unmounted_at" ]]; }; then
  echo "PIANO: a game is on screen (game.mount at $mounted_at, no unmount since)"
  busy=1
fi

active="$(curl -s --max-time 5 "$LOGS/select/logsql/query" \
  -d "query=_time:$PIANO_WINDOW AND context.app:piano-kiosk AND ($HUMAN_EVENTS)" \
  -d 'limit=1' 2>/dev/null | head -c 1 | wc -c)"
if [ "${active:-0}" -gt 0 ]; then
  echo "PIANO: someone is using the kiosk (activity in the last $PIANO_WINDOW)"
  busy=1
fi

[ "$busy" -ne 0 ] && exit 1
echo "PIANO: idle (no game on screen; no activity in $PIANO_WINDOW)"
exit 0
