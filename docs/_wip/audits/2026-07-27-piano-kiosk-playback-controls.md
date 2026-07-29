# Piano Kiosk — Playback-Control Audit & Consolidation Proposal

**Date:** 2026-07-27
**Scope:** every PianoKiosk surface with playback-like controls (play/pause, rewind/FF,
skip, restart, scrub/seek, volume, tempo/speed, key/transpose, loop, record).
**Method:** read every file that renders a transport control under
`frontend/src/modules/Piano/PianoKiosk/`, plus `frontend/src/Apps/PianoApp.scss`,
`modes/Producer/Producer.scss`, `producer/TransportSheets.scss`.
**Status:** read-only audit. No code changed.

**Headline:** 10 distinct transport implementations, 5 distinct volume models,
4 distinct speed/tempo models, 4 distinct loop models, and 6 distinct
button-style class families — for what is, from the player's seat, the same
handful of verbs on one 8" tablet.

---

## 1. Inventory matrix

### 1.1 Playable surfaces

| # | Surface | Entry file | Transport component |
|---|---------|-----------|---------------------|
| 1 | Sheet Music (score player) | `modes/SheetMusic/ScorePlayer.jsx:1122` | `modes/SheetMusic/ScoreTransportBar.jsx` |
| 2 | Videos (lecture player) | `modes/Videos/PianoVideoPlayer.jsx:272` | `modes/Videos/PianoVideoChrome.jsx` |
| 3 | Videos — fullscreen | `modes/Videos/PianoVideoPlayer.jsx:281` | `modes/Videos/FullscreenTransportOverlay.jsx` |
| 4 | Videos — bare tap zones | `modes/Videos/PianoVideoPlayer.jsx:231` | `modes/Videos/videoTapAction.js` (no chrome) |
| 5 | Music (Plexamp-style jukebox) | `modes/Music/MusicPlayer.jsx:148` | inline (`piano-music-player__transport`) |
| 6 | Singalong / Karaoke / Playalong | `modes/Singalong/SingalongPlayer.jsx:200` | inline (`piano-singalong-chrome`) |
| 7 | Studio playback (saved take) | `modes/Studio/StudioPlayback.jsx:167` | local `Transport` fn, `StudioPlayback.jsx:28-116` |
| 8 | Producer (jam/loop shell) | `modes/Producer/Producer.jsx:958` | `producer/TransportBar.jsx` (+ `TempoSheet`, `KeySheet`, `LoopMeter`) |
| 9 | Composer (editor playback) | `modes/Composer/EditorSurface.jsx:703` | single toolbar button, no bar |
| 10 | Lessons drill | `modes/Lessons/LessonDrill.jsx:217` | `lesson-drill__transport` (restart only) |
| — | Producer capture (record) | `producer/CaptureCard.jsx:427,464` | record-specific, counted separately |
| — | Producer per-layer gain | `producer/ChannelStrip.jsx:170`, `producer/GainStrip.jsx:117` | mixer, counted separately |
| — | Games | `modes/Games/Games.jsx` | **no transport** (games own their input) |
| — | Composers (reference mode) | `modes/Composers/Composers.jsx` | no transport |

### 1.2 Controls per surface

Legend: ● present · ○ absent · ◐ present in a different form

| Control | 1 SheetMusic | 2 Videos | 3 Videos FS | 4 Videos tap | 5 Music | 6 Singalong | 7 Studio | 8 Producer | 9 Composer | 10 Lessons |
|---|---|---|---|---|---|---|---|---|---|---|
| Play / Pause | ● | ● | ● | ● | ● | ● | ● | ● (Play/Stop) | ● | ○ |
| Stop (distinct from pause) | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ |
| Restart / start over | ● (Restart) | ● (`previous` icon) | ○ | ○ | ◐ (prev < 3 s) | ● (`previous`) | ○ | ○ | ○ | ● (`⟲ Restart`) |
| Skip back | ○ | ● −15 / −30 | ● −15 / −30 | ● −15 | ○ | ● −15 | ● −10 | ○ | ○ | ○ |
| Skip forward | ○ | ● +15 / +30 | ● +15 / +30 | ● +15 | ○ | ● +15 | ● +10 | ○ | ○ | ○ |
| Prev / Next track | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| Scrub / seek | ○ (tap score) | ● tap-only bar | ○ | ○ | ● tap-only bar | ● tap-only bar | ● **drag slider** | ○ (hold-to-jump) | ○ | ◐ (pointer scrub on staff) |
| Position readout | ● `m 3 / 24` | ● `m:ss / m:ss` | ○ | ○ | ● `m:ss` ×2 | ● `m:ss / m:ss` | ● `m:ss / m:ss` | ● `bar:beat · N bars` | ○ | ● `3 / 12` |
| Volume | ● none in bar | ● VolumeModal | ○ | ○ | ● MixControls | ● inline ± | ○ | ● per-layer GainStrip | ○ | ○ |
| Speed / tempo | ● Tempo % popover | ● rate cycle btn | ○ | ○ | ○ | ○ | ● speed pills | ● BPM sheet + TAP | ○ (score tempo) | ○ |
| Key / transpose | ● ± semitone | ○ | ○ | ○ | ○ | ○ | ○ | ● circle-of-fifths sheet | ○ | ○ |
| Loop | ● focus-range popover | ● A/B 4-button group | ○ | ○ | ● repeat toggle | ○ | ○ | ● implicit bar loop + meter | ○ | ○ |
| Shuffle | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| Metronome / click | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● (`Click`) | ○ | ○ |
| Record | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● (`●`) | ○ | ○ |
| Fullscreen | ○ | ● | ● (exit) | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| Queue / playlist | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| Close / exit player | ○ (breadcrumb) | ○ (breadcrumb) | ○ | ○ | ● back btn | ○ (breadcrumb) | ● `close` icon | ○ | ○ | ○ |

