// Example schema for the generated config.h. The REAL config.h is generated
// from the household SSOT (data/household/config/scantrons.yml) by
// tools/gen-config.mjs and is gitignored. Do NOT commit config.h.
#pragma once

// --- provisioning ---
#define WIFI_SSID      "YOUR_SSID"
#define WIFI_PASSWORD  "YOUR_WIFI_PASSWORD"

// --- backend event bus ---
#define BACKEND_HOST   "daylightlocal.kckern.net"
#define BACKEND_PORT   3111
#define WS_PATH        "/ws"

// --- reader identity ---
#define READER_ID      "study-scantron"
#define BUS_TOPIC      "scantron"

// --- RS-232 UART (VERIFIED 2026-07-21 against the real OMR-1100) ---
// Confirmed by live interrogation AND by the operator manual: the reader's
// power-up default is 9600 baud, 7 data bits, EVEN parity, 1 stop bit.
// Do not "fix" this to 8N1 — 8N1 yields silence, not garbage.
#define UART_RX_PIN    22     // ATOM base RX  <- VERIFY against M5 ATOMIC RS232 base pinout
#define UART_TX_PIN    19     // ATOM base TX  <- REQUIRED: the mode download goes out on TX
#define UART_BAUD      9600
#define UART_CONFIG    SERIAL_7E1

// Sniff mode: forward every received byte to the bus as {"type":"raw"} instead
// of decoding. The protocol is now known, so decode is the default; set to 1
// only when investigating a new form or a suspected framing change.
#define SNIFF_MODE     0
