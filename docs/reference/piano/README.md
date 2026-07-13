# Piano Kiosk

The Piano Kiosk is a dedicated, always-on touch app that lives on a tablet bolted to a
digital piano. It turns the instrument into a self-contained learning and play station:
the player sits down, the screen lights to a live keyboard, and from one home menu they
can watch video courses, follow sheet music, jam to albums, record themselves, drive a
beat machine, or trigger note-driven games — all reacting in real time to the keys they
press. It is a sibling of the Fitness app: a full-screen surface outside the general
screen framework, built for one room, one instrument, and a finger or a falling chord as
the only input it needs.

This document is the map of the whole stack — the runtime it lives in, the app that
renders, the MIDI pipeline that feeds it, the sound path, the modes, and the backend it
talks to. For the physical build and tablet provisioning see [kiosk-setup.md](./kiosk-setup.md);
for the game engines see [piano-games.md](./piano-games.md).

---

## The stack at a glance

```
  ┌─────────────────────────────────────────────────────────────┐
  │  Tablet (SM-T590, Android 10) — Fully Kiosk Browser          │
  │  full-screen WebView · window.fully JS interface             │
  │  ┌───────────────────────────────────────────────────────┐  │
  │  │  Piano SPA  (React, route = /piano)                    │  │
  │  │   chrome · home menu · 8 modes · games                 │  │
  │  │   ▲ MIDI context     ▲ sound context   ▲ playback ctx  │  │
  │  └───┬───────────────────┬──────────────────┬────────────┘  │
  │      │ Web MIDI (BLE)    │ MIDI out          │ WebSocket     │
  └──────┼───────────────────┼──────────────────┼───────────────┘
         │                   │                  │
   WIDI Master         the piano's         DaylightStation backend
   BLE-MIDI adapter    onboard voices      (config · Plex · devices ·
   → the piano         + voice bridge       studio takes · screen control)
```

Four layers cooperate:

1. **The kiosk runtime** — Fully Kiosk Browser (FKB) hosts the SPA full-screen and exposes
   a `window.fully` JavaScript interface for system actions (launch an Android settings
   screen, restart the WebView, manage the back button). FKB is what makes a web app behave
   like a fixed-function appliance.
2. **The SPA** — a React single-page app rooted at `/piano`. It owns routing, the persistent
   chrome, the home menu, and the eight modes. It never unmounts; modes mount and unmount
   beneath it as the player navigates.
3. **The MIDI + sound path** — the browser reads the piano over Web MIDI (delivered via a
   WIDI Master Bluetooth-MIDI adapter), turns raw bytes into a live note stream every part
   of the UI can subscribe to, and sends voice and effect changes back out to the piano (or
   to a local rendering bridge).
4. **The backend** — DaylightStation serves the piano's configuration, proxies Plex media
   for the content modes, controls the tablet screen for the screensaver, and persists
   studio recordings.

---

## Entry and routing

The app mounts once at `/piano` and stays mounted for the life of the kiosk. Above the
router it installs the things that must outlive any single view: the configuration
provider, body theming, and the render watchdog. Routing then branches on how many pianos
the household has. A single-piano household serves every mode directly under `/piano`
(no piano id in the URL); a multi-piano household keeps a chooser at `/piano` and gives
each instrument its own `/piano/<pianoId>` subtree, one kiosk per piano. Everything below
resolves a `basePath` from this decision and navigates relative to it, so the same mode
code works whether or not a piano id is present in the path.

Each piano resolves its configuration and then wraps its subtree in the MIDI, sound, and
playback providers before rendering the shell. The shell is the persistent chrome plus a
route table — one route per mode, with data-rich views carrying their identifiers in the
URL (a course and lecture, an album and track, a score). Because that state lives in the
route, a deep view survives a reload and a hardware back press walks the player back out
one level at a time rather than dumping them at the menu.

---

## Configuration

A piano's behaviour is data, not code. The household keeps one piano configuration file
that the backend serves to the app on load; the app resolves a single piano's settings by
layering its per-piano overrides over shared defaults over built-in fallbacks. The result
describes the keyboard's note range, which MIDI input to prefer, the hardware device
profile, the Plex collections that feed the content modes, the note combinations that
launch each game, the inactivity timeout, the optional screensaver, and an optional
"open Bluetooth settings" affordance for re-pairing.

Two ideas keep this clean. First, **nothing about the host platform is assumed** — the
Bluetooth-settings launcher, for example, is configured per piano rather than hard-coded,
so a non-Android client simply omits it. Second, **the served file is the one the app
reads** — a piano can have more than one configuration file in the data tree, but only the
one the backend endpoint parses takes effect, so kiosk settings must land in that file to
matter.

---

## The MIDI pipeline

