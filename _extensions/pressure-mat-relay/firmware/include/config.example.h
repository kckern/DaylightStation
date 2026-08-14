// Example only. Generate the real, gitignored config.h from pressure-mats.yml.
#pragma once

#define WIFI_SSID                "YOUR_SSID"
#define WIFI_PASSWORD            "YOUR_WIFI_PASSWORD"
#define WS_HOST                  "daylightlocal.kckern.net"
#define WS_PORT                  3111
#define WS_PATH                  "/ws"

#define MAT_ID                   "garage-step-mat"
#define SENSOR_PIN               0
#define STATUS_LED_PIN           7
#define STATUS_LED_ENABLED       1

// Voltage change, not pounds. Pressure makes the TrampleTek voltage fall.
#define PRESS_DELTA_V            0.12f
#define PRESS_GRADIENT_VPS       0.08f
#define STOMP_DELTA_V            0.48f
#define STOMP_GRADIENT_VPS       0.20f
#define RELEASE_DELTA_RATIO      0.50f
#define RELEASE_GRADIENT_RATIO   0.40f
#define SAMPLE_INTERVAL_MS       50
#define RAW_SAMPLES_PER_FRAME    100
#define SMOOTHING_FRAMES         7
#define READING_INTERVAL_MS      1000
#define HELLO_INTERVAL_MS        60000
