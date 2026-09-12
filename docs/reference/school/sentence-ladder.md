# Sentence Ladder

Sentence Ladder is School's program for acquiring a language through whole
sentences. A learner meets each sentence four times, in four different modes,
on four different study days: they hear and shadow it, they write it from
dictation, they record themselves saying it, and they interpret it back into
their own language. Nothing is graded and nothing is gated; a rung is cleared
by doing it, and the spacing between rungs is the method.

The program is a framework. The **content** — thousands of natural sentences
in two languages, with native audio for each — comes from a supplier along
with the training philosophy this program implements; the framework itself
names no vendor and no language. A second language pair is a corpus file and
an enrollment. The supplier's name survives only as provenance: in the live
corpus id, the adapter that reads its archived dump, and the import CLI under
`cli/`.

The canonical program id and endpoint are `sentence-ladder` and
`/api/v1/school/sentence-ladder`. `language` is a deprecated alias kept for old
assignments and clients.

---

## 1. The method

The training material is a **mass-sentence** course: roughly a thousand
sentences per volume, three volumes, numbered straight through so sentence
2001 opens the third book. Each sentence is given in the learner's language
and the target language, with a native recording of each. The sentences are
plain daily-life statements — *The weather's nice today. I'm not rich. This
bag's heavy.* — chosen so that, across a volume, every tense, aspect, voice and
common pattern appears many times without a grammar lesson ever being taught.

The source's own reasoning for working in whole sentences, which the ladder
keeps:

- **Pronunciation lives in the sentence.** Sounds and intonation change when
  words run together; shadowing a native speaker saying a whole sentence
  teaches that, and stringing words together does not.
- **Syntax is heard, not explained.** Word order differs from the learner's
  language, and repeated exposure to complete ideas accustoms the ear to it.
- **Words only mean something in company.** A word's meaning is its
  collocations; a sentence carries them, a word list strips them.
- **Grammar is absorbed, not memorised.** Morphology comes from hearing a
  native form, repeating it, and meeting it again until it is innate. Most
  native speakers cannot explain their own grammar either.
- **Translation is an anchor, not a crutch.** The learner's own language is
  given for every sentence on purpose: it makes the input intelligible, it
  anchors the memory, and it lets patterns show. Being able to interpret a
  sentence back is the test of having actually understood it. The bridge is
  abandoned later, when it is no longer needed.

The source prescribes four training steps for each batch of sentences, and
they are the four rungs of the ladder in the same order:

| Step | What the learner does |
|---|---|
| Repeat | listen, then say the sentence with the speaker's speed and intonation |
| Dictation | hear the target sentence and write it out, then check |
| Recording | record the sentence from what is heard, not from the text; play it back and hunt for the differences |
| Interpretation | hear the source sentence and produce the target sentence aloud in the gap |

Its rules about pacing and memory are the rules the scheduler enforces:

- **One practice session separated by one sleep** gives the best result. A
  memory not recalled the next day weakens; after three sleeps it is gone.
  Actively using a form three days running makes it stay.
- **Spread the steps, stagger the batches.** Record the same sentences over
  several days, staggered with new ones, rather than doing all four steps in
  one sitting.
- **Set a daily number and keep it.** The source suggests 20 to 100 sentences
  a day for intensive study and twenty minutes a day for the relaxed path,
  where each sentence returns more than a dozen times over five days.
- **Skip and keep going.** A sentence that will not come is left for the
  second pass; stopping to fix it costs more than the miss.

---

## 2. The ladder

The ladder is four rungs in a fixed order. Rungs are defined over **roles**,
not languages: `source` is the language the learner already has, `target` is
the one being acquired, and the corpus binds each role to a code. A course
running the other direction — a Korean speaker acquiring English — is a
different corpus, not different code.

| Rung | Prompt (audio, in order) | Response | Needs |
|---|---|---|---|
| `repetition` | source, target, target | none — sat through | nothing |
| `dictation` | target | target text | a keyboard for the target script |
| `recording` | target | target audio | a microphone |
| `interpretation` | target | source text | a keyboard for the source script |

Repetition plays the target twice on purpose. The first hearing is
recognition; the pause before the second is where the learner speaks; the
second hearing is the correction. That pause is the shadowing mechanic itself,
and the rung is a listening exercise without it.

