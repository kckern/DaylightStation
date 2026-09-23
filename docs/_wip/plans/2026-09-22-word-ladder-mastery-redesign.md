# Word ladder — mastery redesign

Status: rev 3 (2026-09-22) — second review round applied; awaiting owner review
Replaces: `docs/_archive/2026-09-22-word-ladder-test-mode-layout-observability-design.md`
Benchmark: `docs/_wip/audits/2026-09-22-quizlet-benchmark-word-ladder.md`
Current code: `docs/reference/school/word-ladder.md`

## Why

The first word ladder was not a flashcard program. The flip was hidden behind
a recording gate; the picture sat on the Korean front and gave the meaning
away; a "Still learning" card vanished until tomorrow; mastery came from the
child's own "I know it". This redesign rebuilds it **in place** — lexicon,
media, weekly decks, package-keyed storage, printed quiz and fold stay —
around one model:

> **The child sorts; the round-end quiz verifies; only a quiz grades.**
> Self-study is flashcards the child sorts into three piles. Every word the
> child did not call "Not yet" is quizzed at the end of its round. Mastered
> words come back at widening gaps. Words that keep slipping go to drill,
> which walks them from full support to none.

The learner (first enrollment: `korean-vocab`) reads Hangul slowly, so text and
audio travel together on cue sides, and decoding ("read it, no audio") is its
own exercise. The kiosk is a 1280×800 Portal with a bonded Korean/English
Bluetooth keyboard; no grown-up is present.

### Rev 3 changes (second review)

Shrink-to-fit rounds with per-word time estimates and worked typical days; at
most one drill offer per round and none after the cap; chronic Not yet is
quizzed on its second consecutive round end (`notYetCarry`); an at-open
snapshot persisted per sitting for credit and replay; verify = typed + hear-and-
pick-meaning (pick-term dropped from verify); judge: no-Hangul short-circuit,
40-char cap, attempt passed as data, deterministic jamo score final for ≤ 2
syllables and a floor the model may raise one band, jamo decomposition
defined, cache under `data/` and overwritten by re-grade; the different-word
guard kept as a deliberate exception; recheck typed cadence resolved (always
typed from stage 2); failed-today words take no round slot; new rounds top up
with carry-over; "Relearned" label; decks are quotas and the printed quiz covers
only introduced words; test mode snapshots `tuning.yml` and fakes the model in
automated tests; keypad auto-open at 10 s, once per item.

### Rev 2 changes (first review)

Round-end quiz replaces claim-only quizzing and the Quiz-me/Keep-studying
modal; the three piles now behave differently; hardest-first verify order with
first-miss stop (no answer leakage); no same-day re-verify after a failed
verify; typed answers judged for meaning by a small model (pass ≥ 6, exact
fast path, decoy guard, deterministic fallback, cached); pictures only as cues, never graded answers;
`introduced` state; working-set clamp; one tricky definition; paper misses
never promote; cap-aware round starts with honest time estimates; server idle
close; keypad by toggle, not detection; per-day event files; explicit GAPS
indexing; Don't know + undo; autoplay unlock; focus hand-off; grown-up word
controls; tuner once per study day with dwell; build order starts with the
pure domain.

---

## 1. Level model

### States (per learner, per package, per word)

| State | Child sees | Entered by |
|---|---|---|
| `new` | — | not introduced |
| `introduced` | New | the introduction (§4); left on the first sort |
| `notYet` | Not yet | child's sort |
| `familiar` | Familiar | child's sort, a failed verify, a failed recheck, or a paper miss on a claimed/mastered word |
| `claimed` | Got it | child's sort |
| `mastered` stage 0 | Mastered ⭐ | a passed verify; due next study day |
| `mastered` stage s ≥ 1 | Mastered ⭐… | s passed rechecks |

### Flags and counters

- `missStreak` — consecutive graded misses (a failed verify counts once; a
  failed recheck once; a paper miss on a claimed/mastered word once). Reset to
  0 by a passed verify or recheck.
- `tricky` — **on** when `missStreak ≥ drill.afterMisses`; **off** when a verify
  or recheck is passed. Paper passes do not clear it (paper never promotes).
  Tricky never blocks a quiz; it only queues the word for drill (§4).
- `verifyFailedDay` — the study day of the word's last failed verify. A word
  whose `verifyFailedDay` is today is not quizzed again today.

### Rules

1. **Only a quiz grades.** Round-end verify, rechecks and the paper quiz are the
   only graded events. Flashcards, drill, match, say, write and listen never
   change a level except by rule 2.
2. **Self-sorting moves down freely, up only to `claimed`.** A mastered word
   sorted Not yet / Familiar in practice drops to that state (stage reset); Got
   it on a mastered word changes nothing.
3. **A graded miss lands on `familiar`** — never lower, and never higher than
   the word already was: a paper miss on `new`/`introduced`/`notYet` is logged
   only.

### Transitions

