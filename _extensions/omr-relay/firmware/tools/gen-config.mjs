#!/usr/bin/env node
// =============================================================================
// gen-config.mjs — generate firmware include/config.h from the household SSOT
// (data/household/config/omr-readers.yml). Keeps Wi-Fi creds + instance values OUT
// of the repo: the output config.h is gitignored.
//
// Usage:
//   node tools/gen-config.mjs <path-to>/config/omr-readers.yml [reader-id]
//   DAYLIGHT_OMR_CONFIG=<path> node tools/gen-config.mjs [reader-id]
//
// reader-id defaults to the first key under `scanners:`.
// =============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'include', 'config.h');

const src = process.argv[2] || process.env.DAYLIGHT_OMR_CONFIG;
if (!src) {
  console.error('ERROR: pass omr-readers.yml path, or set DAYLIGHT_OMR_CONFIG.');
  process.exit(1);
}

const cfg = yaml.load(readFileSync(src, 'utf8')) || {};
const prov = cfg.provisioning || {};
const backend = cfg.backend || {};
const scanners = cfg.scanners || {};

const wantId = process.argv[3] || Object.keys(scanners)[0];
const sc = scanners[wantId];
if (!sc) {
  console.error(`ERROR: reader id "${wantId}" not found. Available: ${Object.keys(scanners).join(', ') || '(none)'}`);
  process.exit(1);
}
const serial = sc.serial || {};

const need = {
  'provisioning.wifi_ssid': prov.wifi_ssid,
  'provisioning.wifi_password': prov.wifi_password,
  'backend.host': backend.host,
  'backend.port': backend.port,
};
const missing = Object.entries(need).filter(([, v]) => v === undefined || v === '').map(([k]) => k);
if (missing.length) { console.error(`ERROR: ${src} missing: ${missing.join(', ')}`); process.exit(1); }

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Map YAML framing (e.g. "8N1", "7E1") to the Arduino SERIAL_* constant.
const framing = String(serial.framing || '8N1').toUpperCase();
const FRAMING_MAP = {
  '8N1': 'SERIAL_8N1', '8E1': 'SERIAL_8E1', '8O1': 'SERIAL_8O1',
  '7N1': 'SERIAL_7N1', '7E1': 'SERIAL_7E1', '7O1': 'SERIAL_7O1',
};
const uartConfig = FRAMING_MAP[framing];
if (!uartConfig) { console.error(`ERROR: unknown serial.framing "${framing}"`); process.exit(1); }

const rxPin = parseInt(serial.rx_pin ?? 5, 10);
const txPin = parseInt(serial.tx_pin ?? 6, 10);

// ---- optional NFC tap reader (M5 Unit NFC, ST25R3916, on the Grove port) -----
// Verified on hardware 2026-07-29: the ST25R3916 answers at I2C 0x50 with IC
// Identity 0x2A (ic_type 5, silicon rev 2). Grove on an ATOM Lite is
// SDA=GPIO26 / SCL=GPIO32.
const nfc = sc.nfc || {};
const nfcEnabled = nfc.enabled === true;
const nfcSda = parseInt(nfc.sda_pin ?? 26, 10);
const nfcScl = parseInt(nfc.scl_pin ?? 32, 10);

// ---- optional buzzer (audible tap ACK) --------------------------------------
// The ATOMIC RS232 base breaks out only GPIO23 and GPIO33 as free solder pads
// (its own silkscreen reads 3V3 / 22-Rx / 19-Tx / 23 / 33). Restrict it here
// rather than let a typo quietly kill a working link.
const BUZZER_ALLOWED_PINS = [23, 33];
const buzzer = sc.buzzer || {};
const buzzerEnabled = buzzer.enabled === true;
const buzzerPin = parseInt(buzzer.pin ?? 23, 10);

// active  = self-oscillating; ONE fixed pitch, `tone` is ignored. Loudness and
//           meaning come from duration and rhythm.
// passive = piezo transducer; `tone` sets the actual pitch via ledcWriteTone,
//           so low→high / high→low patterns become possible.
const buzzerKind = String(buzzer.kind ?? 'active').toLowerCase();
if (buzzerEnabled && !['active', 'passive'].includes(buzzerKind)) {
  console.error(`ERROR: buzzer.kind must be "active" or "passive", got "${buzzer.kind}"`);
  process.exit(1);
}

