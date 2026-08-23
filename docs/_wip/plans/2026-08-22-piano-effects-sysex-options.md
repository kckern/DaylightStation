# Piano effects (reverb / chorus): why they don't work, and the three routes

**Date:** 2026-08-22
**Status:** investigation only — no implementation chosen yet
**Related:** `docs/reference/piano/midi-architecture.md`, `docs/_wip/bugs/2026-08-22-piano-midi-one-way-outage.md`

---

## The finding

**Effects have never worked, because nothing sends them.** This is not a regression
and not a transport fault — there is no send path at all.

`data/household/piano/config.yml` carries a detailed, correct-looking effects block:

```yaml
effects:
  transport: sysex
  dialect: gm2
  route: pianobridge      # "FKB WebView cannot do Web MIDI SysEx; send via APK :8770"
  resend: 3
```

…along with the verified GS/GM2 byte sequences and Roland checksum rule. But:

| Claim in config | Reality |
|---|---|
| `route: pianobridge` — the APK sends the SysEx | The APK's WS accepts only `preset.load`, `param.set`, `note.on`, `note.off`. All four drive its **internal sfizz synth**. |
| The APK can write to the piano | It cannot. `openInputPort` appears **nowhere** in the APK. `BleMidiConnector` opens the device's *output* port to READ only. There is no BLE write path. |
| Effect SysEx is emitted somewhere | `grep -rn "sysex" frontend/src backend/src` returns exactly **one** hit: `requestMIDIAccess({ sysex: false })`. Verified on this tree **and** the homeserver deploy tree (same HEAD, nothing unpushed). No `reverb`/`chorus` sender exists outside vendored speexdsp DSP. |

So the config describes an intended design that was never wired. Program Change
(instrument selection) works because it goes out over plain Web MIDI, which needs no
SysEx permission. Reverb and chorus need SysEx, and SysEx has no owner.

---

## Route 1 — Browser SysEx (`requestMIDIAccess({ sysex: true })`)

**Cost:** smallest. ~30 lines in `useWebMidiBLE.js` plus the byte builders (the exact
sequences and the checksum rule are already written down in `piano/config.yml`).

**Risk:** the config comment asserts the FKB WebView is embedder-denied for SysEx.
**That claim is unverified against the current build** — the tablet is on FKB with
Chrome **151.0.7922.85**, and Web MIDI's permission model changed substantially after
the comment was written. Chrome now gates *all* Web MIDI behind a permission prompt,
which on a kiosk WebView may be auto-denied — or may be grantable via an FKB setting.

**Cheapest next step:** inject a one-liner into the kiosk that calls
`requestMIDIAccess({sysex:true})` and reports the outcome. If it resolves, this is the
whole fix. If it rejects with `SecurityError`, route 1 is closed for good and we stop
re-litigating it. **~15 minutes to settle a question that has been assumed for months.**

Note: FKB on this tablet does **not** expose the live `injectJavascript` REST command
(verified — returns `Unknown Command`), so the injection has to go through
`setStringSetting injectJsCode` + `loadStartUrl`, i.e. it costs a page reload.

---

## Route 2 — APK write path (`openInputPort` + a `midi.raw` WS command)

**This is the architecturally correct answer**, and it is also the "single BLE owner"
endgame already argued for in `midi-architecture.md` §7: the APK owns `jam-7e6`
full-duplex, the browser sends OUT over the bridge WS, and the dual-claimant
contention (§5.1) that caused today's outage disappears as a side effect.

**Cost:** ~20 lines of Java — `device.openInputPort(0)`, a `midi.raw` case in
`ControlServer`, and routing the browser's OUT through the existing WS.

**The documented blockers are STALE.** `midi-architecture.md` §7 said this was
"blocked only by build/deploy" — no signing key, no NDK toolchain. Re-verified today,
all four requirements are satisfied on this machine:

| Requirement | Status |
|---|---|
| Android NDK | ✅ `26.1.10909125` (the exact version the README specifies) |
| CMake | ✅ `3.22.1` |
| sfizz vendored | ✅ 436 MB at `app/src/main/cpp/third_party/sfizz` |
| Signing key | ✅ `~/.android/debug.keystore`; the installed build is **debug-signed**, so the standard debug keystore matches |
| Proof it builds | ✅ `app/app/build/outputs/apk/debug/app-debug.apk`, built **2026-08-20** |

And deployment needs no ADB: `pbctl update <apk-url>` self-updates, and the README
confirms privileged perms survive same-signature self-updates.

**Risk:** it is still a native APK change on a household-critical device, and a bad
build costs a physical trip to the tablet. Mitigated by the self-update path having
been exercised, and by `pbctl` giving full LAN-side recovery.

**Bonus:** this route also fixes SysEx *reliability*. `piano/config.yml` notes the
JamCorder occasionally drops a BLE→DIN SysEx message and the MDG-400 has no read-back;
a native sender can do the documented 2–3× resend with proper spacing far more
precisely than a browser timer.

---

## Route 3 — JamCorder-side HTTP injection — **CLOSED**

Investigated and ruled out today, recorded so nobody repeats it.

The JamCorder's counter block has a `ws` channel (`ws.in` / `ws.out`), which suggested
a WebSocket MIDI input we could post SysEx to over WiFi, bypassing both the browser and
the APK. It is not one:

- `midiConverters.activeInputs` is `["uart", "usb", "ble"]` — **`ws` is not an active
  input**, and its counters sit at 0.
- `/api/extensions/list` returns `{"extensions": []}`.
- Scanning every asset the web UI loads turns up exactly three MIDI APIs:
  `/api/midi-io/settings/{get,set}` (routing flags), `/api/midi-recorder/settings/{get,set}`
  (SD recording), and `/api/midi-cmd/settings/set`. That last one is **piano-key-combo
  bookmarking** (`cmdSafetyNote` / `cmdOctave`, `bookmark-cmd`), not MIDI injection.

There is no way to hand the JamCorder arbitrary MIDI bytes over HTTP.

---

## Recommendation

1. **Settle route 1 first** — it is 15 minutes and it is currently an *assumption*
   sitting in a config comment, driving the architecture. If SysEx is grantable in the
   WebView, effects ship today.
2. **If route 1 is closed, do route 2.** The tooling objection no longer holds, and it
   pays for itself twice: effects *and* the single-BLE-owner fix that removes the
   contention behind the 2026-08-22 one-way outage.

Either way, `data/household/piano/config.yml` should stop advertising
`route: pianobridge` as though it were wired. It describes an intention, and it read as
a working configuration to everyone who looked at it — including during this
investigation.
