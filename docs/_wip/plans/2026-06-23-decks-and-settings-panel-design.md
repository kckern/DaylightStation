# Decks mode + consolidated Settings/MIDI panel — design

**Date:** 2026-06-23
**Status:** Design (validated in brainstorming; not yet implemented)
**Area:** Piano Kiosk (`frontend/src/modules/Piano/PianoKiosk/`, `frontend/src/Apps/PianoApp.jsx`)

## Summary

Two related changes to the Piano kiosk:

1. **Consolidated Settings panel** — fold the connection indicator, the voice/source
   selector, and the entire **Instruments** mode into a single top-right **status
   chip** that opens a Settings sheet (Sound + MIDI hardware + a live MIDI debug
   monitor). The **Instruments** tile leaves the main menu.
2. **Decks** — a new 8th main-menu tile: a DJ/turntable-flavored loop & pad
   launcher (hybrid: one deck/platter + a pad bank), with a **split keyboard** so
   the low keys finger-drum while the rest plays melodic. Plus a **Keyboard Drums**
   preset (onboard MIDI-patch *and* sample-based).

The menu stays at **8 tiles**: Instruments out, Decks in.

---

## 1. Consolidated Settings panel

Today the chrome's right cluster shows the source `<select>` ("Grand Piano") and a
status chip ("● Digital Keyboard"), and there is a separate **Instruments** mode
tile. These collapse into one affordance.

- **Status chip** (right of the breadcrumb): a dot + active source name. Green when
  the piano is connected, red/"Connect" when not. This is the only always-visible
  control; it replaces today's `<select>` + status button.
- **Settings sheet** (slide-over panel, NOT a route — reachable from any mode).
  Three stacked sections:
  1. **Sound** — the voice/source picker currently in the chrome: Onboard voices
     (incl. the Drum-Kit MIDI patch) + rendered Instruments (incl. the sample drum
     kit). Absorbs the whole *Instruments* mode ("switch & tune voices").
  2. **MIDI hardware** — connection state, input name, Connect/retry, BLE link
     status.
  3. **MIDI monitor (debug)** — live scrolling log of raw incoming MIDI (note
     on/off, CC, PC) + a row of **fireable outputs**: send Program Change, Local
     Control on/off, panic/all-notes-off.

Closing the sheet returns to the current mode. The **Instruments** tile and route
are removed; its content lives in the Sound section.

### Touch points
- `PianoChrome.jsx` — right cluster becomes the chip + sheet trigger; move the
  source/voice logic into the sheet.
- New `PianoSettingsSheet.jsx` (Sound / Hardware / Monitor sections).
- New `PianoMidiMonitor.jsx` — subscribes to the raw MIDI stream from
  `PianoMidiContext` / `useWebMidiBLE`; renders a capped rolling event list +
  output buttons (reuse `sendProgramChange`, `sendLocalControl`, panic).
- `PianoApp.jsx` — drop the `instruments` route + `PIANO_MODES` entry; add `decks`.
- Delete `modes/Instruments/` after its surface moves into the sheet.

---

## 2. Decks mode

New tile (svgrepo turntable/vinyl icon, 383655). Renders in the mode content area
under the breadcrumb chrome, top-to-bottom:

1. **Deck (top):** a spinning vinyl **platter** for the loaded beat-bed loop, with
   cue/play, tempo (BPM), key readout, and a kit/genre selector. Dragging the
   platter does a light **nudge** (brief pitch-bend of the bed — sells the
   turntable cheaply). No real scratch DSP in v1.
2. **Pad bank (middle):** a grid for the loaded kit — a row of **loop** pads (drums,
   bass, keys) and a row of **one-shots** (kick/snare/hat/fx, vinyl stop, airhorn).
   Loop pads toggle and **launch quantized to the next bar**; one-shots fire
   instantly. Active pads light up.
3. **Keyboard (bottom, full-width):** the on-screen `PianoKeyboard` (same footer
   pattern as the video player). **Split point** marked visually — the low zone is
   tinted as the **drum/one-shot zone** (its keys map to the kit's one-shots,
   mirroring the pads); the rest is melodic with the chosen voice. Real MIDI keys
   follow the same split.

