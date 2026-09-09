# Enrolling Two Learners in the Sentence Ladder — Design

> **Status:** designed and BUILT 2026-09-09. Content restored and verified
> live; the in-page IME, the cold-start fill and both enrollment records are
> committed on `school/glossika-enrollment`. Not yet deployed, and not yet
> exercised on the Portal with the physical keyboard — §6 items 4-8 are
> outstanding.
> Parent docs: [`2026-07-21-glossika-program-design.md`](./2026-07-21-glossika-program-design.md)
> (the ladder itself), [`2026-08-23-glossika-school-integration-design.md`](./2026-08-23-glossika-school-integration-design.md)
> (agenda, access codes, day-close credit).

---

## 1. Where this starts

The ladder was built in July and proven end to end, then its content went
missing. Investigation found it had not been lost: the September school-media
reorganisation moved the whole package into `media/school/_inbox/`, which the
tree's own placement contract marks as work in progress rather than
enrollment-ready. The corpus YAML was inside it, in a `course/` subdirectory.

Restored 2026-09-09 by promotion, not rebuild:

| Item | From | To |
| --- | --- | --- |
| 6,650 mp3s + `recordings/` | `media/school/_inbox/language/glossika-korean/` | `media/school/language/glossika-korean/` |
| Corpus YAML | that package's `course/` | `data/content/school/language/glossika-korean.yml` |

Verified through `validateCorpus`: 4,143 sentences, seq 1–4143, 3,325 playable,
`{source: EN, target: KR}`. The live API serves `/courses`, streams
`/audio/glossika-korean/1/{KR,EN}`, and builds a preview day with the full
four-rung chain. No restart was needed; the corpus is read on demand.

Two learners get enrolled. **Learner-Four** has real Korean already.
**Learner-Three** is still learning Hangul. Both study at the Portal panel,
taking turns, so no second station is in scope.

## 2. What is actually being built

Three kinds of work, and only one is code.

**Data** — done (§1), plus two enrollment records (§5).

**Code** — the School-wide Hangul provider (§3) and the cold-start fill (§4).
Nothing else.

**Not being built:** an alphabet trainer, a second study station, a teacher UI
for language enrollment, or any change to the ladder's role model. Copy-mode
dictation covers the beginner's script practice; the learner plan file is
hand-edited by design, which its own store docstring states.

## 3. Hangul input, School-wide

Physical-keyboard text reaches the Portal's WebView with no IME involvement, so
Korean arrives as Latin. Neither AOSP LatinIME nor fcitx5 with its Hangul
plugin produces composition events from a physical keyboard on that device.
This is settled; see `_extensions/portal-keys/README.md`.

So the 두벌식 automaton composes in the page. It is a plain module driven off
`KeyboardEvent.code`, with 17 tests covering compound vowels, compound finals,
the steal rule, and backspace peeling one jamo at a time.

**It is a School-wide capability, not a rung detail.** `ShortAnswerItem` and
`ClozeItem` take free-text quiz answers, and a Korean quiz needs Hangul in both.
Scoping the composer to the ladder would leave those unreachable.

### The provider

`HangulTypingProvider` wraps `SchoolShell`. It owns the mode, one capture-phase
`keydown` listener on the School root, and per-element composition state in a
WeakMap so two fields never share a half-built syllable.

It intercepts only when every condition holds: mode is KR, the target is a
text-accepting `input`/`textarea`, the field has not opted out, and no modifier
is down. In English mode the listener does one key comparison looking for F6 and
passes everything through. That restraint matters: seven components in School
already own a global `keydown`.

**Opt-outs are declared, never guessed.** `Keypad` and `NumberPad` take digits;
`useBookShelf` captures a barcode scanner that types like a keyboard, and a
scanner emitting Hangul would be the most confusing failure available here. The
teacher subtree is marked once rather than field by field, since those fields
hold dates, bank ids, and reasons.

**Writing into a controlled input needs the React escape hatch.** Assigning
`.value` does not fire `onChange`, because React tracks the node's previous
value. The provider uses the native prototype value setter, dispatches a
bubbling `input` event, and restores the selection so the caret lands after the
composed syllable.

### Mode

Fields may declare a language with `data-ime-lang`; the provider adopts it on
focus and restores the manual mode on blur. `TypedRung` sets it from
`entry.response.language`, so dictation and interpretation alternate by
themselves. F6 always overrides, and is the escape hatch for any field nobody
labelled.

### The indicator

A flag badge, US or KR, showing the live mode. **It cannot live in the School
header**, which renders only when the panel is unlocked — and the Portal is
always locked, so the badge would be invisible exactly where it is needed. The
provider draws it as a fixed corner element, present on the locked panel and the
browsable app alike.

### Consequences elsewhere

