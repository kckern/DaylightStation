# Bluetooth screen (garage)

One screen, `BluetoothScreen`, for every Bluetooth input device on the garage
fitness box: gamepads, keyboard-mode remotes, rings. It opens from three places:

- fitness Settings → **🎮 Controllers** (`ControllersOverlay`);
- the arcade's **🎮 Bluetooth** chip (`ArcadeShell`; Up from the top row of
  games reaches it);
- the in-game menu's **Bluetooth** button (`EmulatorConsole`), which keeps the
  game paused under it.

The three hosts only mount it. Pairing here runs through the host's BlueZ. An
Android screen pairs its pads through the app on that device instead: the
audio-bridge app, or the DaylightStation Android kiosk app on its control port
when the device's `content_control.provider` is `daylight-android`. Both are
described under "Controllers screen" in
[RetroArch integration](../integrations/retroarch.md).

## Config: `media/emulation/input.yml`

Every device word comes from here or from the device. Code never names a
controller or its buttons beyond the generic A/B.

```yaml
controllers:
  - id: example_pad
    label: Example Pad
    match: "Example|vendorid"          # browser gamepad.id regex (input)
    address: "AA:BB:CC:DD:EE:FF"       # this pad's MAC (status badge)
    pairing:
      name: "Example"                  # Bluetooth-name regex; default: match
      mac_prefix: "AA:BB:CC"           # vendor prefix; default: OUI of address
      # pin: "0000"                    # ONLY for a pad that asks for a legacy PIN
      mode: "Android mode"
      wake: "Press START to wake it. It reconnects by itself."
      steps: [ "...", "...", "..." ]   # shown in order under How to pair
      troubleshoot: "..."              # shown when a window fails
  - id: bike_remote_right               # a media / keyboard remote, not a pad
    kind: remote
    label: Bike right remote
    model: Example Remote                # what it calls itself over Bluetooth
    address: "AA:BB:CC:00:00:01"
    placement: "Exercise bike, right side"
    buttons:                             # physical button -> browser KeyboardEvent.key
      plus: AudioVolumeUp
      ...
  - id: stick_remote                     # a remote whose input the kernel drops
    kind: remote
    label: Stick remote
    address: "AA:BB:CC:00:00:03"
    report_decoder:                      # see "Report decoders" below
      att_handle: 0x001f
      buttons: { ButtonA: { byte: 0, mask: 0x10 } }
      axes:
        - { byte: 1, shift: 6, bits: 2, values: { 0: StickUp, 2: StickDown } }
keyboard:                              # key names the games use
  up: ArrowUp
  ...
```

`controllers:` is the garage's whole Bluetooth inventory, one entry per
physical device with its MAC `address`. Two of the same model are told apart
only by `address`, so give each its own entry and a `placement` that says where
it lives. An entry with `kind: remote` is a media or keyboard remote: the
Bluetooth screen takes its label from it, but gamepad status and the arcade's
"controller connected" toasts skip it (`gamepadControllers` in
`controllerStatus.js`). `buttons:` records what each physical button sends, as
the browser's `KeyboardEvent.key`; it is a record for mapping keys to actions
and is what an `emulator:` map refers to (see Remotes as a game controller).
For which remote sent a key, see Per-remote keys.

- `steps` lead into the search: the last step points at **Search for it**.
- `wake` shows under a paired row of that controller while it is asleep.
- `keyboard:` is read by the key test to say which keys games use.
- The API serves the file as is (`GET /api/v1/emulator/library` → `input`),
  read for each request, so edits show on the next screen open.
- Code never writes `input.yml`: the file is hand-commented and a YAML
  round-trip loses the comments. A device with no entry is still listed,
  paired and forgotten like any other; add an entry only to give it a label,
  a PIN or steps.
- A placeholder controller without `pairing.steps` never appears on the screen.

## What the screen shows

| View | What it does |
|---|---|
| List | Paired devices on top (with "Pairing <name>…" while a pairing started elsewhere is running), a **Set up a controller** list with a How to pair entry per configured controller, then **Search for devices** |
| How to pair | The controller's `steps` from `input.yml`, then **Search for it** |
| Search | Live nearby devices; pick one to pair it |
| Pairing | Progress for the one picked address; the passkey in large digits when the device asks for one |
| Test | The key test |