### 1.3 Implementation details per surface

#### 1 — Sheet Music · `ScoreTransportBar.jsx`
- **Layout:** pinned bottom bar, CSS grid `1fr auto 1fr` — left mode tabs, center transport, right view controls (`PianoApp.scss:2614-2622`).
- **Icons:** a **local** inline-SVG module `modes/SheetMusic/icons.jsx:13-26` (`PlayIcon`, `PauseIcon`, `RestartIcon`, `QuarterNoteIcon`, `CloseIcon`, `ChevronDownIcon`) — does **not** use the shared `icons/Icon.jsx` set.
- **Sizing:** `.piano-score-btn { min-width: 2.4rem; min-height: 3rem }` (`PianoApp.scss:2737-2750`) — explicitly documented as the 48 px target.
- **Styling:** `piano-score-*` family, dark stage tokens (`--piano-stage-fg`).
- **Volume:** none at all — the score player has no volume affordance.
- **Speed:** `TEMPO_STEPS` `[0.5, 0.75, 1, 1.25, 1.5]` behind a "Tempo NNN%" chevron popover, each step showing the resulting BPM (`ScoreTransportBar.jsx:24-30, 284-313`).
- **Key:** ± semitone buttons with `−` / `+` **text glyphs** and a `+N` readout (`ScoreTransportBar.jsx:259-282`); only enabled in Listen mode.
- **Loop:** `LoopControl.jsx:22-79` — chevron trigger, rehearsal-mark sections, "Select measures…" two-tap flow, ±1-measure nudge rows using `−`/`+` text.
- **Chrome policy:** always-on; every control renders in all modes but Perform and gates *in place* via `disabled` (documented at `ScoreTransportBar.jsx:347-375`). Perform unmounts the whole right/center cluster.
- **Perf:** four `React.memo` subtrees so a cursor step re-renders only the readout — the most engineered bar in the kiosk.

#### 2 — Videos · `PianoVideoChrome.jsx`
- **Layout:** static strip below the video (`piano-video-chrome`), progress bar on top + one flat `__row` of buttons with two `__spacer` flex gaps (`PianoVideoChrome.jsx:41-67`).
- **Icons:** shared `icons/Icon.jsx` set.
- **Sizing:** `min-width: 3rem; height: 3rem`; play `min-width: 4.5rem` (`PianoApp.scss:1489-1499`).
- **Scrub:** `onPointerDown` only, no drag, no thumb; blocked while the engagement gate is open (`PianoVideoChrome.jsx:27-34`).
- **Volume:** opens the shared `VolumeModal` (5-step Off/Low/Med/High/Max, log/linear curve) (`PianoVideoChrome.jsx:65,68`).
- **Speed:** one cycling button showing `{rate}×`, ladder `[0.5, 0.75, 1, 1.25, 1.5, 2]` (`pianoPlaybackRate.js:5`, `PianoVideoChrome.jsx:57`). Hidden entirely when `isSequential`.
- **Loop:** A/B group of 4 buttons — mark A, mark B, toggle, clear (`PianoVideoChrome.jsx:59-64`), wired to `useABLoop.js`.
- **Chrome policy:** always-on; individual buttons `disabled` on gate/sequential-lock.

#### 3 — Videos fullscreen · `FullscreenTransportOverlay.jsx`
- **Layout:** centered floating pill cluster over a dim scrim, plus an "Exit fullscreen" pill below (`FullscreenTransportOverlay.jsx:13-25`).
- **Sizing:** circular `3.4rem` buttons, play `4.4rem` (`PianoApp.scss:2967-2976`) — a *different* size and *different* shape from the same actions in surface 2.
- **Controls:** −30/−15/play/+15/+30 only. **No restart, no scrub, no volume, no rate, no loop** — five of the strip's controls simply vanish in fullscreen.
- **Chrome policy:** tap-summoned, backdrop-tap dismisses; no auto-hide timer.

#### 4 — Videos bare tap · `videoTapAction.js`
- Left third = −15 s, middle = toggle, right third = +15 s (`videoTapAction.js:11-17`), with a transient icon "flash" as feedback (`PianoVideoPlayer.jsx:154-160, 291-295`).
- Same zone model is re-implemented (identical import) by Singalong (`SingalongPlayer.jsx:165-171`) but **without** the flash feedback.

