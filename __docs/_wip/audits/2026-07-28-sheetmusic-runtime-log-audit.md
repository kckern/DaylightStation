# Sheet Music — Runtime Log Audit (what the kiosk logs say actually happens)

**Scope:** `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` + `PianoKiosk/score/useScoreTransport.js`
**Evidence:** `media/logs/piano-sheetmusic/*.jsonl` — 35 session files, 2026-07-26 → 2026-07-28, single device (SM-T590 piano tablet, FKB WebView, Chrome 150)
**Date:** 2026-07-28 · read-only audit, no code changed
**Revised:** 2026-07-28 after adversarial review — L3 and fix-order item 9 were wrong and are rewritten; several counts corrected; see **Caveats** before trusting any zero-count claim.
**Relationship to prior work:** the 2026-07-13 audit (`2026-07-13-sheetmusic-mode-audit.md`) reviewed the *code*. This one reviews the *logs* from three days of real use after those fixes shipped. Several items below are fixes from that audit that landed correctly but do not survive contact with the device.

---

## Verdict

**In three days of use, the graded practice ladder has never completed a single repetition.**

The mode ships four modes — Listen, Learn, Polish, Perform. Listen carries almost all the use; the other three are a mix of *defective*, *unused* and *invisible to the telemetry*, and the audit's job below is to keep those three apart. Across the entire corpus:

- **Polish has graded zero measures — including during a run where the grader was live.** No `score.polish.measure`, no `score.polish.summary`, no `score.polish.silent-stop`, ever. Polish is not hard to reach (three direct entries), and on 07-26 it got a real run: `countin.go {step: 19, mode: "polish"}` at 02:22:51 over a freshly-set m2 loop, then `playback.stats {mode: "polish", events: 17}` at 02:22:56. That is ~5.5s with the evaluator enabled (`enabled: mode === 'polish' && transport.playing`, `ScorePlayer.jsx:467`) and 17 note events, producing no grade at all. **This points at a defect in `useScoreEvaluator`/`gradeMeasure`, not at a discoverability problem.**
- **Learn has never been completed.** Zero `score.learn.complete`. Three `score.follow.stats` records exist: `{hits: 0, wrongs: 8}`, `{hits: 2, wrongs: 4}`, and `{hits: 48, wrongs: 236, meanAbsDriftMs: 4938, dragPct: 88}` — the last being a substantial engagement that produced five wrong notes for every right one. In that same session the user hammered a *correct* note six times over 8 seconds without the cursor moving (step 8), then spent **47 seconds** on the next step (step 9).
- **Perform is used, and is almost entirely unlogged.** Five entries, one lasting **15m50s** — which is what Perform succeeding looks like, since reading the sheet and playing acoustically emits nothing. Its page-turn pedals have never fired (zero `score.perform.pageturn`), and its tap-to-scroll is not instrumented at all, so we cannot tell working from ignored. See **L3**.
- **Listen works**, and it is what almost all recorded activity is. 64 `score.transport.play`, essentially all `mode: "listen"`.

Meanwhile the observability that was supposed to tell us this is inverted: **99.42% of all log volume is a single warning that is a threshold bug** (65,595 of 67,428 lines). Real signal is 391 lines. The stall warning fires on ~every transport tick, splits sessions across files, and buries the handful of events that matter.

The honest summary is: a MIDI jukebox that works, a Learn mode that is hostile enough to abandon, a Polish grader that appears to be broken rather than merely unused, a Perform mode we have no instrumentation to judge — and telemetry that has been drowning out all four distinctions since it was installed.

---

## Corpus

| | |
|---|---|
| Session files | 35 (28 substantive + 7 416-byte orphans — see **L1**) |
| Total lines | 67,428 |
| `info` lines | **391 (0.58%)** |
| `warn` lines | **67,037 (99.42%)** |
| Score opens (`session-log.start` pairs) | 27 |
| Opens reaching `score.load` | 24 |
| Distinct scores engraved | 5 (a 6th was opened and never reached `score.load`) |
| Device | one (SM-T590 piano tablet) |

**Corpus caveat:** one device, one household, three days. Everything below is evidence about *this deployment's three days*, not about the feature in general. A zero count means "not observed here", which is a strong signal for a control that should fire many times per session and a weak one for a control that fires once.