Every row is keyed by address. A paired row shows the name (the `input.yml`
label when the device matches a controller by address, Bluetooth name or
vendor prefix; otherwise its Bluetooth name, or "Unnamed keyboard" /
"Unnamed device"), the type, the last two octets of the address, exactly one
status, **Test** (connected only), **Forget** and **Pair again** (dropped bond).

| Status | Meaning |
|---|---|
| Connected · N% | Bonded, connected and up as an input device (N is the battery, when known) |
| Connecting… | Connected, no input device yet |
| Asleep | A gamepad that is not connected; the `wake` hint shows under it |
| Not connected | Any other kind that is not connected |
| Needs pairing again | The device is dialing in on a bond this box dropped. The kernel logs `Rejected connection from !bonded device`. Held 120 s, since each attempt lasts only a moment |

**Forget** needs two presses within 4 s: the first arms it, the second sends
`bt.remove`. Moving focus away disarms it, and a held Enter presses it only
once. "Forgotten. …" shows for 6 s or until the view changes. While a pairing window is open the satellite refuses a remove
(`success:false, error:'pairing-in-progress'`). A failed remove reports
`error:'remove-failed'`; the raw text stays in the satellite log.

## Search

`bt.scan.request {requestId, action:'start', durationMs}` starts a nearby
search (default 60 s, shown as a countdown with **Stop**); `{action:'stop'}`
ends it. Closing the screen, going Back or picking a device stops it. **A search never
pairs.** When it ends, the rows it heard stay pickable, dimmed and marked
"Last heard in this search." A search whose `done` never arrives ends 5 s
after its end time (`fitness.bt.scan-no-done`, warn), and a bus reconnect ends
a running search (`reason: interrupted`).

The satellite streams `bt.scan.progress`: `{phase:'scanning', durationMs}`,
then `{phase:'nearby', devices:[{address, name, kind, hid, rssi, paired,
connected, ageMs}]}` snapshots, then `{phase:'done', reason}` with `reason` one
of `timeout`, `stopped`, `busy`, `helper-failed`, `helper-crashed`.

Rows show name, type, address tail, signal bars from RSSI (≥ -55 dBm = 4,
≥ -67 = 3, ≥ -78 = 2, ≥ -90 = 1) and a "Paired" badge. By default only
devices with input evidence (`hid`, or an input `kind`) are listed;
**Show everything (N more)** adds the rest.

A device counts as nearby only while BlueZ reports it live in this discovery
(a new object, or a change to its RSSI or advertising data) and drops out 15 s
after the last report. A cached BlueZ device is listed only once it is heard,
never on its cached RSSI (`bt_nearby.py`). A new `nearby` snapshot is sent only when
the set of devices, a name, kind, paired or connected flag, or a signal level in
5 dB steps changes; signal jitter and reordering alone send nothing.

The reconnect loop pauses during a search; the inventory poll keeps going.
Search and pairing never overlap: a pair request stops a running search first,
and a search request that arrives mid pairing window is answered `busy`.

An old satellite does not know the topic and never answers. After 8 s without
a `bt.scan.progress` the screen says "The garage Bluetooth service needs an
update." when `fitness.transport.health` arrived in the last 15 s (the
satellite is alive), otherwise that the service did not answer. The frontend
logs `fitness.bt.scan-no-response` (warn, with `reason`). The wait is longer
than the satellite's 5 s grace for killing a stuck search, and a **Stop**
pressed before any answer ends as stopped, never as an outdated satellite.

## Pairing one device (`mode: 'address'`)

Picking a row sends `bt.pair.request {requestId, durationMs: 30000,
mode:'address', address, targets:[{id, label, pin?}]}`. `targets` carries the
matching configured controller (for its PIN), if any. The helper
(`bt_pair_helper.py`) spawns with that address, discovers classic and Low
Energy together, and touches that address and nothing else.

- **Old bond, connect first.** A device that is paired but not connected is
  tried first: connect, then wait 15 s for an input device. If none comes up it
  has forgotten this box, so the old bond is removed (`stale-bond-removed`,
  at most once, never on a connected device) and it is paired fresh.