#### 5 — Music · `MusicPlayer.jsx`
- **Layout:** full-bleed cover art with an overlaid `__chrome` block: top row (back · meta · queue), bottom block (bar · times · transport row · MixControls).
- **Icons:** shared `icons/Icon.jsx`.
- **Sizing:** `.piano-music-btn { min-width: 3rem; height: 3rem }`, play `4.5rem × 3.5rem` (`PianoApp.scss:1991-1998`).
- **Scrub:** `onPointerDown` only (`MusicPlayer.jsx:124-130, 172`).
- **Volume:** `MixControls.jsx` — piano and media each as a `−  NN  +` cluster stepping ±0.10 linear (`MixControls.jsx:9,12-28`).
- **Speed:** none. **Key:** none.
- **Loop:** queue `repeat` toggle + `shuffle` toggle (`MusicPlayer.jsx:179,183`).
- **Chrome policy:** **the only auto-hiding chrome in the kiosk** — `useVanishingControls({ active: playing && !showQueue })`, 20 s idle, any pointer reveals (`MusicPlayer.jsx:65,150`). Also a third "play-along" state that dims chrome on MIDI activity (`MusicPlayer.jsx:37-50`).

#### 6 — Singalong / Karaoke / Playalong · `SingalongPlayer.jsx`
- **Layout:** near-clone of `PianoVideoChrome` (`piano-singalong-chrome`, `SingalongPlayer.jsx:212-229`) — the SCSS is a copy-paste of `.piano-video-chrome` down to the `10px` bar height and `0.5rem 1rem` padding (`PianoApp.scss:1535-1565` vs `1466-1494`).
- **Skips:** only ±15 (no ±30), unlike surface 2.
- **Volume:** a **third** volume model — inline `volume-down` / numeric / `volume-up`, `VOL_STEP = 0.1`, **media only**, no MIDI level, no modal (`SingalongPlayer.jsx:31, 224-226`).
- **Fullscreen:** icon swaps `fullscreen` ⇄ `fullscreen-exit` on state (`SingalongPlayer.jsx:227`); surface 2's equivalent button never swaps (`PianoVideoChrome.jsx:66`).
- No rate, no loop, no restart-to-zero difference from surface 2's restart (both `previous` icon).

#### 7 — Studio playback · `StudioPlayback.jsx:28-116`
- **Layout:** bottom transport panel, `__row` of controls above a full-width `__track`.
- **Icons:** shared set, but reuses `skip-back-15` / `skip-forward-15` for **±10 s** actions (`StudioPlayback.jsx:70-78`) — the icon and the behavior disagree.
- **Sizing:** play `3.25rem` circle; skip/exit `2.6rem` circles = **41.6 px, below the 48 px kiosk target** (`PianoApp.scss:961-988`).
- **Scrub:** the only true **drag slider** in the kiosk — `role="slider"`, pointer capture, `onPointerMove` seek, visible thumb `__track-head` (`StudioPlayback.jsx:99-113`; `PianoApp.scss:1004-1043`).
- **Speed:** `SPEEDS = [0.5, 1, 1.5]` as an always-visible pill row (`StudioPlayback.jsx:17, 81-92`) — a fourth ladder, a fourth presentation.
- **Loop:** none. **Volume:** none. **Restart:** none (only scrub to 0).
- Renders raw `{s}×` text, no `speed` icon.

#### 8 — Producer · `producer/TransportBar.jsx`
- **Layout:** top band (`piano-producer-mode__transport`), flex-wrap row: play · bar:beat · BPM chip · Key chip · Click · Record.
- **Icons:** **none** — `'◼ Stop'` / `'▶ Play'` and `'●'` are **Unicode text glyphs** (`TransportBar.jsx:108, 153`).
- **Sizing:** `min-height: 3rem` throughout; play pill `min-width: 6.5rem` (`Producer.scss:37-99`).
- **Position:** `bar:beat · N bars`, rAF-polled at ≤4 Hz (`TransportBar.jsx:65-98`).
- **Speed:** absolute BPM via `TempoSheet.jsx` — big readout, `−`/`+` **text** steppers, a TAP pad, and presets `[72, 90, 110, 120, 140]` (`TempoSheet.jsx:6, 45-61`).
- **Key:** `KeySheet.jsx` — a circle-of-fifths wedge ring (`KeySheet.jsx:43-61`). Completely different metaphor from Sheet Music's `− 0 +`.
- **Loop:** implicit — the transport always loops; `LoopMeter.jsx` renders one segment per bar with a swept cursor (`LoopMeter.jsx:45-54`).
- **Volume:** per-layer only, via `ChannelStrip.jsx:170-210` chip → popover → `GainStrip.jsx:117-151` (11 segments, own log curve, commit-on-pointer-up with a 12 px drift cancel).
- **Chrome policy:** always-on; tempo/key chips `disabled` while a capture session is open.

#### 9 — Composer · `EditorSurface.jsx:703-714`
- One toolbar button. Icon **and** word (`Play` / `Pause`), from a **third** icon module `modes/Composer/icons.jsx:73-88` (`IconPlay`, `IconPause`) drawn on a 24-unit grid with `strokeWidth 1.7`.
- Plays from the caret; no pause-resume position, no scrub, no rate, no volume, no restart, no position readout.
- The file's own header comment (`icons.jsx:1-15`) states the no-Unicode rule explicitly — and it is the mode that follows it most rigorously.

#### 10 — Lessons drill · `LessonDrill.jsx:217-223`
- Progress text + a single **`⟲ Restart`** button with a Unicode glyph (`LessonDrill.jsx:221`).
- `.lesson-drill__reset` has `padding: 0.35rem 0.9rem` and **no min-height** (`PianoApp.scss:670-678`) → roughly a 30 px target.
- Scrubbing exists but as a pointer-drag over the engraved staff (`LessonDrill.jsx:113`), not a transport control.

