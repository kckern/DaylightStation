# Fitness PDF Organization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Organize ~1664 PDFs across 76+ BODi/Beachbody fitness programs into consistent `docs/` folders with category-prefixed kebab-case filenames.

**Architecture:** A single bash script runs inside the Plex Docker container. It finds all PDFs under `/data/media/video/fitness/`, determines target `docs/` folders (per-season or top-level), categorizes and renames each file, and moves them. Dry-run by default, `--execute` to apply.

**Tech Stack:** Bash (runs via `docker exec plex`), no external dependencies.

**Design doc:** `docs/plans/2026-02-27-fitness-pdf-organization-design.md`

---

### Task 1: Create the script skeleton with argument parsing

**Files:**
- Create: `cli/scripts/organize-fitness-pdfs.sh`

**Step 1: Write the script with usage, flags, and main loop skeleton**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Fitness PDF Organizer
# Consolidates PDFs into docs/ folders with category-prefixed kebab-case names.
# Runs inside the Plex Docker container.
#
# Usage:
#   docker exec plex bash /path/to/organize-fitness-pdfs.sh           # dry-run
#   docker exec plex bash /path/to/organize-fitness-pdfs.sh --execute  # apply changes

BASE="/data/media/video/fitness"
DRY_RUN=true
VERBOSE=false

for arg in "$@"; do
  case "$arg" in
    --execute) DRY_RUN=false ;;
    --verbose) VERBOSE=true ;;
    --help|-h)
      echo "Usage: $0 [--execute] [--verbose]"
      echo "  Default: dry-run (shows planned moves without changing files)"
      echo "  --execute  Actually move/rename files"
      echo "  --verbose  Show skipped files and extra detail"
      exit 0
      ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

if $DRY_RUN; then
  echo "=== DRY RUN (pass --execute to apply) ==="
else
  echo "=== EXECUTING — files will be moved ==="
fi
echo ""

# Counters
moved=0
dotfiles_deleted=0
dirs_cleaned=0
collisions=0
skipped=0

# --- Phase 1: Delete macOS ._*.pdf dot files ---
echo "--- Phase 1: Cleaning macOS dot files ---"
while IFS= read -r -d '' dotfile; do
  dotfiles_deleted=$((dotfiles_deleted + 1))
  if $DRY_RUN; then
    echo "  DELETE $dotfile"
  else
    rm "$dotfile"
  fi
done < <(find "$BASE" -name "._*.pdf" -type f -print0 2>/dev/null)
echo "  Dot files: $dotfiles_deleted"
echo ""

# --- Phase 2: Categorize and move PDFs ---
echo "--- Phase 2: Categorize and move PDFs ---"

categorize() {
  local lower="$1"
  if echo "$lower" | grep -qE '(calendar|schedule)'; then
    echo "calendar"
  elif echo "$lower" | grep -qE '(nutrition|eating|meal|food|diet|portion|recipe|grocery)'; then
    echo "nutrition"
  elif echo "$lower" | grep -qE '(guide|start.here|get.started|welcome|quick.start|how.to)'; then
    echo "guide"
  elif echo "$lower" | grep -qE '(worksheet|tally|tracker|fit.test|measurement|journal|log|selfie)'; then
    echo "worksheet"
  else
    echo "reference"
  fi
}

clean_name() {
  local name="$1"
  # Strip .pdf extension
  name="${name%.pdf}"
  # Strip leading dots/underscores
  name=$(echo "$name" | sed 's/^[._]*//')
  # Strip known program code prefixes: 2-6 uppercase/digit chars followed by _ or -
  # But only if something meaningful follows
  name=$(echo "$name" | sed -E 's/^[A-Z0-9]{2,6}(INS[0-9]*)?[_-]+//')
  # Strip BOD/BODi internal codes like "BOD-EN-US-", "BOD_EN_US_", "BOD_"
  name=$(echo "$name" | sed -E 's/BOD[_-](EN[_-]US[_-])?//gI')
  # Strip locale suffixes
  name=$(echo "$name" | sed -E 's/[_-]?(EN[_-])?US[_-]?$//I')
  name=$(echo "$name" | sed -E 's/[_-]en[_-]us[_-]?//gI')
  name=$(echo "$name" | sed -E 's/[_-]EN[_-]US[_-]?//g')
  # Strip date stamps: -MMDDYY, _MMDDYY, -MMDDYYYY, _M.DD.YY, etc.
  name=$(echo "$name" | sed -E 's/[_-][0-9]{6,8}(-[0-9]+)?$//g')
  name=$(echo "$name" | sed -E 's/[_-][0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4}(-[0-9]+)?$//g')
  name=$(echo "$name" | sed -E 's/[_-][0-9]{1,2}-[0-9]{1,2}-[0-9]{2,4}$//g')
  # Convert to kebab-case: underscores/spaces to hyphens, lowercase
  name=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | tr -s '-')
  # Remove trailing hyphens/numbers that are just artifacts
  name=$(echo "$name" | sed -E 's/-+$//')
  # Remove parenthetical suffixes like "(1)"
  name=$(echo "$name" | sed -E 's/\([0-9]+\)$//' | sed -E 's/-+$//')
  # Collapse multiple hyphens
  name=$(echo "$name" | tr -s '-')
  # If empty after cleanup, use "document"
  if [ -z "$name" ]; then
    name="document"
  fi
  echo "$name"
}

