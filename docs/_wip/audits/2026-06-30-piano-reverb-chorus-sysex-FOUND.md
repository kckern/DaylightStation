# Piano reverb/chorus — the commands that WORK (2026-06-30)

**Question:** Find the MIDI commands that control the Suzuki MDG-400's reverb and
chorus, confirmed by real acoustic testing.

**Answer: reverb and chorus ARE controllable via System Exclusive — both Roland
GS and GM2 dialects work. Channel Control Changes (the owner's-manual mapping)
do NOT.** Confirmed acoustically, reproduced across two runs.

## Results (autonomous mic probe, 3 reps each, averaged; two independent runs)

| command sequence | Δ reverb-tail | Δ decay | verdict |
|---|---|---|---|
| **GS reverb** (GS-Reset + reverb macro Hall + level 127) | +8.9 / +14.6 dB | +260 / +380 ms | ✅ WORKS |
| **GM2 reverb** (GM2-On + reverb-type SysEx + CC91) | +12.6 / +14.6 dB | +153 / +393 ms | ✅ WORKS |
| **GS chorus** (GS-Reset + chorus macro + level 127) | +19.5 / +28.3 dB | +400 / +687 ms | ✅ WORKS |
| **GM2 chorus** (GM2-On + chorus-type SysEx + CC93) | +25.3 / +28.7 dB | +640 / +460 ms | ✅ WORKS |
| GM Master Volume SysEx | ~0 dB (flat) | — | ❌ ignored |
| Channel CC 80/81/91/93 | ~0 dB (5-point sweep) | — | ❌ ignored |

All four effect candidates produce large, consistent, positive tail+decay gains
in both runs; the CCs and GM Master Volume are flat. Chorus is especially strong
(it raises the whole note level +14–16 dB at the peak — audible doubling).

## The working byte sequences (from `effectProbe/sysex.js` + `candidates.js`)

- **GS reverb:** `F0 41 10 42 12 40 00 7F 00 41 F7` (GS Reset) · `F0 41 10 42 12
  40 01 30 04 <ck> F7` (reverb macro = Hall2) · `F0 41 10 42 12 40 01 33 7F <ck>
  F7` (reverb level). Roland checksum = `128 − (Σaddr+data mod 128)`.
- **GS chorus:** GS Reset · macro `40 01 38 02` · level `40 01 3B 7F`.
- **GM2 reverb:** `F0 7E 7F 09 03 F7` (GM2 On) · `F0 7F 7F 04 05 01 01 01 01 01
  00 04 F7` (reverb type) · CC91 send.
- **GM2 chorus:** GM2 On · `…05 01 01 01 01 01 02 02 F7` (chorus type) · CC93.

## Why it took so long (the confounds, in order discovered)

1. **Channel CCs genuinely don't work** — the owner's-manual chart maps CC
   80/81/91/93 but the engine ignores them (proven by a clean 5-point sweep).
2. **FKB kiosk cannot send Web MIDI SysEx** — `requestMIDIAccess({sysex:true})`
   is denied at the WebView embedder level (no FKB setting; even a CDP
   `Browser.grantPermissions` is overridden). SysEx only works in the tablet's
   real **Chrome**, where the permission prompt can be granted (ADB-tappable).
3. **WIDI Master adapter** (CME, mfr `00 20 63`) answers the Identity Request as
   *itself*, not the piano — and earlier it was on the **USB jamcam path**; moving
   it to the piano's **5-pin DIN** is what let SysEx reach the engine.
4. **Headphones were plugged into the piano** for several runs → loudspeaker
   muted → the mic recorded only room noise (peaks ~−47 dB). With the loudspeaker
   on, peaks jumped to −7…−27 dB and the effects became unmistakable.
5. BLE one-turn-late note drops (fixed: frame the note send), multi-Chrome-tab
   contention, FKB watchdog re-grabbing focus (fixed: `pm disable-user` for the
   run), and a flaky WiFi extender that drops the tablet when FKB's WiFi
   wake-lock is gone (fixed: OS `wifi_sleep_policy=2` before disabling FKB).

## Implications for the kiosk

- The reverb/chorus Settings UI should send **GS (or GM2) SysEx**, not the
  ignored CCs in `devices/suzukiMdg400.js`. This needs a **SysEx-capable MIDI
  output** — exactly the Phase-1 plumbing the volume-sync plan specifies
  (`useWebMidiBLE` open with `sysex:true` + `sendSysEx`).
- **BUT** the production FKB kiosk can't send SysEx (denied at the WebView level),
  so in-kiosk effect control needs that permission solved first — e.g. route the
  control through the native **piano-bridge APK** (Android MidiManager, no Web
  permission limit) rather than Web MIDI. This is the open follow-up.
- **Volume sync:** GM Master Volume SysEx is **ignored** — so the volume write
  channel must remain **CC7**, not GM Master Volume (settles that branch of the
  volume-sync plan).

Probe harness + analyzer + SysEx builders: `frontend/src/modules/Piano/PianoKiosk/
modes/Test/effectProbe/` and `cli/piano-effect-audit/probe.cli.mjs` (branch
`feat/piano-effect-probe`).
