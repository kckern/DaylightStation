# Piano Kiosk — MIDI Architecture, Compromises & Resilience Risks

This document is the authoritative reasoning log for how MIDI flows to and from the
garage piano kiosk: the transports, *why* they are what they are, the compromises we
accepted, and the concrete risks to resilience. It supersedes the short "MIDI pipeline"
description in [README.md](./README.md) where they differ — the README describes an
earlier "Web MIDI both ways via a WIDI adapter" model; the reality below is bridge-first
for IN and Web MIDI for OUT.

> **Scope note.** Everything here is about the **kiosk** (the FKB tablet bolted to the
> piano). A non-kiosk client (a dev laptop with its own MIDI keyboard, e.g. a device that
> enumerates as `Digital Keyboard`) takes the Web-MIDI fallback path and is *not* part of
> the kiosk topology — its events share the backend logs via the proxy, which has caused
> misreads. Discriminate clients by User-Agent (SM-T590 / X11), never by the shared proxy IP.

---

## 1. Physical topology (as observed)

There is **one physical path** between the browser and the piano, and it runs through the
**JamCorder** — a networked DIN↔BLE MIDI relay (`jam-7e6`, BLE MAC `10:65:36:36:62:66`,
HTTP at `http://10.0.0.244`). The piano connects to the JamCorder over **USB**; the
JamCorder bridges that to **BLE-MIDI** (and to its 5-pin DIN). Verified from the
JamCorder's own message counters (`GET /api/device-state/get` → `midiMsgCounts`):

```
  piano ──USB──▶ JamCorder ──BLE(jam-7e6)──▶ tablet
        ◀─USB──           ◀─BLE──────────
  usb.in  = piano→JamCorder (notes played)     → routed to ble.out (to tablet) + uart.out
  ble.in  = tablet→JamCorder (voice/notes OUT) → routed to usb.out (to piano) + uart.out
```

Routing on the JamCorder is config (`/api/midi-io/settings/get`): `dinToBle`, `bleToDin`,
`usbToBle`, `bleToUsb`, etc. — all currently `true`. There is **no `bleToBle`** route (this
matters for OUT confirmation — see §6).

The tablet is the single BLE **radio**, but there are **two logical clients** on it that
both claim the `jam-7e6` device — this split is the root of every risk in §5:

- The **native piano-bridge APK** (`_extensions/piano-bridge`, `net.kckern.pianobridge`,
  control server at `10.0.0.245:8770`) opens `jam-7e6` via Android `MidiManager` and
  **reads** notes.
- The **browser** (FKB WebView) opens `jam-7e6` via **Web MIDI** and **writes** output.

---

## 2. The two directions and their transports

MIDI IN and MIDI OUT travel **different client transports over the same BLE device**:

| Direction | Path | Owner | Frontend surface |
|-----------|------|-------|------------------|
| **IN** (notes played → UI) | piano → USB → JamCorder → BLE → **APK reads** → **WebSocket** `:8770` → browser | native APK | `usePianoBridgeNotes` → `feedNote()` → note store |
| **OUT** (voice/effects/notes → piano) | browser → **Web MIDI output** (`jam-7e6`) → BLE → JamCorder → USB → piano | browser | `useWebMidiBLE` `sendProgramChange`/`sendVoice`/`pressNote`/… |

So IN is a **native-read-then-relay**, OUT is a **direct browser write**. They are not
symmetric and they fail independently.

---

## 3. Why the bridge exists (and what it's actually doing now)

The bridge was **not built to fix Web MIDI.** Per its own `DESIGN.md`/`README.md`, the
piano-bridge APK was built as a **native multi-engine synth host** — sfizz (SFZ sampler,
Salamander Grand) and Dexed/FM, rendered through **Oboe** for low latency — to give the
piano *better sampled voices* than its onboard firmware, kept alive by a **foreground
service** so audio survives the WebView backgrounding. Reading BLE-MIDI natively via
`MidiManager` was intrinsic to being a synth.

It became our **MIDI-IN path** as a repurposing: since the APK already reads BLE-MIDI
robustly, it was cheap to also **broadcast notes over WebSocket** to the browser, which
sidesteps the browser's Web MIDI reliability problems.

**Web MIDI's documented failure modes on this kiosk** (why native IN is worth it):
- **BLE-MIDI connection flaps** — ~30s dropouts logging `access-granted {0,0}` + `no-input`,
  and ports left **truthy-but-dead** (`state:'disconnected'` yet still enumerated).
- **Reconnect races** between claimants on the one radio.
- WebView lifecycle/throttling *can* stall Web MIDI JS callbacks — a contributor, though the
  screensaver work found the WebView itself **stays alive with the display off** (so
  "the screen slept and killed MIDI" is not the headline cause).

Native `MidiManager` dodges all of it: it runs outside the WebView lifecycle and holds BLE
with wake locks.

