// Example only. The REAL config.h is generated (gitignored) from the household
// SSOT by:
//   node tools/gen-config.mjs <dataDir>/household/config/ir-blasters.yml [blaster-id]
// Never put real Wi-Fi credentials in this committed example.
//
// Everything here is compile-time bootstrap. Changing Wi-Fi, the IR pin, or the
// set of codes = edit ir-blasters.yml + regenerate + reflash.
#pragma once

// ---- network -------------------------------------------------------------
#define WIFI_SSID       "YOUR_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

// ---- blaster identity + hardware ----------------------------------------
#define BLASTER_ID      "office-tv"
#define IR_PIN          12       // ATOM Lite onboard IR LED = GPIO12
#define IR_CARRIER_KHZ  38
#define STATUS_LED      1        // 0 = keep onboard RGB dark in all states

// ---- IR codes (raw µs mark/space durations, decoded from Tuya base64) -----
static const uint16_t IRCODE_0[] = { 9088, 4512, 578, 578 };  // power (example, truncated)

struct IrCode { const char* name; const uint16_t* data; uint16_t len; };
static const IrCode IR_CODES[] = {
  { "power", IRCODE_0, 4 },
};
static const int IR_CODE_COUNT = 1;
