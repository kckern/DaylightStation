# Piano App — Design

**Date:** 2026-06-22
**Status:** Approved, in implementation (on `main`)

## Purpose

A dedicated, always-on **Piano App** for a tablet velcroed to an electric piano,
running in a kiosk. The piano student sits down and chooses from a touch menu:

- **Videos** — passive lessons/lectures (Plex collection).
- **Games** — reuse the existing 5 Piano games (Space Invaders, Tetris, Flashcards, Hero, Side-scroller).
- **Lessons** — gamified, notation-driven lessons (Simply-Piano style). **v1: shell only.**
- **Studio** — freeform play with falling-notes visual + record/playback.

Plus an **always-on chrome** (instrument/timbre control, connection status, home/back).

## Key architectural decisions

1. **Top-level App, NOT a screen-framework instance.** `screen-framework` is a
   config-driven, lean-back room display (panels/widgets, remote→media playback,
   ambient art, presence). The piano kiosk is a lean-in interactive instrument app
   with live MIDI, scoring, recording. Closest sibling = `FitnessApp`.
   Routed at `/piano/*` in `main.jsx`.

2. **MIDI = direct BLE-MIDI via Web MIDI API, NOT the WebSocket bridge.** The tablet
   pairs with the piano over Bluetooth-MIDI; the browser reads it through
   `navigator.requestMIDIAccess()`. This is bidirectional:
   - note-in → visualize / score / record
   - Program Change out → timbre control
   - note-out → studio playback (the piano sounds the recording)
   The existing WS-based `useMidiSubscription` continues to serve the wall-display
   `piano` widget (untouched). Shared pure note-history logic is extracted so both
   transports feed the same functions.

3. **Sound model: the piano makes all audible sound; app listens + sends.** App does
   not synthesize. Timbre = Program Change out. Studio playback = note-out.

4. **Extract a `MusicNotation` framework.** Notation logic is currently duplicated
   across `ActionStaff` (custom SVG) and `CurrentChordStaff` (abcjs). Consolidate
   the music model + conversion utilities, define a renderer interface, migrate both
   existing renderers now. Future MusicXML lesson renderer (OSMD or MusicXML→ABC)
   slots in against the same model. **abcjs renders ABC, not MusicXML** — that
   conversion/renderer choice is the lessons engine's central future decision.

5. **v1 scope:** Games (reuse), Videos (Plex, thin), Studio (record/playback, thin),
   Lessons (shell). All over the new MusicNotation framework + BLE MIDI.

6. **Theory lessons (tonal-backed).** Beyond notation-driven song lessons, the
   Lessons mode also hosts music-theory lessons graded by the **`tonal`** library
   (umbrella package; includes `@tonaljs/core` plus Scale/Chord/Key/Interval/
   Progression). tonal = theory + grading engine; MusicNotation = renderer.
   Four lesson types (skeletoned now, runners TBD):
   - **Chord ID / build-a-chord** — `Chord.detect` / `Chord.get`, graded by
     pitch-class-set equality (octave/voicing-independent).
   - **Interval trainer** — `Interval.semitones` / `distance`.
   - **Scale drills** — `Scale.get`, graded note-by-note ascending.
   - **Chord progressions** — `Progression.fromRomanNumerals` (quality from the
     numeral suffix, e.g. `IIm7 V7 Imaj7`), each step graded as a chord.
   Skeleton landed: `tonal` dep added; grading primitives (`theoryEngine.js`)
   real + unit-tested; catalog (`lessonTypes.js`) + placeholder
   `TheoryLessons.jsx`, under `modules/Piano/PianoKiosk/modes/Lessons/theory/`.

## File map

