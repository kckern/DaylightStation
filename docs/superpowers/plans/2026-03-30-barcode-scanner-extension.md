# Barcode Scanner Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a host-side systemd service that exclusively captures a USB barcode scanner's HID input and publishes scanned barcodes to MQTT.

**Architecture:** A Python script uses `evdev` to grab exclusive access to the Symbol barcode scanner's input device, suppressing all keyboard passthrough. It assembles individual keystrokes into complete barcode strings (terminated by Enter), then publishes each scan to `mosquitto:1883` on topic `daylight/scanner/barcode`. A systemd unit keeps the process running, and a udev rule triggers a restart on device replug.

**Tech Stack:** Python 3.12, evdev, paho-mqtt, systemd, udev

---

### Task 1: Create extension directory and Python scanner script

**Files:**
- Create: `_extensions/barcode-scanner/src/scanner.py`
- Create: `_extensions/barcode-scanner/requirements.txt`

- [ ] **Step 1: Create requirements.txt**

```
evdev>=1.7.0
paho-mqtt>=2.0.0
```

- [ ] **Step 2: Write scanner.py**

```python
#!/usr/bin/env python3
"""
Barcode scanner → MQTT bridge.

Grabs exclusive access to a USB barcode scanner's HID input device,
assembles keystrokes into barcode strings, and publishes each scan
to an MQTT broker.
"""

import os
import sys
import json
import signal
import logging
from datetime import datetime, timezone

import evdev
from evdev import ecodes
import paho.mqtt.client as mqtt

# ── Config from environment ──────────────────────────────────────

DEVICE_PATH = os.environ.get('SCANNER_DEVICE', '')
DEVICE_NAME_MATCH = os.environ.get('SCANNER_DEVICE_NAME', 'Symbol')
MQTT_HOST = os.environ.get('MQTT_HOST', 'localhost')
MQTT_PORT = int(os.environ.get('MQTT_PORT', '1883'))
MQTT_TOPIC = os.environ.get('MQTT_TOPIC', 'daylight/scanner/barcode')
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format='%(asctime)s %(levelname)s %(message)s',
)
log = logging.getLogger('barcode-scanner')

# ── Keycode → character mapping ──────────────────────────────────

# evdev KEY_* codes for digits and common barcode characters
KEY_MAP = {}
# 0-9: KEY_1(2)..KEY_0(11)
for i in range(10):
    code = ecodes.ecodes.get(f'KEY_{i}', ecodes.ecodes.get(f'KEY_{(i + 1) % 10}'))
# Build from ecodes directly
_SHIFT_MAP = {
    ecodes.KEY_1: '1', ecodes.KEY_2: '2', ecodes.KEY_3: '3',
    ecodes.KEY_4: '4', ecodes.KEY_5: '5', ecodes.KEY_6: '6',
    ecodes.KEY_7: '7', ecodes.KEY_8: '8', ecodes.KEY_9: '9',
    ecodes.KEY_0: '0',
    ecodes.KEY_MINUS: '-', ecodes.KEY_EQUAL: '=',
    ecodes.KEY_A: 'a', ecodes.KEY_B: 'b', ecodes.KEY_C: 'c',
    ecodes.KEY_D: 'd', ecodes.KEY_E: 'e', ecodes.KEY_F: 'f',
    ecodes.KEY_G: 'g', ecodes.KEY_H: 'h', ecodes.KEY_I: 'i',
    ecodes.KEY_J: 'j', ecodes.KEY_K: 'k', ecodes.KEY_L: 'l',
    ecodes.KEY_M: 'm', ecodes.KEY_N: 'n', ecodes.KEY_O: 'o',
    ecodes.KEY_P: 'p', ecodes.KEY_Q: 'q', ecodes.KEY_R: 'r',
    ecodes.KEY_S: 's', ecodes.KEY_T: 't', ecodes.KEY_U: 'u',
    ecodes.KEY_V: 'v', ecodes.KEY_W: 'w', ecodes.KEY_X: 'x',
    ecodes.KEY_Y: 'y', ecodes.KEY_Z: 'z',
    ecodes.KEY_SEMICOLON: ';', ecodes.KEY_APOSTROPHE: "'",
    ecodes.KEY_COMMA: ',', ecodes.KEY_DOT: '.', ecodes.KEY_SLASH: '/',
    ecodes.KEY_SPACE: ' ', ecodes.KEY_TAB: '\t',
    ecodes.KEY_LEFTBRACE: '[', ecodes.KEY_RIGHTBRACE: ']',
    ecodes.KEY_BACKSLASH: '\\',
}

_SHIFTED = {
    ecodes.KEY_1: '!', ecodes.KEY_2: '@', ecodes.KEY_3: '#',
    ecodes.KEY_4: '$', ecodes.KEY_5: '%', ecodes.KEY_6: '^',
    ecodes.KEY_7: '&', ecodes.KEY_8: '*', ecodes.KEY_9: '(',
    ecodes.KEY_0: ')',
    ecodes.KEY_MINUS: '_', ecodes.KEY_EQUAL: '+',
    ecodes.KEY_SEMICOLON: ':', ecodes.KEY_APOSTROPHE: '"',
    ecodes.KEY_COMMA: '<', ecodes.KEY_DOT: '>', ecodes.KEY_SLASH: '?',
    ecodes.KEY_LEFTBRACE: '{', ecodes.KEY_RIGHTBRACE: '}',
    ecodes.KEY_BACKSLASH: '|',
}
# Uppercase letters handled via shift flag


def keycode_to_char(keycode, shifted):
    """Convert evdev keycode to character, respecting shift state."""
    if shifted:
        # Uppercase letters
        if ecodes.KEY_A <= keycode <= ecodes.KEY_Z:
            return _SHIFT_MAP.get(keycode, '').upper()
        return _SHIFTED.get(keycode)
    return _SHIFT_MAP.get(keycode)


# ── Device discovery ─────────────────────────────────────────────

def find_scanner_device():
    """Find the scanner input device by path or name match."""
    if DEVICE_PATH and os.path.exists(DEVICE_PATH):
        dev = evdev.InputDevice(DEVICE_PATH)
        log.info('Using configured device: %s (%s)', dev.path, dev.name)
        return dev

    for path in evdev.list_devices():
        dev = evdev.InputDevice(path)
        if DEVICE_NAME_MATCH.lower() in dev.name.lower():
            log.info('Found scanner: %s (%s)', dev.path, dev.name)
            return dev

    return None


# ── MQTT ─────────────────────────────────────────────────────────

def create_mqtt_client():
    """Create and connect an MQTT client."""
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='barcode-scanner')
    client.enable_logger(log)

    def on_connect(client, userdata, flags, rc, properties):
        if rc == 0:
            log.info('MQTT connected to %s:%d', MQTT_HOST, MQTT_PORT)
        else:
            log.error('MQTT connection failed: rc=%d', rc)

    def on_disconnect(client, userdata, flags, rc, properties):
        if rc != 0:
            log.warning('MQTT disconnected unexpectedly: rc=%d', rc)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.connect_async(MQTT_HOST, MQTT_PORT)
    client.loop_start()
    return client


def publish_barcode(client, barcode):
    """Publish a scanned barcode to MQTT."""
    payload = json.dumps({
        'barcode': barcode,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'device': 'symbol-scanner',
    })
    result = client.publish(MQTT_TOPIC, payload, qos=1)
    log.info('Scan: %s (mid=%s)', barcode, result.mid)


# ── Main loop ────────────────────────────────────────────────────

def run():
    device = find_scanner_device()
    if not device:
        log.error('Scanner device not found (path=%s, name_match=%s)', DEVICE_PATH, DEVICE_NAME_MATCH)
        sys.exit(1)

    # Grab exclusive access — suppresses keyboard passthrough
    device.grab()
    log.info('Exclusive grab acquired on %s', device.path)

    client = create_mqtt_client()

    buffer = []
    shifted = False

    def shutdown(signum, frame):
        log.info('Shutting down (signal %d)', signum)
        try:
            device.ungrab()
        except OSError:
            pass
        client.loop_stop()
        client.disconnect()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log.info('Listening for scans...')

    try:
        for event in device.read_loop():
            if event.type != ecodes.EV_KEY:
                continue

            key_event = evdev.categorize(event)

            # Track shift state
            if key_event.scancode in (ecodes.KEY_LEFTSHIFT, ecodes.KEY_RIGHTSHIFT):
                shifted = key_event.keystate in (key_event.key_down, key_event.key_hold)
                continue

            # Only process key-down events
            if key_event.keystate != key_event.key_down:
                continue

            # Enter = end of barcode
            if key_event.scancode == ecodes.KEY_ENTER:
                if buffer:
                    barcode = ''.join(buffer)
                    publish_barcode(client, barcode)
                    buffer.clear()
                continue

            char = keycode_to_char(key_event.scancode, shifted)
            if char:
                buffer.append(char)

    except OSError as e:
        log.error('Device read error (unplugged?): %s', e)
        client.loop_stop()
        client.disconnect()
        sys.exit(1)


if __name__ == '__main__':
    run()
```

