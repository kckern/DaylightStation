# Card ladder (two-sided card packages)

A flashcard enrollment in `policy.mode: card-ladder`. **The child sorts; the
round-end quiz verifies; only a quiz grades.** Self-study is flashcards the
child sorts into three piles (Not yet / Familiar / Got it); every word not
sorted Not yet is quizzed at the end of its round; mastered words come back at
widening gaps.

The card ladder is **language-neutral**. Language learning is the primary use,
but the engine serves any two-sided card: English-to-English definitions,
history, and so on. Everything that names a language — which one is being
learned, which one the meanings are written in, the tile title — lives in a
**package**'s lexicon YAML. Adding a language (or a subject) is new YAML +
media, never a code change. Korean (`korean-vocab`) is the worked example
throughout.

**Renamed 2026-09-23.** This engine was the *word ladder* until then. Every
old name still works — see [Renamed from word ladder](#renamed-from-word-ladder-2026-09-23).

### The two sides: target and anchor

Every card has two sides, named by **role**, never by language:

| Side | Meaning | Lexicon field | API / item field |
|---|---|---|---|
| **target** | what is being acquired — typed from memory at the sign-off | `term:` (or `target:`) | `word.term`, `prompt` on 2.2, choices on 3.1 |
| **anchor** | what the learner already holds it by — the prompt side, which shows everything | `gloss:` (or `anchor:`) | `word.gloss`, the `cue` on 3.1 / 3.3 / drill steps |

`term`/`gloss` stay the readable field names in the lexicon and in existing
API payloads; they MEAN target/anchor. New code and UI names say
target/anchor: the recall cue is `{type: 'anchor', …}` (`items/AnchorCue.jsx`),
the client's languages are `langs = {target, anchor, targetScript}`, and
`POST /card-ladder/open` returns `target: {code, name, script}` and
`anchor: {code, name}` beside the older `language` / `gloss`.

The progress rungs (new → introduced → learning → recognised → mastered) and
the sort piles (Not yet / Familiar / Got it) are unchanged.

Spec: `docs/_wip/plans/2026-09-22-word-ladder-mastery-redesign.md` (rev 4).
This page describes what **Plan 1 (core loop)** and **Plan 2 (tricky-word
drill, speaking, on-screen keypad, practice menu)** actually ship; see
[What is not yet built](#what-is-not-yet-built) for the rest.

## Where things live

| What | Where |
|---|---|
| Lexicon | `media/school/language/<package>/lexicon.yml` (e.g. `language/korean-vocab/lexicon.yml`) |
| Word media | `media/school/language/<package>/words/<group>/<id>/{image.jpg,term.mp3,gloss.mp3}` |
| Weekly deck | `data/content/school/learning-catalog/flashcard-decks/<deck id>.yml` (`lexicon:` + `words:`), e.g. `language/korean/week-01-classroom` |
| Enrollment | learner plan `programs:` → `{programId: flashcards, deckId, title, policy: {mode: card-ladder}, schedule}` |
| Status (v3) | `data/users/{learnerId}/apps/school/card-ladder/<package>/status.yml` |
| Day file | `data/users/{learnerId}/apps/school/card-ladder/<package>/days/<studyDay>.yml` |
| Judgement cache | `data/household/school/runtime/card-ladder/<package>/judgements.yml` (derived, shared across learners) |
| Spoken takes | `media/school/recordings/card-ladder/<package>/<learnerId>/<studyDay>/<wordId>-<n>.<ext>` (for grown-ups; never graded) |
| Program poster | `media/school/programs/card-ladder/<package>/poster.jpg` (JPEG, 2:3), falling back to the pre-rename `programs/word-ladder/<package>/poster.jpg` — served at `/api/v1/school/self-service/programs/card-ladder/<package>/poster.jpg`; missing = 404 and the surface draws its own placeholder |
| Code (domain) | `backend/src/2_domains/school/cardLadder/` — pure engine, states, choices, rounds, the target-script seam (`targetScript.mjs`) and Hangul scoring (`jamo.mjs`), settings, scenarios |
| Code (application) | `backend/src/3_applications/school/{CardLadderSittingService,CardLadderTypedJudge,CardLadderDoorLauncher}.mjs` |
| Code (adapters) | `backend/src/1_adapters/school/cardLadder/{YamlCardLadderStore,ShadowCardLadderStores,YamlJudgementCache,FilesystemCardLadderRecordings,DiscardingRecordings}.mjs` |
| Code (API) | `backend/src/4_api/v1/routers/school.cardLadder.mjs` |
| Code (frontend) | `frontend/src/modules/School/Programs/Flashcards/CardLadder/` |

Everything per learner is keyed by the lexicon's `package`: status, day files
and the judgement cache. Word ids need only be unique **within** a package.

## The lexicon (`school.word-lexicon/v2` or `school.card-lexicon/v3`)

```yaml
schema: school.word-lexicon/v2
package: korean-vocab            # stable id — status and the capability key use it
language: { code: ko, name: Korean }    # the TARGET side's language (BCP-47 code → lang= attributes, script)
gloss:    { code: en, name: English }   # the ANCHOR side's language (a header block, not the entry field)
program:
  title: UBKS 비둘기              # the CLASS: the course line of the launch card (start screen + agenda tile)
entries:
  - id: gawi                     # permanent once studied
    kind: word                   # word | phrase
    group: week-01-classroom     # the course unit that FIRST introduced the word; names its media folder
    term: 가위                    # the target side (may be spelled target:)
    gloss: Scissors              # the anchor side (may be spelled anchor:)
    pronunciation: null          # required for a phrase
    decoys:
      term: [가지, 바위, 가방]      # ≥3, confusable, never the answer
      gloss: [Knife, Tape, Ruler]
```

**Schema note.** Both schemas are read and mean the same thing; v3 only
renames the two language blocks by role:

| | `school.word-lexicon/v2` | `school.card-lexicon/v3` |
|---|---|---|
| target language block | `language:` | `target:` |
| anchor language block | `gloss:` | `anchor:` |
| entry sides | `term:` / `gloss:`, or `target:` / `anchor:` | the same |
| decoy sides | `decoys.term` / `decoys.gloss`, or `decoys.target` / `decoys.anchor` | the same |

An entry that gives both spellings of one side must give the same text
(otherwise the lexicon is refused). The parsed lexicon carries `language` /
`gloss` (as before) plus `targetLanguage`, `anchorLanguage` and
`targetScript` (`scriptFor(targetLanguage.code)`: `ko` → `hangul`, `en`/`es`/…
→ `latin`, `ru` → `cyrillic`, `el` → `greek`, `zh` → `han`, `ja` → `kana`,
`ar`/`fa` → `arabic`, an unknown code → `generic`; see
[Grading by script](#grading-by-script)). An English-to-English definitions package is a v3 lexicon
with `target: {code: en}` and `anchor: {code: en}`.

**`program.title` is the class name.** It is the course line of the launch
card — the start screen's heading and the agenda tile's course — so set it to
what the child calls the class ("UBKS 비둘기"), not to the language. A deck's
own `title` (e.g. "Week 1: Classroom") is the unit line under it.

`package`, `language`, `gloss`, `program.title` and every entry's `group` are
required; `package`, `id` and `group` are strict lowercase slugs (path-safe).

**Groups.** A package's word folders are grouped by course unit so the media
tree stays browsable: a new week is a new `group` folder. `group` records where
a word was **first** introduced — a later deck may reuse words from any group.
Status is keyed by word id alone, so moving a word to another group (move its
folder AND change its `group`) loses no progress.

## States and transitions

| State | Child sees | Entered by |
|---|---|---|
| `new` | — | not introduced |
| `introduced` | New | introduction; left on the first sort |
| `notYet` | Not yet | child's sort |
| `familiar` | Familiar | child's sort, a failed verify, a failed recheck, or a paper miss on a claimed/mastered word |
| `claimed` | Got it | child's sort |
| `mastered` stage 0 | Recognised ⭐ | a passed (recognition) verify; due next study day |
| `mastered` stage s ≥ 1 | Recognised ⭐…, or **Mastered** ⭐… once signed off | s passed rechecks |

### The sign-off ladder (ruling 2026-09-23)

> **Typing from memory is the final sign-off only — recognition → claim →
> match → typed sign-off. Recording is practice only, never a quiz or a
> prerequisite.**

The child is never asked to type a word from memory, from sound, or from
English until they have shown they can recognise it, claimed it, and matched
it. Copy-typing (1.1) with the word on screen is fine at any time (Learn,
drill, Write with help); speaking is never graded and never gates anything.

Per-word flags in status v3 (`mastery.mjs`):

| Flag | Set by | Meaning |
|---|---|---|
| `recognizedCount` | every passed recognition task that ends a word's check: a verify pass (round quiz or practice Quiz me) and a recognition recheck pass | how many times the word was recognised |
| `matched` | finishing a guided Match or a practice Match with the word on the board | the word was matched |
| `typedSignedOff` | the first passed typed recheck (the study day); cleared by a typed miss or any demotion out of `mastered` | **Mastered** — signed off |

`readyForSignOff(word)`: `mastered` (claimed-and-verified), stage ≥ 1 (its
2nd-or-later recheck), `recognizedCount ≥ 2` (the round quiz plus the first
recheck), `matched`, and not straight after a typed miss. What people read is
`ladderLevel(word)`: `new`, `introduced`, `learning` (notYet / familiar /
claimed), `recognised` (mastered, not signed off), `mastered` (signed off).
The child's My words and the teacher Cards tab both label by it; the API adds
`level`, `recognizedCount`, `matched` and `typedSignedOff` to each word row
beside the unchanged `state` / `stage`.

A grown-up's **Mark mastered** is a sign-off: it sets `typedSignedOff` (and
`recognizedCount ≥ 2`, `matched`).

**Only a quiz grades** (round-end verify, rechecks, the paper quiz). Sorting a
card, drill, match, say, write and listen never change a level except: sorting
moves a word down freely and up only to `claimed` (a mastered word sorted Not
yet/Familiar drops, stage reset; Got it on a mastered word does nothing). A
graded miss lands on `familiar` — never lower, never higher than the word
already was.

| Event | From | Result |
|---|---|---|
| Verify passed | `familiar`, `claimed` | `mastered` s0, due next study day; streak 0; tricky off |
| Verify failed | `familiar`, `claimed` | `familiar`; streak +1; `verifyFailedDay` = today |
| Verify passed | (also) | `recognizedCount` +1 — recognised, **not** signed off |
| Recheck passed | `mastered` s | stage s+1; due day + round(`GAPS[min(s+1,5)]` × `review.gapScale`) study days, `GAPS = [1, 3, 7, 14, 30, 60]`; a recognition pass adds 1 to `recognizedCount`, a typed pass sets `typedSignedOff` |
| Recognition recheck passed, straight after a typed miss | `mastered` s | stage unchanged, due the next study day — the typed sign-off comes straight back |
| Recognition recheck failed | `mastered` s | `familiar`, stage cleared; streak +1; sign-off cleared |
| **Typed recheck failed** | `mastered` s ≥ 1 | stays `mastered` (Recognised) at **stage 1**, due the next study day; streak +1 (tricky at the threshold); `typedSignedOff` cleared. Its next recheck is recognition — never back to learning, no spiral |
| Paper row miss (fold) | `familiar`, `claimed`, `mastered` | `familiar`, stage cleared; streak +1 |
| Paper row miss | `new`, `introduced`, `notYet` | logged only |
| Paper row pass | any | logged only |

`missStreak ≥ drill.afterMisses` sets `tricky` (flags the word — see
[The tricky-word drill](#the-tricky-word-drill-spec-3-drill-path) below).
Code: `backend/src/2_domains/school/cardLadder/mastery.mjs`.

## Rounds and the three piles

A **round** is up to `round.size` (default 5) quizzable words; a word is a
member of at most one round per study day. In the round's flashcard stream the
child sorts each card:

| Pile | Key | Returns after | At round end |
|---|---|---|---|
| **Not yet** | 1 | 2 other cards | not quizzed — unless `notYetCarry` is set (its second consecutive round end) |
| **Familiar** | 2 | 5 other cards, or last in the pass | quizzed |
| **Got it** | 3 | leaves the stream | quizzed |

The stream ends when no word's latest sort is Not yet, or after
`round.maxPasses` (default 3) passes, or the child taps **Quiz me**. **Undo**
reverses the last sort while its card is still the most recent.

A round runs **Learn › Sort › Quiz › Match**: introductions (flash → copy →
say-after), the sort stream, the round quiz (verify), then the guided Match.

**Round end (verify) — recognition only**: every word whose latest sort is
Familiar or Got it, plus every `notYetCarry` word, and whose `verifyFailedDay`
is not today. Per word, two graded **recognition** tasks (`VERIFY_TASKS` in
`practice.mjs`), stopping at the first miss — never a typed item:

1. **3.1 pick-term** — English cue → pick the Korean.
2. **2.2 pick-meaning, hear channel** (read channel if no term audio) —
   proves it is known by ear.

Right → the next task; wrong → the correct answer is shown (with audio), the
word fails verify, its remaining task is dropped. Both right → passed
(`mastered` stage 0, `recognizedCount` +1 — Recognised, not signed off). Every
graded choice task has a **Don't know** option (counts as a miss). **Quiz me**
from the sort stream starts this same recognition quiz; so does the practice
menu's Quiz me.

**Match (guided)**: after the quiz, a round that verified at least one word
serves one `match` item (`id: <round>:m`, `mode: 'round'`, answered
`{done:true}`, the same `MatchItem` and board as practice Match) over the
words just verified — padded to 3 from other introduced, non-excluded words
when fewer than 3 were verified, preferring a recognised word still owed its
match (`mastered`, not `matched`), then known (`mastered`) words, then any
introduced word. Finishing it sets `matched` on every word on the board. A
round that verified nothing skips it, and so does one whose board would still
be a single pair (`matchWordIds` in `engine.mjs`) — that word is swept into
the next board it can join, since the pad prefers it. A **practice Quiz me**
that passes words ends the same way: one `match` task (same board rule) is
appended to the run, so a word verified in practice can reach the typed
sign-off too. `round.phase` reads
`match` while it is on screen; `progress.round.hasMatch` (read-only) says
whether the round shows or will show the step — true before the quiz ends
unless the quiz can no longer pass anything, and after it only if a Match ran.
The drill offer (if any) follows the Match.

### Rechecks

One graded task per due word:

- **Typed sign-off** when `readyForSignOff` (recognised twice, claimed,
  matched, stage ≥ 1 — so never before the 2nd recheck): **3.3
  type-from-cue**, alternating per word with **1.4 dictation** (the term's
  audio is the whole prompt; judged exactly like 3.3) when the word has term
  audio. A pass signs the word off (Mastered); a miss drops it back to
  recognition (see the table above).
- **Recognition** otherwise, at any stage: `2.2` and `3.1` alternate per word
  (starting side seeded by the word id).

`review.typedEvery` is **retired** — typing is the sign-off, never a cadence.
A stored tuned value, a `lastChanged` stamp or a tuner proposal naming it is
ignored (it is not in `TUNABLE`).

## The tricky-word drill (spec §3 drill path)

A word whose graded-miss streak reaches `drill.afterMisses` is flagged
`tricky` (see States above), but the flag alone changes nothing else. Up to
`drill.perSitting` (default 1) tricky words are drilled per **study day**,
oldest `trickySince` first, drawn from the day's at-open snapshot; a word
already drilled that day is never drawn again. The tricky drill starts at
the top of a study day (after rechecks, before rounds), but only while the
day's remaining time is at least 4 minutes (`DRILL_MS`, the drill's own time
estimate) — if it doesn't fit, the day proceeds without it and the word
stays tricky for another day. **Nothing in a drill grades or changes word
state**; it exists purely to walk one word from full support to none.

Steps, fixed at creation and always in this order
(`DRILL_STEPS` in `backend/src/2_domains/school/cardLadder/drill.mjs`) — the
unsupported production steps (dictation, say-from-cue, type) come last, after
the scaffolded tiles, so writing from sound or memory is never front-loaded.
**Typing from memory (dictation, type) is in a drill only for a word
`readyForSignOff`** (recognised twice, claimed, matched — ruling 2026-09-23);
for every other word copy (visible) and tiles (scaffolded) are the ceiling:

| Step | What the child does | Skipped when |
|---|---|---|
| **look** | sees the picture, term and meaning together, and hears the term | never |
| **copy** | the term is on screen; types it | never |
| **say-after** | hears the term, records saying it after | no microphone capability, or the word has no term audio |
| **match** | 4-pair picture/text match board (the drill word plus up to 3 other introduced words) | fewer than 2 other introduced words exist to pair with |
| **read-aloud** | reads the term aloud and records; the native audio is revealed only after the take | no microphone capability |
| **tiles** | taps syllable tiles (the term's syllables plus 2 decoys) to spell the term from a cue | never |
| **dictation** | hears the term (no text shown), types what was heard | the word has no term audio, or is not `readyForSignOff` |
| **say-from-cue** | given only a cue (no term shown at all), records saying the term; the term is revealed only after the take | no microphone capability |
| **type** | given only a cue, types the term | the word is not `readyForSignOff` |

A step needing a microphone or term audio — or, for dictation and type, a word
ready for its sign-off — is dropped from the walk when the drill is created
(`stepsFor`/`drillSteps(media, capabilities, {ready})`) — never shown and
blocked on, and never an error. **Tiles and dictation are never dead ends**: a miss retries
the same step in place — the term stays hidden through the first miss, is
**revealed** (read-only, "It's 가위 — …", the step becomes copyable) after
the **second** miss, and the step **advances regardless on the third try**.
When a tiles or dictation step advances (a match or the third miss) the
program **holds** that verdict — "Right!" or "It's 가위" — with a Next
button before the next step replaces it (`HELD_DRILL_STEPS`). An open drill
whose word has since left the lexicon is treated as done (`openDrill`), never
a 500.
Copy and type must match exactly to advance (copy's miss carries the answer
so the retry can be completed); say-after / read-aloud / say-from-cue are
speaking and never graded at all (see [Speaking](#speaking-never-graded)).

Two ways into a drill:

- **Tricky drill** (`source: 'tricky'`) — automatic, described above.
- **Round-end drill offer** (`source: 'offer'`, spec §3) — **at most one per
  round**, for the round's word whose latest sort was Not yet with the most
  Not-yet sorts this round, and only while the drill still fits the
  remaining time (≥ 4 minutes; never offered once the day's cap is spent).
  The child is asked "This one's tricky — want to practise it?"
  (`Practise` / `Not now`, keys 1/2, `items/DrillOfferItem.jsx`) — never
  forced, and answering either way finishes the round.

## Speaking (never graded)

Say-after (drill, round intro, and the practice menu's Say mode),
read-aloud and say-from-cue (spec §3 1.2 / 1.3 / 3.4) are never graded and
never a gate: Skip/Next is available from the moment the item is on
screen, and whatever button is pressed the response is always
`{done:true}` — a take is never required, only offered. Skip is a touch
(its only key is the hunted-for `\`, and only a button that reads Skip has
it); **Space never skips** — it records, stops, then goes Next (see Keys
below). With the mic unavailable (`useTakeRecorder`'s `unavailable`) there is
nothing to skip: the forward button reads **Next**, Space presses it, and it
is logged as `item.answered` with `micOff: true` — never `item.skipped`.
**Tab = hear it** on every say item with audio: the model word (say-after's
term, or the clip a take revealed on read-aloud / say-from-cue), else the
cue's clip; a secondary **Hear it** button (hint Tab) shows whenever there is
a model. Never while the mic is open or a take is saving.

A **kept** take (one that passes the shared speech floor —
`shared/speechFloor.js`, not too quiet, not too short) is uploaded via
`POST /card-ladder/sittings/:sittingId/recordings/:itemId` and saved for a
grown-up to review at
`media/school/recordings/card-ladder/<package>/<learnerId>/<studyDay>/<wordId>-<n>.<ext>`
(`FilesystemCardLadderRecordings`). **Test mode never writes a file**: its
sink (`DiscardingRecordings`) counts the take and drops it, so the test
banner's "nothing is saved" holds for speaking too. A refused take (too
quiet / too short) is never uploaded and never disables anything.

What the child sees before a take differs by step, following exactly what
the server sent (never a local guess):

- **say-after** — the full word card and its native audio play on arrival
  ("see and hear it, then say it"); the take reveals nothing new.
- **read-aloud** — the term's text only; no audio until a take is uploaded,
  at which point the response's `reveal: {term, audio}` unlocks the native
  clip.
- **say-from-cue** — no word at all, only a cue; the term itself is learned
  for the first time from `reveal.term` after a take — reading it off the
  card can't stand in for recalling it.

Playback order after a kept take is always the child's own take, then the
native audio — never the other order. An upload failure is logged
(`recordingFailed`) and never blocks; for read-aloud/say-from-cue nothing is
revealed on a failed upload (the take was still said and heard — only the
grown-up review copy, and the reveal, are missing).

**Intro say-after**: introducing a new word (spec §2 flash → say → copy)
inserts a say-after step between the flashcard flash and the copy step,
but only when the sitting has microphone capability **and** the word has
term audio — otherwise introduction goes straight from flash to copy.

## The on-screen jamo keypad (spec §6)

**Only a Hangul target has an on-screen keypad.** `keypadFor(langs.targetScript)`
(`CardLadder/targetScript.js`) returns `JamoKeypad` for `hangul` and nothing
for any other script: a Latin, Cyrillic, kana (…) or generic target shows no toggle, never auto-opens and
ignores the long-press, and is typed on the device's own keyboard.

There is no web API that tells a page a Bluetooth keyboard is attached, so
the keypad (`JamoKeypad.jsx`) is a **toggle**, offered on every typing item
(copy, dictation, graded typed, and a drill's copy/dictation/type steps).
It is a **last resort, not an option** (owner, 2026-09-23): a small
icon-only button pinned to the item's bottom-left (`aria-label` "Show / Hide
keypad"), out of the button row. It **hides once a hardware keyboard
is known** — the shared heuristic in `lib/hardwareKeyboard.js` via
`hooks/useHardwareKeyboard.js`: a real letter/digit/punctuation keydown
(never `keyCode` 229, `Unidentified`, or a composing key), remembered per
device in localStorage (`ds_hardware_keyboard`), or the fleet registry's
declared keyboard. `keyboard.detected` is logged once per device. If the
heuristic is wrong, a **long-press (600 ms) on the field** still opens the
keypad (logged `keypad.toggled {via: 'long-press'}`) — invisible, so it costs
the keyboard user nothing.
Two-set (두벌식) layout: base rows plus a Shift key for ㅃ/ㅉ/ㄸ/ㄲ/ㅆ/ㅒ/ㅖ
(Shift is one-shot — it releases after the next key press whether or not
that key has a Shift form), backspace, and Enter/submit. Every key fires on
`onPointerDown` (never `onClick`) and re-focuses the field first, so a tap
never loses focus mid-run.

It **auto-opens once per item** — only while no keyboard is known: once the field has had focus for 10 s with
no keydown, the keypad opens itself and refocuses the field
(`KEYPAD_AUTO_OPEN_MS` in `TypedItem.jsx`) — skipped if the item has since
moved on or the field is disabled (a held verdict, a submit in flight). It
**closes on the first physical keydown** on the field — a `document`-level
capture listener, because the in-page Hangul IME's own capture listener
stops propagation before it would otherwise reach the field. When the
keypad is open, the typed item's prompt collapses to a compact height so
the stage still fits at 1280×800.

## Typed input and the judge (`CardLadderTypedJudge`)

A mastery test, not a spelling test — grading is deliberately generous.
`backend/src/3_applications/school/CardLadderTypedJudge.mjs` runs the
deterministic half (`2_domains/school/cardLadder/{scriptRules,targetScript,jamo,typedScore}.mjs`) in
order, first decision wins. The sitting passes the judge the target side's
script and language (`targetScript`, `targetLanguage`) — the one seam where
script-specific grading plugs in:

| Step | Condition | Score |
|---|---|---|
| Exact | match under the script's `normalize` | 10, `judge: exact` |
| Wrong script | the target has letters of its script and the attempt has none (a `generic` target has no floor) | 1, `judge: wrong-script` (days before 2026-09-23 say `no-hangul`) |
| Different real word | match, under the script's `normalize`, to another introduced word or an authored decoy | 2, `judge: guard` |
| Numbers (every script) | the target's digit tokens (`1776`, `1215`) are not exactly the attempt's, same order | 2, `judge: number` |
| Accent slip (Latin) | equal once diacritics are stripped, different with them (`cafe` for `café`) | 8, `judge: accent` |
| Deterministic (short, L ≤ 4 units) | distance 1 → 6 · distance ≥ 2 → 2 | `judge: distance` |
| Deterministic (longer) | d/L ≤ 10% → 8 · ≤ 20% → 6 · ≤ 33% → 4 · beyond → 2 | `judge: distance` |

Distance is Levenshtein over the script's units (`keystrokeUnits(text,
targetScript)`): for a Hangul target, **jamo as typed on a two-set keyboard**
(compound vowels/finals split into component keys; tense consonants and ㅒ/ㅖ
stay single); for Latin, letters after case-fold with diacritics stripped; for
every other script, grapheme clusters. The model's instructions name the
target language (the lexicon's name, `typed Korean answer` / `typed English
answer`) and script, and its JSON carries `script` and `language`; nothing in
them assumes Korean. **Short words (≤ 2 units — Hangul syllables, Han/kana
characters, graphemes): the deterministic score is final** — no
model call. **Longer words**: if `card_ladder.judge.model` is configured, a
small low-effort model may raise an eligible floor (score ≥ 4 and d/L ≤ 33%) by
**one band** (`judge: model`), never lower it; model failure or timeout falls
back to the deterministic score (`judge: fallback`). **On this household
`card_ladder.judge.model` is `gpt-5-nano`**, so a long-word misspelling that
clears the deterministic floor can still gain the model's +1-band step;
verdicts still land on `exact`, `wrong-script`, `guard`, `distance`, `cache` or
`fallback` whenever the model doesn't apply or doesn't answer in time.

**Shadow judge (2026-09-24).** When a typed-decision model is configured
(`IDecisionGateway`, TypeSafe Jev, key in `system/auth/jev.yml`), it scores the
same answer in parallel whenever the model step above runs. It never runs for
short, exact, guarded or cached answers. It answers one Score question over the
same rubric as five levels (different word · partly there · misspelled but
intended · one slip · exact → 2/4/6/8/10), clamped the same way (never below the
floor, at most one band up). **It decides nothing.** Each run logs
`school.card-ladder.judge-shadow` with `base`, `llm`, `jev`, `jevConfidence`,
`jevMs`, `agreed` and `passAgreed`. That is the evidence for or against letting
it replace the LLM step, and it matters here because the provider rates its CJK
accuracy below English. A shadow failure logs `judge-shadow-failed` and does not
affect the verdict.

### Grading by script

**2026-09-23 owner: per-script grading — Latin case-insensitive, accents a small slip, numbers exact; Hangul unchanged.**

Each script is a small pure rule object in
`2_domains/school/cardLadder/scriptRules.mjs` (`ruleFor(script)`), selected by
`scriptFor(target language)` or, with no language, read off the target text
(`scriptOfText`). The client's `keypadFor(script)` (`CardLadder/targetScript.js`)
mirrors the language table.

| Script | Languages | `normalize` | Distance units | Wrong script (→ 1) | Short (≤ 2 → deterministic) | Keypad |
|---|---|---|---|---|---|---|
| `hangul` | ko | `normalizeAnswer`: NFC, whitespace and punctuation removed (unchanged) | keystroke jamo | no Hangul typed — only when the target itself has Hangul letters; a bare-number target (`1945`) is judged by the numbers rule | syllables | jamo keypad |
| `latin` | en, es, fr, de, … | NFC, trim, collapse whitespace, strip punctuation, case-fold | letters, diacritics stripped (+ the accent-slip 8) | no Latin letter | graphemes | none |
| `cyrillic`, `greek`, `arabic` | ru/uk/…, el, ar/fa/… | as Latin (case-fold where the script has case) | grapheme clusters (`Intl.Segmenter`, code points as fallback) | no letter of the target's script | graphemes | none |
| `han`, `kana` | zh, ja (kana + kanji) | as Latin | grapheme clusters | no letter of the target's script | characters | none |
| `generic` | any unknown code | as Latin | grapheme clusters | none — any text is graded by distance | graphemes | none |

**Numbers, every script:** the digit tokens of the target must be the
attempt's digit tokens, identically and in order — otherwise 2 (`judge:
number`), a different answer and not a typo, however close the rest. A target
that is only a number therefore passes only on the exact number (`1776`;
`1,776` normalises to it). An omitted number is a different answer too:
`Declaration of Independence` for `Declaration of Independence (1776)` fails
(2, `judge: number`). The wrong-script floor applies only when the target
itself has letters of its script, so a bare-number target is never "wrong
script". **Copy, dictation, tiles and the drill's type step** compare with the
same `normalize` (spacing ignored), so `cat` copies `Cat` for a Latin target;
accents still have to be copied. The judgement cache and a grown-up re-grade
are keyed by the script's `normalize` — the judge's lookups and writes and
`adminRegrade` alike — so re-grading `Ephmeral` also covers `ephmeral`. The
Hangul rule's `normalize` is `normalizeAnswer` itself, so Korean keys are
byte-identical to before.

Pass = score ≥ `typing.passScore` (default 6). Verdicts are cached by
(package, word id, answer under the script's `normalize`) in
`data/household/school/runtime/card-ladder/<package>/judgements.yml`
(`YamlJudgementCache`) — a reload or repeated typo gets the same verdict with
no second call. A **grown-up's re-grade** overwrites that answer's entry with
`judge: grown-up` (see [Grown-up word controls](#grown-up-word-controls-spec-6));
the judge checks for one **before any band**, so it wins even for an exact,
short or wrong-script answer.

Every task item's day-file record (`items[itemId]`) keeps `wordId`, `task`,
`source` and, for a judged answer, the judge's `reason` — what the console
lists and re-grades. Older records without them are resolved from the day's
plan (`rc:<word>`, a round's quiz queue, the latest practice run).

## Goal, cap, and a study day

Goal and cap are **per study day, across all of that day's sittings** — idle
close makes several sittings a day routine.

- **Goal** = every recheck in the day's first sitting's at-open snapshot
  answered, every round started today finished (stream + quiz), and the
  day's tricky-word drill — if the day started one — finished too. A day
  cannot go "done" with an open drill sitting mid-walk.
- **Cap** = cumulative `activeMs` of the day's sittings ≥ `session.capMinutes`
  (default 15; active means input within the last 45s) with no round in
  progress.
- `doneToday` = goal met, or cap reached. A later sitting on a done day opens
  straight to the summary.
- `doneAt` is stamped by whichever of `openDay` / `respond` first finds the day
  settled (no round open, and either no recheck pending with no round left to
  plan, or the cap spent). A day with nothing to do — every word mastered and
  none due — is therefore credited the moment it is opened, not left
  "In progress".

New words available to introduce today =
`max(0, min(batch.newPerDay, batch.workingSet − unsettled))`, computed when the
sitting reaches introductions (so today's misses count first). The pool is
every not-yet-introduced word of the current deck and any deck the learner was
enrolled in before (`status.decksSeen`) — a deck is a quota, not a deadline.
Words learned on request ([Learn more words](#learn-more-words-ruling-2026-09-23))
carry `introducedExtra: true` and `newAllowance` skips them on both counts:
they never use up a day's `newPerDay` and never fill the working set, so
extra learning today never shrinks tomorrow's goal.

The cap stops the **guided** day continuing on its own; it never locks a
child out. Past the cap, the practice menu and Learn more stay available on
request.

## Settings and bounds

Defaults live in `backend/src/2_domains/school/cardLadder/settings.mjs`;
`school.yml`'s `card_ladder.settings` / `card_ladder.bounds` override them
(`resolveSettings`). **The tuning values in force for a study day are frozen
at its first open** (`dayFile.atOpen.settings`) — a mid-day config edit never
moves the goalposts under a child already partway through.

A day's first open reads the settings as config settings with the learner's
tuned values (`tuning.yml`, beside `status.yml`) laid over them. Only the six
tunables are overlaid, and each is clamped to the spec bounds and to
`card_ladder.bounds`. A tuning change therefore lands at the learner's **next
day's first open**. Test mode reads the learner's tuned values but never
writes them.

### Tuning (`CardLadderTuningService`, spec §7)

The tuner runs once per learner × word package for a study day that has
ended. It skips a day in these cases:

- the day is already tuned (`lastTunedDay ≥ day`);
- `tuning.yml` is corrupt (skipped before any model call; the file is never overwritten);
- another run for the same learner package is in flight;
- the day never reached its goal or cap. A day qualifies when the server
  credited it (`doneAt`), its active time reached the cap, or a sitting closed
  `goal` / `cap`. A day that only closed idle, on unmount or on leave does not
  qualify.

The digest covers the last 8 study days. Its word summary also counts
`signedOff` — mastered words the typed sign-off has passed. The proposal passes through the
brakes (`applyTuningProposal`), and applied values merge onto a fresh read of
`tuning.yml` just before the write. **Dwell counts study days: the dates that
have a day file, which are the days the learner opened** (`listDays`). A day
file is never created for a day the learner did not open, so calendar days
off do not count toward the 5-day wait.

History keeps 60 rows of `{day, status, notes[≤3], applied, dropped, model}`.
With no model configured (`model: false`), the rules write the status instead
and nothing changes: `concern` with the note "Credited with no words quizzed"
when a credited day quizzed no words, else `on-track` with no note. Notes are
plain copy for a parent; they never mention the model. A tuner failure changes
nothing; it records `status: null, error` and marks the day. A `concern` row
also gets `notified: false` and `concernAt` (when a `notify` port is wired):
an outstanding push that `deliverPushes` sends later, not `runFor`.

**Composition and schedule** (`5_composition/modules/cardLadderTuning.mjs`,
wired in `app.mjs`). The service is built on the **live** store and the
assignment store. The `CardLadderTuner` agent (a `MastraAdapter` runtime, one
structured step, no tools) is built only when `card_ladder.tuner.model` is set
in the household School config. A bare id (`gpt-5-nano`) is assumed to be
OpenAI's and passed on as `openai/gpt-5-nano`; any id with a `/` (for example
`anthropic/…`) is passed as-is, since Mastra resolves only provider-qualified
ids. With no model, the deterministic note above applies. Wherever the agent scheduler runs (`agentSchedulerEnabled`:
production, a container, or `ENABLE_CRON=true`), a tick runs **60 seconds
after boot** (an unref'd one-shot timer, so a restart past the rollover does
not wait a full interval) and then **every 15 minutes**. A tick asks
`pending()`, tunes each row **one at a time**, then calls `deliverPushes()`
for the outstanding concern pushes. A tick that finds the previous one still
running is skipped. The service refuses a day that has not
ended, so the first tick after the study-day rollover does the work. One
learner's failure is logged (`tuning-run-failed`) and the tick goes on.

**Concern push.** `notify` composes the copy with `composeSchoolPush({kind:
'card-ladder'})` (push standard): `🔤 {Child} — {Deck title}`, the body is the
tuner's first note when it reads cleanly (no ids, slugs or enums), else
"Word practice needs a grown-up's look", then the study day. The channel is
School needs you, and the tag `school-{learnerId}-card-ladder-{package}` means
the next concern replaces the card. It goes to every `teachers:` id through the
household `NotificationService` (`category: school`, `urgency: high`,
`dedupeKey` per teacher, learner, package and day). A failed label lookup drops
that label and still sends. Tunable setting ids in a note become plain words
("new words per day"); a note that still names a dotted setting is dropped for
the fixed line.

**Quiet hours defer, never drop.** The tuning pass runs just after the 4am
rollover, inside the household's quiet hours, where `NotificationService`
suppresses a non-critical push. `notify` answers `sent` (any copy delivered),
`suppressed` (governance held every copy) or `failed`. `deliverPushes` marks a
sent row `notified: true` (`notifiedAt`), leaves a suppressed or failed row
pending for the next tick, and marks a row still pending after **48 hours**
`notified: 'dropped'`. Each attempt logs `school.card-ladder.tuning-push
{status}`: info for `sent` / `suppressed`, warn for `failed` / `dropped`. It
takes the same per-learner-package guard as a tuning run and re-reads
`tuning.yml` before writing. With a morning quiet-hours end at 07:00, the push
arrives on the first tick after it.

**Console and undo** (`adminTuning`, `adminUndo`). Both are teacher-gated
(`action: 'card-ladder.tuning'`), refuse a learner not enrolled in the deck,
and exist only on the live service. The view lists each tunable with `current`
(config plus tuned values, clamped), `default`, `min`/`max` (spec bounds
narrowed by `card_ladder.bounds`), `tuned` and `lastChanged`, the last
non-undo run, and the history newest first. An applied change is `undoable`
when it is still that setting's latest change and still in force. Undo:

- restores the change's `from`. If that equals the config default, the key is
  removed so the setting follows config again;
- stamps the undone change `undone: {day, actorId}` and appends a history row
  `{day, undo: true, actorId, applied: [{setting, from, to, reason: 'grown-up undo'}]}`;
- sets `lastChanged[setting]` to today, so the dwell brake holds the grown-up's
  value for the next 5 study days. `lastTunedDay` is untouched;
- logs `school.card-ladder.tuning` with `reason: 'grown-up undo'` and `actorId`;
- is refused while a tuning run for that learner package is in flight, when
  there is nothing to undo, or when the value has changed since.

| Setting | Decides | Default |
|---|---|---|
| `round.size` | words per round | 5 |
| `round.maxPasses` | stream passes before it ends | 3 |
| `batch.newPerDay` | new words per day | 4 |
| `batch.workingSet` | unsettled-word cap | 7 |
| `review.gapScale` | recheck gap multiplier | 1.0 |
| `drill.afterMisses` | graded-miss streak → tricky | 2 |
| `drill.perSitting` | tricky words drilled per study day | 1 |
| `session.capMinutes` | day cap | 15 |
| `typing.passScore` | judge pass threshold | 6 |

## The practice menu (spec §6, post-goal)

Once the day is done (goal or cap) the summary shows once
(`dayFile.summarySeen`), then the **practice menu**: exactly the modes the
server lists in `item.modes` (`PRACTICE_MODES` in
`backend/src/2_domains/school/cardLadder/practice.mjs`: flashcards, match,
say, write, listen, drill, quiz) — a mode whose default run (with help,
every introduced word) would come up empty is not offered at all. **Say** is
the exception: it is offered when EITHER variant has a run (Without help
needs no term audio), and the menu item's `sayHelp` (`[true,false]` subset)
lists the variants the With/Without help chooser offers. **Write** lists
its variants the same way (`writeHelp`): Without help types from memory, so
its run holds only words `readyForSignOff`, and until one exists the chooser
shows it **locked** ("Unlocks when a word is ready", no key). Only
**Quiz me** grades (rule 1); every other mode is study and never changes a
word's state except a sort (down freely, up only to Got it, same as the
round stream).

| Mode | How it's chosen | With help | Without help |
|---|---|---|---|
| Flashcards | front side ("Word first" / "Meaning first") | term-first | meaning-first |
| Match | starts directly | 4–6 pair picture/text boards over the practice word set; finishing a board sets `matched` on its words | — |
| Say | With help / Without help | **1.2 say-after** — hears the term, says it after (dropped from the run if no microphone or the word has no term audio) | **3.4 say-from-cue** — cue only; there's no model to say after, so the native comparison at the end is simply skipped |
| Write | With help (offered first) / Without help | **1.1 copy-type** — the term is on screen, type it | **3.3 type-from-cue** — only over words `readyForSignOff` (locked until one is); free practice, never graded and never a sign-off; cue only, no reference to copy; a **Show me** button submits an empty answer and reveals the word (the drill's type step has it too). Typing from memory is never the first suggestion: With help is option 1 |
| Listen | starts directly | one run through every practice word that has term audio (`items/ListenItem.jsx`) | — |
| Drill | word picker first (**My words**, multi-select, "Drill these") | the same drill walk as the tricky-word drill (look → … → type), over the chosen words | — |
| Quiz me | starts directly | graded, recognition only (3.1 then 2.2, like the round quiz), then a Match of the words it passed (see Match (guided)) — see below | — |

**Quiz me eligibility** is the same rule as a round's verify (rule 3):
`familiar` or `claimed` state, or `notYetCarry === true` — never `new`,
`introduced` or `notYet` — and never a word whose `verifyFailedDay` is
today.

**Practice flashcards are forward-only.** The spec (§6) describes a
practice flashcard run with prev/next and undo; Plan 2 shipped it
**forward-only** — a deliberate ruling recorded mid-build, not an
oversight. Sort 1/2/3 or Space advances; there is no back/undo key on this
run. Cost if wrong: a child can't back up a card in free practice.

A practice run replaces any earlier one; starting one also marks the
summary seen. `{menu:true}` (the Menu button, key **M**) ends the run early
and returns to the menu — disabled while a typing item's field has focus,
so a Korean-layout keystroke (ㅡ, physically `M`) can't end the run by
accident.

### Learn more words (ruling 2026-09-23)

> **2026-09-23 owner: never block extra learning; credit stays capped at the daily goal.**
> ("If he wants to do more than four we should never block him … Getting
> credit may be limited to four.")

The Done summary and the practice menu offer **Learn more words** while the
pool (batch order, as above) still holds a word that is new and not
excluded — `item.learnMore` is how many the next round would introduce
(0 hides the button). It starts one more guided round —
**Learn › Sort › Quiz › Match**, exactly like a normal round — over the next
`min(round.size, batch.newPerDay)` new words (`extraNewWords` in
`rounds.mjs`; a lone leftover word is still a round). Engine:
`learnMore(ctx, {at})` in `engine.mjs`; the round carries `extra: true`.

- **Real progress.** The words climb the same ladder (introduced, sorted,
  recognised, matched, …) and are saved; a word met in it is flagged
  `introducedExtra: true`, and tomorrow it is carried like any other.
- **Credit stays capped.** `doneAt` never moves, `dayStatus` / the agenda
  keep reading done, and the goal's newPerDay counts only the goal's words.
  An extra round never re-plans the guided day (a done day plans nothing).
- **Never blocked by the cap.** Allowed past `session.capMinutes`; only the
  drill offer (which needs the drill estimate to fit) is skipped then.
- Refused (400) while guided work is open (a recheck, drill or round comes
  first) or when no new word is left. It ends an open practice run and passes
  the summary. After the round the child is back on the menu.
- **Test mode** does the same against the sitting's shadow and writes nothing.
- **Tuning** keeps the goal clean: `dayStats` leaves extra rounds out of
  `quizzed` / `passed` / `newIntroduced` and reports `extraIntroduced` and
  `extraRounds`; `capHit` is judged on `goalActiveMs` (the active time when
  the day was credited), so time spent learning more never reads as a cap hit.

Keys: on the menu the digit after My words; on the summary **2** (2 is Done
there only when nothing is left to learn). Done stays on Space/Enter.

### My words

Read-only from the practice menu ("My words", `items/WordsItem.jsx`) or as
the word picker for Drill ("Pick words to drill", `pick` mode, introduced
words only): every word the learner can meet — decks seen in order, then
the current deck, plus any other introduced word — with a state chip
(New / Just met / Not yet / Familiar / Got it / Recognised / Mastered, with
stars for stage — a `mastered` word reads Recognised until the typed sign-off,
from the row's `level`) and a Tricky chip when set. `GET /card-ladder/words` in test
mode **requires `sittingId`** — it reads that sitting's shadow; there is no
"current" live status for it to fall back to.

## Grown-up word controls (spec §6)

Per learner, per word package, from the teacher console. **Live only** (the
test service refuses them), and every call passes `TeacherGate.assert({userId:
actorId, pin, action: 'card-ladder.admin', context: {learnerId}})` first — a
refusal changes nothing. Each mutation logs `school.card-ladder.admin`
`{actorId, learnerId, package, wordId, action}` and a `transition` (source
`admin`) for any word whose state or stage it moved. Pure parts live in
`2_domains/school/cardLadder/admin.mjs`; the service methods are
`CardLadderSittingService.admin*`.

A control that does not touch the day's plan (reset, mark mastered, drop deck,
or exclude on a day not yet opened) writes `status.yml` only: the store never
creates a day file that would still be empty, so a day file exists only for a
day the learner actually opened (`listDays` = their study days).

| Action | Effect |
|---|---|
| **Words** (`adminWords`) | Every word the learner can meet (decks seen in order, this deck, then any other word with a record): state, `level` (the chip: Learning / Recognised / Mastered — Mastered only once signed off), `recognizedCount`, `matched`, `typedSignedOff`, stage, due, miss streak, tricky, excluded, `lastGraded`, `recentTyped` — judged typed answers (3.3, and 1.4 dictation sign-offs) from the last 14 study days' files, newest first, each with `itemId`, typed text, score, judge, reason and any `regraded` stamp |
| **Reset** | The record becomes `emptyWordV3()` — nothing kept, `notYetCarry` included. If a round under way still quizzes it, grading fills `introducedDay` with that day (`applyGraded` does this for any verify/recheck on a word without one), so a miss is carried |
| **Mark mastered (stage n)** | `mastered`, stage n, due today + `max(1, round(GAPS[min(n,5)] × review.gapScale))` — the day's tuned scale, as a recheck pass uses (1 when absent); miss streak, tricky and `notYetCarry` cleared. A word never introduced gets `introducedDay` = today and `introducedBy: admin`, so a later recheck miss (→ familiar) is carried like any other, but it does not count toward today's `batch.newPerDay` intros (`newAllowance` skips it) |
| **Exclude / Include** | Sets `excluded`. An excluded word is never in the new-word pool or an intro, a carry round, a recheck (`isDue` is false), a tricky drill or drill offer, a practice run, a match board or 3.1 distractor, the printed learner quiz, or My words, and never counts toward the working set (`isUnsettled` is false). Excluding mid-day also drops its pending recheck and ends an unfinished drill on it (`excludeWordFromDay`, the drill marked `excluded: true` — it does not count toward `drill.perSitting`, so another tricky word may still be drilled); a round already under way keeps it until the round ends. An opened day is then **re-settled** in the same transaction: with nothing else pending, the next round or drill is planned, or the day is credited (`doneAt`) — the child never lands on a "done" summary for an uncredited day |
| **Drop deck** | Removes the deck from `decksSeen` (the new-word pool); introduced words keep their state. Refused (400) for the current deck or any deck the learner is still enrolled in — the next open would re-add it; `adminWords.droppableDecks` lists the decks that can go |
| **Re-grade** | For one logged typed (3.3 or 1.4) answer: overwrites the judge cache for `(package, word, normalised answer)` with `{score: pass ? typing.passScore : 1, judge: grown-up, reason: 'Re-graded by a grown-up'}` and stamps the item `regraded: {at, actorId, pass}`; the tuner's digest counts that answer's score as the re-grade (`passScore` or 1), not the judge's. **It does not change word state** — reset / mark mastered do that |

## API

Mounted by `mountCardLadderRoutes` (`backend/src/4_api/v1/routers/school.cardLadder.mjs`)
at `/api/v1/school/card-ladder` (live) and `/api/v1/school/card-ladder/test`
(test mode, same shape). Every response is `Cache-Control: private, no-store`.

- `GET /card-ladder/intro?userId=&deckId=` → the start card, **read-only** (opens no day, writes nothing):
  `{deckId, package, day, test, course: {id, title}, unit: {id, title}, poster, today: {newCount, reviewCount,
  estimatedMinutes, doneToday, label, line}, progress: {learned, recognised, total}}`. `poster` is the self-service URL
  above. Test mode (`/test/intro?…&scenario=`) reads a **peeked** shadow — the same seeded snapshot Start's
  open would take, built and thrown away, never kept (`ShadowCardLadderStores.peek`)
- `POST /card-ladder/open {userId, deckId, capabilities?: {microphone}}` → `{sittingId, day, package, title, language, gloss, target, anchor, item, progress}` (`target: {code, name, script}`, `anchor: {code, name}`; `language`/`gloss` are the same two languages under their older names)
  (no microphone → no speaking steps; test mode also takes `scenario`)
- `POST /card-ladder/sittings/:sittingId/items/:itemId {userId, response}` → `{result, item, progress}`;
  `response` shape depends on the current item: `{seen:true}` (flashcard intro),
  `{sort}` (flashcard stream), `{typed}` (copy / typed), `{choice}` / `{dontKnow:true}` (choice)
- `GET /card-ladder/sittings/:sittingId?userId=` → current item + progress (reload)
- `POST /card-ladder/sittings/:sittingId/close {userId, reason}` — `reason` ∈ `goal|cap|leave|idle|unmount`
- `POST /card-ladder/sittings/:sittingId/recordings/:itemId?userId=&ext=` — raw audio body
  (`audio/webm|ogg|mp4`, `application/octet-stream`, ≤10 MB) → `{take}`, plus
  `reveal: {term, audio}` for read-aloud / say-from-cue. Only for the current
  item when it is a speaking step (`say`, or a drill's say-after / read-aloud /
  say-from-cue); never touches status. Test mode's sink keeps nothing.
- `POST /card-ladder/sittings/:sittingId/practice {userId, mode, help, filter, chosen, frontSide}` → `{item, progress}`;
  400 before today's goal
- `POST /card-ladder/sittings/:sittingId/learn-more {userId}` → `{item, progress}` (the round's first intro card;
  `progress.round.extra: true`); 400 while guided work is open or no new word is left. Never refused by the cap
- `GET /card-ladder/words?userId=&deckId=[&sittingId=]` → `{words: [{wordId, term, gloss, state, stage, tricky, dueDay}]}`
  in deck order (decks seen, then this one); test mode requires `sittingId` and reads that shadow

Items never leak an answer: dictation carries only the term audio; tiles the
syllables and a cue; type / say-from-cue only the cue; read-aloud the text with
no audio until the take; look / copy / say-after the full word card.
- `GET /card-ladder/stage` → `{screen}` (the configured stage screen id, see below)
- `POST /card-ladder/fold {learnerId, actorId, pin}` — teacher-gated: runs the paper-quiz fold for every
  card-ladder package the learner is enrolled in, on demand
- Grown-up word controls, **live mount only**, teacher-gated (`pin` may be the
  console's cookie capability — the GET, which has no body, reads the
  `daylight_teacher_session` cookie itself when no `pin` query is given):
  `GET /card-ladder/admin/words?learnerId=&deckId=&actorId=&pin=` → `{learnerId, package, decksSeen, droppableDecks, words}`;
  `POST /card-ladder/admin/reset {learnerId, deckId, wordId, actorId, pin}`,
  `…/admin/mastered {…, wordId, stage}`, `…/admin/exclude {…, wordId, excluded}`,
  `…/admin/drop-deck {…, dropDeckId}`, `…/admin/regrade {…, day, itemId, pass}`
- Tuning, **live mount only**, teacher-gated in `CardLadderTuningService`. The
  acting teacher is the capability session's own user when the cookie holds
  one, else the `actorId` given:
  `GET /card-ladder/admin/tuning?learnerId=&deckId=` → `{learnerId, package, state, lastTunedDay, settings, last, history}`;
  `POST /card-ladder/admin/tuning/undo {learnerId, deckId, setting, actorId, pin}` → `{learnerId, package, day, setting, from, to, reason}`

Item ids make every response idempotent. A sitting belongs to its study day:
after the day boundary it 404s and the client reopens. **Server idle close:** a
sitting with no item POST for 5 minutes is closed (`reason: idle`) by the next
request that touches the learner's day, closing every *other* open sitting at
its last input — a reload or a late answer on the current one still lands.

## The door and `/test`

```
/school/go/<learner>/card-ladder              the real sitting
/school/go/<learner>/card-ladder/test         read-only test sitting
/school/go/<learner>/card-ladder/<pkg>[/test] when the learner has >1 word package
```

`CardLadderDoorLauncher` resolves the learner's **current** card-ladder
enrollment and mints the ordinary flashcards launch target — no new authority.
With several packages, a bare URL 404s listing them; name the package to pick
one. This is the household's [code-free admin door](../../runbooks/school/README.md#opening-a-program-without-an-access-code);
`/test` is a reserved final segment the frontend parses off before the program
id/instance (`SchoolApp.jsx`) — a program with no test mode refuses a `/test`
URL from the URL alone, before any grant is asked for.

**Test mode** runs the same engine over a `ShadowCardLadderStores` in-memory
deep copy of the learner's real status + today's day file, snapshotted at
open. The typed judge still runs (so verdicts can be tested) but its cache is
an in-memory `MemoryJudgementCache` that reads through to the live
`judgements.yml` on a miss (so a grown-up's re-grade applies in test mode
too) and keeps its own verdicts in memory — test mode **never writes**
`judgements.yml`, `status.yml` or the day file. Sitting ids are
`test.<pkg>.<token>.<n>`, refused by the live router and vice versa. Shadows
expire after a 3-hour TTL (max 20 live at once); an evicted or restarted
shadow 404s on next touch and the client reopens. The banner reads
**"TEST — nothing is saved"**.

`?scenario=` seeds the shadow before the sitting opens
(`backend/src/2_domains/school/cardLadder/scenarios.mjs`):

| Scenario | Seeds |
|---|---|
| `today` (default) | the real snapshot, untouched |
| `fresh` | empty status and day file — every word `new` |
| `due` | every deck word `mastered` stage 1, due today — rechecks; every other word ready for the typed sign-off, so both recognition and typed rechecks show |
| `round-end` | every deck word `familiar`, introduced yesterday — straight to round-end verify |
| `tricky` | every deck word `familiar` (introduced 3 days ago); the first is tricky since yesterday — the day opens on its drill |
| `typos` | every deck word due for its typed sign-off recheck — typed items to misspell (the round quiz is recognition only) |
| `done` | today already closed (`doneAt` = today) — straight to the summary/menu |

A backend safety test
(`backend/src/3_applications/school/CardLadderTestMode.test.mjs`) drives a full
test sitting end to end and asserts every real file on disk is byte-identical
before and after — this is the guarantee the banner promises.

## Stage, layout, text fitting

The program renders inside a **fixed stage** sized from config, never code:
`GET /card-ladder/stage` returns the screen id named by `school.yml`'s
`card_ladder.stage.screen` (the Portal); `CardLadderStage.jsx` reads that
screen's `resolution` from `/api/v1/screens/<id>` (e.g. `screens/portal.yml`:
1280×800) and centres/scales the stage uniformly to fit whatever the actual
viewport is. If either fetch fails, the stage falls back to the raw viewport
size and logs `school-card-ladder.stage-failed` rather than rendering nothing.

Text roles (`FitText.jsx`) fit the largest size that fits their region — no
break inside a word, per-role min/max — and expose it as an `.wl-fit` element
so a Playwright spec can assert none of them overflow their box (see
`tests/live/flow/school/card-ladder-stage.runtime.test.mjs`).

### The start card (launch card)

The sitting does not open on mount (spec §6). The program first shows the
**launch card** (`CardLadderStartCard.jsx`), filled from `GET …/intro`:

- the **poster** (2:3, left) — `programs/card-ladder/<package>/poster.jpg`;
  missing or failing to load draws a calm blank placeholder, never a substitute;
- the **course** = the lexicon's `program.title` (the class, "UBKS 비둘기");
- the **unit** = the deck's `title` ("Week 1: Classroom");
- **today**: "4 new words · 3 to review · about 10 minutes", or "Done for
  today — practice anytime";
- **the deck's two rungs**: a two-segment bar (mastered solid, recognised
  lighter) and "3 recognised · 1 mastered of 19" — mastered is the typed
  sign-off, which takes weeks, so a mastered-only count would read 0 long
  after the child knows words; recognised is verified but not yet signed off
  (`deckProgress`; excluded words leave every side of the count);
- **Start** (Space/Enter). That tap is the page's user gesture, so the clips
  after it may autoplay; only then is `POST …/open` sent.

Today's counts are an estimate from `introPreview` (domain `intro.mjs`): due
rechecks + unsettled words from earlier days are "to review", the new-word
allowance (capped by the pool) is "new" — but never fewer than 2, since the
planner makes no round of a lone new word — and the minutes use the planner's
own `ESTIMATE_MS` (a recheck is estimated typed only for a word
`readyForSignOff`, as `recheckTask` serves it), clipped to the time left under
the cap. If the intro cannot be
read the card falls back to `descriptor.title` (else "Words") and Start still
works. The test banner shows on the start card too.

**The agenda tile carries the same card.** `CardLadderSittingService.dayStatus`
(today only — a replayed past day gets none) returns `context: {course: {id:
'program:card-ladder:<package>', title}, unit: {id: deckId, title}, lesson:
{id, title: '4 new words · 3 to review'}}`, `description: 'About 10 minutes'`
and `progress: [{scope: 'unit', label: '3 recognised · 1 mastered', completed:
mastered, inProgress: recognised, total}]` — the launch card's progress row
draws `inProgress` as the second (underway) segment;
`FlashcardProgramLauncher` passes them through and `projectProgramEntry` turns
them into the tile. The `program:<id>:<instance>` course id is what resolves
the poster (the instance is the word package, as the sentence ladder's is its
corpus).

**A finished day keeps a card and a code (extra rounds).** Once `doneAt` is
set the `language` subject is served and joins the agenda's *Done today*
tally — but the day's requirement being met never closes the deck.
`FlashcardProgramLauncher` reports `reopenable: true`, `planDailyAgenda`
records the section's `reopenUnitId` (chosen from the programs live today, so
an enrollment retired by its schedule's `except` span is never picked, and
the program finished today wins), and `BuildAgenda` mints a `subject_next`
code naming the program and prints a **Done**-railed card for it. The card is
pushed after the curriculum verdict, so a day with nothing owed still reads
*All done today*. Typing the code — or the morning's code, still live until
the rollover — resolves through the same `reopenUnitId`
(`findReopenableProgramEntry`), so it opens the deck, never a retired
sentence ladder. Logged as `school.agenda.reopen-code.minted`. The reading
shelf is the one reopenable program excluded: it has its own standalone card.
Before 2026-09-25 a served subject printed no code at all, and the plan-order
scan sent a re-typed code to the ladder a learner had been moved off.

### The sitting header

```
[back] Exit   Review [tick] › LEARN › Sort › Quiz › Match › Practice   3 left
              Round 1 · New words
[time bar]
Meet each new word.                               ← once per step
```

- **Exit** (house `back` icon + label, `TouchButton`) behaves exactly as Leave
  did: closes the sitting with reason `leave` and exits.
- **Step trail** (`stepTrail.js`, drawn by `CardLadderHeader.jsx`): today's
  steps Review › Learn › Sort › Quiz › Match › Practice. The current step is
  lit, finished ones ticked, later ones dim. A step the day does not have is
  omitted: Review when no rechecks were due (`progress.rechecksTotal`), Learn
  when the round work has no new words (`progress.learnToday`, false for a
  carry round; before any round is planned — Review runs first — the server
  reads it from the day's plan, `introPreview(...).newCount > 0`, so the trail
  keeps one shape from the first recheck into the round), Match unless the
  round is in its guided match (`round.phase: 'match'` or a round-sourced match
  item) or says it has one (`round.hasMatch`); with no round running, rounds
  still to come show Match and a day past its rounds shows it only if one was
  held (`progress.matchToday`).
  **Drill** is slotted in, lit, only while a tricky drill runs. **Practice**
  is dim with "after today's words" until the goal is met
  (`progress.doneToday`), and lit while practising (a practice run or the
  menu). Everything is derived from `#progress()` — `phase`, `round`,
  `rechecksLeft/Total`, `roundsDone`, `learnToday`, `matchToday`, `doneToday` — plus the
  item's `type`/`source` for practice and match; never from item types alone.
  Mapping: rechecks → Review; intro flashcard/copy → Learn; stream sort →
  Sort; quiz (2.2 / 3.1) → Quiz; guided match → Match; the drill offer
  (after the quiz and the Match) lights no step and reads every round step
  done, so the trail never steps backwards; drill steps → Drill; practice → Practice. On a narrow stage (a
  container query under 900px) the trail collapses to the current step.
- **Sub-line**: "Round N · New words / Sort / Quiz / Match / Tricky word", or
  "Checking N words", "Practising a tricky word", "Practice · a of b", "Done
  for today". No "of M": rounds are planned shrink-to-fit, so a total would
  be a guess that changes under the child.
- **Hint line**, once per step per sitting, in a reserved row under the
  header (so nothing below moves), gone on the first input (any key or tap,
  or a response) or after 6 s, fading by opacity/transform only:
  Review "Words from before — show what you remember." · Learn "Meet each new
  word." · Sort "Flip, then sort: Not yet, Familiar,
  or Got it." · Quiz "Quick check on the words you sorted." · Match "Match
  each word to its meaning." · Drill "A short workout on a tricky word." ·
  Practice "Free practice — pick anything."
- The pile counter / Menu button and the time bar stay; the TEST banner stays.

Items live today: flashcard front/back (`items/FlashcardItem.jsx`, intro and
practice modes), choice (`items/ChoiceItem.jsx`), typed/copy/dictation/
practice (`items/TypedItem.jsx`), the tricky-word drill
(`items/DrillItem.jsx`, delegating each step to the item that already
renders that task, plus `items/TilesItem.jsx` for pick-spelling and
`items/MatchItem.jsx` for the match board), the round-end drill offer
(`items/DrillOfferItem.jsx`), speaking (`items/SayItem.jsx` — say-after,
read-aloud, say-from-cue), the practice menu's listen run
(`items/ListenItem.jsx`), the practice menu and My words / word picker
(`items/MenuItem.jsx`, `items/WordsItem.jsx`), and summary
(`items/SummaryItem.jsx`).

### Keys (owner rulings, 2026-09-23)

"Spacebar should be the way to progress through this in the least friction
way possible … spacebar should never be a skip." One map per screen
(`useCardLadderKeys.js`); the on-screen hint (`keyHint`) is always on the
button that currently owns the key.

| Key | Does | Where |
|-----|------|-------|
| **Space** | The forward action — **never a skip**: Flip, Next, Continue, Done, Start, Back (error screen), toggle the word under the cursor (word picker) | every item outside a typing field |
| **Enter** | Mirrors Space everywhere outside typing; in a typing field it **submits**, and once graded goes Next | every item |
| Space on **Say** | Record (before a take) → Stop (while recording) → Next (after a take). No mic (none, refused, errored) → **Next** (an answer, logged `item.answered` with `micOff`), never a Skip and never a dead end | `SayItem.jsx` |
| **←** (ArrowLeft) | Record again — only after a take, not while recording/saving, never without a mic | Say |
| **Tab** | Hear it again — the term (say-after's model and a take's revealed word on Say included), the cue's gloss clip, or the result's revealed word; `preventDefault`, so focus never moves, and it works **inside a typing field** without typing or blurring — a typed item with no audio still maps it, as a no-op, so focus stays put | every item with any audio (and every typed item) |
| **\** (Backslash) | Skip (Say — only while the button reads Skip: a working mic, no take yet) / Show me (typed) — the deliberately hunted-for give-up; Skip is touch-first | Say, typed practice |
| 1 / 2 / 3 | Not yet / Familiar / Got it | flipped flashcard |
| U / Q | Undo / Quiz me | stream flashcards |
| 1–4, 0 | Choices, Don't know | choice |
| digits | Pick a word, then its meaning (both columns hinted); tiles | match, tiles |
| Backspace | Remove the last tile; Back in the practice sub-menus and word picker | tiles, menus |
| ← → ↑ ↓ | Move the cursor (four across) | word picker |
| M | Menu | a practice item, not while typing |
| next digit | My words | practice menu |
| digit after My words | Learn more words (while new words remain) | practice menu |
| 2 | Learn more words (while new words remain; else Done) | Done summary |

H (and A on Listen) survive only as **silent aliases** on non-typing items;
typing items bind **no letters at all** — on the Korean layout H is ㅗ, and
Space types a space (Korean phrases have them: 안녕히 계세요). Keys match the
**physical** key (`event.code` — `KeyH`, `Digit1`, `Space`, `Tab`,
`Backslash`, `ArrowLeft`, `NumpadEnter`…) first and `event.key` second;
Ctrl/Alt/Meta chords are ignored. Keys typed into an input are never
commands — Tab is the one exception. **Touch-only by design:** Leave (the
header — leaving is not moving forward), the keypad toggle and the jamo keys
themselves (a device with no keyboard).

**The flashcard flip** is a real 3D turn: both faces mounted back to back
(`backface-visibility: hidden`), `.wl-card__inner` rotates Y 0→180° over
1.25 × `--ds-motion-reveal` on `--ds-motion-easing`, transform only,
`will-change` only while turning. The turned-away face is `aria-hidden` and
`visibility: hidden` (transitioned, so it stays drawn for the turn), so the
back of a Korean front is never seen or read early. Reduced motion
(`wl-card--still`) is an instant swap.

**The result panel** (`items/ResultPanel.jsx`, typed and choice items): a
large card under the prompt that stays until Next, `role="status"`. Wrong:
"Not quite" (warm `--ds-warning`, never red), You typed (struck, muted) and
The answer (large, in its own `lang`), Listen (Tab). Right: a deterministic
cheer (Got it! / Nice! / Yes!) in `--ds-success` with the word; a near miss
(score < 10) adds "Close! It's spelled:". A choice marks the chosen option
beside the correct one. The server sends the revealed term's audio id with
any result that names the term. Enters on the shared DS keyframes
(`ds-sheet-up`; `ds-pop-in` for a right answer), transform/opacity only;
reduced motion: none. A graded typed item swaps its finished field for the
panel.

The typed field declares the lexicon's BCP-47 code (`lang` / `data-ime-lang`,
e.g. `ko`); `ime/languages.js` normalises it (`ko`, `ko-KR` → `KR`) so the
in-page Hangul IME switches to Korean on focus. A copy mismatch clears the
field for the retry.

**One audio lane** (`cardLadderAudio.js`): every clip goes through
`startClip`, and starting one stops whichever is playing; the program stops
the lane on unmount. **A late take is dropped**: `useTakeRecorder` ignores a
MediaRecorder `onstop` that lands after its item unmounted (Stop, then Next),
so it is never uploaded or played over the next item.

**Ruling 2026-09-23 (owner): anchor-side cues show text + picture + audio
together; the prompt is never the test.** "We're not testing for English
comprehension" — the anchor is what the learner already holds. `cueFor`
(`choices.mjs`) no longer picks one kind at random;
it returns one bundle `{type: 'anchor', text: gloss, image, audio}` (pure,
deterministic), and the sitting service serves every anchor-side cue — 3.1,
3.3, the drill's tiles / say-from-cue / type — as that bundle with the
picture and gloss-clip asset ids, rebuilt at publish time so an item stored
under the old kinds renders the new way. `items/AnchorCue.jsx` lays it out:
the picture (via `CuePicture`, which simply drops out if it fails) beside the
anchor text, and a **Listen (Tab)** for the gloss clip. No item renders an
audio-only anchor prompt. The target side is unchanged: the picture never
appears with the target on a learning front.

(Before the ruling:) An **image cue** on 3.1 / 3.3 always arrives with the gloss as `cue.text` (the
gloss is the cue there, never the answer). `items/CuePicture.jsx` renders the
picture and falls back to that text when the image has no asset or fails to
load (logging `media.failed` at warn).

### Testing on the Portal

FKB's **autoplay** setting must be enabled on the Portal for cue and answer
audio to play without a tap-to-unlock stall — see the
[School runbook](../../runbooks/school/README.md). Drive a scenario headless
with `CARD_LADDER_TEST_LEARNER=<id> npx playwright test
tests/live/flow/school/card-ladder-stage.runtime.test.mjs`, or open
`/school/go/<learner>/card-ladder/test?scenario=fresh` in a grown-up's browser
by hand.

## Renamed from word ladder (2026-09-23)

The engine was renamed so its names describe role, not a language or a
"word" assumption. Nothing in use broke; every old name is an alias:

| Old | New | How the old one keeps working |
|---|---|---|
| `/api/v1/school/word-ladder/*` | `/api/v1/school/card-ladder/*` | every route is mounted under both roots (`CARD_LADDER_ROUTE_ROOTS`) |
| `/school/go/<learner>/word-ladder[/<pkg>][/test]` | `/school/go/<learner>/card-ladder[…]` | the frontend door and `IssueDirectLaunch` (`DOOR_PROGRAM_ALIASES`) map it; `available()` lists only `card-ladder` |
| `policy.mode: word-ladder` | `policy.mode: card-ladder` | read as `card-ladder` by `YamlAssignmentStore`, the validator, every service check (`isCardLadderPolicy`) and the client (`cardLadderMode.js`). The plan file is not rewritten; the next grown-up save writes the new value |
| `school.yml` `word_ladder:` | `card_ladder:` | read when `card_ladder` is absent (`cardLadderConfigOf`); never merged |
| log events `school.word-ladder.*` | `school.card-ladder.*` | the trace CLI queries both and `formatTrace` reads both (`canonicalTraceMsg`) |
| `school word-ladder trace` | `school card-ladder trace` | a hidden CLI namespace alias |
| `users/<id>/apps/school/word-ladder/<pkg>/` | `…/card-ladder/<pkg>/` | copied once, on the first live read (below) |
| `household/school/runtime/word-ladder/<pkg>/judgements.yml` | `…/runtime/card-ladder/<pkg>/…` | copied once, on first use |
| `media/school/recordings/word-ladder/<pkg>/<learner>/` | `…/recordings/card-ladder/…` | copied once per learner, on first use |
| `media/school/programs/word-ladder/<pkg>/poster.jpg` | `…/programs/card-ladder/…` | the poster reader falls back to the old directory (media is not moved) |
| schemas `school.word-ladder-status/v3`, `-day/v1`, `-tuning/v1` | `school.card-ladder-…` | read as the same schema; rewritten under the new name on the next write |
| judge `no-hangul` | `wrong-script` | only a label; old day files keep theirs |

**The one-time move.** `YamlCardLadderStore` copies a package's whole
directory (status, days, tuning) from `word-ladder/` to `card-ladder/` the
first time a **live** read touches a package whose new directory is missing
(`copyDirectoryOnce`: staged beside the destination and renamed into place, so
a crash leaves nothing half-copied). It logs `school.card-ladder.store-migrated`
once and reads and writes only the copy from then on. **The old directory is
never deleted or written again** — it is the rollback. Test mode's shadow
stores, the judgement cache's test-mode fallback and the live start card read
through `readOnlyView()`, which reads an unmoved package in place and has no
writer, so a test sitting writes neither path. The CLI reads `card-ladder/`
first, else `word-ladder/`, and never copies.

## Logs

Everything lands in the log store as `school.card-ladder.*`, and every event
carries `mode: live|test`. `school card-ladder trace` (see the
[School runbook](../../runbooks/school/README.md#card-ladder-trace)) turns one
learner's events into a per-sitting timeline.

**Backend** (`context.module: school-card-ladder`, service-side, no `seq`).
Every sitting event carries `learnerId`, `sittingId`, `mode`, and (on the
sequencing events) `package` and `day`:

| Event | When | Key fields |
|-------|------|------------|
| `opened` / `reopened` / `closed` | a sitting opens, resumes, ends | `package`, `day`, `first`, `phase`, `rechecks`, `microphone`; `closed` has `reason` (`goal`, `cap`, `leave`, `unmount`, `idle`), `activeMs`, `doneAt` |
| `sitting.abandoned` (warn) | a sitting its client never closed is idle-closed at the next request on another sitting of the day | `lastItemId` (last answer), `onScreenItemId` / `onScreenType` (where the day stood), `idleMs`, `openedAt`, `closedAt`, `by` |
| `item.served` | every item put on screen (open, answer, `get` resync, practice start) — **why** it came up | `itemId`, `type`, `task`, `source`, `wordId`, `reason`, `via: open\|respond\|get\|practice\|learn-more`, `after` (the answer that led here) and per-reason detail: `step` (intro), `pass` (stream), `round`, `notYet` (offer), `drillSource` (drill) |
| `day.planned` | the first open of a study day | `dueRechecks`, `tricky`, `newAllowance` |
| `round.planned` | a round is planned | `round`, `index`, `kind: new\|carry`, `size`, `newIds`, `carryIds`, `hasMatch`, `phase`, `itemId` (the answer that caused it; null on open) |
| `round.phase` | a round moves phase | `round`, `from`, `to`; `→ quiz` adds `queue` (`word:task` in order), `eligible`, `notQuizzed`; `→ match` adds `wordIds`; `→ offer` adds `wordId`; `→ done` adds `passed`, `failed` |
| `drill.started` / `drill.finished` | a tricky or offered drill starts / ends | `drillId`, `wordId`, `source: tricky\|offer`, `steps`; `excluded` on finish |
| `day.done` | today's goal is credited | `doneAt`, `activeMs` |
| `answered` | **every** response the service accepts | `itemId`, `type`, `task`, `wordId`, `correct`, `score`, `judge`, `next`, `doneAt` |
| `graded` | only a **graded** response (verify quiz, recheck, practice Quiz me) | `itemId`, `wordId`, `task`, `source`, `correct`, `score`, `judge` |
| `transition` | one per word whose state or stage changed | `wordId`, `from`, `to`, `source`, `itemId`, `prereqs {recognizedCount, matched, typedSignedOff}` after the move |
| `word.prereqs` | a word's sign-off prerequisites moved (a recognition pass, a finished Match, a typed sign-off or its loss) | `wordId`, `changed`, `recognizedCount`, `matched`, `typedSignedOff`, `readyForSignOff`, `gaps` |
| `recorded` / `practice` | a spoken take stored; a practice run built | `step`, `take`, `bytes`; `practice`, `help`, `filter`, `size`, `first` |
| `learn-more` | a Learn more round started (ruling 2026-09-23) | `round`, `newIds`, `doneAt` (unchanged), `activeMs`; its `round.planned` carries `extra: true` |
| `judge-fallback` (warn) | the typed judge's model failed or timed out | `wordId`, `error` |
| `admin` | a grown-up word control (reset, mark mastered, exclude, drop deck, **regrade**) | `actorId`, `action`, `wordId`; a regrade adds `itemId`, `pass`, `score`, `was` |
| `folded` / `fold-refused` / `fold-deck-skipped` | the printed quiz folded in (spec §8) | `source`, `count`, `demoted` |
| `tuning` | one line per applied or dropped tuner change, and per grown-up undo | `setting`, `from`, `to`, `reason`, `dropped?`, `actorId` on an undo |
| `tuned` / `tuning-skipped` / `tuning-failed` / `tuning-unreadable` | the outcome of one tuning run | `day`, `status` or `error` |
| `tuning-push` | a concern push attempt | `status: sent\|suppressed\|failed\|dropped` |
| `store-corrupt` | a YAML file could not be parsed | `kind: status\|day\|tuning` |
| `store-migrated` | a package was copied out of the pre-rename `word-ladder/` directory (once per learner × package) | `learnerId, package, from, to` |

**`item.served` reasons.** The engine gives the reason as data
(`observe.mjs` `servedWhy`, pure); the service only logs it.

| `reason` | Meaning |
|----------|---------|
| `intro` | a new word's Learn step (`step: flash\|copy\|say`) |
| `intro:extra` | the same, in a Learn more round (`extra: true` on every item of that round) |
| `stream` / `carry` | a Sort card: a new word of this round, or a word carried from an earlier day |
| `stream:again-after-<pile>` / `carry:again-after-<pile>` | the card came back because it was sorted `notYet` or `familiar` (`pass` = which showing) |
| `verify-recognition` | the round quiz (2.2 / 3.1) |
| `match-after-verify` | the guided Match after a quiz that passed at least one word |
| `drill-offer` | the one-per-round drill offer (`notYet` = how often the word was sorted Not yet) |
| `recheck-typed-signoff` | a due recheck for a word with every prerequisite met: typed (3.3 / 1.4) |
| `recheck-recognition:<gaps>` | a due recheck that stays recognition, and what the word still lacks: `not-mastered`, `recognized<2`, `unmatched`, `stage<1`, `typed-lapse` |
| `drill:<step>` | a drill step (`drillSource: tricky\|offer`) |
| `practice:<mode>` | a practice-run item |
| `summary` / `menu` | the day's summary, then the practice menu |

The tuning scheduler adds `tuning-wired`, `tuning-run-failed`,
`tuning-tick-failed`, `tuning-deck-skipped`, `tuning-pending-failed` and
`tuning-unavailable`; the service also logs `attempts-unreadable`,
`decks-unlisted`, `deck-unexpandable`, `day-status-unloadable` and `card-unavailable` (warn — the agenda card could not be built; the day's credit is still returned).

**Frontend trace** (`context.component: school-card-ladder`). The program
creates one trace per mount (`createTrace.js`) and binds it to the logging
facade (`cardLadderLog.js`), so every event below is **stamped** with
`traceId`, `sittingId`, `seq` (1, 2, 3 … within the trace), `t` (ms since the
trace began), `learnerId`, `deckId`, `package` and `mode` (live/test). Order
a trace by `seq`, never by `_time` (the store stamps local time as UTC). The
stamp owns `mode`, so an item-level mode is sent as `itemMode`.

**Input.** `input` / `via` name how the child acted: `key:Space`,
`key:Enter`, `key:Tab`, `key:Backslash`, `key:ArrowLeft`, `key:<letter or
digit>`, or `touch` (null = nothing the child did in the last 1.5 s). It is
noted centrally (`inputVia.js`): `useCardLadderKeys` notes the key it acts
on, and the program root's capture listeners note a touch on any button and
an Enter that submits a field. Nothing is logged per keystroke.

| Event | When | Key fields |
|-------|------|------------|
| `mounted` / `unmounted` / `started` | the program mounts / leaves; Start tapped | `userId`, `deckId`, `test`, `scenario` |
| `intro.shown` / `intro.failed` (warn) | the start card drew its facts / fell back to the title | `hasPoster`, `newCount`, `reviewCount`, `learned`, `recognised`, `total`; `status` |
| `sitting.opened` / `sitting.closed` / `session.reopened` | open, close (Leave, Done, unmount), a 404 reopen | `first`, `phase`; `reason`, `activeMs`, `remaining`, `itemId`; `from` |
| `step.entered` / `hint.shown` | the header's current step changes / its first-time hint shows | `step`, `round` |
| `round.started` / `round.ended` | `progress.round.index` changes | `index`, `size`; `quizzed`, `notYet` |
| `item.shown` / `item.layout` | an item appears / its first fitted font size | `itemId`, `type`, `task`, `wordId`, `itemMode`, `layout`, `media`; `fontPx` |
| `item.answered` | the service accepted a response | `itemId`, `type`, `task`, `response`, `correct`, `score`, `judge`, `next`, `ms`, **`input`**; `micOff: true` on a say step moved past with no mic (the trace marks it "(no mic)") |
| `result.shown` / `result.dismissed` | the verdict panel appears / Next past a held verdict | `itemId`, `correct`, `score`, `judge`, `held` (false = a retry on the same item); `via`, `ms` |
| `item.skipped` | Skip on a say step with no take, past a working mic (with no mic it is an `item.answered`) | `itemId`, `type`, `what: say`, `itemMode`, `via`, `ms`, `micOff` (always false now; kept for older traces) |
| `showme.used` | Show me on a practice typing item | `itemId`, `via`, `ms` |
| `item.stalled` (warn) | 45 s and 120 s with no key or pointer on the current item | `itemId`, `ms`, `visibility: visible\|hidden`, `screen: item\|result` |
| `visibility` | the tab is hidden or shown | `state` |
| `audio.played` | every clip that finished or failed (warn when `error`/`blocked`) | `clip: term\|gloss\|take`, `trigger: auto\|key\|touch`, `input` (for key/touch), `outcome: ended\|error\|blocked` |
| `say.recording` | a spoken take (never graded) | `itemId`, `itemMode`, `phase: started\|stopped\|uploaded\|failed\|refused\|unavailable` (failed/unavailable warn), `ms` since the item was shown; `via`, `durationMs`, `bytes`, `status`, `reason` |
| `card.flipped` / `card.sorted` / `card.undone` | flashcard actions | `ms`; `pile` |
| `keypad.toggled` / `keyboard.detected` | the jamo keypad opens/closes; a physical keyboard is known (once per device) | `auto`, `open`, `via?` |
| `match.completed` / `drill.offered` / `practice.started` | a Match board finished; the drill offer answered; a practice run chosen | `ms`, `misses`, `pairs`; `accepted`; `itemMode`, `help`, `filter` |
| `learn-more.started` / `learn-more.failed` (warn) | Learn more words pressed; the request refused or failed | `from: menu\|summary`, `count`; `status`, `error` |
| failures | `plan.failed`, `write.failed`, `api.rejected`, `api.failed`, `stage.failed`, `media.failed`, `item.prompt-fallback`, `layout.clamped`, `notice.shown`, `practice.failed`, `words.failed` | |

Before 2026-09-23 the take events were `recording.uploaded` /
`recording.failed` / `recording.refused` / `mic.unavailable` and
`audio.played` carried `kind`; the trace still reads both.

## What is deferred

Plans 1–5 are built: the core loop, the drill / speaking / keypad / practice
menu, the printed quiz and fold, the trace CLI and the console's **Cards**
view ([`teacher.md`](teacher.md#2-the-navigation-graph)), and the tuning
pass. The tuner agent changes values only once `card_ladder.tuner.model` is
set in the household School config. What remains, by ruling or by the spec's
own scope:

- **Practice flashcards prev/undo** — spec §6 describes a practice
  flashcard run with prev/next and undo; Plan 2 shipped it forward-only (see
  [The practice menu](#the-practice-menu-spec-6-post-goal)), by ruling.
- **Out of scope in the spec**: speech-recognition scoring (speaking is never
  graded), a trace viewer in the teacher console (the trace is a CLI), and
  test mode for programs other than the card ladder.

## Printed quiz and the fold (spec §8)

Two quiz sources share one row shape (`buildWordQuizSource` /
`buildLearnerQuizSource`, `backend/src/2_domains/school/cardLadder/quizSource.mjs`):
one `question` block per word, `itemId: <wordId>` (so a scanned row's attempt
names the word the fold demotes), answer + three authored decoys, alternating
term→gloss (`What does **<term>** mean?`) / gloss→term (`Which is **<gloss>**
in <language.name>?`), deterministic from the seed, `fit.typeScale: young`.
The header instruction and `topics` come from the lexicon's `quiz` block.

### Whole-deck quiz (every word in one deck)

    node cli/school.mjs card-ladder quiz --deck week-01-classroom
    node cli/school.mjs docs publish language/korean/week-01-classroom-quiz.yml

Writes `<deckId>-quiz.yml`, one question per word in the deck — including
un-introduced words, whose miss is logged only, never demoted. A bare
`--deck` slug resolves only when exactly one deck id ends with `/<slug>`;
otherwise the CLI lists the matches — pass the full id.

### Per-learner weekly quiz (only what the learner has been introduced to)

    node cli/school.mjs card-ladder quiz --learner <id> --package korean-vocab [--week 2026-W39] [--rows 20] [--seed N] [--force]
    node cli/school.mjs docs publish language/korean/korean-vocab-quiz-<id>-2026-w39.yml

Writes `<deckDir>/<pkg>-quiz-<learnerId>-<isoWeek>.yml` (`quizId.mjs`
`learnerQuizDocumentId`; `deckDir` is every deck sharing the package's
lexicon, taken from the first deck's id). `isoWeek` is always lowercased in
the id (`documentValidation.mjs`'s `ID_PATTERN` is lowercase-only) even
though `isoWeekOf` and `--week` itself accept the display-cased `YYYY-Www`.
Without `--week` the current day's ISO week is used.

Row selection (`buildLearnerQuizSource`), up to `--rows` (default 20), in
this order, until the cap is hit:

1. every word `introducedDay` falls in this ISO week (deck order);
2. every other unsettled word (`isUnsettled` — not `new`, not `mastered`);
3. a seeded sample of `mastered` words filling whatever rows remain.

If nothing qualifies (e.g. a fresh week with no introductions yet), the
builder throws `no introduced words to quiz` rather than writing an empty
sheet — this is correct behaviour, not a bug to route around.

### Publishing and the reprint rule

Both forms write through the same `writeQuizSource` in
`cli/school/cardLadder.mjs`: an identical file (byte-for-byte) is left alone
(`unchanged: <file>`); a **different** file — the ordinary case for a
reprint after new introductions or a scan-side re-grade — is refused unless
`--force`. **A changed source must be republished as a new revision and a
fresh card minted, never pinned to the old one**: after `--force` overwrites
the source, run `school docs publish` to bump the revision, then
`POST /api/v1/school/print/render` to mint a fresh card — the old printed
sheet keeps its own revision and stays gradable, but the next print run must
carry the new one.

### The fold

A scan appends one paper attempt per graded row; a miss demotes per the
transitions table above (a paper row miss only ever demotes to `familiar`,
and only from `familiar`/`claimed`/`mastered` — never a promotion). The fold
(`foldPaperAttempts.mjs`) reads a scanned row's `bankId` as `<docId>@<rev>`
and accepts `docId` two ways:

- **Legacy per-deck ids still fold, forever.** Any `docId` that exactly
  matches `quizDocumentIdFor(deckId)` for a deck sharing the learner's
  lexicon package is accepted — the whole-deck quiz keeps working
  unconditionally, no learner scoping.
- **A per-learner document folds only into the learner named in its id.**
  `parseLearnerQuizId(docId, { deckDir, pkg })` parses the id from the
  **end** — it anchors on the trailing `YYYY-wWW` week token, not the first
  hyphen after the prefix — so a learner id containing hyphens is safe, and
  sibling learner ids that are prefixes of each other (`a` vs. `a-b`) are
  never confused (a raw `startsWith` prefix check would wrongly accept or
  refuse the wrong one). A **sibling's sheet** — a `docId` that parses as a
  per-learner id for this package but names a *different* `learnerId` — is
  refused, not silently dropped: it is logged
  `school.card-ladder.fold-refused` with the attempt id and bankId, and
  recorded in `status.paperAttemptsFolded` so it is **never re-evaluated**
  on a later fold.
- **Paper never promotes.** Whichever id shape matched, only a demotion or a
  logged-only pass/miss follows — folding a row can never raise a word's
  state.

    curl -s -X POST {app}/api/v1/school/card-ladder/fold \
      -H 'Content-Type: application/json' -d '{"learnerId":"{learnerId}","actorId":"{teacherId}"}'

## Rollover and media

A new week is a new deck file (its new words get a new lexicon `group`); a
grown-up changes the enrollment `deckId` — status carries over, keyed by word
within the package. Placeholders (0-byte media files) are allowed: the player
renders around them and `school certify` warns (`--strict-media` fails).

## Migration from v2

The v1 `status.card-ladder-status/v1` (or unversioned) shape is migrated on
read (`migrateStatusV2` in `2_domains/school/cardLadder/statusV3.mjs`) and
written as v3 on the next transaction: NEW → `new`, LEARNING → `familiar`,
CLAIMED → `claimed`, KNOWN step n → `mastered` stage n+1 with `dueDay` = the v2
next-check day verbatim. v2 day plans, the review run, the recording gate and
the review quiz are **gone** — the v2 review run (flip-only replay of a
finished day) has no v3 equivalent; a finished day's next sitting opens
straight to the summary instead.
