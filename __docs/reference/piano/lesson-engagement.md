# Piano lesson credit — the session good-faith judgement

A piano video lesson counts when the child watched it **and took part at the
keyboard in good faith**. Each finished sitting gets one quiet 0–10 good-faith
score from the decision gateway, judged on a minimal MIDI log of what was
played; the child never sees it. Below the pass score the lesson asks for a
short warm-up before it counts. During the lesson, the "still there?" check-in
climbs a five-rung presence ladder — one note up to two hands-together scales —
each time it is answered with no real playing since the last one.

**Owner ruling (2026-11-12): "let's not trust our ratings — just evaluate
engagement by non-spam, good-faith detection via the Decision gateway."**
Per-lesson expectation targets (AI rubric ratings and measured rates) no longer
decide credit; the nightly rating job makes no model calls.

Code: `__app_modules/learning/piano/portable/practice/` (pure rules, shared by the
kiosk and the server — `sittingGoodFaith.mjs` is the judge's state and rubric,
`goodFaith.mjs` the credit decision, `presenceLadder.mjs` the presence ladder), `server/application/JudgeLessonSitting.mjs`
(the gateway call), `server/adapters/YamlUserVideoProgressStore.mjs` (credit),
`browser/PianoKiosk/modes/Videos/` (live tally, warm-up, ladder).

**Played time** (the judge's "minutes watched") counts only while the video
plays, from its first frame (`playing`): an autoplay block or a slow start
before the first frame is not watched time (`piano.lesson-practice.first-frame`,
debug, logs the wait).

**Expectation reads** — `JsonLessonExpectationStore` re-checks its show files at
most every 5 s (`refreshMs`); its own writes are seen at once.

## What counts as a note

1. **Human only** — `humanNoteClassifier` drops the piano's rhythm/drum loop,
   accompaniment channels and clockwork streams. The kiosk also takes back notes
   on the loop's pitches from the ~30 s before the loop is recognised. One
   classifier per lesson player: `useHumanNotes` classifies and hands every
   verdict to the practice tally (`useLessonPractice({ external: true })` →
   `ingest`), so the presence gate and the tally never disagree. A velocity-0
   `note_on` is a release.
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
| `presence` | `checkIns`, `answered`, `peakRung` (0–4), `minimalCheckIns`, `log[]` of `{ atMin, asked: 'note'\|'scale', rung, answered, minimal }` — `peakRung` and `minimalCheckIns` are re-derived from the log on the server, never taken as sent |

**Rubric v2 (2026-11-13).** The state shows the presence ladder (above) and the
instructions add one sentence: "Each check-in's `rung` says how hard it was (0
one note, 1 one scale, 2 two scales, 3 a hands-together scale, 4 two); it
climbs only when the check-in before it was answered with no real playing
since. `minimal` marks such a check-in, `peakRung` is the highest reached and
`minimalCheckIns` how many there were: several minimal check-ins mean the child
came back only to dismiss the check-in." The six rungs and their worth are
unchanged, so v1 and v2 scores compare. `GOOD_FAITH_RUBRIC_VERSION`
(`sittingGoodFaith.mjs`) is the one switch: set to 1 it restores the v1 state.
The judgement and its log carry `rubricVersion`; a sitting keeps it beside its
score as `goodFaithRubric`.

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

### Calibration (2026-11-13, rubric v2) — passed, so v2 is live

Same command, same 421 sittings, but the check-ins are replayed by the presence
ladder itself (`presenceLadder.replayLadder`: rung intervals, keepalive
deadline, every check-in answered at once), so each carries its `rung` and
`minimal` mark. Bar: no worse than the 2026-11-12 floor (accuracy ≥ 0.983,
false drills ≤ 1 / 343, absentees ≥ 57 / 60, and the per-cohort bar).

| Run | Accuracy | False drills (engaged + low-touch) | Absentees caught | Rhythm-loop caught | Mash caught |
|---|---|---|---|---|---|
| A — overall (421) | 0.988 | 1 / 343 | 58 / 60 (school 25 / 26, preschool 33 / 34) | 10 / 12 | 6 / 6 |
| B — overall (421) | 0.990 | 1 / 343 | 59 / 60 (school 26 / 26, preschool 33 / 34) | 10 / 12 | 6 / 6 |

Errors 0 in both. Mean scores: engaged 8.3 (school) / 8.6 (preschool),
low-touch 7.2 / 7.4, absentee 0.4 / 0.2, rhythm-loop 1.6. Cost unchanged:
≈ 4,750 input tokens, $0.084 per run.

