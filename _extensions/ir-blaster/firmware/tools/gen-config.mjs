#!/usr/bin/env node
// =============================================================================
// gen-config.mjs — generate firmware include/config.h from the household SSOT
// (data/household/config/ir-blasters.yml). Keeps Wi-Fi creds + instance values
// OUT of the repo: the output config.h is gitignored.
//
// Each named IR code in the SSOT is stored as a Tuya-format base64 string (the
// same encoding the office HA scripts write into the ESPHome IR-blaster text
// entity). Tuya = base64 → FastLZ-compressed → array of uint16 LE microsecond
// durations (mark, space, mark, …). We decode host-side and emit the raw
// duration arrays, so the firmware just replays them via IRsend.sendRaw — no
// decompression on the MCU.
//
// A code value may also be a raw array of integers (µs durations), which is
// emitted verbatim. That's the "config-driven, no reflash-of-format" escape
// hatch for codes captured in some other tool.
//
// Usage:
//   node tools/gen-config.mjs <path-to>/config/ir-blasters.yml [blaster-id]
//   DAYLIGHT_IR_CONFIG=<path> node tools/gen-config.mjs [blaster-id]
//
// blaster-id defaults to the first key under `blasters:`.
// =============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'include', 'config.h');

// ---- Tuya IR decode: base64 → FastLZ-decompress → uint16 LE µs durations ----
function fastlzDecompress(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const h = data[i++];
    const L = h >> 5;          // top 3 bits: 0 = literal run, else back-reference
    const D = h & 0x1f;
    if (L === 0) {
      for (let k = 0; k < D + 1; k++) out.push(data[i++]);
    } else {
      let len = L;
      if (L === 7) len += data[i++];
      const dist = ((D << 8) | data[i++]) + 1;
      for (let k = 0; k < len + 2; k++) out.push(out[out.length - dist]);
    }
  }
  return out;
}

function decodeTuya(b64) {
  const raw = fastlzDecompress([...Buffer.from(b64, 'base64')]);
  const durations = [];
  for (let i = 0; i + 1 < raw.length; i += 2) durations.push(raw[i] | (raw[i + 1] << 8));
  return durations;
}

function toDurations(value, name) {
  if (Array.isArray(value)) {
    const arr = value.map((n) => parseInt(n, 10));
    if (arr.some((n) => !Number.isFinite(n) || n <= 0 || n > 0xffff)) {
      throw new Error(`code "${name}": raw array has out-of-range (0–65535 µs) values`);
    }
    return arr;
  }
  if (typeof value === 'string') {
    const d = decodeTuya(value.trim());
    if (d.length < 4) throw new Error(`code "${name}": decoded to <4 durations — not a valid Tuya IR blob`);
    return d;
  }
  throw new Error(`code "${name}": must be a Tuya base64 string or a raw µs array`);
}

// ---- main -------------------------------------------------------------------
const src = process.argv[2] || process.env.DAYLIGHT_IR_CONFIG;
if (!src) {
  console.error('ERROR: pass ir-blasters.yml path, or set DAYLIGHT_IR_CONFIG.');
  process.exit(1);
}

const cfg = yaml.load(readFileSync(src, 'utf8')) || {};
const prov = cfg.provisioning || {};
const blasters = cfg.blasters || {};

const wantId = process.argv[3] || Object.keys(blasters)[0];
const blaster = blasters[wantId];
if (!blaster) {
  console.error(`ERROR: blaster id "${wantId}" not found. Available: ${Object.keys(blasters).join(', ') || '(none)'}`);
  process.exit(1);
}

const device = blaster.device || {};
const codes = blaster.codes || {};
const codeNames = Object.keys(codes);

const need = {
  'provisioning.wifi_ssid': prov.wifi_ssid,
  'provisioning.wifi_password': prov.wifi_password,
};
const missing = Object.entries(need).filter(([, v]) => v === undefined || v === '').map(([k]) => k);
if (missing.length) { console.error(`ERROR: ${src} missing: ${missing.join(', ')}`); process.exit(1); }
if (!codeNames.length) { console.error(`ERROR: blaster "${wantId}" has no codes:`); process.exit(1); }

// Decode every code up front so a bad blob fails the build, not a silent runtime miss.
const decoded = codeNames.map((name) => ({ name, durations: toDurations(codes[name], name) }));

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const irPin = parseInt(device.ir_pin ?? 12, 10);
const carrierKhz = parseInt(device.carrier_khz ?? 38, 10);
// status_led: false keeps the onboard RGB dark in all states (e.g. a blaster in
// a dark room). Default true = red/green/blue status feedback.
const statusLed = device.status_led === false ? 0 : 1;

const arrays = decoded
  .map((c, idx) => `static const uint16_t IRCODE_${idx}[] = { ${c.durations.join(', ')} };  // ${c.name} (${c.durations.length} durations)`)
  .join('\n');

const table = decoded
  .map((c, idx) => `  { "${esc(c.name)}", IRCODE_${idx}, ${c.durations.length} },`)
  .join('\n');

const h = `// GENERATED by tools/gen-config.mjs from ${path.basename(src)} (blaster: ${wantId}) — DO NOT COMMIT.
#pragma once

// ---- network -------------------------------------------------------------
#define WIFI_SSID       "${esc(prov.wifi_ssid)}"
#define WIFI_PASSWORD   "${esc(prov.wifi_password)}"

// ---- blaster identity + hardware ----------------------------------------
#define BLASTER_ID      "${esc(wantId)}"
#define IR_PIN          ${irPin}      // ATOM Lite onboard IR LED = GPIO12
#define IR_CARRIER_KHZ  ${carrierKhz}
#define STATUS_LED      ${statusLed}       // 0 = keep onboard RGB dark in all states

// ---- IR codes (raw µs mark/space durations, decoded from Tuya base64) -----
${arrays}

struct IrCode { const char* name; const uint16_t* data; uint16_t len; };
static const IrCode IR_CODES[] = {
${table}
};
static const int IR_CODE_COUNT = ${decoded.length};
`;

writeFileSync(OUT, h, { mode: 0o600 });
console.log(`[gen-config] ${src} (blaster=${wantId})`);
console.log(`[gen-config] -> ${OUT}  codes: ${decoded.map((c) => `${c.name}(${c.durations.length})`).join(', ')}`);
