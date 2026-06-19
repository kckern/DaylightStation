// Example only. The REAL config.h is generated (gitignored) from the household
// SSOT by:  node tools/gen-config.mjs <path-to>/screens/kitchen-eink.yml
// Never put real Wi-Fi credentials in this committed example.
//
// Bootstrap ONLY. Everything else (display rotation, button->action map, sleep
// cadence/schedule) is fetched from the server at runtime — GET /api/v1/eink/
// config?id=PANEL_ID and the /panel X-Eink-Next-Wake header — so changing it is a
// SSOT edit + backend redeploy, never a reflash. Safety fallbacks for a cold boot
// with the server unreachable live in src/main.cpp, not here.
#pragma once

#define WIFI_SSID        "YOUR_SSID"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"

#define PANEL_ID         "kitchen-eink"     // matches screens/<id>.yml; identity + config locator
#define DS_HOST          "10.0.0.68"        // DaylightStation backend host
#define DS_PORT          3112               // backend port (env.ports.backend)