Event census — what fired, and what never did:

| Event | Count | |
|---|---:|---|
| `score.playback.stall` | 65,595 | see H1 — 95% false |
| `score.playback.sched-late` | 1,442 | real, but unusable at this volume |
| `score.playback.stats` | 106 | 23 of these are empty (`events: 0`) |
| `score.transport.play` | 64 | |
| `session-log.start` | 54 | 2 per open — see L3 |
| `score.follow.timing` | 31 | all from 3 Learn attempts; values corrupt — see H3 |
| `score.follow.timing.aggregated` | 1 | the sampler's roll-up; 19 further hits are only visible here |
| `score.transport.done` | 27 | |
| `score.load` | 24 | |
| `score.mode` | 21 | |
| `score.transport.pause` | 10 | |
| `score.focus.select-start` | 10 | only 4 reached a `focus.set` — see H4 |
| `score.countin.start` | 7 | 2 immediately cancelled |
| `score.focus.arm` | 6 | 2 never reached a `set` |
| `score.focus.set` | 6 | only 4 from the two-tap flow; the other 2 are ±1 nudges — see H4 |
| `score.countin.go` | 5 | |
| `score.viewchange.pause` | 5 | |
| `score.listen.mypart` | 4 | all reverted within seconds — see H5 |
| `score.follow.stats` | 3 | |
| `score.countin.cancel` | 2 | |
| `score.focus.clear` | 2 | |
| `score.transport.loop-wrap` | 2 | |
| `score.transpose` | 1 | |
| **`score.polish.measure`** | **0** | |
| **`score.polish.summary`** | **0** | |
| **`score.polish.silent-stop`** | **0** | |
| **`score.learn.complete`** | **0** | |
| **`score.drill.worst`** | **0** | |
| **`score.hands`** | **0** | nobody has ever narrowed to one hand |
| **`score.active-part`** | **0** | |
| **`score.listen.part`** | **0** | |
| **`score.perform.pageturn`** | **0** | |
| **`score.load.failed`** | **0** | `logLoadFailed` is exported and never called (dead) |

Restart, tap-to-seek, zoom, flow toggle, keyboard toggle and metronome toggle emit nothing at all — see **T1**.

---

## High

### H1. The stall warning is a unit mismatch and has destroyed the logs

`recordFire` flags a stall when `driftMs >= STALL_MS(120) || gapMs >= FRAME_GAP_MS(50)` (`useScoreTelemetry.js:5-6,41-44`).

`gapMs` is not a frame gap. It is the interval between **transport ticks**, and the transport is a `setInterval` at `tickMs = 100` by design (`useScoreTransport.js:34,54`). The threshold compares a 100ms-by-design value against a 50ms budget, so it can essentially never *not* fire.

Measured over all 65,595 stall warnings:

| trigger | count | share |
|---|---:|---:|
| `gapMs` alone (drift was fine) | 62,386 | **95.1%** |
| both | 3,209 | 4.9% |
| **`driftMs` alone** | **0** | **0%** |

`gapMs` p50 = **100ms** — exactly `tickMs`. `driftMs` p50 = 40ms, p95 = 119ms, i.e. *below the drift threshold at the 95th percentile*.

Consequences, all visible in the data:

1. **The `stalls` field in `score.playback.stats` is meaningless.** A healthy run reports `{meanDriftMs: 7, p95DriftMs: 17, maxDriftMs: 73, stalls: 492, events: 495}`. Anyone reading that dashboard concludes playback is broken when it is fine.
2. **Sessions are shredded by log rotation.** `2026-07-28T16-04-17.jsonl` is 4,288 lines with **zero** info events — a session file that exists solely because of warn spam. `16-09-59.jsonl` is 11,913 lines carrying 18 real events. A single practice run's events land in two or three different files.
3. **The one genuinely bad run is invisible.** At 18:29:13 a run reported `meanDriftMs: 268, p95DriftMs: 982, maxFrameGapMs: 1170, minLeadMs: -617, schedLate: 38` — audibly broken playback, and the user paused after 3 seconds and walked away for 82. It is one line among 65,595 identically-shaped lines.
4. It is plausible (unconfirmed) that 65k structured log objects + WebSocket transport per session is itself contributing to the renderer deaths in **H6**.

