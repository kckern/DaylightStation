# Adding a new IR device (learning codes)

The ATOM Lite is **transmit-only** — it can't learn codes. To add a new device
(e.g. a ceiling fan), you **capture** its remote's codes with an IR *receiver*,
then paste them into `ir-blasters.yml`. This system ingests **Tuya-format
base64** (what the ESPHome learner emits) or raw µs arrays.

## Step 0 — Confirm the remote is IR, not RF

Point the remote at a phone camera and press a button. A flashing purple/white
light on-screen = **IR** (proceed). Nothing = **RF** (315/433 MHz) → an IR
blaster can't control it; you'd need an RF bridge instead. Ceiling-fan remotes
are frequently RF, so check first.

## Step 1 — Capture the codes (Tuya base64, drop-in)

The office/bedroom ESPHome IR blasters have a **receiver** and expose learn
entities that output the exact format this system decodes:

- `switch.<device>_ir_blaster_learn_ir_code` — learn mode toggle
- `sensor.<device>_ir_blaster_learned_ir_code` — the captured base64

> These are `unavailable` when the ESPHome node is powered down — bring one
> online near where you can aim the remote first.

Per button:
1. Turn the learn switch **on**.
2. Aim the fan remote at the ESPHome blaster, press **one** button.
3. Read `sensor.<device>_ir_blaster_learned_ir_code` — that's the code.
4. Note which button → which code. Turn learn off; repeat.

**Claude can drive this loop for you** — it toggles the learn switch and reads
each captured code via the HA API while you press buttons. Just say the word
once a learner is online.

### Alternatives
- **Broadlink** (app or HA `remote.learn_command`): emits a *different* base64
  (0x26 header, not Tuya/FastLZ) — the current decoder won't read it. Tell Claude
  and it'll add a Broadlink decoder, or capture the raw durations instead.
- **Flipper Zero / any ESPHome `remote_receiver` dump**: paste raw µs durations
  as a YAML array (the `codes:` value accepts an array as an escape hatch).

## Step 2 — Add the device to `ir-blasters.yml`

A ready-to-fill `ceiling-fan:` block is already stubbed (commented) in
`data/household/config/ir-blasters.yml`. Uncomment it, paste the captured codes,
and name them to match the remote (`fan_power`, `fan_light`, `fan_low/medium/high`,
`fan_reverse`, …). Different room ⇒ its own board, so keep it as a separate
blaster key (one ATOM per key).

## Step 3 — Flash the second board

Each blaster key = one physical ATOM Lite. With a second Atom Lite on USB:

```bash
cd _extensions/ir-blaster/firmware
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/config/ir-blasters.yml" ceiling-fan
```

It'll join Wi-Fi and come up at `http://ir-ceiling-fan.local` (mDNS) / its DHCP
IP. Test each button: `curl "http://<ip>/send?code=fan_power"`. **Set a DHCP
reservation** for the IP so HA's rest_command URL stays valid.

## Step 4 — Wire into HA

Add a rest_command (mirror `rest_commands/ir_blasters.yaml`):

```yaml
ceiling_fan_ir:
  url: http://<ceiling-fan-ip>/send?code={{ code }}
  method: GET
  timeout: 5
```

Then call `rest_command.ceiling_fan_ir` with `data: { code: fan_power }` from
scripts/automations. `sh reload_config.sh` (or reload rest_command + scripts) to
apply — no HA restart needed.
