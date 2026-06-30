# Piano MIDI Volume Sync — Probe-First Design

Date: 2026-06-30
Status: Approved (probe phase), implementation pending

## Goal

Keep the piano kiosk's internal MIDI volume state in sync with the instrument's
real volume — not fire-and-forget. Today `PianoMixContext` sends MIDI **CC7**
(Channel Volume) one-way and assumes it took; if the device drops a message,
power-cycles, or the user moves a physical control, app state and reality drift.

## Hard constraint discovered first

The instrument is a **Suzuki MDG-400** (`devices/suzukiMdg400.js`). Its profile
comes from the owner's-manual **MIDI Implementation Chart**, which documents
Program Change + a few CCs and **nothing about System Exclusive** — no
manufacturer/model ID, no SysEx address map. The 2026-06-30 effect-audit proved
its onboard MIDI is sparse and lossy (it *ignores* its own documented reverb/
chorus CCs). Standard MIDI has **no generic "read a CC value"** mechanism; only
manufacturer SysEx can, and this device almost certainly doesn't implement it.
The app also currently opens MIDI with `sysex: false`, filtering F0…F7 both ways.

**Conclusion:** a true Roland-style RQ1/DT1 volume read-back is not available on
this hardware. So we **probe first** to map what the unit actually emits/answers
(GM Universal SysEx only), then design sync around the real capability.

## Phase 1 — SysEx plumbing (MIDI layer)

In `useWebMidiBLE.js` + `PianoMidiContext.jsx`:

1. **Open with SysEx**, with a safe fallback: try `requestMIDIAccess({ sysex: true })`;
   on denial/unsupported, fall back to the current `{ sysex: false }` so MIDI never
   goes dark. Expose a `sysexEnabled` flag.
2. **`sendSysEx(bytes)`** — wrapper over `out.send([0xF0, …, 0xF7])`.
3. **SysEx-aware IN capture** — reassemble F0…F7 frames (Web MIDI may deliver
   whole or chunked) and surface them to listeners alongside channel-voice msgs.

**Permission risk:** SysEx access prompts the browser. On the FKB kiosk WebView
no one can click it. The fallback is mandatory; the first probe run happens in
desktop Chrome against the same BLE instrument, or with the WebView's SysEx
pre-granted. (User will accept the permission as needed; `fkb.cli.mjs` can drive
the kiosk headlessly — `inject-file` + `shot`, ADB for OS-level.)

## Phase 2 — The probe (all Universal/GM SysEx)

**Sends (fire + watch for reply):**
- **Identity Request** `F0 7E 7F 06 01 F7` — highest value. An Identity Reply
  (`F0 7E 7F 06 02 …`) confirms SysEx round-trips over BLE-MIDI and reveals the
  device's real manufacturer/family/model bytes (absent from our profile).
- **GM Master Volume** `F0 7E 7F 04 01 LL MM F7` — sweep `MM` (00→40→7F) to test
  whether Universal master-volume SysEx moves output (alternative to CC7). Set-only;
  verified audibly or via the effect-audit mic rig.
- (Optional) **GM System On** `F0 7E 7F 09 01 F7`.

**Listens (the real prize):** a passive SysEx + CC monitor logging *all* inbound.
Physically move the unit's volume and observe whether the MDG-400 **transmits**
anything (CC7? SysEx? nothing). It's already transmit-only for Bank Select, so it
emits some panel actions; if volume is among them, we can stay in sync by listening.

**Capture:** extend `PianoMidiMonitor.jsx` to render/decode SysEx; a "Run SysEx
probe" action fires the sends and timestamps replies; observe via `fkb.cli
inject-file` + `shot`; write findings to a short results note (effect-audit style).

## Decision gate (probe result → sync mechanism)

- **Transmits volume on physical change** → **listen-and-reconcile**: app updates
  its CC7/level state from inbound messages. True bidirectional sync — best outcome.
- **Answers Identity but emits no volume** → **assert-and-reconcile**: app stays
  SSOT; re-assert the write channel on (re)connect, voice/program change, and
  wake/screensaver-resume, plus an optional low-rate heartbeat. Idempotent.
- **Write channel:** whichever of **CC7** vs **GM Master Volume SysEx** actually
  moves output wins; the probe settles it.

## Testing

- Pure units: SysEx frame builders (Identity Request, GM Master Volume with
  LL/MM packing) and the F0…F7 IN reassembler/decoder — table-driven, no hardware.
- The probe run itself is the hardware test (deliberate, controlled), mirroring
  the effect-audit. Results recorded in `docs/_wip/audits/`.
- Sync logic (assert-and-reconcile / listen-and-reconcile) gets unit tests once
  the mechanism is chosen.

## Out of scope (until probe says otherwise)

- Proprietary Suzuki SysEx (factory-service-only; not public).
- Per-voice or media-side read-back (media `.volume` is already app-owned/reliable).
