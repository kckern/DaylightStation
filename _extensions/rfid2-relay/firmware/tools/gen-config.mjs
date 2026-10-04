#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
if (!source) {
  console.error('usage: node tools/gen-config.mjs <private-device.yml>');
  process.exit(2);
}
const config = yaml.load(readFileSync(source, 'utf8')) || {};
const id = String(config.device?.id || '');
const ssid = String(config.provisioning?.wifi_ssid || '');
const wifiPassword = String(config.provisioning?.wifi_password || '');
const otaPassword = String(config.ota?.password || '');
if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(id)) throw new Error('device.id must be a DNS-safe name');
if (!ssid || !wifiPassword) throw new Error('provisioning.wifi_ssid and wifi_password are required');
if (config.ota?.enabled !== true || !otaPassword) throw new Error('authenticated OTA must be enabled with a password');
const output = process.env.DAYLIGHT_CONFIG_OUT || path.join(here, '..', 'include', 'config.h');
const header = `// Generated from private configuration. Do not commit or share this file.\n#pragma once\n#define DEVICE_ID ${JSON.stringify(id)}\n#define WIFI_SSID ${JSON.stringify(ssid)}\n#define WIFI_PASSWORD ${JSON.stringify(wifiPassword)}\n#define OTA_ENABLED 1\n#define OTA_PASSWORD ${JSON.stringify(otaPassword)}\n`;
writeFileSync(output, header, { mode: 0o600 });
console.log(`[gen-config] ${id}: private header generated`);
