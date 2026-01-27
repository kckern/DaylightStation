# Home/Office Context

## Purpose

Dashboard applications for home automation control and office productivity. Includes smart home integration, ambient controls, piano/MIDI, and widget-based interfaces.

## Key Concepts

| Term | Definition |
|------|------------|
| **Widget** | Self-contained UI component displaying specific data/control |
| **Ambient** | Background elements (lighting, music, atmosphere) |
| **Home Assistant** | Smart home platform integration |
| **MIDI** | Musical instrument digital interface for piano |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| Piano module | `modules/Piano/` | OfficeApp |
| Finance widgets | `modules/Finance/` | OfficeApp, FinanceApp |
| Weather module | `modules/Weather/` | OfficeApp, HomeApp |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| Home Assistant | foundations | Smart home control |
| Player | foundations | Background audio |
| ContentScroller | foundations | Widget scrolling |
| Finance widgets | finance domain | Budget display |

## File Locations

### Frontend
- `frontend/src/Apps/OfficeApp.jsx` - Office dashboard (~12KB)
- `frontend/src/Apps/HomeApp.jsx` - Home automation entry
- `frontend/src/modules/Piano/` - MIDI piano components
- `frontend/src/modules/Weather/` - Weather display
- `frontend/src/modules/Entropy/` - Randomization display

### Backend
- `backend/routers/home.mjs` - Home API endpoints
- `backend/lib/homeassistant.mjs` - Home Assistant integration

### Config
- `data/households/{hid}/apps/home/config.yml`
- `data/households/{hid}/apps/office/config.yml`

## Piano / MIDI Integration

**Location:** `frontend/src/modules/Piano/`

**Features:**
- MIDI keyboard input
- Chord detection
- Staff notation display
- Key signature detection

**Related Docs:**
- `docs/plans/2026-01-03-piano-chord-staff-design.md`
- `docs/plans/2026-01-03-key-detection-design.md`

## Home Assistant Integration

Uses foundation `homeassistant.mjs` for:
- Light control (brightness, color)
- Switch toggling
- Sensor reading
- Scene activation

## Common Tasks

- **Add new widget to Office:** Create component in `modules/`, import in `OfficeApp.jsx`
- **Control HA entity:** Use `HomeAssistant.callService()` from backend lib
- **Debug MIDI:** Check browser console for MIDI events, verify device permissions
- **Ambient lighting:** Uses fitness zones to control colors via HA