### 1.4 Cross-cutting model tables

**Volume — 5 models**

| Model | Where | Shape | Curve | Scope |
|---|---|---|---|---|
| `VolumeModal.jsx` | Videos only | modal, 5 steps ×2 rows + Log/Linear toggle | `volumeCurve.js` `x^2.5` | media + MIDI |
| `MixControls.jsx` | Music only | inline `− NN +` ×2 | linear ±0.1 | media + MIDI |
| inline in `SingalongPlayer.jsx:224-226` | Singalong/Karaoke/Playalong | `− NN +` ×1 | linear ±0.1 | media only |
| `GainStrip.jsx` | Producer layers | 11-segment strip | own `10^((L−100)·0.02)` | per-layer gain |
| `SoundPanel.jsx:252-257` `ToneStepper` | Sound panel | 5 steps | `VOL_STEPS` table | MIDI voice |

Three of these five ship a *different* mapping from tap to loudness.

**Speed / tempo — 4 models**

| Ladder | Where | Presentation |
|---|---|---|
| `[0.5, 0.75, 1, 1.25, 1.5, 2]` | Videos (`pianoPlaybackRate.js:5`) | one cycling button, `1.25×` |
| `[0.5, 1, 1.5]` | Studio (`StudioPlayback.jsx:17`) | always-visible pill row, `1.5×` |
| `[0.5, 0.75, 1, 1.25, 1.5]` | Sheet Music (`ScoreTransportBar.jsx:24-30`) | popover, `125%` + derived BPM |
| absolute BPM 40–220 | Producer (`TempoSheet.jsx`) | sheet: readout, ±1, TAP, presets |

**Loop — 4 models:** A/B marks on a timeline (Videos), measure/rehearsal-mark focus range (Sheet Music), always-on bar loop with a segment meter (Producer), queue repeat (Music).

**Scrub — 4 behaviours:** tap-only bar with no thumb (Videos, Singalong, Music), full drag slider with thumb (Studio), tap-the-score cursor move (Sheet Music), press-and-hold-to-queue-jump (Producer `SongView.jsx:211-218`).

**Chrome policy — 3 behaviours:** always-on (Sheet Music, Videos strip, Singalong, Studio, Producer, Composer, Lessons); auto-hide after 20 s idle (Music only); tap-summoned overlay (Videos fullscreen only).

**Button style families — 6:** `.piano-score-btn`, `.piano-video-chrome__btn`, `.piano-singalong-chrome__btn`, `.piano-music-btn`, `.piano-playback__{play,skip,exit,speed}`, `.piano-producer-mode__{play,chip,metro,rec}` — plus `.piano-fs-overlay__btn` and `.composer-toolbar__play` as one-offs. Eight if you count those.

---

## 2. Inconsistency findings

Each of these is something a person moving between two modes on the same tablet
would actually notice.

### F1 — Two adjacent skip buttons render the *identical* glyph
`icons/svg/skip-back-15.svg` and `skip-back-30.svg` are byte-identical files;
so are `skip-forward-15.svg`/`skip-forward-30.svg` and `loop-a.svg`/`loop-b.svg`
(verified by `cmp`). `icons/MANIFEST.md` says the numerals "are intended as a UI
text overlay" and the A/B letters should be overlaid — **no consumer does this**.
`PianoVideoChrome.jsx:50-54` renders four skip buttons where −30/−15 and +15/+30
are visually indistinguishable; `PianoVideoChrome.jsx:60-61` renders mark-A and
mark-B as the same picture. Same defect in `FullscreenTransportOverlay.jsx:16-20`.