**Fix:**
- Drop the `gapMs` term from the stall predicate, or scale it to the driver: `gapMs >= tickMs * 2.5`.
- Make drift relative to the beat, not absolute: a 120ms drift at 60 BPM is nothing; at 216 BPM it is half a beat.
- Demote `score.playback.stall` to `debug`, or emit it via `logger.sampled(...)` the way `score.follow.timing` already is. Per-event `warn` is never the right shape for a per-note event stream.
- Keep `score.playback.sched-late` at `warn` (it is real — worst `leadMs` observed is **-976ms**) but sample it too; 1,442 lines for the same underlying condition is not useful.

---

### H2. When a piece finishes, Play replays the last measure. Users hit it a dozen times in a row.

`onDone` never resets the cursor (`ScorePlayer.jsx:358-363`). The transport internally rewinds (`posRef=0, fireIdx=0`, `useScoreTransport.js:87`) but the React `step` state stays parked on the final step, so the two disagree. `toggleRun` then seeks to `stepTimeline[stepRef.current]` (`ScorePlayer.jsx:992-995`) — the end — and the "run" is over before the user's finger leaves the glass.

From one session, verbatim:

```
02:20:32 play {step:76} → 02:20:34 done   (1.6s of music)
02:20:35 play {step:76} → 02:20:37 done
02:20:41 play {step:76} → 02:20:43 done
02:21:33 play {step:76} → 02:21:34 done
02:21:35 play {step:76} → 02:21:37 done
02:21:40 play {step:76} → 02:21:42 done
…six more at 02:25:04 / :10 / :15 / :19 / :23 / :28
…two more at 02:26:15 / :17
```

**Fourteen Play presses in that one session, in four clusters (3 + 3 + 6 + 2), each producing ~1.6 seconds of the last measure.** The clusters are separated by deliberate seeks to elsewhere in the piece (steps 39, 3, 19, 0) — so this is not one confused burst but a pattern the user re-entered four separate times. Restart was enabled throughout (`canRestart` is true once `step > 0`) and was never used — the user's model is "Play means play," and there is no visual cue that the cursor is sitting at the end.

**Fix:** in `onDone`, for the no-loop case, `setStep(homeStep(rangeRef.current))` and scroll home — the run is over, return to the start. Alternatively make `toggleRun` treat "cursor at final step and not playing" as a restart. The first is simpler and matches what `reset()` already does.

---

### H3. Learn deadlocks on multi-note steps with no indication of what's missing

`useFollowTracker` advances only when **every** active-staff note of the step has been struck (`useFollowTracker.js:63`, `isStepSatisfied`). When the user plays one of the two required notes, that note is added to `struckRef` and lights up — and then nothing further happens, forever, until the other note arrives.

An excerpt of the `score.follow.timing` stream from one Learn attempt (`actualMs` = ms since the last cursor advance; two records between steps 8 and 9, where the user jumped back to step 0, are elided):

```
step 8  note 81  actualMs   1019
step 8  note 81  actualMs   3022      ← same note again
step 8  note 81  actualMs   6233      ← again
step 8  note 81  actualMs   6818      ← again
step 8  note 81  actualMs   7659      ← again
step 8  note 81  actualMs   8254      ← again — 8 seconds on one step
step 9  note 76  actualMs  47133      ← forty-seven seconds on one step
step 10 note 77  actualMs    764
step 10 note 77  actualMs   7632
step 10 note 65  actualMs  10501
step 11 note 64  actualMs   5730 / 8478 / 8762
step 11 note 76  actualMs  13891
step 12 note 81  actualMs   1207      ← last timing record; the flush comes 37 min later
```

The user hammered a *correct* note six times in eight seconds and the cursor did not move. There is no "1 of 2 notes" indicator, no ghosting of the outstanding note, no timeout, no "stuck? show me" affordance. The struck note lights green, which reads as success.

The designed escape hatch is narrowing to one hand — and **`score.hands` and `score.active-part` have fired zero times in three days.** Nobody has found it. It lives in the right-hand cluster of the transport bar (`HandsControl`), spatially distant from the score and the run controls, and nothing in Learn suggests it exists.

