#!/bin/bash
# Paperless post-consumption script
# Copies processed documents to Dropbox/Documents/YYYY/ archive
#
# Paperless sets these env vars:
#   DOCUMENT_ID, DOCUMENT_FILENAME, DOCUMENT_CREATED, DOCUMENT_ADDED

DOCS_ROOT="/data/Documents"

# Use document date if available, otherwise added date, otherwise today
if [ -n "$DOCUMENT_CREATED" ]; then
  YEAR=$(date -d "$DOCUMENT_CREATED" +%Y 2>/dev/null || echo "$(date +%Y)")
else
  YEAR=$(date +%Y)
fi

DEST="${DOCS_ROOT}/${YEAR}/"
mkdir -p "$DEST"

# The filename from Paperless is the full path to the archived file
if [ -f "$DOCUMENT_FILENAME" ]; then
  cp "$DOCUMENT_FILENAME" "$DEST"
  echo "Copied $(basename "$DOCUMENT_FILENAME") → ${DEST}"
else
  echo "ERROR: File not found: $DOCUMENT_FILENAME" >&2
  exit 1
fi
