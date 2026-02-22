# ADB (Android Debug Bridge) Integration

ADB provides low-level command-line control of Android devices over the network. DaylightStation uses it as a **fallback recovery mechanism** when the primary content control adapter (Fully Kiosk Browser REST API) becomes unreachable — typically after a crash, OOM kill, or forced restart.

**Android docs:** [ADB overview](https://developer.android.com/tools/adb) | [Developer options](https://developer.android.com/studio/debug/dev-options#enable)

---

## How It Fits

```
Phone: /device/{id}/load
    ↓
Device.loadContent()
    ↓
ResilientContentAdapter.load()
    ├─ Try: FullyKioskContentAdapter  ← HTTP REST to FKB on port 2323
    │       (primary)
    │
    └─ On connection error (ECONNREFUSED / ETIMEDOUT / EHOSTUNREACH):
        └─ AdbAdapter recovery:
            1. adb connect {host}:{port}
            2. adb shell am start -n {launch_activity}
            3. Wait 5s for app boot
            4. Retry FullyKiosk REST
```

ADB never runs on its own — it's only triggered by `ResilientContentAdapter` when the primary adapter fails with a connection error. Application-level errors (bad URL, auth failure) do **not** trigger ADB recovery.

---

## Configuration

### devices.yml

Add a `fallback` block under `content_control` for any Android device:

```yaml
devices:
  livingroom-tv:
    type: shield-tv
    content_control:
      provider: fully-kiosk
      host: 10.0.0.11
      port: 2323
      auth_ref: fullykiosk
      fallback:
        provider: adb
        host: 10.0.0.11        # Device IP (same as FKB host)
        port: 5555              # ADB port (default 5555)
        launch_activity: de.ozerov.fully/.TvActivity
```

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | Yes | Must be `adb` |
| `host` | Yes | Device IP address on LAN |
| `port` | No | ADB TCP port (default: `5555`) |
| `launch_activity` | Yes | Fully qualified Android activity to launch for recovery |

**Common launch activities:**

| App | Activity |
|-----|----------|
| Fully Kiosk Browser (TV) | `de.ozerov.fully/.TvActivity` |
| Fully Kiosk Browser (phone/tablet) | `de.ozerov.fully/.FullyKioskActivity` |

Without a `fallback` block, the device uses the raw FullyKiosk adapter with no recovery.

### How the factory wires it

`DeviceFactory.mjs` reads the config and decides at startup:

1. Creates `FullyKioskContentAdapter` as the primary
2. If `fallback.provider === 'adb'`: creates `AdbAdapter`, wraps primary in `ResilientContentAdapter`
3. If no fallback: uses the raw primary

---

## Backend Files

| File | Purpose |
|------|---------|
| `backend/src/1_adapters/devices/AdbAdapter.mjs` | Low-level ADB CLI wrapper (`connect`, `shell`, `launchActivity`, `isProcessRunning`) |
| `backend/src/1_adapters/devices/ResilientContentAdapter.mjs` | Wraps primary + ADB; triggers recovery on connection errors |
| `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` | Primary content control via FKB REST API |
| `backend/src/3_applications/devices/services/DeviceFactory.mjs` | Reads config, wires adapters together |

### AdbAdapter API

```javascript
const adb = new AdbAdapter({ host: '10.0.0.11', port: 5555 }, { logger });

await adb.connect();                        // adb connect 10.0.0.11:5555
await adb.shell('input keyevent KEYCODE_WAKEUP');  // Run shell command
await adb.launchActivity('de.ozerov.fully/.TvActivity');  // am start -n ...
await adb.isProcessRunning('de.ozerov.fully');  // Check if FKB is alive
adb.getMetrics();                           // { commands, errors, recoveries }
```

All commands have a 10-second timeout. The adapter tracks metrics (command count, error count, recovery count).

### ResilientContentAdapter behavior

- Implements the same `IContentControl` interface as `FullyKioskContentAdapter` (`load`, `prepareForContent`, `getStatus`)
- Only triggers recovery on connection errors (`ECONNREFUSED`, `ETIMEDOUT`, `EHOSTUNREACH`)
- Recovery sequence: ADB connect → launch activity → wait 5s → retry primary
- Response includes `recovery` field showing whether recovery was attempted and if it succeeded
- `getMetrics()` aggregates primary adapter metrics + recovery stats

---

## Device Setup

### Prerequisites

- The **host running DaylightStation** (Docker container or dev machine) needs `adb` installed
  - Alpine Docker: `apk add android-tools`
  - macOS: `brew install android-platform-tools`
  - Debian/Ubuntu: `apt install adb`
- The Android device must be on the **same LAN** as the host
- ADB TCP debugging must be enabled on the device (see below)

### 1. Enable Developer Options on the Android device

1. Open **Settings**
2. Navigate to **About** (exact path varies by device):
   - Shield TV: Settings > Device Preferences > About
   - Samsung: Settings > About phone > Software information
   - Stock Android: Settings > About phone
3. Tap **Build number** seven times — a toast will confirm "You are now a developer!"
4. Go back to Settings — **Developer options** now appears

### 2. Enable ADB over network

**On Shield TV / Android TV:**

1. Settings > Device Preferences > Developer options
2. Enable **Network debugging** (may also be called "ADB debugging" or "USB debugging")
3. Note the IP address shown (or find it in Settings > Network & Internet)

**On phones/tablets:**

1. Settings > Developer options > **USB debugging** — enable it
2. Connect via USB first, then switch to TCP:
   ```bash
   adb tcpip 5555
   adb connect <device-ip>:5555
   ```
3. Unplug USB — the device now accepts network ADB connections

**On Android 11+ devices:**

Android 11 introduced wireless debugging with pairing codes. Use:
```bash
adb pair <device-ip>:<pairing-port>    # Enter the 6-digit code shown on device
adb connect <device-ip>:<debug-port>
```

### 3. Verify from the DaylightStation host

```bash
# From the machine running the backend (or inside the Docker container)
adb connect 10.0.0.11:5555
adb devices          # Should show "10.0.0.11:5555   device"
adb -s 10.0.0.11:5555 shell echo ok    # Should print "ok"
```

If `adb devices` shows `unauthorized`, accept the RSA key prompt on the Android device's screen.

### 4. Persistence

ADB network connections **do not survive device reboots** on most devices. After a reboot, you may need to re-enable network debugging or re-run `adb tcpip 5555`.

Shield TV generally persists network debugging across reboots if the setting stays enabled. Other devices vary.

The `ResilientContentAdapter` calls `adb connect` on every recovery attempt, so a stale connection is re-established automatically.

---

## Use Cases

### Shield TV kiosk (current)

The primary use case. The Shield TV runs Fully Kiosk Browser as a kiosk. FKB occasionally crashes or gets killed by Android's memory manager. When this happens, the FKB REST API becomes unreachable. ADB recovery restarts FKB and retries the content load.

### Wall-mounted tablets

Any Android tablet running Fully Kiosk Browser can use the same setup:

1. Install FKB on the tablet
2. Enable developer options and network debugging
3. Add the tablet to `devices.yml` with `content_control` + `fallback` config
4. Use the tablet's FKB activity name (typically `de.ozerov.fully/.FullyKioskActivity` for non-TV builds)

### Other Android apps

The `launch_activity` field is not limited to FKB. Any Android app can be launched via ADB as a recovery target. Use `adb shell dumpsys activity top` on the device to find the current activity name.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `adb connect` times out | Device not on network, or ADB not enabled | Verify device IP, enable network debugging |
| `adb devices` shows `unauthorized` | RSA key not accepted | Look at the device screen for the authorization dialog, tap "Allow" |
| `adb devices` shows `offline` | Stale connection | `adb disconnect` then `adb connect` again |
| Recovery succeeds but FKB still unreachable | FKB crashed during boot, or wrong activity name | Check `launch_activity` matches installed FKB variant |
| `adb: command not found` | `adb` not installed on host | Install `android-tools` (Alpine) or `android-platform-tools` (macOS) |
| Recovery triggers but content doesn't load | 5s boot wait too short for slow device | Consider a slower device or check FKB startup time |

---

## Logging

Recovery events are logged with the `resilient.*` prefix:

| Event | Level | Meaning |
|-------|-------|---------|
| `resilient.load.primaryFailed` | warn | FKB unreachable, starting ADB recovery |
| `resilient.recovery.start` | info | ADB connect + launch beginning |
| `resilient.recovery.connectFailed` | error | `adb connect` failed |
| `resilient.recovery.launchFailed` | error | `adb shell am start` failed |
| `resilient.recovery.complete` | info | Recovery finished, retrying primary |
| `resilient.load.recoverySuccess` | info | Content loaded after recovery |
| `resilient.load.recoveryFailed` | error | Content still failed after recovery |

ADB-level events use the `adb.*` prefix:

| Event | Level | Meaning |
|-------|-------|---------|
| `adb.exec.start` | debug | ADB command starting |
| `adb.exec.success` | debug | Command completed |
| `adb.exec.error` | error | Command failed |
| `adb.launchActivity` | info | Activity launch requested |
