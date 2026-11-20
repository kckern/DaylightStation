# Controller pairing (garage arcade)

How a Bluetooth game controller, or any other Bluetooth input device, gets
paired, bonded, connected and kept connected on the garage fitness box, and how
to read what state it is in.

The **Controllers** panel (`ControllerStatus`) is the only pairing path anyone
should need. It opens from three places:

- the arcade's controller chip (🎮 top of the Video Games screen, `ArcadeShell`);
- fitness Settings → **🎮 Controllers** (`ControllersOverlay`, see below);
- the in-game emulator menu (`EmulatorConsole`), when the fitness host wires
  its pairing handler (`EmulatorGameWidget` does).

This page is the garage box, where pairing runs through the host's BlueZ. An
Android screen pairs its pads through the app on that device instead: the
audio-bridge app, or the DaylightStation Android kiosk app on its control port
when the device's `content_control.provider` is `daylight-android`. Both are
described under "Controllers screen" in
[RetroArch integration](../integrations/retroarch.md).

## Config: `media/emulation/input.yml`

Every controller-specific word lives in the controller's entry. Code never names
a controller.

```yaml
controllers:
  - id: 8bitdo_sfc30
    label: 8BitDo SFC30
    match: "8Bitdo|SFC30|2dc8"        # browser gamepad.id regex (input)
    address: "E4:17:D8:C6:54:F0"      # this pad's MAC (OS status badge)
    pairing:
      name: "8Bitdo|SFC30"            # Bluetooth-name regex; default: match
      mac_prefix: "E4:17:D8"          # vendor prefix; default: OUI of address
      # pin: "0000"                   # ONLY for a pad that asks for a legacy PIN
      mode: "Android mode"
      steps: [ "...", "...", "..." ]  # shown in order in the Pair panel
      troubleshoot: "..."             # shown when a window fails
```

The API serves the file as is (`GET /api/v1/emulator/library` → `input`), and
it is read for each request, so edits show up on the next panel open without a
restart. The 8BitDo SFC30 pairs "just works": it never asks for a PIN, so none
is configured.

A device paired through **Add a new device** needs no entry here. It is listed
and can be forgotten without one. Add an entry by hand only to give it a label,
a PIN or a button mapping. Code never writes `input.yml`: the file is
hand-commented, and a YAML round-trip loses the comments.

## Two ways to pair

