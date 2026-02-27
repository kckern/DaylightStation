#!/usr/bin/env bash
# organize-fitness-pdfs.sh
#
# Organizes ~1664 PDFs across BODi/Beachbody fitness programs in the Plex
# Docker container into consistent `docs/` folders with category-prefixed
# kebab-case filenames.
#
# Usage:
#   docker exec plex bash /tmp/organize-fitness-pdfs.sh [--execute] [--verbose] [--help]
#
# Default mode is dry-run (print planned moves without executing).
#
# Phases:
#   1. Delete macOS ._*.pdf dot files
#   2. Categorize + rename + move each .pdf into {scope}/docs/{category}-{clean-name}.pdf
#   3. Clean up empty legacy doc-folder directories
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
BASE="/data/media/video/fitness"
EXECUTE=false
VERBOSE=false

# Counters
declare -i COUNT_MOVED=0
declare -i COUNT_SKIPPED=0
declare -i COUNT_DOTFILES=0
declare -i COUNT_COLLISIONS=0
declare -i COUNT_DIRS_CLEANED=0

# Collision tracker: destination path -> 1 (marks path as claimed)
declare -A DEST_SEEN

# Known legacy doc-folder basenames (case-sensitive match)
LEGACY_DOC_DIRS=("_Docs" "_docs" "Documents" "_Documentation" "PDFs" "pdf" "_PDF" "TSS PDFs" "Insanity Documents")

# ---------------------------------------------------------------------------
# Usage / argument parsing
# ---------------------------------------------------------------------------
usage() {
  cat <<'USAGE'
organize-fitness-pdfs.sh — Organize fitness program PDFs

Usage:
  organize-fitness-pdfs.sh [OPTIONS]

Options:
  --execute   Actually move files (default is dry-run)
  --verbose   Print extra detail (skipped files, category reasoning)
  --help      Show this help

Phases:
  1. Delete macOS ._*.pdf resource-fork files
  2. Move + rename PDFs into {scope}/docs/{category}-{name}.pdf
  3. Remove empty legacy doc directories
USAGE
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    --help)    usage ;;
    *)         echo "Unknown option: $1" >&2; usage ;;
  esac
done

if $EXECUTE; then
  echo "=== EXECUTE MODE — files will be moved ==="
else
  echo "=== DRY-RUN MODE — no files will be changed ==="
fi
echo ""

# ---------------------------------------------------------------------------
# Helper: verbose log
# ---------------------------------------------------------------------------
vlog() {
  if $VERBOSE; then
    echo "  [verbose] $*"
  fi
}

# ---------------------------------------------------------------------------
# categorize_filename <basename>
#
# Prints one of: calendar, nutrition, guide, worksheet, reference
# based on keyword matching on the lowercased filename.
# ---------------------------------------------------------------------------
categorize_filename() {
  local lower
  lower=$(echo "$1" | tr '[:upper:]' '[:lower:]')

  # Calendar / schedule
  if [[ "$lower" =~ (calendar|schedule|hybrid) ]]; then
    echo "calendar"
    return
  fi

  # Nutrition / food / meal / diet
  if [[ "$lower" =~ (nutrition|eating|meal|food|diet|portion|recipe|grocery|container|calorie|vegan|intermittent|fasting) ]]; then
    echo "nutrition"
    return
  fi

  # Guide / getting started
  if [[ "$lower" =~ (guide|start[-_]here|get[-_]started|getting[-_]started|welcome|quick[-_]?start|how[-_]to|quickstart|gsg) ]]; then
    echo "guide"
    return
  fi

  # Worksheet / tracker / measurement
  if [[ "$lower" =~ (worksheet|tally|tracker|fit[-_]?test|measurement|journal|log|selfie|fit[-_]?check|workbook|playbook) ]]; then
    echo "worksheet"
    return
  fi

  # Fallback
  echo "reference"
}