`useCapabilities` defaults `textInput: []` because no web API can detect a
Hangul IME. With an in-page composer the question changes: a device with a
hardware keyboard can type the target script. That default is rewritten.

The prototype rendered text into a `<div>` so the composing syllable could be
underlined, which cost a hand-drawn blinking caret. Composing into the real
field instead keeps the native caret, selection, and accessibility behaviour,
and is what makes the provider work in fields it does not own.

## 4. Cold start

A day is *N* new sentences plus everything that cleared rung *k* yesterday and
not yet *k+1*. On day one nothing has cleared anything, so the queue is
repetition-only and the sitting is a quarter of its intended size. It reaches
full volume on day four. The first sitting being the emptiest is the wrong way
round for a habit that has to survive its own beginning.

**Rule:** build the credited queue as now; if it falls short of `lessonSize`,
extend the newest admitted set up the remaining rungs as practice.

```
            CREDITED                   PRACTICE
Day 1   s1@r1                      s1@r2 r3 r4
Day 2   s2@r1 s1@r2                s2@r2 r3
Day 3   s3@r1 s2@r2 s1@r3          s3@r2
Day 4   s4@r1 s3@r2 s2@r3 s1@r4        --      <- steady
```

Full volume from day one; steady state at day four. The rule turns itself off
with no warm-up flag, no day-number check, and no window to configure: once
credited work fills the day, there is nothing left to extend. If a learner
skips a week and the pipeline drains, it re-primes on its own.

**A practice attempt must still write a log event.** The queue is derived from
the append-only log and re-fetched after every save. An attempt that writes
nothing leaves the queue unchanged and pins the learner on the same item. So
practice events are written carrying `practice: true`, and the
rung-progression test ignores marked events when deciding what cleared. The log
stays complete while only a sentence's first pass at a rung moves it up.
Reporting and review treat practice attempts normally, including scoring typed
answers, so copy-mode work still shows as something the learner wrote.

On screen a practice item is identical apart from a small label. Without one, a
sentence reappearing three times in a sitting reads as a glitch.

Lives in `dayQueue.mjs`. Tests in `dayQueue.test.mjs`: item counts for days one
through four, and proof that a practice event never advances a rung.

## 5. Enrollments

Appended to `programs:` in
`data/household/school/plans/learners/{learnerId}.yml`, matching the shape of
the existing entries (`subject`, `title`, `schedule`) plus the fields
`validateProgramEnrollment` checks.

| | Learner-Four | Learner-Three |
| --- | --- | --- |
| `lessonSize` | 60 | 20 |
| new sentences/day | 15 | 5 |
| `dictationMode` | `listen` | `copy` |
| `rungs` | all four | all four |
| `reward` | omitted | omitted |

`dictationMode: copy` reveals one target glyph at a time ahead of the matching
typed prefix, so a learner still finding the letters practises entering the
script without being handed the sentence. Interpretation stays in the beginner's
chain: the source text is on screen to check against, so it is exposure rather
than a recall test.

No reward, matching their other programs — this is schoolwork, not an earning
activity. One line to add later.

**No `scope` on either.** The schema accepts band ids, but a corpus written by
`import-db` carries no `bands` block, so scope-by-band fails validation.
Integer ranges work and neither learner needs one; both start at sentence 1,
where the source course begins.

**Written 2026-09-09.** Both records are in place and validated through
`validateProgramEnrollment`; existing course and program entries were preserved
byte-for-byte. Originals backed up before the edit.

**Both start clean.** Each carried a `2026-07-22` log of five repetition
attempts and a `progress.yml` from the July build session. Left in place,
rollover would see a completed day-one queue and a long-passed boundary and
advance them to day two with five sentences already at dictation. Those four
files were moved to `_deleteme/glossika-july-test-data-20260909/` on
2026-09-09, so day one is day one.

## 6. Verification

**The ladder**

1. `GET /users/{learnerId}/day` for the advanced learner returns
   `dailyLimit: 15`, a four-rung chain, and 60 queue items with the trailing 45
   marked practice; the beginner returns 5 and 20.
2. A practice attempt logs an event and does not advance that sentence's rung.
3. Day close fires once the queue is exhausted and records a completion with no
   reward.

**Typing, on the Portal with the bonded keyboard**

4. Dictation composes Hangul and the submitted text matches the corpus target
   for a known sentence.
5. The flag badge is visible on the LOCKED panel, not only in the browsable app.
6. The mode follows the rung without a keypress: KR for dictation, US for
   interpretation. F6 overrides both.
7. A Korean short-answer quiz item composes Hangul, proving the provider reaches
   fields the ladder does not own.

**Nothing else broke**

8. With the mode left in KR: the barcode scanner still resolves an ISBN, and the
   Keypad still takes a six-digit code. These are the two opt-outs whose failure
   would be hardest to diagnose from the symptom.
