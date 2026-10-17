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

# Keep any core.sshCommand (deploy key) and add timeouts so a dead network
# can't hang the commit.
base=${GIT_SSH_COMMAND:-$(git config --get core.sshCommand || echo ssh)}
printf 'auto-push: pushing main to origin...\n' >&2
OUT=$(GIT_SSH_COMMAND="$base -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -o BatchMode=yes" GIT_TERMINAL_PROMPT=0 git push origin main 2>&1)
STATUS=$?
printf '%s\n' "$OUT" >&2
[ "$STATUS" -eq 0 ] && exit 0

case "$OUT" in
  *"PUSH BLOCKED"*)
    REASON="pre-push scan blocked it"
    FIX="remove it from the unpushed commits (git commit --amend if it's the last one, else git rebase -i origin/main), then git push origin main" ;;
  *"[remote rejected]"*)
    REASON="GitHub refused the push (branch protection or a server hook)"
    FIX="see the output above" ;;
  *"[rejected]"*|*non-fast-forward*|*"fetch first"*)
    REASON="rejected: origin/main has commits this checkout lacks"
    FIX="git pull --no-rebase origin main && git push origin main; if you amended or rebased commits that were already pushed, undo that instead of pulling" ;;
  *)
    REASON="push failed (network or auth)"
    FIX="the next commit on main retries, or run: git push origin main" ;;
esac

printf '\n\033[1;31mAUTO-PUSH FAILED\033[0m (%s). The commit stands; main is not on GitHub yet.\n' "$REASON" >&2
printf 'Fix: %s\n\n' "$FIX" >&2
GCD=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) &&
  printf '%s %s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$(git rev-parse --short main)" "$REASON" >> "$GCD/autopush.log" 2>/dev/null
exit 0