### F2 — Unicode glyphs used as icons, against the house rule
The rule is written down in two files in this very tree
(`modes/Composer/icons.jsx:1-15`, `modes/SheetMusic/icons.jsx:1-6`) and is
violated in the transport layer:
- `producer/TransportBar.jsx:108` — `{isPlaying ? '◼ Stop' : '▶ Play'}` (the Producer's primary transport control)
- `producer/TransportBar.jsx:153` — `●` (record)
- `producer/CaptureCard.jsx:428` — `● Arm`
- `modes/Lessons/LessonDrill.jsx:221` — `⟲ Restart`
- `modes/Karaoke/Karaoke.jsx:149` — `▶` on every song card
- `modes/Videos/PianoContextRail.jsx:9` / `RepertoireBrowser.jsx:69,83,95` — `▸` / `◂`
- `producer/GainStrip.jsx:147`, `SongPicker.jsx:84,114,121`, `VoicePicker.jsx:119,143`, `LibraryBrowser.jsx:469`, `CaptureCard.jsx:382` — `✕`, `▾`, `▸`
- `modes/Studio/StudioRecordings.jsx:60` — `★`/`☆`
- `modes/SheetMusic/ScoreTransportBar.jsx:269,279` and `LoopControl.jsx:59-63` and `TempoSheet.jsx:46,48` — `−` / `+` as button faces

The tofu risk is real on this exact device — it is why `Composer/icons.jsx` and
`DurationPalette` were hand-drawn in the first place.

### F3 — Drag slider in Studio, tap-only bars everywhere else
`StudioPlayback.jsx:99-113` implements a pointer-captured drag scrubber with
`role="slider"` and a visible thumb. Every other seekable surface is
pointer-down-only with no thumb (`PianoVideoChrome.jsx:41`,
`SingalongPlayer.jsx:213`, `MusicPlayer.jsx:172`). This contradicts the
"no drag sliders — discrete tap targets" rule that `ScoreTransportBar.jsx:22-23`
and `ChannelStrip.jsx:168-169` both cite in comments.

### F4 — Touch targets below 48 px on two surfaces
- `.piano-playback__skip`, `.piano-playback__exit`: `2.6rem` = **41.6 px** (`PianoApp.scss:975-988`)
- `.lesson-drill__reset`: no min-height, ≈30 px (`PianoApp.scss:670-678`)
- `.piano-volume-modal__close`: `2rem` = **32 px** (`PianoApp.scss:2216-2222`) — the only dismiss on a modal
- `.piano-volume-modal__curve-btn`: `min-height: 2.1rem` = 33.6 px

By contrast `.piano-score-btn` (`min-height: 3rem`) and `.piano-volume-modal__step`
(`min-height: 52px`) are correct — the standard exists, it just is not applied uniformly.

### F5 — The same skip action has three different durations and two different icons
±30/±15 (Videos), ±15 only (Singalong), ±10 (Studio — labelled with the
`skip-back-15` icon at `StudioPlayback.jsx:70-78`, and with `aria-label="Back 10
seconds"`, so the picture and the label contradict each other). The bare-tap
zone uses `TAP_SKIP_SECONDS = 15` everywhere (`videoTapAction.js:4`).

### F6 — Volume means three different things in three video-ish players
Videos opens a full modal with media *and* MIDI on a log curve
(`PianoVideoChrome.jsx:65`). Music shows two always-visible ± clusters on a
linear curve (`MusicPlayer.jsx:185-191`). Singalong shows one ± cluster,
media only, linear (`SingalongPlayer.jsx:224-226`). Sheet Music and Studio
offer no volume at all — even though Sheet Music is the mode where a student
most wants to duck the kiosk's demo playback.

### F7 — Fullscreen silently strips half the transport
Entering fullscreen from `PianoVideoChrome.jsx:66` moves the user from a
13-control strip to a 5-control tap-summoned pill
(`FullscreenTransportOverlay.jsx:13-25`). Restart, scrub, position readout,
rate, the whole A/B loop group and volume are gone with no indication that they
still exist. The buttons that survive also change from `3rem` rectangles to
`3.4rem` circles.

### F8 — Fullscreen toggle icon is stateful in one player, static in the other
`SingalongPlayer.jsx:227` swaps `fullscreen` ⇄ `fullscreen-exit`;
`PianoVideoChrome.jsx:66` always shows `fullscreen`, so in the lecture player
the button lies about what it will do.

### F9 — Tap-to-toggle feedback exists in Videos, missing in Singalong
Both import the same `videoTapAction` zone map, but only Videos flashes an icon
confirming what the tap did (`PianoVideoPlayer.jsx:157-160, 291-295`). In
Singalong (`SingalongPlayer.jsx:165-171`) a mis-aimed tap seeks 15 s with no
visual acknowledgement at all.

### F10 — One mode auto-hides its chrome, nine do not
`MusicPlayer.jsx:65` is the sole consumer of `useVanishingControls`. Every other
player keeps chrome permanently on screen — including the two full-bleed video
players where the auto-hide would matter most.

### F11 — Key/transpose is a stepper in one mode, a circle of fifths in another
`ScoreTransportBar.jsx:259-282` (`Key − 0 +`, semitone offsets) vs
`producer/KeySheet.jsx:43-61` (tap a wedge on a circle of fifths, emits a
shortest-path delta). Same underlying concept, no shared vocabulary, no shared
component.

### F12 — Tempo is a percentage in one mode and a BPM in another
`ScoreTransportBar.jsx:292` shows `Tempo 125%` (with the derived BPM as a
sub-label); `TransportBar.jsx:125` shows `120 BPM`; `StudioPlayback.jsx:90`
shows `1.5×`; `PianoVideoChrome.jsx:57` shows `1.25×`. Four notations for
"how fast".

### F13 — Position readout format differs on every surface
`m 3 / 24` (Sheet Music, `ScoreTransportBar.jsx:429-431`), `1:23 / 4:56`
(Videos/Singalong/Studio, three separate `fmt`/`mmss` helpers at
`PianoVideoChrome.jsx:6-11`, `SingalongPlayer.jsx:24-29`,
`StudioPlayback.jsx:18-21` — near-identical duplicated code), two split spans
(Music, `MusicPlayer.jsx:175-177`), `3:2 · 4 bars` (Producer,
`TransportBar.jsx:111-114`), `3 / 12` (Lessons, `LessonDrill.jsx:218-220`).

### F14 — The play button's visual weight is inconsistent
Accent-filled and wider than its neighbours in Videos/Singalong/Music
(`--play` modifiers), a plain `is-on` green in Sheet Music
(`.piano-score-run[aria-pressed="true"]`), an accent circle in Studio, an
outlined pill that turns *red* when playing in Producer
(`Producer.scss:37-49` — the only place where "playing" is signalled with the
danger colour, because the button is really Play/Stop).

### F15 — Duplicated media-element plumbing
`PianoVideoPlayer.jsx:184-208` and `SingalongPlayer.jsx:135-152` are the same
`timeupdate`/`play`/`pause`/`loadedmetadata` mirroring effect, and
`PianoVideoPlayer.jsx:218-222` / `SingalongPlayer.jsx:158-162` are the same
clamped `handleSkip`. Any fix to one silently skips the other.

### F16 — `useLoopTransport.js` is dead code
No non-test consumer remains: Producer moved to `producer/useProducerTransport.js`
(which cites it in its header at `useProducerTransport.js:3`) and
`producer/usePeek.js:8` notes it replaced a second `useLoopTransport`. The hook
and its test still ship. It should be deleted or become the basis of the shared
MIDI-timeline transport (see §4).

---

## 3. Existing reusable seams

**Already shared and healthy**
- `icons/Icon.jsx` + `icons/svg/*` — inline SVG, `currentColor`, `1em`. Used by Videos, Singalong, Music, Studio. **Not** used by Sheet Music, Composer, Producer.
- `volumeCurve.js` — `STEPS` + `stepToLevel`/`levelToStep`, pure and tested. Only `VolumeModal` consumes it.
- `PianoMixContext` — the single source of `mediaLevel` / `pianoLevel`. All three video-ish players read it; they just disagree on the UI.
- `usePlayerController` + `useResolvedMediaEl` + `usePauseMediaOnUnmount` — the media seam shared by Videos and Singalong.
- `Skeleton.jsx`, `PianoBreadcrumbContext` — consistent everywhere.

**Shared but under-used (one consumer each)**
- `VolumeModal.jsx` → Videos only.
- `MixControls.jsx` → Music only.
- `useVanishingControls.js` → Music only.
- `GainStrip.jsx` (+ its level/curve helpers) → Producer only, though it is the best-engineered touch-volume control in the tree (scroll-safe, commit-on-up, drift cancel).

**Nearly shareable but hand-rolled per mode**
| Concept | Duplicated at |
|---|---|
| `mm:ss` formatter | `PianoVideoChrome.jsx:6`, `SingalongPlayer.jsx:24`, `StudioPlayback.jsx:18`, `RecordButton.jsx:5`, `StudioRecordings.jsx:5`, `musicTracks.js formatTime` |
| `nearestStep` for a discrete ladder | `ScoreTransportBar.jsx:33`, `ViewMenu.jsx:27`, `SoundPanel.jsx`, `volumeCurve.js levelToStep`, `GainStrip.jsx snapToGainLevel` |
| tap-only progress bar + `%` fill | `PianoVideoChrome.jsx:27-45`, `SingalongPlayer.jsx:176-182,213-215`, `MusicPlayer.jsx:124-130,172-174` |
| play/pause icon swap | 6 places, 3 icon sets |
| skip handler with clamp | `PianoVideoPlayer.jsx:218`, `SingalongPlayer.jsx:158` |
| single-open popover + backdrop | `ScoreTransportBar.jsx:210-212,340-342`, `LoopControl.jsx:47-49`, `ChannelStrip.jsx:190-195`, `TransportBar.jsx:64` |
| bottom-sheet + scrim + Done | `TempoSheet`, `KeySheet`, `AddLayerSheet`, `ChordBuilder`, `DrumSequencer` (share `TransportSheets.scss` — the *only* good sheet abstraction) |

**Transport engines (deliberately different, keep them)**
- `useScoreTransport.js` — setInterval + MIDI look-ahead scheduling (jank-proof).
- `useStudioPlayback.js` — rAF wall clock with speed and held-note reconstruction.
- `useProducerTransport.js` — rAF bar/beat loop with a `positionRef`.
- `usePlayerController` — the HTML media element.
These are correctly separate; **the UI on top of them should not be.**

---

## 4. Consolidation proposal — a PianoKiosk transport design system

Design constraints observed in the tree and in the household rules:

1. Touch kiosk, no hover, **≥48 px (3rem) targets** — the standard already lives in `.piano-score-btn`.
2. **Inline SVG only, never Unicode glyphs** — the WebView has no font for them.
3. **No drag sliders**; discrete tap targets, and where a strip is used, commit on pointer-*up* with a drift cancel (the `GainStrip` pattern).
4. The bar must be cheap to re-render at 4–60 Hz — the `ScoreTransportBar` memo discipline is the reference.
5. Modes differ genuinely (a score has measures, a video has seconds, a jam has bars) — parameterize, don't flatten.

### 4.1 Proposed component family

New directory: `frontend/src/modules/Piano/PianoKiosk/transport/`

| Component | Responsibility | Key props |
|---|---|---|
| `TransportBar` | The bar shell: three-zone grid (`lead` / `main` / `trail`), safe-area padding, one background/z-index rule, one narrow-width fallback. | `zones={{lead, main, trail}}`, `variant='strip'\|'overlay'\|'band'`, `tone='stage'\|'surface'`, `autoHide={false\|{idleMs}}`, `dense` |
| `TransportButton` | The one button primitive. Enforces the 3rem min box, the `is-on`/`is-arming`/`disabled` grammar, icon-only vs icon+label, and `aria-label`/`aria-pressed`. | `icon`, `label`, `emphasis='primary'\|'default'\|'quiet'`, `state='off'\|'on'\|'arming'`, `disabled`, `onPress` |
| `TransportGroup` | A hairline-joined cluster (the A/B loop group pattern from `PianoVideoChrome.jsx:59`). | `children`, `accent` |
| `PlayPauseButton` | The one play/pause/stop control. Owns the icon swap, the accent fill, the `Preparing…` state, and the Play-vs-Stop semantic. | `playing`, `mode='play-pause'\|'play-stop'`, `ready`, `lockedReason` |
| `SkipButtons` | Symmetric skip cluster. Renders the numeral **overlaid on the glyph**, which fixes F1 for free. | `steps=[15,30]`, `unit='s'\|'bar'`, `onSkip(delta)`, `forwardDisabled` |
| `ScrubBar` | Tap-to-seek progress track. **No drag, no thumb** by default; `markers` for A/B; `ceiling` for the sequential forward-lock. | `position`, `duration`, `onSeek`, `markers=[]`, `ceiling`, `disabled` |
| `PositionReadout` | One formatter with unit modes, replacing six copies. | `mode='time'\|'measure'\|'bar-beat'\|'step'`, `position`, `total`, `extra` |
| `StepControl` | The generic discrete ladder (this is what `nearestStep` keeps being rewritten for). Renders inline or in a popover. | `steps=[{label, value, sub}]`, `value`, `onChange`, `presentation='inline'\|'popover'\|'sheet'`, `label` |
| `SpeedControl` | `StepControl` preset for rate/tempo, with a `notation` axis to settle F12. | `ladder`, `value`, `onChange`, `notation='multiplier'\|'percent'\|'bpm'`, `baseBpm` |
| `KeyControl` | Transpose. Two presentations behind one prop so Sheet Music and Producer stop being different concepts. | `value`, `onChange`, `presentation='stepper'\|'circle'`, `tonicPc` |
| `LoopControl` | Generalized from the score's version: `kind='range'` (measures/sections), `kind='ab'` (timeline marks), `kind='bars'` (implicit loop + meter). | `kind`, `active`, `scopeLabel`, `options`, `onSet`, `onClear`, `onNudge` |
| `VolumeControl` | One volume affordance with a size axis: `compact` = a single button opening `VolumeSheet`; `inline` = the ± cluster. Always the `volumeCurve.js` mapping, always `PianoMixContext`. | `channels=['media','piano']`, `presentation='compact'\|'inline'`, `curve` |
| `VolumeSheet` | Today's `VolumeModal`, renamed and reparented onto `TransportSheets.scss`; 48 px close button. | `channels`, `open`, `onClose` |
| `LevelStrip` | `GainStrip` promoted out of `producer/`, kept for per-layer mixing. | `level`, `onLevel`, `curve`, `muted` |
| `TapZoneTransport` | The bare-tap zone map + the flash feedback, as one component instead of a util plus per-mode wiring. | `onSkip`, `onToggle`, `skipSeconds`, `feedback=true` |
| `useTransportChrome` | Merges `useVanishingControls` with an explicit policy: `'always'` / `'auto-hide'` / `'summon'`. One hook so F7/F10 become a prop. | `{ policy, active, idleMs }` |

Plus: move `Icon` usage to 100 % — retire `modes/SheetMusic/icons.jsx` and
`modes/Composer/icons.jsx`'s transport glyphs into `icons/svg/` (keep Composer's
notation-specific glyphs, they are domain art, not chrome), and add the
numeral/letter overlays the manifest already assumes.

