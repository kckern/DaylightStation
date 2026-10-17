#!/bin/sh
# Push main to origin as soon as it moves, on checkouts that opt in:
#
#   git config daylight.autoPush true
#
# Called by post-commit and post-merge. A machine that develops and merges
# locally (the server checkout) otherwise piles up unpushed merges; on
# 2026-10-16 a reset there nearly lost 43 of them. The push goes through
# pre-push like any other, so the secret scan still applies. Never forces,
# never merges, never fails the commit: on failure it says why, logs to
# <git-common-dir>/autopush.log, and the next commit on main retries.

[ "$(git config --bool --get daylight.autoPush 2>/dev/null)" = "true" ] || exit 0
[ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" = "main" ] || exit 0
git rev-parse --verify -q refs/remotes/origin/main >/dev/null || exit 0
[ -n "$(git rev-list -1 refs/remotes/origin/main..main 2>/dev/null)" ] || exit 0

OUT=$(GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o ConnectTimeout=10 -o BatchMode=yes}" git push origin main 2>&1)
STATUS=$?
printf '%s\n' "$OUT" >&2
[ "$STATUS" -eq 0 ] && exit 0

case "$OUT" in
  *"PUSH BLOCKED"*)
    REASON="pre-push scan blocked it"
    FIX="scrub the hunk in a new commit on main; the next commit retries the push" ;;
  *"[rejected]"*|*non-fast-forward*|*"fetch first"*)
    REASON="rejected: origin/main has commits this checkout lacks"
    FIX="git pull --no-rebase origin main && git push origin main" ;;
  *)
    REASON="push failed (network or auth)"
    FIX="the next commit on main retries, or run: git push origin main" ;;
esac

printf '\n\033[1;31mAUTO-PUSH FAILED\033[0m (%s). The commit stands; main is not on GitHub yet.\n' "$REASON" >&2
printf 'Fix: %s\n\n' "$FIX" >&2
LOG="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/autopush.log"
printf '%s %s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$(git rev-parse --short main)" "$REASON" >> "$LOG" 2>/dev/null
exit 0