- [ ] **Step 3: Verify the script syntax**

Run: `cd /root/Code/DaylightStation/_extensions/barcode-scanner && python3 -c "import py_compile; py_compile.compile('src/scanner.py', doraise=True)"`
Expected: No output (clean compile)

---

### Task 2: Create install script and systemd unit

**Files:**
- Create: `_extensions/barcode-scanner/install.sh`
- Create: `_extensions/barcode-scanner/barcode-scanner.service`
- Create: `_extensions/barcode-scanner/90-barcode-scanner.rules`

- [ ] **Step 1: Write the systemd unit file**

```ini
[Unit]
Description=Barcode Scanner → MQTT Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/barcode-scanner
ExecStart=/opt/barcode-scanner/venv/bin/python src/scanner.py
Restart=always
RestartSec=3

# Environment — override via /etc/default/barcode-scanner
EnvironmentFile=-/etc/default/barcode-scanner

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/dev/input
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Write the udev rule**

```
# Restart barcode-scanner service when Symbol scanner is plugged in
ACTION=="add", SUBSYSTEM=="input", ATTRS{idVendor}=="05e0", ATTRS{idProduct}=="1200", TAG+="systemd", ENV{SYSTEMD_WANTS}="barcode-scanner.service"
```

- [ ] **Step 3: Write the install script**

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/barcode-scanner"
SERVICE_NAME="barcode-scanner"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Barcode Scanner MQTT Bridge — Install ==="

# Create install directory
sudo mkdir -p "$INSTALL_DIR/src"
sudo cp "$SCRIPT_DIR/src/scanner.py" "$INSTALL_DIR/src/"
sudo cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/"

# Create venv and install deps
echo "Creating Python venv..."
sudo python3 -m venv "$INSTALL_DIR/venv"
sudo "$INSTALL_DIR/venv/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"

# Write default env file if it doesn't exist
if [ ! -f /etc/default/barcode-scanner ]; then
    echo "Creating /etc/default/barcode-scanner..."
    sudo tee /etc/default/barcode-scanner > /dev/null <<'ENVEOF'
# Scanner device path (auto-detected by name if empty)
SCANNER_DEVICE=
# Match scanner by name substring (used when SCANNER_DEVICE is empty)
SCANNER_DEVICE_NAME=Symbol
# MQTT broker
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_TOPIC=daylight/scanner/barcode
LOG_LEVEL=INFO
ENVEOF
fi

# Install systemd unit
echo "Installing systemd service..."
sudo cp "$SCRIPT_DIR/barcode-scanner.service" /etc/systemd/system/
sudo systemctl daemon-reload

# Install udev rule
echo "Installing udev rule..."
sudo cp "$SCRIPT_DIR/90-barcode-scanner.rules" /etc/udev/rules.d/
sudo udevadm control --reload-rules

# Enable and start
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

echo "=== Done ==="
echo "Status:  systemctl status $SERVICE_NAME"
echo "Logs:    journalctl -u $SERVICE_NAME -f"
echo "Config:  /etc/default/barcode-scanner"
```