A single hook is the MIDI authority for the whole app. On mount it requests Web MIDI
access, binds the preferred input (the keys arrive over Bluetooth through a WIDI Master
adapter, so the browser only ever sees an already-paired port), and begins translating
incoming messages into two shared structures: a live map of currently-held notes and a
rolling history of recent note events with start and end times. Note-on adds to both;
note-off closes the matching history entry; control changes such as the sustain pedal and
the onboard reverb/chorus selectors update their own state. A periodic sweep trims notes
that never received an end and discards history old enough that no visualization still
needs it, which keeps the falling-note display honest without unbounded growth.

That stream is published through a context, so every consumer — the home-screen keyboard,
the waterfall, the chord staff, the games, the studio recorder, the MIDI monitor — reads
the *same* notes from the *same* source. The same hook also owns MIDI **output**: program
and bank changes to pick a voice, control changes for effects, local-control toggles, an
all-notes-off panic, and scheduled playback for replaying a recorded take back through the
instrument. On a development machine with no hardware attached, number-row keys stand in
for MIDI notes so the UI can be exercised without a piano.

> **The real transport is more involved than "Web MIDI both ways."** On the kiosk, MIDI
> **IN** is read natively by the piano-bridge APK and relayed to the browser over WebSocket
> (bridge-first, with a Web-MIDI fallback for non-kiosk clients), while MIDI **OUT** is a
> direct browser Web MIDI write — two different transports over one shared BLE device. For
> the full topology, the reasoning behind every choice, the compromises, the resilience
> risks, and the debugging playbook, see **[midi-architecture.md](./midi-architecture.md)**.

---

## The sound path

The app distinguishes *what the player sees* from *what they hear*, and owns the latter
through a sound context. Most of the time the piano makes its own sound: selecting a voice
sends a program (and, where needed, bank) change out the MIDI port, and adjusting reverb
or chorus sends the corresponding control changes, all interpreted by the instrument's
firmware. The set of available voices and the exact effect mappings come from the
configured **hardware device profile** — a module that encodes one instrument's voice list
and effect control numbers as the single source of truth for that model. The
[Suzuki MDG-400 profile](../../../frontend/src/modules/Piano/PianoKiosk/devices/suzukiMdg400.js)
is the worked example: General-MIDI voice families plus onboard folk voices, with reverb
and chorus addressed by their documented control numbers.

When a richer timbre is wanted than the instrument's firmware provides, the app can hand
sound off to a local **voice bridge** — a separate rendering service the app reaches over
a WebSocket. Choosing a rendered instrument sends a fully-resolved preset (engine, sample
or patch, gain, tuning, velocity response, effects) to the bridge and mutes the piano's
local voice so only the rendered one is heard; live gain and reverb tweaks are sent as
follow-up parameter messages. The bridge connection self-heals with backoff, and its
status feeds the UI so the player sees when a rendered voice is actually live.

---

## The modes

The home menu is a grid of eight modes. Each is a self-contained route subtree with its
own data source; the chrome and the live keyboard are the only things they share.

| Mode | What it is | Fed by |
|------|------------|--------|
| **Courses** (Videos) | Watch piano lessons and lectures — a grid of courses, a lecture list, then a player with A/B looping, variable speed, a watch log, and a live staff sidebar showing the chord under the keys. | A Plex collection of video courses |
| **Music** | A jukebox: browse albums and playlists in a cover-flow carousel, then a now-playing screen that can dim to a glow and slide up a play-along keyboard. | Plex albums and playlists |
| **Sheet Music** | Browse a folder of scores; MusicXML files are engraved live and played along with (follow/metronome/manual modes, tap-to-seek, a moving cursor). Scanned page-image scores fall back to a page viewer. | A media folder of `.musicxml`/`.mxl` files (e.g. `media/docs/sheet-music/`), listed by the generic content API; a Plex collection still works for page-image scores |
| **Studio** | Free play that records the MIDI stream to a take and replays it back out the instrument; takes persist on the backend. | The live MIDI stream + saved takes |
| **Producer** | A beat-and-loop launcher: keys below a split fire drum one-shots, keys above play melodically over a looping bed. | Local audio kits |
| **Games** | A full-screen picker and host for note-driven games. | The MIDI stream + game engines |
| **Composers** | A study reference for the masters. *(Planned.)* | — |
| **Lessons** | Content-driven technique-drill browser. A drill stores a short seed figure + a transpose rule; the kiosk expands it to the full exercise (the figure climbing the scale and back), engraves it, and runs a MIDI follow-along — the right hand drives a cursor that lights the current notehead green and advances as you play it, with the next key lit on a live keyboard. | A media folder of drill collections (`media/docs/piano-lessons/{collection}/`), e.g. the bundled Hanon set |

Games deserve their own note: they plug in through a registry and can be launched either
by tapping a tile or by playing a configured chord combination on the keys, so a player can
jump into a game without leaving the instrument. Their engines and rules are documented
separately in [piano-games.md](./piano-games.md).

---

## Shared surfaces

