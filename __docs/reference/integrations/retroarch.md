# RetroArch Integration

RetroArch provides emulated game console support on Android devices. DaylightStation treats it as a content source that can be browsed, searched, and launched via ADB.

---

## How It Fits

```
TV App Menu → "Games" → Console List → Game Grid → Launch
    ↓
MenuStack dispatches { launch: { contentId } }
    ↓
POST /api/v1/launch  →  LaunchService  →  AdbLauncher
    ↓
adb shell am start -n com.retroarch.aarch64/...RetroActivityFuture
    --es ROM /path/to/rom  --es LIBRETRO /path/to/core.so
```

## Architecture

| Layer | Component | Purpose |
|-------|-----------|---------|
| Domain | `LaunchableItem` | Entity extending `Item` with `launchIntent`, `deviceConstraint`, `console` |
| Port | `IDeviceLauncher` | Interface for device-specific launch execution |
| Port | `ISyncSource` | Interface for syncing content catalogs |
| Adapter | `RetroArchAdapter` | `IContentSource` — browse consoles/games, search |
| Adapter | `RetroArchSyncAdapter` | `ISyncSource` — pull playlists from X-plore |
| Adapter | `AdbLauncher` | `IDeviceLauncher` — execute ADB am start |
| Application | `LaunchService` | Orchestrates content resolution + device launch |
| Application | `SyncService` | Orchestrates catalog sync for registered sources |
| API | `POST /api/v1/launch` | Launch endpoint |
| API | `POST /api/v1/sync/:source` | Trigger sync |
| API | `GET /api/v1/sync/:source/status` | Check sync status |

## Configuration

**File:** `data/household/config/retroarch.yml`

This file is loaded by the config system's `loadHouseholdApps` function and made available as `configService.getHouseholdAppConfig(null, 'retroarch')`.

```yaml
source:
  host: 10.0.0.11        # X-plore WiFi File Manager host
  port: 1111              # X-plore HTTP port
  playlists_path: /storage/emulated/0/RetroArch/playlists
  thumbnails_path: /storage/emulated/0/RetroArch/thumbnails
  games_path: /storage/emulated/0/Games

launch:
  package: com.retroarch.aarch64
  activity: com.retroarch.browser.retroactivity.RetroActivityFuture
  device_constraint: android   # Only launch on android devices

consoles:
  n64:
    label: Nintendo 64
    core: /data/local/tmp/mupen64plus_next_gles3_libretro_android.so
    menuStyle: arcade
  snes:
    label: Super Nintendo
    core: /data/local/tmp/snes9x_libretro_android.so
    menuStyle: arcade
  # ... additional consoles

thumbnails:
  base_path: data/household/shared/retroarch/thumbnails
```

## Content ID Scheme

- **Console:** `retroarch:{consoleId}` (e.g., `retroarch:n64`)
- **Game:** `retroarch:{consoleId}/{gameId}` (e.g., `retroarch:n64/mario-kart-64`)

## Sync Process

The sync pulls game catalogs from X-plore's WiFi File Manager HTTP API:

1. `POST /api/v1/sync/retroarch` triggers `RetroArchSyncAdapter.sync()`
2. Adapter fetches `.lpl` playlist files from X-plore at `source.host:source.port`
3. Playlists are parsed — each entry maps to a console via its `core_path`
4. Results are written to `data/household/shared/retroarch/catalog.yml`
5. Existing overrides (custom titles, hidden flags) are preserved

## Launch Flow

1. User selects a game in the TV menu
2. `LaunchCard` component fires `POST /api/v1/launch` with `contentId` and `targetDeviceId`
3. `LaunchService` resolves the content via `RetroArchAdapter.getItem()`
4. `LaunchService` validates the device matches `deviceConstraint`
5. `AdbLauncher` builds an ADB `am start` command with the `launchIntent`
6. ADB sends the intent to the Android device, launching RetroArch with the ROM

## ADB Launch Safety

The `AdbLauncher` uses array-form `execFile` (not string `exec`) to prevent shell injection. Intent parameters are validated with a defense-in-depth regex that allows only safe characters (alphanumeric, paths, spaces, parentheses).

## TV Menu Setup

The Games menu entry in `data/household/config/lists/menus/tvapp.yml`:

```yaml
- input: retroarch
  action: List
  label: Games
```

## Troubleshooting

**Games menu shows empty:** Sync hasn't run yet. Trigger with `POST /api/v1/sync/retroarch`. Requires X-plore running on the Android device.

**Launch fails with "device not found":** Check ADB connectivity to the target device. Verify `devices.yml` has the device configured with ADB host/port.

**Launch fails with "device constraint mismatch":** The `device_constraint: android` in config means only android-type devices can launch RetroArch content.

## Controllers screen (Bluetooth gamepads in kiosk mode)

One screen manages the TV's Bluetooth gamepads end to end from the remote, without
Android Settings (which Fully Kiosk will not let you reach). It opens two ways:

- **Home menu → Controllers** — a menu item with `input: app:controllers`,
  `action: Open` in `content/lists/menus/tvapp.yml` (app id `controllers` in
  `frontend/src/lib/appRegistry.js`).
- **Games → Controllers** — move Up from the top row of games, then Select. Back
  returns to the same game selection.

Code: `__app_modules/games/emulator/browser/controllers/` (`ControllerManager.jsx`
view, `useBluetoothManager.js` poller, `controllerFlows.js` lifecycle,
`controllerModel.js` pure reads). It never overlays RetroArch.

**What it shows.** Every game controller with its OBSERVED state — Connected,
Paired · not connected, Pairing…, Found · not paired, or Paired · link status unknown
(the bridge cannot see the HID link right now; never guessed). Remotes and
keyboards are listed view-only and can never be forgotten from here.

**Live input.** A right-hand panel shows every controller the browser sees
(`navigator.getGamepads()`, the TV remote excluded) as *Player N* with a pad
diagram whose buttons and sticks light while held, plus "I'm here!" and what was
pressed (named by position — "right face button" — since 8BitDo and Xbox pads
print A in different places). A connected row's lamp lights too, but only when
exactly one connected row carries that pad's name: the browser exposes no
Bluetooth address, so two identical pads are told apart by the panel, not the
rows. "Ready to play" ends with "press any button to check". Controllers only
light up here; the remote drives the screen. The screen host's `GamepadAdapter`
turns pad buttons into ActionBus actions *before* any key exists (L1/R2/Select →
`escape`, which dismisses the overlay or reloads the page), so the screen claims
`navigate`/`select`/`escape` on the bus while it is up; its synthetic keys
(`__gamepadSynthetic`) and Android's own A → OK / B → Back fallbacks (a key within
250 ms of a pad button going down) are swallowed. The guard is edge-based, never
"a button is held", so a pad lying on a button cannot lock out the remote. Mice,
keyboards and other HID receivers Chromium lists as gamepads (the Shield shows a
"wireless 2.4G Mouse" at slot 0) are skipped, and a phantom twin (one pad
enumerated at two indices, pressing in lockstep) is hidden after its first
mirrored press — a same-name pad ever pressed on its own stays. Code:
`liveInput.js`, `useGamepadActivity.js`, `PadDiagram.jsx`.

**What it does.** Each action is a checklist that only ticks on observed state,
never on an accepted request:

| Action | Steps |
|---|---|
| **Fix** (paired pad) | Reconnect → if no answer in 12 s: Forget → pairing mode + search → Pair → Connect |
| **Re-pair** | Forget → pairing mode + search → Pair → Connect (from scratch) |
| **Connect** / **Disconnect** | the one link change |
| **Forget** | asks first ("Keep it" is focused) |
| **Find new controllers** → **Pair** | Pair → Connect |

Re-pairing does NOT depend on discovery: after Forget, the bridge still lists the
pad, and Android pairs a known Classic pad by address as soon as it is in pairing
mode, so the flow pages it every few seconds for up to 2 minutes while showing the
pairing-mode steps. Discovery is only the fallback for a pad the bridge no longer
lists (keeping it running across Android's ~12 s inquiry; a pad is matched by
address, or by name when exactly one unpaired pad of that name appears — an 8BitDo
in another mode comes back under a new address). On the Shield, discovery itself is
refused until the audio-bridge build with the `location` service type is installed
(see its DESIGN.md); until then **Find new controllers** says so, and only pads the
TV already knows can be (re)paired.
A legacy **PIN** prompt is answered on screen (with a "Use 0000" shortcut). A
**confirm-code** prompt cannot be answered by a sideloaded app (`capabilities.confirm`
is false without `BLUETOOTH_PRIVILEGED`), so the flow declines it and says so
immediately rather than waiting out the 60 s window; a pad that pairs "Just Works"
when the TV starts the pairing (8BitDo in Android mode) never asks.

**Configuration** on the fleet device in `household/hardware/devices.yml`:

```yaml
bluetooth_bridge:
  url: http://<device-host>:8766
  pairing:                 # optional; words shown during the search step
    mode: Android mode
    steps:
      - "..."
    troubleshoot: "..."    # shown when a flow fails
```

The browser uses its `fleet:` identity (set by the screen from
`websocket.guardrails.device`) to call `GET /api/v1/arcade-bluetooth/:deviceId`;
JSON POST actions below that path are `scan`, `scan/stop`, `pair`, `unpair`,
`connect`, `disconnect`, and `pairing`. The status response carries `guide` when
`pairing` is configured. Only the server's registered bridge origin is used; a
device without `bluetooth_bridge` returns an explicit 503. The route must be listed
in the v1 `routeMap` (`__backend/src/4_api/v1/routers/api.mjs`) — registering it in
`v1Routers` alone 404s. Existing garage BlueZ pairing stays separate.

Installation needs the original APK signing key and Bluetooth discovery permissions.
Do not uninstall a working audio-bridge to work around a signing mismatch. Do not
replace/restart it during a game or microphone call. See the audio-bridge module's
`DESIGN.md` for the native API and setup requirements.