determine_target_dir() {
  local filepath="$1"
  local program_dir="$2"

  # Get the path relative to the program dir
  local relpath="${filepath#$program_dir/}"
  local parent_dir=$(dirname "$relpath")

  # Check if this file is inside a Season folder
  # Match "Season *" or "S[0-9]*" at the start of the relative path
  local season_match=$(echo "$parent_dir" | grep -oP '^(Season [^/]+|S[0-9][0-9]? [^/]*)' || true)

  if [ -n "$season_match" ]; then
    echo "$program_dir/$season_match/docs"
  else
    echo "$program_dir/docs"
  fi
}

# Track used names per target directory to handle collisions
declare -A used_names

while IFS= read -r -d '' pdf; do
  filename=$(basename "$pdf")

  # Skip dot files (already handled)
  if [[ "$filename" == ._* ]]; then
    continue
  fi

  # Determine which program this belongs to
  local_path="${pdf#$BASE/}"
  program_name="${local_path%%/*}"
  program_dir="$BASE/$program_name"

  # Determine target docs/ directory
  target_dir=$(determine_target_dir "$pdf" "$program_dir")

  # Already in the right place?
  current_dir=$(dirname "$pdf")
  if [ "$current_dir" = "$target_dir" ]; then
    # Check if already well-named (starts with a category prefix)
    if echo "$filename" | grep -qE '^(calendar|nutrition|guide|worksheet|reference)-'; then
      skipped=$((skipped + 1))
      if $VERBOSE; then
        echo "  SKIP (already organized) $pdf"
      fi
      continue
    fi
  fi

  # Categorize
  lower_filename=$(echo "$filename" | tr '[:upper:]' '[:lower:]')
  category=$(categorize "$lower_filename")

  # Clean the descriptive name
  cleaned=$(clean_name "$filename")

  # Remove the category word from the cleaned name if it starts with it
  # e.g. "calendar-workout-calendar" → "calendar-workout"
  cleaned=$(echo "$cleaned" | sed -E "s/^${category}-//")

  # Build final name
  new_name="${category}-${cleaned}.pdf"

  # Handle collisions
  target_path="$target_dir/$new_name"
  collision_key="$target_dir/$new_name"
  if [ -n "${used_names[$collision_key]+x}" ]; then
    counter=2
    while [ -n "${used_names[$target_dir/${category}-${cleaned}-${counter}.pdf]+x}" ]; do
      counter=$((counter + 1))
    done
    new_name="${category}-${cleaned}-${counter}.pdf"
    target_path="$target_dir/$new_name"
    collision_key="$target_path"
    collisions=$((collisions + 1))
  fi
  used_names[$collision_key]=1

  # Output the move
  source_rel="${pdf#$BASE/}"
  target_rel="${target_path#$BASE/}"
  echo "  $source_rel"
  echo "    → $target_rel"

  if ! $DRY_RUN; then
    mkdir -p "$target_dir"
    mv "$pdf" "$target_path"
  fi
  moved=$((moved + 1))

done < <(find "$BASE" -name "*.pdf" -type f -print0 2>/dev/null | sort -z)

echo ""

# --- Phase 3: Clean up empty source directories ---
echo "--- Phase 3: Cleaning empty directories ---"
# Target known doc-folder names; rmdir only removes if empty
doc_folder_patterns=("_Docs" "_docs" "docs" "Documents" "_Documentation" "PDFs" "pdf" "_PDF" "TSS PDFs" "Insanity Documents")
for pattern in "${doc_folder_patterns[@]}"; do
  while IFS= read -r -d '' emptydir; do
    # Only remove if truly empty
    if [ -z "$(ls -A "$emptydir" 2>/dev/null)" ]; then
      dirs_cleaned=$((dirs_cleaned + 1))
      if $DRY_RUN; then
        echo "  RMDIR $emptydir"
      else
        rmdir "$emptydir" 2>/dev/null || true
      fi
    fi
  done < <(find "$BASE" -type d -name "$pattern" -print0 2>/dev/null)
done
echo "  Empty dirs: $dirs_cleaned"
echo ""

# --- Summary ---
echo "=== Summary ==="
echo "  PDFs moved/renamed: $moved"
echo "  Name collisions resolved: $collisions"
echo "  Dot files deleted: $dotfiles_deleted"
echo "  Empty dirs cleaned: $dirs_cleaned"
echo "  Already organized (skipped): $skipped"
if $DRY_RUN; then
  echo ""
  echo "This was a DRY RUN. Pass --execute to apply changes."