- **Passkey on screen.** The helper's agent implements `DisplayPasskey` and
  `DisplayPinCode`. A keyboard that needs a typed code produces a `passkey` or
  `pincode` phase `{device, passkey, entered}`, and the screen shows "Type
  123456 on <name>, then press Enter." in large digits. Devices that ask the
  host for a PIN (`RequestPinCode`) get the target's `pin`, else `0000`.
- **No-input bond removal.** A bond this window made that never becomes an
  input device is removed (`error` code `no-input`, `done.reason: no-input`),
  so the next try starts clean. A bond that existed before the window stays.
- **Success goes straight to the key test.**

`bt.pair.progress` phases: `scanning, seen, found, stale-bond-removed, pairing,
passkey, pincode, agent, retry, bonded, connecting, hid-wait, hid-retry, warn,
already-paired, paired, error, done`. `done.reason` is one of `already-paired`,
`none-found`, `pair-failed`, `no-input`, `unsupported-mode`, `invalid-address`,
`busy`, `helper-crashed`, `helper-failed`, `timeout`, `no-response`. A
successful pair ends with `done` carrying `paired` and no reason.

`error` carries a `code` next to the raw `message`. The screen shows only the
sentence (`ERROR_TEXT` in `bluetoothScreenModel.js`); `message` is logged,
never shown. `<name>` is the device's name.

| Code | Sentence on screen | Next line |
|---|---|---|
| `auth-failed` | "<name> refused the pairing." | Put it back in pairing mode, then search again. |
| `auth-canceled` | "The pairing was cancelled on <name>." | Same |
| `timeout` | "<name> stopped answering." | Same |
| `unreachable` | "<name> could not be reached." | Same |
| `already-paired` | "<name> is already paired." | Find it under Paired devices, or Forget it there and pair it again. |
| `busy` | "Bluetooth was busy." | Wait a moment, then search again. |
| `no-input` | "<name> paired, but no presses came through." | Switch it off and on, put it in pairing mode, then search again. |
| `unknown` | "<name> did not pair." | Put it back in pairing mode, then search again. |

An error line is always followed by the window's one `done`; the screen stays
busy until then. The frontend gives up after 15 s if the box never answers a
pair request (`done.reason: no-response`). A pairing that was answered but
whose `done` never arrives ends 130 s after its window (the helper's own cap is
window + 120 s; `fitness.bt.pair-no-done`, warn), and a bus reconnect ends it
(`reason: interrupted`, "Lost touch with the garage Bluetooth service."), so
Forget, Pair again and the picks are never disabled for good. Progress for an
older request never overwrites the one the screen waits on.

Request modes: `address` (above), `repair` and anything else. A request with
no `mode` is `repair`: the blind, configured-targets window that the backend
route `POST /api/v1/emulator/bt/pair` still sends. The screen never uses it.
`add` mode was retired and is refused with `done.reason: unsupported-mode`; a
malformed address is refused with `invalid-address`. Neither spawns the helper.

### Old satellite

A satellite from before the address mode ignores `mode` and runs a blind
re-pair window. A current satellite's `scanning` always carries `mode`; when an
address request is answered by a `scanning` without one,
`mergePairingProgress` sets `satelliteOutdated` for the rest of that request.
The screen then says the garage Bluetooth service needs an update, whatever
phase follows, and the frontend logs `fitness.bt.satellite-outdated` (warn).

## Configured controllers

**How to pair <label>** shows the `input.yml` steps; **Search for it** then
opens the search with that controller's matching devices (by name regex, MAC
prefix or address) highlighted and listed first. Picking one pairs by address
with the controller's `pin`.

## Key test

Opened after a successful pair or with **Test** on a connected row. It shows
what arrives in short words: keys ("X", "Up arrow", "Volume up", "Play/pause"),
and gamepad presses ("A", "B", "D-pad up", "Stick left", else "Button N") with
the pad's name shortened (no vendor/product suffix). The verdict:

- gamepad input: "Games can use this as a controller."
- keys listed in `input.yml` `keyboard:`: "Games can use these keys: …"
- other keys only: "Games can't use these keys yet."

