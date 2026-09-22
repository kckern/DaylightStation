#!/usr/bin/env bash
# scripts/school/seed-korean-vocab.sh
#
# Install the Korean word-ladder seed package into the running container's
# data and media volumes. CONTROLLER-ONLY, and only AFTER the word-ladder code
# is deployed (older code would list a card-less deck).
#
# Idempotent and non-destructive:
#   - lexicon/deck: written when absent; skipped when byte-identical; a
#     DIFFERENT existing file is a conflict (exit 1) — never overwritten.
#   - placeholders: created only where no file exists (a real image or mp3 is
#     never touched).
#   - media README: the word-package section is appended once.
# Nothing is ever removed.
set -euo pipefail
C="${CONTAINER:-daylight-station}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEED="$ROOT/content/seeds/school/korean-vocab"
PKG="media/school/language/korean-vocab"
DECK_DIR="data/content/school/learning-catalog/flashcard-decks/language/korean"
dx() { sudo docker exec "$C" sh -c "$1"; }

put() { # put <local file> <container path>
  local src="$1" dst="$2" want have b64
  want="$(sha256sum "$src" | cut -d' ' -f1)"
  have="$(dx "[ -f '$dst' ] && sha256sum '$dst' | cut -d' ' -f1 || true")"
  if [ "$have" = "$want" ]; then echo "unchanged: $dst"; return 0; fi
  if [ -n "$have" ]; then echo "CONFLICT: $dst differs from $src — not overwriting" >&2; return 1; fi
  b64="$(base64 -w0 "$src")"
  dx "mkdir -p \"\$(dirname '$dst')\" && echo '$b64' | base64 -d > '$dst'"
  echo "installed: $dst"
}

put "$SEED/lexicon.yml" "$PKG/lexicon.yml"
put "$SEED/week-01-classroom.yml" "$DECK_DIR/week-01-classroom.yml"

IDS="$(grep -E '^  - id: ' "$SEED/lexicon.yml" | sed 's/^  - id: //')"
for id in $IDS; do
  dx "d='$PKG/words/$id'; mkdir -p \"\$d\"; for f in image.jpg ko.mp3 en.mp3; do [ -e \"\$d/\$f\" ] || : > \"\$d/\$f\"; done"
done
echo "placeholders ensured for $(echo "$IDS" | wc -w) words"

if dx "grep -q '^## Generated-media word packages' media/school/README.md"; then
  echo "unchanged: media/school/README.md"
else
  b64="$(base64 -w0 "$SEED/media-readme-section.md")"
  dx "echo '$b64' | base64 -d | grep -v '^<!--' >> media/school/README.md"
  echo "appended: media/school/README.md"
fi

dx "chown -R node:node '$PKG' data/content/school/learning-catalog media/school/README.md"
dx "ls -la '$PKG' '$DECK_DIR'; find '$PKG/words' -type f | wc -l"
