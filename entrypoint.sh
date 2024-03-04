#!/bin/sh
cd /usr/src/app/
chown node:node host_private_key known_hosts
chmod 400 host_private_key
forever backend/index.js