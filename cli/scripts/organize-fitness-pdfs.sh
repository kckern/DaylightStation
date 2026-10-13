#!/usr/bin/env bash
# Stable command entry; implementation belongs to Fitness.
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/../../__app_modules/wellness/fitness/cli/scripts/organize-fitness-pdfs.sh" "$@"
