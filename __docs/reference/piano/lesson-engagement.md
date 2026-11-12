# Piano lesson credit — the session good-faith judgement

A piano video lesson counts when the child watched it **and took part at the
keyboard in good faith**. Each finished sitting gets one quiet 0–10 good-faith
score from the decision gateway, judged on a minimal MIDI log of what was
played; the child never sees it. Below the pass score the lesson asks for a
short warm-up before it counts. During the lesson, the "still there?" check-in
escalates from one note to scales when nobody plays between check-ins.

**Owner ruling (2026-11-12): "let's not trust our ratings — just evaluate
engagement by non-spam, good-faith detection via the Decision gateway."**
Per-lesson expectation targets (AI rubric ratings and measured rates) no longer
decide credit; the nightly rating job makes no model calls.

Code: `__app_modules/learning/piano/portable/practice/` (pure rules, shared by the
kiosk and the server — `sittingGoodFaith.mjs` is the judge's state and rubric,
`goodFaith.mjs` the credit decision), `server/application/JudgeLessonSitting.mjs`
(the gateway call), `server/adapters/YamlUserVideoProgressStore.mjs` (credit),
`browser/PianoKiosk/modes/Videos/` (live tally, warm-up, ladder).

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

## The good-faith judgement

**One call per finished sitting**, scoped `{ app: 'piano', feature: 'lesson-good-faith' }`.
Past the watch threshold (`videos.completion_threshold_percent`, 90) every
play/log post from an enforced lesson carries the sitting's state; the first
one asks the judge (`prepareCredit` before `record`), later posts join that
answer. The lesson still has its last 10 % to play, so the child is not waiting.
**8 s deadline**: a timeout, error, unusable answer or missing gateway is a
final `fallback` for that sitting (no retry) and the lenient rule decides.

**What the model sees** (`sittingGoodFaithState`; the server re-normalises it
with `normaliseGoodFaithState`, so nothing else a kiosk sends reaches the model —
no image, no audio, no identifiers):

| Field | Content |
|---|---|
| `notes[]` | practice-like human notes as `{ pitch, onsetMs (since the sitting started), durMs, velocity }`; ≤ 200 — a longer sitting is shown as 8 evenly spaced runs of 25 |
| `perMinute[]` | practice-like notes per minute (≤ 120 minutes) |
| `lesson` | `lengthMin`, `watchedMin`, `preschool`, `notesPlayed`, `notesShown`, `notesSetAsideAsNoise` (mashing removed by the filter), `distinctPitches`, `playingStretches` (silence > 10 s splits) |
| `presence` | `checkIns`, `answered`, `log[]` of `{ atMin, asked: 'note'\|'scale', answered }` |

