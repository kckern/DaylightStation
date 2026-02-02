#!/bin/bash
# scripts/migrate-content-structure.sh
# Migrates content from old structure to new singing/narrated structure

set -e

DATA_PATH="${1:-/path/to/data}"
MEDIA_PATH="${2:-/path/to/media}"

echo "Migrating content structure..."
echo "DATA_PATH: $DATA_PATH"
echo "MEDIA_PATH: $MEDIA_PATH"

# Create new directories
mkdir -p "$DATA_PATH/content/singing"
mkdir -p "$DATA_PATH/content/narrated"
mkdir -p "$MEDIA_PATH/singing"
mkdir -p "$MEDIA_PATH/narrated"

# Move data files
echo "Moving data files..."

# songs → singing
if [ -d "$DATA_PATH/content/songs" ]; then
  mv "$DATA_PATH/content/songs/hymn" "$DATA_PATH/content/singing/" 2>/dev/null || true
  mv "$DATA_PATH/content/songs/primary" "$DATA_PATH/content/singing/" 2>/dev/null || true
fi

# scripture, poetry, talks → narrated
mv "$DATA_PATH/content/scripture" "$DATA_PATH/content/narrated/" 2>/dev/null || true
mv "$DATA_PATH/content/poetry" "$DATA_PATH/content/narrated/" 2>/dev/null || true
mv "$DATA_PATH/content/talks" "$DATA_PATH/content/narrated/" 2>/dev/null || true

# Move media files
echo "Moving media files..."

# audio/songs → singing
if [ -d "$MEDIA_PATH/audio/songs" ]; then
  mv "$MEDIA_PATH/audio/songs/hymn" "$MEDIA_PATH/singing/" 2>/dev/null || true
  mv "$MEDIA_PATH/audio/songs/primary" "$MEDIA_PATH/singing/" 2>/dev/null || true
fi

# audio/scripture, audio/poetry, video/talks → narrated
mv "$MEDIA_PATH/audio/scripture" "$MEDIA_PATH/narrated/" 2>/dev/null || true
mv "$MEDIA_PATH/audio/poetry" "$MEDIA_PATH/narrated/" 2>/dev/null || true
mv "$MEDIA_PATH/video/talks" "$MEDIA_PATH/narrated/" 2>/dev/null || true

echo "Migration complete!"
echo ""
echo "Old directories can be removed after verification:"
echo "  $DATA_PATH/content/songs"
echo "  $DATA_PATH/content/scripture"
echo "  $DATA_PATH/content/poetry"
echo "  $DATA_PATH/content/talks"
