#!/usr/bin/env bash
# scripts/school/seed-word-package.sh <seed-dir>
#
# Install a card-ladder seed package (any language) into the running
# container's data and media volumes. CONTROLLER-ONLY, and only AFTER the
# card-ladder code that reads school.word-lexicon/v2 is deployed.
#
# A seed dir holds:
#   lexicon.yml                 the package lexicon (school.word-lexicon/v2)
#   <deck>.yml ...              one or more lexicon decks (lexicon: media:<pkg dir>/lexicon.yml)
#   media-readme-section.md     optional; appended once to media/school/README.md
# Everything is derived from those files — nothing here names a language:
#   package      the lexicon's `package`
#   package dir  from each deck's `lexicon: media:<dir>/lexicon.yml` (all decks must agree)
#   deck path    data/content/school/learning-catalog/flashcard-decks/<deck id>.yml
#   placeholders <package dir>/words/<group>/<id>/{image.jpg,term.mp3,gloss.mp3}
#
# Idempotent and non-destructive:
#   - lexicon/deck: written when absent; skipped when byte-identical; a
#     DIFFERENT existing file is a conflict (exit 1) — never overwritten.
#   - placeholders: created only where no file exists (a real image or mp3 is
#     never touched).
#   - media README: the section is appended once (matched by its first heading).
# Nothing is ever removed.
#
# DRY_RUN=1 prints the resolved package, paths and placeholder list and
# touches nothing (no docker).
set -euo pipefail
if [ $# -ne 1 ] || [ ! -f "$1/lexicon.yml" ]; then
  echo "usage: $0 <seed-dir containing lexicon.yml and deck .yml files>" >&2
  exit 2
fi
C="${CONTAINER:-daylight-station}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEED="$(cd "$1" && pwd)"
DECK_ROOT="data/content/school/learning-catalog/flashcard-decks"

# Parse the seed with the repo's own YAML reader; emit one tab-separated
# record per line: package / deck <file> <id> / word <group> <id>.
PLAN="$(cd "$ROOT" && SEED="$SEED" node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DECK_ID = /^[a-z0-9][a-z0-9/_-]*$/;
const seed = process.env.SEED;
const fail = (message) => { console.error(message); process.exit(1); };
const lexicon = yaml.load(fs.readFileSync(path.join(seed, "lexicon.yml"), "utf8"));
if (lexicon?.schema !== "school.word-lexicon/v2") fail("lexicon.yml must be school.word-lexicon/v2");
if (!SLUG.test(lexicon.package ?? "")) fail("lexicon.yml: package must be a lowercase slug");
const decks = fs.readdirSync(seed).filter((name) => name.endsWith(".yml") && name !== "lexicon.yml").sort();
if (!decks.length) fail("no deck .yml files in the seed dir");
const dirs = new Set();
const out = [];
for (const name of decks) {
  const deck = yaml.load(fs.readFileSync(path.join(seed, name), "utf8"));
  const match = /^media:(.+)\/lexicon\.yml$/.exec(deck?.lexicon ?? "");
  if (!match || match[1].split("/").some((s) => !s || s === "." || s === "..")) fail(`${name}: lexicon must be media:<dir>/lexicon.yml`);
  if (!DECK_ID.test(deck.id ?? "") || deck.id.split("/").includes("..")) fail(`${name}: bad deck id`);
  dirs.add(match[1]);
  out.push(["deck", name, deck.id].join("\t"));
}
if (dirs.size !== 1) fail(`decks disagree on the lexicon: ${[...dirs].join(", ")}`);
for (const entry of lexicon.entries ?? []) {
  if (!SLUG.test(entry?.id ?? "") || !SLUG.test(entry?.group ?? "")) fail(`entry ${entry?.id}: id and group must be slugs`);
  out.push(["word", entry.group, entry.id].join("\t"));
}
console.log(["package", lexicon.package, [...dirs][0]].join("\t"));
console.log(out.join("\n"));
')"

PACKAGE="$(printf '%s\n' "$PLAN" | awk -F'\t' '$1=="package"{print $2}')"
PKG="media/school/$(printf '%s\n' "$PLAN" | awk -F'\t' '$1=="package"{print $3}')"
WORDS="$(printf '%s\n' "$PLAN" | awk -F'\t' '$1=="word"{print $2"/"$3}')"
echo "package: $PACKAGE  →  $PKG"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "lexicon: $SEED/lexicon.yml -> $PKG/lexicon.yml"
  printf '%s\n' "$PLAN" | awk -F'\t' -v root="$DECK_ROOT" '$1=="deck"{print "deck: "$2" -> "root"/"$3".yml"}'
  for w in $WORDS; do echo "placeholders: $PKG/words/$w/{image.jpg,term.mp3,gloss.mp3}"; done
  exit 0
fi

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
while IFS=$'\t' read -r kind file id; do
  [ "$kind" = "deck" ] || continue
  put "$SEED/$file" "$DECK_ROOT/$id.yml"
done <<< "$PLAN"

for w in $WORDS; do
  dx "d='$PKG/words/$w'; mkdir -p \"\$d\"; for f in image.jpg term.mp3 gloss.mp3; do [ -e \"\$d/\$f\" ] || : > \"\$d/\$f\"; done"
done
echo "placeholders ensured for $(echo "$WORDS" | wc -w) words"

if [ -f "$SEED/media-readme-section.md" ]; then
  HEADING="$(grep -m1 '^## ' "$SEED/media-readme-section.md")"
  if dx "grep -qxF '$HEADING' media/school/README.md"; then
    echo "unchanged: media/school/README.md"
  else
    b64="$(base64 -w0 "$SEED/media-readme-section.md")"
    dx "echo '$b64' | base64 -d | grep -v '^<!--' >> media/school/README.md"
    echo "appended: media/school/README.md"
  fi
fi

dx "chown -R node:node '$PKG' '$DECK_ROOT' media/school/README.md"
dx "ls -la '$PKG'; find '$PKG/words' -type f | wc -l"