Text input is reported **per language**, not as one keyboard flag, because the
two typing rungs are not interchangeable: collapsing both to "keyboard" would
offer a child a rung they physically cannot enter. What separates them is no
longer the hardware. School composes the target script itself (`School/ime/`),
so a keyboard — any keyboard — satisfies the source language *and* every target
the in-page IME can compose. A target with no composer is still withheld.

### Which leaves one question: is there a keyboard at all

The web platform cannot answer it. There is no "is a keyboard attached" API,
and the signal that stood in for one — `matchMedia('(pointer: fine)')` — asks
whether there is a **mouse**. On a desktop the two arrive together. On the
Portal, a touch panel with a Korean/English Bluetooth keyboard bonded to it and
no mouse at all, they do not: the panel the in-page IME was written for was the
one panel that could never reach it, and every session there ran with
`textInput: []` while the keyboard sat connected in front of the child, who was
told to continue on another device.

`lib/hardwareKeyboard.js` answers it three ways and takes any yes:

| Signal | Knows | Blind to |
|---|---|---|
| a fine pointer | a desktop, which has a keyboard | every keyboard on a touch device |
| the fleet registry — `devices.yml` `bluetooth_input.keyboards`, served for the asking device by `GET /api/v1/device/self/input` | a declared keyboard, at first paint | a device with no fleet name; a declaration gone stale |
| a keypress — a letter, digit or punctuation `code`, which neither an Android IME (`keyCode 229`) nor a TV remote's D-pad can send | any keyboard anywhere, with nothing configured | anything before the child touches a key |

A yes is remembered for the browser profile, so the late signals are late only
once. **There is deliberately no "no":** nothing can distinguish a device with
no keyboard from a child who has not typed yet, and guessing between those is
what produced the Portal failure. The conservative floor therefore stands — no
evidence still means `textInput: []` and repetition alone — and a grown-up's
declaration in the Device sheet continues to outrank all three.

