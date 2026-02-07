#!/bin/bash
# scripts/migrate-content-structure.sh
# Migrates content from old structure to new singalong/readalong structure

set -e

DATA_PATH="${1:-/path/to/data}"
MEDIA_PATH="${2:-/path/to/media}"

echo "Migrating content structure..."
echo "DATA_PATH: $DATA_PATH"
echo "MEDIA_PATH: $MEDIA_PATH"

# Create new directories
mkdir -p "$DATA_PATH/content/singalong"
mkdir -p "$DATA_PATH/content/readalong"
mkdir -p "$MEDIA_PATH/audio/singalong"
mkdir -p "$MEDIA_PATH/audio/readalong"
mkdir -p "$MEDIA_PATH/video/readalong"

# Move data files
echo "Moving data files..."

# singing → singalong (legacy)
if [ -d "$DATA_PATH/content/singing" ]; then
  mv "$DATA_PATH/content/singing/"* "$DATA_PATH/content/singalong/" 2>/dev/null || true
fi

# narrated → readalong (legacy)
if [ -d "$DATA_PATH/content/narrated" ]; then
  mv "$DATA_PATH/content/narrated/"* "$DATA_PATH/content/readalong/" 2>/dev/null || true
fi

# scripture, poetry, talks → readalong
mv "$DATA_PATH/content/scripture" "$DATA_PATH/content/readalong/" 2>/dev/null || true
mv "$DATA_PATH/content/poetry" "$DATA_PATH/content/readalong/" 2>/dev/null || true
mv "$DATA_PATH/content/talks" "$DATA_PATH/content/readalong/" 2>/dev/null || true

# Move media files
echo "Moving media files..."

# singing → audio/singalong (legacy)
if [ -d "$MEDIA_PATH/singing" ]; then
  mv "$MEDIA_PATH/singing/"* "$MEDIA_PATH/audio/singalong/" 2>/dev/null || true
fi

# narrated → audio/readalong (legacy)
if [ -d "$MEDIA_PATH/narrated" ]; then
  mv "$MEDIA_PATH/narrated/"* "$MEDIA_PATH/audio/readalong/" 2>/dev/null || true
fi

# audio/scripture, audio/poetry → audio/readalong
mv "$MEDIA_PATH/audio/scripture" "$MEDIA_PATH/audio/readalong/" 2>/dev/null || true
mv "$MEDIA_PATH/audio/poetry" "$MEDIA_PATH/audio/readalong/" 2>/dev/null || true
# talks video → video/readalong/talks
mv "$MEDIA_PATH/video/talks" "$MEDIA_PATH/video/readalong/" 2>/dev/null || true

echo "Migration complete!"
echo ""
echo "Old directories can be removed after verification:"
echo "  $DATA_PATH/content/singing"
echo "  $DATA_PATH/content/narrated"
echo "  $DATA_PATH/content/scripture"
echo "  $DATA_PATH/content/poetry"
echo "  $DATA_PATH/content/talks"
echo "  $MEDIA_PATH/singing"
echo "  $MEDIA_PATH/narrated"
echo "  $MEDIA_PATH/audio/scripture"
echo "  $MEDIA_PATH/audio/poetry"
echo "  $MEDIA_PATH/video/talks"