| Event | From | Result |
|---|---|---|
| Verify passed (§2) | `familiar`, `claimed` | `mastered` s0, `dueDay` = next study day; streak 0; tricky off |
| Verify failed | `familiar`, `claimed` | `familiar`; streak +1; `verifyFailedDay` = today |
| Recheck passed | `mastered` s | stage s+1; `dueDay` = day + round(`GAPS[min(s+1, 5)]` × `review.gapScale`) study days, `GAPS = [1, 3, 7, 14, 30, 60]` (so s1 → +3, s2 → +7 … s5+ → +60); streak 0; tricky off |
| Recheck failed | `mastered` s | `familiar`, stage cleared; streak +1 |
| Paper row miss (fold) | `familiar`, `claimed`, `mastered` | `familiar`, stage cleared; streak +1 |
| Paper row miss | `new`, `introduced`, `notYet` | logged only |
| Paper row pass | any | logged only |

A stage-0 word's "recheck" the next study day is exactly the recheck above
(s0 → s1 on a pass). Streak ≥ `drill.afterMisses` after any miss sets tricky.

### Working set

- **Unsettled** = `introduced` ∪ `notYet` ∪ `familiar` ∪ `claimed` ∪
  (`mastered` s0). A word settles when it passes its first recheck.
- New words available to introduce today =
  `max(0, min(batch.newPerDay, batch.workingSet − unsettled))`, computed **when
  the sitting reaches introductions** (after rechecks and carry-over quizzes,
  so today's misses count).
- **The pool** is every not-yet-introduced word of the current enrollment deck
  and of any deck the learner was enrolled in before (`status.decksSeen`,
  recorded at each open), oldest deck first, deck order within a deck. So a
  deck is a quota: its words keep coming until all are introduced, even after
  a grown-up moves the enrollment on.
- A Got-it spammer gains nothing: every Got-it word is quizzed at round end and
  stays unsettled until it survives a next-day recheck.

---

## 2. Grading

### The verify quiz (round end)

Per word, two graded tasks, **hardest first**, stopping at the first miss:

1. **3.3 type-from-cue** (judged for meaning, §2 Typed input) — proves he can
   produce the word from its meaning.
2. **2.2 pick-meaning, *hear* channel** — proves he knows it by ear, the one
   skill typing does not test. (A word with no term audio uses the *read*
   channel.)

3.1 pick-term is not asked in verify: a correct typed answer already shows he
can find the Korean for the meaning, so a mis-tap there could only fail a word
he just produced. Right → the next task; wrong → the correct answer is shown
(Korean audio plays), the word **fails verify**, its remaining task is dropped.
Both right → **passed**. Because production comes first and a miss ends the
word, feedback never gives away a later task. Tasks of different words
interleave; a single-word quiz is fine because of hardest-first order.

Every graded choice task has a **Don't know** option (counts as a miss, shows
the answer) — a guess is never forced.

### Rechecks

One graded task per due word:

- **Below stage 2:** `2.2` and `3.1` alternate; every `review.typedEvery`-th
  recheck of that word is `3.3`.
- **Stage 2 and above:** always `3.3`.

### Typed input

- Input: the bonded physical keyboard through School's in-page Hangul IME
  (`frontend/src/modules/School/ime/`), or the on-screen jamo keypad (§6).
- **What is judged:** whether the child **knows the word** — produced the
  intended Korean for the cue — not whether they can spell it. This is a
  mastery test, not a spelling test; grading is deliberately generous.
- **The typed-answer judge** (`WordLadderTypedJudge`, application layer, uses
  `IAIGateway.chatWithJson` — the port School already uses in
  `AdaptiveRemediationTutor`):
  Steps run in order; the first that decides wins.
  1. **Normalise.** Input is capped at 40 characters. NFC-normalise, strip all
     whitespace and Unicode punctuation (`\p{P}`) from both sides.
  2. **Exact → score 10**, no model call.
  3. **No Hangul → score 1**, no model call. An answer with no Hangul syllable
     or jamo (English, digits, empty) is not an attempt at the word.
  4. **Different real word → score 2**, no model call. If the normalised
     answer equals a *different* deck word or authored decoy, it fails — even
     one letter off (풀 → 불, 연필 → 색연필). This is the one deliberate
     exception to "not a spelling test": decoys are the confusable wrong
     answers by design, so typing and multiple choice stay consistent.
  5. **Deterministic score** from jamo distance: decompose both sides to jamo
     with `modules/School/ime/hangul.js`'s decomposition (ported to
     `2_domains/school/wordLadder/jamo.mjs`, shared by client and server), then
     Levenshtein over the jamo sequences (the existing code-point `editDistance`
     in `2_domains/school/language/transcription.mjs`, applied to jamo, not
     syllables). Band it: 0 → 10 · ≤ 10 % of target jamo → 8 · ≤ 25 % → 6 ·
     ≤ 50 % → 4 · beyond → 2.
  6. **Short words (≤ 2 syllables): the deterministic score is final.** No
     model call; a model adds nothing over distance on two syllables.
  7. **Longer words and phrases: a small, low-effort model** (configured, not
     hard-coded; `reasoningEffort: minimal`, 3 s timeout, via
     `IAIGateway.chatWithJson`) gets the target term, its gloss and kind, the
     deck's other terms + decoys, and the attempt **as a JSON data field,
     never interpolated into instructions**, and answers *"does this attempt
     show the learner produced the intended word?"* as `{score: 1–10, reason}`
     against fixed anchors: 10 exact · 8–9 spacing/one slip · 6–7 misspelled
     but clearly the intended word · 4–5 partly there (e.g. one syllable of
     three) · 1–3 a different word or unrelated. **The deterministic score is a
     floor and the model may raise it by at most one band** (e.g. 4 → 6); it
     can never lower it. Model failure or timeout → the deterministic score
     stands, logged `judge: fallback`.
  8. **Pass = score ≥ `typing.passScore`** (grown-up setting, default **6**).
  9. **Cached** by (package, word id, normalised answer) in
     `data/household/apps/school/word-ladder/<package>/judgements.yml` (derived
     data, shared across learners), so a reload, replay or repeated typo gets
     the same verdict with no second call. A grown-up **re-grade** (§6)
     overwrites the cache entry, so a wrong verdict is corrected everywhere.
