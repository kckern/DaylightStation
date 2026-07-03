# Piano Sheet Music — Playback (Metronome mode) Audit

> **Status (2026-07-03): IMPLEMENTED.** Executed per
> `docs/_wip/plans/2026-07-02-piano-sheetmusic-playback-optimization.md`, committed to
> `main`. See "Implementation status" at the bottom for the finding→commit map, what was
> verified, and what remains deferred.

**Date:** 2026-07-02
**Scope:** `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` (ScorePlayer, SheetMusic routing) plus the engraving layer it drives (`frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx`, `osmdRender.js`) and the parser (`parseMusicXml.js`). Focus: metronome-mode playback, MIDI integration, scroll smoothness, auto pan/follow, cursor positioning over time, engraving overlap (user screenshot), wrap↔flow toggle.
**Method:** static code audit; OSMD 2.0 option/rule surface verified against `frontend/node_modules/opensheetmusicdisplay` typings.

---

## Architecture snapshot (as-built)

- `SheetMusic.jsx` routes `view/*` → fetches raw MusicXML → `ScorePlayer`.
- `ScorePlayer.jsx` owns three modes (Follow / Metronome / Manual), flow toggle (wrapped ↓ / horizontal →), zoom, and a cursor overlay.
- `MusicXmlRenderer.jsx` → `osmdRender.js` engraves via OSMD 2.0 (lazy-loaded), walks OSMD's cursor to emit one **melody event per top-staff onset** (`{midi, onsetQuarter, x, top, bottom}`), reported up via `onLayout`.
- `parseMusicXml.js` is a *second, independent* model used only for header metadata + the single `tempo` number that drives metronome mode.
- MIDI in/out comes from the shared `usePianoMidi()` surface (Web MIDI over BLE via the Jamcorder; output port exists and already carries note echo + PC/SysEx sends).

Two sources of musical truth (OSMD iterator for events, DOM parser for tempo/meta) is the root of several findings below.

---

## Findings

Severity: 🔴 defect / wrong behavior · 🟡 quality/UX gap · 🔵 polish or hardening.

### A. Metronome timing engine

**A1. 🔴 Wrong tempo for any score with a mid-piece tempo change — "last marking wins."**
`parseMusicXml.js:72-75` overwrites `score.tempo` on every measure that carries a `sound[tempo]` or `metronome/per-minute`. The loop runs over *all* measures, so the **final** tempo marking in the document becomes the tempo for the *entire* piece. The user's screenshot (♩=120 engraved at m.39) shows the library really does contain mid-piece tempo marks, so this is live, not theoretical. Metronome mode then plays the opening at the m.39 tempo.
*Fix:* build a tempo map `[{onsetQuarter, bpm}]` during parse; metronome uses the segment covering the current event. Header meta should show the *initial* tempo.

**A2. 🔴 Cumulative tempo drag from the setTimeout-per-step chain.**
`ScorePlayer.jsx:114-123` schedules each step relative to "now" at effect re-run time. Every step pays: timer lateness + React commit + effect teardown/setup. Nothing is anchored to an absolute clock, so lateness **accumulates** — the piece always runs slower than nominal, worst on the SM-T590 while it's also compositing a large SVG. At 120 bpm even 20–40 ms/step of overhead is a 4–8% tempo sag.
*Fix:* one transport loop anchored to `performance.now()`: `dueAt = startTime + (event.onsetQuarter − startQuarter) × msPerQuarter(tempoMap)`; each timeout computes `dueAt − now`, so error never compounds. This transport becomes shared infrastructure for the proposed Playback/Hybrid modes (§ Proposed modes).

**A3. 🟡 "Metronome" makes no sound and has no count-in.**
The mode is a silent auto-advancing cursor. There's no click, and pressing ▶ starts the first gap immediately — the player has no way to sync their hands to beat 1. Options: WebAudio click (beware FKB WebView autoplay gating — same class of issue as the fitness kiosk, see `reference_fitness_audio_cue_playback`), or send a rimshot/click note to the MIDI output so the piano itself clicks. Add a 1-measure count-in.

**A4. 🟡 Advancement is melody-onset-based, not beat-based.**
Events are top-staff melody onsets only (`osmdRender.js:26-41`). A held whole note = one 4-beat silent gap; left-hand rhythm never drives the cursor. Combined with A3, the mode gives no pulse during long melody notes — precisely where a learner needs the metronome. The `Math.max(0.25, gap)` clamp (`ScorePlayer.jsx:118`) also stretches any genuinely short gap (fast runs, grace-adjacent onsets) to a sixteenth.