| | Re-pair a configured controller | Add a new device |
|---|---|---|
| Button | **🎮 Pair controller**, then the controller's guide | **➕ Add a new device** |
| `mode` | `repair` (the default; anything not `add` is `repair`) | `add` |
| Steps shown | The controller's `steps` from `input.yml` | Generic steps (`ADD_DEVICE_STEPS`): pairing mode, pick the mode first if it has a mode button, keep it close |
| `targets` | The chosen controller's name regex, MAC prefix, PIN | Every configured controller's (so a configured model's PIN still applies) |
| Search | Classic Bluetooth only (`Transport: bredr`) | Classic and Low Energy together (`Transport: auto`) |
| Unlisted devices accepted | Gamepads only: Icon `input-gaming`, a peripheral gamepad/joystick Class (even when the Icon says keyboard), or a gamepad-like name | Any HID kind (gamepad, keyboard, mouse, tablet, remote), but only with HID evidence: an `input-*` Icon, a peripheral Class, an LE HID Appearance or a HID service UUID (`hid_evidence`). A gamepad-like name alone is not enough, so a BLE light strip called "LED Controller" is never paired |
| Existing bond | A bonded pad that turns up discoverable and unconnected has forgotten us, so its stale bond is removed | Never touched (see Bond guard) |
| Already up | A configured pad that is bonded, connected and up as an input device ends the window at once: `done.reason: already-paired`. The panel says it is already connected and points at Add a new device | No short-circuit |

After an add, the device appears under **Other Bluetooth devices** with
**Forget**.

### Where Add shows (`canAdd`)

`ControllerStatus` renders **Add a new device**, the add panel and **Add
again** only when its `canAdd` prop is true, meaning the host's `onPair`
honours `mode: 'add'`. A host that ignores `mode` would run a re-pair window
and report "no new device".

| Host | `canAdd` |
|---|---|
| Arcade (`ArcadeShell`) | true when the host passes `onPairController` |
| Fitness Settings → Controllers (`ControllersOverlay`) | true when the fitness context has `pairController` |
| In-game menu (`EmulatorConsole`) | true only when the host passes `onPairController`. `EmulatorGameWidget` passes the fitness WebSocket path. Without it the console falls back to the legacy `POST /api/v1/emulator/bt/pair`, which sends no `mode`, so Add is hidden |

### Panel behaviour

- The status line's wording follows the window's mode: "Looking for the
  device…" and "No new device found…" for an add, the controller wording for a
  re-pair. FitnessContext's `mergePairingProgress` keeps `mode` on every
  message of a window (only the first carries it), so a remounted panel still
  knows which kind of window is running. A different request never inherits it.
- A garage box running an older satellite ignores `mode` and runs a re-pair
  window for an add request, so its "Paired …" would be false. A current
  satellite's `scanning` always carries `mode`; when an add request is
  answered by a `scanning` without one, `mergePairingProgress` sets
  `satelliteOutdated` and keeps it for the rest of that request. The panel then
  says "The garage box needs an update before it can add new devices. Pairing a
  listed controller still works." whatever phase follows, and the frontend logs
  `fitness.bt.satellite-outdated` (warn).
- Opening the add panel or a guide over a finished window hides that window's
  result. Starting a new request shows results again.
- When the add panel or a guide opens, its start button takes focus.
- Pair, Add, Add again and every Forget are disabled while a window runs
  (`pairingStatus(...).busy`), whatever the phase.

## Lifecycle

| Stage | What happens | Where |
|---|---|---|
| Guide | Pair shows the config `steps` first. "It's blinking — start pairing" opens a window. Add shows the generic steps; "Start search" opens a window | `ControllerStatus.jsx`, `pairingGuide.js` |
| Request | `bt.pair.request {requestId, durationMs: 60000, mode, targets}`. `targets` = name regex, MAC prefix and optional PIN for each controller | `FitnessContext.pairController`, `fitnessBtActions.js` |
| Discover | The satellite spawns `bt_pair_helper.py` with `{targets, durationMs, mode}`. Discovery transport is `bredr` for repair and `auto` (classic + LE) for add. It considers only devices reported live in this discovery, never a cached RSSI | `satellites/fitness-controller/src/bt_pair_helper.py` |
| Match | Which device a window may touch (`match`, `classify_hid`, `hid_evidence`, `candidate_action`). A device that is paired *and* connected is skipped in both modes | `bt_pair_match.py` |
| Agent | A D-Bus `org.bluez.Agent1` is the default agent for the window. It accepts `AuthorizeService` (HID 0x1124: if refused, HID never comes up), confirms SSP, and answers `RequestPinCode` with the target's `pin` (fallback `0000`) | helper |
| Pair | `Device1.Pair` while discovery is live. On AuthenticationFailed/Rejected/Canceled, ConnectionAttemptFailed, InProgress or AlreadyExists it removes the device, rediscovers and retries **once**. In add mode AlreadyExists is final, since the device is already bonded. In repair mode a bonded pad that turns up discoverable and unconnected has its stale bond removed first | helper, `is_retryable` |
| Bond + trust | `Trusted = dbus.Boolean(True)` (a plain bool fails with signature `ssb`). It then requires `Paired` AND `Bonded` | helper |
| HID up | `Connect`, then waits 15s for an input device in `/proc/bus/input/devices`. If none appears: disconnect, reconnect, wait once more. **Success means an input device exists**, not just "Connected" (see HID-up check) | helper, `input_device_present` |
| Progress | Each transition is one JSON line, relayed as `bt.pair.progress`. `scanning` carries `mode`. The window always ends with exactly one `done`, even if the helper crashes or never starts. The frontend gives up after 15s if the box never answers (`reason: no-response`) | `btPairing.mjs` |
| Reconnect | The satellite reconnects bonded, trusted gamepads (Icon `input-gaming`) that are not connected, with backoff of 30s doubling to a 10 min cap. A sleeping 8BitDo (asleep after 1 min unconnected or 15 min idle) wakes on START and reconnects by itself. Other kinds (a keyboard-mode remote, for example) are not in this loop | `btInventory.mjs` |
| Pause | The inventory poll and reconnect loop pause for the whole window, so nothing else talks to BlueZ during a pair. One window runs at a time | `server.mjs` `onWindow` |
| Forget | `bt.remove` → `bluetoothctl --agent off remove`. The panel then says how to pair again: Pair controller for a configured pad, Add a new device for anything else. Forget is offered only for a bond that exists. While a pairing window is open the satellite refuses it (`success:false, error:'pairing-in-progress'`, logged as a warn) and the panel says to try again when the search ends | `handleBtRemoveRequest` |

The matching rules live in `bt_pair_match.py`, which has no D-Bus imports so
they are unit-tested (`test/test_bt_pair_match.py`). `npm test` in the
satellite runs the Node suite and then the Python suite.

`bt.pair.progress` phases: `scanning, seen, found, stale-bond-removed, pairing,
agent, retry, bonded, connecting, hid-wait, hid-retry, warn, already-paired,
paired, error, done`. `done.reason` is one of:

- `already-paired`: repair mode only. A configured pad was already bonded,
  connected and up, so nothing was done. `done.paired` lists it.
- `none-found`: nothing in pairing mode turned up. The panel points at the
  fast-blinking LED.
- `pair-failed`
- `no-input`
- `helper-crashed`
- `helper-failed`
- `timeout`
- `no-response`

A successful pair ends with `done` carrying `paired` and no reason.

### HID-up check

`input_device_present` scans `/proc/bus/input/devices` block by block:

- A block whose `U: Uniq=` equals the device's MAC counts.
- Fallback: a Bluetooth block (`I: Bus=0005`) whose Uniq is blank or missing
  counts when its `N: Name=` equals BlueZ's own `Name` for the device exactly.
  The fallback never uses the config label or the address. Some LE
  (HID-over-GATT) stacks leave Uniq empty.

The inventory's `input` field (`hasInputDevice` in `btInventory.mjs`) applies
the same rule, with the device's BlueZ name from the inventory, so a device the
helper called paired is not shown as "not up". Change both or neither.

The repair-mode short-circuit uses the MAC check only.

Unverified, to be checked on the garage box: whether a BLE ring remote's input
device carries a Uniq, and whether BLE devices reconnect by themselves after
sleep.

### Bond guard (add mode)

An add window never deletes a bond that existed before it:

- A device already paired when it turns up is skipped (`candidate_action`).
- `AlreadyExists` from `Pair` is final, not a retry.
- On a `Pair` error, the helper re-reads `Paired` before removing anything,
  since it may have changed. If it is paired now, the window ends with
  `pair-failed` and the message "is paired now — left in place; use Forget if
  it does not work". `consider()` only pairs unpaired devices, so a bond seen
  here is most likely this window's own, landing late after the error; it may
  also be one made elsewhere in the meantime. Either way the helper cannot tell,
  so it fails closed and leaves the bond for a person to Forget.
- If that re-read fails, only `UnknownObject` or `UnknownMethod` (the device
  object is gone) count as "not paired". Any other D-Bus error, such as NoReply
  from a busy bluetoothd, counts as paired, so the device is left alone
  (`paired_after_read_error`).
- A bond this window's own `Pair` made but that then failed trust, or came back
  not bonded, is half-made and is removed (`may_remove_bond(mode, paired_now,
  made_here)`). Otherwise it would show as paired and every later add window
  would skip it.

Repair mode keeps its old behaviour: a failed attempt may always remove the
device.

## Status a controller row can show

From `bt_inventory`: all *bonded* devices, plus any device connected right now
**without** a bond. Each row carries `address, name, connected, battery,
paired, trusted, gamepad, kind, input, hid`:

- `kind`: from the BlueZ `Icon` line (the panel also labels a `remote` kind
  "Remote"). `input-gaming` → `gamepad`,
  `input-keyboard` → `keyboard`, `input-mouse` → `mouse`, `input-tablet` →
  `tablet`, anything else `null`.
- `hid`: true when `bluetoothctl info` lists a HID service UUID, classic
  (`0x1124`) or HID over GATT (`0x1812`). It holds while the device sleeps.
- `input`: a kernel input node exists for the device right now, by the
  HID-up check's rule (Uniq = MAC, or the blank-Uniq Bluetooth name fallback).

| Badge | Meaning |
|---|---|
| Ready | Bonded, connected and up as an input device |
| Connecting… | Bonded and connected; input device not up yet |
| Asleep — press START to wake | Bonded, not connected |
| Not paired — trying to connect | The pad is dialing in on a bond this box dropped. The kernel logs `Rejected connection from !bonded device` and the pad can't be used. The row offers **Pair** with the steps. A sighting is held for 120s, since each attempt lasts only a moment |
| Not paired | No bond |

### Other Bluetooth devices

Inventory rows that no configured controller claims are listed under **Other
Bluetooth devices** when `kind` is an input kind (gamepad, keyboard, mouse,
tablet) or `hid` is true (`otherBtDevices` in `pairingGuide.js`). `input` alone
never qualifies a device: a speaker's AVRCP remote-control node is a kernel
input device. Speakers and other non-input bonds stay out of the list, so
nobody forgets them here.

Each row shows the name (or address), the kind ("Controller", "Keyboard mode",
"Mouse mode", "Tablet", "Remote"), and a badge: Ready, Connecting…, Not connected, or
Not paired — trying to connect. A bonded row offers **Forget**. An unbonded row
offers **Add again** (which opens the add panel) when the host can add.

## Fitness Settings → Controllers

The Tools row of the fitness Settings menu is one row of three: Feedback,
Controllers, Reload. **🎮 Controllers** opens `ControllersOverlay`, a
body-portalled dialog at z-index 3000 (above the player, sidebar and toasts).
It loads `input.controllers` from `GET /api/v1/emulator/library` and mounts the
same `ControllerStatus` with the fitness context's inventory, pairing state,
`pairController` and `forgetController`. If the library fails to load it says
so, and Add a new device still works.

- Close is focused on open.
- Arrow keys and the gamepad move between enabled buttons (wrapping), Enter or
  A presses, Escape or B closes. Tab and Shift+Tab stay inside the dialog.
- The menu's own gamepad hook is off while the overlay is open.
- When a pairing phase change disables the focused button (Start search, a
  guide's start), the browser drops focus to the page. The overlay puts it back
  on Close, unless focus is already on an enabled control inside the panel.
- Closing returns focus to the Controllers menu item, and the menu then idles
  closed as it does after Feedback.

Gamepad keys come from `useGamepadKeys`: D-pad, and the left stick (axes 0/1,
past half deflection) as arrows; A = Enter, B = Escape. A button already held
when a screen's hook switches on needs a release and a new press before it
fires, so the B that closed one screen does not also close the next.

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

## Logs

- Satellite (garage `docker logs daylight-fitness`): `🎮 bt.pair <phase> <mac>`,
  `🎮 bt.pair.request received (… mode=…)` and `🎮 bt.reconnect …`.
- Log store, frontend:
  - `fitness.bt.pair-request` (requestId, durationMs, controllerId, `mode`,
    targets), `fitness.bt.pair-progress` (phase, address, attempt, reason,
    message, `mode`), `fitness.bt.satellite-outdated` (warn: an add request
    met a satellite without add mode), `fitness.bt.pair-no-response`, `fitness.bt.remove-request`,
    `fitness.bt.remove-result`.
  - From the panel: `controller-status.pair-*`, `controller-status.add-open`,
    `controller-status.add-start` (mode, targets), `controller-status.add-close`,
    `controller-status.forget-other-click` (address, kind).
  - From the Settings overlay (component `fitness-controllers-overlay`):
    `controllers-overlay.open`, `.config-loaded`, `.config-failed`, `.close`,
    and `.focus-recovered` (debug, with the pairing phase).
  - From `useGamepadKeys` (component `fitness-gamepad-keys`): `gamepad-shape`
    once per pad per page load, with `id`, `mapping`, button and axis counts,
    `axisValues` (first four axes, rounded) and `pressedButtons`. Use it to
    read an unfamiliar pad's layout instead of guessing. `gamepad-key` (debug)
    for each key it fires.
- Kernel/BlueZ on the garage host: `journalctl -u bluetooth`. Look for
  `hidp_add_connection() Rejected connection from !bonded device`.

## Host leftovers

`sfc30-reconnect.timer` / `.service` on the garage host used to run `bluetoothctl
connect E4:17:D8:C6:54:F0` every 60s: MAC hard-coded, racing pairing windows,
paging a sleeping pad forever. The satellite reconnect loop replaces it. Once
the satellite carrying that loop is running, disable it with
`systemctl disable --now sfc30-reconnect.timer`.