### 4.2 Parameterization axes (the whole design in five knobs)

1. **Which controls appear** — composition, not flags: each mode passes its own children into `TransportBar` zones.
2. **Presentation** — `inline | popover | sheet` on every settings-shaped control (speed, key, loop, volume). This is the single axis that reconciles Sheet Music's popovers with Producer's sheets.
3. **Sizing** — `dense | comfortable`, floor 48 px in both; `emphasis` for the primary action.
4. **Chrome policy** — `always | auto-hide | summon`, one hook, so a full-bleed video can auto-hide and a bar over a score cannot.
5. **Units** — `time | measure | bar-beat | step` for position; `multiplier | percent | bpm` for speed; `s | bar` for skip.

### 4.3 Per-mode migration mapping

| Mode | Replace | With |
|---|---|---|
| **Singalong / Karaoke / Playalong** (`SingalongPlayer.jsx:200-231`) | whole `piano-singalong-chrome` block + local `fmt` | `<TransportBar variant='strip'>` · `ScrubBar` · `PositionReadout mode='time'` · `PlayPauseButton` · `SkipButtons steps={[15]}` · `VolumeControl presentation='compact'` · `TransportButton icon=fullscreen` |
| **Videos** (`PianoVideoChrome.jsx` entire) | whole file | same as above + `SkipButtons steps={[15,30]}` · `SpeedControl notation='multiplier'` · `LoopControl kind='ab'` · `ceiling={furthestWatched}` on `ScrubBar` |
| **Videos fullscreen** (`FullscreenTransportOverlay.jsx`) | whole file | `<TransportBar variant='overlay' autoHide={{summon:true}}>` with **the same children as the strip** — F7 disappears because the two are one declaration with a different `variant` |
| **Videos tap** (`PianoVideoPlayer.jsx:231-246, 291-295`) | inline handler + flash state | `<TapZoneTransport>` |
| **Music** (`MusicPlayer.jsx:171-192`) | `__bottom` block | `TransportBar variant='overlay' autoHide` · `ScrubBar` · `PositionReadout` · shuffle/prev/`PlayPauseButton`/next/repeat as `TransportButton`s · `VolumeControl presentation='inline' channels={['piano','media']}` (retires `MixControls.jsx`) |
| **Studio playback** (`StudioPlayback.jsx:28-116`) | local `Transport` | `TransportBar` · `SkipButtons steps={[10]} unit='s'` (with correct 10 s glyphs) · `PlayPauseButton` · `PositionReadout` · `SpeedControl ladder={[0.5,1,1.5]} notation='multiplier' presentation='inline'` · `ScrubBar` (drag removed — F3) · `TransportButton icon=close` |
| **Sheet Music** (`ScoreTransportBar.jsx`) | the shell + `piano-score-btn` faces; **keep** the memo structure and the mode-tab zone | `TransportBar zones={{lead: <ModeTabs/>, …}}` · `PlayPauseButton ready/lockedReason` · `TransportButton icon=restart` · metronome as `TransportButton` · `LoopControl kind='range'` · `PositionReadout mode='measure'` · `SpeedControl notation='percent' baseBpm` · `KeyControl presentation='stepper'` · `StepControl` for ViewMenu sizes. Add `VolumeControl` (closes F6). Retire `modes/SheetMusic/icons.jsx`. |
| **Producer** (`producer/TransportBar.jsx`) | the whole bar's markup | `TransportBar variant='band'` · `PlayPauseButton mode='play-stop'` (kills `▶`/`◼` — F2) · `PositionReadout mode='bar-beat'` · `SpeedControl notation='bpm' presentation='sheet'` (wraps today's `TempoSheet`) · `KeyControl presentation='circle'` (wraps `KeySheet`) · metronome + record as `TransportButton icon='metronome'|'record'` (both icons already exist and are unused) |
| **Producer mixer** (`ChannelStrip.jsx:170-210`, `GainStrip.jsx`) | move `GainStrip` up | `transport/LevelStrip.jsx`, same behaviour |
| **Composer** (`EditorSurface.jsx:703-714`) | the bespoke button | `PlayPauseButton emphasis='primary' label` — keeps icon+word, loses the third icon module for transport |
| **Lessons drill** (`LessonDrill.jsx:217-223`) | `⟲ Restart` | `TransportBar dense` · `PositionReadout mode='step'` · `TransportButton icon='restart' label='Restart'` (F2 + F4) |

