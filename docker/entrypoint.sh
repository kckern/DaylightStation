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
cd backend
forever index.js
