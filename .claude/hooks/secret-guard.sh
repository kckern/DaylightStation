#!/bin/bash
# PreToolUse guard on Bash: blocks `git commit` / `git push` when the content
# being committed — or the committed-but-unpushed range — contains known
# secrets or household PII.
#
# The commit scan covers everything a commit can sweep up, not just the index:
#   staged      git diff --cached          (plain `git commit`)
#   unstaged    git diff                   (`git commit -a`, `git commit <path>`,
#                                            and `git add … && git commit` — at
#                                            PreToolUse time the add has not run
#                                            yet, so the index is still empty)
#   untracked   ls-files --others          (a brand-new file swept up by `add -A`)
#   amend       git show HEAD              (`--amend` re-commits HEAD's content)
# Scanning only --cached let the two commonest Claude forms through; that is how
# a learner's real name reached the history on 2026-09-06.
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

# Match the subcommand through any global options, so `git -C <dir> commit`,
# `git --no-pager push` and `git -c user.name=x commit` all trigger. A literal
# "git commit" substring test missed every one of those.
git_sub() {
  printf '%s' "$CMD" | grep -qE "(^|[^[:alnum:]_.-])git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--[a-z][a-z-]*(=[^[:space:]]+)?|-[a-zA-Z]))*[[:space:]]+$1([[:space:]]|\$)"
}
IS_COMMIT=0
IS_PUSH=0
git_sub commit && IS_COMMIT=1
git_sub push && IS_PUSH=1
[ "$IS_COMMIT" -eq 0 ] && [ "$IS_PUSH" -eq 0 ] && exit 0

