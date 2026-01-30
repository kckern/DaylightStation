# Device Registry Design

**Date:** 2026-01-27
**Status:** Implemented
**Author:** Claude + kckern

## Implementation Summary

**Backend files created:**
- `backend/src/3_applications/devices/` - Ports, Device, DeviceService
- `backend/src/2_adapters/devices/` - DeviceFactory, HomeAssistantDeviceAdapter, FullyKioskContentAdapter, WebSocketContentAdapter, SshOsAdapter
- `backend/src/4_api/v1/routers/device.mjs` - Device API router
- `backend/src/0_system/bootstrap.mjs` - createDeviceServices, createDeviceApiRouter

**Device config:**
- `data/household/apps/devices/config.yml` - Device definitions
- `data/household/auth/fullykiosk.yml` - Kiosk password (existing)

**HA files updated:**
- `_includes/rest_commands/devices.yaml` - New device registry commands
- `_includes/rest_commands/living_room.yaml` - Updated to use device routes
- `_includes/scripts/livingroom_tv_sequence.yaml` - Uses device_livingroom_tv
- `_includes/scripts/office_tv_on.yaml` - Uses device_office_tv for audio/volume
- `_includes/scripts/office_tv_off.yaml` - Uses device_office_tv for audio

**Action Required:**
- Reload Home Assistant configuration to apply changes
- Deploy DaylightStation for new routes to be available

---

## Problem