> **Important current-state caveat.** The bridge status shows `engine: stopped` — the
> **native synth is dormant**. Today the bridge does essentially **one** job for us: relay
> MIDI IN. So its *current* justification rests entirely on the Web-MIDI-reliability
> argument, not the synth it was designed for. If Web MIDI IN were reliable on its own, the
> bridge (for MIDI purposes) would be redundant — see the endgame in §7.

---

## 4. Key decisions & compromises

1. **Bridge-first IN, Web-MIDI fallback.** On the kiosk the APK is the *sole* BLE-MIDI
   reader and the browser consumes its WS note broadcasts; the browser does **not** arm a
   Web MIDI input (`useWebMidiBLE({ acquireInput: false })`), because a second Web MIDI input
   would fight the APK for the one BLE connection. A non-kiosk client (no bridge on
   `ws://localhost:8770`) flips `acquireInput:true` after a grace window and reads Web MIDI
   directly. *Wiring: `PianoMidiContext` sets `acquireInput = bridge.unavailable`.*

2. **Boot-race grace (8s).** On a tablet reboot the APK's WS server can start *after* the
   WebView. Without a grace, two quick WS failures flip the client to Web-MIDI fallback and
   the browser can win the BLE race and starve the APK. `usePianoBridgeNotes` holds
   `unavailable` false for `UNAVAILABLE_GRACE_MS` (8s) so the APK reliably wins.

3. **OUT is a direct browser Web MIDI write** — because the **APK cannot write.** Its
   `BleMidiConnector` opens the device's *output* port (to read) only; there is **no BLE
   write path**, and its inbound WS commands (`note.on/off`, `preset.load`, `param.set`) drive
   the internal **synth**, not the real piano. Adding a write path is an APK change, and the
   APK **cannot be cleanly rebuilt here** (no signing key in the repo → self-update would
   fail; native NDK/CMake/Oboe/sfizz toolchain not set up). So OUT stays in the browser.

4. **`connect()` must be auto-initialized on the kiosk.** `PianoApp` only calls Web MIDI
   `connect()` when `status==='idle'`, but the bridge makes the context `status` read
   `'connected'` immediately — so `connect()` never fired and the **output port never bound**
   (the original "OUT dead" bug). `PianoMidiContext` now drives `connect()` off Web MIDI's
   *own* status so OUTPUT always initializes, independent of the note-IN path.

5. **Holding the input port open for OUT delivery.** On this Android/BLE stack, opening the
   *output* port alone did not attach Chrome to the write path (JamCorder `ble.in` stayed 0).
   `holdInputForOutput` opens the input port (no note handler — the bridge is still the note
   source) so OUTPUT traverses BLE. **This is a compromise, not free:** it means the browser
   opens a port on `jam-7e6`, i.e. the browser becomes a *second claimant* on the APK's
   device (§5.1). Verified working: `ble.in`/`usb.out` increment in lockstep on send.

---

## 5. Risks to resilience (ranked)

The danger is not "two transports" per se — it is **two clients claiming one BLE device**,
plus **independent, asymmetric failure**.

### 5.1 Dual claimants on one BLE device → contention (biggest)
The APK and the browser both open `jam-7e6` through the one radio. Under reload/load this
churns the link — observed `reconnects` climbing into the thousands during heavy reload
cycles. A bad churn can drop **either** direction. The coupling is invisible until it flaps.

### 5.2 Silent, asymmetric failure (the one that bit us)
IN and OUT are separate state machines with no shared health, so you can sit in a
half-working state: keys light up (IN via bridge) while voice changes silently vanish (OUT
to a stale port). A Web MIDI output port reports `state:'connected'` even when its BLE is
dead, so fire-and-forget writes go into the void with no error. **Mitigated this session —
see §6.**

### 5.3 Independent reconnect races on restart
On a tablet reload or **backend restart**, the APK's BLE reconnect and the browser's Web MIDI
re-attach fire independently and race for the radio. (This is the same class as the Player
media-resilience thrash on backend restart — a redeploy is a backend restart.)

### 5.4 No delivery confirmation (open-loop OUT)
OUT assumes it landed. With IN arriving via a *different* client (APK→WS), there is no
natural round-trip to confirm a send reached the piano. See §6 for why a true loopback is
infeasible here.

---

## 6. Hardenings implemented (2026-07-13)

Commit `c7fa91b86`. Both are additive and scoped to the browser surface.

1. **OUT liveness by real `port.state`, not truthiness.** `isPortConnected(port)` =
   `state !== 'disconnected'` (undefined state → connected, for old stacks/mocks).
   `bindOutput` now **prefers a connected output** (a flap can leave a stale disconnected
   port enumerated) and tracks `outputConnected` from real state; the output watchdog
   re-binds a *present-but-disconnected* port, not only a null one. **Scoped to OUTPUT only**
   — the analogous state-based change on INPUT was reverted (`a68f14028`) for breaking
   note-in binding; output liveness by state is the safe half.