The other two Learn sessions are the same story compressed: `{hits: 0, wrongs: 8}` (22 seconds, then back to Listen) and `{hits: 2, wrongs: 4}` (2 seconds). The session excerpted above is the substantial one, and its own summary is the strongest single data point in this audit:

```
16:48:16  score.follow.stats {hits: 48, wrongs: 236, meanAbsDriftMs: 4938, rushPct: 10, dragPct: 88}
```

**Five wrong notes for every right one, sustained across 48 hits.** (29 of those hits appear as individual `follow.timing` records; the other 19 survive only in the single `follow.timing.aggregated` roll-up.) This is not a user who bounced off Learn in two seconds — it is a user who committed to it and was beaten by it.

**Fix, in order of value:**
1. **Show what's outstanding.** `NoteHighlightLayer` already knows the expected set and the struck set. Render the un-struck expected noteheads distinctly (pulse/outline) so "you still owe me the left hand" is legible at a glance.
2. **Auto-offer the hands split.** After ~5s stuck on one step, surface an inline "Right hand only / Left hand only" prompt on the score. Do not make discovery of a bar control the gate on Learn being usable.
3. **Enter Learn at a sane place.** `onMode` doesn't reset the cursor (`ScorePlayer.jsx:856-875`), so Listen→Learn drops the user mid-piece — the 01:49 session entered at **step 32**. Learn should start at the loop in-point or measure 1.
4. Consider relaxing the gate: advance on the melody/top staff and mark the rest as "missed" rather than blocking.

---

### H4. Loop selection stays armed indefinitely and silently swallows taps

Ten `score.focus.select-start`, six `score.focus.arm`, six `score.focus.set` — but only **four** of those sets came from a completed `select-start → arm → set` flow. **Four attempts never registered a first tap at all**, two more armed and never reached a set (02:23:25, and a dangling arm at 02:36:21 at session end), and the remaining two sets (17:42:07 `{53,56}` → 17:42:19 `{52,56}`, one edge moving by exactly 1, with no preceding `select-start`) are the ±1 nudge control, not the selection flow. The retries cluster:

```
02:23:13 select-start                                  ← abandoned
02:23:23 select-start → 02:23:25 arm(m2)               ← abandoned mid-flow
02:23:31 select-start → 02:23:32 arm(m2) → 02:23:41 set {2,2}
```

Two distinct defects:

**(a) Silent rejection.** A selection tap farther than `SELECT_MAX_DIST` from any note returns with no feedback whatsoever (`ScorePlayer.jsx:767-768`). On a kiosk this is indistinguishable from a dead screen, so the user backs out and reopens the menu. That explains the four zero-tap attempts.

**(b) `selecting` never expires.** It is cleared only by mode change, cancel, clearing the loop, picking a section, or a new document (`:776,825,834,837,869,1072`). Not by Play, not by Restart, not by time. This produced a real misfire:

```
02:34:57 select-start
02:34:58 arm {inMeasure: 10}
02:35:02 (Restart pressed)   02:35:04 play {step:0}    ← 30 seconds of playback, still armed
02:35:30 focus.set {kind: "custom", inMeasure: 1, outMeasure: 10}
```

That second tap came **32 seconds later, mid-playback**. The user was tapping the score to seek — the normal gesture — and got a 10-measure loop instead. `onScoreClick` checks `selecting` before the seek branch, so tap-to-seek is silently disabled for as long as the state persists.

**Fix:** flash/shake the banner on an out-of-range selection tap instead of returning silently; cancel `selecting` on Play, Restart and after ~15s idle; and show the armed state somewhere persistent (the Loop trigger label, not only the on-score banner, which scrolls).

---

### H5. Listen's "My part" pauses the music the moment you choose it, so nobody keeps it

All four `score.listen.mypart` events in the corpus, from one session:

```
16:12:43.770  playback.stats            ← the run was pausing at this instant
16:12:43.774  listen.mypart {"rh"}      ← 4ms later: user picks Right Hand
16:12:49.505  listen.mypart {"none"}    ← 6 seconds later: user gives up
16:13:06.663  listen.mypart {"lh"}
16:13:09.168  countin.start
16:13:10.278  countin.cancel {via: "toggle"}
16:13:12.098  countin.start
16:13:13.609  countin.go {step: 540}
16:13:50.779  listen.mypart {"none"}    ← gives up again
```

