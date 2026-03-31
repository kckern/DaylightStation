# Barcode Scanner (USB HID → MQTT)

Captures input from a USB barcode/QR scanner, suppresses keyboard passthrough, and publishes scans to MQTT. The scanner appears as a standard HID keyboard to the OS — without this bridge, every scan would type into whatever window has focus.

**Depends on:** Mosquitto MQTT broker (`mosquitto:1883`)

---

## How It Fits

```
USB Scanner (Symbol Technologies)
       │
       │  /dev/input/eventN (HID keyboard)
       ▼
scanner.py (systemd service)
       │  evdev exclusive grab (EVIOCGRAB)
       │  ── keyboard passthrough suppressed ──
       │
       │  Assembles keystrokes → barcode string
       ▼
Mosquitto (mqtt://localhost:1883)
       │
       │  topic: daylight/scanner/barcode
       ▼
DaylightStation backend
       │  MQTTSensorAdapter / EventBus subscriber
       ▼
Action handler (content playback, UPC lookup, etc.)
```

---

## Configuration

### /etc/default/barcode-scanner

| Variable | Default | Description |
|----------|---------|-------------|
| `SCANNER_DEVICE` | *(empty)* | Explicit `/dev/input/...` path. If empty, auto-detects by name. |
| `SCANNER_DEVICE_NAME` | `Symbol` | Substring to match against device names when auto-detecting. |
| `MQTT_HOST` | `localhost` | MQTT broker hostname. |
| `MQTT_PORT` | `1883` | MQTT broker port. |
| `MQTT_TOPIC` | `daylight/scanner/barcode` | Topic to publish scans to. |
| `LOG_LEVEL` | `INFO` | Python log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`). |

---

## MQTT Message Format

**Topic:** `daylight/scanner/barcode`

```json
{
  "barcode": "QR-content-or-UPC-string",
  "timestamp": "2026-03-30T12:34:56.789012+00:00",
  "device": "symbol-scanner"
}
```

---

## Files

| File | Purpose |
|------|---------|
| `_extensions/barcode-scanner/src/scanner.py` | Main script: evdev grab, keystroke assembly, MQTT publish |
| `_extensions/barcode-scanner/requirements.txt` | Python dependencies (evdev, paho-mqtt) |
| `_extensions/barcode-scanner/install.sh` | Installs venv, systemd unit, udev rule, env file |
| `_extensions/barcode-scanner/barcode-scanner.service` | systemd unit file |
| `_extensions/barcode-scanner/90-barcode-scanner.rules` | udev rule — restarts service on device replug |
| `/etc/default/barcode-scanner` | Runtime configuration (env vars) |
| `/opt/barcode-scanner/` | Install directory (venv + script) |

---

## Operations

### Service management

```bash
# Status
systemctl status barcode-scanner

# Logs (live)
journalctl -u barcode-scanner -f

# Restart after config change
systemctl restart barcode-scanner

# Stop
systemctl stop barcode-scanner
```

### Verify scanner is detected

```bash
# List input devices
python3 -c "import evdev; [print(f'{d.path}  {d.name}') for d in [evdev.InputDevice(p) for p in evdev.list_devices()]]"

# Check the specific device
ls -la /dev/input/by-id/ | grep -i symbol
```

### Test MQTT output

```bash
# Subscribe to scanner topic (in another terminal)
mosquitto_sub -h localhost -t 'daylight/scanner/barcode'

# Scan a barcode — should appear as JSON
```

---

## How It Works

### Exclusive grab

The script calls `device.grab()` which issues the `EVIOCGRAB` ioctl. This gives the process exclusive access to the input device — the kernel stops forwarding keystrokes to X11, Wayland, TTY, or any other consumer. Only the script sees the scan data.

The grab is held for the lifetime of the process. If the process exits (crash, stop), the grab is released and the device reverts to normal keyboard behavior. systemd's `Restart=always` ensures the grab is reacquired within 3 seconds.

### Keystroke assembly

Barcode scanners in HID keyboard mode send individual key-down events for each character, terminated by Enter (KEY_ENTER). The script maintains a character buffer and shift-state tracking:

1. Key-down events are mapped to characters via a keycode→char table
2. Shift keys toggle uppercase/symbol mode
3. Enter flushes the buffer as a complete barcode string
4. The buffer is published to MQTT and cleared

### Device recovery

Three layers of recovery handle device disconnection:

1. **OSError on read** — when the device is unplugged, `device.read_loop()` raises `OSError`. The script exits with code 1.
2. **systemd restart** — `Restart=always` with `RestartSec=3` relaunches the script. It will fail to find the device and exit again, but systemd rate-limits restarts.
3. **udev rule** — when the scanner is replugged, the udev rule triggers `barcode-scanner.service`, ensuring a clean start with the new device path.

### MQTT reconnection

`paho-mqtt`'s `connect_async()` + `loop_start()` handles broker reconnection automatically. If Mosquitto is temporarily unavailable, scans are lost (no local queue), but the MQTT client reconnects when the broker returns.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Scans still type into focused window | Grab not acquired — service not running | `systemctl status barcode-scanner`. Check logs for device-not-found errors. |
| Service starts but immediately exits | Scanner not plugged in or wrong `SCANNER_DEVICE_NAME` | Check `journalctl -u barcode-scanner`. Verify device exists with `evdev` list command above. |
| Service running but no MQTT messages | MQTT broker unreachable | Check `MQTT_HOST`/`MQTT_PORT` in `/etc/default/barcode-scanner`. Test with `mosquitto_pub -h localhost -t test -m hello`. |
| Partial or garbled barcodes | Keystroke mapping missing characters | Run with `LOG_LEVEL=DEBUG` to see raw keycodes. Add missing entries to `_SHIFT_MAP` in scanner.py. |
| Service doesn't restart on replug | udev rule not installed | Check `ls /etc/udev/rules.d/90-barcode-scanner.rules`. Run `sudo udevadm control --reload-rules`. |
| Permission denied on /dev/input | Service not running as root | The systemd unit runs as root (required for EVIOCGRAB). Check the unit file hasn't been modified. |
| Brief keystroke leak on replug | ~1s window between plug and grab | Normal — udev→systemd start takes ~1s. Not avoidable without a persistent input filter. |
