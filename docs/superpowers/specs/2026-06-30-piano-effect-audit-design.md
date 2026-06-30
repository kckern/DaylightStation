# Piano Effect Audit — Autonomous Closed-Loop Audio Test

**Date:** 2026-06-30
**Status:** Design (approved in brainstorming; pending spec review)

## Problem

The piano kiosk's Settings sheet (`PianoKeyboardPanel`) exposes reverb (on/off,
type, 0–100 depth) and chorus controls. These send MIDI Control Change messages
to the **Suzuki MDG-400** over BLE-MIDI:

| Effect       | Type CC | Level CC | Source |
|--------------|---------|----------|--------|
| Reverb       | 80      | 91       | `devices/suzukiMdg400.js` (owner's-manual MIDI chart) |
| Chorus       | 81      | 93       | same |

These CC numbers were transcribed from the manual's MIDI Implementation Chart;
**no one has verified the hardware actually honors them.** The reverb/chorus
sliders may be sending CCs the MDG-400 ignores, i.e. doing nothing. We want an
empirical answer — and a recommendation on whether to keep or remove each slider.

## Goal

Autonomously: apply each effect setting via MIDI, make the piano sound a fixed
stimulus, record the room audio through the tablet mic, upload the clips, and
analyze them offline to determine **which CCs produce an audible change
(effective) vs. which are ignored** — with a full per-clip acoustic report.

## Key facts established during research

- **Outbound MIDI originates only in the browser.** There is no backend→piano
  MIDI path. The Python bridge (`_extensions/piano/recorder/`) is receive-only
  (`mido.open_input`, broadcasts inbound on the `midi` WS topic). The APK bridge
  (port 8770) is a synth host, not a piano-MIDI sender. The sole sender is the
  WebView via `useWebMidiBLE.js` over BLE-MIDI.
- **The MIDI send helpers already exist.** `useWebMidiBLE.js` exports
  `sendNote(note, velocity, channel, durationMs)` and
  `scheduleNotes(events, channel)` (sample-accurate `MIDIOutput.send(bytes, ts)`
  using `performance.now()` offsets). Effect CCs go through
  `PianoSoundContext.setEffect(name, patch)` → `sendControlChange(typeCC|levelCC, …)`.
  **No new MIDI plumbing is required.**
- **BLE-MIDI link is live.** The piano's DIN-MIDI is bridged by a **CME WIDI
  Master** BLE adapter (`[LE] WIDI Master`, Connected; Android
  `com.android.bluetoothmidiservice` Registered/Connected). The WebView's Web
  MIDI enumerates "WIDI Master" as an output port.
- **Mic hazard.** A `[BR/EDR] J2-USB Bluetooth` HFP audio device is also
  connected. A connected HFP device can hijack `getUserMedia` onto the Bluetooth
  SCO mic → silence/garbage. The harness **must** pin the built-in mic and
  disable EC/NS/AGC (matches prior kiosk-mic findings).
- **Secure context OK.** Kiosk is served over HTTPS
  (`https://daylightlocal.kckern.net/piano`), so `getUserMedia`/`MediaRecorder`
  are available. WebView is Chrome 149 on Android 10 (SM-T590).
- **Audio path.** Piano sounds through its **own onboard speakers**; tablet is
  mounted on the music stand with clear line-of-sight to the speakers. Onboard
  reverb/chorus CCs affect onboard voice output, which the mic captures.

## Architecture

A **self-contained harness page** runs the entire sweep inside the WebView (the
only context with both the Web MIDI OUT port and the mic). It is triggered
hands-off over FKB REST, uploads clips to the backend, and an offline script on
the server produces the report.

```
[me, server]  fkb.cli set microphoneAccess=true
              fkb.cli url  https://…/piano/yellow-room/test/effect-audit?run=1
                                   │
                          ┌────────▼─────────────────────────────────────────┐
                          │ Harness page (WebView)                            │
                          │  preflight: enumerate MIDI out (WIDI Master),     │
                          │            open mic (built-in pinned, EC/NS/AGC   │
                          │            off) — abort with status if either     │
                          │            fails                                  │
                          │  for each permutation:                            │
                          │    setEffect/CC  → settle 400ms                   │
                          │    MediaRecorder.start                            │
                          │    scheduleNotes(stimulus)                        │
                          │    wait stimulus+tail (~4s) → stop                │
                          │    POST clip + per-clip meta                      │
                          └────────┬─────────────────────────────────────────┘
                                   │  POST /api/v1/piano/effect-audit/:runId/:label
                          ┌────────▼─────────────────────────────────────────┐
                          │ Backend (piano.mjs router)                        │
                          │  save clip → media/logs/piano/effect-audit/<run>/ │
                          │  append manifest.json                             │
                          └────────┬─────────────────────────────────────────┘
                                   │
[me, server]  pull clips → analysis script → acoustic report + verdict table
```

## Components

### 1. Harness page — `modes/Test/EffectAudit.jsx` (new), routed under `test/*`

`PianoTest.jsx` already owns the `test/*` route; add an `effect-audit` subroute
(or a `?run=1`-gated panel). The page:

1. **Preflight.**
   - Enumerate `navigator.requestMIDIAccess()` outputs; require a usable output
     (prefer the one `useWebMidiBLE` already holds). If none → render a clear
     FAIL status and stop (no notes sent).
   - Open the mic with **built-in-mic pinning + processing disabled**:
     ```js
     // Enumerate devices; pick the built-in input (deviceId), not a BT/HFP one.
     getUserMedia({ audio: {
       deviceId: builtInId ? { exact: builtInId } : undefined,
       echoCancellation: false, noiseSuppression: false, autoGainControl: false,
       channelCount: 1,
     }})
     ```
     If denied → FAIL status and stop. (This is also the mic smoke test.)
   - Show on-screen status throughout (each permutation label + progress), so a
     screenshot via `fkb.cli shot` reveals run state.
2. **Sweep.** For each permutation (see matrix): apply the setting, settle
   ~400ms (BLE flush + piano latency), `MediaRecorder.start()`, fire the
   stimulus via `scheduleNotes`, wait `stimulusMs + tailMs`, `stop()`, then
   `POST` the blob with metadata.
3. **Teardown.** Reset effects to a sane default (reverb level 0 / chorus 0),
   `sendPanic()`, show "DONE — N clips uploaded".

**Stimulus (fixed, per clip):** a single **staccato note** so the post-note-off
audio is purely the effect tail, not a sustained string. Default:
- `t=0`: `note_on` C4 (MIDI 60), velocity 96
- `t=300ms`: `note_off` C4
- record window: `t=-100ms … t=3500ms` (≈3.6s) — captures onset + full tail
The exact offsets are written into each clip's metadata so analysis is
convention-free.

**Voice for effect clips:** select a sustained-ish onboard voice with audible
reverb tail. Use the device's default acoustic piano (the effect under test is
the variable; the voice is held constant across all effect clips).