Choosing a part calls `disruptListenPlayback()`, which pauses the transport and flushes (`ScorePlayer.jsx:1007-1011,1038-1050`). So the interaction is: music is playing, you say "I'll take the right hand," **the music stops**. Pressing Play again now triggers a count-in (because `myStaves.size > 0`, `:985`), which is a second surprise — the user cancelled it, retried, and abandoned the feature within 90 seconds. Both times.

The pause is technically necessary (the note timeline is rebuilt), but the user experience is "this button breaks the song."

**Fix:** rebuild the timeline and **resume from the same position automatically** — pause, re-derive `playTimeline`, re-seek to the current step, resume. The transport already supports seek-while-playing. If a count-in must follow, say so ("Counting you in…") rather than presenting a silent 4-beat gap after a Play press.

---

### H6. Big scores take 15–24s to engrave and the app dies mid-run

Engrave time (`openToReadyMs`, fetch excluded — `fetchMs` is 27–282ms throughout):

| Score | `openToReadyMs` |
|---|---|
| green-hill-zone | 1,833 – 3,713 |
| super-mario-land-world-1 | 2,932 – 3,426 |
| mario-circuit | 3,869 |
| super-mario-theme | 8,444 / 9,179 |
| **creature-trainer-battle** (635 steps) | **14,359 / 15,247 / 15,350 / 15,832 / 16,009 / 16,107 / 16,162 / 17,770 / 19,056 / 19,931 / 19,867 / 24,022** |

On 07-28 the same file trends upward across the day — 15.2s at 16:10, 17.8s at 16:25, 19.9s at 18:27, **24.0s at 18:29** — consistent with WebView decay over uptime (cf. `reference_piano_keepalive_jank_regression`, `project_portal_v8_oom_crashloop`), though this audit cannot prove the mechanism from logs alone.

And the app keeps restarting, repeatedly *during* playback:

```
18:26:50 boot → 18:27:10 load (19.9s) → 18:27:28 play → file ends 18:28:10   (died 42s in)
18:28:36 boot → 18:29:00 load (24.0s) → 18:29:10 play → 18:29:13 pause (drift 268ms, p95 982ms)
19:28:42 boot → 19:29:02 load (19.9s) → 19:29:05 play → file ends 19:29:22   (died 17s in)
19:29:23 boot → 19:29:42 load (19.1s) → 19:30:10 play → file ends 19:31:35
```

Each death costs another ~20 second engrave — four of them in that window, ~83 seconds of pure re-engrave, each one landing between the user and the piece they were trying to hear. (The window also contains playback that went fine, including three clean green-hill runs at 18:33–18:35, so this is a tax on the heavy score specifically, not a dead hour.) On the same heavy score the transport also genuinely falls behind — `maxFrameGapMs` 940/969/1011/1014/1170, `minLeadMs` -388/-462/-617/-976 — meaning notes are handed to the MIDI service with **past timestamps** and dispatch audibly late.

**Fix / next step:** this crosses into the kiosk watchdog's territory and needs a cross-check against `/diagnostics` and CrashLog for the same timestamps before attributing cause. From this module's side:
- Cache the engraved layout per `(scoreId, flow, scale, transpose)` in memory/IndexedDB so a reload isn't a full re-engrave.
- Consider a size gate: scores past N steps get a "large score — this may take a moment" state, or a paged/lazy engrave.
- Fixing **H1** removes ~65k log objects per session from the renderer's allocation path; measure engrave time before and after, since that alone may move this.

---

## Medium

### M1. A persisted loop follows the score across days and nobody knows why the piece won't start at the beginning

`saveScoreSettings` writes mode/tempo/focus/hands on every change (`ScorePlayer.jsx:417-419`); `loadScoreSettings` restores them at mount (`:88-115`). Restoring hands and tempo is defensible. Restoring a **loop range** indefinitely is what the logs show going wrong:

```
07-28 16:08:02  focus.set {inMeasure: 10, outMeasure: 68}      ← set once, deliberately
07-28 16:10:16  play {step: 96}     (new page load)
07-28 16:25:40  play {step: 96}     (new page load)
07-28 18:27:28  play {step: 96}     (new page load)
07-28 18:29:10  play {step: 96}     (new page load)
07-28 19:29:05  play {step: 96}     (new page load)
07-28 19:30:10  play {step: 96}     (new page load)
```

