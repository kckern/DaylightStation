#!/usr/bin/env bash
# Stable command entry; implementation belongs to Fitness.
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/../../modules/fitness/cli/scripts/organize-fitness-pdfs.sh" "$@"