fi
```

**Step 2: Make the script executable**

Run: `chmod +x cli/scripts/organize-fitness-pdfs.sh`

**Step 3: Commit**

```
git add cli/scripts/organize-fitness-pdfs.sh
git commit -m "feat(cli): add fitness PDF organization script (dry-run)"
```

---

### Task 2: Copy script into Plex container and run dry-run

**Step 1: Copy the script into the container**

Run: `docker cp cli/scripts/organize-fitness-pdfs.sh plex:/tmp/organize-fitness-pdfs.sh`

**Step 2: Run dry-run**

Run: `docker exec plex bash /tmp/organize-fitness-pdfs.sh 2>&1 | tee /tmp/pdf-dryrun-output.txt`

Expected: A long list of `source → destination` moves, summary stats at the end, no files changed.

**Step 3: Review the output**

Run: `tail -20 /tmp/pdf-dryrun-output.txt` to check the summary.

Scan for problems:
- Names that are just `reference-document.pdf` (cleanup stripped too much)
- Category mismatches (a calendar categorized as guide, etc.)
- Overly long names
- Collisions that seem wrong (same PDF shouldn't be in the same target dir twice unless truly duplicated)

**Step 4: Save dry-run output for reference**

Run: `cp /tmp/pdf-dryrun-output.txt docs/notes/2026-02-27-pdf-dryrun-output.txt`

**Step 5: Commit dry-run output**

```
git add docs/notes/2026-02-27-pdf-dryrun-output.txt
git commit -m "docs: save PDF organization dry-run output for review"
```

---

### Task 3: Fix issues found in dry-run review

**Files:**
- Modify: `cli/scripts/organize-fitness-pdfs.sh`

**Step 1: Review dry-run output for pattern issues**

Look at the dry-run output and fix any issues in the `categorize()`, `clean_name()`, or `determine_target_dir()` functions. Common issues to watch for:

- Program code prefixes not being stripped (add patterns to `clean_name`)
- Wrong category assignment (adjust keyword lists in `categorize`)
- Season detection missing edge cases (the `S01 BodyShred` pattern uses `S[0-9]` not `Season`)
- Names reduced to empty string or single character

**Step 2: Re-run dry-run after fixes**

Run: `docker cp cli/scripts/organize-fitness-pdfs.sh plex:/tmp/organize-fitness-pdfs.sh && docker exec plex bash /tmp/organize-fitness-pdfs.sh 2>&1 | tee /tmp/pdf-dryrun-output-v2.txt`

**Step 3: Iterate until dry-run output looks clean**

Compare v1 vs v2: `diff /tmp/pdf-dryrun-output.txt /tmp/pdf-dryrun-output-v2.txt | head -60`

**Step 4: Commit fixes**

```
git add cli/scripts/organize-fitness-pdfs.sh
git commit -m "fix(cli): refine PDF naming rules based on dry-run review"
```

---

### Task 4: Execute the migration

**Step 1: Copy final script and execute**

Run:
```bash
docker cp cli/scripts/organize-fitness-pdfs.sh plex:/tmp/organize-fitness-pdfs.sh
docker exec plex bash /tmp/organize-fitness-pdfs.sh --execute 2>&1 | tee /tmp/pdf-execute-output.txt
```

Expected: Same output as dry-run but files are actually moved.

**Step 2: Verify a few programs look correct**

Run:
```bash
docker exec plex bash -c '
for prog in "P90X" "21 Day Fix" "Barre Blend" "DIG DEEPER" "P90X Generation Next"; do
  echo "=== $prog ==="
  find "/data/media/video/fitness/$prog" -name "*.pdf" -type f | sed "s|/data/media/video/fitness/$prog/||" | sort
  echo ""
done
'
```

Expected: All PDFs are in `docs/` (or `Season XX/docs/`), names start with category prefixes.

**Step 3: Verify no stray PDFs remain outside docs/ folders**

Run:
```bash
docker exec plex bash -c '
find /data/media/video/fitness -name "*.pdf" -type f | grep -v "/docs/" | head -20
'
```

Expected: Empty output (or only PDFs in programs we didn't target).

**Step 4: Verify no dot files remain**

Run: `docker exec plex find /data/media/video/fitness -name "._*.pdf" -type f | wc -l`

Expected: `0`

**Step 5: Save execution log**

Run: `cp /tmp/pdf-execute-output.txt docs/notes/2026-02-27-pdf-execute-output.txt`

**Step 6: Commit execution log and final script**

```
git add docs/notes/2026-02-27-pdf-execute-output.txt cli/scripts/organize-fitness-pdfs.sh
git commit -m "feat(cli): execute fitness PDF organization — 1664 PDFs consolidated"
```

---

### Task 5: Update the missing-PDFs note

**Files:**
- Modify: `docs/notes/2026-02-27-bodi-programs-missing-pdfs.md`

**Step 1: Add a note about the completed migration**

Add a line at the top: `**Migration completed:** 2026-02-27 — PDFs consolidated into `docs/` folders with category-prefixed names.`

**Step 2: Commit**

```
git add docs/notes/2026-02-27-bodi-programs-missing-pdfs.md
git commit -m "docs: mark PDF organization as completed"
```
