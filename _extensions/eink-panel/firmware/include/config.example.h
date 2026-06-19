// Example only. The REAL config.h is generated (gitignored) from the household
// SSOT by:  node tools/gen-config.mjs <path-to>/screens/kitchen-eink.yml
// Never put real Wi-Fi credentials in this committed example.
#pragma once

#define WIFI_SSID        "YOUR_SSID"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"

#define PANEL_ID         "kitchen-eink"     // matches screens/<id>.yml; sent to backend
#define DS_HOST          "10.0.0.68"        // DaylightStation backend host
#define DS_PORT          3112               // backend port (env.ports.backend)

#define DISPLAY_ROTATION 0                  // 0 = landscape 1872x1404, 270 = portrait 1404x1872
#define SLEEP_MINUTES    30                 // periodic wake/redraw with no button press

// Physical button -> action string sent to GET /api/eink/action?action=...
#define BTN_GREEN_GPIO   3
#define BTN_GREEN_ACTION "select"
#define BTN_RIGHT_GPIO   4
#define BTN_RIGHT_ACTION "next"
#define BTN_LEFT_GPIO    5
#define BTN_LEFT_ACTION  "prev"
