# Sentence Ladder

Sentence Ladder names the pedagogy, not the content vendor. Each sentence moves
through repetition, dictation, recording, and interpretation on successive
4am-to-4am study days. The queue is derived from append-only attempt evidence;
it is never stored as mutable queue state.

The canonical program id and endpoint are `sentence-ladder` and
`/api/v1/school/sentence-ladder`. `language` remains a deprecated compatibility
alias for old assignments and clients. Glossika remains only in legitimate
provenance: corpus ids, the recovered dump adapter, and the import CLI.

Every learner endpoint requires a short-lived HMAC study grant issued by a
validated School launch. It is bound to learner, corpus, program purpose, and
expiry and is carried in `X-School-Study-Grant`. Course metadata and prompt
audio remain public; progress, attempts, pacing, history, rollover, and
recordings require the grant. The browser holds it in memory, so a pasted URL
or refresh cannot create authority. Grant-bearing DoNow launches use
`never_ask`, because a pending approval persists its action; the launch must
dispatch immediately or refuse rather than persist the grant.

Writes are server-authoritative. A generic attempt cannot claim recording
credit, and all attempts must match an outstanding entry in the current queue
under the current gate and device capabilities. Recordings validate the same
queue before audio is persisted.

## Enrollment options

`programs[]` enrollment records may declare `units:` — where this course
divides, in the teacher's words:

```yaml
units:
  - { from: 1,    label: Fluency 1 }
  - { from: 1001, label: Fluency 2 }
  - { from: 2001, label: Fluency 3 }
```

**Boundaries only.** Each unit runs until the next one starts and the last runs
to the end of the corpus, so a gap or an overlap is unrepresentable; with
`from`/`to` pairs a typo of `to: 999` drops a sentence with nothing to show
for it. A malformed
list is rejected rather than dropped — a mistyped chapter should stop an
enrollment, not leave a thousand sentences unnamed on a card. Omitting `units:`
leaves the course one unbroken run, which is what every corpus gets until
somebody partitions it.

The boundaries live on the enrollment beside `lessonSize` and `rungs`, which
partition the same corpus already, rather than being derived from the corpus.
They could be derived — the three Glossika Fluency volumes map onto `seq`
exactly — but where a course divides is a decision about a learner, not a
property of the text, and renaming a unit is then one line on an enrollment
instead of an edit to a thousand corpus rows. Units NAME where the learner is;
corpus bands and `scope` SELECT which sentences are studied. They are not the
same knob.

`programs[]` enrollment records may set `dictationMode: copy`. This reveals one
target-script glyph ahead of the learner's matching typed prefix, while the
target-language prompt audio loops after the learner presses Play or starts
typing. It supports script-entry practice before a learner can transcribe from
audio alone. The default (`listen`) remains audio-only dictation. The mode is
resolved by the server and is not learner-controlled.

The frontend requires explicit learner, corpus, and grant. It cancels stale
loads, re-derives after each write, and directs a learner to a capable device
when an enrollment-owned credit rung cannot be completed locally.