**A5. 🔵 Pause/resume replays the full current gap; re-engrave restarts the timer.**
Toggling ▶❚❚ or any layout change (`events` identity in the dep array, `ScorePlayer.jsx:123`) restarts the current step's full duration. With an absolute-clock transport (A2) this falls out for free (store elapsed-in-step at pause).

**A6. 🔵 Empty-events edge:** with `events.length === 0` the ▶ button still toggles `running` to true and renders the pause glyph while nothing happens (the effect early-returns). Disable transport when there are no events.

### B. MIDI integration

**B1. 🟡 Metronome mode is MIDI-deaf.**
Only Follow subscribes to note input (`ScorePlayer.jsx:102-111`). In metronome mode the user's playing produces zero on-screen feedback: no wrong-note flash, no target highlight, and the keyboard strip (horizontal flow only) shows `activeNotes` but `targetNotes` is passed only in follow mode (`ScorePlayer.jsx:226`). Cheap win: pass `current.midi` as target in metronome mode too, and optionally tally hit/miss for an end-of-piece accuracy readout.

**B2. 🔴 Follow mode flashes "wrong" for correct left-hand playing.**
The wrong-note test is `|played − expectedMelody| ≤ 24` (`ScorePlayer.jsx:109`) against the single highest top-staff pitch. On a grand-staff piece, nearly every bass/accompaniment note lands within two octaves of the melody → constant red flashes while the user plays the piece *correctly*. Chords are also penalized: playing the chord bottom-up flashes wrong until the top note lands. Fix: build the expected set from **all** notes at the current onset (both staves, full chord) — advance when the melody (or full chord) arrives, never flag other concurrent score tones as wrong.

**B3. 🟡 Sostenuto page-turn has no edge detection.**
`ScorePlayer.jsx:130` fires a page scroll on *any* CC66 message with value ≥ 64. A pedal that transmits continuous values (or repeated messages while held) turns multiple pages per press. Track the previous value and fire only on the rising edge (`prev < 64 && v ≥ 64`).

**B4. 🔵 Keyboard strip only exists in horizontal flow** (`ScorePlayer.jsx:222-231`). In wrapped flow there is no visualization of what's being played or expected. Intentional space trade-off perhaps, but it makes MIDI feedback inconsistent across a toggle whose stated purpose is layout, not features.

### C. Scroll smoothness / auto pan-follow

**C1. 🟡 Per-step smooth `scrollIntoView` self-cancels at speed.**
`ScorePlayer.jsx:91-99` calls `scrollIntoView({behavior:'smooth', inline:'center'})` on every step. Browsers cancel the in-flight smooth animation when a new one starts, so above ~2 steps/sec the pan stutters and never settles — the common case in horizontal flow at moderate tempo. It also scrolls *all* scrollable ancestors, not just `scrollRef`.
*Fix:* drive `scrollRef.current.scrollLeft/scrollTop` directly with a single rAF tween toward the current target (retarget mid-flight instead of restarting). Better still for horizontal + metronome/playback: **continuous** pan — interpolate scroll position between `events[i].x` and `events[i+1].x` by transport time, so the score glides at tempo instead of hopping note-to-note. That's the piano-roll-style follow the mode is reaching for.

**C2. 🔵 Cursor transition sweeps diagonally across the page on system breaks.**
`.piano-score-cursor` transitions `left`/`top` over 140 ms (`PianoApp.scss:2041`). In wrapped flow, moving from the end of one system to the start of the next animates a long diagonal slide through the middle of the page. Suppress the transition (or teleport) when `top` changes; also prefer `transform: translate()` over `left/top` to keep the cursor off the layout path.

### D. Cursor positioning over time

**D1. 🟡 Stale cursor floats over a blanked page during re-engrave.**
`osmdRender.js:95` clears `host.innerHTML` at the start of every render, but ScorePlayer's `layout` state (and thus the cursor's coordinates) updates only when `onLayout` fires at the end. During the async engrave (seconds for long scores on the tablet — zoom click, flow toggle, resize) the cursor overlay sits at obsolete coordinates over an empty sheet. Double-buffer (keep the old SVG until the new one is ready) or hide the overlay + show an "Engraving…" shimmer while a render is in flight.

