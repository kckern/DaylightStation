# Controller pairing (garage arcade)

How a Bluetooth game controller gets paired, bonded, connected and kept
connected on the garage fitness box, and how to read what state it is in.

The arcade's controller chip (🎮 top of the Video Games screen) opens the
**Controllers** panel. That panel is the only pairing path anyone should need.

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

## Lifecycle

| Stage | What happens | Where |
|---|---|---|
| Guide | Pair shows the config `steps` first. "It's blinking — start pairing" opens a window | `ControllerStatus.jsx`, `pairingGuide.js` |
| Request | `bt.pair.request {requestId, durationMs: 60000, targets}`. `targets` = name regex, MAC prefix and optional PIN for each controller | `FitnessContext.pairController`, `fitnessBtActions.js` |
| Discover | The satellite spawns `bt_pair_helper.py`, which runs BR/EDR discovery (`SetDiscoveryFilter{Transport:bredr}`). It considers only devices reported live in this discovery, never a cached RSSI | `satellites/fitness-controller/src/bt_pair_helper.py` |
| Agent | A D-Bus `org.bluez.Agent1` is the default agent for the window. It accepts `AuthorizeService` (HID 0x1124: if refused, HID never comes up), confirms SSP, and answers `RequestPinCode` with the target's `pin` (fallback `0000`) | helper |
| Pair | `Device1.Pair` while discovery is live. On AuthenticationFailed/Rejected/Canceled/ConnectionAttemptFailed it does `RemoveDevice`, rediscovers and retries **once**. A bonded pad that turns up discoverable and unconnected has forgotten us, so its stale bond is removed first. A bonded pad that is *connected* is never touched | helper |
| Bond + trust | `Trusted = dbus.Boolean(True)` (a plain bool fails with signature `ssb`). It then requires `Paired` AND `Bonded` | helper |
| HID up | `Connect`, then waits 15s for the pad's MAC in `/proc/bus/input/devices`. If it doesn't appear: disconnect, reconnect, wait once more. **Success means an input device exists**, not just "Connected" | helper |
| Progress | Each transition is one JSON line, relayed as `bt.pair.progress`. The window always ends with exactly one `done`, even if the helper crashes or never starts. The frontend gives up after 15s if the box never answers (`reason: no-response`) | `btPairing.mjs` |
| Reconnect | The satellite reconnects bonded, trusted gamepads that are not connected, with backoff of 30s doubling to a 10 min cap. A sleeping 8BitDo (asleep after 1 min unconnected or 15 min idle) wakes on START and reconnects by itself | `btInventory.mjs` |
| Pause | The inventory poll and reconnect loop pause for the whole window, so nothing else talks to BlueZ during a pair. One window runs at a time | `server.mjs` `onWindow` |
| Forget | `bt.remove` → `bluetoothctl --agent off remove`. The panel then says to put the pad in pairing mode to pair again. Forget is offered only for a bond that exists | `handleBtRemoveRequest` |

`bt.pair.progress` phases: `scanning, seen, found, stale-bond-removed, pairing,
agent, retry, bonded, connecting, hid-wait, hid-retry, warn, already-paired,
paired, error, done`. `done.reason` is one of: `none-found` (nothing in pairing
mode turned up; the panel points at the fast-blinking LED), `pair-failed`,
`no-input`, `helper-crashed`, `helper-failed`, `timeout` or `no-response`.

## Status a controller row can show

From `bt_inventory`: all *bonded* devices, plus any device connected right now
**without** a bond.

| Badge | Meaning |
|---|---|
| Ready | Bonded, connected and up as an input device |
| Connecting… | Bonded and connected; input device not up yet |
| Asleep — press START to wake | Bonded, not connected |
| Not paired — trying to connect | The pad is dialing in on a bond this box dropped. The kernel logs `Rejected connection from !bonded device` and the pad can't be used. The row offers **Pair** with the steps. A sighting is held for 120s, since each attempt lasts only a moment |
| Not paired | No bond |

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

- Satellite (garage `docker logs daylight-fitness`): `🎮 bt.pair <phase> <mac>`
  and `🎮 bt.reconnect …`.
- Log store, frontend: `fitness.bt.pair-request`, `fitness.bt.pair-progress`
  (phase, address, attempt, reason, message), `fitness.bt.pair-no-response`,
  `fitness.bt.remove-request`, `fitness.bt.remove-result`, and
  `controller-status.pair-*` from the panel.
- Kernel/BlueZ on the garage host: `journalctl -u bluetooth`. Look for
  `hidp_add_connection() Rejected connection from !bonded device`.

## Host leftovers

`sfc30-reconnect.timer` / `.service` on the garage host used to run `bluetoothctl
connect E4:17:D8:C6:54:F0` every 60s: MAC hard-coded, racing pairing windows,
paging a sleeping pad forever. The satellite reconnect loop replaces it. Once
the satellite carrying that loop is running, disable it with
`systemctl disable --now sfc30-reconnect.timer`.
