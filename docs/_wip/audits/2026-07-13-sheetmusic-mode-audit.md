# Sheet Music Mode Audit — Usability, Journey, Lifecycle, Performance

**Scope:** `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` (~2,600 source lines, 43 files)
**Date:** 2026-07-13 · read-only audit, no code changed

## Verdict

The module is architecturally strong: two-plane transport (audio scheduled ahead on wall-clock timestamps, visuals fire at due time), audio-clock metronome, retargeting scroll tween, OSMD prefetch from the grid, disciplined memoization of the transport bar, and careful unmount teardown (silence + delayed panic, telemetry flushes, fetch cancellation flags). The findings below are mostly *journey* gaps — places where a real user hits a dead end or a broken reward loop — plus a few config/data-path defects.

---

## High

### H0. Load lifecycle: OSMD's cursor visibly sweeps the whole score before anything is playable
Observed on the kiosk (KC, 2026-07-13): after the sheet paints, a green cursor traverses the entire score, unprompted, before the mode becomes interactive.
**Root cause:** `extractLayoutSliced` (`osmdRender.js:351`) must `cursor.show()` — OSMD only updates cursor geometry while the cursor is visible — then drives `cursor.next()` across every onset to read notehead boxes. Since the walk yields every ~8ms (`budgetMs`) so the tablet's main thread breathes, the browser paints between slices, and the user watches OSMD's built-in cursor crawl through the piece. The old synchronous `extractEvents` had the same `show()` but blocked the thread, so no frames painted mid-walk — the sweep is an accidental byproduct of the (correct) time-slicing fix.
The wider lifecycle is a three-act patchwork: `SkeletonStage` (fetch) → "Engraving…" text veil (nothing painted yet) → painted sheet + cursor sweep + 3px progress bar, during which the transport bar renders fully interactive but is inert (timeline empty until `onLayout` publishes).
**Fix:**
1. Hide the walk from the user, not from OSMD: after `cursor.show()`, set `cursor.cursorElement.style.visibility = 'hidden'` (OSMD's `update()` writes position/size, not `visibility`), or more robustly add an `is-extracting` class on the renderer host with a stylesheet rule `img[id^="cursorImg"] { visibility: hidden; }`. Apply in BOTH `extractEvents` and `extractLayoutSliced`; clear in the `finally`.
2. Replace the "Engraving…" text veil with a staff skeleton (5-line stave shimmer bands, à la `SkeletonStage`) so act 2 reads as "sheet music loading" instead of a bare label.
3. Keep the painted sheet + progress bar during extraction (the sheet is already readable — don't skeleton over it), but consider disabling/dimming the transport controls until `onReady` so the bar doesn't look live while inert.

### H1. Polish run played to completion never shows the RunSummary
`ScorePlayer.jsx:273` — `onDone` flushes telemetry and logs, but never opens the summary. The summary opens **only** via `onSilentStop` (4 silent measures, `useScoreEvaluator`). A player who plays the piece **all the way through** — the success case — gets no grades recap, no "Nicely done," nothing; the screen just stops. The reward loop rewards giving up (stop playing → summary) and ignores finishing.
Also: the **final measure is never graded**. `useScoreEvaluator` grades a measure only when `currentMeasure` advances *past* it; at end-of-piece the cursor never leaves the last measure, then `enabled` flips false and the reset effect wipes `hitsRef`. Every completed run shows its last measure as ungraded.
**Fix:** in `onDone` (when `mode === 'polish' && scoringOn`), grade the pending measure (expose a `finalize()` from the evaluator or grade inline from the buffered hits) and `setSummaryOpen(true)` + `logRunSummary`.

### H2. Mid-run transpose in Listen desyncs sound from sheet
`MusicXmlRenderer` is mounted with `holdExtraction={running}` (`ScorePlayer.jsx:753`), so a transpose (or zoom/flow) during playback repaints the sheet in the **new** key but defers pitch re-extraction until pause. `playTimeline` is built from the stale `layout.notes`, so the piano keeps sounding the **old** key while the engraving shows the new one — and `layoutFresh` hides the cursor/highlights for the rest of the run. Nothing tells the user why the cursor vanished.
**Fix options:** pause the transport on transpose/zoom/flow while running (cleanest — one line in `onTranspose`/`onScale`/`onToggleFlow` guarded by `running`), or disable those controls while running.

### H3. Image-score deep link / reload breaks single-image scores and the breadcrumb
`SheetMusic.jsx:82` — `ScoreViewerRoute` reconstructs the score as `{ id: contentId }` only. Title, image, and thumbnail chosen in the grid are lost (they never enter the URL). Consequences in `ScoreViewer`:
- Breadcrumb always reads "Score" instead of the piece's title (`ScoreViewer.jsx:19`).
- A score with **no child pages** falls back to `[score?.image || score?.thumbnail].filter(Boolean)` → `[]` → "This score has no viewable pages" — even when the grid tile just showed its cover (`ScoreViewer.jsx:31`).
**Fix:** have `ScoreViewer` fetch its own item metadata (`api/v1/info/plex/{id}`) for title + image fallback, keeping the URL as the single source of truth.

### H4. `.mxl` is routed to the notation player but can't be parsed
`NOTATION_RE = /\.(musicxml|mxl)$/i` (`SheetMusic.jsx:31`) sends `.mxl` to `NotationScore`, which fetches it **as text** and hands it to `parseMusicXml` — but `.mxl` is a ZIP container and there is no unzip anywhere in the pipeline (verified: no zip/pako handling in `parseMusicXml.js`). Result: `parsed = null`, renderer `failed` → placeholder, a dead end with no explanation.
**Fix:** either unzip client-side (read `META-INF/container.xml` → rootfile), have the media endpoint decompress, or drop `mxl` from the regex until supported.

### H5. Listen's part-role chips are disconnected — the kiosk always plays every staff
`ScorePlayer.jsx:182-187`: the audible timeline is built from `allPlayRoles(parts)` (every staff `'play'`), not from the `roles` state the chips edit. Cycling a staff to **You** or **Mute** changes nothing audible — the kiosk performs your part over you; `roles` only feeds keyboard-highlight targets (`youMidisAt`). The component docstring ("'you' parts are highlighted (never sent)") and the `onCyclePart` comment ("role change invalidates the note timeline mid-flight") describe wiring that does not exist — apparently severed when Listen became "a jukebox" (comment at :178) with the chips left behind. The hybrid practice experience (kiosk plays LH, you play RH) is advertised chrome with no implementation.
**Fix:** rebuild the timeline from user-selected roles (see Part 2, J4/J7 — the "My part" model) and add count-in; or remove the chips. Either way the docstring must stop lying.

---

## Medium

### M1. `sheetmusic.defaultMode` config is dead
`sheetMusicConfig.js` resolves and defaults `defaultMode`, tests cover it — but `ScorePlayer.jsx:86` hardcodes `useState('learn')`. Nothing in the frontend consumes the resolved value (verified via grep). Either wire it (`useState(smCfg.defaultMode)` — note `smCfg` is currently declared after the state; hoist it) or delete the config field.

### M2. Mode switching stomps the keyboard-visibility preference
`onMode` (`ScorePlayer.jsx:604`) sets `setKeyboardVisible(id !== 'perform')` unconditionally. A user who hid the keyboard in Learn gets it forced back on every mode change. Track the user's explicit preference separately and only auto-hide for Perform.

### M3. Loop arming gives no feedback after the first tap
Custom-loop flow: tap **Loop**, tap the in-point, tap the out-point. Between taps 1 and 2 nothing visible changes (`loopInRef` is a ref; `ScorePlayer.jsx:524-537`) — no marker on the tapped measure, no "now tap the end" hint. On a kiosk this reads as "the tap did nothing." Render a pending in-point marker (the measure-grade layer geometry is already available) or at least change the Loop chip label to "…end?".

### M4. Popovers don't dismiss on outside tap and can stack
Tempo, Size, and Info popovers (`ScoreTransportBar.jsx`) each toggle only from their own button. On a touch kiosk with no Esc key, they sit over the score until re-tapped, and two or three can be open at once. Add a shared "open popover" state (opening one closes others) + a tap-outside/backdrop dismiss.

### M5. Learn has no end-of-piece moment
At the last step, `useFollowTracker` clamps `next` to the same index — the cursor just stops responding. After the follow-stats work put into telemetry, the user sees none of it. Even a minimal "piece complete" state (and an offer to restart or switch to Polish) would close the Learn journey.

### M6. Score-load failure is a dead end
`NotationScore` failure renders `PianoEmpty("Could not load this score.")` with no retry — the user must find Back. A transient network blip forces a full re-navigation. Add a tap-to-retry (re-run the fetch effect). Also: the failure logs `piano.score-open-failed` via the plain logger while the telemetry hook has an unused `logLoadFailed` — load failures never land in the per-run session log.

### M7. Multi-page image scores load every page eagerly
`ScoreViewer.jsx:47` renders all page `<img>`s without `loading="lazy"` (the grid uses it; the viewer doesn't). A 20-page scanned score fetches 20 full-resolution images at open on tablet-class hardware. Add `loading="lazy" decoding="async"`.

### M8. Learn/metronome tempo is fixed at the piece's opening tempo
`clickBpm` uses `tempoMap[0]` only (`ScorePlayer.jsx:282`): mid-piece tempo changes are ignored by the click, and the tempo stepper is Listen-only — a learner can't slow the reference click down, which is the single most common practice need. Consider extending the tempo control to Learn (it already only affects the click there, so it's cheap).

---

## Low

- **L1. Key metadata always says "major"** — `meta.key` maps fifths→name and appends "major" unconditionally (`ScorePlayer.jsx:77`); an A-minor piece reads "C major." MusicXML carries `<mode>`; parse it.
- **L2. Position readout is note-steps, not measures** — "37 / 214" means nothing to a musician; "m. 12 / 32" would (measure index is already derivable from `layout.steps[step].measure`).
- **L3. `barParts` memo dep contradicts its comment** — deps are `[parts, staffSig]` (`ScorePlayer.jsx:165`); including `parts` (fresh identity per re-engrave) makes the `staffSig` keying moot. Harmless (re-engraves are rare) but the comment promises the opposite; intended deps were `[staffSig]`.
- **L4. Focus jump can miss when measures aren't ready** — the effect at `ScorePlayer.jsx:562` depends on `[focus]` only; if `layout.measures` arrives after focus was set (mid re-engrave), the cursor never jumps to the in-point (the loop still works via the `range` memo).
- **L5. Unmount teardown depends on `silenceScheduled` identity** — `useEffect(() => () => silenceScheduled(), [silenceScheduled])` (`ScorePlayer.jsx:558`): if the MIDI context ever re-minted `releaseNote`/`sendPanic` mid-playback, the cleanup would silence+panic mid-run. Fine today if the context callbacks are stable; a ref-trampoline (like the flush refs above it) would make it stable by construction.
- **L6. RunSummary tally logic duplicated** in `onSilentStop` (`ScorePlayer.jsx:328-335`) and `RunSummary.jsx:21-28` — extract a `tallyGrades(grades)` helper so the log and the panel can't drift.
- **L7. `targetNotes`/`litNotes` mint fresh Sets every render** (`ScorePlayer.jsx:725-740`) — churns `NoteHighlightLayer`'s layout effect per render. Cheap in practice; memoize only if profiling ever points here.

## What's working well (keep)

- Two-plane transport with lookahead scheduling + coarse `setInterval` driver (rAF-throttle-proof on the kiosk); pause/seek rewind semantics; documented double-flush panic strategy for unrecallable scheduled sends.
- Follow tracker / evaluator / play-along all use the subscribe-once + refs pattern — no per-note resubscribe, no stale closures.
- Transport bar memoization (shell + three memoized clusters) with a test hook proving the bail-out; deliberate avoidance of default-prop reference churn.
- `usePianoList` two-tier SWR cache; `prefetchOsmd` while browsing; `layoutFresh` guard against stale-geometry overlays.
- Telemetry is comprehensive and rate-limited (`logger.sampled`), with unmount flush guards against double-emit.
- Pure, well-tested extraction of domain math (`focusRange`, `pedalEdge`, `scoreEvaluator`, `scoreTelemetry`, `clickScheduler`).

## Suggested order of attack

1. H0 (cursor sweep on load) — every single score open shows it; the visibility-hide is a two-line fix.
2. H1 (broken Polish reward loop) — highest practice-journey payoff, small change.
3. H3 (image-score deep link) + M6 (retry) — dead ends in the browse→view journey.
4. H2 (mid-run transpose/zoom desync) — pause-on-change is a one-liner per handler.
5. M2/M3/M4 (kiosk touch ergonomics) as one small UX pass.
6. H4 + M1 — decide `.mxl` and `defaultMode`: support or delete.

---

# Part 2 — Journey Audit: the Mode Ladder (added after KC's kiosk review, 2026-07-13)

KC's read from actually using it: the modes are features stacked in a bar, not a
journey. The critique holds up against the code — several of the missing joints
are even marked "later task" in comments. This part re-audits Listen/Learn/Polish
as a *practice ladder* and proposes the redesign.

## The intended pedagogy (implied by the tab order, honored nowhere else)

> **Listen** (hear it) → **Learn** (get the notes, self-paced) → **Polish** (get
> it to tempo, graded) → **Perform** (play it, no assists).

What breaks the ladder today:

### J1. Timing practice is incoherent across the ladder ("play in time" doesn't exist)
- The metronome click exists only in **Learn and Listen** (`ScoreTransportBar.jsx:160`).
- In **Learn** it free-runs from toggle-on at the opening tempo — unanchored to the
  cursor or the player. Learn's cursor waits for you regardless, so there is
  nothing to be "on time" *with*. It's decorative.
- **Polish** — the only mode that *grades timing* (`driftForNote` →
  `timingScore`) — has **no click at all**, **no tempo control** (gated to
  Listen by `hasListenExtras`; `ScorePlayer.jsx:181` comment calls Polish tempo
  a "later task"), and **no count-in** (play → cursor moves instantly at step 0).
- Net: **Polish grades your timing against a beat it never lets you hear, at a
  tempo you can't slow down, with no lead-in.**

**Fix (the core of the redesign):**
- Move the click to where the beat *matters*: **Polish** (on by default during a
  run) and **Listen** (optional). Drop it from Learn entirely — self-paced mode
  has no beat.
- Give Polish the **tempo stepper** (the timeline is already tempo-scaled for it;
  the UI gate is one flag). Practice range 50–100% matters more here than in Listen.
- Add a **count-in** (one measure of click, using the piece's meter) before any
  transport start where the user is expected to play: Polish always, Listen when
  play-along or a 'you' role is set. Implementation: prepend count-in beats to the
  transport timeline or delay `play()` by `beats × 60/bpm` with the click scheduler
  running — the clickScheduler already supports exact-time scheduling.

### J2. Entry point ignores the ladder
Every score opens in **Learn** (hardcoded `useState('learn')`; the resolved
`sheetmusic.defaultMode` config is never consumed — see M1). First-visit journey
should be: open score → **Listen**, one big obvious ▶. Wire `defaultMode` with
the shipped default changed to `'listen'`.

### J3. Learn↔Polish drops the practice range — the one handoff that defines the ladder
`onMode` (`ScorePlayer.jsx:601`) clears `focus` on every mode change to keep it
out of Listen/Perform — but that also wipes it across **Learn↔Polish**, the exact
pair the range feature was built for ("drill m9–16 slowly, now test them at
tempo"). Keep `focus` when switching within {learn, polish}; clear only when
leaving that pair.

### J4. One widget, two semantics: the part chips
In Learn/Polish a chip is a checkbox ("✓ RH" = you must play it); in Listen the
same chip cycles `RH: Play → You → Mute` (who performs it). Same position, same
look, different mental model, no explanation — on a communal kiosk this is
guess-and-poke.
**Fix — one mental model everywhere:** the chip always answers **"who plays this
staff?"** with the same states: **You / Kiosk / Off**.
- Learn/Polish: You ↔ Off (Kiosk unavailable — these are your-hands modes).
  "Active parts" == staves set to You.
- Listen: You / Kiosk / Off (maps to today's you/play/mute).
For the 95% case (grand staff), render it as a single segmented control —
**Hands: Both · RH · LH** — instead of two chips; fall back to per-staff chips
only for >2 staves.

### J5. Learn's chrome is a feature dump, not a task flow
Learn shows in one bar row: part chips, N section chips, Loop, Clear, range
readout, click, ⌨, flow, Size, ⓘ — ~10 controls competing at equal weight, while
the two-tap loop flow is invisible (M3) and the click is meaningless (J1). Learn's
actual tasks are exactly three: **choose hands, choose what to practice, play**.
**Fix:**
- Collapse section chips + Loop + Clear + readout into ONE **"Practice: Whole
  piece ▾"** control opening a popover: section list (rehearsal marks), "Tap two
  measures…" (the custom loop, with on-screen guidance + pending-measure marker
  and a live "now tap the last measure" hint), and "Whole piece" (clear).
- Hands segmented control (J4).
- Remove the click from Learn (J1). Keep ⌨ / flow / Size / ⓘ, which are
  score-viewing controls, not Learn controls — visually separate the "view"
  cluster from the "practice" cluster.

### J6. No feedback loop closes the ladder
Polish's RunSummary (when it appears at all — H1) is a dead end: counts + Replay +
Close. The natural next action after red measures is *go drill them* — which is a
`focus` range + a mode switch, both already built.
**Fix:** RunSummary gains **"Drill worst section"** — set `focus` to the largest
contiguous red/yellow span, switch to Learn (carrying the range per J3). This one
button turns four disconnected screens into a loop: Listen → Learn → Polish →
(summary) → Learn → Polish → … → Perform.

### J7. Listen's play-along is half an experience
Play-along lights correct notes green but gives no wrong/missed feedback and no
end-of-piece recap, and 'you'-role selection is buried in cycling chips (J4).
With J4's Hands control + J1's count-in, Listen play-along becomes the genuine
"training wheels" rung: kiosk plays your part quietly (or the other hand), you
play along, correct notes light. Defer grading here — that's Polish's job; just
make role selection legible and the start count-in real.

## Proposed journey (target state, per mode)

| Mode | User story | Chrome (beyond mode tabs + view cluster) |
|------|-----------|------------------------------------------|
| Listen | "Play it for me. Maybe I noodle along." | ▶/⏸ · Hands: who plays what · Tempo · Key · Click (opt) · Play-along (opt, count-in) |
| Learn | "Teach me the notes, at my pace." | Hands: Both/RH/LH · Practice: Whole piece ▾ · (cursor waits; wrong flashes; reveal-on-miss) |
| Polish | "Test me at tempo." | ▶ (count-in) · Tempo 50–100% · Hands · Practice range (carried from Learn) · Click ON · Scoring → Summary → "Drill worst section" |
| Perform | "Get out of my way." | Page indicator · pedal turns (as-is; fix M2) |

## Phasing (journey work, complements Part 1's ordering)

1. **P1 — make timing real:** click+tempo+count-in in Polish; drop click from
   Learn (J1). Small code, biggest honesty win.
2. **P2 — make the ladder connect:** defaultMode=listen (J2), focus survives
   Learn↔Polish (J3), RunSummary "Drill worst section" (J6, needs H1 fixed).
3. **P3 — make the chrome legible:** Hands segmented control (J4), Practice
   popover with guided loop-tap flow (J5, absorbs M3/M4), separate
   practice-cluster from view-cluster.
4. **P4 — round out Listen:** count-in on play-along, role legibility via Hands
   (J7).