- **Feedback:** 10 → tick; pass below 10 → "Got it! Here's the spelling" with
  the diff (the misspelling is corrected, credit still given); fail → the
  correct answer with Korean audio. Grown-ups see score and reason.
- No "I was right" override: the judge's tolerance replaces it, and an
  unsupervised child is not given a self-pass button.
- Phrases are typed from day one; the judge absorbs their spacing and
  punctuation.
- Supported typing (1.1 copy, 1.4 dictation) repeats until it matches exactly
  after normalisation; it is never graded and never calls the judge.

### Choices

- **Pictures are cues only** (3.1, 3.3, 3.4, 2.3 match). Graded answer options
  are always text.
- **2.2 pick-meaning:** English options — the answer plus authored gloss
  decoys.
- **3.1 pick-term:** Korean options — the answer plus up to 3 same-kind deck
  words the learner has already been introduced to (so the child must know
  which *known* word it is), backfilled with authored term decoys.
- Seeded by learner + day + sitting + item: a reload shows the same choices.

---

## 3. Task catalogue (MECE)

A task = **what is given → what is produced.** Every combination is listed;
excluded ones say why.

```
TASK  (given → produced)
│
├─ 0  EXPOSURE — everything given, nothing produced                  [never graded]
│   ├─ 0.1 look ........ picture + Korean text + Korean audio           drill · intro
│   ├─ 0.2 reveal ...... flashcard back: picture and/or English (+ gloss audio)
│   └─ 0.3 listen ...... Korean audio (+ text) run through words        practice
│
├─ 1  SOUND ↔ SPELLING — Korean in, Korean out; no meaning             [never graded]
│   ├─ 1a SUPPORTED — the exact model is present
│   │   ├─ 1.1 copy-type .... see text (+ audio) → type it              intro · drill · Write
│   │   └─ 1.2 say-after .... see + hear → say → own take, then native   intro · drill · Say
│   └─ 1b UNSUPPORTED — only the other half of the form
│       ├─ 1.3 read-aloud ... text, NO audio → say → native after        drill · Say
│       ├─ 1.4 dictation .... audio, NO text → type it                   drill · Write
│       └─ 1.5 pick-spelling  audio → the right spelling of 4 (authored term decoys)  drill
│
├─ 2  KOREAN → MEANING (receptive)       channel: hear (audio only) │ read (text only)
│   ├─ 2a SELF-CHECKED
│   │   └─ 2.1 flashcard .... Korean → recall → flip → sort               stream · Flashcards
│   ├─ 2b RECOGNISE
│   │   ├─ 2.2 pick-meaning . hear│read → 4 English meanings              ★ GRADED
│   │   └─ 2.3 match ........ 4–6 Korean ↔ picture/English pairs          drill · Match
│   └─ 2c PRODUCE
│       ├─ ✗ type English — tests English spelling, not Korean
│       └─ ✗ say English  — ungradeable; adds nothing over 2.1
│
└─ 3  MEANING → KOREAN (productive)      cue: picture │ English text │ English audio
    ├─ 3a SCAFFOLDED
    │   ├─ 3.1 pick-term .... cue → 4 Korean                              ★ GRADED
    │   └─ 3.2 tiles ........ cue → build from syllables + 2 decoy syllables   drill
    └─ 3b UNSUPPORTED
        ├─ 3.3 type-from-cue  cue → type the Korean                       ★ GRADED
        └─ 3.4 say-from-cue . cue → say → native plays → self-compare     drill · Say  [never graded]
```