Six sessions later, the piece still opens 10 measures in and loops m11–m69, and `score.transport.loop-wrap` confirms it is actively wrapping. Only two `score.focus.clear` exist in the whole corpus.

Same pattern with tempo: sessions opened with a restored `tempoMult` of 1.25 and 1.5 — the piece simply plays 25–50% fast on open. And `score.mode {"mode":"listen"}` appears as the *first* mode event in three sessions (19:22:16, 19:25:08, 18:31:51) — `onMode` early-returns when the mode is unchanged, so these are people arriving in a restored mode they didn't pick and tabbing back to Listen.

One session shows the full confusion arc: opens with a restored loop, plays from the in-point five times over 90 seconds, finally finds `focus.clear` at 02:34:51, and only then plays to `done` normally.

**Fix:** don't persist `focus` across sessions (or expire it after a day); do persist tempo/hands/mode. If it is kept, announce it on open — a toast or a highlighted Loop chip — and make sure Restart from a restored loop is discoverable.

### M2. The count-in is a buzz on fast pieces

`countInPlan` clicks at the quarter-note pulse × `tempoMult` (`countIn.js:16-18`). Observed: `{bpm: 216, tempoMult: 1.25}` → **270 BPM**, 222ms per beat, four beats in 0.89 seconds. That is not a count-in; it is a chirp. The session in which it fired started and restarted three count-ins in 25 seconds. Another user cancelled one within 1.1 seconds of it starting (`16:13:09` → `16:13:10`).

**Fix:** halve the count-in pulse above ~140 effective BPM (count in half-notes), and/or cap the effective click at a countable rate.

### M3. View changes kill runs, and the user has to find their place again by hand

Five `score.viewchange.pause`. `pauseForViewChange` stops the transport on any zoom / flow / transpose while running (`ScorePlayer.jsx:888-895`) — correct per the 07-13 audit's H2, but the run is never resumed. Every one of the five was followed by a play, so the user does come back; what they don't get back is their position. The gaps are 9s / 19s / 27s / 29s / 10s, and the resume always starts somewhere else:

```
02:28:30 viewchange.pause  →  (9s)   02:28:39 play {step:41}
02:29:13 viewchange.pause  →  (27s)  02:29:41 play {step:0}
02:30:24 viewchange.pause  →  (29s)  02:30:53 play {step:26}
```

**Fix:** remember `playing` + position across the re-engrave and auto-resume once `layoutFresh` returns, exactly as H5 proposes for the part change. Same mechanism, two callers.

### M4. `score.playback.stats` fires on every mode change and Restart, mostly empty

`flushPlayback` always emits (`useScoreTelemetry.js:55-68`), and `flushPlaybackNow` is called from mode changes, Restart, view changes and unmount regardless of whether anything played. **23 of the 106** stats records read `{events: 0, meanDriftMs: 0, …}` — 6% of the *entire* info budget spent on records that say nothing. Guard on `pendingPlaybackRef.current` (the flag already exists for the unmount path) or on `d.count > 0`.

### M5. `score.follow.timing` is measuring the wrong thing, with a bug on top

Two problems in `onFollowHit` (`ScorePlayer.jsx:488-496`):

**(a) Off-by-a-session bug.** `actualMs = performance.now() - (lastAdvanceRef.current || performance.now())`. `lastAdvanceRef` starts at `0`, so the first hit after entering Learn always computes `actualMs = 0` → maximum negative drift → `feel: "rush"`. Seven of the 31 records are this artefact, and one whole `follow.stats` record inherited it: `{hits: 2, wrongs: 4, meanAbsDriftMs: 400, rushPct: 100}`.

**(b) Category error.** Learn is self-paced — the cursor waits for the player. Measuring "drift" against the written note duration is meaningless there: `expectedMs` is 94ms in most records, so any human response is `drag`, and 24 of 31 records are classified `drag` with values up to 47,039ms. `TIGHT_MS = 25` (`scoreTelemetry.js:21`) cannot ever be satisfied.