- [ ] **Step 4: Commit**

```bash
git add _extensions/barcode-scanner/
git commit -m "feat: add barcode-scanner extension (evdev → MQTT bridge)"
```

---

### Task 3: Write integration documentation

**Files:**
- Create: `docs/reference/integrations/barcode-scanner.md`

- [ ] **Step 1: Write the reference doc**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/reference/integrations/barcode-scanner.md
git commit -m "docs: add barcode scanner integration reference"
```

---

### Task 4: Install and verify end-to-end

- [ ] **Step 1: Install the extension**

Run: `cd /root/Code/DaylightStation/_extensions/barcode-scanner && sudo bash install.sh`
Expected: Clean install, service starts

- [ ] **Step 2: Verify service is running**

Run: `systemctl status barcode-scanner`
Expected: Active (running), logs show "Exclusive grab acquired" and "MQTT connected"

- [ ] **Step 3: Verify keyboard suppression**

Open a text editor or terminal, scan a barcode. No characters should appear in the focused window.

- [ ] **Step 4: Verify MQTT output**

Run: `mosquitto_sub -h localhost -t 'daylight/scanner/barcode'`
Scan a barcode. Expected: JSON message with `barcode`, `timestamp`, `device` fields.

- [ ] **Step 5: Test device recovery**

Unplug scanner, wait 5s, replug. Run `systemctl status barcode-scanner` — should show active. Scan again to confirm MQTT output resumes.
