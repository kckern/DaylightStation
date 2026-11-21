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
    orientation: rotated-90-ccw          # a note for people; code reads positions:
    positions:                           # what the rider presses -> physical button
      up: forward
      center: call
      ...
    toward: { front: left, rear: right } # optional: positions facing the bike's front/rear
    buttons:                             # physical control -> key name it sends
      plus: AudioVolumeUp
      ...
  - id: stick_remote                     # a remote whose input the kernel drops
    kind: remote
    label: Stick remote
    address: "AA:BB:CC:00:00:03"
    layout: stick-pad                    # optional face hint: row | stick-pad
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
`controllerStatus.js`). `buttons:` lists each physical control and the key
name it sends (the browser's `KeyboardEvent.key`, or the name the garage box
decodes it to, e.g. `ButtonA`); the device page draws one keycap per control
from it, in file order. `layout:` says how to arrange them (see Device face).
`positions:` is for a remote mounted at an angle: it maps each rider
position (`up`, `down`, `left`, `right`, `center`) to the physical button
there, so the face is drawn as mounted and its actions are kept by position
(see Button mapping). `orientation:` is a note for people; code reads only
`positions:`.
`placement:` is the line under the device's name; without it, `model:`.
What each button *does* on fitness screens is not in this file: it is set on
the screen (see Button mapping). An `emulator:` map (physical control →
RetroPad button) lets a remote drive a running game (see Remotes as a game
controller). For which remote sent a key, see Per-remote keys.

- `steps` lead into the search: the last step points at **Search for it**.
- `wake` shows under a paired row of that controller while it is asleep.
- `keyboard:` is read by the device page to say which keys games use.
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
| List | Left: one tall row per paired device, then a **How to pair <label>** row per configured controller that is not paired, then **Search for devices** (and "Pairing <name>…" while a pairing started elsewhere is running). Right: the picked device's page |
| Edit buttons | A remote's button editor (see Button mapping) |
| How to pair | The controller's `steps` from `input.yml`, then **Search for it** |
| Search | Every device this search has heard, in first-seen order; pick one to pair it |
| Pairing | Progress for the one picked address; the passkey in large digits when the device asks for one |

The screen fills a fixed-size sheet the host provides: a header, then one
touch-scroll body (`.bts-body`: `overflow-y: auto`, `touch-action: pan-y`,
`overscroll-behavior: contain`), with no scroll area nested in it. The two
columns stack below a 60rem-wide body (a container query). House tokens only,
solid fills; the one shadow is the keycap's depth.

Every row is keyed by address. A paired row (5.5rem tall) shows the name (the
`input.yml` label when the device matches a controller by address, Bluetooth
name or vendor prefix; otherwise its Bluetooth name, or "Unnamed keyboard" /
"Unnamed device"), the placement (else model, else type) and exactly one
status word with a solid dot. Picking a row shows its page; the first
connected device's page shows on open.

The device page: name, status, placement and battery; the wake hint while
asleep; the device face; one sentence (see Device face); **Edit buttons**
(remotes, see Button mapping), **Pair again** (dropped bond) and **Forget**.

| Status | Meaning |
|---|---|
| Connected | Bonded, connected and up as an input device (the battery, when known, is on the page) |
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

Nothing on the list moves under a finger. Rows keep the order in which this
search first heard them (`extendNearbyOrder`, an order the screen keeps per
search): a new device appends at the bottom, a name that arrives late
changes only its own row, and a device that drops out of the snapshot keeps
its row with no signal bars (`mergeHeard`). A configured controller's rows
are marked, not moved to the top.

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
- **Success opens the device's page**, so it can be tried at once.

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
prefix or address) marked. Picking one pairs by address with the
controller's `pin`.

## Device face

The device page shows a device's controls as keycaps laid out like the
device, on a plate (`DeviceFace`, `deviceFaceModel.js`). A keycap sinks and
lights in the accent colour the moment its button is held and lifts on
release; a small green mark stays on a keycap pressed at least once this
visit; a control never pressed is plain. Under each keycap, what it does in
plain words: the saved action (Button mapping); with nothing saved, on a
`kind: remote` entry, what the key its button sends does by default
(`DEFAULT_KEY_ACTIONS` in `remoteButtonActions.mjs`: standard key names such as
`MediaTrackNext` → Next, `AudioVolumeUp` → Volume up, the arrows, Enter,
Escape), resolved position → physical button (`positions:`) → key
(`buttons:`); else, when the entry has an `emulator:` map, the game button
that control presses in the arcade ("Game: B"); else "Not set". The runtime performs the same defaults, so the
words are what a press does. Nothing is faked: a keycap lights only from a
real press.

