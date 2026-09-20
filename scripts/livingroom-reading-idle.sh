#!/bin/bash
# livingroom-reading-idle.sh — is a child mid-story in the living room?
#
# Exit 0 = idle, nobody there. Exit 1 = someone is reading; LEAVE IT ALONE.
#
# THE FIFTH PLACE NOBODY WAS WATCHING. On 2026-09-18 the gate's other four
# sections were all honestly quiet while a child stood in the living room with
# his card and his book. He tapped at 11:04:32 and the session opened and
# acknowledged cleanly. The container restarted at 11:05:01. He tapped the book
# at 11:06:01 and the broadcast hit `bus.topic.unknown: reading:livingroom` —
# the TV's socket had died with the restart, and its replacement subscribed at
# 11:06:02.111, 0.79 seconds too late. Nothing played. His session idled out at
# 11:08:15 and story time went uncredited for the day. The garage was idle, the
# Portal was quiet, the piano kiosk was clear and there was no lockdown; every
# existing check passed honestly. Hence section 5.
#
# A READING SESSION IS THE QUIETEST THING IN THE HOUSE, which is exactly why it
# needed its own check rather than a line in an existing one. A story that is
# PLAYING emits nothing between `playback-started` and `playback-completed` —
# two and a half minutes of silence for a picture book, far longer for a
# chapter. A log window alone would call that room empty and deploy over a
# child halfway through his book. So this asks the SERVER whether a session is
# open, and uses the log window only for the minutes either side of one.
#
# WHY AN ALLOWLIST, the same reason as its two siblings: name the events that
# mean A PERSON IS HERE and let everything else pass. Three exclusions are
# load-bearing:
#
#   sessions-restored        the server replaying its own state after a
#                            restart. It fires FROM the very deploy this gate
#                            guards, so counting it would make the gate block
#                            on its own last deploy, every time, forever.
#   session-close/-timeout   a child LEAVING is not a reason to hold a deploy.
#   delivery-unacknowledged  a failure's consequence, not a person; the
#                            `session-open` just before it already spoke for
#                            whoever tapped.
#
# FAILS CLOSED ON THE LOG STORE, like its siblings: "I could not tell whether a
# child was there" is not "no child was there". It deliberately does NOT also
# fail closed when the app itself is unreachable — that is section 4's block,
# already fail-closed there, and a gate that goes red for two reasons at once
# teaches nobody which one to wait on.
set -uo pipefail

LOGS="${DAYLIGHT_LOGSTORE:-http://localhost:9428}"
SESSION_URL="${DAYLIGHT_READING_SESSION_URL:-http://localhost:3111/api/v1/school/reading/session?location=livingroom}"
# Wide enough to span a whole story plus the walk to the shelf and back.
READING_WINDOW="${READING_WINDOW:-5m}"

# A person is at the reader or mid-story. Prefix-matched, so a new event inside
# one of these families is caught without editing this list.
#
#   session-open*             a card was tapped and a session opened
#   session-switch-rendered   the screen actually painted the launch card
#   delivery-acknowledged     the screen confirmed it has the card
#   book-selected             a book sticker was tapped
#   pick*                     the pick flow — chosen, counted down, refused
#   playback*                 a story started, finished, or attached media
HUMAN_EVENTS='"school.reading.session-open" OR "school.reading.session-switch-rendered" OR "school.reading.delivery-acknowledged" OR "school.reading.book-selected" OR "school.reading.pick" OR "school.reading.playback"'

# ── 1. Is a session open RIGHT NOW? ────────────────────────────────────────
# The signal a log window cannot give. A story mid-play is silent and the child
# is still standing there. `session: null` is the idle answer.
session="$(curl -s --max-time 5 "$SESSION_URL" 2>/dev/null)"
if printf '%s' "$session" | grep -q '"session":[[:space:]]*{'; then
  learner="$(printf '%s' "$session" | grep -oE '"learnerId":"[^"]*"' | head -1 | cut -d'"' -f4)"
  echo "LIVINGROOM: a reading session is open (${learner:-someone} is mid-story)"
  exit 1
fi

# ── 2. Did someone just act, even if the session has since closed? ─────────
# A book tapped seconds before a teardown is the grace-window case the
# interceptor exists for, and a child who just finished one book is still in
# the room deciding on the next.
if ! curl -s --max-time 5 -o /dev/null "$LOGS/select/logsql/query" -d 'query=_time:1s' 2>/dev/null; then
  echo "LIVINGROOM: log store unreachable at $LOGS — cannot tell if anyone is there"
  exit 1
fi

active="$(curl -s --max-time 5 "$LOGS/select/logsql/query" \
  -d "query=_time:$READING_WINDOW AND ($HUMAN_EVENTS)" \
  -d 'limit=1' 2>/dev/null | head -c 1 | wc -c)"

if [ "${active:-0}" -gt 0 ]; then
  echo "LIVINGROOM: someone is reading (activity in the last $READING_WINDOW)"
  exit 1
fi
echo "LIVINGROOM: idle (no session open, nothing in $READING_WINDOW)"
exit 0
