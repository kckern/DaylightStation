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

// --- RS-232 UART (VALUES BELOW ARE UNVERIFIED PLACEHOLDERS) ---
// Baud/parity/framing of the OMR 1200 are unknown until sniffed on hardware.
// Start in raw-passthrough sniff mode and confirm before trusting decode.
#define UART_RX_PIN    22     // ATOM base RX  <- VERIFY against M5 ATOMIC RS232 base pinout
#define UART_TX_PIN    19     // ATOM base TX  <- VERIFY (unused if scanner is send-only)
#define UART_BAUD      9600   // GUESS — sniff the real rate first (try 1200/2400/9600)
#define UART_CONFIG    SERIAL_8N1  // GUESS — could be 7E1 on vintage OMR gear

// Sniff mode: forward every received byte to the bus as {"type":"raw"} instead
// of attempting to decode sheet answers. Use this during protocol discovery.
#define SNIFF_MODE     1
