#!/bin/sh

# Configure DaylightStation environment
# PWD is set by Dockerfile WORKDIR directive (/usr/src/app)
export DAYLIGHT_BASE_PATH="${PWD}"
export DAYLIGHT_ENV="docker"

# Set Timezone from system.yml if not overriden by env
if [ -f "/usr/src/app/config/system.yml" ]; then
    FILE_TZ=$(yq '.timezone' /usr/src/app/config/system.yml)
    if [ ! -z "$FILE_TZ" ] && [ "$FILE_TZ" != "null" ]; then
        export TZ="$FILE_TZ"
        echo "Timezone configured from system.yml: $TZ"
    fi
fi

cd /usr/src/app/
chown node:node host_private_key known_hosts
chmod 400 host_private_key

# Provision ADB keys from persistent data mount (survives container rebuilds)
ADB_KEY_SRC="/usr/src/app/data/system/adb-keys"
ADB_KEY_DST="/home/node/.android"
if [ -f "$ADB_KEY_SRC/adbkey" ]; then
    mkdir -p "$ADB_KEY_DST"
    cp "$ADB_KEY_SRC/adbkey" "$ADB_KEY_DST/adbkey"
    cp "$ADB_KEY_SRC/adbkey.pub" "$ADB_KEY_DST/adbkey.pub"
    chown node:node "$ADB_KEY_DST/adbkey" "$ADB_KEY_DST/adbkey.pub"
    chmod 600 "$ADB_KEY_DST/adbkey"
    echo "ADB keys provisioned from data mount"
fi

cd backend
forever index.js
