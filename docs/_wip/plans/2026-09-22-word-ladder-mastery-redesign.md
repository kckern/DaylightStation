# Word ladder — mastery redesign

Status: design locked 2026-09-22, awaiting spec review
Replaces: `docs/_archive/2026-09-22-word-ladder-test-mode-layout-observability-design.md`
(rev 1 — its door, test mode and trace carry over here, rewritten for the new engine)
Benchmark: `docs/_wip/audits/2026-09-22-quizlet-benchmark-word-ladder.md`
Current code: `docs/reference/school/word-ladder.md`

## Why

The first word ladder was not a flashcard program. The flip was hidden behind
a recording gate; the picture sat on the Korean front and gave the meaning
away; a "Still learning" card vanished until tomorrow; mastery came from the
child's own "I know it". This redesign rebuilds it **in place** — the lexicon,
media, weekly decks, package-keyed storage, printed quiz and fold all stay —
around one model:

> **The child claims; the quiz verifies; only the quiz grades.**
> Self-study is flashcards the child sorts. Claims are verified by a short
> graded quiz. Mastered words come back at widening gaps. Words that keep
> slipping go to drill, which walks them from full support to none.

The learner (first enrollment: `korean-vocab`) reads Hangul slowly — sounds
out syllables — so text and audio travel together on cue sides, and decoding
("read it, no audio") is its own exercise.

---

## 1. Level model

### States (per learner, per package, per word)

| State | Child sees | Entered by |
|---|---|---|
| `new` | — | not introduced |
| `notYet` | Not yet | child's sort |
| `familiar` | Familiar | child's sort, or demotion after a graded miss |
| `claimed` | Got it | child's sort; awaits the verify quiz |
| `mastered` stage 0 | Mastered ⭐ | verify quiz passed; due next study day |
| `mastered` stage n | Mastered ⭐… | n scheduled rechecks passed |

`tricky` is a flag orthogonal to state: set when the graded-miss streak reaches
`drill.afterMisses`; cleared by the next graded pass.

### Rules

1. **Only the quiz grades.** The verify quiz, scheduled rechecks and the paper
   quiz are the only events that promote to or demote from `mastered`. Nothing
   in flashcards, drill, match, say, write or listen changes a level except
   rule 2.