- **Graded:** 2.2, 3.1, 3.3. Everything else is
  practice. **Speaking is never graded**; takes are saved for grown-ups.
- **Practice "With help" = 1a + 3a; "Without help" = 1b + 3b.**
- **Drill path per word:** 0.1 → 1.1 → 1.2 → 2.3 → 1.3 → 1.4 → 3.2 → 3.4 → 3.3
  (support withdrawn step by step; steps needing a mic or audio are skipped;
  3.3 here is practice).
- **Introduction:** 2.1 (first sight; the flip is the teaching) → 1.1 → 1.2.
- **Typing is in every word's life:** 1.1 at introduction, the productive task
  of every verify, typed rechecks thereafter.

---

## 4. The sitting

### Rounds and piles

A **round** is up to `round.size` (default 5) quizzable words. A **new round**
introduces today's new words at its start and tops up with carry-over words
when fewer new words fit; a **carry-over round** is unsettled words from
earlier days (`notYet` and `familiar` first, then `claimed`). Words that failed
verify today (`verifyFailedDay` = today) may appear in a round's stream as
flashcards but **do not take a `round.size` slot** and are not quizzed again
today.

In the round's **stream** (2.1 flashcards) the child sorts each card:

| Pile | Key | In the stream | At round end |
|---|---|---|---|
| **Not yet** | 1 | returns after 2 other cards | **not quizzed** — unless its `notYetCarry` flag is set (below) |
| **Familiar** | 2 | returns after 5 other cards, or last in the pass when the round is smaller | **quizzed** |
| **Got it** | 3 | leaves the stream | **quizzed** |

- The stream ends when no word's latest sort is Not yet, **or** after
  `round.maxPasses` (default 3) passes through the round's words.
- **Quiz me** (always visible, key **Q**) ends the stream now.
- **Undo** (key **U**) reverses the last sort while its card is still the most
  recent.
- **Round end:** the verify quiz (§2) on every round word whose latest sort is
  Familiar or Got it — plus every word whose **`notYetCarry`** is set — and
  whose `verifyFailedDay` is not today.
- **Chronic Not yet:** a word whose latest sort at a round end is Not yet gets
  `notYetCarry` set (cleared when it is next quizzed). At its next round end —
  a later study day — it is **quizzed whatever the child sorts**. Honest "Not
  yet" skips the quiz once; it cannot skip it twice in a row.
- **Drill offer:** at most **one per round** — for the round's Not-yet word
  with the most Not-yet sorts: *"This one's tricky — want to practise it?"*
  **Yes** runs its drill now; **No** carries on. No offer is made once the cap
  has elapsed or when less than the drill estimate (4 min) of active time
  remains.
- A same-day verify pass for a word that lost `mastered` earlier today (a failed
  recheck) is shown as **"Relearned"**, not ⭐; its state is `mastered` s0 as
  usual and it must still pass tomorrow's recheck to settle.

### Order of a sitting

1. **Rechecks** due today (shuffled).
2. **Drill** for up to `drill.perSitting` (default 1) tricky words, oldest
   tricky first, if the drill estimate fits the remaining time; the rest wait
   for later sittings (FIFO).