### Calibration (2026-11-12, rubric v1) — passed, so the judge is on

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

The idle check-in (sequential courses, human notes only) climbs one rung each
time it comes round with no real playing since the last answer, and gets
harder to dismiss (owner, 2026-11-13: "if they're just doing the bare minimum,
just to press the notes to move on, I want to make that increasingly difficult").
Rules: `portable/practice/presenceLadder.mjs` (shared by the kiosk's
`useEngagementGate` and the calibration replay).

| Rung | Asks for | Copy | Wait before it (default) | Keys to clear |
|---|---|---|---|---|
| 0 | one note | "Are you still there? Play this note to keep going:" | 90 s | 1 |
| 1 | one scale, right hand | "Welcome back! One quick scale, then the lesson carries on." | 90 s | 15 |
| 2 | two scales, right hand then left | "Let's wake those fingers up — two quick scales, then back to the lesson." | 75 s | 30 |
| 3 | one scale hands together, up and back down | "Both hands together this time — one scale up and back down, then the lesson carries on." | 60 s | 30 (both hands) |
| 4 | two hands-together scales, the second in the next key | "Two scales with both hands together — then back to the lesson." | 60 s | 60 |

The ladder stays at 4. A scale is one octave up and back down (15 keys a hand).
Rungs 3–4 render on the grand staff (`LessonDrill`, hand `RL`). The wait is the
silence before the check-in at the *current* rung (`intervals_seconds`, indexed
by rung; past the end uses the last; each capped at
`videos.engagement_timeout_seconds`).

**The evidence for an interval** (R1) runs from the last answer + 3 s (the
answer's own notes never count) to the moment the next check-in opens. A legit
note is human with practice weight ≥ 0.5.

| Evidence | When | Rung |
|---|---|---|
| practice | ≥ `partial_notes` (8) legit notes **and** ≥ `practice_npm` legit notes a minute over the whole interval | back to 0 |
| partial | ≥ 8 legit notes, below the rate | down one |
| none | < 8 legit notes, a `spam` burst, or the burst judge said not legit | up one (a **minimal** check-in) |
| hold | the burst judge is still thinking | stays |
| first | the sitting's first check-in | 0, never minimal |

The burst between check-ins is labelled `legit` (≥ 8 legit notes, retention
≥ 0.8), `spam` (retention ≤ 0.4, < 8 legit notes, or one key only) or
`ambiguous`; only `ambiguous` asks the burst judge (off — below), and with it
off an ambiguous burst goes by the rate.

**Keepalive deadline** (R5). One stray note every 80 s would keep the idle
clock from ever running out. Once a check-in has been answered, a check-in also
opens when `keepalive_factor` × the current interval (default 2 × 90 s = 3 min)
has passed since the answer and the evidence so far is *none*. A child who is
really playing never trips it. `keepalive_deadline: false` turns it off.

**Every lesson video starts at the note** (owner, 2026-11-13: "the run reset on
each lesson video"). Nothing carries over — not to the next video, not to a
reopened or rewatched lesson, not across the day. Each sitting reports its
`peakRung` and `minimalCheckIns` (answered minimal check-ins) on every
play/log post; the server keeps them per sitting (max-merge) and on the
sitting-log row, and logs `piano.presence-ladder.top-rung` once when a sitting
reaches rung 4.

**Preschool courses are exempt** (R2): one note forever, a constant interval,
no deadline — minimal check-ins are still counted for the judge and the
teacher. **Guests** get the same note-only ladder: a scale check-in runs as a
challenge, which needs a saved profile, so a guest could never finish one.

**Which scales.** A check-in scale is in the lesson's key when its title names one
("C Position", "G Position", "A Major Scale", "Bb Major Scale" → A#, "key of D");
else the household's `drill_roots`; else C, G, F. The roots rotate per scale asked
in the sitting (the step's `scaleIndex`), so a second check-in with no known key
starts on G, not C again. Rung 4's second scale is the next root, or a fifth up
when the lesson names one key. A minor key or "a Major 7 chord" is not read as a
key. Roots are spelt as the drill knows them (sharps): a flat key becomes its sharp.

**Calibration** (`presenceLadder.calibration.test.mjs`, 2026-11-13; school
cohort of the engagement audit replayed through `replayLadder`, every check-in
answered at once):

| `practice_npm` | engaged + low-touch reaching rung ≥ 3 | reaching rung ≥ 2 | absentee + rhythm-loop (≥ 3 check-ins) reaching rung ≥ 2 | mash with any `practice` interval |
|---|---|---|---|---|
| 2, 3, 4, 5, 6 (identical) | 54 / 177 (30.5 %) | 63 / 177 (35.6 %) | 25 / 25 | 0 |

The plan's bar for engaged sittings (≤ 5 % reaching rung 3) is **not met at any
rate**: those sittings spend a median 87 % of their time in silences of 90 s or
more (median longest gap ≈ 10 min) — the ladder climbs because there was no
playing, which is the approved design ("no playing climbs one rung"), and the
rate cannot move them. `practice_npm` stays 4: every candidate ties, and from 6
up a few practice intervals start reading partial. The test holds 0.31 as a
regression ceiling.

**Owner push** (R9, off): `notify_top_rung: true` pushes the head of household
(HA notify service, as harvester health) once per sitting when it reaches rung 4
— "🎹 {child} — {lesson}" / "Came back only to dismiss N check-ins in a row —
the lesson now asks for two hands-together scales. Since 3:05 PM.", channel
`School needs you`, importance high, tag `piano-presence-{userId}-{day}`.

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
check-ins `N (M scales)`, **Ladder** (`peak note / 1 scale / 2 scales / hands
together / 2 × hands together` plus `· N minimal`; amber with the tooltip
"Climbed past one scale" when the peak is rung 2 or higher, R7), practice-like notes per minute, warm-up given and passed, and the outcome (Counted / Counted after
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
| `presence_ladder.practice_npm` | 4 | legit notes a minute over an interval that count as practice (resets to the note) |
| `presence_ladder.partial_notes` | 8 | legit notes that count as partial playing (steps down one); below it the ladder climbs |
| `presence_ladder.intervals_seconds` | `[90, 90, 75, 60]` | silence before the check-in at each rung; past the end uses the last; each capped at `engagement_timeout_seconds` |
| `presence_ladder.keepalive_deadline` | true | stray notes cannot hold off the next check-in once one was answered |
| `presence_ladder.keepalive_factor` | 2 | the deadline, in intervals since the last answer |
| `presence_ladder.notify_top_rung` | false | push the head of household when a sitting reaches rung 4 |

Anything malformed in `presence_ladder` (a string, a negative, an empty list)
falls back to its default.
| `level_targets` | — | unused since 2026-11-12 (ratings no longer decide credit) |

## Log events (LogsQL)

| Event | Example |
|---|---|
| `piano.lesson-good-faith.judged` (score, model, ms, notes, checkIns, levelProbabilities, inputTokens, preschool, rubricVersion, peakRung, minimalCheckIns) / `fallback` (reason: timeout / error / no-score / no-gateway) | `"piano.lesson-good-faith" AND _time:24h` |
| `piano.lesson-credit.decision` (score, source model/fallback, outcome, drillReps, preschool) — logged when the outcome or score changes | `"piano.lesson-credit.decision" AND _time:24h` |
| `piano.lesson-credit.legacy-client` | `"piano.lesson-credit.legacy-client" AND _time:24h` |
| `piano.video-progress.record` (gains outcome, score) | `"piano.video-progress.record" AND _time:6h` |
| `piano.lesson-expectation.index-only / computed / run-summary` (the index job) | `"piano.lesson-expectation.run-summary" AND _time:7d` |
| `piano.lesson-legit.judged / fallback` | `"piano.lesson-legit" AND _time:24h` |
| `piano.lesson-practice.sitting-start / threshold / snapshot / loop-retracted` | `"piano.lesson-practice.snapshot" AND _time:2h` |
| `piano.lesson-drill.offered / started / rep-passed / completed / left / unavailable` | `"piano.lesson-drill" AND _time:24h` |
| `piano.engagement-gate.open` (reason idle/deadline, step, scales, rung, minimal, evidence) / `rung` (from, to, evidence, legitNotes, ratePerMin, intervalMs) / `interval` (rung, seconds) / `top-rung` (checkIns, minimal; once a sitting) / `keepalive-deadline` (rung, elapsedMs) / `ladder-hold` / `scale-roots` (roots, source, count, scaleIndex, rung) / `scale-passed` / `dismissed` (rung) | `"piano.engagement-gate" AND _time:24h` |
| `piano.presence-ladder.top-rung` (userId, key, sittingId, minimalCheckIns, preschool) / `notify-sent` / `notify-skipped` (reason disabled / no-target) / `notify-failed` | `"piano.presence-ladder" AND _time:7d` |
