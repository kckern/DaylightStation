# Garage RFID2 shell

An M5Stack ATOM Lite class controller (measured ESP32-PICO-D4, 4 MB flash,
MAC `F0:16:1D:02:2A:88`) hosts an M5Stack Unit RFID2 (U031-B, WS1850S) on its
HY2.0 Grove port. This first image is a field-updatable diagnostic shell. It
checks that the reader answers on I²C; it does not yet read tags or emit events.

## Verified bench state (2026-10-03)

- USB serial: `/dev/cu.usbserial-7952C47E3B`
- Board IP when tested: `10.0.0.47` (DHCP; may change after relocation)
- `GET /status`: Wi-Fi connected, `ota.ready: true`, `rfid2.present: true`,
  `rfid2.i2c_error: 0`. An I²C ACK proves electrical communication at `0x28`;
  it does not yet prove that a card can be read.
- A password-authenticated OTA from the Mac and a second OTA originating on the
  garage host both completed. The latter booted build `Oct  3 2026 18:44:15`;
  the garage host queried its `/status` afterward and saw the reader and OTA ready.
- Dual app slots: `min_spiffs.csv`, 1,966,080 bytes each on 4 MB flash. Initial
  image: 832,769 bytes. The partition table was flashed over USB.

## Configuration

Private configuration is at
`$DAYLIGHT_BASE_PATH/data/household/hardware/rfid2.yml`. It contains `device.id`,
`provisioning.wifi_ssid`, `provisioning.wifi_password`, and an enabled
`ota.password`. A template is in [config.example.yaml](config.example.yaml).
The generator writes `firmware/include/config.h` with mode 0600; the header and
`.pio` outputs are ignored by Git. Firmware binaries contain credentials and
must not be published.

## Build and update

From `_extensions/rfid2-relay/firmware`:

```bash
node tools/gen-config.test.mjs
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/hardware/rfid2.yml" --port /dev/cu.usbserial-7952C47E3B
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/hardware/rfid2.yml" --ota --host 10.0.0.47
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/hardware/rfid2.yml" --ota --host 10.0.0.47 --via garage
```

For later updates, use the board's current IP from DHCP or
`garage-rfid2.local` in `--host`. OTA uses an authenticated UDP invitation on
port 3232; the board then opens a TCP connection back to the uploading host.
`--via garage` builds locally, stages the private image in a restricted temporary
directory on the garage host, sends the OTA password through stdin, and removes
the staged files. This works when the development machine cannot accept the
board's return connection directly. Flash writes require the board to itself;
the shell stops HTTP work during an update and reboots into the old image if
the update fails.

After any upload, read `http://<current-ip>/status` and verify a new `build`
timestamp, `wifi.connected`, `ota.ready`, and `rfid2.present`. Keep the board
powered during OTA and retain USB access for recovery if Wi-Fi provisioning or
the partition table ever needs repair.

## Hardware and status

The ATOM's Grove yellow line is GPIO26 (SDA), white is GPIO32 (SCL). The RFID2
uses I²C address `0x28`. The shell probes every two seconds and reports the
latest bus response, count, build, IP, RSSI, reset reason, and OTA readiness at
`GET /status`. The endpoint is intentionally read-only.

Hardware references: [ATOM Lite pin map](https://docs.m5stack.com/en/core/Atom-Lite),
[RFID2 product page](https://docs.m5stack.com/en/unit/rfid2).