**D2. 🔵 Cursor geometry ignores zoom.** Fixed `width: 18px`, `left: current.x − 9`, `min-height 40px` (`ScorePlayer.jsx:216`, `PianoApp.scss:2036-2041`). At 200% the cursor is skinnier than a notehead; at 70% it swallows two notes. Scale the overlay box with `scale`.

**D3. 🔵 `extractEvents` forces a layout reflow per note.**
Reading `offsetLeft/offsetTop` after each `cursor.next()` style mutation (`osmdRender.js:55-67`) is O(n) synchronous reflows — a large chunk of the initial-render cost on the SM-T590. OSMD positions the cursor element via inline style; reading `el.style.left/top` (plus its width attr) avoids the reflow entirely.

**D4. 🟡 Two musical models can disagree.**
Events come from OSMD's iterator (which follows repeat structure), while tempo/meta come from `parseMusicXml` (which ignores repeats and assumes linear measure accumulation). Once A1's tempo map lands, it must be keyed to the *same* timeline as the events — safest is to extract tempo entries during the same OSMD cursor walk (the iterator exposes the sheet's tempo expressions), retiring `parseMusicXml` from the playback path and keeping it for header metadata only.

### E. Engraving overlap (user screenshot)

**E1. 🟡 The ♩=120 metronome mark collides with the arpeggiated chord and measure number 39.**
The screenshot shows OSMD 2.0's default metronome-mark placement stacking the mark, an arpeggio squiggle, a dotted chord, and the measure number into one pile. OSMD does not collision-avoid metronome marks well. Verified available knobs:
- `drawMetronomeMarks: false` (option, `OSMDOptions.d.ts:98`) — **recommended default here**, since ScorePlayer already surfaces tempo in its own metadata block and the mark is redundant on a kiosk. *Caveat:* once mid-piece tempo changes drive playback (A1), hiding the marks removes the reader's only cue that the tempo shifted — so either keep marks and shift them, or render a lightweight HTML tempo badge at the event's x-position from the tempo map.
- If keeping them: `EngravingRules.MetronomeMarkXShift` / `MetronomeMarkYShift` (`EngravingRules.d.ts:433-434`) to lift them clear of the staff.
- Measure numbers: `RenderMeasureNumbersOnlyAtSystemStart: true` (`EngravingRules.d.ts:506`) declutters mid-system numbers like the colliding "39" (they add little in horizontal flow), or nudge with `MeasureNumberLabelOffset/XOffset`.

`osmdRender.js:97-107` currently sets none of these — it's on OSMD defaults for everything except titles/part names.

### F. Wrap ↔ flow toggle & render lifecycle

**F1. 🟡 Every zoom click and flow toggle re-parses the XML and re-instantiates OSMD.**
The render effect (`MusicXmlRenderer.jsx:54-74`) depends on `scale` and `flow`, and `osmdRender` does `new OpenSheetMusicDisplay(...)` + `await osmd.load(xml)` every time. `osmd.load` is the expensive step (full MusicXML → VexFlow model). For zoom, OSMD supports `osmd.Zoom = s; osmd.render()` on a cached instance — an order-of-magnitude cheaper on the tablet. Flow genuinely needs re-instantiation (`renderSingleHorizontalStaffline` is a constructor option), but zoom doesn't. Hold the OSMD instance in a ref keyed by `(musicXml, flow)`.

**F2. 🔵 The abort protocol is sound but leaves a blank host.**
`renderSeq`/`shouldAbort` correctly prevents a stale render from clobbering a newer one (checked after each await). But because each call blanks the host *first*, an aborted render contributes a blank frame window. Same remedy as D1 (double-buffer). Also worth a `shouldAbort` check between `osmd.Zoom` and `osmd.render()` — render is the long synchronous step.

**F3. 🔵 Step survives the toggle (good), but the auto-scroll fires once with old-flow coordinates** before `onLayout` delivers the new geometry (deps `[step, flow, mode, current]`, `ScorePlayer.jsx:99`) — a transient scroll to a meaningless offset, self-corrected when layout arrives. Gate auto-scroll on "layout generation matches current flow."

### G. Structural / hygiene

**G1. 🔴 Rules-of-hooks violation in `ScoreViewerRoute`.**
`SheetMusic.jsx:78-83`: `useMemo` is called *after* a conditional early return (`if (NOTATION_RE.test(contentId)) return <NotationScore/>`). If the splat param ever changes between a notation id and a non-notation id without a remount, hook order changes → "Rendered more hooks than during the previous render" crash. Today navigation goes through the grid (remount), so it's latent — but it's a footgun for any future deep-link/swap. Hoist the memo above the branch.

**G2. 🟡 Test coverage is Follow-only.**
`ScorePlayer.test.jsx` exercises follow-mode advancement. There are zero tests for: metronome scheduling (fake timers), tempo-gap math, pause/resume, sostenuto page-turn edge behavior, flow-toggle step preservation, tap-to-seek `nearestEvent`. The timing engine (A1/A2) is exactly the kind of logic vitest fake timers pin down cheaply.

**G3. 🔵 Lifecycle logging is thin** (CLAUDE.md requires it for new features). Logged today: score-open, manual page-turn, render-fail. Not logged: mode changes, play/pause, flow/zoom changes, completion (reaching the last event), follow-mode wrong-note rate. These are the observability hooks you'd want when the tablet "feels laggy" reports come in.

**G4. 🔵 Duplicate default tempos:** `parseMusicXml` defaults to 100 (`parseMusicXml.js:38`), ScorePlayer falls back to 90 (`ScorePlayer.jsx:50`). Harmless, but one of them is dead/misleading.

---

## Proposed modes: Playback & Hybrid (accompaniment)

Requested addition: a pure **Playback** mode (the kiosk performs the score) and/or a **Hybrid** mode (kiosk plays the accompaniment, user plays the melody in real time), with per-part mute/selection.

### Feasibility — the plumbing already exists

- **Output path:** `useWebMidiBLE` holds an output port and already sends note-on/off, PC, and SysEx through the Jamcorder (`useWebMidiBLE.js:162-166, 244+`). The Jamcorder routes `bleToDin: true`, so notes sent from the kiosk **sound on the MDG-400 itself** — real piano playback, no browser audio, no autoplay-gate problem. The piano-bridge APK synth is a second possible sink for a distinct accompaniment timbre.
- **Data:** `parseMusicXml` already produces *every* note with `staff`, `voice`, `midi`, `onsetQuarter`, `durationQuarters` — exactly the event stream playback needs. The current melody-only extraction is a cursor-overlay concern, not a data limit. (Per D4, prefer deriving the playback stream from the same OSMD walk so repeats/tempo align with the visual cursor.)

### Design sketch

1. **Shared transport (prerequisite = A1 + A2).** One absolute-clock scheduler with a tempo map, emitting `noteOn/noteOff` callbacks with ~100 ms lookahead. Metronome mode becomes "transport + cursor, no output"; Playback = "transport + all parts to output"; Hybrid = "transport + selected parts to output, remaining parts drive the Follow cursor."
2. **Part model & mute UI.** Group events by `staff` (RH / LH is the natural grand-staff split; fall back to `voice` within a staff for melody-vs-inner-parts). Per part: **Play / Mute / You** (You = expected from the user, engraved but not sent). Default Hybrid preset: RH = You, LH = Play. A simple two-chip toggle row in the transport bar covers the common case; avoid a full mixer until a real score demands it.
3. **Hybrid cursor semantics.** Cursor advances on transport time (accompaniment keeps going, like a backing track), while the user's MIDI input is scored against the "You" part at the current onset (reuse B1/B2's expected-set logic) — hits light green on the keyboard strip, misses tally silently. That's more forgiving (and more musical) than follow-mode's stop-and-wait; a "wait for me" variant can gate the transport on the melody note later if wanted.
4. **Local-control consideration.** When the kiosk sends accompaniment to the MDG-400 while the user plays on the same instrument, both coexist fine acoustically; `sendLocalControl` already exists if a future variant needs the user's keystrokes silenced (e.g. "listen first" playback of the melody).
5. **Safety:** transport stop/pause must flush note-offs for every sounding scheduled note (all-notes-off on the used channel) — otherwise a pause mid-chord leaves the piano droning.

