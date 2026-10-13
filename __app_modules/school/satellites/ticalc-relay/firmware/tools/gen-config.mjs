#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

const defaultOut = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'include', 'config.h');
const src = process.argv[2] || process.env.DAYLIGHT_TICALC_CONFIG;
if (!src) { console.error('ERROR: pass ticalc-relay.yml or set DAYLIGHT_TICALC_CONFIG'); process.exit(1); }
const cfg = yaml.load(readFileSync(src, 'utf8')) || {};
const relayId = process.argv[3] || Object.keys(cfg.relays || {})[0];
const out = process.argv[4] ? path.resolve(process.argv[4]) : defaultOut;
const relay = cfg.relays?.[relayId];
if (!relay) { console.error(`ERROR: relay id "${relayId}" not found`); process.exit(1); }
const p = cfg.provisioning || {}, b = cfg.backend || {};
const required = {
  'provisioning.wifi_ssid': p.wifi_ssid,
  'provisioning.wifi_password': p.wifi_password,
  'backend.host': b.host,
  'backend.port': b.port,
  [`relays.${relayId}.api_token`]: relay.api_token,
};
const missing = Object.entries(required).filter(([, v]) => v === undefined || v === '').map(([k]) => k);
if (missing.length) { console.error(`ERROR: ${src} missing: ${missing.join(', ')}`); process.exit(1); }
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(relayId)) {
  console.error(`ERROR: relay id "${relayId}" is invalid`); process.exit(1);
}
if (Buffer.byteLength(String(relay.api_token), 'utf8') < 32 || /[\u0000-\u001f\u007f]/.test(relay.api_token)) {
  console.error(`ERROR: relays.${relayId}.api_token must be at least 32 bytes with no control characters`); process.exit(1);
}
if ((b.scheme || 'http') !== 'http') {
  console.error('ERROR: this firmware build supports backend.scheme: http on the trusted LAN; TLS needs an explicit trust anchor'); process.exit(1);
}
const esc = v => String(v)
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\r/g, '\\r')
  .replace(/\n/g, '\\n')
  .replace(/\t/g, '\\t');
const n = (key, fallback) => Number.isInteger(relay[key]) ? relay[key] : fallback;
const link = relay.link || {};
const plugDetectPin = link.plug_detect_pin ?? -1;
if (!Number.isInteger(plugDetectPin) || plugDetectPin < -1 || plugDetectPin > 39) {
  console.error(`ERROR: relays.${relayId}.link.plug_detect_pin must be -1 or an ESP32 GPIO 0..39`);
  process.exit(1);
}
if ([n('tip_sense_pin', 32), n('tip_sink_pin', 25), n('ring_sense_pin', 33),
  n('ring_sink_pin', 26), 27].includes(plugDetectPin)) {
  console.error(`ERROR: relays.${relayId}.link.plug_detect_pin conflicts with an assigned TI or LED pin`);
  process.exit(1);
}
const plugDetectActiveHigh = link.plug_detect_active_high !== false;
const keyboard = relay.input?.ble_keyboard || {};
const keyboardEnabled = keyboard.enabled === true;
const keyboardAddress = String(keyboard.address || '').toUpperCase();
if (keyboardEnabled && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(keyboardAddress)) {
  console.error(`ERROR: relays.${relayId}.input.ble_keyboard.address must be a canonical Bluetooth identity address`);
  process.exit(1);
}
const keyboardAddressType = keyboard.address_type || 'public';
if (!['public', 'random'].includes(keyboardAddressType)) {
  console.error(`ERROR: relays.${relayId}.input.ble_keyboard.address_type must be public or random`);
  process.exit(1);
}
const pairingWindowMs = keyboard.pairing_window_ms ?? 60000;
if (!Number.isInteger(pairingWindowMs) || pairingWindowMs < 15000 || pairingWindowMs > 300000) {
  console.error(`ERROR: relays.${relayId}.input.ble_keyboard.pairing_window_ms must be 15000..300000`);
  process.exit(1);
}
const requireMitm = keyboard.require_mitm !== false;
const effectiveNonSecretConfig = {
  relay_id: relayId,
  relay_label: relay.label || relayId,
  backend: {
    scheme: b.scheme || 'http', host: b.host, port: Number.parseInt(b.port, 10),
    ws_path: b.ws_path || '/ws',
    api_base_path: b.api_base_path || '/api/v1/school/calc',
  },
  link: {
    tip_sense_pin: n('tip_sense_pin', 32), tip_sink_pin: n('tip_sink_pin', 25),
    ring_sense_pin: n('ring_sense_pin', 33), ring_sink_pin: n('ring_sink_pin', 26),
    plug_detect_pin: plugDetectPin, plug_detect_active_high: plugDetectActiveHigh,
    transmit_enabled: link.transmit_enabled === true,
    foreground_listener: link.foreground_listener !== false,
    auto_sync: link.auto_sync === true,
  },
  ble_keyboard: {
    enabled: keyboardEnabled, address: keyboardAddress,
    address_type: keyboardAddressType, label: keyboard.label || '',
    pairing_window_ms: pairingWindowMs, require_mitm: requireMitm,
  },
};
const fingerprint = createHash('sha256')
  .update(JSON.stringify(effectiveNonSecretConfig))
  .digest('hex')
  .slice(0, 16);