# ---------------------------------------------------------------------------
# clean_name <basename_without_extension>
#
# Strips program-code prefixes, internal BOD/locale codes, date stamps,
# and converts to kebab-case lowercase. Caller should NOT include .pdf.
# ---------------------------------------------------------------------------
clean_name() {
  local name="$1"

  # 1. Strip leading program code prefix: 2-10 uppercase/digit chars followed
  #    by _ or - (e.g., "10R_", "DDPR-", "21DINS1203_", "ASYINS1103_",
  #    "MUDINS1101_", "ACCINS1181_", "MLRINS1103_", "80DO_").
  #    Also handles numeric-only prefixes like "448150_", "387250_", "8370_".
  #    Repeat up to 3 times for chained prefixes (e.g., "448150_DDPR_").
  # Handle long INS-style codes first (e.g., 21DINS1203_, ASYINS1103_, ACCINS1181_)
  name=$(echo "$name" | sed -E 's/^[A-Z0-9]{2,6}INS[0-9]+[-_]//')
  # Then strip standard 2-6 char prefixes, repeat for chained prefixes (e.g., 448150_DDPR_)
  for _ in 1 2 3; do
    name=$(echo "$name" | sed -E 's/^[A-Z0-9]{2,6}[-_]//')
  done

  # 2. Strip BOD-EN-US / BOD-EN_US internal codes (mid-string too)
  name=$(echo "$name" | sed -E 's/BOD[-_]?EN[-_]US[-_]?//gI')
  name=$(echo "$name" | sed -E 's/BOD[-_]//gI')

  # 3. Strip OPF_ prefix (used by some programs like "OPF_XTST_...")
  name=$(echo "$name" | sed -E 's/^OPF[-_]//I')

  # 4. Strip locale suffixes: _EN-US, _EN_US, _en-us, _en_us, _US, -US,
  #    _EN-CA, _EN_CA, etc.
  name=$(echo "$name" | sed -E 's/[-_]?[Ee][Nn][-_][A-Za-z]{2}([-_]|$)/\1/g')
  name=$(echo "$name" | sed -E 's/[-_]?(US|CA)[-_]?(PDF|BOD)//gI')
  name=$(echo "$name" | sed -E 's/[-_]en[-_]us[0-9]*//gI')
  name=$(echo "$name" | sed -E 's/[-_]US$//I')

  # 5. Strip date stamps: MM.DD.YY, MMDDYY, MM-DD-YY, YYYYMMDD
  #    Also handles dates like _060818, _10.19.18, -052622, _022522
  name=$(echo "$name" | sed -E 's/[-_]?[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4}//g')
  name=$(echo "$name" | sed -E 's/[-_][0-9]{6,8}([-_]|$)/\1/g')

  # 6. Strip trailing version/copy markers: (1), -1, _v2, _V4, _UPDATED, etc.
  name=$(echo "$name" | sed -E 's/[-_ ]*\([0-9]+\)$//')
  name=$(echo "$name" | sed -E 's/[-_][vV][0-9]+$//')
  name=$(echo "$name" | sed -E 's/[-_]UPDATED[-_]?[0-9]*$//I')
  name=$(echo "$name" | sed -E 's/[-_](FM|LR)$//I')

  # 7. Strip "Resource_Doc" suffix (internal BODi metadata)
  name=$(echo "$name" | sed -E 's/[-_]Resource[-_]Doc$//I')

  # 8. Strip random hash prefixes (Teachable-style: 20+ alphanumeric + _)
  name=$(echo "$name" | sed -E 's/^[A-Za-z0-9]{20,}[-_]//')

  # 9. Strip "Beachbody-" prefix and "Official Beachbody" prefix
  name=$(echo "$name" | sed -E 's/^(Official[-_ ])?Beachbody[-_ ]//I')

  # 10. Strip "DIG IN_" prefix (program name embedded in filename)
  name=$(echo "$name" | sed -E 's/^DIG[-_ ]IN[-_ ]//I')

  # 11. Transliterate non-ASCII characters (™ → TM, é → e, etc.)
  #     then strip any remaining non-alphanumeric (except hyphens, underscores, spaces, dots)
  name=$(echo "$name" | iconv -t ASCII//TRANSLIT 2>/dev/null || echo "$name")
  name=$(echo "$name" | sed -E "s/[^A-Za-z0-9 _.-]//g")

  # 12. Split CamelCase before lowercasing:
  #     "FitnessGuide" -> "Fitness-Guide", "MealPlans" -> "Meal-Plans"
  #     Insert hyphen between lowercase-then-uppercase: aB -> a-B
  name=$(echo "$name" | sed -E 's/([a-z])([A-Z])/\1-\2/g')
  #     Insert hyphen between uppercase-then-uppercase+lowercase: ABc -> A-Bc
  name=$(echo "$name" | sed -E 's/([A-Z]+)([A-Z][a-z])/\1-\2/g')

  #     - Lowercase
  #     - Replace underscores, spaces, multiple hyphens with single hyphen
  #     - Trim leading/trailing hyphens
  name=$(echo "$name" | tr '[:upper:]' '[:lower:]')
  name=$(echo "$name" | sed -E "s/[_ ]+/-/g")
  name=$(echo "$name" | sed -E 's/-{2,}/-/g')
  name=$(echo "$name" | sed -E 's/^-+//')
  name=$(echo "$name" | sed -E 's/-+$//')

  # 13. If the name is empty after all stripping, use "document"
  if [[ -z "$name" ]]; then
    name="document"
  fi

  echo "$name"
}

# ---------------------------------------------------------------------------
# is_legacy_doc_dir <dirname>
#
# Returns 0 if the directory basename matches a known legacy doc-folder name.
# ---------------------------------------------------------------------------
is_legacy_doc_dir() {
  local check="$1"
  for d in "${LEGACY_DOC_DIRS[@]}"; do
    if [[ "$check" == "$d" ]]; then
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# get_target_scope <filepath_relative_to_base>
#
# Determines the target docs/ directory scope. If the PDF is inside a Season
# folder, target is {program}/{season}/docs/. Otherwise {program}/docs/.
#
# Prints the target directory (absolute path) without trailing slash.
# ---------------------------------------------------------------------------
get_target_scope() {
  local relpath="$1"

  # First component is the program
  local program
  program=$(echo "$relpath" | cut -d/ -f1)

  # Check if second component is a Season folder
  local second
  second=$(echo "$relpath" | cut -d/ -f2)

  # Match "Season NN..." or "SNN..." at the start of the directory name
  if [[ "$second" =~ ^Season[[:space:]]+[0-9] ]] || [[ "$second" =~ ^S[0-9] ]]; then
    echo "${BASE}/${program}/${second}/docs"
  else
    echo "${BASE}/${program}/docs"
  fi
}

# ---------------------------------------------------------------------------
# Phase 1: Delete macOS ._*.pdf dot files
# ---------------------------------------------------------------------------
echo "--- Phase 1: Deleting macOS ._*.pdf dot files ---"

while IFS= read -r -d '' dotfile; do
  COUNT_DOTFILES+=1
  if $EXECUTE; then
    rm -f "$dotfile"
    echo "  DELETED: $dotfile"
  else
    echo "  DELETE: $dotfile"
  fi
done < <(find "$BASE" -name '._*.pdf' -type f -print0)

echo "  Dot files found: $COUNT_DOTFILES"
echo ""

# ---------------------------------------------------------------------------
# Phase 2: Categorize, rename, and move PDFs
# ---------------------------------------------------------------------------
echo "--- Phase 2: Organizing PDFs ---"

while IFS= read -r -d '' filepath; do
  # Skip dot files (already handled in Phase 1)
  local_basename=$(basename "$filepath")
  if [[ "$local_basename" == ._* ]]; then
    continue
  fi

  # Get path relative to BASE
  relpath="${filepath#"${BASE}/"}"

  # Determine target scope (program/docs or program/season/docs)
  target_dir=$(get_target_scope "$relpath")

  # Get the basename without .pdf
  stem="${local_basename%.pdf}"

  # Categorize
  category=$(categorize_filename "$stem")

  # Clean the name
  cleaned=$(clean_name "$stem")

  # Build the target filename
  target_name="${category}-${cleaned}.pdf"
  target_path="${target_dir}/${target_name}"

  # Check if already in correct location
  if [[ "$filepath" == "$target_path" ]]; then
    COUNT_SKIPPED+=1
    vlog "SKIP (already correct): $filepath"
    continue
  fi

  # --- Collision resolution (inline to avoid subshell) ---
  if [[ -n "${DEST_SEEN["$target_path"]+_}" ]] || [[ -e "$target_path" && "$filepath" != "$target_path" ]]; then
    # Collision — find next available suffix
    coll_dir=$(dirname "$target_path")
    coll_base=$(basename "$target_path" .pdf)
    coll_n=2
    while true; do
      candidate="${coll_dir}/${coll_base}-${coll_n}.pdf"
      if [[ -z "${DEST_SEEN["$candidate"]+_}" ]] && [[ ! -e "$candidate" || "$filepath" == "$candidate" ]]; then
        target_path="$candidate"
        COUNT_COLLISIONS+=1
        break
      fi
      coll_n=$((coll_n + 1))
    done
  fi
  DEST_SEEN["$target_path"]=1

  # Check again after collision resolution — might now match source
  if [[ "$filepath" == "$target_path" ]]; then
    COUNT_SKIPPED+=1
    vlog "SKIP (already correct after collision): $filepath"
    continue
  fi

  # Print or execute
  if $EXECUTE; then
    mkdir -p "$target_dir"
    mv "$filepath" "$target_path"
    echo "  MOVED: $relpath"
    vlog "    -> $target_path"
  else
    echo "  $filepath"
    echo "    -> $target_path"
  fi

  COUNT_MOVED+=1

done < <(find "$BASE" -name '*.pdf' -type f -not -name '._*' -print0 | sort -z)

echo ""
echo "  PDFs to move: $COUNT_MOVED"
echo "  PDFs skipped (already correct): $COUNT_SKIPPED"
echo "  Name collisions resolved: $COUNT_COLLISIONS"
echo ""

# ---------------------------------------------------------------------------
# Phase 3: Clean up empty legacy doc directories
# ---------------------------------------------------------------------------
echo "--- Phase 3: Cleaning empty legacy doc directories ---"

# Find directories matching known doc-folder names, deepest first (so nested
# dirs like _Docs/_Docs or _PDF/_Docs/pdf get cleaned bottom-up).
# sort -rz gives reverse order which puts deeper paths first.
while IFS= read -r -d '' dirpath; do
  dirname_base=$(basename "$dirpath")
  if is_legacy_doc_dir "$dirname_base"; then
    # Check if directory is empty (no regular files anywhere inside)
    if [[ -z "$(find "$dirpath" -type f -print -quit 2>/dev/null)" ]]; then
      COUNT_DIRS_CLEANED+=1
      if $EXECUTE; then
        rm -rf "$dirpath"
        echo "  REMOVED: $dirpath"
      else
        echo "  REMOVE: $dirpath"
      fi
    else
      vlog "KEEP (not empty): $dirpath"
    fi
  fi
done < <(find "$BASE" -type d -print0 | sort -rz)

echo ""
echo "  Empty directories to remove: $COUNT_DIRS_CLEANED"
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "=============================="
echo "  SUMMARY"
echo "=============================="
echo "  Dot files deleted:    $COUNT_DOTFILES"
echo "  PDFs moved/renamed:   $COUNT_MOVED"
echo "  PDFs already correct: $COUNT_SKIPPED"
echo "  Name collisions:      $COUNT_COLLISIONS"
echo "  Empty dirs cleaned:   $COUNT_DIRS_CLEANED"
if $EXECUTE; then
  echo "  Mode: EXECUTED"
else
  echo "  Mode: DRY-RUN (no changes made)"
fi
echo "=============================="
