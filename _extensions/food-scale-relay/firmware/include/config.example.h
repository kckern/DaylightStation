// Example only. The REAL config.h is generated (gitignored) from the household
// SSOT by:
//   node tools/gen-config.mjs <dataDir>/household/config/scales.yml [scale-id]
// Never put real Wi-Fi credentials in this committed example.
//
// Everything here is compile-time bootstrap. Changing Wi-Fi, backend, the scale
// target, or a decode parameter = edit scales.yml + regenerate + reflash.
#pragma once

// ---- network -------------------------------------------------------------
#define WIFI_SSID          "YOUR_SSID"
#define WIFI_PASSWORD      "YOUR_WIFI_PASSWORD"

#define WS_HOST            "daylightlocal.kckern.net"  // DaylightStation backend
#define WS_PORT            3111                        // event-bus WS port
#define WS_PATH            "/ws"                       // event-bus WS path

// ---- scale identity + BLE target ----------------------------------------
#define SCALE_ID           "kitchen"                   // key under scales: in scales.yml
#define SCALE_MATCH_NAME   "SENSSUN FOOD"              // BLE advertised name to scan for
#define SCALE_SERVICE_UUID "0000ffb0-0000-1000-8000-00805f9b34fb"
#define SCALE_NOTIFY_UUID  "0000ffb2-0000-1000-8000-00805f9b34fb"

// ---- frame decode (KitchenIQ 50797 / SENSSUN FOOD, verified) -------------
// Frame: FF A5 | weight(uint16 BE) | mirror | b6(stable) | b7 | b8(unit) | checksum
#define WEIGHT_OFFSET      2        // byte index of the uint16 big-endian weight
#define WEIGHT_DIVISOR     1        // raw -> grams
#define STABLE_BYTE        6        // 0xAA = settled, 0xA0 = changing
#define STABLE_VALUE       0xAA
#define UNIT_BYTE          8        // 0x00 = g, 0x02 = ml

// ---- emit throttle -------------------------------------------------------
#define EMIT_MIN_DELTA_G   1        // emit on >= this many grams of change
#define HEARTBEAT_MS       2000     // ...or at least this often while idle