const h = `// GENERATED — do not commit. Source: ${path.basename(src)} (${relayId})\n#pragma once\n#define WIFI_SSID "${esc(p.wifi_ssid)}"\n#define WIFI_PASSWORD "${esc(p.wifi_password)}"\n#define BACKEND_HOST "${esc(b.host)}"\n#define BACKEND_PORT ${Number.parseInt(b.port, 10)}\n#define BACKEND_SCHEME "${esc(b.scheme || 'http')}"\n#define WS_PATH "${esc(b.ws_path || '/ws')}"\n#define API_BASE_PATH "${esc(b.api_base_path || '/api/v1/school/calc')}"\n#define API_TOKEN "${esc(relay.api_token)}"\n#define RELAY_ID "${esc(relayId)}"\n#define RELAY_LABEL "${esc(relay.label || relayId)}"\n#define FIRMWARE_CONFIG_FINGERPRINT "${fingerprint}"\n#define TIP_SENSE_PIN ${n('tip_sense_pin', 32)}\n#define TIP_SINK_PIN ${n('tip_sink_pin', 25)}\n#define RING_SENSE_PIN ${n('ring_sense_pin', 33)}\n#define RING_SINK_PIN ${n('ring_sink_pin', 26)}\n#define LED_PIN 27\n#define PLUG_DETECT_PIN ${plugDetectPin}\n#define PLUG_DETECT_ACTIVE_HIGH ${plugDetectActiveHigh ? 1 : 0}\n#define TI_TRANSMIT_ENABLED ${link.transmit_enabled === true ? 1 : 0}\n#define FOREGROUND_LISTENER_ENABLED ${link.foreground_listener === false ? 0 : 1}\n#define AUTO_SYNC_ENABLED ${link.auto_sync === true ? 1 : 0}\n#define BLE_KEYBOARD_ENABLED ${keyboardEnabled ? 1 : 0}\n#define BLE_KEYBOARD_ADDRESS "${esc(keyboardAddress)}"\n#define BLE_KEYBOARD_ADDRESS_TYPE ${keyboardAddressType === 'random' ? 1 : 0}\n#define BLE_KEYBOARD_LABEL "${esc(keyboard.label || '')}"\n#define BLE_KEYBOARD_PAIRING_WINDOW_MS ${pairingWindowMs}\n#define BLE_KEYBOARD_REQUIRE_MITM ${requireMitm ? 1 : 0}\n`;
writeFileSync(out, h, { mode: 0o600 });
console.log(`[gen-config] ${src} (relay=${relayId}) -> ${out}`);
