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
keyboard:                              # key names the games use
  up: ArrowUp
  ...
```

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