The test owns the keys while it is open, so nothing else acts on them. It ends
with Escape (a held Escape's repeats are ignored), holding a press key (Enter,
Space, a remote's play/pause) or the pad's back or select button
(`useArcadeInput`'s `BACK_BUTTONS` / `SELECT_BUTTONS`: B; A or Start) for
1.5 s, a touch on **Done**, or 20 s with no presses; the hint says so with the
real idle time. **Done** shows no focus ring: keys are captured there, so A or
Enter would not press it. A browser
gamepad has no Bluetooth address, so pad presses count only when the tested
device is a gamepad.

## Per-remote keys (`bt.remote.key`)

A browser `KeyboardEvent` carries no device identity: Firefox merges every
keyboard into one stream, so two remotes of the same model are
indistinguishable on the page. The garage box reads each Bluetooth remote
straight from the kernel instead (the fitness controller's remote input,
below): every Bluetooth input device that
is not a game pad, its `/dev/input/event*` nodes and its `/dev/hidraw*` node,
tagged with the device's Bluetooth address. Nodes are rediscovered every 2 s,
so a remote that sleeps and reconnects is picked up again. Nothing is grabbed:
keys still reach the browser as before.

Each press is sent on the bus as `bt.remote.key`
(`{ address, name, code, key, usage, state }`: kernel `KEY_*` code, browser key
name, HID usage, `down`/`up`/`repeat`; relayed to screens by
`ClientRelayPolicy`) and logged to the store:

| Event | Level | Meaning |
|-------|-------|---------|
| `bt.remote.key` | info (press), debug (release, repeat) | a key, with the remote's address |
| `bt.remote.unmapped` | warn | a raw HID report with data that became no key: a button Linux drops |
| `bt.remote.open` / `bt.remote.gone` | info | a remote's device node appeared / went away (sleep, reconnect) |
| `bt.remote.gatt` | debug | a raw report read off the radio (`att`, `value`), decoded or not |
| `bt.remote.monitor-unavailable` | warn | the report source cannot open the HCI monitor socket |
| `bt.remote.helper-exit` | warn | a reader exited (`source`); it restarts (1 s doubling to 60 s) |
| `bt.remote.decoders` | info | report decoders loaded from the app (`count`, `ids`): on change, first load, each reconnect |
| `bt.remote.decoders-unavailable` | warn | the decoder fetch failed; the last table stays in use |

Query: `context.module:fitness-controller AND _msg:~"bt.remote"`.

**Input the kernel drops.** Some remotes send input on a HID report that their
own report map does not declare: BlueZ receives it over the air and the kernel
discards it, so neither evdev nor hidraw ever shows it. A second source reads
the HCI monitor channel (read-only, what `btmon` uses; `hcitool con` maps
connection handles to addresses) and takes each ATT notification from a remote
the kernel lists. A remote whose `input.yml` entry has a `report_decoder`
(matched by `address`, never by name) has its reports decoded into ordinary
`bt.remote.key` presses (`key` from the spec, `code: null`,
`usage: gatt:0x001f`, `raw` bytes); every report is also logged at debug as
`bt.remote.gatt`, which is how a new remote's bytes are captured.

### Report decoders

A `report_decoder` says what the bytes of one report channel mean. Code knows
no device: the spec is the whole description.

```yaml
    report_decoder:
      att_handle: 0x001f               # the ATT handle the reports arrive on
      buttons:                         # control -> one bit (mask) of one byte
        ButtonA: { byte: 0, mask: 0x10 }
        ButtonB: { byte: 0, mask: 0x01 }
      axes:                            # an n-bit field -> controls by value
        - { byte: 1, shift: 6, bits: 2, values: { 0: StickUp, 2: StickDown } }
        - { byte: 1, shift: 4, bits: 2, values: { 0: StickLeft, 2: StickRight } }
```

- A button is down while its bit is set. An axis control is down while the
  field `(byte >> shift) & (2^bits - 1)` holds its value; any other value
  (centre) releases it. Presses and releases come from diffing each report
  against the remote's previous one.
- Numbers may be YAML integers (`0x1f`, `31`) or strings (`"0x1f"`). Invalid
  rows are skipped; an entry with no usable control is ignored.
- The control names are what `bt.remote.key` carries as `key`; name them for
  the physical control, then record them under `buttons:` like any remote.
- The app serves the specs at `GET /api/v1/emulator/input/report-decoders`
  (`{ decoders: [{ id, address, report_decoder }] }`, read from `input.yml` per
  request). The garage box fetches them at start, on every socket reconnect
  and every 10 minutes, so an edit applies without a rebuild.
- To describe a new remote: watch `bt.remote.gatt` (debug) for its address
  while pressing each control one at a time, note which byte and bit changes,
  then write the spec.

Worked example, a stick-and-buttons remote in its gamepad mode (the Magicsee
R1 is one: hold M, press B; in its other modes most controls send duplicate
media keys). It presents a media report map over Bluetooth whatever the mode,
so the kernel drops its gamepad reports. Reports are 2 bytes on handle
`0x001f`: byte 0 one bit per button (A `0x10`, B `0x01`, C `0x08`, D `0x02`,
circle trigger `0x40`, back trigger `0x80`), byte 1 the stick (bits 7-6 Y:
0 up, 1 centre, 2 down; bits 5-4 X: 0 left, 1 centre, 2 right). So `0050` is
idle, `1052` A down, `0010` stick up. It matches UbiquityRobotics/bt_joystick
and the libretro `Magicsee_R1.cfg` mode note.

### Structure (fitness controller)

Remote input follows ports and adapters
([DDD reference](../core/layers-of-abstraction/ddd-reference.md)), under
`satellites/fitness-controller/src/remote-input/`:

| Path | Role |
|------|------|
| `ports/IRemoteInputSource.mjs` | the port: `start({ onEvent })`, `stop()`, an `id`; emits normalized events (`control` with `address, control, state, source, raw`; `device-open`, `device-gone`, `unrecognized`, `report`, `unavailable`, `source-exit`); `isRemoteInputSource()` guard |
| `adapters/LinuxEvdevRemoteSource.mjs` | kernel evdev keys + hidraw reports; the kernel `KEY_*` → browser key table |
| `adapters/BluezGattReportSource.mjs` | ATT reports off the HCI monitor, decoded per address by `setDecoders()` |
| `adapters/remote_keys_helper.py` | the one Python reader both adapters run, in `kernel` or `gatt` mode |
| `adapters/helperProcess.mjs` | spawns the helper, splits lines, restarts it |
| `reportDecoder.mjs` | the generic spec decoder (no device, no OS) |
| `decoderConfig.mjs` | keeps the decoder table current from the app |
| `RemoteInputService.mjs` | the application service: composes the sources it is given, logs `bt.remote.*`, sends `bt.remote.key`; knows no vendor, OS tool or device |

`server.mjs` builds the two adapters, hands them to `startRemoteInput`, and
wires `decoderConfig` to the report adapter. Tests: `test/remoteInput.test.mjs`
(port contract per adapter with fake helper lines, the decoder on captured
bytes, the service with a fake source).

The key test uses this feed when the host provides it
(`bluetooth.subscribeRemoteKeys`): a key counts only when the tested remote's
address sent it; a press from another remote shows as "(another remote …00:02)"
and does not count. The browser's own copy of a press is matched to its tagged
twin within 400 ms (either order) and dropped; a browser key with no twin
counts, so a device the garage box does not read still tests
(`createKeyAttributor` in `keyTestModel.js`).

### Remote directions (`positions:` and `toward:`)

A `kind: remote` entry may say where each button sits for the rider:
`buttons:` (physical button → key), `positions:` (rider's `up` / `down` /
`left` / `right` / `center` → physical button) and `toward:` (`front` / `rear`
→ the ring position toward the equipment's front or rear). Two remotes of one
model mounted mirror-image differ only in these maps, so both resolve a press
the same way. `lib/remoteInput/remoteDirection.js` in the fitness app is the
shared resolver (key → button → position → front/rear); a remote with no
`toward` reports its positions, one with no `positions` reports nothing.

Games read remotes through the port `IRemoteDirectionSource`
(`lib/remoteInput/`): `subscribe(listener)` delivers `{type:'ready', sources}`
and `{type:'press', sourceId, direction, position, state}`. The fitness host's
adapter is `BluetoothRemoteDirectionSource` (this feed + the inventory); while
subscribed it stops its remotes' untagged browser copies at the window.

### Who owns a remote's presses

More than one layer may want a remote's presses (a game in flight, a
per-remote button mapping, the Bluetooth screen trying a remote). They agree
through `lib/remoteButtons/remoteButtonHolds.js` in the fitness app:

| Call | Meaning |
|---|---|
| `holdRemoteButtons(reason)` → `release()` | every remote belongs to the caller (Skyline Glider while mounted with a remote mapping, `reason: 'skyline-glider'`) |
| `claimRemote(address)` → `release()` | one remote belongs to the caller (the Bluetooth screen while that remote's page is open) |
| `bluetooth.claimRemoteKeys(address, fn)` → `release()` | one remote's presses are delivered only to the caller, and `claimRemote(address)` is held meanwhile (the arcade while a game plays, for each remote with an `emulator:` map; see Claiming a remote) |
| `isRemoteHeld(address)` | a hold, or that address's claim, is on |
| `remoteButtonHolds()` / `isRemoteClaimed(address)` | the reasons on hold / the claim alone |

**Any layer that turns `bt.remote.key` presses into actions must check
`isRemoteHeld(address)` before acting, and perform nothing when it is true.**
Holds and claims are counted, so each holder releases only its own. Skyline
Invaders ignores remotes in a round (it reads no remote at all; a mapping
layer that acts on remotes should take a hold for its rounds).

### Claiming a remote

`bluetooth.claimRemoteKeys(address, fn)` (next to `subscribeRemoteKeys` on the
host's `bluetooth` object, `useFitnessBluetooth`) takes one remote's presses
exclusively until the returned release is called: while a remote is claimed,
its `bt.remote.key` messages go only to the newest claimant and never to the
`subscribeRemoteKeys` listeners, so no other remote-mapping layer acts on them.
Presses from other remotes fan out as before. Claims nest (newest wins; a
release hands the presses back to the previous claimant). It also takes
`claimRemote(address)` in `remoteButtonHolds.js` for as long, so a layer that
checks `isRemoteHeld(address)` stands down too (Who owns a remote's presses,
above). The arcade claims each remote with an `emulator:` map while a game is
playing (next section).

### Remotes as a game controller (`emulator:`)

A remote the browser Gamepad API never sees can still play the arcade's
browser games when the garage box reads it (`bt.remote.key`). Give its
`input.yml` entry an `emulator:` map, physical control → RetroPad button:

```yaml
  - id: example_remote
    kind: remote
    address: "AA:BB:CC:00:00:01"
    buttons:                    # physical control -> bt.remote.key name
      upper_trigger: Trigger1
      lower_trigger: Trigger2
      a: Button1
      stick_up: StickUp
      ...
    emulator:                   # physical control -> RetroPad button while a game plays
      stick_up: up              # up down left right a b x y l r start select
      upper_trigger: a
      lower_trigger: b
      a: start
      systems:                  # optional: per-system overrides merged over the rest
        genesis: { a: start }
```

- Keys of `emulator:` are the entry's `buttons:` names (a name not in
  `buttons:` is taken as the `bt.remote.key` name itself). Values are RetroPad
  buttons; an unknown one is dropped. Any remote, any key names: the code
  names no device.
- The buttons are RetroPad positions, not console labels: each core maps the
  RetroPad onto its console. On a Genesis core RetroPad B / A / Y are Genesis
  B / C / A (X, L, R are the 6-button pad's Y, X, Z), so a remote whose two
  main controls are `a` and `b` plays the Genesis on B and C; on a SNES core
  the names are the same as the console's. Use `systems:` only when a core
  needs something different.
- Only while the game is **playing**: not paused, the game menu, reset
  confirm or recovery list closed, governance playable. During that time each
  mapped remote is claimed (above). In menus the remote does what it does
  everywhere else.
- Holds follow down/up exactly (a held stick is a held D-pad). Two controls on
  one button keep it held until both are up; a `repeat` without a `down`
  counts as the down; an `up` without a `down` is ignored. Every held button
  is released when the game stops playing, on unmount, when the window loses
  focus or is hidden, and when the remote shows `connected: false` in the
  inventory, so nothing sticks.

Structure (ports and adapters): `input/remoteEmulatorInput.js` resolves the
maps and tracks holds, vendor-free, against the `IEmulatorInput` port
(`ports/IEmulatorInput.js`: `press(button)`, `release(button)`,
`releaseAll()`, `isReady()`, `isEmulatorInput()`). `input/useRemoteEmulatorInput.js`
claims the remotes and feeds the tracker. `adapters/EmulatorJSInputAdapter.js`
is the only EmulatorJS-specific part: it turns a RetroPad button into
EmulatorJS's control index and presses it through EmulatorJS's own input API
(`gameManager.simulateInput`, wrapped as `engine.pressInput`), the call its
keyboard and gamepad handlers make; the input LED counts it like any pad press.
`EmulatorConsole` injects the adapter. Another emulator gets its own adapter.

Logs (component `emulator-console`): `emulator.remote.mount` / `.unmount`
(claim taken / released, with the remote ids and system),
`emulator.remote.input` (the first press of each playing stretch at info,
then sampled), `emulator.remote.stuck-release` (warn: buttons released by
focus loss, pause, unmount or disconnect, with `reason` and count). The host
logs `fitness.bt.remote-claim` / `-unclaim` at debug.

The desktop must not grab media keys: on garage the XFCE PulseAudio panel
plugin had `enable-keyboard-shortcuts` and `enable-multimedia-keys` on, which
took volume and play/next/previous before Firefox saw them. Both are off
(`xfconf-query -c xfce4-panel -p /plugins/plugin-12/...`).

## Navigation

`useScreenNav` owns all navigation inside the screen, the same in every host:

- window-level capture-phase keys (`stopImmediatePropagation`, so no other
  listener sees them): arrows and Tab move with wrap, Enter presses, Escape and
  Backspace go back; a held Enter or Escape acts once (key repeats are
  ignored); a media remote's next / previous track move and play/pause
  presses;
- gamepad through `useArcadeInput` (D-pad or left stick, A or Start presses,
  B goes back), with the opening press ignored, so the B that closed one
  screen does not also act on the next. A stick axis counts only after it has
  been seen within ±0.25 of centre, so a pad whose axis rests at ±1 neither
  holds an arrow forever nor masks the D-pad;
- focus is put back on the default control after any render that left it on
  the page body or on a disabled control, so focus never falls to `<body>`.

A host switches its own input off while the screen is open (arcade grid, game
menu, fitness sidebar and menu gamepad hook). In a game the screen opens over
the paused game menu; closing that menu (✕ or the backdrop) closes the screen
too, so the game never runs under it. The fitness host reads the `bluetooth`
object from `FitnessBluetoothContext` (`useFitnessBluetoothState()`), its own
context, so a search's progress re-renders only the screen; the main fitness
context keeps only `btInventory`. The fitness overlay
(`ControllersOverlay`) is a body-portalled dialog at z-index 2250: above the
player, sidebar and toasts (2200), below the lock and unlock screens (2300) and
the emergency lockdown (4000).

## Inventory

`bt_inventory` carries all *bonded* devices, plus any device connected right
now without a bond. Each row has `address, name, connected, battery, paired,
trusted, gamepad, kind, input, hid`:

- `kind`: from the BlueZ `Icon` line. `input-gaming` → `gamepad`,
  `input-keyboard` → `keyboard`, `input-mouse` → `mouse`, `input-tablet` →
  `tablet`, anything else `null`.
- `hid`: a HID service UUID is listed, classic (`0x1124`) or HID over GATT
  (`0x1812`). It holds while the device sleeps.
- `input`: a kernel input node exists for the device right now (see HID-up
  check).

The satellite sends it when it changes and when its own WebSocket reconnects.
The backend relays bus topics with no memory, so a page loaded later asks:
`bt.inventory.request {requestId}` is sent on screen mount and on every bus
reconnect, and the satellite re-sends the inventory (`resend()`).

**Reconnect rule.** Every bonded, trusted input device that is not connected
(`shouldReconnect`: a gamepad, keyboard, mouse, tablet, or any device with a
HID service) is reconnected with `bluetoothctl connect`, backoff 30 s doubling
to a 10 min cap. A sleeping gamepad wakes on its wake key and reconnects by
itself. The inventory poll and reconnect loop pause for a pairing window; a
search pauses only the reconnect pages.

## HID-up check

`input_device_present` scans `/proc/bus/input/devices` block by block:

- A block whose `U: Uniq=` equals the device's MAC counts.
- Fallback: a Bluetooth block (`I: Bus=0005`) whose Uniq is blank or missing
  counts when its `N: Name=` equals BlueZ's own `Name` for the device exactly.
  The fallback never uses the config label or the address. Some LE
  (HID-over-GATT) stacks leave Uniq empty.

The inventory's `input` field (`hasInputDevice` in `btInventory.mjs`) applies
the same rule, with the device's BlueZ name from the inventory, so a device the
helper called paired is not shown as "not up". Change both or neither.

Unverified, to be checked on the garage box: whether a BLE ring remote's input
device carries a Uniq, and whether BLE devices reconnect by themselves after
sleep.

## Agents never fight

- Every one-shot `bluetoothctl` the satellite runs passes `--agent off`, so it
  cannot register an agent and steal the default.
- The helper's agent exists only while the helper runs, and it unregisters on
  exit. Bonds live in the host's BlueZ (`/var/lib/bluetooth`, reached over the
  mounted D-Bus socket), so they survive satellite restarts. No agent is needed
  between windows, because a bonded, trusted pad reconnects without one.
- Never use bluetoothctl's `NoInputNoOutput` agent for these pads. It answered
  a PIN request with garbage (`Invalid PIN length (23) from agent`) and left
  the pad connected and trusted but unbonded.


## Deploy order

The satellite first, then the app. A new app against an old satellite still
works for paired devices but cannot search or pair by address (the screen says
the service needs an update, see Old satellite). A new satellite against the old
app is harmless: it answers only the topics it is sent. `npm test` in the
satellite directory runs the Node suite and then the Python suite (the pure
rules `bt_pair_match.py` and `bt_nearby.py` have no D-Bus imports).

## Logs

- Satellite (`docker logs` of the fitness satellite container):
  `🎮 bt.scan …`, `🎮 bt.pair …`, `🎮 bt.inventory.request …`, `🎮 bt.reconnect …`.
- Frontend (component `fitness-bluetooth`): `fitness.bt.scan-request`,
  `.scan-progress`, `.scan-nearby` (sampled), `.scan-stop`, `.scan-no-response`
  (warn), `.inventory-request` (debug), `.pair-request` (with `address`),
  `.pair-progress` (with `code`), `.pair-no-response`, `.pair-no-done` (warn),
  `.pair-reset`, `.scan-no-done` (warn), `.scan-reset`, `.satellite-outdated`
  (warn), `.remove-request`, `.remove-result`.
- Screen (component `bluetooth-screen`): `.mount` (host, controllers,
  inventory, available), `.unmount`, `.scan-start`, `.scan-stop` (reason),
  `.nearby` (sampled: heard, shown), `.pick`, `.pair-result` (outcome, code,
  reason), `.test-start`, `.test-result` (keys, distinctKeys, padInputs,
  verdict), `.forget-arm`, `.forget-confirm`, `.focus-recovered` (debug).
- Screen also logs `.view` on every view change.
- Hosts: `arcade.bluetooth-open/close/toggle`;
  `emulator.console.bluetooth-open/close`.
- Example LogsQL: `query=context.component:bluetooth-screen AND _time:1h`.
- Kernel/BlueZ on the garage host: `journalctl -u bluetooth`. Look for
  `hidp_add_connection() Rejected connection from !bonded device`.

## Host leftovers

`sfc30-reconnect.timer` / `.service` on the garage host used to run `bluetoothctl
connect <address>` every 60s: MAC hard-coded, racing pairing windows,
paging a sleeping pad forever. The satellite reconnect loop replaces it. Once
the satellite carrying that loop is running, disable it with
`systemctl disable --now sfc30-reconnect.timer`.