### 4.4 Rule enforcement to add alongside

- An eslint rule (or a unit test over the JSX source) banning non-ASCII symbol characters as button *content* under `modules/Piano/`, with an allow-list for musical spellings (`♯`, `♭`, `♩` in notation contexts).
- A style test asserting every `transport/` button's computed `min-height` ≥ 48 px.
- Overlay numerals on `skip-*-15/30` and letters on `loop-a/b` inside `SkipButtons`/`LoopControl`, then de-duplicate the four identical SVG files.
- Delete `useLoopTransport.js` + its test (F16), or repurpose it as the shared MIDI-timeline engine behind Studio/Composer.

---

## 5. Migration order recommendation

**1st — Singalong / Karaoke / Playalong (`SingalongPlayer.jsx:200-231`).**
It is the smallest complete transport (7 controls), it is a near-verbatim copy of
`PianoVideoChrome` so building the primitives against it produces exactly the
API Videos needs next, it has the fewest states (no gate, no sequential lock, no
loop, no rate), and it is a leaf: nothing imports its chrome. It also serves
three routes at once (Singalong, Karaoke, Playalong), so one conversion visibly
fixes three modes. Risk if it regresses: a karaoke song, not a lesson.

**2nd — Videos (`PianoVideoChrome.jsx` + `FullscreenTransportOverlay.jsx`).**
Highest duplication payoff: the two files collapse into one declaration with a
`variant` prop, which is the single fix for F7, F8, F9 and (via `SkipButtons`)
F1. Doing it right after Singalong means the primitives are still warm and the
gate/sequential/`ceiling` requirements land as props rather than retrofits.

**3rd — Studio playback.** Small, isolated, and where the two hard *behavioural*
rule violations live (F3 drag slider, F4 41.6 px targets). Converting it proves
`ScrubBar`'s tap-only model on a surface that currently drags.

**4th — Music.** Retires `MixControls` into `VolumeControl` and proves the
`auto-hide` chrome policy as a prop, which Videos can then adopt.

**5th — Producer.** Highest user-visible payoff for F2 (its primary Play control
is a Unicode glyph) but the most entangled bar: capture lock, sheets, `positionRef`
polling. Convert only after the sheet presentation axis is proven by Music/Studio.

**6th — Sheet Music.** Deliberately last despite being the most-used player: its
bar is the most carefully engineered (four memo boundaries, stable-geography
gating, per-mode disable rules documented against prior audits), so it has the
most to lose from a mechanical port. It should *donate* its patterns to the new
primitives first and adopt them last.

**7th — Composer, Lessons.** One-button cleanups; batch them with whichever pass
is convenient.