```
main.jsx                       <Route path="/piano/*" element={<PianoApp/>} />

frontend/src/Apps/PianoApp.jsx           shell: MIDI provider, chrome, mode router
frontend/src/Apps/PianoApp.scss

frontend/src/modules/MusicNotation/      NEW shared framework
  model/pitch.js               MIDI↔diatonic, sharp/flat spelling, clef assignment
  model/keySignature.js        KEY_SIGNATURES + detectKey (from CurrentChordStaff)
  model/handSplit.js           splitByHand, ottava (from CurrentChordStaff)
  renderers/SvgStaffRenderer.jsx   extracted from ActionStaff
  renderers/AbcRenderer.jsx        extracted from CurrentChordStaff (abcjs)
  renderers/MusicXmlRenderer.jsx   FUTURE (OSMD) — lessons
  Notation.jsx                 facade
  index.js

frontend/src/modules/Piano/
  PianoKiosk/
    PianoMenu.jsx              touch tile menu
    PianoChrome.jsx            always-on bar (timbre, connection, home, inactivity)
    useWebMidiBLE.js           NEW Web MIDI (BLE) in+out hook + PianoMidiContext
    modes/Videos/             Plex collection player
    modes/Games/              reuse gameRegistry
    modes/Lessons/            SHELL only
    modes/Studio/             NoteWaterfall + CurrentChordStaff + record/playback
  noteHistory.js               extracted pure fns (handleNoteOn/Off/trimHistory)
```

## Transport (useWebMidiBLE)

- `requestMIDIAccess()`, match preferred input by name, remember port id in localStorage.
- BLE pairing is OS-level; browser only sees paired ports → **connect-gate screen**
  on cold start if no input present. Chrome persists MIDI permission per-origin.
- Inbound: parse 0x90/0x80 note, CC64 sustain → shared `noteHistory.js`. Same surface
  as `useMidiSubscription` (`activeNotes`, `sustainPedal`, `noteHistory`) so modes are
  transport-agnostic.
- Outbound: `sendProgramChange()`, `sendNote()`, `scheduleNotes(events)`.
- Keep localhost computer-keyboard dev fallback (DEV_KEY_MAP).
- `access.onstatechange` → connection status in chrome, auto-rebind on reconnect.

## Data / config

`data/household/apps/piano/config.yml` (ConfigService):
```yaml
midi:
  preferredInputName: "..."
voices:
  - { label: "Grand Piano", program: 0 }
  - { label: "Electric Piano", program: 4 }
videos:
  plexCollection: "Piano"
inactivityMinutes: 10
```
- Studio takes → `data/household/apps/piano/studio/{id}.yml` (event array + meta).
- Lessons (future) → `data/household/apps/piano/lessons/*.musicxml` + sidecar meta.
- Backend: small piano router for studio save/load/list/delete over the data path;
  videos reuse existing Plex endpoints; **no MIDI backend** (all browser Web MIDI).

## Build sequence

1. **MusicNotation framework** — ✅ DONE. Extracted model (pitch/keySignature/
   handSplit) + renderers (abc.js, AbcRenderer, SvgStaffRenderer) + Notation
   facade + index. Migrated ActionStaff (→ SvgStaffRenderer) and CurrentChordStaff
   (→ AbcRenderer, model detectKey). Consumers (SideScroller/Flashcards/Tetris,
   PianoVisualizer) use unchanged public APIs. 61 tests green; no behavior change.
2. **App shell** — ✅ DONE. `PianoApp.jsx` + `/piano/*` route (sibling of
   FitnessApp). `useWebMidiBLE` (Web MIDI BLE in/out: note-in, sustain,
   Program Change out, sendNote/scheduleNotes, statechange rebind, dev-keyboard
   fallback) + `PianoMidiProvider`/`usePianoMidi` context. Connect-gate (idle→
   auto-connect, unsupported/denied/no-input messaging, "continue without piano").
   `PianoChrome` (status, home, voice picker), `PianoMenu` (4 tiles). Shared
   `noteHistory.js` extracted from useMidiSubscription (both transports use it).
   Mode entries scaffolded: Videos/Lessons placeholders, Games picker (registry),
   Studio shows live CurrentChordStaff via MIDI context. PianoApp render smoke
   test + noteHistory/parseMidiMessage tests. 264 tests green (no regressions).
