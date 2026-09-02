// Example only. The REAL config.h is generated (gitignored) from the household
// SSOT by:
//   node tools/gen-config.mjs <dataDir>/household/config/rf-blasters.yml [blaster-id]
// Never put real Wi-Fi credentials in this committed example.
//
// Everything here is compile-time bootstrap. Changing Wi-Fi, the pins, or the
// set of codes = edit rf-blasters.yml + regenerate + reflash.
#pragma once

// ---- network -------------------------------------------------------------
#define WIFI_SSID       "YOUR_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

// ---- blaster identity + hardware ----------------------------------------
#define BLASTER_ID      "disco-light"
#define RF_TX_PIN       26       // ATOM Lite Grove signal 1 → 433 MHz TX DATA
#define RF_RX_PIN       32       // ATOM Lite Grove signal 2 ← 433 MHz RX DATA
#define STATUS_LED      1        // 0 = keep onboard RGB dark in all states

// ---- learn tuning --------------------------------------------------------
// A LOW longer than this ends a frame. Most EV1527-class remotes idle ~10 ms
// between repeats and use bit cells well under 1 ms, so 2.5 ms separates them
// cleanly. Lower it if /learn reports "no frame boundary found".
#define RF_SYNC_GAP_US  2500
#define RF_MAX_TIMINGS  400

// ---- RF codes (raw µs mark/space durations; even index = carrier ON) ------
static const uint16_t RFCODE_0[] = { 350, 1050, 350, 1050, 1050, 350 };  // example, truncated

struct RfCode {
  const char*     name;
  const uint16_t* data;
  uint16_t        len;
  uint16_t        repeats;   // frames per press — real remotes send several
  uint16_t        gap_us;    // silence between repeats
};
static const RfCode RF_CODES[] = {
  { "disco_on", RFCODE_0, 6, 8, 10000 },
};
static const int RF_CODE_COUNT = 1;
