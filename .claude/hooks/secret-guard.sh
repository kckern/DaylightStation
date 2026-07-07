#!/bin/bash
# PreToolUse guard on Bash: blocks `git commit` / `git push` when the staged
# (or committed-but-unpushed) ADDED lines contain known secrets or household PII.
#
# No secrets live in this file. Patterns come from two runtime sources:
#   1. The FKB password, read from $DAYLIGHT_BASE_PATH/data/household/auth/fullykiosk.yml
#      (plus its URL-encoded form, since docs embed it in curl URLs)
#   2. Extra ERE patterns (one per line, # comments allowed) from the gitignored
#      .claude/secret-patterns.local.txt
#
# Emits a PreToolUse deny decision on match; silent exit 0 otherwise.

set -u
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0

case "$CMD" in
  *"git commit"*|*"git push"*) ;;
  *) exit 0 ;;
esac

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# Collect only ADDED lines (^+) so context lines around pre-existing identifiers
# don't false-positive.
SCAN=""
case "$CMD" in *"git commit"*)
  SCAN=$(git -C "$REPO_ROOT" diff --cached 2>/dev/null | grep '^+' | grep -v '^+++')
esac
case "$CMD" in *"git push"*)
  SCAN="$SCAN
$(git -C "$REPO_ROOT" log -p origin/main..HEAD 2>/dev/null | head -c 2000000 | grep '^+' | grep -v '^+++')"
esac
[ -z "$(printf '%s' "$SCAN" | tr -d '[:space:]')" ] && exit 0

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# --- 1) FKB password (read at runtime; never printed) ---
BASE=$(grep -E '^DAYLIGHT_BASE_PATH=' "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' )
AUTH="${SECRET_GUARD_AUTH_FILE:-$BASE/data/household/auth/fullykiosk.yml}"
if [ -f "$AUTH" ]; then
  PW=$(grep -E '^password:' "$AUTH" | sed 's/^password:[[:space:]]*//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')
  if [ -n "$PW" ]; then
    PW_URI=$(jq -rn --arg v "$PW" '$v|@uri')
    if printf '%s' "$SCAN" | grep -qF -- "$PW" || printf '%s' "$SCAN" | grep -qF -- "$PW_URI"; then
      deny "BLOCKED: the diff being committed/pushed contains the FKB password (source: data/household/auth/fullykiosk.yml). Tracked docs must keep the <rotated-fkb-password-urlencoded> placeholder — revert that hunk first. Committing it requires the user's explicit two-key authorization phrase."
    fi
  fi
fi

# --- 2) Local PII/secret patterns (gitignored file, one ERE per line) ---
PAT_FILE="$REPO_ROOT/.claude/secret-patterns.local.txt"
if [ -f "$PAT_FILE" ]; then
  # Known-safe phrases are excluded before matching (e.g. media titles).
  FILTERED=$(printf '%s' "$SCAN" | grep -v 'Felix Lullabye')
  while IFS= read -r pat; do
    pat="${pat%%$'\r'}"
    [ -z "$pat" ] && continue
    case "$pat" in \#*) continue ;; esac
    if printf '%s' "$FILTERED" | grep -qiwE -- "$pat"; then
      deny "BLOCKED: added lines in the diff match household PII/secret pattern '$pat' (.claude/secret-patterns.local.txt). This repo is public — scrub real names/device IDs (use test-user style placeholders) before committing."
    fi
  done < "$PAT_FILE"
fi

exit 0
