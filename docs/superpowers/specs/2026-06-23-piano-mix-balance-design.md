# Piano Mix Balance — Software Volume for Onboard Piano vs. BT Media

**Date:** 2026-06-23
**Status:** Approved design, ready for planning
**Scope:** `frontend/src/modules/Piano/PianoKiosk/`

## Problem

The piano kiosk drives a Suzuki MDG-400 digital piano and a Bluetooth speaker that
share **one** physical volume slider (the Android media-stream master). When playing
the piano *along* to a Music or Video track, there is no way to balance the two — turn
the piano down relative to the track — because both feed the same master.

The sound coming out during play-along is the **onboard Suzuki voice** (the keyboard's
own internal synth, Local Control on), **not** a rendered APK/voice-bridge instrument.
That fact decides the lever: the rendered-engine `gain` param is irrelevant here. The
only software lever that touches the onboard voice is **MIDI CC7 (channel volume)** sent
over MIDI OUT to the keyboard.

> The broken rendered-engine "Gain" knob (path `gain_db` vs `gain`, dB vs linear) and any
> VST-like work is **explicitly out of scope** for this effort.

## Audio topology

| Channel | Software lever | State today |
|---|---|---|
| **Onboard Suzuki voice** | MIDI **CC7** over MIDI OUT (`usePianoMidi().sendControlChange(7, v)`) | No UI, never sent, not persisted |
| **BT media audio** | media element `.volume` (0..1) — `<audio>` in Music, resolved `mediaEl` in Videos | Per-player `vol` state, defaults to 1, resets every mount/track; **Videos has no volume UI at all** |

Both ultimately mix into the Android media stream → A2DP → BT speaker, which the physical
slider controls as one master. After this change the physical slider remains the **master**;
the two software levels set the **balance** beneath it.

## Goal

Two independent, **persisted** software levels — piano (CC7) and media (element volume) —
adjusted **live in the now-playing chrome** of both the Music and Video players, so the
user can rebalance without leaving the track. Physical slider stays master.

## Design

### Unit: `PianoMixContext` (new)

The single owner of the two output levels and their persistence.

- State: `pianoLevel` (0..1), `mediaLevel` (0..1). Both persisted to `localStorage`
  (keys e.g. `piano.mix.pianoLevel`, `piano.mix.mediaLevel`), default `1.0`.
- `setPianoLevel(v)`:
  - persist,
  - send MIDI **CC7** = `round(v * 127)` to the onboard Suzuki via
    `usePianoMidi().sendControlChange(7, value)`.
- `setMediaLevel(v)`: persist (players read `mediaLevel` and apply to their element).
- **Re-assert CC7** whenever MIDI `connected` transitions to true, so a reconnect or
  keyboard power-cycle restores the chosen piano level.
- Provider nests **inside** `PianoMidiProvider` (needs `usePianoMidi`).
- Structured logging (`piano.mix.*`): `piano.mix.piano-level`, `piano.mix.media-level`,
  `piano.mix.cc7-assert` (on connect re-assert).

This unit's contract: input = the two setters + the live MIDI connection; output =
applies CC7 to the keyboard and exposes `mediaLevel` for players. It can be understood
and tested without reading any player internals.

### Touch point: MusicPlayer (`modes/Music/MusicPlayer.jsx`)

- Replace the local `vol` state with `mediaLevel` from `PianoMixContext`; the existing
  `changeVol` `+/−` buttons now drive the shared, persisted value (applied to the
  `<audio>` element via the existing volume effect).
- Add a second small cluster in the chrome: **🎹 piano `−/+`** alongside the existing
  **🔊 media `−/+`**, driving `setPianoLevel`.

### Touch point: PianoVideoPlayer + PianoVideoChrome (`modes/Videos/`)

- Apply `mediaLevel` to `mediaEl.volume` via an effect (mirrors MusicPlayer).
- Pass media-volume + piano-level handlers into `PianoVideoChrome`, which renders the
  same two `+/−` clusters. This is **net-new** volume UI for video.

### Controls

- Discrete `+/−` tap targets (match the existing media buttons; honor the kiosk's
  no-drag-sliders touch preference). Step size **10%** (piano maps to CC7 = `round(level*127)`).
- Two pairs per player: 🎹 piano and 🔊 media. Physical slider stays master.

## Step 0 — gating empirical check (before building UI)

On the real Suzuki MDG-400:
1. Hold a note; send `CC7=0` then `CC7=127`; confirm the onboard voice attenuates/returns.
2. Confirm the level **survives a Program Change** (voice switch).

GM Level 1 mandates CC7 recognition, so this is expected to pass. The device profile
(`devices/suzukiMdg400.js`) lists recognized CCs (80/81/91) but does **not** mention CC7,
which is why it's worth a 30-second confirmation. If a voice-change resets CC7, add one
re-assert hook in `PianoSoundContext.select`/`selectVoice` after the Program Change — the
only contingency in this plan; nothing else depends on the outcome.

## Out of scope

- Rendered voice-bridge / Sfizz engine `gain` knob fix (the `gain_db` vs `gain` bug).
- Any VST-like / per-instrument software gain work.
- A Settings-sheet home for the piano level when no media is playing (could be a later
  follow-up; the physical slider covers piano-only use today).

## Decisions (locked)

- Onboard voice is the play-along sound → CC7 is the piano lever (confirmed by user).
- Live controls in the now-playing chrome of both players (confirmed by user).
- Both levels persist; defaults 1.0; 10% steps; discrete `+/−` controls.