On the Portal's locked keypad, a small status LED polls the existing Portal
Keys Bluetooth-presence report every 15 seconds. It recognizes the BK-3001
keyboard by its reported model name (including Android's generic `Bluetooth
5.1 Keyboard` name) and says whether it is connected, off, not paired, or
temporarily unavailable. Pairing stays in the Portal's OS Control Center. A
connected keyboard enters PIN digits, Backspace, and Enter directly into the
keypad. The server gate configuration remains the authority for the keyboard
MAC and for which typing rungs are permitted.

### A dimmed rung says what it actually lacks

`getDay` ships `missingCreditNeeds` beside the existing `missingCreditRungs`: a
map from each blocked rung to the capability that rung is short of, so a card
can name the thing the child is missing. `missingCreditRungs` keeps its plain-
array shape — other readers index it — and the map is additive.

The bug it fixes: every dimmed rung used to carry one hardcoded note, "Needs a
microphone", including `dictation`, which wants a keyboard. The live case is the
tablet a child studies on — it HAS a microphone and an English-only keyboard, so
the rung it blocks is dictation, and the card sent the child off to find a
microphone they were already holding. The ladder domain has always known the
difference (`requirementFor` returns a microphone or a text-input requirement
naming a language, and it is the one place that mapping lives); the frontend was
keeping a second, wrong copy of it.

Two ways the note can still be unanswerable, both handled rather than printed. A
rung the server does not explain at all falls back to "Not available on this
device", because a dimmed rung with no reason is worse than a vague one. And a
text-input requirement whose language could not be resolved arrives as a truthy
object wrapping a null, which without a guard renders, literally, "Needs a null
keyboard" — a broken corpus is our problem to fix and must never become a
sentence a child is asked to read. That guard stays even though a validated
corpus cannot produce the case (`validateCorpus` requires both language codes,
so a bad corpus fails loudly at load), because a truncated or older payload can.

Language codes are turned into words in one place, `languageNames.js`, read by
both the note and the Device panel. They had drifted: the note said "Korean" and
the panel's row for the same object, two taps apart, said "KR".

## What the card says

A ladder card — the printed agenda card and the self-service launch card, which
carry the same facts in the same order — used to print the word "Korean" three
times: `Language › Independent study`, the unit line `■ Korean`, and the title
`Korean`, over an empty poster panel with no bar and no description.

That was never a rendering fault. `projectProgramEntry` already reads `context`
and `progress` off a launcher's `status()` and feeds the breadcrumb, the unit
line, the title, the bars and the poster; the piano course returns both and the
ladder returned neither, so `BuildAgenda` fell to the generic branch whose
course fallback is the literal string "Independent study". Everything the card
wanted was already computed inside the service and thrown away at the
`todayStatus` boundary.

Three slots now carry three different facts, and a fourth line says
what the work is made of:

| Slot | What it says |
|---|---|
| breadcrumb | the corpus's own name — "Glossika Korean" |
| unit line | where the teacher's boundaries put today's frontier, and the day — "Fluency 1 · Day 12", or just "Day 12" when no units are declared |
| title | the work itself — "18 sentences today" |
| description | what the outstanding queue is made of, counted by rung |

The title is **the work, not the day**. A card is an offer, and "Day 12" is an
odometer reading rather than a thing a child can do; the day rides on the unit
line, where a position belongs. This breaks symmetry with cards titled by a
lesson name, accepted deliberately.

**One bar, today's.** `Today` is the number a child can actually move. The
lifetime figure stays off for the reason the service already gives about its own
`sentences started` metric: a bar at 15% that will not visibly move for a year
tells a child they are nowhere.

**Artwork keys to the corpus**, not to the program:
`program:sentence-ladder:<corpusId>`, the instance form of the `program:`
course-id scheme, served from
`<media>/school/programs/<programId>/<instanceId>/poster.jpg`. One program with
one picture would put a Korean cover on a Spanish card. See
"Where artwork comes from" in [the School README](./README.md).

## School lifecycle

On a locked Portal, the learner enters through the anonymous self-service
keypad. Resolving the code claims the learner; the program action carries the
corpus and an in-memory study grant into the ordinary School launch path. The
runner then offers only the repetition, dictation, recording, and
interpretation work that is both due and supported by that device.

Each accepted step appends evidence and the runner re-fetches the derived day.
It emits one structured `school.language.program.progress` diagnostic for each
observable `(day, done, total, blocked)` state and shows the same saved-step
progress to the learner. The payload also identifies an `empty` queue so a
no-work day is distinguishable from an ordinary completed set. A locked runner
says `Leave for now` while work is outstanding or blocked by device capability;
`Done` appears only after the full credit chain is complete, or when no work is
due at all.

The runner needs an identity that the School **roster** knows: every mount is
gated on the claimed learner being a roster member, because that is where a
learner's name, avatar and records come from. Two paths follow from that.
An identity that lapses mid-session (the ten-minute idle gap) ends the session
and returns the panel to the keypad — the ladder carries its own exit, so the
locked panel draws no `Done` over it, and a lapse that only dropped the study
grant would leave the panel showing nothing at all. And the code-free door
(`/school/go/<learner>/<program>`, a grown-up's browser only) refuses a learner
the roster does not know, by name, rather than opening a section that can
never paint.

Completing an enrollment-owned day publishes
`school.language.day-complete`. `CloseLanguageDay` settles the deterministic
School program session through the standard outcome/reward path, which in turn
publishes `school.session.outcome-recorded`; `SchoolCompletionBridge`
recomputes and emits `school.completion.state-observed`. Canonical
`sentence-ladder` and legacy `language` identifiers are treated as equivalent
at this settlement boundary so migrated assignments cannot lose credit or a
configured reward.

## The recording rung

One gesture runs the rung until the learner has spoken. A tap on the square
Record tile — or Space or Enter — plays the target sentence, then a short
**ding**, and the microphone goes live the instant the ding ends. Nothing on
screen says "listen" or "now"; the ding is the cue to speak. A second tap or
Space stops the take, and the take plays straight back — there is no inline
player and nothing to press to hear it. Only then do the two choices appear:
**Again** (Backspace) and **Keep** (Space or Enter). Again re-sounds the ding
and reopens the microphone; it does not replay the sentence — hearing the
prompt again is the Repetition rung's job, and a retry slower than the first
attempt is backwards. The rung takes keyboard focus on arrival, so the keys
work without a tap first; a focused control keeps its own keys, so a tabbed-to
button's Enter still presses that button.

The stage holds three things and no more: the sentence, the **voice band**, and
one square tile whose picture and colour change with the phase — green Record,
a quiet speaker while something sounds, red Stop while the mic is live, then
Again beside Keep. The voice band is the learner's own sound drawn as it
happens on a canvas the width of the stage: recent levels scroll in from the
right while recording, loud tall and silence a hairline, so it is also the
volume meter. On Stop the whole take is decoded in the browser and fitted to
the band, and a playhead colours it in as it plays back. Nothing is rendered
server-side and nothing is scored. Two seconds under the noise floor with
nothing yet heard puts one line in words on the stage: *Nothing's coming
through — is the microphone on?* Chrome's WebView on the Portal is fine with
this — it is one canvas repaint at ~30 fps, not CSS animation.

The ding is a household choice, never a guessed file. `school.yml` names it by
role:

```yaml
sentence_ladder:
  cues:
    record: ding.mp3     # under media/school/_ux/
```

The day payload lists which roles exist (`cues: ['record']`) so the client
builds its sequence from facts rather than probing; a role that is unset is
simply silent, and the rung still runs. The file is served public, like prompt
audio, at `/api/v1/school/sentence-ladder/cue/{role}` — a cue is a sound, not
learner evidence. Like the rest of the school config this is boot-cached: a
changed file name needs a restart.

## Reading a session back

Every ladder event on both sides of the wire carries a **run id** on
`context.runId`. The program shell mints one per run; `languageApi.js` sends it
on every request as `X-School-Run-Id`; the router validates its shape and
threads it into the service's log calls. So one query returns a single child's
whole sitting, browser and backend interleaved in order:

```
context.runId:"<id>" AND _time:24h
```

A malformed or absent header degrades to `null` — a child mid-lesson is never
failed over a diagnostic.

The network layer says something on every outcome. `school.language.api.ok`
(debug) carries path, method, status and duration; `school.language.api.rejected`
(warn) a non-ok response; `school.language.api.failed` (error) a request that
threw, with `error` and `name`, so a dropped connection is no longer
indistinguishable from a genuine status 0. A cancelled in-flight request is
`school.language.api.aborted` at debug, because unmounting a rung is routine.
**Request bodies and response payloads are never logged** — they are the
child's own sentences and their typed answers. Paths, methods, statuses,
durations and byte counts only.

Backend events worth knowing: `school.language.day-read` (info — day, queue
size, device chain, credit chain, blocked rungs, gate level) is the first line
to read when a child says the ladder gave them the wrong work;
`school.language.day-complete` (info) is emitted under the same name as the bus
topic it accompanies; `school.language.launcher.launch` (info) records a
dispatch decision, its surface, and whether a study grant was issued, while
`school.language.launcher.status` (debug) records what the agenda was told.

The surface says what the child did, not only what the server was asked for.
`school.language.program.day-loading` (debug) records that a day was ASKED for,
with the capabilities it asked with, so a request that never returns is
distinguishable from a program nobody opened; its `day-loaded` (info) partner
carries the chain, the blocked rungs and the round trip in milliseconds.
`school.language.rung.landed` (**info** — the one rung event the store keeps,
because everything at debug is dropped at ingest) says which rung the learner was put on
**and why** — `first`, `resume` (work was already done today) or `rung-cleared`
— and `rung.selected` when they chose one themselves.
`school.language.program.tab` (debug) records a move to the Review shelf, which
is what a session that "never gave me any sentences" usually is.

The refusals and the dead ends have their own lines, because from the child's
side they are indistinguishable from a broken button:
`school.language.capability.rung-blocked` (info) names each dimmed rung and the
capability the server said it lacked (`microphone`, `textInput:KR`), once per
day rather than once per render; `school.language.pacing.roll-refused` and
`pacing.change-failed` (both warn) record a decline and a failed change;
`school.language.rung.practice` (debug) records the extra-practice banner —
the same sentence arriving three times in a sitting is the most-reported
"it repeated itself".

Repetition's choice is three separate facts: `rung.held` (the sentence stayed),
`rung.replayed` (they asked to hear it again — not a second climb, and never
logged as `complete`), `rung.advanced` (they moved on). A session of
`complete`s alone cannot tell a child who listened twice from one being carried
along, which is the whole difference the hold introduced.

A take leaves `capture.start`, `capture.stop` (with its byte count and whether
the band ever heard a voice) and, on a retry, `capture.retake`, all at info; a
denied microphone is `capture.denied` at error.

A capability override is recorded once, by `useCapabilities`, as
`school.language.capability.overridden` (info) carrying both the new state and
what it changed `from`. The Device sheet and the Recording rung's
microphone-off-after-denial both pass through there, so neither carries
telemetry of its own; `PacingControl` likewise logs nothing, because a limit is
only really changed once the server has taken it and only the shell knows
whether it did.

Per-sentence and per-request events sit at `debug`. Load the surface with
`?debug=1` to see them: the level is read at mount and restored on unmount, so
no panel stays chatty by accident. **They reach the console, not the store** —
the backend drops `debug` at ingest in production, so a raised level is worth a
trace at the device and nothing to a query run from elsewhere. The store keeps
`info` and above, which is why the one rung event a supporter needs first,
`rung.landed`, is the one that is not at debug. The store is shared with every
other household subsystem and capped.
