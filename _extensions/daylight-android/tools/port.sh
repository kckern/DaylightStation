#!/usr/bin/env bash
# port.sh <move|adapt> <source.java> <dest-dir> <new.package> [Old=New ...]
#
# Copies one Java file from an old helper project, rewrites its package line,
# applies whole-word class renames, and records the pair in tools/port-map.tsv.
# A rename whose Old equals the file's class name also renames the file.
# Paths are relative to the repo root.
set -euo pipefail
mode="$1"; src="$2"; dest="$3"; pkg="$4"; shift 4
root="$(git rev-parse --show-toplevel)"
name="$(basename "$src" .java)"
for r in "$@"; do [ "${r%%=*}" = "$name" ] && name="${r#*=}"; done
mkdir -p "$root/$dest"
out="$root/$dest/$name.java"
cp "$root/$src" "$out"
perl -pi -e "s/^package [\\w.]+;/package $pkg;/" "$out"
for r in "$@"; do perl -pi -e "s/\\b\\Q${r%%=*}\\E\\b/${r#*=}/g" "$out"; done
printf '%s\t%s\t%s\t%s\n' "$mode" "$src" "$dest/$name.java" "$*" \
  >> "$root/_extensions/daylight-android/tools/port-map.tsv"
echo "ported $(basename "$src") -> $dest/$name.java ($mode)"