### 2. Permutation matrix (~18 clips, ≈4s each → run ≈ 2 min)

| Group            | Held constant            | Varied                                   | Clips |
|------------------|--------------------------|------------------------------------------|-------|
| Control          | reverb 0, chorus 0       | —                                        | 1 |
| Reverb depth     | type=Hall(4)             | level 0, 32, 64, 100, 127                | 5 |
| Reverb type      | level=100                | Room(0), LgRoom(2), Hall(4), LgHall(5), Plate(8) | 5 |
| Chorus depth     | type=Chorus-3(2), reverb 0 | level 0, 64, 127                        | 3 |
| Instrument check | reverb 0, chorus 0       | Program Change: Ac. Piano → Strings → Ac. Piano | ~3 |

The Program-Change clips are the **end-to-end control**: PC is known-good, so an
audible timbre change there proves the capture+analysis chain can detect a real
difference. If even the PC clips look flat, the rig — not the reverb CC — is the
problem.

Matrix is data-driven (an array in the harness) so it's trivial to extend.

### 3. Upload endpoint — extend `backend/src/4_api/v1/routers/piano.mjs`

`POST /api/v1/piano/effect-audit/:runId/:label`
- Body: the audio blob (WebView produces `audio/webm;codecs=opus`; accept raw
  body by content-type, or multipart). Metadata via JSON field / headers:
  permutation descriptor, exact MIDI bytes sent, stimulus timing offsets, voice,
  sample mime, client timestamps.