### Suggested sequencing

| Order | Work | Unlocks |
|-------|------|---------|
| 1 | Tempo map + absolute-clock transport (A1, A2) | correct metronome; foundation for everything |
| 2 | Full-onset event extraction w/ durations + staff tags (B2, D4) | correct Follow; part model |
| 3 | Playback mode (all parts → MIDI out) | validates scheduler + note-off hygiene, no UI beyond ▶ |
| 4 | Hybrid mode + part chips (Play/Mute/You) | the requested practice mode |
| 5 | Continuous auto-pan (C1) + click/count-in (A3) | performance feel |

---

## Prioritized fix list (existing code)

1. **A1** tempo map — metronome is currently wrong on real scores (screenshot proves the trigger exists).
2. **A2** absolute-clock transport — do together with A1; shared foundation for new modes.
3. **B2** follow-mode expected-set — constant false "wrong" flashes make Follow unusable on grand-staff pieces.
4. **E1** `drawMetronomeMarks: false` + `RenderMeasureNumbersOnlyAtSystemStart: true` — two-line fix for the screenshot overlap.
5. **G1** hooks violation — one-line hoist.
6. **C1** rAF-tweened scrolling — biggest perceived-quality win on the tablet.
7. **F1** cache OSMD instance for zoom — biggest raw-latency win on the tablet.
8. **D1/F2** double-buffered re-engrave; **B3** pedal edge-detect; **A3** click/count-in; **B1** metronome-mode target highlight.
9. **G2/G3** tests for the timing engine + lifecycle logging.

