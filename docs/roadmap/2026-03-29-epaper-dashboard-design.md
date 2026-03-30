# ePaper Dashboard Display — reTerminal E1004

**Date:** 2026-03-29
**Status:** Hardware on order

## Overview

Wall-mounted 13.3" color ePaper display (Seeed Studio reTerminal E1004) showing a server-rendered dashboard PNG. No cloud services — backend renders the image, device fetches it over LAN.

## Hardware

- **Device:** Seeed Studio reTerminal E1004
- **Display:** 13.3" E Ink Spectra 6, 1600x1200, 6-color (black, white, red, yellow, blue, green)
- **SoC:** ESP32-S3 (8MB PSRAM, 32MB flash, Wi-Fi 2.4GHz, BLE 5.0)
- **Battery:** 5000mAh built-in (~6 months standby at 1 refresh/6hr)
- **Sensors:** SHT40 (temp/humidity), 3 buttons, buzzer, LED
- **Refresh time:** ~15 seconds (full screen, color)

## Architecture

```
CanvasRenderer (existing) ──renders──▶ PNG (1600x1200)
         │
    API route: GET /api/v1/epaper/image.png
         │
    ESP32-S3 (ESPHome firmware) polls via online_image
         │
    ePaper display updates
```

### Device Firmware

Flash ESPHome via USB-C (bootloader is unlocked, no root/jailbreak needed). Key ESPHome config:

```yaml
online_image:
  - url: "http://{backend-host}:{port}/api/v1/epaper/image.png"
    id: dashboard_image
    type: rgb565
    format: png
    on_download_finished:
      - component.update: epaper_display
```

ESPHome handles Floyd-Steinberg dithering from full-color PNG to the 6-color palette internally.

### SPI Pinout (ESP32-S3 → ePaper)

| Function | GPIO |
|----------|------|
| SPI CLK  | 7    |
| SPI MOSI | 9    |
| CS       | 10   |
| DC       | 11   |
| RST      | 12   |
| BUSY     | 13   |

### Backend Adapter

```
backend/src/1_adapters/hardware/epaper/
├── EpaperAdapter.mjs      # Renders dashboard PNG via CanvasRenderer
├── manifest.mjs           # Adapter discovery metadata
└── index.mjs              # Barrel export
```

- Uses existing `CanvasRenderer.createWithContext(1600, 1200)` from `0_system/canvas/`
- Exports PNG buffer via `canvas.toBuffer('image/png')`
- New API route serves the rendered image
- Design with the 6 real-world colors for crisp output:

| Color  | Real-world RGB       |
|--------|----------------------|
| Black  | `rgb(25, 30, 33)`    |
| White  | `rgb(232, 232, 232)` |
| Red    | `rgb(178, 19, 24)`   |
| Yellow | `rgb(239, 222, 68)`  |
| Blue   | `rgb(33, 87, 186)`   |
| Green  | `rgb(18, 95, 32)`    |

## Design Decisions

- **No SenseCraft HMI** — closed SaaS platform with no developer API. Avoided entirely.
- **ESPHome over custom Arduino firmware** — simpler OTA updates, HA integration for free, `online_image` component handles dithering.
- **Server-side rendering** — keeps the ESP32 as a dumb display. All layout logic lives in the backend where it's easy to iterate.
- **PNG over raw bitmap** — ESPHome handles palette reduction. No need to implement Spectra 6 raw format (4-bit packed, reversed raster order) on the backend.

## References

- [amadad/reterminal-e1001](https://github.com/amadad/reterminal-e1001) — Custom HTTP firmware for reTerminal E series
- [kotope/eink-art-gallery-esphome](https://github.com/kotope/eink-art-gallery-esphome) — ESPHome config for E-series as art frame
- [shi-314/esp32-spectra-e6](https://github.com/shi-314/esp32-spectra-e6) — ESP32 firmware for Spectra 6 displays
- [rjgrandy/eink-color-dashboard](https://github.com/rjgrandy/eink-color-dashboard) — ESPHome color dashboard config
- [Seeed wiki — ESPHome setup](https://wiki.seeedstudio.com/reterminal_e10xx_with_esphome/)
- [Spectra 6 dither script](https://gist.github.com/quark-zju/e488eb206ba66925dc23692170ba49f9) — Python reference for raw format

## Open Questions

- What data to show on the dashboard (schedule, weather, chores, gratitude prompt?)
- Refresh interval (every 15min? hourly? event-driven via HA?)
- Multiple "pages" rotated by button press?
- Night mode (blank display to save battery)?
