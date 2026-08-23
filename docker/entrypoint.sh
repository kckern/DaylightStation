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

# Provision ADB keys from persistent data volume (survives container rebuilds).
# ADB server runs as root, so keys go to /root/.android/.
# Also provision for the node user in case ADB is invoked from the app process.
ADB_KEY_SRC="/usr/src/app/data/system/config/adb"
if [ -f "$ADB_KEY_SRC/adbkey" ]; then
    for ADB_KEY_DST in /root/.android /home/node/.android; do
        mkdir -p "$ADB_KEY_DST"
        cp "$ADB_KEY_SRC/adbkey" "$ADB_KEY_DST/adbkey"
        cp "$ADB_KEY_SRC/adbkey.pub" "$ADB_KEY_DST/adbkey.pub"
        chmod 600 "$ADB_KEY_DST/adbkey"
    done
    chown -R node:node /home/node/.android
    echo "ADB keys provisioned from data/system/config/adb"
fi

# Provision piano-bridge payload jars from the persistent data volume. The
# hosted path /payloads/* is served from frontend/dist, which is baked into the
# image — every rebuild WIPES it (bit us twice on 2026-08-23, mid-deploy). The
# durable copies live in data/system/payloads/; restore them on every start so
# the tablet's payload URLs never dangle after a redeploy.
PAYLOAD_SRC="/usr/src/app/data/system/payloads"
if [ -d "$PAYLOAD_SRC" ]; then
    mkdir -p /usr/src/app/frontend/dist/payloads
    cp "$PAYLOAD_SRC"/*.jar /usr/src/app/frontend/dist/payloads/ 2>/dev/null || true
    echo "[Entrypoint] Piano-bridge payloads restored: $(ls /usr/src/app/frontend/dist/payloads 2>/dev/null | wc -l) jar(s)"
fi

# Fix data volume ownership (handles Dropbox drift, manual edits)
if [ -d "/usr/src/app/data" ]; then
    BAD_FILES=$(find /usr/src/app/data -not -user node 2>/dev/null | head -1)
    if [ -n "$BAD_FILES" ]; then
        echo "[Entrypoint] Fixing data directory ownership..."
        find /usr/src/app/data -not -user node -exec chown node:node {} +
        echo "[Entrypoint] Ownership fix complete"
    else
        echo "[Entrypoint] Data directory ownership OK"
    fi
fi

# Fix media volume ownership
if [ -d "/usr/src/app/media" ]; then
    BAD_FILES=$(find /usr/src/app/media -not -user node 2>/dev/null | head -1)
    if [ -n "$BAD_FILES" ]; then
        echo "[Entrypoint] Fixing media directory ownership..."
        find /usr/src/app/media -not -user node -exec chown node:node {} +
        echo "[Entrypoint] Media ownership fix complete"
    else
        echo "[Entrypoint] Media directory ownership OK"
    fi
fi

# Drop privileges and start app
cd backend
exec su-exec node forever index.js
