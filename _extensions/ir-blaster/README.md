# ir-blaster — config-driven ATOM Lite IR transmitter

An **M5Stack ATOM Lite** (ESP32-PICO-D4) that emits named IR codes on its
**onboard IR LED (GPIO12)** over a simple HTTP endpoint. Codes are stored in the
household SSOT as **Tuya-format base64** (the same encoding the office HA scripts
already write into the ESPHome IR-blaster text entity), decoded host-side into
raw microsecond timings, and replayed via IRremoteESP8266's `sendRaw` at a
38 kHz carrier.

No host daemon — **firmware only**, config-driven from
`data/household/config/ir-blasters.yml`. Nothing is hardcoded.

```
HTTP GET /send?code=power ──▶ ATOM Lite ──IR LED(G12, 38kHz)──▶ Office TV
                                  ▲
                    HA rest_command / curl / DaylightStation backend
```

## Why reuse the existing codes (not "learn")

The ATOM Lite's IR LED is **transmit-only** — there is no receiver, so it cannot
*learn* codes. It doesn't need to: the working office-TV codes already live in
`office_tv_on.yaml` / `office_tv_off.yaml`. They're **NEC** codes in Tuya base64
(power toggle + HDMI 1/2/3). We copy those into the SSOT and replay them. To add
a code from a device you *don't* already have a blob for, capture it once with an
IR receiver (a Broadlink, an ESPHome `remote_receiver`, or the existing "learn"
switch on the office ESPHome blaster) and paste the resulting base64 in.

## IR vocabulary vs. HA orchestration

This device speaks only the **raw IR codes**: `power` (a toggle), `hdmi1`,
`hdmi2`, `hdmi3`. The TV has no discrete on/off — just a power toggle. The
"turn on, confirm via `binary_sensor.office_tv_state`, retry, plug-cycle as a
fallback" logic stays in the HA scripts (`office_tv_on` / `office_tv_off`),
which already own the power sensor and the smart plug. Point those scripts at
this device instead of the ESPHome text entity (see **Wiring into HA** below).

## HTTP API

| Method | Path | Result |
|--------|------|--------|
| GET | `/` or `/health` | `{ id, ip, uptime_ms, sends, last_code, codes:[...] }` |
| GET | `/send?code=NAME` | transmit `NAME`; `{ ok, code, id }` (404 if unknown) |

Reachable at `http://<esp-ip>/` or, via mDNS, `http://ir-office-tv.local/`.

```bash
curl "http://ir-office-tv.local/send?code=power"
curl "http://ir-office-tv.local/send?code=hdmi3"
```

## Build & flash

Prereqs: PlatformIO (`pio`), Node, the ATOM on USB (`/dev/cu.usbserial-*`).

```bash
cd firmware
# one shot: gen config from SSOT, build, upload (autodetects port)
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/config/ir-blasters.yml" office-tv

# or step by step
node tools/gen-config.mjs "$DAYLIGHT_BASE_PATH/data/household/config/ir-blasters.yml" office-tv
pio run -e m5-atom -t upload --upload-port /dev/cu.usbserial-XXXX
pio device monitor -b 115200        # watch [wifi]/[http]/[ir] logs
```

## Status LED (onboard SK6812, GPIO27)

| Color | Meaning |
|-------|---------|
| red | no Wi-Fi |
| green | Wi-Fi up, idle |
| blue flash | IR code transmitted |

## Config — `data/household/config/ir-blasters.yml`

Keyed by blaster id (plural — a second TV/projector is just another key + another
ATOM). Holds Wi-Fi creds and a `codes:` map of name → Tuya base64 (or a raw µs
array). Schema/example: [`config.example.yml`](config.example.yml). The generated
`firmware/include/config.h` is gitignored.

## Adding another device / room

Each blaster key in `ir-blasters.yml` = one physical ATOM Lite. To add a new
device (a ceiling fan in another room, a soundbar, …), capture its codes with an
IR receiver and add a new key. Full walkthrough — including the IR-vs-RF check
and driving the ESPHome learner — is in **[LEARNING.md](LEARNING.md)**. One ATOM
can also hold *multiple* devices' codes if they share line-of-sight.

## Wiring into HA

The existing `office_tv_on` / `office_tv_off` scripts send a code by writing it
to `text.office_tv_ir_blaster_ir_code_to_send`. To drive this device instead,
add a `rest_command` and swap those `text.set_value` steps for it:

```yaml
rest_command:
  ir_office_tv:
    url: "http://ir-office-tv.local/send?code={{ code }}"
    method: GET
# then, in the scripts: service: rest_command.ir_office_tv  data: { code: power }
```

Both blasters face the TV, so you can run them in parallel during cutover and
retire the ESPHome one once this proves reliable.