A few components appear across many modes because they are the kiosk's visual vocabulary:

- **The keyboard** — a configurable-range visual keyboard (88 keys by default) that lights
  the notes being held. It memoizes individual keys so a single note press does not
  re-render the whole keyboard, supports target/wrong-note highlighting and rebuildable
  keys for games, and an optional split zone for Producer.
- **The waterfall** — falling-note bars driven entirely by CSS animation off the note
  history, so motion costs no per-frame JavaScript.
- **The chord staff** — a live grand staff that shows the peak chord under the hands,
  detects the key signature from a rolling buffer, and decays shortly after release.
- **The chrome** — a persistent header carrying a breadcrumb trail on one side and a status
  chip (MIDI connection and active voice, tap to open settings) on the other, with deeper
  routes free to publish their own breadcrumb segments.
- **Icons** — inline single-colour SVGs that inherit their button's colour.

---

## The kiosk runtime and resilience

Running unattended on a fixed appliance means the app has to manage its own environment and
recover from the rough edges of an aging WebView.

- **FKB interface.** A small wrapper around `window.fully` is the app's hand on the system:
  it can launch an Android target (such as the Bluetooth settings screen for re-pairing),
  react when FKB returns to the foreground after another app exits, and route the hardware
  back button through the app's own history. Every call is a no-op when the interface is
  absent, so the same code runs in a normal browser during development.
- **Inactivity return.** After a configured idle period with no notes and no touch, the app
  walks back to the home menu — unless playback is keeping it alive, which video and music
  signal through the playback context.
- **Screensaver.** Where a piano is configured with a screen device, idle time sleeps the
  tablet's display and a played note wakes it, with quiet-hours and during-playback
  guardrails. It is driven above the connect gate, so a tablet parked on the "connect your
  piano" screen (no MIDI connected) still sleeps after idle rather than staying lit forever.
- **Reload guard.** During states where an accidental pull-to-refresh would lose work (a
  recording in progress), a guard intercepts the unload.
- **Render watchdog.** A passive sensor measures frame-presentation rate and logs jank
  episodes, giving visibility into compositor stalls on the tablet. It can also self-heal
  by restarting the WebView, but that action is gated and currently disabled: on this
  hardware a restart does not recover a stalled frame clock and only churns the UI, so the
  watchdog runs as an instrument, not an actuator. See
  [performance.md](./performance.md) for what stalls on this device and why.

---

## Backend involvement

The backend is the piano's quartermaster, not its brain. It serves the **piano
configuration** the app loads on startup; it proxies **Plex** for the courses and music
collections; it exposes **local media** for Producer kits and for Sheet Music (MusicXML
scores listed from a folder and streamed verbatim); it offers **screen
control** for the screensaver and **device profiles** for hardware metadata; and it
persists **studio takes** under the piano so recordings survive reloads and redeploys.
Everything the modes fetch goes through the shared API helper, which handles auth and error
logging, so a backend outage degrades gracefully rather than breaking the surface.

---

## Where things live

| Concern | Path |
|---------|------|
| App root + routing | `frontend/src/Apps/PianoApp.jsx` |
| Home menu, chrome, tiles | `frontend/src/modules/Piano/PianoKiosk/Piano{Menu,Chrome,Tile}.jsx` |
| Configuration | `frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx` · `data/household/config/piano.yml` |
| MIDI pipeline | `frontend/src/modules/Piano/PianoKiosk/{useWebMidiBLE,PianoMidiContext,usePianoBridgeNotes,midiDecode}.js[x]` · `noteHistory.js` |
| MIDI architecture, compromises & risks | [midi-architecture.md](./midi-architecture.md) |
| Sound + device profiles | `frontend/src/modules/Piano/PianoKiosk/{PianoSoundContext,usePianoVoiceBridge,instrumentSpec}.js[x]` · `devices/` |
| Modes | `frontend/src/modules/Piano/PianoKiosk/modes/{Videos,Music,SheetMusic,Studio,Producer,Games,Lessons,Composers}/` |
| Games | `frontend/src/modules/Piano/gameRegistry.js` · `frontend/src/modules/Piano/Piano*Game*/` |
| Shared components | `frontend/src/modules/Piano/components/` · `PianoKiosk/icons/` |
| Kiosk runtime | `frontend/src/lib/fkb.js` · `PianoKiosk/{useInactivityReturn,usePianoScreensaver,useReloadGuard,useRenderWatchdog,useVanishingControls}.js[x]` |
| Backend | `backend/src/4_api/v1/routers/piano.mjs` · `backend/src/4_api/v1/routers/admin/apps.mjs` |
| Hardware + setup | [kiosk-setup.md](./kiosk-setup.md) |
| Game engines | [piano-games.md](./piano-games.md) |
| Sheet music player | [sheet-music-player.md](./sheet-music-player.md) |
| Performance + jank | [performance.md](./performance.md) |
