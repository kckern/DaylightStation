// Example only. The REAL config.h is generated (gitignored) from the household
// SSOT by:  node tools/gen-config.mjs <path-to>/config/barcode-relay.yml
// Never put real Wi-Fi credentials in this committed example.
//
// Bootstrap ONLY — Wi-Fi creds, where to reach the backend event-bus WebSocket,
// and the DS2278's BLE identity. This relay has no runtime config (it just
// streams scans), so a change here is a SSOT edit + reflash. Prefer the STABLE
// HOSTNAME (DuckDNS) over an IP so the relay survives a server address change.
#pragma once

#define WIFI_SSID        "YOUR_SSID"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"

#define WS_HOST          "daylightlocal.kckern.net"  // DaylightStation backend host (DuckDNS -> homeserver); NOT an IP
#define WS_PORT          3111                          // backend port (env.ports.backend)
#define WS_PATH          "/ws"                         // event-bus WebSocket path

#define SCANNER_MAC      "c8:1c:fe:fd:ce:90"           // DS2278 BLE MAC (from bluetoothctl discovery)
#define SCANNER_NAME     "DS2278"
