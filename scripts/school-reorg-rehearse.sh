#!/usr/bin/env bash
# Rehearse the school content reorganization on a throwaway copy of the data
# tree. Proves the target layout validates BEFORE production is touched.
#
#   ./scripts/school-reorg-rehearse.sh /tmp/reorg-fixture
set -euo pipefail

SRC="${SRC:-/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data}"
DEST="${1:?usage: school-reorg-rehearse.sh <fixture-dir>}"

rm -rf "$DEST"
mkdir -p "$DEST/content" "$DEST/household/apps" "$DEST/household/config"
cp -r "$SRC/content/school" "$DEST/content/school"
cp -r "$SRC/household/apps/school" "$DEST/household/apps/school"

S="$DEST/content/school"
C="$S/curriculum"
STAGE="$DEST/content/_staging/school"
mkdir -p "$STAGE"

# 1. Conforming courses to root shelves.
mkdir -p "$S/civilization" "$S/science"
mv "$C/civilization/young-peoples-atlas-us" "$S/civilization/"
mv "$C/science/the-elements-ted-gray"       "$S/science/"

# 2. Quizzes era and the unfinished Big Fat Notebook courses to staging.
mv "$C/english/shakespeare-tales" "$STAGE/"
find "$C" -maxdepth 2 -type d -name 'big-fat-notebook-*' -exec mv {} "$STAGE/" \;

# 3. The July import to staging.
mv "$C/_inbox" "$STAGE/_inbox"

# 4. Print artifacts to the household app tree.
mv "$S/print-documents" "$DEST/household/apps/school/print-documents"

# 5. Split the catalog shelf by lifecycle.
mkdir -p "$DEST/household/config/school"
mv "$S/catalog/surfaces"    "$DEST/household/config/school/surfaces"
mv "$S/catalog/ti86-packs"  "$DEST/household/apps/school/ti86-packs"
mv "$S/catalog"             "$S/learning-catalog"

# 6. Retire the emptied scaffolding.
find "$C" -type d -empty -delete 2>/dev/null || true
rmdir "$C" 2>/dev/null || true

echo "--- resulting content/school ---"
ls -1 "$S"