**Fix:** initialize `lastAdvanceRef` when Learn is entered; and either drop timing classification from Learn entirely (it belongs in Polish, which is graded at tempo) or measure it against a rolling median of the user's own step intervals rather than the score's.

---

## Low

### L1. Every score open writes a 416-byte orphan session file

54 `session-log.start` for **27** score opens — two fire per open, one `{app: "piano-sheetmusic"}` and one `{scoreId}` ~300ms later (`useScoreTelemetry.js:27`, called from `ScorePlayer.jsx:1066`) — and the first opens a backend session file that never receives another line. Seven such 416-byte orphans are in the directory. Emit the score id on the existing session rather than opening a second one.

### L2. `logLoadFailed` is dead code

Defined and returned from `useScoreTelemetry` (`:30,86`), never called anywhere. `score.load.failed` has never been emitted. Load failures surface only via `SheetMusic.jsx`'s separate `piano.score-open-failed` on a different logger, which does not land in the session log. Wire it or delete it.

### L3. Perform mode is used and almost entirely unlogged — we cannot judge it from this corpus

Perform was entered **five** times: 02:22:25, 02:24:06, 02:32:08 (07-26) and 16:57:49, 17:25:57 (07-27). The first four ran 3–25 seconds. The fifth ran **15m50s** — entered at 17:25:57, two seconds after a 16s creature engrave, with no further events until the user switched to Listen at 17:41:47 and immediately started working a loop. Someone was at the tablet at both ends of that gap.

Sixteen silent minutes is exactly what Perform looks like when it is *working*: the mode's job is to display the sheet while you play acoustically, and playing acoustically emits nothing. Perform's tap-to-scroll (`ScorePlayer.jsx:752-757`) is not instrumented, so a fully-engaged 16-minute session and an abandoned tab are indistinguishable in the log.

What does survive: **zero `score.perform.pageturn`.** The pedal page-turn (`advancePedalCC: 67`, `backPedalCC: 66`) has never fired, so we have no evidence it works on the current Jamcorder MIDI path at all. That is worth an explicit device test — and it is the *only* Perform claim this corpus supports.

**Fix:** log tap-to-scroll and mode dwell before drawing any conclusion about Perform; then bench-test the pedal CCs against the Jamcorder path.

---

## T. Telemetry blind spots

The instrumentation covers state the code changes and misses the buttons users press. Currently **unlogged**:

| Control | Location | Note |
|---|---|---|
| **Restart** | `ScorePlayer.jsx:912-927` | No `logger.info`, no `tapIntent`. Only inferable indirectly: a `score.playback.stats` with no pause/done/mode/viewchange within 200ms. **~40** such records exist (38–41 depending on the window; a further 12 are terminal, i.e. unmount/death flushes) — so Restart is plausibly the most-pressed control in the mode and we have zero direct evidence of it. |
| **Tap-to-seek** | `:781-799` | The primary navigation gesture in the mode. Invisible. Every `play {step: N}` with an unexplained N is a seek we can't see. |
| Zoom / flow toggle | `:910,956` | `pauseForViewChange` logs the *side effect*, not the intent — we can't tell zoom from flow from transpose. |
| Keyboard toggle | `:957-960` | |
| Metronome toggle | `:961-964` | Never observed on; can't tell if it's unused or undiscovered. |
| Loop nudge ±1 | `:846-848` | The 07-13 audit's L2 fix. Emits a bare `focus.set` indistinguishable from a two-tap selection — the two sets at 17:42 are almost certainly nudges, so it *has* been used, but only by elimination. Tag the event with its origin. |
| **Perform tap-to-scroll** | `:752-757` | Perform's primary gesture. Unlogged — see **L3**. |
| Run summary open/close/replay | `:930-931` | Moot until Polish grades something. |

`tapIntent()` already exists and is wired into the input recorder at eight call sites (pageturn, focus, mode, transpose, transport-pause, transport-play, active-part, hands) — extending it to these is a one-line change each. Without them, the log can tell us *that* a user re-seeked to step 41, never *how*.

### T2. The info stream has at least one demonstrated hole