# --- Resolve the repo the command will actually act on -----------------------
# Worktree work is routine here, so follow a leading `cd <dir>` or a `git -C <dir>`;
# without this a worktree commit gets scanned against the main checkout.
START="$PWD"
unquote() { sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//'; }
CD_T=$(printf '%s' "$CMD" | grep -oE '(^|[;&|(]|&&)[[:space:]]*cd[[:space:]]+[^;&|)]+' | head -1 | sed -E 's/.*[[:space:]]cd[[:space:]]+|.*^cd[[:space:]]+//' | unquote)
GC_T=$(printf '%s' "$CMD" | grep -oE 'git[[:space:]]+-C[[:space:]]+[^;&|) ]+' | head -1 | sed -E 's/.*-C[[:space:]]+//' | unquote)
for cand in "$GC_T" "$CD_T"; do
  [ -n "$cand" ] || continue
  case "$cand" in
    /*) d="$cand" ;;
    "~"*) d="$HOME${cand#\~}" ;;
    *) d="$START/$cand" ;;
  esac
  if [ -d "$d" ]; then START="$d"; break; fi
done

REPO_ROOT=$(git -C "$START" rev-parse --show-toplevel 2>/dev/null) || exit 0

TMP=$(mktemp) || exit 0
FILTERED=$(mktemp) || { rm -f "$TMP"; exit 0; }
trap 'rm -f "$TMP" "$FILTERED"' EXIT

# Records are "source<TAB>path:line<TAB>text" so a denial can name the file.
added_from_diff() {
  awk -v src="$1" '
    /^\+\+\+ /  { p = substr($0, 5); sub(/^b\//, "", p); next }
    /^@@/       { if (match($0, /\+[0-9]+/)) ln = substr($0, RSTART + 1, RLENGTH - 1) + 0; next }
    /^\+/       { print src "\t" p ":" ln "\t" substr($0, 2); ln++; next }
    /^-/        { next }
                { ln++ }
  '
}

if [ "$IS_COMMIT" -eq 1 ]; then
  git -C "$REPO_ROOT" diff --cached -U0 2>/dev/null | added_from_diff staged   >> "$TMP"
  git -C "$REPO_ROOT" diff -U0          2>/dev/null | added_from_diff unstaged >> "$TMP"

  # Untracked and not gitignored — the file a compound `add -A && commit` creates.
  git -C "$REPO_ROOT" ls-files --others --exclude-standard -z 2>/dev/null | head -c 2000000 |
    while IFS= read -r -d '' f; do
      full="$REPO_ROOT/$f"
      [ -f "$full" ] || continue
      # The pattern file necessarily contains every pattern — never scan it,
      # nor anything under the auth tree.
      case "$f" in .claude/secret-patterns*|*/auth/*|.env) continue ;; esac
      sz=$(wc -c < "$full" 2>/dev/null || echo 0)
      [ "$sz" -gt 524288 ] && continue          # skip bulk assets; -I skips binary
      LC_ALL=C grep -I -n '' -- "$full" 2>/dev/null | head -20000 |
        awk -v p="$f" '{ i = index($0, ":"); print "untracked\t" p ":" substr($0, 1, i - 1) "\t" substr($0, i + 1) }'
    done >> "$TMP"

  case "$CMD" in
    *--amend*) git -C "$REPO_ROOT" show -U0 --format= HEAD 2>/dev/null | added_from_diff amend >> "$TMP" ;;
  esac
fi

if [ "$IS_PUSH" -eq 1 ]; then
  BASE=$(git -C "$REPO_ROOT" rev-parse --verify -q '@{upstream}' 2>/dev/null) \
    || BASE=$(git -C "$REPO_ROOT" rev-parse --verify -q origin/main 2>/dev/null) || BASE=""
  [ -n "$BASE" ] || BASE=$(git -C "$REPO_ROOT" rev-parse --verify -q origin/main 2>/dev/null) || BASE=""
  if [ -n "$BASE" ]; then
    git -C "$REPO_ROOT" log -p -U0 --format='' "$BASE..HEAD" 2>/dev/null | head -c 4000000 |
      added_from_diff unpushed >> "$TMP"
  fi
fi

[ -s "$TMP" ] || exit 0

# Known-safe phrases are excluded before matching (e.g. media titles).
grep -v 'Felix Lullabye' "$TMP" > "$FILTERED" 2>/dev/null || : 
[ -s "$FILTERED" ] || exit 0

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# --- 1) FKB password (read at runtime; never printed) ---
BASE_PATH=$(grep -E '^DAYLIGHT_BASE_PATH=' "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '"')
[ -n "$BASE_PATH" ] || BASE_PATH=$(grep -E '^DAYLIGHT_BASE_PATH=' "${CLAUDE_PROJECT_DIR:-$REPO_ROOT}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"')
AUTH="${SECRET_GUARD_AUTH_FILE:-$BASE_PATH/data/household/auth/fullykiosk.yml}"
if [ -f "$AUTH" ]; then
  PW=$(grep -E '^password:' "$AUTH" | sed 's/^password:[[:space:]]*//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')
  if [ -n "$PW" ]; then
    PW_URI=$(jq -rn --arg v "$PW" '$v|@uri')
    WHERE=$(grep -F -- "$PW" "$FILTERED" | head -3 | awk -F'\t' '{ printf "  [%s] %s\n", $1, $2 }')
    [ -n "$WHERE" ] || WHERE=$(grep -F -- "$PW_URI" "$FILTERED" | head -3 | awk -F'\t' '{ printf "  [%s] %s\n", $1, $2 }')
    if [ -n "$WHERE" ]; then
      deny "BLOCKED: the content being committed/pushed contains the FKB password (source: data/household/auth/fullykiosk.yml).
$WHERE
Tracked docs must keep the <rotated-fkb-password-urlencoded> placeholder — revert that hunk first. Committing it requires the user's explicit two-key authorization phrase."
    fi
  fi
fi

# --- 2) Local PII/secret patterns (gitignored file, one ERE per line) ---
PAT_FILE="$REPO_ROOT/.claude/secret-patterns.local.txt"
if [ ! -f "$PAT_FILE" ]; then
  # Worktrees do not carry the gitignored pattern file; fall back to the main checkout.
  MAIN_ROOT=$(dirname "$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)")
  for c in "${CLAUDE_PROJECT_DIR:-}/.claude/secret-patterns.local.txt" "$MAIN_ROOT/.claude/secret-patterns.local.txt"; do
    if [ -f "$c" ]; then PAT_FILE="$c"; break; fi
  done
fi

if [ -f "$PAT_FILE" ]; then
  while IFS= read -r pat; do
    pat="${pat%%$'\r'}"
    [ -z "$pat" ] && continue
    case "$pat" in \#*) continue ;; esac
    HITS=$(grep -iwE -- "$pat" "$FILTERED" 2>/dev/null | head -5 | awk -F'\t' '{ printf "  [%s] %s\n", $1, $2 }')
    if [ -n "$HITS" ]; then
      N=$(grep -icwE -- "$pat" "$FILTERED" 2>/dev/null)
      deny "BLOCKED: $N line(s) about to be committed/pushed match household PII/secret pattern '$pat' (.claude/secret-patterns.local.txt).
$HITS
This repo is public — scrub the real names/device IDs (use test-user style placeholders such as 'test-learner') before committing. The scan covers staged, unstaged AND untracked content, so staging later will not clear it."
    fi
  done < "$PAT_FILE"
fi

exit 0
