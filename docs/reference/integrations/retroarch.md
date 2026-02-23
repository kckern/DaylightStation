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
