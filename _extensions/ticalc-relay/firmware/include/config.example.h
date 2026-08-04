// Example only. Generate the real config.h from the private household SSOT:
//   node tools/gen-config.mjs <data-dir>/household/config/ticalc-relay.yml
#pragma once

#define WIFI_SSID       "YOUR_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

#define BACKEND_HOST    "daylightlocal.kckern.net"
#define BACKEND_PORT    3112
#define BACKEND_SCHEME  "http"
#define WS_PATH         "/ws"
#define API_BASE_PATH   "/api/v1/school/calc"
#define RELAY_ID        "ticalc-relay-01"
#define RELAY_LABEL     "TI calculator relay"
#define FIRMWARE_CONFIG_FINGERPRINT "example-only"
// Per-relay bearer secret; minimum 32 bytes. It must match household auth
// ticalc-relay.relays.ticalc-relay-01.api_token on the backend.
#define API_TOKEN       ""

// These are interface-board pins, not calculator pins. Both sinks must be
// open-drain external transistors/MOSFETs; the ESP32 must never drive tip/ring.
#define TIP_SENSE_PIN   32
#define TIP_SINK_PIN    25
#define RING_SENSE_PIN  33
#define RING_SINK_PIN   26
#define LED_PIN         27

// SAFETY GATE: leave 0 until the protected TRS interface has been checked with
// a meter. When 0, the firmware observes line levels but cannot pull either
// calculator line low. Set from relay.link.transmit_enabled in the YAML source.
#define TI_TRANSMIT_ENABLED 0

// Listen for a calculator-originated SchoolCalc SCF1 HELLO. This never claims
// that an idle-high cable is attached and remains inert while transmit is off.
// Leave enabled for the normal "open SchoolCalc, press Sync" learner flow.
#define FOREGROUND_LISTENER_ENABLED 1

// Poll for an attached/provisioned calculator. Enable only after a manual
// end-to-end sync passes on the protected cable interface. This is the older
// relay-initiated Silent Link poll and is independent of the foreground listener.
#define AUTO_SYNC_ENABLED 0

// Optional BLE HID Boot Keyboard. Generate these values from the private YAML;
// the address is the keyboard's bonded identity, not a display name discovered
// at runtime. Normal operation rejects every other peer.
#define BLE_KEYBOARD_ENABLED 0
#define BLE_KEYBOARD_ADDRESS "AA:BB:CC:DD:EE:FF"
#define BLE_KEYBOARD_ADDRESS_TYPE 0  // 0=public, 1=random identity address
#define BLE_KEYBOARD_LABEL "SchoolCalc keyboard"
#define BLE_KEYBOARD_PAIRING_WINDOW_MS 60000
#define BLE_KEYBOARD_REQUIRE_MITM 1