Flow: pick a kit → tap loop pads to build a groove → finger-drum the low keys / tap
one-shots → solo melodically up top. Everything locked to one tempo.

### Touch points
- New `modes/Decks/Decks.jsx` (+ `Deck.jsx`, `PadBank.jsx`).
- `PIANO_MODES` gains `decks`; icon `svg/decks.svg` (from svgrepo 383655).
- Reuse `PianoKeyboard` for the footer; add split-zone tinting.

---

## 3. Content & audio engine

### Folder convention (`media/audio/dj/`)
One folder per kit, manifest-driven (like the emulator-console layout):

```
media/audio/dj/
  lofi/
    kit.yml          # name, bpm, key, splitNote (optional)
    loops/    drums.wav  bass.wav  keys.wav
    oneshots/ kick.wav snare.wav hat.wav vinyl.wav airhorn.wav
  funk/ …
```

- `kit.yml` carries the **native BPM** (loops pre-rendered at one tempo) + key.
- **One tempo per kit** — deck BPM = kit BPM, **no time-stretch** in v1. Stacked
  loop pads stay in sync because they're all from the loaded kit. (Cross-kit
  tempo-matching is a later feature.)

### Backend
- A manifest/list endpoint enumerates kits + files (adapter like the other media
  adapters); wavs serve as static media URLs.
- Frontend fetches the kit list via `usePianoList` (→ IndexedDB cache) and loads
  the chosen kit's audio buffers.

### Audio engine (Web Audio)
- A small **transport clock** at the deck BPM.
- One-shot buffers preloaded, fired immediately.
- Loop pads scheduled to **launch/stop on the next bar**.
- This same engine powers the keyboard's drum split AND the Keyboard-Drums preset —
  one code path, three surfaces.
- **Testability:** isolate schedulable logic as pure functions (transport/quantize
  math, note→one-shot mapping, manifest parsing); mock `AudioContext` for the rest.

### Config
- Auto-discover kits under `media/audio/dj`, with an optional per-piano
  `decks.kits` whitelist/order (consistent with `videos.plexCollection` etc.).

### Split point
- Default fixed (e.g. MIDI 48 / C3 and below = drums), overridable per kit via
  `kit.yml.splitNote`. **No in-UI split editor in v1.**

---

## 4. Keyboard Drums

Two entries in **Settings → Sound**:

- **Drum Kit (Onboard)** — an onboard voice `{ label, program }` that sends a
  Program Change to the piano's built-in drum kit. Pure config (add the program
  number to the piano's `voices`). No engine.
- **Drum Kit (Samples)** — a rendered "instrument" backed by the shared Web Audio
  engine, mapping a default kit's drums across the **whole** keyboard. Like today's
  rendered instruments, selecting it sends **Local Control off** so the piano's own
  sound mutes and the browser renders the kit.

---

## Testing

- **Pure-function units:** kit-manifest parsing; transport/quantize (note →
  bar-boundary launch); split-point mapping (MIDI note → drum vs. melodic;
  note → one-shot).
- **Component:** pad toggle launches/stops; Settings sheet opens from the chip;
  MIDI monitor renders incoming events; voice/instrument selection still drives
  `sendProgramChange` / `sendLocalControl` (preserve existing `PianoChrome` tests'
  intent, relocated).
- Lifecycle logging throughout (kiosk logging rule — no raw console).

## Cut from v1 (YAGNI)

- No time-stretch / cross-kit tempo-matching (one BPM per kit).
- No in-UI split-point editor (config / `kit.yml` only).
- No real scratch DSP beyond a light platter nudge.
- No recording/export (Studio already covers that).
- No two-deck crossfade (chose hybrid single-deck + pads).

## Menu after this change (8 tiles)

Videos · Music · Sheet Music · Games · Lessons · Studio · **Decks** · Composers
*(Instruments removed; its surface moves into the Settings sheet.)*
