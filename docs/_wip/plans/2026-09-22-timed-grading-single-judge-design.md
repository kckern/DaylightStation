# Timed grading: one judge, on the beat the child hears

Date: 2026-09-22 · Status: approved design, in implementation

## What went wrong (2026-09-22, one learner, G major up, cued/timed, L4)

Three timed runs scored 0.30, 0 and 0.43. The learner played every pitch, evenly
spaced, ~420-480 ms after each beat. The gate recorded three failures and
demoted them L4 → L3.

Two judges disagreed:

- **The staff** (`SvgSequenceStaff`, `ExerciseNotation`) paints the held key
  against the clock cursor. The cursor sits on a note from its onset until the
  next onset, so the screen said green for anything 0..1 slot (0-500 ms) late.
- **The grader** (`assessmentAttempt.js` timed matcher) accepts ±220 ms and
  charges any miss to the NEAREST pending event. A steady 450 ms lag pairs every
  note with the NEXT event → "wrong" on every note, completeness 1/8.

Contributing lag: the count-in click is WebAudio over Bluetooth A2DP to the
piano (tablet speaker is muted by the audio guard; A2DP write latency measured
~190 ms avg / 320 ms max on the tablet), and the click grid starts ~80 ms +
one render after the grading clock with nothing aligning them. Note input comes
over the bridge WebSocket with no timestamp and is stamped `Date.now()` in a
React effect.

## Decisions

1. **Window:** centred on the beat, ±40 % of the gap to the nearest neighbouring
   onset (clamped 80..400 ms). Exercises only; Sheet Music, Piano Hero and Space
   Invaders keep their current fixed windows and behaviour.
2. **One judge:** a pure `judgeTimedOnset` decides; the grader records with it;
   every renderer paints recorded verdicts for timed runs. No renderer judges.
3. **Off-beat right pitch** is recorded on its OWN beat as `early`/`late`: it
   counts toward completeness, earns zero placement, and never cascades onto
   the next beat. Wrong pitch is `wrong`, attributed to the nearest event.
4. **Input time** is the APK's timestamp of the MIDI event, not render time.
5. **Click** is anchored to the grading clock and played early by
   `clickLeadMs` (config, else browser-reported output latency), measured by a
   grown-up tap-along calibration.
6. **Today's three runs** are voided (kept, not counted) and the learner is restored
   to L4.

## Contract: the judge (owner: performance/)

`frontend/src/modules/Piano/performance/timedJudge.js`

```js
// Per-event window, ms. Fixed policy when policy.windowFraction is absent.
timedWindowMs(attempt, eventIndex) -> number
//   fraction mode: clamp(windowFraction * gapMs, windowMinMs, windowMaxMs)
//   gapMs = min distance (ms) to previous/next NON-EMPTY event onset;
//   a single-event ask uses windowMaxMs.
//   fixed mode: policy.matchWindowMs (today's behaviour)

judgeTimedOnset(attempt, { midi, time }) ->
  { verdict: 'hit', eventId, noteIds, driftMs, windowMs }
| { verdict: 'early' | 'late', eventId, noteIds, driftMs, windowMs }   // fraction mode only
| { verdict: 'wrong', eventId /* nearest event by time, or null */, midi, driftMs }
```

Policy keys (exercise defaults set in `ExerciseRun` `DEFAULT_POLICY`):
`windowFraction: 0.4, windowMinMs: 80, windowMaxMs: 400`. When
`windowFraction` is set:

- **hit**: a pending note of that pitch whose |drift| ≤ its window (closest wins).
- **early/late**: else, a same-pitch note that is pending OR lapsed (not yet
  final) with |drift| ≤ its `reachMs` (= the event's gap, ≥ window). Closest
  wins. Stored in `attempt.hits[noteId] = { time, driftMs, offbeat: 'early'|'late' }`.
- **wrong**: anything else.
- **lapsed**: when `time > target + windowMs` a pending note is added to
  `attempt.lapsed` (display: grey). It can still be claimed as `late`.
- **miss (final)**: when `time > target + reachMs` → `attempt.misses`, as today.
- Placement per hit: 1 inside ±(0.4 × window), linear to 0 at the window edge;
  off-beat hits score 0. (Implemented by deriving tolerance/timing window per
  event in fraction mode; fixed mode unchanged.)

Without `windowFraction` the timed matcher behaves exactly as before
(existing tests must pass unchanged).

`frontend/src/modules/Piano/performance/timedVerdicts.js`

```js
timedVerdicts(snapshot) -> Map<eventIndex, Map<midi, NoteVerdict>>
NoteVerdict = { state: 'hit'|'early'|'late'|'lapsed'|'miss', driftMs? }
            | { state: 'wrong', midi, driftMs? }   // keyed by the played midi
```

Plus `timedRunSummary(snapshot.result, snapshot)` → `{ kind: 'passed' |
'timing' | 'notes', offbeat, late, early, medianDriftMs }` for the result line.

## Contract: display (owner: Exercises/ + MusicNotation/)

- Timed runs: `ExerciseRun` builds `verdicts = timedVerdicts(snapshot)` and
  passes `verdicts` to SvgSequenceStaff, ExerciseNotation, KeysAsk and
  ScorePassage. When `verdicts` is provided, a renderer paints from it and
  ignores `activeNotes` for colour. Free/cursor runs unchanged.
- Colours: hit green; early/late amber with a ◂ / ▸ tick; wrong red ghost at
  the played pitch; lapsed/miss grey.
- Cursor: clock-driven guide; `windowOpen` (now within the current event's
  window) lights it, dim between windows.
- Result copy for a timed fail names the cause, e.g. "Every note was right, but
  6 of 8 came late — about 0.4 s behind the click."
- Timed onsets are observed at the note's own `timestamp` from `activeNotes`
  (see input), not `Date.now()` in the effect.

## Contract: input timestamps (owner: piano-bridge payload + MIDI hooks)

- Payload sends `{ type: 'note.on'|'note.off', note, velocity, t }`, `t` =
  epoch ms of the Android MIDI event (from the receiver's nanoTime timestamp,
  converted with `currentTimeMillis() - (nanoTime() - ts)/1e6`).
- `usePianoBridgeNotes` → `feedNote(type, note, velocity, t)` → noteStore
  `timestamp = t` when `|Date.now() - t| ≤ 1000`, else receipt time plus a
  sampled `piano.input.untimed` log. Web MIDI path uses
  `performance.timeOrigin + event.timeStamp`.
- Sampled `piano.input.bridge-lag` log with `lagMs = receipt - t`.

## Contract: click (owner: SheetMusic/ click + piano config + calibration)

- `useMetronomeClick({ ..., anchorMs, leadMs })`: when `anchorMs` is finite,
  beats land at `anchorMs + n·period - leadMs` in epoch time, mapped onto the
  AudioContext clock via `getOutputTimestamp()` (fallback: `currentTime` ↔
  `Date.now()` sampled together). Past beats are skipped, keeping phase.
- `resolveClickLead(pianoConfig, audioContext)` → `{ leadMs, source:
  'config'|'browser'|'none' }`; config key `timing.clickLeadMs` (per-piano
  override `pianos.{id}.timing.clickLeadMs`), resolved in `resolvePianoConfig`.
- Calibration: a grown-up screen (teacher/admin door) plays 24 clicks, collects
  timestamped key presses, takes the median offset (click scheduled → key
  timestamp) and spread; writes `timing.clickLeadMs` when spread ≤ 60 ms.
- Log `piano.click.anchored` per run with `leadMs`, `source`, `outputLatency`,
  `baseLatency`.
- Implemented 2026-09-22 (see `docs/reference/piano/sheet-music-player.md`,
  "Metronome click"). Refinement: `browser` applies only when the context lacks
  `getOutputTimestamp()` — that mapping already includes the browser's output
  latency, so adding it again would double it. Spread is the IQR. Entry point:
  Piano maintenance → Click timing. Log helper: `logClickAnchored(lead, { anchorMs })`
  in `modes/SheetMusic/clickLead.js`.

## Voiding today's runs

Attempt files: `users/{learner}/apps/piano/attempts/2026-09-22/{attempt_id}.yml`
for `attempt-ce30c9c6…`, `attempt-9276858b…`, `attempt-5daa90f2…` get
`voided: { at, reason }`; readers skip voided attempts. The gate ladder lives in
kiosk `localStorage` (`piano.game-gate.rung.{learner}`); restore `levelId: L4` with
counters reset.

## Tests

- Judge: steady +450 ms lag at 500 ms spacing → 8 `late`, 0 `wrong`,
  completeness 1, placement 0; on-beat run → 8 hits; one wrong pitch does not
  shift later notes; fixed-policy suites unchanged.
- Display: verdict map drives colours; no green while the record says off-beat.
- Input: `t` preserved end to end; stale `t` falls back.
- Click: anchored schedule lands on `anchorMs + n·period - leadMs`.