3. **Games** — ✅ DONE. Games mode mounts the real registry games fullscreen via
   `getGameEntry().LazyComponent`, fed the shared MIDI stream (activeNotes,
   noteHistory) from usePianoMidi + per-game `gameConfig` (fetched from the piano
   app config's `games` block — no office-tv HA coupling) + `onDeactivate`/touch
   back button. Games verified self-contained (props-only, no screen-framework
   deps). Picker test green.
4. **Videos** — ✅ DONE. Lists a configured Plex collection
   (`videos.plexCollection` ratingKey, `plex:`-prefix tolerated) via
   `GET api/v1/list/plex/{ratingKey}`; thumbnail grid; tap mounts the shared
   `Player` (lazy/code-split) in an error boundary with a touch back button.
   Handles loading / empty / unconfigured / fetch-fail. Hermetic test (mocked
   DaylightAPI) covers list render + ratingKey stripping + no-config message.
5. **Studio** — ✅ DONE. Live NoteWaterfall + CurrentChordStaff fed by MIDI
   context. Recording via a new `subscribe` event-tap on useWebMidiBLE (noteHistory
   trims at 8s, so it can't be the buffer) → `useStudioRecorder` + pure
   `studioRecording.js` helpers (toTakeEvent/takeDuration/closeOpenNotes).
   Playback replays a take out the MIDI port via `scheduleNotes` (the piano sounds
   it). Save/list/play/delete against a NEW backend router
   `4_api/v1/routers/piano.mjs` (`/api/v1/piano/studio` CRUD over
   data/household/apps/piano/studio/{id}.yml; registered in app.mjs + api.mjs
   routeMap). Tests: studioRecording (6) + isolated supertest piano-router (4).
6. **Timbre + inactivity + config** — ✅ DONE. `PianoConfig` context loads the
   household piano config once; chrome voice picker → Program Change; idle→menu
   via `useInactivityReturn` (MIDI + touch activity). Per-mode fetches removed in
   favor of the context.
7. **Lessons notation shell** — ✅ DONE. `MusicXmlRenderer` placeholder added to
   the framework + wired into the `Notation` facade (`renderer="musicxml"`) and
   the Lessons "Songs" section. OSMD impl deferred.

## Multiple pianos per household (added)

A household can have multiple piano kiosks (one tablet per instrument), addressed
at **`/piano/:pianoId`**. `/piano` shows a picker (auto-enters when only one).
Config: top-level keys are shared defaults; a `pianos:` map overrides per piano
(`derivePianos`/`resolvePianoConfig`, unit-tested). Main piano = **`yellow-room`**.
Studio takes are scoped per piano:
`data/household/apps/piano/studio/{pianoId}/{id}.yml` via
`/api/v1/piano/:pianoId/studio` (router updated; isolation + traversal tested).
Roster vs active-piano split: `PianoConfigProvider` (raw + roster) above the
route; `ActivePianoProvider` (resolved config + pianoId) inside it.

## Testing

- Unit (Vitest): MusicNotation model (pitch/key/handSplit/ottava), MIDI byte parsing,
  Studio event capture/serialize round-trip.
- Migration safety net: capture current ActionStaff/CurrentChordStaff output for sample
  inputs; assert framework-backed versions match before refactor lands.
- Component: PianoMenu render/navigate; renderers produce expected notation.
- WebMIDI mockable (inject fake MIDIAccess); no hardware in CI.

## Logging (framework, never raw console)

- `midi.access-granted`, `midi.input-bound`, `midi.statechange`, `midi.disconnected`, `midi.out-send` (sampled)
- `piano.mode-enter`, `piano.inactivity-reset`, `piano.voice-change`
- `studio.record-start/stop`, `studio.playback-start`, `studio.save`