**The question** (`score`, six rungs, lowest first; school wording: "Did the
child take part at the keyboard in good faith? Judge good faith, not skill or
amount: some lessons ask for little playing."; preschool wording: "Any
deliberate key pressing by a small child counts"):

| Rung | Worth |
|---|---|
| Nobody at the keys: no notes, or only the taps that answered the presence check-ins | 0 |
| Not in good faith: only noise (mashing, banging, one key hammered, random scatter) or one or two stray notes | 2 |
| Doubtful: only a few scattered notes; hard to tell whether anyone was trying | 4 |
| Good faith, sparse: someone deliberately trying what the lesson shows, even if only now and then | 7 |
| Playing along: regular deliberate playing through the lesson | 9 |
| Locked in: playing along steadily through the whole lesson | 10 |

The score is the probability-weighted worth of the rungs, one decimal
(`goodFaithFromAnswer`). The gateway allows at most 10 rungs, so the 0–10 scale
is six worded rungs, not eleven.

**The lenient rule** (`fallbackCredited`, used with no judgement): credit when
the sitting(s) had **≥ 6 practice-like notes or an answered presence check-in**;
otherwise (nobody there, drum loop only, mashing only) the largest warm-up.
Benefit of the doubt: a judge that is off or slow never costs a child a lesson.

### Calibration (2026-11-12) — passed, so the judge is on

`node __app_modules/learning/piano/cli/piano-goodfaith-calibrate.cli.mjs`
(every engagement-audit sitting + 6 synthetic mash sittings, 421 calls). The
audit has no check-in record, so check-ins are replayed the way the kiosk opens
them: one per 90 s without a note, all answered. Expected: engaged and
low-touch credit; absentee, rhythm-loop and mash drill. Bar: false drills on
engaged + low-touch ≤ 5 %, absentees caught ≥ 90 %, overall and per cohort.

| | Accuracy | False drills (engaged + low-touch) | Absentees caught | Rhythm-loop caught | Mash caught |
|---|---|---|---|---|---|
| Overall (421) | 0.983 | 1 / 343 (0.3 %) | 57 / 60 (95 %) | 9 / 12 | 6 / 6 |
| School (221) | 0.973 | 1 / 177 (0.6 %) | 24 / 26 (92.3 %) | 9 / 12 | 6 / 6 |
| Preschool (200) | 0.995 | 0 / 166 | 33 / 34 (97.1 %) | — | — |
| Lenient rule alone | — | 0 % | 31 % school / 38 % preschool (answered check-ins credit) | 0 % | 100 % |

Mean scores: engaged 8.4 (school) / 8.7 (preschool), low-touch 7.5 / 7.6,
absentee 0.5 / 0.2. Two runs gave identical numbers. Cost: ~4,600 input tokens,
**≈ $0.0002 per sitting** ($0.08 for the whole set). The earlier burst-level
`yesNo` judge failed the same kind of check (accuracy 0.48) and stays off.

## Credit

At the watch threshold:

| Case | Outcome |
|---|---|
| Lesson not in the index, or the learner's `engagement_gate: false` | today's rule (watched + any play-along) — `unenforced` |
| Old kiosk bundle (no `practice` in the post) and `legacy_clients` not `false` | today's rule — `legacy` |
| best judged sitting ≥ pass score (6; preschool 3) | `credited` (`source: model`) |
| judged below the pass score | `drill-owed`, warm-up sized from the floored score, until its reps are passed → `credited-after-drills` |
| no judgement | the lenient rule (`source: fallback`): `credited`, or `drill-owed` at score 0 |

A sitting's judgement is stored on it (`practice.sittings[id].goodFaith`) and
kept; the lesson's best judged sitting stands. An entry that already has
`completedAt` is never re-judged.

### Warm-up size

| Score | School courses (scales, hands R → L → RL, roots rotate C, G, F) | Preschool courses (finger games) |
|---|---|---|
| 4–5 | 1 set × 2 reps | — (pass is 3) |
| 2–3 | 2 sets × 2 reps | 1 round |
| 0–1 | 3 sets × 2 reps | 2 rounds ("Play 5 notes going up", "Copy these 3 notes") |

Scales are the match gate's drill machinery (`gateDrill.js` + `AskSession`): an
`exercise` spec on the `scales` collection, ionian, up-then-down, one octave.
A missed rep is played again; there is no failure state.

## The lesson index (formerly "the expectation record")

`data/content/piano/lesson-expectations/<showKey>.json` (one file per show) plus
`_measured.json`. Since 2026-11-12 these files are only the **index**: a record
means the lesson sits in an engagement-gated course, and its `showKey` /
`seasonKey` key preschool mode. Their `targetNpm`, `level`, `levelScore` and
`source` are kept on disk but **not read for credit**.

**The job** (`piano-lesson-expectations`, nightly `40 3 * * *`,
`POST /api/v1/harvest/piano-lesson-expectations`) runs **index-only**: no
decision gateway, no caption fetch, no rating call. An existing record is never
rewritten; a new lesson gets a `source: 'default'` record. The 2026-11-12 rubric
run (3,433 lessons; Spearman ≈ 0 against measured engagement) is why the ratings
were dropped.

## The presence ladder

The 90 s idle check-in (sequential courses, human notes only) now escalates when
nobody plays between check-ins:

| Step | When | Asks for |
|---|---|---|
| 0 | first idle, or the first after real playing | one note — "Are you still there? Play this note to keep going:" |
| 1 | idle again, no real playing since the last answer | one scale — "Welcome back! One quick scale, then the lesson carries on." |
| 2+ | again | two scales (cap) — "Let's wake those fingers up — two quick scales, then back to the lesson." |

**Which scales.** A check-in scale is in the lesson's key when its title names one
("C Position", "G Position", "A Major Scale", "Bb Major Scale" → A#, "key of D");
else the household's `drill_roots`; else C, G, F. The roots rotate per scale asked
in the sitting (the step's `scaleIndex`), so a second check-in with no known key
starts on G, not C again. A minor key or "a Major 7 chord" is not read as a key.
Roots are spelt as the drill knows them (sharps): a flat key becomes its sharp.

**Real playing** resets the ladder: ≥ 8 *legit* notes since the last answer (+3 s).
A legit note is human with practice weight ≥ 0.5. The burst between check-ins is
labelled `legit` (≥ 8 legit notes, retention ≥ 0.8), `spam` (retention ≤ 0.4,
< 8 legit notes, or one key only) or `ambiguous`. Only `ambiguous` asks the
model. While its answer is pending the ladder holds; with the model off or timed
out an ambiguous burst counts as legit. Preschool courses never go past step 0.

## The check-in burst judge (off)

The presence ladder can ask one `yesNo` question about an *ambiguous* check-in
burst (`POST /api/v1/piano/users/:userId/lesson-legit`, scoped
`lesson-legit-notes`, `videos.practice.legit_model`). Its calibration failed
(2026-11-12: accuracy 0.48, preschool acceptance 0/40; `piano-legit-calibrate`),
so it stays off and an ambiguous burst counts as legit. It plays no part in
credit: the kiosk no longer asks it at the end of a lesson, and the progress store
no longer reads its `end-of-lesson` answers (the route still accepts them from old bundles).

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
watched %, good-faith score N/10 (`no judge` when the lenient rule decided),
check-ins `N (M scales)`, practice-like notes per minute, warm-up given and passed, and the outcome (Counted / Counted after
warm-up / Not counted yet / Not checked).

## Config (`household/piano/config.yml` → `videos.practice`)

| Key | Default | Meaning |
|---|---|---|
| `good_faith_model` | false | ask the session good-faith judge (live: `true` since the 2026-11-12 calibration) |
| `pass_score` | 6 | school-course pass score |
| `preschool_pass_score` | 3 | preschool-course pass score |
| `preschool_courses` | `[]` | course (show or season) ids judged in preschool mode |
| `drill_roots` | `[C, G, F]` | scale roots, rotating per warm-up; also the check-in scales when the lesson title names no key (reaches the kiosk as `expectation.drillRoots`) |
| `legacy_clients` | true | `false` once every kiosk sends `practice` |
| `legit_model` | false | the check-in burst judge (failed calibration; off) |
| `level_targets` | — | unused since 2026-11-12 (ratings no longer decide credit) |

## Log events (LogsQL)

| Event | Example |
|---|---|
| `piano.lesson-good-faith.judged` (score, model, ms, notes, checkIns, levelProbabilities, inputTokens, preschool) / `fallback` (reason: timeout / error / no-score / no-gateway) | `"piano.lesson-good-faith" AND _time:24h` |
| `piano.lesson-credit.decision` (score, source model/fallback, outcome, drillReps, preschool) — logged when the outcome or score changes | `"piano.lesson-credit.decision" AND _time:24h` |
| `piano.lesson-credit.legacy-client` | `"piano.lesson-credit.legacy-client" AND _time:24h` |
| `piano.video-progress.record` (gains outcome, score) | `"piano.video-progress.record" AND _time:6h` |
| `piano.lesson-expectation.index-only / computed / run-summary` (the index job) | `"piano.lesson-expectation.run-summary" AND _time:7d` |
| `piano.lesson-legit.judged / fallback` | `"piano.lesson-legit" AND _time:24h` |
| `piano.lesson-practice.sitting-start / threshold / snapshot / loop-retracted` | `"piano.lesson-practice.snapshot" AND _time:2h` |
| `piano.lesson-drill.offered / started / rep-passed / completed / left / unavailable` | `"piano.lesson-drill" AND _time:24h` |
| `piano.engagement-gate.open` (step, scales, consecutiveIdle) / `scale-roots` (roots, source title/config/default, count, scaleIndex) / `scale-passed` / `ladder-reset` / `ladder-hold` | `"piano.engagement-gate" AND _time:24h` |
