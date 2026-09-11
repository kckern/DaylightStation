#!/bin/bash
# school-portal-idle.sh — is anyone standing at the school Portal right now?
#
# Exit 0 = idle, nobody there. Exit 1 = someone is using it; LEAVE IT ALONE.
#
# WHY THIS IS AN ALLOWLIST. The condition it replaces matched ANY
# `school.selfservice` event, which is not the same question. The Portal emits
# plenty without a person in front of it — most of all `status-board.refresh`
# (592 in 7 days) and the `screen-off.*` sequence it runs when it puts ITSELF to
# sleep. On 2026-09-11 the gate blocked a deploy on exactly that: three
# `screen-off` lines, all `source: "idle"`, from a panel going dark in an empty
# room. The owner had to override a gate that was protecting nobody.
#
# That is the failure mode worth caring about. A gate that cries wolf gets
# overridden by habit, and then it is not a gate. So the rule is the same one
# `piano-kiosk-idle.sh` uses: name the events that mean A PERSON IS HERE, and
# let everything else pass. A denylist would have the opposite failure — a new
# self-driven event starts blocking deploys and nobody knows why.
#
# `screen-off` is excluded even at `source: "manual"` (32 of 141). Manual means
# somebody pressed "done" — a person LEAVING is not a reason to hold a deploy.
#
# WHAT IT MUST STILL CATCH is the 2026-08-25 incident this gate exists for: a
# child entered a companion code 5.1 seconds after the container stopped, Nginx
# had no upstream, the call 502'd, and the read-along never opened. Every step
# of that flow — `code.*`, `keypad.*`, `identity.*`, `action.*` — is below.
#
# FAILS CLOSED. An unreachable log store blocks: "I could not tell whether a
# child was there" is not "no child was there".
set -uo pipefail

LOGS="${DAYLIGHT_LOGSTORE:-http://localhost:9428}"
# Wider than the piano's. Entering a code takes longer than playing a note, and
# the cost of waiting is far lower than the cost of a dead code.
PORTAL_WINDOW="${PORTAL_WINDOW:-3m}"

# A person is at the panel. Prefix-matched, so a new event inside one of these
# families is caught without editing this list.
#
#   code.*      entering a companion code — resolved, rejected or throttled
#   keypad.*    touching the keypad, including a stray press and an abandon
#   identity.*  the who-are-you flow — asked, confirmed, denied
#   action.*    doing the thing they came for
#   preview.*   what they were shown after resolving
#   print.*     a confirmed print, a retry, a timeout waiting on a person
#   board.*     touching the status board
#   bulk.*      a grown-up resolving in bulk
#   program.mounted  a program actually opened in front of someone
HUMAN_EVENTS='"school.selfservice.code." OR "school.selfservice.keypad." OR "school.selfservice.identity." OR "school.selfservice.action." OR "school.selfservice.preview." OR "school.selfservice.print." OR "school.selfservice.board." OR "school.selfservice.bulk." OR "school.selfservice.program.mounted"'

if ! curl -s --max-time 5 -o /dev/null "$LOGS/select/logsql/query" -d 'query=_time:1s' 2>/dev/null; then
  echo "PORTAL: log store unreachable at $LOGS — cannot tell if anyone is there"
  exit 1
fi

active="$(curl -s --max-time 5 "$LOGS/select/logsql/query" \
  -d "query=_time:$PORTAL_WINDOW AND ($HUMAN_EVENTS)" \
  -d 'limit=1' 2>/dev/null | head -c 1 | wc -c)"

if [ "${active:-0}" -gt 0 ]; then
  echo "PORTAL: someone is using it (activity in the last $PORTAL_WINDOW)"
  exit 1
fi
echo "PORTAL: idle (no one at the panel in $PORTAL_WINDOW)"
exit 0
