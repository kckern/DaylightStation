# Piano lesson credit — the silent good-faith score

A piano video lesson counts when the child watched it **and played along about as
much as that lesson asks for**. Each sitting gets one quiet score from 0 to 10; the
child never sees it. Below the pass score the lesson asks for a short warm-up before
it counts. During the lesson, the "still there?" check-in escalates from one note to
scales when nobody plays between check-ins.

Code: `__app_modules/learning/piano/portable/practice/` (pure rules, shared by the
kiosk and the server), `server/adapters/YamlUserVideoProgressStore.mjs` (the credit
decision), `browser/PianoKiosk/modes/Videos/` (live tally, warm-up, ladder).

## What counts as a note

1. **Human only** — `humanNoteClassifier` drops the piano's rhythm/drum loop,
   accompaniment channels and clockwork streams. The kiosk also takes back notes
   on the loop's pitches from the ~30 s before the loop is recognised.
2. **Not a check-in answer** — notes played while a check-in is open, and for 3 s
   after it is answered, are not practice.
3. **Practice-like** — `practiceScore.mjs` weighs each note (1 = full):

| Rule | Shape | Weight |
|---|---|---|
| Chord shape | ≤ 4 notes in ≤ 2 hand clusters, each ≤ 12 semitones | 1 |
| | 5-note chord, or 3+ clusters | × 0.5 |
| | 6+ keys, or a cluster wider than 12 semitones (fist, palm) | 0 |
| Hammer | 10+ consecutive presses of one key | 0 |
| Scatter | 10-chord window: span > 40, mean jump > 15, ≥ 80 % distinct pitches | 0 |
| Burst | 12-chord window (5 minimum) with median gap < 70 ms; a 4-chord one-way sweep in ≤ 3-semitone steps under 75 ms | 0 |
| Stream | > 60 s non-stop (no 1 s rest) at > 6 onsets/s | × 0.5 |
| Flat velocity | 16 notes within a velocity spread of 2 (mild: a piano set to fixed touch is still a child) | × 0.5 |
| Bangs | a whole stretch at velocity ≥ 120 | 0 |

Onsets within 50 ms are one chord; a gap over 2 s ends a stretch; every rule
works inside one stretch.

**Preschool courses** (`videos.practice.preschool_courses`) are lenient: every
human key press weighs 1 — fists, palms and one key over and over all count;
only machine streams and silence do not.

### Calibration (2026-11-12, engagement audit sittings, prompt answers excluded)

| Measure | Result |
|---|---|
| Engaged sittings (n = 302): median / p10 retention | 0.969 / 0.689 |
| False rejects (engaged, weighted score < 6 where the raw count scores ≥ 6) | 2 / 306 (0.7 %) |
| False accepts (absentee 60 + rhythm-loop 12 + synthetic mash 6 scoring ≥ 6) | 0 / 78 |
| Mash retention (fist, palms, glissando, hammer, scatter, bangs) | 0 each |
| Bursts of 8–40 notes: engaged labelled spam / ambiguous | 4.5 % / 5.3 % (n = 759) |
| Bursts: mash labelled legit | 0 / 60 |
| Preschool mode on the two youngest learners' sittings: engaged rejected / absentee accepted | 0 / 155, 0 / 34 |

The calibration test prints these numbers:
`portable/practice/practiceScore.calibration.test.mjs`.

## The score

```
practiceNpm = practiceNotes / max(1, playedSec / 60)      (banked over the last 12 sittings)
score       = targetNpm == 0 ? 10 : clamp(floor(10 × practiceNpm / targetNpm), 0, 10)
```

Notes and played seconds are banked across sittings of the same lesson (each
sitting keeps its field-wise maximum, so repeated `play/log` posts never add up).
A lesson finished over two days scores both days' playing.

## Credit

At the watch threshold (`videos.completion_threshold_percent`, 90):

| Case | Outcome |
|---|---|
| No expectation record, or the learner's `engagement_gate: false` | today's rule (watched + any play-along) — `unenforced` |
| Old kiosk bundle (no `practice` in the post) and `legacy_clients` not `false` | today's rule — `legacy` |
| score ≥ pass score (6; preschool 3) | `credited` |
| below the pass score | `drill-owed` until the warm-up's reps are passed → `credited-after-drills` |