**Two chains.** The *device chain* is the ladder as it exists on this panel: a
rung whose input is absent is removed rather than left to stall, and sentences
graduate across the gap. The first rung needs nothing, so the chain is never
empty and a bare touch panel can always run repetition. The *credit chain* is
the enrollment's list of rungs and is what decides whether a day is complete;
a device never lowers the bar for credit. When a device cannot serve a credit
rung, the surface says so on that rung, names the thing it lacks ("Needs a
Korean keyboard", "Needs a microphone — on another device"), and the day is
finished elsewhere. A rung with no reason falls back to "Not available on this
device", and a requirement whose language cannot be named is never printed
as "Needs a null keyboard".

---

## 3. The study day

**A study day is not a calendar day.** It runs from 4am to 4am local
(`boundaryHour`), so a session that runs past midnight belongs to the evening
it started in, and someone drilling at 1am has not earned tomorrow's sentences.

**The queue is derived, never stored.** Every attempt is appended to an
evidence log; the day's queue is rebuilt from that log on every read. There is
no queue table to lose or desynchronise, and the queue can never claim
progress the log does not show. A day's work is:

1. up to `dailyLimit` brand-new sentences, entering at the first rung;
2. every sentence that cleared rung *k* on an **earlier** day and has not yet
   cleared rung *k+1*;
3. **practice**, only while (2) cannot fill the day.

The "earlier day" test is what enforces one rung per day. Without it a sentence
shadowed this morning would reappear as dictation this afternoon, and the
whole ladder would collapse into one sitting.

**The cold start.** On day one nothing has cleared anything, so the day would
be a quarter of its intended size and only reach full volume on day four. A
short day is topped up by walking today's own new set up the remaining rungs
as practice:

```
              CREDITED                   PRACTICE
   Day 1  s1@r1                      s1@r2 r3 r4
   Day 2  s2@r1 s1@r2                s2@r2 r3
   Day 3  s3@r1 s2@r2 s1@r3          s3@r2
   Day 4  s4@r1 s3@r2 s2@r3 s1@r4        --      <- steady
```

Practice never advances a sentence: its events are written with `practice:
true` and ignored when deciding what cleared, so a sentence still climbs
exactly one rung a day for credit. The top-up turns itself off once credited
work fills the day, and comes back by itself if a learner drains the pipeline
by skipping a week. The surface says "Extra practice — this one doesn't move
up yet" over such an entry, because the same sentence arriving at three rungs
in one sitting reads as a bug otherwise.

**Rollover** needs two things: the queue is complete, and the boundary has
passed. Rolling with work outstanding would skip a rung without telling the
learner; rolling before the boundary would hand out tomorrow's sentences
today and let a keen learner burn the corpus in an afternoon. A refused roll
says why. An empty queue counts as complete.

**Retirement.** A sentence that has cleared every rung of the chain is retired.
Evidence recorded on a better-equipped device never creates phantom work on a
lesser one: a sentence whose last cleared rung does not exist on this device
is retired rather than resurrected at a guessed position.

**Pacing.** New sentences per day default to 5 and are clamped to 1–100. With
an enrollment, the figure is `lessonSize ÷ rungs` — a lesson of twenty steps
over four rungs admits five new sentences a day, and by the fourth day that is
five sentences at each of four rungs. Without an enrollment, the learner's own
pacing control sets it. A course goes `idle` after fourteen days without
activity and `complete` when every playable sentence is retired.

---

## 4. Content

A corpus is one YAML file, validated strictly on load. A file with holes fails
whole rather than producing a ladder that silently skips sentences.

```yaml
# data/content/school/language/{corpusId}.yml
id: korean-fluency
label: Korean
languages: { source: EN, target: KR }   # role -> code; must differ
audio_base: school/language/korean-fluency
bands:                                   # optional; SELECT material
  - { id: volume-1, range: [1, 1000] }
  - { id: volume-2, range: [1001, 2000] }
sentences:
  - seq: 1
    text: { EN: "The weather's nice today.", KR: "오늘 날씨가 좋아요." }
  - seq: 2
    text: { EN: "I'm not rich.", KR: "저는 부자가 아니예요." }
    audio: false                         # exists in the corpus, never recorded
```

Text is keyed **by language code**, so every pair has the identical shape and
the domain reads target text as `text[languages.target]`. `seq` is a positive
integer, unique within the corpus, and is the sentence's identity everywhere:
in the log, in audio file names, in units and bands. A sentence marked `audio:
false` is kept in the file for the record and excluded from the playable set.

Audio is one file per sentence per language:

```
media/school/language/{corpusId}/{NNNN}-{LANG}.mp3      # 0001-KR.mp3, 0001-EN.mp3
```

The import CLI under `cli/` lands a supplier's archive — sentence table,
sentence audio, and any surviving learner recordings — in these shapes, scoped
by corpus id so two courses never collide.

Optional UI cues (the recording rung's ding) are served from `/cue/:name`. The
day payload lists which cues exist, so a rung builds its sound sequence once
from facts rather than probing per sentence; a household with no cue
configured gets a rung without a ding, not a broken one.

---

## 5. Enrollment — the teacher's policy

A learner's `programs[]` enrollment record carries the policy for one corpus.
It is validated against that corpus and rejected whole on any error; a
mistyped chapter should stop an enrollment, not leave a thousand sentences
quietly unnamed.

```yaml
programId: sentence-ladder
corpusId: korean-fluency
lessonSize: 20                 # steps per day; ÷ rungs = new sentences per day
rungs: [repetition, dictation, recording, interpretation]   # the credit chain
units:                         # optional; NAME where the learner is
  - { from: 1,    label: Fluency 1 }
  - { from: 1001, label: Fluency 2 }
  - { from: 2001, label: Fluency 3 }
scope: [volume-1, { range: [1, 300] }]   # optional; SELECT what is studied
dictationMode: listen          # or copy
reward: { amount: 2 }          # optional coins on day-complete; never needs signoff
```

| Key | Meaning |
|---|---|
| `lessonSize` | required; steps per study day |
| `rungs` | a non-empty subset of the four, in ladder order; defaults to all four |
| `units` | boundaries only: each unit runs until the next starts, the last to the end. A gap or overlap cannot be written down. Starts must be unique |
| `scope` | band ids from the corpus, or bounded `range` pairs; the sentences admitted as new |
| `dictationMode` | `listen` (default): audio-only dictation. `copy`: the target script is revealed one glyph ahead of the learner's matching prefix, for script-entry practice before they can transcribe by ear |
| `reward` | a coin amount settled through the standard program outcome path |

**Units name; bands and scope select.** They are not the same knob. A unit
belongs to the enrollment and changes what a card says; a band belongs to the
corpus and, through `scope`, changes which sentences a child sees. A sentence
can be in no unit and still be studied, or in a unit and out of scope. Merging
them would make renaming a chapter change a child's material. Units live on
the enrollment rather than being derived from the corpus because where a
course divides is a decision about a learner, not a property of the text.

---

## 6. The learner's surface

The program renders inside the School shell, which already draws the back
control and the course title. Its header carries the day and one statement of
progress ("6 of 20 steps"), and — off the locked kiosk — the pacing control
and the Device sheet.

**The ladder** is drawn down the left as the order things happen in, each rung
wearing one pip per sentence, filled as done, the rung in hand lit. It is
navigation and progress in one object. A rung this device cannot climb is
drawn dimmed with its reason. The **Review** shelf sits below it; it is not a
rung. The learner lands on the first rung with work outstanding, and moves
freely between rungs.

### Repetition

Plays source → target → (pause) → target. Nothing is submitted: the learner
says the sentence in the pause, and clearing the rung means having sat through
it. A self-report button would only add a lie the learner can tell.

A finished sentence **stays**. The rung holds it and offers *Play again* or
*Next*; the sentence a learner moves on to plays because they asked for it,
and the first sentence of a rung waits to be pressed. A replay is not a second
climb and is never credited twice. The first version ran the set as a conveyor
belt — one tap, then a sentence every few seconds — and the one thing a child
could not do was ask for the sentence they had just heard one more time.

### Dictation and interpretation

Dictation hides the sentence — recalling it is the task. Interpretation shows
it — rendering meaning is the task. The prompt plays once on arrival and again
on Tab, on the Play control, or after a long enough silence to mean "stuck";
it does not loop, and a Stop sits beside Play for as long as anything sounds.
In `copy` mode the target script is revealed one glyph ahead of what has been
typed correctly, so a child learning the script can practise entering it
before they can hear it.

**A hint is partial. A reveal is the answer.** The two rungs need different
help, and the difference is not a matter of degree:

| Rung | What is withheld | The affordance | What it costs |
|---|---|---|---|
| dictation | the Korean | **Peek** (F1, or the button) — shows the whole sentence, with the learner's own column marked; the next keystroke takes it away | nothing. It is still theirs to type, in Hangul, from memory of what they just read — which is the skill |
| interpretation | the English | **Reveal** ("Show answer") — the English text, and the English clip with it | the exercise. The field goes, and the attempt is recorded as a reveal |

On interpretation the English text IS the answer, so showing it is not a hint:
it hands over the whole response and leaves transcription. Playing the English
clip hands over exactly the same thing. Both are a skip, and calling either one
a hint would let the record say a child interpreted 4,143 sentences when they
pressed a button 4,143 times. So the reveal shows the text and plays the clip
together — one surrender, not two — and it is one-way: there is no un-reveal,
because reading the answer, hiding it, and typing it back in is precisely the
record this split exists to protect.

**The partial half is not built, and that is deliberate.** The hint for
interpretation is one word's meaning — a gloss — and glosses are tabled into
`docs/_wip/plans/2026-09-11-sentence-ladder-word-glosses.md`. Until they exist
there is no Hint control on this rung, not even a disabled one: a button with
nothing to say is a dead button, and a child who presses a dead button decides
the screen is broken. When glosses land, Hint joins Reveal — it does not
replace it, and it must not be recorded as one.

A reveal **clears the rung like any other attempt** — accuracy gates nothing
here and neither does this. What changes is only what the evidence says.

An answer is compared to the expected text after trimming, collapsing
whitespace and casefolding — nothing cleverer, so a near miss is exactly what
the learner should see in their diff. **Accuracy is recorded and gates
nothing.** A wrong dictation still graduates the sentence; the diff waits on
the Review shelf. School's rule is "no second gate anywhere", and this program
keeps it.

**`copy` mode's input gate is not a second gate.** The target is on screen and
the child is tracing it, so the IME refuses a keystroke that makes the syllable
in flight stop being a viable prefix of the syllable being traced, and settles
each syllable the moment it is complete — 오 locks as its ㅗ lands, so the ㄴ of
오늘 starts 늘 instead of flashing 온 (`School/ime/syllable.js`). That is an
input constraint, the way a worksheet prints a shape to trace over, and it
changes nothing about grading: accuracy is still recorded and still gates
nothing, and a refused keystroke is never written down at all.

**It is `copy` only, and that restraint is the point.** In `listen` the target
is hidden, and the program knows it just the same — but a gate there would
repair a child who misheard 오늘 as 온... into the right answer without anyone
seeing it happen, and the record would then say they heard it correctly. That
is a session that looks like it is working perfectly while measuring nothing.
`listen` keeps the plain automaton; the gate is unreachable unless a rung hands
the composer an oracle, and only `copy` does.

The typing field asks for the in-page IME in the right script: the target for
dictation, the source for interpretation, following focus with no keypress.

**Interpretation can be answered by speaking.** A learner who understands a
sentence perfectly can still be defeated by an English keyboard, and the record
would then measure typing rather than comprehension — which is the one thing
this rung exists to measure. So a *Speak* control sits beside Submit: the mic
opens, the take goes for recognition, and the transcript lands **in the field,
unsubmitted**. Sent straight off it would make every mistranscription the
learner's own mistake, marked down for a word they said correctly and never
told why; landing it in the field costs one tap and makes the machine's guess
something they can see and correct.

- **The response is still text.** Voice is an *input method*, not a different
  kind of answer, so `entry.response` is unchanged and the attempt carries one
  extra field, `method: typed | spoken`. A revealed sentence has no method,
  because nobody answered it.
- **The transcript replaces the field.** What is usually sitting there is an
  abandoned half-attempt, and splicing a spoken sentence onto it makes a
  sentence nobody said. The control says "Speak **instead**" once there is text
  to lose. An edit of a transcript is still `spoken`; a transcript deleted to
  nothing and retyped is `typed`.
- **Not on dictation.** Entering the Korean script *is* that rung's task; a
  learner who could say the sentence instead would be handing in a recording of
  the one skill being drilled.
- **Three visible states**, because the round trip is a model call: *Speak*
  (quiet), a red *Stop* while the mic is open, and "Writing it down…" in the
  accent while the transcript is in flight. A control that looked the same for
  four seconds reads as broken to a child at a panel with no pointer. The mic
  closes itself after 20s.
- **Every failure is survivable and none is a dead end**, because the field
  never goes away. No microphone on the device, or no AI gateway on the server
  (`day.voiceAnswer: false`) — the control is *not drawn at all*, on the same
  reasoning that keeps Hint off this rung: a button that cannot work is a dead
  button. A mic that will not open, a failed request, or a transcript with
  nothing in it — the control *stays and explains*, because it was honestly
  offered and a second try may yet work.

**⚠ Nothing derived from the expected answer reaches the recogniser, and the
route is built so it cannot.** A Whisper prompt biases recognition: give it the
English sentence and the model hears that sentence whatever the child said, and
the rung measures nothing while looking perfect. `POST
/users/:userId/transcribe` never touches the corpus — the study grant is
checked for *scope* and loads nothing, `seq` is taken for the log line only, and
the context handed to the transcription profile is exactly two fields resolved
from closed sets (a language name from an allowlist, a register constant). The
profile (`1_adapters/ai/transcriptionProfiles/language.mjs`) also repairs
nothing: its cleanup pass may drop filler and collapse a stutter and must
otherwise return the words as heard, wrong grammar and all.

### Recording

One gesture runs the rung until the learner has spoken:

```
tap / Space ─▶ the sentence sounds ─▶ the ding ─▶ the mic is live
tap / Space ─▶ the take plays straight back ─▶ Keep it, or Record again
```

The learner records from what they heard, not from the text, which is why the
prompt sounds first. While the mic is live a voice band draws the level and
notices silence, so a take with nothing on it is offered *Record again* rather
than kept. On Stop the whole take is decoded and fitted to the band, and it
plays straight back — the source's instruction is to hunt for the differences
between the native recording and your own. The mic is released between takes
because a shared kiosk may need it. A denied microphone is recorded and the
rung steps aside rather than looping on a permission it will not get.

### Hands-free

Every step answers the keyboard, so a child with the panel's keyboard in their
lap never has to reach for the glass. The keys are the same on every rung:
**Space or Enter is "go"**, **Backspace is "again"**, and each rung takes
keyboard focus on arrival so a key pressed straight after the tap that opened
it acts on the rung rather than re-pressing that button.

| Where | Space / Enter | Backspace | Arrows |
|---|---|---|---|
| repetition | play; stop while sounding; Next once held | play again | ← play again · → Next |
| dictation, interpretation | play, until the first letter is typed (then Space is a space); Enter submits; Tab replays | edits the answer | edit the answer |
| recording | start; stop the take; keep it | record again | — |
| the shell | on the day-complete panel: Done, or Start the next day | — | ↑ ↓ walk the rungs and the Review shelf |

None of these fire while a button or field has focus; a focused control keeps
its own keys. Shortcut hints are shown only where a hardware keyboard is
present — instructions for keys a touch panel does not have are worse than
none.

### Sound

Every sound the program makes — the prompt, a recorded take, the Review
shelf's player — follows the screen's software master volume, the one a
panel's volume keys step. A bare audio element plays at full gain whatever the
keys say, which is how the program's first morning went; nothing here creates
one without binding it. Playback is always started by a gesture, which
satisfies the browser's autoplay gate; if play is still refused, the rung says
"Audio was blocked — tap Play again" and returns to a control the learner can
use. The **next** sentence's audio is fetched while the current one plays, so
the gap between sentences never reads as the app hanging.

### Review

The Review shelf is the study history, newest day first. A dictation shows
what was typed against what was expected as a character diff; a recording
plays back in the learner's own voice. Neither ever gated anything — the value
is seeing it.

### Device and pacing

The Device sheet lets a learner override what the panel detected — a
microphone that is present but was denied, a language the keyboard can type —
and the override is logged with what it changed from. Pacing is one control:
new sentences per day. Both are hidden on a locked kiosk session, where the
enrollment is the policy.

---

## 7. What the card says

The agenda card and the self-service launch card carry the same facts in the
same order:

| Slot | What it says |
|---|---|
| breadcrumb | the corpus's own label |
| unit line | the enrollment unit the frontier sits in, and the day — "Fluency 1 · Day 12", or "Day 12" with no units declared |
| title | the work — "5 sentences today" |
| description | new against review, steps left, and what those steps are by rung — "5 new · 18 steps left — 3 repetition, 5 dictation, 5 recording, 5 interpretation" |

The title **counts sentences, not steps**. The queue is steps — one sentence
at one rung — and a day-one set of five sentences is twenty of them; counted
as steps the title read "18 sentences today" to a child holding five. A
sentence is *new* when it entered the ladder today and *review* when it is
back for a later rung; the step count lives in the description, where it says
how long the sitting is rather than how much there is to learn.

The title is **the work, not the day**: a card is an offer, and a day number is
an odometer reading. The one bar is today's — the number a child can move. The
lifetime figure (sentences started over the corpus) is kept for the teacher's
report and off the child's card: a bar at 15% that will not visibly move for a
year tells a child they are nowhere.

Artwork keys to the corpus, not the program —
`program:sentence-ladder:<corpusId>`, served from
`<media>/school/programs/sentence-ladder/<corpusId>/poster.jpg` — because one
program with one picture would put a Korean cover on a Spanish card.

---

## 8. Lifecycle, identity and credit

Every learner endpoint requires a short-lived HMAC **study grant** issued by a
validated School launch. It is bound to learner, corpus, program purpose and
expiry, travels in `X-School-Study-Grant`, and is held by the browser in
memory only, so a pasted URL or a refresh cannot create authority. Course
metadata and prompt audio are public; progress, attempts, pacing, history,
rollover and recordings need the grant. Grant-bearing DoNow launches use
`never_ask`: a pending approval would persist its action, and the grant with
it.

**Writes are server-authoritative.** Every attempt must match an outstanding
entry in the current queue under the current gate and device capabilities; a
generic attempt cannot claim recording credit, and a recording is validated
against the same queue before any audio is persisted. A save that fails is
surfaced as "not saved", never swallowed — an unrecorded attempt that looks
recorded is how a learner loses a session's work without knowing.

On the locked Portal kiosk the session belongs to the self-service keypad. An
identity that lapses mid-session (the ten-minute idle gap) ends the session
and returns the panel to the keypad; the program carries its own honest
*Leave for now* while a day is open and one *Done* once it is complete. A
keypad status light reports whether the panel's Bluetooth keyboard is
connected, off, or unpaired; pairing stays in the panel's own controls.

Completing an enrollment-owned day publishes `school.language.day-complete`.
The standard program outcome path settles the session — credit toward the
day's School progress and the enrollment's reward, if any — and the household
completion state is recomputed. `sentence-ladder` and legacy `language`
identifiers are equivalent at this boundary so migrated assignments cannot
lose credit.

The settlement resolves the assignment from the learner plan's `programs:`
list — the enrollment IS the assignment. It does not require an authored
curriculum unit, and none exists: an early design routed the ladder through a
`school.unit` carrying a `programInstance`, that unit was never written, and
for months the settlement's assigned-check looked there while its reward
lookup, in the same method, read the enrollment correctly. Every completed day
took the `unassigned` branch. Where a household has authored a matching unit
its id still names the session; otherwise the session takes the same synthetic
`<programId>:<corpusId>` id the plan entry carries, so the session and the
agenda row agree.

Both guards on the publish are audible. If the day completes but the
enrollment is missing, or the realtime port is not wired, the service warns
once per process with `school.language.day-complete-suppressed` naming which
guard failed (`no-enrollment` or `no-realtime`). Those two look identical from
outside, and a silent return is how a mis-wired bridge stayed invisible.

A teacher can run a **guest preview** of any corpus: a fresh day derived
without a learner, a grant, or a saved attempt, so the ladder can be
experienced without manufacturing evidence.

---

## 9. Evidence and data

```
data/content/school/language/{corpusId}.yml                        corpus
data/users/{userId}/apps/school/language/{corpusId}/progress.yml   day, pacing, last activity
data/users/{userId}/apps/school/language/{corpusId}/log/{YYYY-MM-DD}.yml   append-only attempts
media/school/language/{corpusId}/{NNNN}-{LANG}.mp3                  prompt audio
media/school/language/{corpusId}/recordings/{userId}/{NNNN}-{LANG}.webm   the learner's takes
```

An attempt is one row in the day's log:

```yaml
- at: 2026-09-10T13:38:13Z
  day: 1
  seq: 1
  rung: recording
  attributedTo: test-learner
  practice: false          # true for a cold-start top-up pass
  given: 오늘 날씨가 좋아요   # text responses only
  accuracy: 0.92           # text responses only; recorded, never gating
  method: typed            # text responses only; typed | spoken
```

`method` says how the answer was produced — typed, or spoken and transcribed
into the field before the learner submitted it. It is **absent** on rows written
before the question was asked, and on any client that does not send it: a
guessed method in an append-only log outlives whoever guessed it. It changes
nothing about scoring or credit.

A **revealed** attempt is the same row with one field instead of two:

```yaml
- at: 2026-09-11T13:41:02Z
  day: 1
  seq: 1
  rung: interpretation
  attributedTo: test-learner
  revealed: true           # the learner asked to be shown the answer
  expected: The weather's nice today.
  language: EN
```

It carries **no `given`** — the learner produced nothing, and the text they
were shown must never be written down as theirs — and **no `accuracy` at all**,
not a zero. A zero would be a score for a sentence nobody assessed, and
scoring the shown text against itself would be the 1.0 that says a child
understood a sentence they pressed a button on. An absent field is the honest
shape, and every reader already filters on `typeof accuracy`. The course card's
typing-accuracy figure therefore excludes reveals by construction, and counts
them separately as **Answers shown** so a grown-up can see how much of the work
was handed over.

The log is the only source of truth for where a sentence is. `progress.yml`
holds what cannot be derived: the current study day, the pacing limit, and the
last activity time. Because the queue is rebuilt from evidence, a lost write
is a missing attempt, never a corrupted position; the same log means the same
thing on day one and day four hundred.

---

## 10. API

All under `/api/v1/school/sentence-ladder`. Learner routes carry
`X-School-Study-Grant`; every request may carry `X-School-Run-Id`.

| Method | Route | What |
|---|---|---|
| GET | `/courses` | valid corpora with their role bindings; an invalid corpus is omitted, not served broken |
| GET | `/preview/:corpusId/day` | a non-recording guest day for teachers |
| GET | `/users/:userId/day` | today's queue for this device's capabilities, the credit chain, blocked rungs and their needs, cues, `voiceAnswer`, rollover state |
| POST | `/users/:userId/log` | one attempt — `seq`, `rung`, and either `given` (text rungs, optionally with `method: typed \| spoken`) or `revealed: true` (the learner asked to be shown the answer; never both) |
| POST | `/users/:userId/recording` | raw audio for one outstanding recording step |
| POST | `/users/:userId/transcribe` | raw audio of a spoken answer → `{ transcript, empty }`. Stores nothing and reads no corpus. 503 where the household has no AI gateway — the day says `voiceAnswer: false` in advance so no client has to find out this way |
| PUT | `/users/:userId/pacing` | new sentences per day |
| POST | `/users/:userId/roll` | ask for the next study day; refused with a reason when not earned |
| GET | `/users/:userId/history` | the Review shelf, newest day first |
| GET | `/audio/:corpusId/:seq/:lang` | prompt audio (public) |
| GET | `/cue/:name` | a UI cue such as the recording ding |
| GET | `/recordings/:userId/:corpusId/:seq` | the learner's own take |

Capabilities are sent by the client as `microphone` and `textInput` (a list of
language codes); the server filters the device chain and validates writes with
the same values.

---

## 11. Reading a session back

Every event on both sides of the wire carries a **run id** on
`context.runId`. The program mints one per run, sends it as
`X-School-Run-Id`, and the router threads it into the service's log calls, so
one query returns a single child's whole sitting, browser and backend
interleaved:

```
context.runId:"<id>" AND _time:24h
```

The events a supporter reads first:

| Event | Level | Says |
|---|---|---|
| `school.language.day-read` | info | day, queue size, device chain, credit chain, blocked rungs, gate level — the first line when a child got the wrong work |
| `school.language.program.day-loaded` | info | what the surface received, its chain and blocked rungs, and the round trip |
| `school.language.rung.landed` | info | which rung the learner was put on and why — `first`, `resume`, `rung-cleared` |
| `school.language.rung.selected` | info | a rung they chose themselves, and from where |
| `school.language.rung.held` / `replayed` / `advanced` | info | repetition's three choices — a run of `complete`s alone cannot tell a child who listened twice from one carried along |
| `school.language.capability.rung-blocked` | info | each dimmed rung and the capability it lacks, once per day |
| `school.language.capture.start` / `stop` / `retake` / `denied` | info / error | a take's life, with its byte count and whether the band heard a voice |
| `school.language.pacing.roll-refused` / `change-failed` | warn | a decline, which from the child's side is a dead button |
| `school.language.api.rejected` / `failed` | warn / error | a non-ok response; a request that threw, so a dropped connection is not a status 0 |
| `school.language.day-complete` | info | the day settled |
| `master-changed` (screen framework) | info | the panel's software volume moved — whether the volume keys reached the app at all |

Request bodies and response payloads are never logged: they are the child's
own sentences and answers. Per-sentence and per-request events sit at `debug`,
reach the console only (`?debug=1` raises the level for the mount), and are
dropped by the store at ingest — which is why `rung.landed` is at info.

---

## 12. Adding a language pair

1. Write the corpus file: role bindings, sentences keyed by code, bands if the
   material has natural divisions. Validate by loading it — errors are listed,
   and an invalid corpus is simply absent from `/courses`.
2. Land the audio as `{NNNN}-{LANG}.mp3` under the corpus's media directory,
   one file per sentence per language. Mark sentences with no recording
   `audio: false`.
3. Add a poster under `school/programs/sentence-ladder/<corpusId>/`.
4. Enroll a learner: `programId`, `corpusId`, `lessonSize`, and the rungs their
   device can credit. Add `units` in the teacher's words if the card should
   say where they are.
5. Launch it from School. Nothing in the ladder, the queue, the rungs or the
   surface changes for a new pair; the roles resolve from the corpus.

Related: [School README](./README.md) · [Teacher flows](./teacher.md) ·
[School day-to-day operations](../../runbooks/school/README.md)
