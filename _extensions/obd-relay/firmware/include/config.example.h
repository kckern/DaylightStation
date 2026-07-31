// EXAMPLE ONLY — the real include/config.h is GENERATED from the household SSOT
// (data/household/config/vehicles.yml) by tools/gen-config.mjs and is gitignored.
//   node tools/gen-config.mjs <dataDir>/household/config/vehicles.yml family-car
#pragma once

#define WIFI_SSID           "YOUR_SSID"
#define WIFI_PASSWORD       "YOUR_WIFI_PASSWORD"

#define WS_HOST             "daylightlocal.example.net"
#define WS_PORT             3111
#define WS_PATH             "/ws"

#define VEHICLE_ID          "family-car"

#define SAMPLE_HZ           1      // trip sample rate while driving
#define SNAPSHOT_S          15     // live snapshot cadence on home WiFi
#define TRIP_CHUNK_SAMPLES  300    // max samples per `trip` WS message