3. **Carry-over round(s):** unsettled words from earlier days.
4. **New rounds**, **shrink-to-fit:** each new round introduces the largest
   n ≥ 2 new words (n ≤ today's allowance, n ≤ `round.size`) whose estimate fits
   the active time left; if even 2 do not fit, no round starts. The quiz is
   therefore never the part the cap cuts off.
5. **Summary** (today's words by state, and how many were quizzed) →
   **practice menu**.

### Time estimates (slow reader)

| Step | Estimate |
|---|---|
| Recheck (choice / typed) | 15 s / 30 s |
| Introduction (flip + copy-type + say-after) | 75 s per word |
| Stream | ~16 s per word (two views) |
| Verify (type + hear-and-pick) | 45 s per word |
| **New word, whole round** | **≈ 2.3 min** (intro + stream + verify) |
| **Carry-over word, whole round** | **≈ 1 min** (stream + verify) |
| Drill (9 steps) | 4 min per word |

The engine starts from these and switches to the learner's measured medians
once 5 sittings exist.

**Typical days at defaults (cap 15 min):**

| Day | Rechecks | Drill | Carry-over | Time left | New words introduced |
|---|---|---|---|---|---|
| Quiet | 3 (≈ 1 min) | — | 2 (≈ 2 min) | 12 min | **4** (≈ 9.2 min; newPerDay cap) |
| Typical | 5 (≈ 1.5 min) | — | 3 (≈ 3 min) | 10.5 min | **4** (≈ 9.2 min) |
| Hard | 5 (≈ 1.5 min) | 1 (4 min) | 3 (≈ 3 min) | 6.5 min | **2** (≈ 4.6 min) |
| Very hard | 8 (≈ 2.5 min) | 1 (4 min) | 5 (≈ 5 min) | 3.5 min | **0** — consolidation day |

A 19-word deck therefore takes roughly **1–2 weeks**. **The weekly deck is a
quota, not a deadline:** its words carry over until introduced, and the next
deck's words start only when the current deck is fully introduced (a grown-up
can still bump the enrollment early). The printed quiz covers **only words the
learner has been introduced to** (§8 Printed quiz).

### Done for today (goal, with a time cap)

**Goal** = every recheck in the sitting's at-open snapshot answered · the
sitting's drill run, if the snapshot lists a tricky word and the drill fit ·
every round started today finished (stream, quiz, drill offer settled).
**Or** `session.capMinutes` (default 15) of **active** time — input within the
last 45 s — has elapsed and the round in progress has finished (rounds are
sized to fit, so overrun is bounded by estimate error). Credit (`doneToday`) is
either; the practice menu unlocks at either. Unstarted material carries over.
The summary and the day file record **how many words were quizzed**, so a day
credited with zero graded items is visible to grown-ups and the tuner.

### Engine and API

`next(state, sitting, settings, rng) → item` — one deterministic, pure function
in `2_domains/school/wordLadder/`; the application service persists and calls
it. Replaces the v2 plan/checks/cards/mark/review routes:

- `POST /word-ladder/open {learnerId, deckId}` → `{sittingId, day, item, progress}`
  (folds paper attempts first — only here, never mid-sitting)
- `POST /word-ladder/sittings/:id/items/:itemId {response}` → `{result, item, progress}`;
  `response` ∈ `{sort}` `{undo}` `{choice}` `{dontKnow}` `{typed}`
  `{quizNow}` `{drill: yes|no}` `{done}`
- `POST /word-ladder/sittings/:id/recordings/:itemId` (raw audio; say tasks)
- `POST /word-ladder/sittings/:id/close {reason}`
- `GET  /word-ladder/sittings/:id` → current item + progress (reload)
- `POST /word-ladder/sittings/:id/practice {mode, help, filter}` (after goal)
- `GET  /word-ladder/words?learnerId&package` → My words

Item ids make every response idempotent (a repeat returns the stored result).
A sitting belongs to its study day; after 4am it 404s and the client reopens.
**Server idle close:** a sitting with no item POST for 5 min is closed
(`reason: idle`) by the next request that touches the learner's status or by a
5-minute sweep, whichever is first; `activeMs` is computed from item
timestamps, not client clocks. Next-item latency target ≤ 150 ms (one status
read + pure compute + one day-file append), except a typed answer that
reaches the judge model (≤ 3 s, shown as "Checking…"); the client preloads the next
item's media while the current one is on screen.

### Storage

`data/users/{learnerId}/apps/school/word-ladder/<package>/`

```yaml
# status.yml — small summary, rewritten on graded events and sorts
schema: school.word-ladder-status/v3
words:
  gawi: { state: mastered, stage: 1, dueDay: 2026-09-26, missStreak: 0,
          tricky: false, trickySince: null, verifyFailedDay: null,
          notYetCarry: false, introducedDay: 2026-09-22,
          lastGraded: { day, task, correct } }
decksSeen: [language/korean/week-01-classroom]
lastFoldedDay: 2026-09-22
```

```yaml
# days/2026-09-22.yml — that day's append-only events + sittings
sittings:
  <id>:
    openedAt: ...
    closedAt: ...
    reason: goal|cap|leave|idle|unmount
    activeMs: 812000
    atOpen:                     # frozen snapshot; credit and replay read this
      dueRechecks: [gawi, pul, ...]
      tricky: [yeonpil]
      newAllowance: 4           # informational; actual introductions are
                                #   computed when the sitting reaches them
      settings: { round.size: 5, ... }   # tuning values in force
events:
  - { at, sitting, item, word: gawi, task: "2.1", event: sort, value: claimed }
  - { at, sitting, item, word: gawi, task: "3.3", event: graded, correct: true, typed: "가위", distance: 0 }
```

Per-day files bound every rewrite to one day's events; `status.yml` stays one
line per word. Credit, replay and the trace read the day file.
**Migration v2→v3:** NEW→`new`, LEARNING→`familiar`, CLAIMED→`claimed`, KNOWN
step n→`mastered` stage n+1 with `dueDay` = v2 next-check day verbatim; v2 day
plans are dropped (the one live learner has a single unmarked plan).

---

## 5. Lifecycle

```
            ┌───────┐
            │  NEW  │  deck pool
            └───┬───┘  room in working set, round fits the time left
                ▼
   ╔══════════════════════════════╗
   ║ INTRODUCE (supported, once)  ║   2.1 flip → 1.1 copy-type → 1.2 say-after (mic)
   ╚══════════════╤═══════════════╝
                  ▼
            INTRODUCED
                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ ROUND STREAM (2.1)                                            │
   │   1 NOT YET  ── returns after 2 ──┐                           │
   │   2 FAMILIAR ── returns after 5 ──┼─ loop until no Not yet     │
   │   3 GOT IT   ── leaves stream     │   or maxPasses, or Quiz me │
   └──────────────────────────────────┴───────────────────────────┘
          │ Familiar / Got it, or Not yet with    │ latest sort Not yet
          │ notYetCarry (2nd day in a row)        │ (first time) → notYetCarry set
          ▼                                        ▼
   ╔══════════════════════════════════╗     ≤1 drill offer/round ─(yes)─► DRILL ─► next round
   ║ ROUND-END VERIFY (graded)         ║     (no) ─► next round, still NOT YET
   ║ 3.3 type (judged) → 2.2 hear ·    ║
   ║ stop at first miss                ║
   ╚══════════╤═══════════════╤════════╝
          passed            failed ─► FAMILIAR · streak+1 · not re-quizzed today
              ▼                          │ streak ≥ afterMisses ─► + TRICKY
      MASTERED s0                        ▼       (drilled first in a later sitting,
      due next study day            later rounds   perSitting at a time; never blocks a quiz)
              ▼
   ╔══════════════════════════════════╗
   ║ RECHECK when due (1 graded task)  ║
   ╚══════════╤═══════════════╤════════╝
          passed            failed ─► FAMILIAR · stage cleared · streak+1 ─► rounds
              ▼
      MASTERED s+1 ─ next due +3·7·14·30·60 study days × gapScale ─► RECHECK …

  SIDE DOORS: paper miss on familiar/claimed/mastered = recheck miss; on new/introduced/
  notYet = logged · paper pass = logged · practice sort can lower a word (rule 2) ·
  practice Quiz me = round-end verify rules · drill / match / say / write / listen: no change
```

### Media adaptation (nothing ever blocks)

| Step | Has picture | No picture | No term audio |
|---|---|---|---|
| Reveal 0.2 | picture + English | English, large | unchanged |
| 1.2 say-after · 1.4 dictation · 0.3 listen | ✓ | ✓ | skipped |
| 2.2 channel | hear or read | hear or read | read only |
| 3.1 / 3.3 / 3.4 cue | picture or English (rotates) | English text or English audio | unchanged |
| 2.3 match | Korean ↔ picture | Korean ↔ English | unchanged |
| Typing (1.1, 3.3, typed rechecks) | always | always | always |

A phrase's `pronunciation` shows on the reveal only. No mic → speaking steps
are skipped; never a block. A picture failing at runtime switches to the
no-picture layout (`media.failed`); an audio prompt failing switches 2.2 to
read (`item.prompt-fallback`).

---

## 6. Screens

### Stage

The program renders inside a **fixed stage** sized from config, never code:
School's household config names the target screen (`stage.screen`, the
Portal); the stage reads that screen's `resolution` from `/api/v1/screens/<id>`
(`screens/portal.yml`: 1280×800). On the Portal the stage is the viewport; in a
desktop browser it is that box, centred, uniformly scaled down to fit.
Regions: **header** (round progress, pile counts, Leave) · **card** ·
**controls**; content centred on both axes.