2. **Unified `midiHealth` signal** in `PianoMidiContext`:
   `{ in: 'bridge'|'webmidi'|'down', out: 'up'|'down', healthy }`. One truth spanning both
   directions, so a silently-dead OUT surfaces (`healthy:false`) even while IN is up —
   directly closing §5.2.

**Rejected / deferred (with reasons):**
- **True OUT loopback confirmation** — *infeasible on this stack.* There is no MIDI echo path
  (JamCorder has no `bleToBle`; OUT-sent notes don't re-transmit via IN), and **FKB blocks Web
  MIDI SysEx**, so a device-inquiry round-trip is impossible on the kiosk. `port.state` (above)
  is the practical proxy. *(A JamCorder-side confirmation via its `ble.in` HTTP counter is
  conceivable but couples the frontend to the device's HTTP API and is not worth it.)*
- **Full reconnect serialization across both claimants** — needs the APK (native side) to
  coordinate; the browser side already debounces `statechange` (200ms) and has the boot-race
  grace. Only partially addressable without an APK rebuild.

---

## 7. The resilient endgame (single BLE owner)

The durable fix for §5.1–§5.4 is **one claimant**: the APK owns `jam-7e6` **full-duplex**
(reads *and* writes), and the browser sends OUT over the **bridge WS** → APK writes it to
BLE. One GATT, one reconnect state machine, zero contention, and a natural place to confirm
delivery. This is ~20 lines of Java (`openInputPort` + a `midi.raw`/`note`/`program` inbound
command) plus routing browser OUT through the WS.

**It is blocked only by build/deploy, not design:** the APK has **no signing key in the
repo** (a self-built update won't match the installed signature → forced uninstall/reinstall,
losing config) and requires an **Android NDK/CMake/Oboe/sfizz** toolchain that isn't set up
here (the gradle comment itself notes "there is NO NDK/cmake on the authoring machine"). When
the APK can be built + signed, collapsing to single-owner full-duplex is the target.

---

## 8. Debugging playbook

- **Is OUT reaching the piano?** Watch the JamCorder counters across a send:
  `GET http://10.0.0.244/api/device-state/get` (gzip; parse `midiMsgCounts`). Browser OUT ⇒
  `ble.in` ↑ **and** forwarded to piano ⇒ `usb.out` ↑ (they move in lockstep). The kiosk's
  output burst fires on every connect, so a tablet reload is a free OUT test.
- **Is IN flowing?** `usb.in` (piano→JamCorder) and `ble.out` (JamCorder→tablet) climb as you
  play. Bridge WS clients: `GET http://10.0.0.245:8770/status` → `wsClients`, `state`,
  `reconnects`, `connectedSeconds`.
- **Is BLE flapping?** `reconnects` on the bridge status climbing over ~30s = active flapping.
  A high absolute count can just be accumulated churn from heavy reloads — check the *rate*.
- **Frontend breadcrumbs** (container logs): `midi.access-granted`, `midi.output-bound`
  (carries `state`), `midi.output+holdinput-bound`, `midi.out.voice/cc/…` (carry
  `conn`/`state`), `midi.statechange`, `bridge.open`/`bridge.closed`. Discriminate the kiosk
  from dev clients by UA (SM-T590), not the proxy IP.
- **Reload the kiosk** to pick up a new bundle: `cli/fkb.cli.mjs cmd clearCache` then
  `reload`. `FKB_PW` comes from `data/household/auth/fullykiosk-piano.yml`.
- **Never blank the APK `targetMac`** (releases BLE → browser can't hold it alone → "no keys").
  Keep `10:65:36:36:62:66`.

---

## 9. Where the MIDI code lives

| Concern | Path |
|---------|------|
| Web MIDI hook (IN fallback + OUT + output health) | `frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js` |
| Bridge WS note consumer (IN) + boot-race grace | `frontend/src/modules/Piano/PianoKiosk/usePianoBridgeNotes.js` |
| MIDI context: adaptive IN, auto-connect, `midiHealth` | `frontend/src/modules/Piano/PianoKiosk/PianoMidiContext.jsx` |
| MIDI monitor byte decoder | `frontend/src/modules/Piano/PianoKiosk/midiDecode.js` |
| Note store / history | `frontend/src/modules/Piano/PianoKiosk/noteStore.js` · `frontend/src/modules/Piano/noteHistory.js` |
| Native bridge APK (synth + BLE reader) | `_extensions/piano-bridge/` (`DESIGN.md`, `README.md`, `pbctl.mjs`, `app/`) |
| JamCorder relay | device at `http://10.0.0.244` (`jam-7e6`, `10:65:36:36:62:66`) |