// Sound patterns: an ordered list of steps, each { tone?, ms, gap? }. `ms` is how
// long to sound, `gap` the silence after it. Emitted as C initialisers so the
// firmware plays them from a table instead of hard-coding rhythms.
const DEFAULT_SOUNDS = {
  read:      [{ ms: parseInt(buzzer.ms ?? 4, 10) }],
  confirmed: [{ ms: 4, gap: 60 }, { ms: 4 }],
  failed:    [{ ms: 250 }],
};
const sounds = { ...DEFAULT_SOUNDS, ...(buzzer.sounds || {}) };
const MAX_STEPS = 8;

function compileSound(name, steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    console.error(`ERROR: buzzer.sounds.${name} must be a non-empty list of steps`);
    process.exit(1);
  }
  if (steps.length > MAX_STEPS) {
    console.error(`ERROR: buzzer.sounds.${name} has ${steps.length} steps; max ${MAX_STEPS}`);
    process.exit(1);
  }
  const out = steps.map((st) => {
    const tone = parseInt(st?.tone ?? 0, 10);
    const ms = parseInt(st?.ms ?? 0, 10);
    const gap = parseInt(st?.gap ?? 0, 10);
    if (!(ms >= 0 && ms <= 5000) || !(gap >= 0 && gap <= 5000)) {
      console.error(`ERROR: buzzer.sounds.${name}: ms/gap must be 0..5000`);
      process.exit(1);
    }
    if (buzzerKind === 'active' && tone > 0) {
      // Not fatal — the pattern still plays — but silence here would let someone
      // spend an afternoon wondering why their melody sounds like one note.
      console.warn(`[gen-config] NOTE: buzzer.sounds.${name} sets tone=${tone} but buzzer.kind is "active";`
        + ' an active buzzer has a fixed pitch and tone is ignored. Use kind: passive for pitch.');
    }
    return `{${tone},${ms},${gap}}`;
  });
  return { len: out.length, init: `{${out.join(',')}}` };
}

const sndRead = compileSound('read', sounds.read);
const sndConfirmed = compileSound('confirmed', sounds.confirmed);
const sndFailed = compileSound('failed', sounds.failed);

// Pin collisions are the one mistake here with a CONFUSING failure rather than
// an obvious one: reuse the UART pins and the OMR link goes dead silent, which
// looks exactly like the reader being unplugged. Catch it at generation time.
const conflicts = [];
const uartPins = new Set([rxPin, txPin]);
if (nfcEnabled) {
  if (uartPins.has(nfcSda)) conflicts.push(`nfc.sda_pin ${nfcSda} collides with the OMR UART`);
  if (uartPins.has(nfcScl)) conflicts.push(`nfc.scl_pin ${nfcScl} collides with the OMR UART`);
  if (nfcSda === nfcScl)    conflicts.push(`nfc.sda_pin and nfc.scl_pin are both ${nfcSda}`);
}
if (buzzerEnabled) {
  if (!BUZZER_ALLOWED_PINS.includes(buzzerPin)) {
    conflicts.push(`buzzer.pin ${buzzerPin} is not a free pad on the ATOMIC RS232 base (allowed: ${BUZZER_ALLOWED_PINS.join(', ')})`);
  }
  if (uartPins.has(buzzerPin)) conflicts.push(`buzzer.pin ${buzzerPin} collides with the OMR UART`);
  if (nfcEnabled && (buzzerPin === nfcSda || buzzerPin === nfcScl)) {
    conflicts.push(`buzzer.pin ${buzzerPin} collides with the NFC I2C bus`);
  }
}
if (conflicts.length) {
  console.error(`ERROR: pin conflicts in ${src} (reader=${wantId}):`);
  for (const c of conflicts) console.error(`  - ${c}`);
  process.exit(1);
}