### Layouts

`flashcard-front` · `flashcard-back-picture` · `flashcard-back-text` ·
`choice-text-cue` · `choice-picture-cue` · `choice-audio-cue` · `type` ·
`type-keypad` · `tiles` · `say` · `match` · `look` · `quiz-result` ·
`summary` · `menu` · `words`.

### Text fitting

No break inside a word (`word-break: keep-all`, no hyphens). Each text role
fits the largest size that fits its region in ≤ N lines (term 2, gloss 3,
choice 2) between per-role min/max; the four choices share one size; at the
minimum, overflow wraps anywhere and logs `layout.clamped` (warn). Pure
`fitFontSize({measure, min, max, maxLines})` + `<FitText>`/`<FitGroup>`, refit
on `ResizeObserver` and `document.fonts.ready`.

### Buttons, input, focus, audio

- A **touch button primitive** in the design-system barrel
  (`frontend/src/lib/ui/`), token-driven (`--ds-*`): `primary`, `secondary`,
  `choice`, and three `sort` tones; ≥ 64 px targets; focus rings. No ad-hoc
  button CSS in the word ladder.

| Context | Touch | Keys |
|---|---|---|
| Flashcard | tap card = flip (both ways) | Space / Enter |
| Sort | Not yet · Familiar · Got it | 1 · 2 · 3 |
| Undo last sort | Undo | U |
| Choices / Don't know | tap | 1–4 / 0 |
| Continue | Next | Space / Enter |
| Hear again | speaker | H |
| Quiz me | button | Q |
| Typing | field / keypad | keys go to the field; Enter submits |

- **Focus:** on submit, focus leaves the field and returns to the stage, so
  Space / 1–4 work on the next item immediately. Esc is never used (FKB
  captures it).