The current home automation system has hardcoded device handling:
- Separate routes for `livingroom-tv` vs `office-tv`
- Single kiosk adapter (can't support multiple devices)
- Volume control logic differs by device but isn't abstracted
- No unified way to add new devices

## Solution

A device registry with capability-based control. Devices declare what they can do, and the system routes commands to the appropriate adapters.

---

## Device Model

### Three Capability Categories

| Capability | Responsibility | Providers |
|------------|----------------|-----------|
| **device_control** | Hardware power, state | `homeassistant` |
| **os_control** | OS-level commands, volume | `ssh` |
| **content_control** | Display content loading, app control | `fully-kiosk`, `websocket` |

Each capability can provide additional features:
- `device_control.displays.*.volume_script` → device provides volume
- `os_control.commands.volume` → OS provides volume

**Note:** Fully Kiosk (v1.60+) can handle `screenOn`, `toForeground`, and `loadURL` directly, eliminating the need for Tasker on Shield devices.

### Config Structure

```yaml
# data/household[-{hid}]/apps/devices/config.yml
devices:
  livingroom-tv:
    type: shield-tv
    device_control:
      displays:
        tv:
          provider: homeassistant
          on_script: script.living_room_tv_on
          off_script: script.living_room_tv_off
          volume_script: script.living_room_tv_volume
    content_control:
      provider: fully-kiosk
      host: 10.0.0.11
      port: 2323
      password: ${KIOSK_PASSWORD}  # from secrets
      # Fully Kiosk handles: screenOn, toForeground, loadURL
      # No os_control/Tasker needed!

  office-tv:
    type: linux-pc
    device_control:
      displays:
        tv:
          provider: homeassistant
          on_script: script.office_tv_on
          off_script: script.office_tv_off
        monitor:
          provider: homeassistant
          on_script: script.office_monitor_on
          off_script: script.office_monitor_off
    os_control:
      provider: ssh
      host: 10.0.0.10
      user: kckern
      port: 22
      private_key: ~/.ssh/id_rsa
      commands:
        volume: "amixer set Master {level}%"
        mute: "amixer set Master mute"
        unmute: "amixer set Master unmute"
    content_control:
      provider: websocket
      topic: office
```

---

## API Design

### Endpoints

```
GET /api/v1/device                         → List all devices
GET /api/v1/device/{deviceId}              → Device info + capabilities
GET /api/v1/device/{deviceId}/on           → Power on all displays
GET /api/v1/device/{deviceId}/off          → Power off all displays
GET /api/v1/device/{deviceId}/on?display=tv    → Power on specific display
GET /api/v1/device/{deviceId}/load?play=123    → Power on + load content
GET /api/v1/device/{deviceId}/volume/{level}   → Set volume (0-100, +, -, mute)
```

### Load Sequence

`GET /device/livingroom-tv/load?play=12345`:
1. `device_control` → Turn on TV via HA script
2. `os_control` → Tasker shows blank screen (optional prep)
3. `content_control` → Fully Kiosk loads `/tv?play=12345`

`GET /device/office-tv/load?play=12345`:
1. `device_control` → Turn on TV + monitor via HA scripts
2. `content_control` → WebSocket sends load command to `office` topic

---

## Architecture

### Layer 3: Application (Ports)

```
backend/src/3_applications/devices/
├── ports/
│   ├── IDeviceControl.mjs      # Power on/off, volume (if provided)
│   ├── IOsControl.mjs          # App launch, screen control
│   └── IContentControl.mjs     # Load URL/content
├── services/
│   └── DeviceService.mjs       # Orchestrates capabilities
└── index.mjs
```

**IDeviceControl** (abstract):
```javascript
interface IDeviceControl {
  powerOn(displayId?: string): Promise<Result>
  powerOff(displayId?: string): Promise<Result>
  setVolume?(level: number): Promise<Result>  // optional
  getState(): Promise<DeviceState>
}
```

**IOsControl** (abstract):
```javascript
interface IOsControl {
  execute(taskName: string): Promise<Result>
  setVolume?(level: number): Promise<Result>  // optional
}
```

**IContentControl** (abstract):
```javascript
interface IContentControl {
  load(path: string, query?: object): Promise<Result>
  getStatus(): Promise<ContentStatus>
}
```

### Layer 2: Adapters

```
backend/src/2_adapters/devices/
├── device-control/
│   └── HomeAssistantDeviceAdapter.mjs
├── os-control/
│   └── SshOsAdapter.mjs            # existing RemoteExecAdapter
├── content-control/
│   ├── FullyKioskContentAdapter.mjs  # existing KioskAdapter (enhanced)
│   └── WebSocketContentAdapter.mjs   # new
└── DeviceFactory.mjs               # builds Device from config
```

Note: Tasker adapter is no longer needed. Fully Kiosk v1.60+ handles screen wake (`screenOn`), app foregrounding (`toForeground`), and content loading (`loadURL`).

### Layer 4: API Router

```javascript
// backend/src/4_api/v1/routers/device.mjs
router.get('/:deviceId/on', async (req, res) => {
  const device = deviceService.get(req.params.deviceId);
  const result = await device.powerOn(req.query.display);
  res.json(result);
});

router.get('/:deviceId/load', async (req, res) => {
  const device = deviceService.get(req.params.deviceId);
  await device.powerOn();           // device_control
  await device.prepareForContent(); // os_control (optional)
  const result = await device.loadContent('/tv', req.query);
  res.json(result);
});
```

---

## Device Class

The `Device` class aggregates capabilities and routes commands:

```javascript
class Device {
  #id;
  #type;
  #deviceControl;   // IDeviceControl | null
  #osControl;       // IOsControl | null
  #contentControl;  // IContentControl | null
  #volumeProvider;  // 'device' | 'os' | null

  async powerOn(displayId) {
    if (!this.#deviceControl) throw new Error('No device control');
    return this.#deviceControl.powerOn(displayId);
  }

  async setVolume(level) {
    if (this.#volumeProvider === 'device') {
      return this.#deviceControl.setVolume(level);
    } else if (this.#volumeProvider === 'os') {
      return this.#osControl.setVolume(level);
    }
    throw new Error('Volume not supported');
  }

  async loadContent(path, query) {
    if (!this.#contentControl) throw new Error('No content control');
    return this.#contentControl.load(path, query);
  }
}
```

---

## Probed Device Info

### Living Room Shield (10.0.0.11)

**Fully Kiosk** (port 2323):
- REST API with JSON responses
- Device: NVIDIA SHIELD Android TV (v1.60-play)
- App controls:
  - `screenOn` - wake screen ✅
  - `toForeground` - bring Fully Kiosk to front ✅
  - `loadURL` - load content URL ✅
  - `screenOff` - requires Device Admin (use HA script instead)
- Call: `GET http://10.0.0.11:2323/?cmd={cmd}&password={pw}&url={url}`

**Tasker** (port 1821) - NO LONGER NEEDED:
- Was used for: `blank`, `screenon`, `screenoff`
- Fully Kiosk now handles these directly

### Office (10.0.0.10)

**SSH** (port 22):
- Volume: `amixer set Master {level}%`
- Audio device: `wpctl set-default ...`

**WebSocket**:
- Already connected to DaylightStation
- Topic: `office`
- Receives payload via `registerPayloadCallback`

---

## Migration Path

1. **Phase 1**: Create device config file, DeviceService, Device class
2. **Phase 2**: Create new adapters implementing ports
3. **Phase 3**: Add `/api/v1/device/*` routes
4. **Phase 4**: Migrate existing `/home-automation/tv` to use DeviceService
5. **Phase 5**: Deprecate old routes

---

## Home Assistant Integration

### Current HA → DaylightStation API Consumers

**Rest Commands** (`_includes/rest_commands/`):

| File | Command | URL | Used By |
|------|---------|-----|---------|
| `living_room.yaml` | `morning_program` | `http://10.0.0.10:3113/api/v1/home/tv?queue=morning+program` | - |
| `living_room.yaml` | `tv_off` | `http://10.0.0.10:3113/api/v1/home/tv/off` | - |
| `living_room.yaml` | `hymn` | `http://10.0.0.10:3113/api/v1/home/tv?hymn={{ hymn_num }}` | - |
| `office_apis.yaml` | `office_home_api` | `http://daylight-station:3111/api/v1/home/{{query}}` | Many scripts |
| `office_apis.yaml` | `office_api` | `http://daylight-station:3111/api/v1/{{query}}` | Card print |
| `office_apis.yaml` | `office_ws_api` | `http://daylight-station:3111/admin/ws?{{query}}` | Office API script |

**Scripts** (`_includes/scripts/`):

| Script | Calls | Query Examples |
|--------|-------|----------------|
| `livingroom_tv_sequence.yaml` | `office_home_api` | `tv?queue=music+queue&shader=dark&volume=10&shuffle=1` |
| `daylight_exe_script.yaml` | `office_home_api` | `{{ query }}` (passthrough) |
| `office_api_script.yaml` | `office_ws_api` | `{{ query }}` (passthrough) |
| `office_tv_on.yaml` | `office_home_api` | `audio/DisplayPort 1`, `vol/50` |
| `office_tv_off.yaml` | `office_home_api` | `audio/IEC958` |

**Automations** (`_includes/automations/`):

| Automation | Triggers | Calls |
|------------|----------|-------|
| `kitchen_button_1.yaml` | MQTT button | `script.livingroom_tv_sequence` → `tv?queue=morning+program` |
| `office_morning_program.yaml` | Time | `script.office_api_script` → `queue={{ queue }}` |
| `office_switch_button_1-3.yaml` | Switch | `script.office_api_script` → `queue={{ queue }}` |
| `office_switch_button_4.yaml` | Switch | `rest_command.office_ws_api` → `action=reset` |
| `living_room_button_triggers_card_print.yaml` | Button | `rest_command.office_api` |

### API Routes Used

| Current Route | Purpose | New Route (Device Registry) |
|---------------|---------|----------------------------|
| `/api/v1/home/tv?queue=...` | Load content on living room TV | `/api/v1/device/livingroom-tv/load?queue=...` |
| `/api/v1/home/tv/off` | Turn off living room TV | `/api/v1/device/livingroom-tv/off` |
| `/api/v1/home/tv?hymn=...` | Load hymn on living room TV | `/api/v1/device/livingroom-tv/load?hymn=...` |
| `/api/v1/home/audio/{device}` | Set office audio device | `/api/v1/device/office-tv/audio/{device}` |
| `/api/v1/home/vol/{level}` | Set office volume | `/api/v1/device/office-tv/volume/{level}` |
| `/admin/ws?queue=...` | WebSocket broadcast to office | `/api/v1/device/office-tv/load?queue=...` |

### Migration Checklist

**HA Rest Commands** - Update URLs to new device routes:

| File | Change |
|------|--------|
| `rest_commands/living_room.yaml` | Replace with `rest_commands/devices.yaml` |
| `rest_commands/office_apis.yaml` | Update `office_home_api` → device routes |

**New `rest_commands/devices.yaml`:**
```yaml
# Device-based API calls
device_livingroom_tv:
  url: http://daylight-station:3111/api/v1/device/livingroom-tv/{{action}}
  method: GET
  timeout: 90

device_office_tv:
  url: http://daylight-station:3111/api/v1/device/office-tv/{{action}}
  method: GET
  timeout: 90
```

**HA Scripts** - Update service calls:

| Script | Old | New |
|--------|-----|-----|
| `livingroom_tv_sequence.yaml` | `rest_command.office_home_api` with `query: tv?queue=...` | `rest_command.device_livingroom_tv` with `action: load?queue=...` |
| `daylight_exe_script.yaml` | `rest_command.office_home_api` | `rest_command.device_livingroom_tv` or `device_office_tv` |
| `office_tv_on.yaml` | `query: audio/...` | `rest_command.device_office_tv` with `action: audio/...` |
| `office_tv_off.yaml` | `query: audio/IEC958` | `rest_command.device_office_tv` with `action: audio/IEC958` |

**HA Automations** - No changes needed (they call scripts, not rest_commands directly)

**Port Fix:**
- `living_room.yaml` currently uses `10.0.0.10:3113`
- Should be `daylight-station:3111` (same as office)

### DaylightStation Changes

**Remove:**
- `/api/v1/home/tv` route
- `/api/v1/home/tv/:state` routes
- `/api/v1/home/office_tv/:state` routes
- `/api/v1/home/vol/:level` route
- `/api/v1/home/audio/:device` route
- `/admin/ws` route (replace with device WebSocket)

**Add:**
- `/api/v1/device/:deviceId` routes
- `/api/v1/device/:deviceId/on`
- `/api/v1/device/:deviceId/off`
- `/api/v1/device/:deviceId/load`
- `/api/v1/device/:deviceId/volume/:level`
- `/api/v1/device/:deviceId/audio/:device`

---

## Open Questions

1. Should device config live in `apps/devices/config.yml` or top-level `devices.yml`?
2. WebSocket content control: exact message format for load commands?
3. Should `toForeground` be called automatically before `loadURL`, or explicit?

## Resolved

- ~~Tasker dependency~~ → Eliminated. Fully Kiosk v1.60+ handles screen/app control directly.
- ~~screenOff via Fully Kiosk~~ → Use HA script instead (Device Admin not feasible on Shield).
