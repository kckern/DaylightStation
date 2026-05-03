#!/bin/sh
# Install /usr/local/bin/dscli that wraps `docker exec daylight-station ...`.
# Run with: sudo sh cli/install-host-wrapper.sh
#
# After installation, `dscli` is callable from anywhere on the host:
#   dscli system health
#   dscli ha state light.office_main

set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: this script must be run as root (sudo)." >&2
  exit 1
fi

WRAPPER_PATH="/usr/local/bin/dscli"
TEMPLATE_PATH="$(dirname "$0")/host-wrapper-template.sh"

if [ ! -f "$TEMPLATE_PATH" ]; then
  echo "Error: template not found at $TEMPLATE_PATH" >&2
  exit 1
fi

if [ -e "$WRAPPER_PATH" ]; then
  echo "Note: $WRAPPER_PATH already exists. Overwriting."
fi

cp "$TEMPLATE_PATH" "$WRAPPER_PATH"
chmod +x "$WRAPPER_PATH"

echo "Installed: $WRAPPER_PATH"
echo "Test with: dscli --help"
