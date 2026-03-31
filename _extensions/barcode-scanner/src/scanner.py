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
import glob
import select
import signal
import logging
import time
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
SCAN_TIMEOUT = float(os.environ.get('SCAN_TIMEOUT', '0.15'))  # seconds of silence to flush buffer
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format='%(asctime)s %(levelname)s %(message)s',
)
log = logging.getLogger('barcode-scanner')

# ── Keycode → character mapping ──────────────────────────────────

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


# ── SNAPI ACK (suppress triple-beep after scan) ─────────────────
#
# Zebra/Symbol scanners in USB HID Keyboard mode still run SNAPI status
# handshaking by default. After transmitting scan data, the scanner waits
# for a host ACK via a HID output report on a secondary hidraw interface.
# If no ACK arrives, the scanner triple-beeps (transmission error).
#
# The ACK is byte 0x02 written to the scanner's hidraw device.
# We find the hidraw by matching the same USB vendor:product (05e0:1200).

SYMBOL_VID = '05e0'
SYMBOL_PID = '1200'
SNAPI_ACK = bytes([0x02])


def find_hidraw_for_scanner():
    """Find the hidraw device node for the Symbol scanner's SNAPI interface."""
    for hidraw in sorted(glob.glob('/sys/class/hidraw/hidraw*')):
        try:
            # Resolve the device path to find the USB vid/pid
            uevent_path = os.path.join(os.path.realpath(hidraw), 'device', 'uevent')
            if not os.path.exists(uevent_path):
                continue
            with open(uevent_path) as f:
                uevent = f.read()
            # Look for HID_ID line: HID_ID=0003:000005E0:00001200
            for line in uevent.splitlines():
                if line.startswith('HID_ID='):
                    parts = line.split('=')[1].split(':')
                    if len(parts) >= 3:
                        vid = parts[1].lstrip('0').lower() or '0'
                        pid = parts[2].lstrip('0').lower() or '0'
                        if vid == SYMBOL_VID and pid == SYMBOL_PID:
                            dev_name = os.path.basename(hidraw)
                            dev_path = f'/dev/{dev_name}'
                            if os.path.exists(dev_path):
                                log.info('Found SNAPI hidraw: %s', dev_path)
                                return dev_path
        except (OSError, IndexError):
            continue
    return None


def open_snapi_device():
    """Open the SNAPI hidraw device for writing ACKs. Returns file descriptor or None."""
    path = find_hidraw_for_scanner()
    if not path:
        log.warning('SNAPI hidraw device not found — scanner may triple-beep after scans')
        return None
    try:
        fd = os.open(path, os.O_WRONLY | os.O_NONBLOCK)
        log.info('SNAPI ACK enabled via %s', path)
        return fd
    except OSError as e:
        log.warning('Cannot open SNAPI device %s: %s — scanner may triple-beep', path, e)
        return None


def send_snapi_ack(fd):
    """Send ACK byte to scanner's SNAPI interface to suppress post-scan error beep."""
    if fd is None:
        return
    try:
        os.write(fd, SNAPI_ACK)
    except OSError as e:
        log.debug('SNAPI ACK write failed: %s', e)


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

    # Open SNAPI hidraw for ACK responses (suppresses triple-beep)
    snapi_fd = open_snapi_device()

    client = create_mqtt_client()

    buffer = []
    shifted = False

    def shutdown(signum, frame):
        log.info('Shutting down (signal %d)', signum)
        try:
            device.ungrab()
        except OSError:
            pass
        if snapi_fd is not None:
            try:
                os.close(snapi_fd)
            except OSError:
                pass
        client.loop_stop()
        client.disconnect()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log.info('Listening for scans (timeout=%.0fms)...', SCAN_TIMEOUT * 1000)

    try:
        while True:
            # Wait for events, with timeout to flush buffer
            timeout = SCAN_TIMEOUT if buffer else None
            r, _, _ = select.select([device.fd], [], [], timeout)

            # Timeout with pending buffer = end of barcode
            if not r:
                if buffer:
                    barcode = ''.join(buffer)
                    publish_barcode(client, barcode)
                    send_snapi_ack(snapi_fd)
                    buffer.clear()
                continue

            for event in device.read():
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

                # Enter = end of barcode (some scanners send it)
                if key_event.scancode == ecodes.KEY_ENTER:
                    if buffer:
                        barcode = ''.join(buffer)
                        publish_barcode(client, barcode)
                        send_snapi_ack(snapi_fd)
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