- Writes `media/logs/piano/effect-audit/<runId>/<NN>-<label>.webm` and appends a
  `manifest.json` entry (array of all clip descriptors).
- Lives on the existing piano router → **no `api.mjs` routeMap change** needed.
- `media/logs/piano/` already survives redeploys (per session-log convention).

### 4. Offline analysis script — `cli/piano-effect-audit.analyze.mjs` (new)

Run on kckern-server after the sweep. For each clip:
- ffmpeg-decode webm/opus → mono PCM wav (16k or 48k).
- Align to the note-off offset from the clip's manifest metadata.
- **Reverb metrics:** post-note-off **tail energy** (RMS in the decay window),
  **RT60-style decay time** (time for the post-off envelope to fall a fixed dB),
  and decay-curve shape.
- **Chorus metrics:** detune/modulation evidence — spectral spread around the
  fundamental, autocorrelation/cepstral sidebands, slow amplitude/pitch
  modulation in the sustain.
- **Timbre (PC clips):** spectral centroid / rough spectral envelope to confirm a
  voice change is detectable.

Then compare across the matrix and emit:
- **Verdict table:** each CC (reverb on/off, reverb type, reverb depth, chorus) →
  measured Δ vs. the control → **effective / ignored** (with the numeric margin).
- **Full acoustic report:** per-clip decay curves + spectra (rendered as text
  tables and/or PNGs under the run folder), and a **keep/remove recommendation**
  for each slider in the Settings UI.

## Operational flow (hands-off, driven by me from the server)

```bash
cd /opt/Code/DaylightStation
export FKB_PW=…            # from data/household/auth/fullykiosk-piano.yml
export FKB_ADB="sudo docker exec daylight-station adb"

# 0. Pre-flight: confirm idle (no active piano session), WIDI Master connected.
# 1. Grant mic (idempotent):
node cli/fkb.cli.mjs set microphoneAccess true
# 2. Launch harness:
node cli/fkb.cli.mjs url 'https://daylightlocal.kckern.net/piano/yellow-room/test/effect-audit?run=1'
# 3. Watch progress:
node cli/fkb.cli.mjs shot /tmp/audit.png      # repeat; on-screen status
# 4. After ~2 min, pull clips + analyze:
#    (clips are in the data/media volume → read via docker exec / host mount)
node cli/piano-effect-audit.analyze.mjs <runId>
# 5. Restore kiosk:
node cli/fkb.cli.mjs back-script               # restore normal injectJsCode + reload
```

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Mic hijacked to BT SCO (J2-USB HFP) → silence | Pin built-in mic deviceId; disable EC/NS/AGC; preflight checks captured level is non-trivial during the PC control clip |
| Web MIDI output not enumerable (BLE dropped) | Preflight aborts with FAIL status before any audio work |
| Mic permission denied in WebView | `set microphoneAccess true` first; preflight surfaces denial as FAIL |
| Run collides with someone playing | Pre-flight idle gate (no active piano session); run is short |
| Opus is lossy | Fine for envelope/decay/spectral-spread analysis; not doing fine phase work |
| Room reverb confounds | Constant across clips; level-0-vs-127 on the same note in the same room isolates the piano's internal effect |
| Effect applies but is subtle vs. mic noise floor | Use max contrast (0 vs 127) for the effective/ignored verdict; types are secondary |

## Out of scope

- No changes to the production Settings UI in this work (the keep/remove
  recommendation is an *output*; acting on it is a follow-up).
- No backend→piano MIDI path is built.
- No new MIDI hardware/bridge.

## Success criteria

- Harness runs the full matrix unattended and uploads all clips + manifest.
- Analysis yields a definitive effective/ignored verdict for reverb on/off,
  reverb depth (CC 91), reverb type (CC 80), and chorus (CC 93), with the PC
  control clips confirming the rig can detect real differences.
- A written acoustic report + per-slider keep/remove recommendation.