const h = `// GENERATED by tools/gen-config.mjs from ${path.basename(src)} (reader: ${wantId}) — DO NOT COMMIT.
#pragma once

#define WIFI_SSID      "${esc(prov.wifi_ssid)}"
#define WIFI_PASSWORD  "${esc(prov.wifi_password)}"

#define BACKEND_HOST   "${esc(backend.host)}"
#define BACKEND_PORT   ${parseInt(backend.port, 10)}
#define WS_PATH        "${esc(backend.ws_path || '/ws')}"

#define READER_ID      "${esc(wantId)}"
#define BUS_TOPIC      "${esc(sc.topic || 'omr')}"

#define UART_RX_PIN    ${rxPin}
#define UART_TX_PIN    ${txPin}
#define UART_BAUD      ${parseInt(serial.baud ?? 9600, 10)}
#define UART_CONFIG    ${uartConfig}
#define SNIFF_MODE     ${sc.sniff_mode === false ? 0 : 1}

// NFC tap reader (M5 Unit NFC / ST25R3916). NFC_ENABLED 0 compiles the whole
// NFC path out, so an OMR-only reader keeps its original footprint.
#define NFC_ENABLED           ${nfcEnabled ? 1 : 0}
#define NFC_SDA_PIN           ${nfcSda}
#define NFC_SCL_PIN           ${nfcScl}
#define NFC_I2C_HZ            ${parseInt(nfc.i2c_hz ?? 400000, 10)}
#define NFC_POLL_MS           ${parseInt(nfc.poll_ms ?? 40, 10)}
// A FAILED detect blocks for its full timeout. The library default is 1000 ms,
// which is far too coarse for a tap: a quick swipe lands between polls and the
// student gets no beep and no idea why. Short window, polled often.
#define NFC_DETECT_TIMEOUT_MS ${parseInt(nfc.detect_timeout_ms ?? 120, 10)}

// Buzzer — audible ACK. See the note in main.cpp: on the buzzer tested
// 2026-07-29, duty is a DISTORTION control, not a volume control. Loudness is
// set by duration at full duty.
#define BUZZER_ENABLED        ${buzzerEnabled ? 1 : 0}
#define BUZZER_PIN            ${buzzerPin}
#define BUZZER_PASSIVE        ${buzzerKind === 'passive' ? 1 : 0}
#define BUZZER_DUTY           ${parseInt(buzzer.duty ?? 255, 10)}
#define BUZZER_FREQ_HZ        ${parseInt(buzzer.freq_hz ?? 30000, 10)}

// Sound vocabulary. Steps are { tone, ms, gap }: sound for ms, then silence for
// gap. 'tone' only does anything when BUZZER_PASSIVE is 1 — an active buzzer has
// one fixed pitch, so meaning has to come from rhythm.
//   read      — a card/sheet was read locally
//   confirmed — the SERVER echoed it back; the round trip closed
//   failed    — no echo inside BUZZER_ACK_TIMEOUT_MS
#define SND_READ_LEN          ${sndRead.len}
#define SND_READ_INIT         ${sndRead.init}
#define SND_CONFIRMED_LEN     ${sndConfirmed.len}
#define SND_CONFIRMED_INIT    ${sndConfirmed.init}
#define SND_FAILED_LEN        ${sndFailed.len}
#define SND_FAILED_INIT       ${sndFailed.init}
#define BUZZER_ACK_TIMEOUT_MS ${parseInt(buzzer.ack_timeout_ms ?? 2000, 10)}
`;

writeFileSync(OUT, h, { mode: 0o600 });
console.log(`[gen-config] ${src} (reader=${wantId})\n[gen-config] -> ${OUT}  backend=${backend.host}:${backend.port}${backend.ws_path || '/ws'}  ${serial.baud ?? 9600}/${framing} sniff=${sc.sniff_mode === false ? 0 : 1}  nfc=${nfcEnabled ? `on(${nfcSda}/${nfcScl})` : 'off'}  buzzer=${buzzerEnabled ? `on(G${buzzerPin},${parseInt(buzzer.ms ?? 4, 10)}ms)` : 'off'}`);
