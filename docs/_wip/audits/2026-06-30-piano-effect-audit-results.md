# Piano Effect Audit — Results (2026-06-30)

**Question:** Do the Suzuki MDG-400's reverb (on/off, type, depth) and chorus
controls in the piano kiosk Settings sheet actually do anything, or is the app
sending MIDI Control Changes the hardware ignores?

**Method:** Autonomous closed-loop audio test. A harness page in the piano app
(`/piano/test/effect-audit?run=1`) applies each effect via MIDI CC, plays a
fixed staccato C4 through the piano's onboard speakers, records it on the
tablet's built-in mic, and uploads the clip. An offline analyzer
(`cli/piano-effect-audit/`) auto-detects the note strike in each clip and
measures the post-strike decay tail and timbre. Run id `2026-06-30T18-30-49-101Z`,
17 clips, capture verified reliable (clear note strike 26 dB above the room floor
in all 17).

## Bottom line

**The reverb and chorus controls have no audible effect — the MDG-400 ignores
those CC messages (reverb type CC 80, reverb depth CC 91, chorus CC 93).** The
user's doubt was correct. These sliders/selectors should be removed from the
Settings UI (or the device profile's CC mapping revisited against a verified
source — the values came from the owner's-manual MIDI chart, which the hardware
evidently does not implement on the onboard voice path).

- **Reverb depth (CC 91):** IGNORED. Tail energy 400–1400 ms after the strike is
  flat (~−52 to −56 dB) from level 0 to 127; if anything max-reverb measured
  −3.8 dB *lower*. No reverb tail is added.
- **Reverb type (CC 80):** IGNORED. Decay times are 380–440 ms across Room /
  Large Room / Hall / Large Hall / Plate — 60 ms spread, i.e. indistinguishable.
- **Chorus (CC 93):** IGNORED. No tail-energy change; the spectral-spread
  difference (869 Hz) is within the natural clip-to-clip variance (~1.1 kHz),
  so it is not significant.
- **Instrument / Program Change (rig control):** weakly detectable (560 Hz
  centroid shift). PC *is* honored by the hardware, confirming the rig can record
  the piano; but the tablet-mic spectral discrimination is noisy, so spectral-only
  conclusions (chorus, timbre) are lower-confidence than the envelope-based
  reverb conclusion, which has clean ~30 dB SNR.

## Confidence

- **High** — reverb depth + type are ignored (envelope/decay metrics, robust to
  mic noise).
- **Medium** — chorus is ignored (spectral metric, de-noised against measured
  baseline variance, but the rig's spectral discrimination is weak).

## Operational caveats discovered during the run (for any re-run)

1. **Mic selection:** `getUserMedia('default')` on Android routes to a connected
   Bluetooth HFP headset's SCO mic (the "J2-USB Bluetooth" device), capturing the
   piano ~27 dB under noise. The harness must pin a *concrete* built-in input
   (e.g. "Speakerphone"), excluding the `default`/`communications` pseudo-devices.
2. **Screensaver:** the piano app's 3-minute screensaver turns the tablet screen
   off mid-run (the harness sends MIDI *out* and gets none back, so it reads as
   idle), backgrounding the WebView and freezing MediaRecorder. Keep the screen
   awake during the run (periodic ADB `input tap`).
3. **Note timing:** the struck note lands ~1.5–2.3 s into each recording
   (MediaRecorder + BLE latency, drifting later through the run), so the analyzer
   auto-detects the strike rather than trusting a fixed offset.
4. **FKB cache + WiFi:** after a redeploy, clear the FKB cache (old JS bundle is
   served otherwise); the yellow-room tablet's WiFi extender being down causes
   severe flapping (`wifiSignalLevel` 0).

---

## Raw analyzer output

# Piano Effect Audit — 2026-06-30T18-30-49-101Z

Device: suzuki-mdg-400  ·  clips: 17  ·  note strike auto-detected per clip; reverb tail = energy 400–1400 ms after the strike

**Capture: RELIABLE** (17/17 clips show a clear note strike above the room floor)

## Verdict

- **Reverb on/off:** IGNORED (Δtail -3.8 dB)
- **Reverb depth (CC 91):** IGNORED (Δtail -3.8 dB)
- **Reverb type (CC 80):** IGNORED (decay spread 60 ms)
- **Chorus (CC 93):** IGNORED (Δtail -2 dB, Δspread 869.2 Hz)
- **Instrument control (rig check):** DETECTABLE (centroid spread 560 Hz)

## Recommendations

- REMOVE/REVIEW reverb depth slider — no measurable tail change (CC 91 likely ignored).
- REMOVE/REVIEW reverb type selector — types indistinguishable (CC 80 likely ignored).
- REMOVE/REVIEW chorus controls — no measurable change (CC 93 likely ignored).

## Per-clip metrics

| clip | group | peakDb | peakAtMs | tailDb | decayMs | centroidHz | spreadHz |
|------|-------|--------|----------|--------|---------|-----------|----------|
| 00-control | control | -25.8 | 1485 | -52.8 | 440 | 3205.4 | 4516.2 |
| 01-reverb-hall-l000 | reverb-depth | -25.9 | 1980 | -50.8 | 440 | 3537.2 | 4783.5 |
| 02-reverb-hall-l032 | reverb-depth | -25.8 | 1875 | -53.4 | 420 | 4277.2 | 5287.9 |
| 03-reverb-hall-l064 | reverb-depth | -25.8 | 1815 | -55.7 | 440 | 4323.1 | 5297.5 |
| 04-reverb-hall-l100 | reverb-depth | -25.9 | 1875 | -52.6 | 440 | 4247.6 | 5282 |
| 05-reverb-hall-l127 | reverb-depth | -25.7 | 1665 | -54.6 | 420 | 3093.6 | 4414.6 |
| 06-reverb-type-room | reverb-type | -25.9 | 1710 | -51.1 | 440 | 3674.5 | 4800.5 |
| 07-reverb-type-large-room | reverb-type | -26 | 1785 | -55.3 | 440 | 3759.6 | 4839.3 |
| 08-reverb-type-hall | reverb-type | -25.9 | 1980 | -54.3 | 380 | 4816.3 | 5540.7 |
| 09-reverb-type-large-hall | reverb-type | -25.9 | 1755 | -52.4 | 420 | 4001.7 | 5081.3 |
| 10-reverb-type-plate | reverb-type | -25.8 | 2295 | -51.7 | 400 | 3871 | 5055.6 |
| 11-chorus-l000 | chorus-depth | -25.9 | 1845 | -52 | 440 | 3669.7 | 4856.5 |
| 12-chorus-l064 | chorus-depth | -25.9 | 2190 | -52.1 | 420 | 3520.7 | 4815.7 |
| 13-chorus-l127 | chorus-depth | -25.9 | 1920 | -54 | 400 | 5189.4 | 5725.7 |
| 14-instrument-ac-grand | instrument | -25.8 | 2145 | -57.9 | 420 | 4782.8 | 5525.9 |
| 15-instrument-strings | instrument | -26.6 | 2325 | -50.3 | 540 | 4810.8 | 5616.1 |
| 16-instrument-ac-grand | instrument | -25.9 | 2040 | -51.5 | 400 | 4250.8 | 5261.3 |