- **On-screen jamo keypad:** there is no web API that detects a Bluetooth
  keyboard, so the keypad is a **toggle** on every typing item. It opens by
  itself — at most once per item — when the field has had focus 10 s with no
  keydown, and closes on the
  first physical keydown. Two-set layout with a Shift key for ㄲ ㄸ ㅃ ㅆ ㅉ
  ㅒ ㅖ, backspace and submit; feeds a new `FieldComposer.offerJamo(jamo)` seam
  in `modules/School/ime/` (the composer today only consumes `KeyboardEvent.code`).
  A stage-size mock of `type-keypad` (card + 3-row keypad in 800 px height) is
  a plan deliverable before build.
- **Audio autoplay:** the sitting starts with a **Start** tap, which unlocks
  audio for the page. FKB's autoplay setting is required on the Portal (listed
  in the School runbook). A blocked clip leaves the large speaker button and
  logs `audio.played outcome: blocked` at info.
- **Quiz feedback:** right → tick; wrong / Don't know → the correct answer with
  Korean audio; a typed pass below 10 → "Got it! Here's the spelling" with the diff.

### Screens in order

Start → rechecks → drill → rounds (introduce → stream → round-end quiz → drill
offers) → summary → **practice menu**: Flashcards (front side: Korean or
meaning; shuffle; prev/next; undo) · Match · Say (With help / Without help) ·
Write (With help / Without help) · Listen · Drill (pick words) · Quiz me · My
words.

### Grown-up word controls (teacher console, per learner, per package)

Word list with state, stage, due, streak, tricky, and last graded answers
with judge score and reason; actions: **reset to new**, **mark mastered (stage n)**, **exclude**
(removed from rounds and rechecks), **re-grade** a logged answer (e.g. a judge
verdict a grown-up disagrees with). All logged `school.word-ladder.admin`.

---

## 7. Tuning agent

Mostly watches; acts only by setting the engine's thresholds within grown-up
bounds. It never grades, never writes word states, never generates items.

| Setting | Decides | Default (bounds) |
|---|---|---|
| `round.size` | words per round | 5 (3–7) |
| `drill.afterMisses` | graded-miss streak → tricky | 2 (1–3) |
| `batch.newPerDay` | new words per day | 4 (2–6) |
| `batch.workingSet` | unsettled-word cap | 7 (4–10) |
| `review.gapScale` | recheck gap multiplier | 1.0 (0.5–1.5) |
| `review.typedEvery` | typed-recheck cadence below stage 2 | 2 (1–4) |

Grown-up settings only: `session.capMinutes` (15), `drill.perSitting` (1),
`round.maxPasses` (3), `typing.passScore` (6).

- **Where:** defaults and bounds in the household School config; current values
  per learner per package in `tuning.yml` beside `status.yml`.
- **When:** **once per study day**, at the 4am rollover (existing agent
  scheduler), over the day just ended — skipped if that day had no sitting that
  reached its goal or cap. Sittings closed `idle`/`unmount` alone never trigger
  it.
- **Brakes:** changes take effect at the **next first open**, never mid-day;
  each setting moves **one step** at a time (round/batch/afterMisses ±1,
  gapScale ±0.1, typedEvery ±1) and **at most once per 5 study days**; values are
  clamped to bounds by the engine.
- **Input:** a deterministic digest (~1–2k tokens) from a pure domain function:
  per-word state/stage/streak/tricky/drill count; round-end pass rate by pile
  (Familiar vs Got it — calibration); Don't-know counts; judge score
  distribution and fallback rate; time per
  step vs estimate; stalls; cap hits; days credited with zero quizzed words; today vs trailing 7 study days; the
  settings' last change dates.
- **Model:** a small configured model via the agent framework
  (`3_applications/agents/word-ladder-tuner/`, `BaseAgent`, `MastraAdapter`), no
  tools, structured output
  `{status: on-track|stuck|coasting|concern, notes: string[≤3], changes: [{setting, to, reason}]}`.
  Proposed changes violating a brake are dropped and logged.
- **Visibility:** every change logged (`school.word-ladder.tuning`) and listed in
  the teacher console with undo; `concern` sends a push
  (`docs/reference/notifications/push-standard.md`); a failed or timed-out run
  changes nothing.

---

## 8. Door, test mode, observability

### Door

```
/school/go/<learner>/word-ladder              the real sitting
/school/go/<learner>/word-ladder/test         read-only test sitting
/school/go/<learner>/word-ladder/<pkg>[/test] when the learner has >1 package
```

Extends the code-free door (`IssueDirectLaunch`): a `word-ladder` launcher
resolves the deck from the learner's current word-ladder enrollment; with
several packages a bare URL 404s listing them. `/test` is a reserved final
segment parsed into a `test` flag; a program without test mode refuses a
`/test` URL.

### Printed quiz (per learner)

The printed OMR quiz covers only words the learner has been introduced to.

- `node cli/school.mjs word-ladder quiz --learner <id> --package <pkg> [--week <iso-week>]`
  reads the learner's status and writes a quiz source over introduced,
  non-excluded words: this week's introductions first, then unsettled words,
  then a sample of mastered words, up to the sheet's row limit. Document id
  `language/<lang>/<pkg>-quiz-<learner>-<iso-week>`; published and rendered
  (`variety=omr`) as today.