2. **Self-sorting moves down freely, up only to `claimed`.** A mastered word
   sorted Not yet / Familiar in practice drops to that state; Got it on a
   mastered word changes nothing. (Children over-claim; they don't over-confess.)
3. **A graded miss demotes to `familiar`,** never to `new`/`notYet`.

### Transitions

| Event | Result |
|---|---|
| Verify quiz: all 3 right | `claimed` → `mastered` stage 0, due next study day; streak 0; `tricky` cleared |
| Verify quiz: any wrong | → `familiar`; streak +1; streak ≥ `drill.afterMisses` → `tricky` |
| Recheck right | stage +1; next due = today + `GAPS[stage]` × `review.gapScale` study days, `GAPS = [1, 3, 7, 14, 30, 60]`, capped at the last |
| Recheck wrong | → `familiar`, stage reset; streak +1 (same `tricky` rule) |
| Paper row miss (fold) | as a recheck miss; on a `new` word: logged only |
| Paper row pass | logged only (paper demotes, never promotes) |

### Working set and new words

- **Active** = `notYet` ∪ `familiar` ∪ `claimed`. At most `batch.workingSet`
  (default 7) are active.
- Each study day introduces `min(batch.newPerDay, workingSet − active)` new
  words in deck order. The weekly deck is the pool; earlier decks' words ride
  along via rechecks and the working set.

### Done for today (goal, with a time cap)

Goal = every due recheck answered · the day's drill run (up to `drill.perSitting` tricky words, default 1) · every word
introduced today sorted at least once · every word claimed today through one
verify quiz. **Or** `session.capMinutes` (default 15) of **active** time — a
card with no input for 45 s stops the clock. Unfinished items carry over. Credit
(`doneToday`) is either; the practice menu unlocks at either.

### Days and storage

Study day = School's (4am→4am, household timezone). Status v3 at
`data/users/{learnerId}/apps/school/word-ladder/<package>/status.yml`:

```yaml
schema: school.word-ladder-status/v3
words:
  gawi:
    state: mastered        # new | notYet | familiar | claimed | mastered
    stage: 1
    dueDay: 2026-09-26
    missStreak: 0
    tricky: false
    introducedDay: 2026-09-22
    history:               # append-only; every graded and self event
      - { at, day, event: sort, value: claimed, sitting }
      - { at, day, event: graded, task: "3.3", correct: true, source: verify|recheck|paper, sitting|attemptId }
days:
  2026-09-22:
    agenda: { rechecks: [...], introduce: [...], tricky: [...], deckId }   # frozen at first open
    sittings: { <sittingId>: { openedAt, closedAt, reason, activeMs } }
lastFoldedDay: 2026-09-22
```

Tuning lives beside it in `tuning.yml` (§6). Migration v2→v3: NEW→`new`,
LEARNING→`familiar`, CLAIMED→`claimed`, KNOWN step n→`mastered` stage n; frozen
v2 day plans are dropped (the one live learner has one unmarked plan).

---

## 2. Task catalogue (MECE)

A task = **what is given → what is produced.** Four top branches; leaves split
by support, then response. Every combination is listed; excluded ones say why.

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
├─ 2  KOREAN → MEANING (receptive)       channel: hear (audio only) │ read (text only) │ both
│   ├─ 2a SELF-CHECKED
│   │   └─ 2.1 flashcard .... Korean → recall → flip → sort               stream · Flashcards
│   ├─ 2b RECOGNISE
│   │   ├─ 2.2 pick-meaning . hear│read → 4 meanings                     ★ GRADED
│   │   └─ 2.3 match ........ 4–6 Korean ↔ picture/English pairs          drill · Match
│   └─ 2c PRODUCE
│       ├─ ✗ type English — tests English spelling, not Korean
│       └─ ✗ say English  — ungradeable; adds nothing over 2.1
│
└─ 3  MEANING → KOREAN (productive)      cue: picture │ English text │ English audio
    ├─ 3a SCAFFOLDED
    │   ├─ 3.1 pick-term .... cue → 4 Korean (authored decoys)            ★ GRADED
    │   └─ 3.2 tiles ........ cue → build from syllables + 2 decoy syllables   drill
    └─ 3b UNSUPPORTED
        ├─ 3.3 type-from-cue  cue → type the Korean                       ★ GRADED
        └─ 3.4 say-from-cue . cue → say → native plays → self-compare     drill · Say  [never graded]
```

- **Graded: 2.2, 3.1, 3.3 only.** Verify quiz = one of each per word. Recheck =
  one, rotating 2.2 / 3.1, every `review.typedEvery`-th is 3.3.
- **Speaking is never graded** (1.2, 1.3, 3.4). Its takes are saved for a
  grown-up to hear if they want; nothing waits on them.
- **Practice "With help" = 1a + 3a; "Without help" = 1b + 3b.**
- **Drill path per tricky word:** 0.1 → 1.1 → 1.2 → 2.3 → 1.3 → 1.4 → 3.2 → 3.4 → 3.3
  (support withdrawn in ~2–3 minutes; 3.3 here is practice, not graded).
- **Introduction:** 2.1 (first sight; the flip is the teaching) → 1.1 → 1.2.
- **Typing is in every word's life:** 1.1 at introduction, 3.3 in every verify
  quiz, typed rechecks thereafter.

### Typed input

- Physical keyboard (the Portal has a bonded Korean/English Bluetooth
  keyboard) through School's in-page Hangul IME (`modules/School/ime/`).
- No keyboard detected → an **on-screen jamo keypad** driving the same IME
  automaton. Syllable tiles are a drill scaffold, never a substitute for typing.
- Comparison: exact after normalising whitespace and punctuation (the
  Sentence Ladder's `normalize`), so `이름이뭐예요` = `이름이 뭐예요?`. A miss
  shows the typed answer against the target, jamo-aligned. Supported typing
  (1.1, 1.4) repeats until it matches; graded typing (3.3) is one attempt.

### Choices

- Meaning choices are **pictures when all four options have one** (decoys =
  other deck words with images), else English text (authored gloss decoys).
- Korean choices use authored term decoys; phrase decoys only from phrases.
- Deterministic per learner + day + sitting (seeded), so a reload repeats.

---

## 3. Lifecycle

```
                        ┌───────────┐
                        │    NEW    │  in the deck pool
                        └─────┬─────┘
                              │ room in working set (≤ newPerDay today)
                              ▼
            ╔═════════════════════════════════════╗
            ║ INTRODUCE (once, supported)         ║
            ║  2.1 flashcard → flip → reveal      ║
            ║  1.1 copy-type   (always)           ║
            ║  1.2 say-after   (if mic + audio)   ║
            ╚═════════════════╤═══════════════════╝
                              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ SELF-STUDY STREAM  (2.1, looping)                             │
   │   sort ──► NOT YET ──┐                                        │
   │        ──► FAMILIAR ─┼─► returns ~3 cards later ──────────────┘
   │        ──► GOT IT ───┼──────────────────────┐
   │   Not yet × drill.notYetInSitting ─► offer DRILL ─(yes)─► DRILL ─► stream
   └──────────────────────────────────────────────────────────────┘
                                                 ▼
                                        ┌──────────────┐
                                        │   CLAIMED    │
                                        └──────┬───────┘
          claims ≥ verify.promptAfterClaims · all Got it · stream end · "Quiz me"
                                               ▼
            ╔═════════════════════════════════════════════════╗
            ║ VERIFY QUIZ (graded, unsupported)                ║
            ║  2.2 pick-meaning · 3.1 pick-term · 3.3 type     ║
            ╚════════════╤═══════════════════════╤════════════╝
                   all 3 right                any wrong → answer shown now
                         ▼                       ▼  streak +1
              ┌─────────────────────┐    ┌───────────────┐
              │ MASTERED stage 0    │    │ FAMILIAR      │──► SELF-STUDY
              │ due next study day  │    └──────┬────────┘
              └──────────┬──────────┘           │ streak ≥ drill.afterMisses
                         │                      ▼
                         │              ┌───────────────┐  Today runs a DRILL
                         │              │ + TRICKY      │  before its next quiz
                         ▼              └───────────────┘
            ╔═════════════════════════════════════════════════╗
            ║ RECHECK when due (graded, 1 task)                ║
            ╚════════════╤═══════════════════════╤════════════╝
                       right                   wrong ─► FAMILIAR (stage reset) ─► SELF-STUDY
                         ▼
              MASTERED stage n+1 — next gap 1·3·7·14·30·60 × gapScale ──► RECHECK …

  SIDE DOORS: paper miss = recheck miss (NEW stays NEW) · paper pass = logged ·
  practice self-sort can lower a MASTERED word · practice "Quiz me" = VERIFY QUIZ ·
  drill / match / say / write / listen never change state
```

### Media adaptation (nothing ever blocks)

| Step | Has picture | No picture | No term audio |
|---|---|---|---|
| Reveal 0.2 | picture + English | English, large | unchanged |
| 1.2 say-after | ✓ | ✓ | skipped |
| 2.2 choices | pictures if all 4 have one, else English | English | "read" only |
| 3.1 / 3.3 cue | picture or English (rotates) | English text or English audio | unchanged |
| 3.4 cue | picture | English | native comparison skipped |
| 2.3 match | Korean ↔ picture | Korean ↔ English | unchanged |
| 1.4, 0.3 | ✓ | ✓ | skipped |
| Typing (1.1, 3.3, typed rechecks) | always | always | always |

A phrase's `pronunciation` shows on the reveal only — never on a graded cue.
No mic → speaking leaves are skipped in drill and absent from practice; never a
block.

---

## 4. The sitting engine (server)

`next(words, sitting, agenda, settings, rng) → item` — one deterministic
function in `2_domains/school/wordLadder/`, pure and unit-tested; the
application service persists answers and calls it. Order within a sitting:

1. Due rechecks (shuffled).
2. Drill for up to `drill.perSitting` (default 1) `tricky` words, ~2–3 min each; the rest wait for later sittings.
3. Introductions for today's new words (2.1 → 1.1 → 1.2).
4. The self-study stream over the working set; unsorted-to-Got-it cards return
   ~3 items later.
5. Verify prompt per §3 triggers: **Quiz me** / **Keep studying** (re-prompts
   after another `promptAfterClaims` claims and at stream end). A **Quiz me**
   control is always visible once anything is claimed.
6. Verify quiz: 3 tasks per claimed word, interleaved so a word's tasks never
   sit adjacent; the word's verdict applies when its third task is answered.
7. Drill offer on the `notYetInSitting` rule.
8. Goal met → summary (today's words by state) → practice menu.

### API (thin; replaces the v2 plan/checks/cards/mark/review routes)

- `POST /word-ladder/open {learnerId, deckId}` → `{sittingId, day, agenda, item, progress}`
- `POST /word-ladder/sittings/:id/items/:itemId {response}` → `{result, item, progress}`
  where `response` is `{sort}`, `{choice}`, `{typed}`, `{prompt: quiz|later}`,
  `{done: true}` (exposure/drill steps), `{take}` metadata for say tasks.
- `POST /word-ladder/sittings/:id/recordings/:itemId` (raw audio; say tasks)
- `POST /word-ladder/sittings/:id/close {reason}`
- `GET  /word-ladder/sittings/:id` → current item + progress (reload)
- `POST /word-ladder/sittings/:id/practice {mode, help, filter}` → a practice run
  (menu; only after the goal)
- `GET  /word-ladder/words?learnerId&package` → My words grid

Item ids make every response idempotent. A sitting belongs to its study day;
after 4am it 404s and the client reopens. `dayStatus` (term grid, credit,
replay) reads the frozen agenda plus the day's history.

---

## 5. Screens

### The stage

- The program renders inside a **fixed stage** whose size comes from config,
  never from code: School's household config names the target screen
  (`stage.screen`, set to the Portal screen), and the stage reads that screen's
  `resolution` from `/api/v1/screens/<id>` (today `screens/portal.yml`:
  1280×800). On the Portal the stage is the viewport; in a desktop browser it is
  that exact box, centred, uniformly scaled down if the window is smaller —
  what a grown-up sees is what the child sees.
- Stage grid: **header** (goal progress, pile counts, Leave) · **card** · **controls**.
  Content centred on both axes in every region.

### Layouts (by task + available media, never a hole)

`flashcard-front` · `flashcard-back-picture` · `flashcard-back-text` ·
`choice-text-prompt` · `choice-picture-prompt` · `choice-audio-prompt` ·
`choice-picture-answers` · `type` · `say` · `match` · `tiles` · `look` ·
`summary` · `menu` · `words`. A picture that fails at runtime switches to the
text layout and logs `media.failed`; an audio prompt that fails switches 2.2
from *hear* to *read* (logged `item.prompt-fallback`).

### Text fitting

Never break inside a word (`word-break: keep-all`, no hyphens). Each text role
fits the largest size that fits its region in ≤ N lines (term 2, gloss 3,
choice 2) between per-role min/max; the four choices share one size (the
smallest needed) so length never hints at the answer; at the minimum, overflow
wraps anywhere and logs `layout.clamped` (warn) — never clips silently. Pure
`fitFontSize({measure, min, max, maxLines})` + `<FitText>`/`<FitGroup>`, refit on
`ResizeObserver` and `document.fonts.ready`.

### Buttons and controls

- A **touch button primitive** added to the design-system barrel
  (`frontend/src/lib/ui/`), token-driven (`--ds-*`), variants `primary`,
  `secondary`, `choice`, and three `sort` tones (Not yet / Familiar / Got it
  from status tokens); ≥ 64 px targets; focus rings kept. No ad-hoc button CSS
  in the word ladder.
- Input map (touch and keyboard, identical meaning):

| Context | Touch | Keys |
|---|---|---|
| Flashcard | tap card = flip (both ways) | Space / Enter = flip |
| Sort (after flip) | Not yet · Familiar · Got it | 1 · 2 · 3 |
| Choices | tap | 1–4 |
| Continue / Next | button | Space / Enter |
| Hear again | speaker button | H |
| Quiz me | button | Q |
| Typing | field / on-screen keypad | typing goes to the field; shortcuts off while it has focus; Enter submits |

  Esc is never used (FKB captures it on the Portal).

### Screens in order

Today (header shows the goal) → items → verify prompt → quiz feedback (right:
tick; wrong: the correct answer, Korean audio plays) → summary → **practice
menu**: Flashcards · Match · Say (With help / Without help) · Write (With help /
Without help) · Listen · Drill (pick words) · Quiz me · My words.

---

## 6. Tuning agent

Mostly watches; acts only by setting the engine's thresholds, within grown-up
bounds. It never grades, never writes levels, never generates items.

| Setting | Decides | Default (bounds) |
|---|---|---|
| `verify.promptAfterClaims` | claims before the quiz prompt | 5 (3–8) |
| `drill.afterMisses` | graded-miss streak → tricky | 2 (1–3) |
| `drill.notYetInSitting` | Not yets on a card → drill offer | 3 (2–5) |
| `batch.newPerDay` | new words per day | 5 (2–7) |
| `batch.workingSet` | active-word cap | 7 (4–10) |
| `review.gapScale` | recheck gap multiplier | 1.0 (0.5–1.5) |
| `review.typedEvery` | recheck typed cadence | 2 (1–4) |

`session.capMinutes` and `drill.perSitting` are grown-up settings only.

- **Where:** defaults and bounds in the household School config; current values
  per learner per package in `tuning.yml` next to `status.yml`.
- **When:** once per closed sitting (backend, in the background). The sitting
  never calls a model; it reads stored values.
- **Input:** a deterministic **digest** (~1–2k tokens) built by a pure domain
  function: per-word state, stage, streak, drill count; claim→verify pass rate
  (calibration); time per word; stalls; cap hits; today vs. trailing 7 days.
- **Model:** a small, configured model (not hard-coded) via the agent framework
  (`3_applications/agents/word-ladder-tuner/`, `BaseAgent`, `MastraAdapter`),
  no tools, structured output:
  `{status: on-track|stuck|coasting|concern, notes: string[≤3], changes: [{setting, from, to, reason}]}`.
- **Safety:** the engine clamps every value to bounds; each change is logged
  (`school.word-ladder.tuning`) and listed in the teacher console with undo; a
  failed or timed-out run changes nothing. `concern` sends a push notification
  (per `docs/reference/notifications/push-standard.md`).

---

## 7. Door, test mode, observability

### Door

```
/school/go/<learner>/word-ladder              the real sitting
/school/go/<learner>/word-ladder/test         read-only test sitting
/school/go/<learner>/word-ladder/<pkg>[/test] when the learner has >1 package
```

Extends the existing code-free door (`IssueDirectLaunch`): a `word-ladder`
launcher resolves the deck from the learner's current word-ladder enrollment.
`/test` is a reserved final segment parsed into a `test` flag; a program
without test mode refuses a `/test` URL (never falls through to a live one).

### Test mode

A second service instance over a **shadow status store** (in-memory deep copy
of the learner's real status, snapshotted at open) and a discarding recordings
sink, served at `/api/v1/school/word-ladder/test/*`. Same engine, same grading,
nothing reaches disk. Ids `test.<pkg>.<id>` are refused by the live router and
vice versa. 3 h TTL, max 20 sittings; eviction/restart → 404 → reopen. Banner
"TEST — nothing is saved". Seeds `?scenario=`: `today` (snapshot), `fresh`
(empty), `claimed` (every deck word claimed → verify quiz), `due` (every word
mastered and due → rechecks), `tricky` (streak at threshold → drill), `done`
(goal met → menu). The tuning agent never runs on test sittings. A backend test
runs a full test sitting and asserts the real `status.yml` is byte-identical and
no recording was written.

### Events (frontend `context.component: school-word-ladder`; all `info` unless noted)

Every event: `traceId`, `sittingId`, `seq`, `t`, `learnerId`, `deckId`,
`package`, `mode` (`live|test`).

`sitting.opened` · `item.shown` {task, wordId, layout, media, fontPx} ·
`item.answered` {response, correct?, ms} · `card.flipped` {ms} ·
`card.sorted` {value} · `audio.played` {kind, outcome: ended|error|blocked} ·
`media.failed` (warn) · `item.prompt-fallback` (warn) · `verify.prompted`
{choice} · `drill.offered` {accepted} · `item.stalled` (warn, 45 s / 120 s) ·
`notice.shown` (warn) · `visibility` · `layout.clamped` (warn) ·
`sitting.closed` {reason: goal|cap|leave|idle|unmount, activeMs, remaining}.
Backend: `school.word-ladder.{opened,graded,transition,folded,tuning,closed}`
with `mode`.

### `school word-ladder trace`

`node cli/school.mjs word-ladder trace --learner <id> [--day D | --sitting ID] [--mode live|test|all]`
— queries `$DAYLIGHT_LOGSTORE` (default `http://localhost:9428`), orders by
`seq` within `traceId`, merges backend transitions, prints a timeline (task,
word, layout, response, time, transitions) with stalls flagged and the item the
sitting ended on marked. Pure `formatTrace(events)`, unit-tested.

---

## 8. Build order

1. **Door + test mode** on the current engine — a working, safe URL first.
2. **Stage, button primitive, text fitting** — the frame everything renders in.
3. **Status v3 + level model + migration** (domain, pure).
4. **Sitting engine + API** (introduce, stream, verify, rechecks, goal/cap).
5. **Screens** for stream + verify + summary (flashcard, choices, typing incl.
   on-screen keypad).
6. **Drill + practice menu** (look, copy, say-after, read-aloud, dictation,
   pick-spelling, match, tiles, say-from-cue, listen, My words).
7. **Observability + trace CLI.**
8. **Tuning agent** + teacher-console panel.
9. Docs: rewrite `docs/reference/school/word-ladder.md`; teacher.md (door).

Each step ships behind the test door first and is verified there at the stage
size (screenshots looked at, containment asserted) before the live door.

## Out of scope

Speech-recognition scoring (speaking is never graded); a teacher-console trace
viewer; test mode for other programs; the audition files in
`words/week-01-classroom/gawi/` and `words/week-01-classroom/_deleteme/`
(nothing reads them).
