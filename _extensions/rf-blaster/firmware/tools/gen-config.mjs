#!/usr/bin/env node
// =============================================================================
// gen-config.mjs — generate firmware include/config.h from the household SSOT
// (data/household/config/rf-blasters.yml). Keeps Wi-Fi creds + instance values
// OUT of the repo: the output config.h is gitignored.
//
// Sibling of ../../ir-blaster/firmware/tools/gen-config.mjs. The IR version
// decodes Tuya base64 because that is the format Home Assistant already stores
// IR in. There is no equivalent lingua franca for raw 433 MHz, so codes here
// are plain microsecond timings — normally pasted straight out of this board's
// own `GET /learn` response. See ../../LEARNING.md.
//
// A code value may be either:
//   - an array of integers (µs mark/space durations, even index = carrier ON), or
//   - an object { timings: [...], repeats: N, gap_us: N }
//
// `repeats` matters far more on RF than on IR: receivers in this class commonly
// ignore a single frame and act only on the second identical one, which is how
// they reject noise. Default 8.
//
// Usage:
//   node tools/gen-config.mjs <path-to>/config/rf-blasters.yml [blaster-id]
//   DAYLIGHT_RF_CONFIG=<path> node tools/gen-config.mjs [blaster-id]
//
// blaster-id defaults to the first key under `blasters:`.
// =============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'include', 'config.h');

const DEFAULT_REPEATS = 8;
const DEFAULT_GAP_US = 10000;
const MAX_TIMINGS = 400;      // must match RF_MAX_TIMINGS / MAX_FLAT in the firmware

function toTimings(value, name) {
  const arr = Array.isArray(value) ? value : value?.timings;
  if (!Array.isArray(arr)) {
    throw new Error(`code "${name}": must be a µs array or { timings: [...] }`);
  }
  const out = arr.map((n) => parseInt(n, 10));
  if (out.some((n) => !Number.isFinite(n) || n <= 0 || n > 0xffff)) {
    throw new Error(`code "${name}": timings must be 1–65535 µs`);
  }
  if (out.length < 2) throw new Error(`code "${name}": needs at least 2 timings`);
  if (out.length > MAX_TIMINGS) {
    throw new Error(`code "${name}": ${out.length} timings exceeds firmware limit ${MAX_TIMINGS}`);
  }
  // An odd count means the frame ends on a mark with no trailing space. The
  // firmware pads it, but it almost always means the capture was truncated.
  if (out.length % 2 !== 0) {
    console.warn(`[gen-config] WARNING: code "${name}" has an odd timing count (${out.length}) — capture may be truncated`);
  }
  return out;
}

const clampU16 = (v, dflt) => {
  const n = parseInt(v ?? dflt, 10);
  if (!Number.isFinite(n) || n < 0 || n > 0xffff) {
    throw new Error(`value ${v} out of range (0–65535)`);
  }
  return n;
};

// ---- main -------------------------------------------------------------------
const src = process.argv[2] || process.env.DAYLIGHT_RF_CONFIG;
if (!src) {
  console.error('ERROR: pass rf-blasters.yml path, or set DAYLIGHT_RF_CONFIG.');
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

// Decode every code up front so a bad entry fails the build, not a silent runtime miss.
let decoded;
try {
  decoded = codeNames.map((name) => {
    const v = codes[name];
    return {
      name,
      timings: toTimings(v, name),
      repeats: clampU16(Array.isArray(v) ? undefined : v?.repeats, DEFAULT_REPEATS),
      gapUs: clampU16(Array.isArray(v) ? undefined : v?.gap_us, DEFAULT_GAP_US),
    };
  });
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const txPin = parseInt(device.tx_pin ?? 26, 10);
const rxPin = parseInt(device.rx_pin ?? 32, 10);
if (txPin === rxPin) { console.error(`ERROR: tx_pin and rx_pin are both ${txPin}`); process.exit(1); }
const syncGapUs = clampU16(device.sync_gap_us, 2500);
const statusLed = device.status_led === false ? 0 : 1;

const arrays = decoded
  .map((c, idx) => `static const uint16_t RFCODE_${idx}[] = { ${c.timings.join(', ')} };  // ${c.name} (${c.timings.length} timings)`)
  .join('\n');

const table = decoded
  .map((c, idx) => `  { "${esc(c.name)}", RFCODE_${idx}, ${c.timings.length}, ${c.repeats}, ${c.gapUs} },`)
  .join('\n');

const h = `// GENERATED by tools/gen-config.mjs from ${path.basename(src)} (blaster: ${wantId}) — DO NOT COMMIT.
#pragma once

// ---- network -------------------------------------------------------------
#define WIFI_SSID       "${esc(prov.wifi_ssid)}"
#define WIFI_PASSWORD   "${esc(prov.wifi_password)}"

// ---- blaster identity + hardware ----------------------------------------
#define BLASTER_ID      "${esc(wantId)}"
#define RF_TX_PIN       ${txPin}       // → 433 MHz TX DATA
#define RF_RX_PIN       ${rxPin}       // ← 433 MHz RX DATA
#define STATUS_LED      ${statusLed}        // 0 = keep onboard RGB dark in all states

// ---- learn tuning --------------------------------------------------------
#define RF_SYNC_GAP_US  ${syncGapUs}
#define RF_MAX_TIMINGS  ${MAX_TIMINGS}

// ---- RF codes (raw µs mark/space durations; even index = carrier ON) ------
${arrays}

struct RfCode {
  const char*     name;
  const uint16_t* data;
  uint16_t        len;
  uint16_t        repeats;
  uint16_t        gap_us;
};
static const RfCode RF_CODES[] = {
${table}
};
static const int RF_CODE_COUNT = ${decoded.length};
`;

writeFileSync(OUT, h, { mode: 0o600 });
console.log(`[gen-config] ${src} (blaster=${wantId})`);
console.log(`[gen-config] -> ${OUT}  codes: ${decoded.map((c) => `${c.name}(${c.timings.length}x${c.repeats})`).join(', ')}`);