| Device | Face | Lit from |
|---|---|---|
| Remote with `positions:` | drawn AS MOUNTED: a five-key cross from the rider's view, each keycap named by its position ("Up", "Centre"…) with the printed button's name small under it. `toward: { front, rear }` (which positions face the bike's front and rear) puts a quiet "Front" / "Rear" beside those keys. A press lights the keycap at the position whose physical button sent the key (key → button by `buttons:`, button → position by `positions:`) | `bt.remote.key` from THIS address only |
| Remote with `buttons:` | one keycap per control, legend from the control name (`circle_trigger` → "Circle trigger"). `layout: row` one row in file order; `layout: stick-pad` a cross of the controls named or sending up/down/left/right, beside a 2-column grid of the rest, with any trigger above the grid (legend without the word "trigger"); no hint or anything else, a wrapped grid in file order | `bt.remote.key` from THIS address only (down/repeat hold it, up releases) |
| Remote or keyboard with no entry | keycaps built from the keys it sends, in first-seen order | the same feed |
| Gamepad (`kind: gamepad`, or a controller entry that is not a remote) | the browser's standard mapping: L, L2, R2, R on top; a D-pad cross; Select and Start; Y X B A as a diamond. Under A and Start "Select", B "Back", the cross its direction | `navigator.getGamepads()`, every connected pad (a browser pad has no address). The cross also lights from the left stick: some pads report their D-pad there |

Without the per-remote feed (a host that has none), browser keys stand in.
On a remote's page the keys that remote sends light its face and do not move
focus (`useScreenNav`'s `ignoreKey`); Escape, Backspace and Tab always
navigate. A gamepad on its own page still drives the screen as usual.

Under the face, "Press a button on <name>." until the first press, and:

- a `kind: remote` entry: **what uses it**, read from config (`remoteUses.js`,
  through `remoteButtons.usesFor(controller)`): any block on its inventory
  entry keyed by a registered fitness module's id ("<module name>: plays
  with this remote.", e.g. an `emulator:` map), and any `<module id>.remote`
  direction map on an equipment entry in the fitness config, for a remote
  placed by `positions:` ("<module name>: Up: missile, Centre: laser, Front:
  boost.", only the directions this remote has; front / rear from its
  `toward:`). Module names come from the widget registry's manifests; nothing
  names a game. None: "No game uses it. Its buttons do what each keycap
  says."
- anything else, what games can do with the presses so far: gamepad input
  "Games can use this as a controller."; keys listed in `input.yml`
  `keyboard:` "Games can use these keys: …"; other keys "Games can't use
  these keys yet."

Leaving a page that had presses logs `bluetooth-screen.test-result` (keys,
distinctKeys, padInputs, verdict, keyNames).

## Button mapping

**Edit buttons** on a remote's page sets what each of its buttons does on
the garage fitness screen.

- **Unlock.** It asks for the admin fingerprint, the same unlock the fitness
  locks use (`IdentityProvider.registerAdmin('remote_buttons')` and the
  `UnlockPrompt`; see [fingerprint unlock](../fitness/fingerprint-unlock.md)).
  Like every fitness lock it is kiosk-only (`isKioskEnv`): off the kiosk there
  is no reader, and the editor opens without one. No PIN.
- **Editor.** Press the physical button (or tap its keycap) to pick it, then
  tap an action: Playback (Play/pause, Next, Previous, Volume up, Volume
  down), Navigate (Up, Down, Left, Right, Select, Back), or Nothing. The face
  shows each change at once; focus follows the picked keycap, so a gamepad
  or the keys carry on from there. **Done** saves and returns to the page so
  the new buttons can be tried; **Cancel** or Escape drops the changes. One
  set of buttons per remote.
- **Storage.** By Bluetooth address, in an app-written file:
  `household[-{hid}]/fitness/remote-buttons.yml` (schema
  `fitness.remote-buttons/v1`, written atomically), never `input.yml`.
  `remotes: { ADDRESS: { positions: { <position>: <action id> }, buttons:
  { <key name>: <action id> }, label, updatedAt, updatedBy } }`. A remote with
  `positions:` in `input.yml` is kept by **position**, so two remotes mounted
  at different angles map the same rider direction to the same action though
  they send different keys. Any other remote is kept by the key name it
  sends, so a remote with no `input.yml` entry can be set up too. A save
  replaces the map it sends and keeps the other. Action ids:
  `play-pause next previous volume-up volume-down up down left right select
  back none` (`fitness/shared/remoteButtonActions.mjs`, shared by server and
  browser).
- **API.** `GET /api/v1/fitness/remote-buttons` → the document;
  `PUT /api/v1/fitness/remote-buttons/:address` `{ buttons?, positions?,
  label?, updatedBy? }` (at least one map) → the document (400 on a bad
  address, an unknown action or position, or more than 64 buttons).
- **Layers.** `RemoteButtonService` (application) owns the document through
  the `IRemoteButtonMappingRepository` port (`load`, `save`;
  `isRemoteButtonMappingRepository`); `YamlRemoteButtonMappingRepository`
  (adapter, FileIO only) writes the file; `fitnessRemoteButtons.mjs` is the
  router, mounted in the fitness composition. Saves are serialized and logged
  (`fitness.remote-buttons.saved`, with the changed keys).

**Runtime** (`RemoteButtonsHost`, mounted in the fitness app inside
`IdentityProvider`; `remoteButtonRuntime.js`). The runtime never reads the
bus or input.yml itself: it consumes abstract remote input
`{ remote, kind: 'position' | 'key', control, state, key }` from
`createRemoteInputSource` (`remoteInputSource.js`), the adapter that turns
`bt.remote.key` and input.yml into it. The key → button → position step is
the shared resolver `remoteDirection(controller, key)`
(`lib/remoteInput/remoteDirection.js`, see Remote directions). On the kiosk only (every fitness
page hears the garage's remotes), each `bt.remote.key` press performs its
saved action, or with nothing saved for that control and a `kind: remote`
inventory entry, its key's default (above; a saved "Nothing" turns a default
off). The lookup is (address, key) →
physical button → rider position → action for a remote with `positions:`
(read from `input.yml`, `GET /api/v1/emulator/library`, once on the kiosk),
else (address, key) → action:

- Navigate goes to a modal that captured the action on the ActionBus
  (`navigate` / `select` / `escape`, `ActionBus.hasCapture`); otherwise the key
  it stands for (ArrowUp…, Enter, Escape) is dispatched to the focused
  element, as the gamepad adapter does, so keyboard-driven fitness menus move
  as they do for an arrow key.
- Playback goes to the fitness player's own controls, registered while it is
  mounted (`registerPlaybackTarget`): play/pause as the footer button does
  (nothing while governance holds the video), next and previous within the
  queue (Next at the end never closes the player), volume up and down by one
  step of the Settings volume strip. No player open: nothing happens.
- A repeat (held key) acts again only for the volume actions. Nothing
  swallows the press.
- **Never while tried.** A remote whose page is open on the Bluetooth screen
  is claimed (`claimRemote`): its presses light its face and do nothing else.
- **Never in a Skyline Invaders round** (countdown, playing, paused): the
  round holds every remote, as it ignores pads and keys.
- **Claims.** The runtime yields to every hold and claim in
  `remoteButtonHolds.js` (see Who owns a remote's presses): it performs
  nothing for a remote while `isRemoteHeld(address)` and lets that remote's
  browser keys through. React code takes a hold with
  `useRemoteButtonsHold(active, reason)` (`remoteButtonsContext.js`); Skyline
  Invaders holds for its rounds and Skyline Glider while mounted with a
  remote mapping.
- **The browser's own copy.** A keyboard-mode remote's press also reaches the
  page as a KeyboardEvent, in either order with its tagged twin. Browser keys
  that an acting remote has set are held back up to 400 ms for the twin: a
  twin from that remote drops the browser copy; a twin from another remote,
  or none (a USB keyboard), replays it. Keys no acting remote has set pass at
  once. The listener is installed before any other fitness key listener.

Logs (component `fitness-remote-buttons`): `.loaded`, `.load-failed`,
`.save-request`, `.save-done`, `.unlock-tap`, `.unlock-granted`,
`.unlock-denied`, `.unlock-skipped` (off the kiosk), `.inventory-loaded`,
`.inventory-failed` (warn), `.runtime-start`,
`.performed` (sampled: address, key, action, where it went: `action-bus`,
`key`, `player`, `no-player`), `.action` (sampled), `.held` (debug: claimed or
held). Backend: `fitness.remote-buttons.saved`.

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

The device face (`bluetooth.subscribeRemoteKeys`) and the button runtime both
read this feed by address: two remotes of the same model never light or act
for one another.

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
Invaders reads no remote; it holds every remote for its rounds so the button
mapping runtime stays quiet too.

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
  the page body or on a disabled control, so focus never falls to `<body>`;
- `ignoreKey(e)` lets a view leave a key alone: on a remote's page and in its
  editor, the keys that remote sends are for trying it.

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
  reason), `.select`, `.test-start` (a device page opened), `.test-result`
  (keys, distinctKeys, padInputs, verdict, keyNames), `.edit-unlock-request`,
  `.edit-unlock-denied`, `.edit-open`, `.edit-set` (debug), `.edit-save`,
  `.edit-save-failed` (warn), `.edit-cancel`, `.forget-arm`, `.forget-confirm`,
  `.focus-recovered` (debug).
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