- The fold recognises any document whose id starts with
  `language/<lang>/<pkg>-quiz-` as belonging to the package (replacing the
  per-deck `quizDocumentIds` match), and applies the rows only to the learner
  who was scanned.
- The existing per-deck quiz command stays for a grown-up who wants the whole
  deck on paper; its misses on un-introduced words are logged only (rule 3).

### Test mode

A second service instance over a **shadow status store** (in-memory deep copy
of the learner's real `status.yml`, `tuning.yml` and today's day file,
snapshotted at open)
and a discarding recordings sink, at `/api/v1/school/word-ladder/test/*`.
The typed-answer judge still runs (so verdicts can be tested) but its cache is
the shadow's, in memory — test mode never writes `judgements.yml`. Same
engine and grading; nothing reaches disk. Ids `test.<pkg>.<id>` are refused by
the live router and vice versa. 3 h TTL, max 20 sittings; eviction/restart →
404 → reopen. Banner "TEST — nothing is saved". Seeds `?scenario=`: `today`,
`fresh` (empty), `round-end` (every deck word Familiar/Got it → quiz),
`due` (every word mastered and due → rechecks), `tricky` (streak at threshold →
drill), `done` (goal met → menu), `typos` (a round whose typed items the test harness answers with
misspellings, a decoy word, English and empty input). Automated tests assert the
exact, no-Hangul, different-word, deterministic and cache paths directly and
drive the model path only through a fake `IAIGateway`; a live-model call happens
only when a person types into a test sitting. The tuner never runs on test sittings. A backend test runs a full test
sitting and asserts `status.yml` and the day file are byte-identical and no
recording was written.

### Events

Frontend `context.component: school-word-ladder`, all `info` unless noted; every
event carries `traceId`, `sittingId`, `seq`, `t`, `learnerId`, `deckId`,
`package`, `mode` (`live|test`):
`sitting.opened` · `item.shown` {task, wordId, layout, media, fontPx} ·
`item.answered` {response, correct?, score?, judge: exact|guard|model|fallback|cache, ms} · `card.flipped`
{ms} · `card.sorted` {pile} · `card.undone` · `round.started` / `round.ended`
{quizzed, notYet} · `drill.offered` {accepted} · `audio.played` {kind, outcome} ·
`media.failed` (warn) · `item.prompt-fallback` (warn) · `keypad.toggled` {auto} ·
`item.stalled` (warn, 45 s / 120 s) · `notice.shown` (warn) · `visibility` ·
`layout.clamped` (warn) · `sitting.closed` {reason, activeMs, remaining}.
Backend: `school.word-ladder.{opened,graded,transition,folded,closed,tuning,admin}`
with `mode`. Volume ≈ 6–8 events per item, ~300 per sitting.

### `school word-ladder trace`

`node cli/school.mjs word-ladder trace --learner <id> [--day D | --sitting ID] [--mode live|test|all]`
— queries `$DAYLIGHT_LOGSTORE` (default `http://localhost:9428`), orders by `seq`
within `traceId`, merges backend transitions, prints a timeline (task, word,
layout, response, time, transitions) with stalls flagged and the item the
sitting ended on marked. Pure `formatTrace(events)`, unit-tested. The day file
is the fallback source when the log store has aged out.

---

## 9. Build order

1. **Domain (pure):** status v3 + day files, level model and transitions,
   normalisation + decoy guard + fallback distance, choice building, `next()` engine with rounds/piles/verify/
   rechecks/drill queue/goal/cap, migration. Exhaustively unit-tested; no UI.
2. **Application + API + door + test mode + typed-answer judge** on that engine (the first usable
   URL: `/school/go/<learner>/word-ladder/test`).
3. **Stage, button primitive, text fitting, keypad mock.**
4. **Screens:** start, rechecks, introduce, stream, round-end quiz (choices,
   typing, keypad), summary.
5. **Per-learner printed quiz** (CLI + fold by document prefix).
6. **Drill + practice menu** (look, copy, say-after, read-aloud, dictation,
   pick-spelling, match, tiles, say-from-cue, listen, My words).
7. **Observability + trace CLI.**
8. **Grown-up word controls** in the teacher console.
9. **Tuning agent** (scheduler, digest, brakes, console list + undo).
10. **Docs:** rewrite `docs/reference/school/word-ladder.md`; teacher.md (door,
   word controls); School runbook (FKB autoplay).

Each step is verified behind the test door at stage size (screenshots looked
at, containment asserted) before the live door is switched to the new engine.

## Out of scope

Speech-recognition scoring (speaking is never graded); a teacher-console trace
viewer; test mode for other programs; the audition files in
`words/week-01-classroom/gawi/` and `words/week-01-classroom/_deleteme/`.