`2026-07-27T17-25-39.jsonl` contains a 24-second playback run (17:42:09–17:42:33; 550 stalls, 44 sched-lates, terminal `{events: 557, scheduled: 544}`) with **no** `score.transport.play`, no `countin.go`, and no `loop-wrap`. All four `transport.play()` call sites in `ScorePlayer.jsx` do log, so either there is a start path neither this audit nor its reviewer found, or an info line was dropped in transit.

Consequence for everything above: **"zero occurrences in the log" is strong evidence, not proof.** It holds up well for `score.polish.measure` (which would fire per measure, many times per run, and had a live 17-event run to fire during) and poorly for one-shot controls like `score.perform.pageturn`. Weight the zeros accordingly, and treat a single missing event as a reason to check the device rather than to conclude the feature is dead.

---

## Recommended order of work

Ranked by (evidence of harm) × (cost to fix):

1. **H1 — fix the stall threshold.** One-line predicate change plus a level demotion. Until this lands, every future log is unreadable and every measurement is contaminated. Do this first, then re-collect a week of logs before judging anything else.
2. **H2 — reset the cursor on completion.** ~3 lines. Removes the single most-repeated failed interaction in the corpus (12 presses in a row).
3. **T1 — log Restart, tap-to-seek and Perform's tap-to-scroll**, tag the loop-nudge `focus.set` with its origin, and assert on transport start (see **T2**). A handful of `tapIntent` calls. Cheap, and without them the next audit is guessing again — as this one did about Perform.
4. **H4 — expire `selecting`, give feedback on a rejected selection tap.** Small, and it un-breaks tap-to-seek.
5. **M1 — stop persisting `focus` across sessions.** One field removed from the save patch. Fixes "the piece won't start at the beginning" across six observed sessions.
6. **H5 + M3 — resume after re-engrave.** One shared mechanism serving both the part change and the view change.
7. **H3 — make Learn's outstanding notes visible, and surface the hands split.** The biggest design change here, and the one that decides whether the practice ladder exists at all.
8. **H6 — engrave caching + cross-check the renderer deaths** against the kiosk watchdog logs. Re-measure after H1.
9. **Debug the Polish evaluator — do not cut it yet.** Polish is directly reachable (`ScoreTransportBar.jsx:8-13,52` renders all four tabs unconditionally; it was entered directly three times), and on 07-26 it ran for 5.5s with 17 note events and the evaluator enabled, and graded nothing. That is a bug signature, not a discoverability signature. Instrument `gradeMeasure` entry/exit, bench-test against a short loop at a known tempo, and only then decide keep-vs-cut on evidence. The 07-13 audit's H5 warning about advertised chrome still applies — but you cannot conclude chrome from a grader that was never proven to work.
10. **Bench-test Perform's pedal CCs** (`advancePedalCC: 67`, `backPedalCC: 66`) against the current Jamcorder MIDI path. This is the one Perform claim the corpus actually supports, and it is a device test, not a code change.

---

## Appendix — reproducing these numbers

Logs live at `{data}/media/logs/piano-sheetmusic/` (Dropbox-synced; readable directly on the prod host, which is much faster than the macOS CloudStorage mount).

**Read from the prod host, not the macOS mount.** All numbers in this audit are computed against prod. At time of writing the macOS CloudStorage copy was four files / ~4,800 lines behind (31 files / 62,602 lines vs 35 / 67,428), so recomputing locally will not reproduce these figures. Check `ls | wc -l` on both before concluding a number is wrong.

```bash
ssh {env.prod_host} "cd {dropbox}/Apps/DaylightStation/media/logs/piano-sheetmusic && \
  cat *.jsonl | python3 -c \"
import sys, json, collections
c = collections.Counter(); lvl = collections.Counter(); n = 0
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try: d = json.loads(line)
    except: continue
    n += 1; c[d.get('event')] += 1; lvl[d.get('level')] += 1
print('total', n, dict(lvl))
for k, v in c.most_common(): print(v, k)
\""
```

Human-readable session timeline (drop the two noise events):

```bash
ssh {env.prod_host} "cd {dropbox}/Apps/DaylightStation/media/logs/piano-sheetmusic && \
  for f in *.jsonl; do echo \"== \$f\"; \
    grep -v 'score.playback.stall' \$f | grep -v 'score.playback.sched-late'; done"
```

That second command reduces 67,428 lines to 391 — which is the whole point of **H1**.