An entry that already has `completedAt` is never re-judged. Credit is plain
arithmetic on cached numbers; the model only advises on a borderline score (below).

### Warm-up size

| Score | School courses (scales, hands R → L → RL, roots rotate C, G, F) | Preschool courses (finger games) |
|---|---|---|
| 4–5 | 1 set × 2 reps | — (pass is 3) |
| 2–3 | 2 sets × 2 reps | 1 round |
| 0–1 | 3 sets × 2 reps | 2 rounds ("Play 5 notes going up", "Copy these 3 notes") |

Scales are the match gate's drill machinery (`gateDrill.js` + `AskSession`): an
`exercise` spec on the `scales` collection, ionian, up-then-down, one octave.
A missed rep is played again; there is no failure state.

## The expectation record

`data/content/piano/lesson-expectations/<showKey>.json` (one file per show) plus
`_measured.json` (the audit's measured lessons). Record:

```
{ plexId, showKey, seasonKey, title, season, episode, durationSec,
  source: 'measured'|'ai'|'default', targetNpm, level, levelScore, confidence, model,
  measured: { n, minNpm, medianNpm, maxNpm } | null, captionHash, computedAt }
```

| Source | targetNpm |
|---|---|
| `measured` (audit engaged sittings) | slowest engaged rate; 0 under 6/min; capped at 40 |
| `ai` (one rubric `score` call over the caption transcript) | level 0–3 → `[0, 5, 13, 25]` (`videos.practice.level_targets`) |
| `default` (no captions, no measurement) | 0 — watch-only, never drills |

Rubric (exact copy, `lessonExpectation.mjs`): "How much of this piano lesson does
the student spend playing the piano themselves?" — Watch only / A little /
Regular / Throughout. Only tabs whose `engagement_gate` is not `false` get
records; a season a gate-off tab cherry-picks (singing) is skipped.

**The job:** `POST /api/v1/harvest/piano-lesson-expectations?limit=60[&force=true]`,
nightly from `jobs.yml` (`piano-lesson-expectations`, `40 3 * * *`). Idempotent:
a lesson whose caption hash and source are unchanged is skipped. The result
reports `computed / skipped / failed / remaining`, `noCaptions`, and
`calibration: { n, spearman, aiTargetAboveMeasuredRate }` (AI level vs measured
engagement over the measured lessons). Model calls are scoped
`{ app: 'piano', feature: 'lesson-expectation' }` in the AI usage ledger.

## The presence ladder

The 90 s idle check-in (sequential courses, human notes only) now escalates when
nobody plays between check-ins:

| Step | When | Asks for |
|---|---|---|
| 0 | first idle, or the first after real playing | one note — "Are you still there? Play this note to keep going:" |
| 1 | idle again, no real playing since the last answer | one scale — "Welcome back! One quick scale, then the lesson carries on." |
| 2+ | again | two scales (cap) — "Let's wake those fingers up — two quick scales, then back to the lesson." |

**Real playing** resets the ladder: ≥ 8 *legit* notes since the last answer (+3 s).
A legit note is human with practice weight ≥ 0.5. The burst between check-ins is
labelled `legit` (≥ 8 legit notes, retention ≥ 0.8), `spam` (retention ≤ 0.4,
< 8 legit notes, or one key only) or `ambiguous`. Only `ambiguous` asks the
model. While its answer is pending the ladder holds; with the model off or timed
out an ambiguous burst counts as legit. Preschool courses never go past step 0.

## The legitimacy judge

One `yesNo` question, scoped `{ app: 'piano', feature: 'lesson-legit-notes' }`,
asked **only** for an ambiguous check-in burst or a borderline final score
(raw score in [pass − 1, pass + 1): [5, 7), preschool [2, 4)).

- **What it sees:** a minimal MIDI log only — `notes[]` of `{ pitch, onsetMs, durMs,
  velocity }` (≤ 200, onsets relative to the first) and five numbers: `notes`,
  `distinctPitches`, `pitchSpan`, `medianIoiMs`, `velocitySpread`. No image,
  piano roll or audio. `POST /api/v1/piano/users/:userId/lesson-legit` rejects
  anything else (400).
- **Question:** "Is this a genuine attempt to play (practice/play-along) rather
  than random mashing, single-key spam, or idle tapping? …"; preschool: "Is this a
  small child genuinely trying to play along, rather than no one playing / a
  machine? …".
- **Async, advisory:** the kiosk never waits. 8 s deadline; a timeout, error or
  missing gateway is `fallback` and the arithmetic stands. Answers are cached per
  burst (in memory, 6 h); one call per (learner, sitting, kind, check-in).
- **Borderline credit:** p ≥ 0.7 credits; p < 0.7 owes the drill sized from the
  floored score (at least the smallest); no answer → the arithmetic score decides.
- **Off until calibrated:** `videos.practice.legit_model: true` turns it on.
  Calibrate with
  `node __app_modules/learning/piano/cli/piano-legit-calibrate.cli.mjs` (60 engaged
  + 60 mash bursts + 40 preschool bursts; bar: ≥ 0.9 overall, ≥ 0.8 on ambiguous,
  ≥ 0.9 preschool acceptance).

## What the child sees

Never a number. At the end of an enforced lesson the kiosk posts once and waits
for the answer: credit ends as before; a warm-up swaps in place of the video
("Let's warm up those fingers before this lesson counts" — "N quick scales — then
it counts." → "That counts! Lesson done."). Leaving shows **Not counted yet** on
the course list ("Play along, or do the warm-up to count it."); reopening the
lesson offers **Warm up** or **Watch again**.

## Teacher console

Teacher → piano panel "Piano lesson sittings" (`GET /api/v1/piano/users/:userId/lesson-sittings?days=14`,
`data/users/{id}/apps/piano/lesson-sittings.yml`, newest 300): date, lesson,
watched %, score N/10, check-ins `N (M scales)`, practice rate vs expected with its
source, warm-up given and passed, and the outcome (Counted / Counted after
warm-up / Not counted yet / Not checked).

## Config (`household/piano/config.yml` → `videos.practice`)

| Key | Default | Meaning |
|---|---|---|
| `pass_score` | 6 | school-course pass score |
| `preschool_pass_score` | 3 | preschool-course pass score |
| `preschool_courses` | `[]` | course (show or season) ids judged in preschool mode |
| `level_targets` | `[0, 5, 13, 25]` | rubric level → notes/min |
| `drill_roots` | `[C, G, F]` | scale roots, rotating per warm-up |
| `legacy_clients` | true | `false` once every kiosk sends `practice` |
| `legit_model` | false | turn the legitimacy judge on (after calibration) |

## Log events (LogsQL)

| Event | Example |
|---|---|
| `piano.lesson-credit.decision` (score, rawScore, reviewed, practiceNpm, targetNpm, source, outcome, preschool) | `"piano.lesson-credit.decision" AND _time:24h` |
| `piano.lesson-credit.legacy-client` | `"piano.lesson-credit.legacy-client" AND _time:24h` |
| `piano.video-progress.record` (gains outcome, score) | `"piano.video-progress.record" AND _time:6h` |
| `piano.lesson-expectation.computed / skipped / failed / no-captions / run-summary / unreadable` | `"piano.lesson-expectation.run-summary" AND _time:7d` |
| `piano.lesson-legit.judged / fallback` | `"piano.lesson-legit" AND _time:24h` |
| `piano.lesson-practice.sitting-start / snapshot / loop-retracted / judge-answer` | `"piano.lesson-practice.snapshot" AND _time:2h` |
| `piano.lesson-drill.offered / started / rep-passed / completed / left / unavailable` | `"piano.lesson-drill" AND _time:24h` |
| `piano.engagement-gate.open` (step, scales, consecutiveIdle) / `scale-passed` / `ladder-reset` / `ladder-hold` | `"piano.engagement-gate" AND _time:24h` |