---

## Implementation status (2026-07-03)

Executed on `main` via the plan doc. All unit tests green (SheetMusic + MusicNotation:
112 passing). Frontend verified end-to-end against the dev server (Playwright, Für Elise
`.musicxml`): OSMD engraves, all four modes render (Follow / Metronome / **Play** / Manual),
metronome transport advances the cursor at tempo, Play-mode `RH: Play`/`LH: Play` chips
render, and the engraving declutter (no metronome marks, measure numbers only at system
starts) is visible in the capture. No console errors beyond the expected headless Web-MIDI
denial.

### Finding → commit

| Finding | Commit | Note |
|---------|--------|------|
| G1 hooks violation | `5b381c9bf` | one-line hoist |
| E1 engraving overlap (screenshot) | `e7f51ed57` | `drawMetronomeMarks:false` + measure-numbers-at-system-start |
| B3 pedal page-turn edge | `5ab35778c` | rising-edge only |
| A1 header tempo (display half) | `dff27abe9` | opening marking wins |
| A1/A2 tempo map + ms conversion | `848b2eac0` | `scoreTimeline.js` |
| A1/B2/D4 OSMD tempo/chord/note extraction | `1b50dd61f` | one repeat-aware walk |
| A2/A5 drift-free transport | `9c74945b7` | `useScoreTransport.js` |
| A1/A2/A5/A6 metronome on transport | `9f03eb81b` | fixes wrong tempo + drag; also excludes `.worktrees/` from vitest |
| B1/B2 follow chord tolerance + targets | `920fb1825` | no more false wrong-note flashes on grand staff |
| C1/C2/D2/F3 scroll tween + cursor polish | `d2ae8af95` | `scrollTween.js` |
| D1/F2 hide overlay during re-engrave | `586d19b2e` | busy shimmer |
| F1 reuse OSMD instance for zoom | `5acab074a` | `osmdReRender` |
| Play/hybrid part model | `f78970da6` | `playParts.js` |
| Play/hybrid mode wiring | `836aae76b` | MIDI out + part chips + panic-on-pause |

### Verified
- Unit: tempo map math incl. mid-piece change; transport pause/seek/finish; follow chord
  tolerance; pedal edge; Play-mode MIDI-out call filtering + panic-on-pause.
- Visual (dev server): engraving, four modes, metronome cursor advance, Play-mode chips,
  E1 declutter.

### Deferred (not done — see plan's "Deferred" section)
- **A3** metronome click / count-in (needs an audio-policy decision — WebAudio vs a MIDI
  click on the piano).
- **A4** beat-based (vs melody-onset) cursor advancement.
- **D3** `extractEvents` reflow-per-note micro-opt (may be moot after F1; measure first).
- **C1 continuous** time-based pan (the retargeting tween already removes the stutter).
- Play-mode accuracy scoring / hit-miss tally (highlight-only for v1).
- **Hardware live-verify:** actual MIDI-out sounding on the physical MDG-400 via the
  Jamcorder is unverified from this machine (headless Chrome has no Web MIDI). Confirm on
  the yellow-room tablet: Play mode → ▶ should sound the accompaniment on the piano
  (requires Jamcorder `bleToDin:true`), and pause must silence instantly.
