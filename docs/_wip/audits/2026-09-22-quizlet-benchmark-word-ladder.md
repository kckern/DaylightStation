# Quizlet benchmark for the word ladder

Date: 2026-09-22
Purpose: the parity target for vocabulary study (`korean-vocab` first), and the
learning model under it. Replaces the card/journey half of
`docs/_wip/plans/2026-09-22-word-ladder-test-mode-layout-observability-design.md`
(its door / test-mode / observability halves still stand).

Sources: Quizlet feature pages and help-centre summaries (quizlet.com/features/*,
help.quizlet.com — the help centre refuses automated fetches, so detail comes
from their published summaries plus direct product knowledge). Quizlet changes
often; treat exact labels as approximate, the mechanics as the point.

---

## 1. How flashcard learning actually works (the model Quizlet encodes)

1. **Retrieval, not re-reading.** Learning happens when you try to pull the
   answer out of memory *before* seeing it. The cue side must not contain the
   answer. A picture is a meaning — on a Korean→meaning card it IS the answer.
2. **Retrieve until correct, inside the session.** A miss is not "see you
   tomorrow": the item comes back a few cards later, and again, until it is
   recalled correctly (a *criterion*). Quizlet Flashcards loops the "Still
   learning" pile; Learn re-queues misses in the round; the SR mode's
   **Repeat** returns a card "within minutes".
3. **Then relearn across days, at expanding gaps (spacing).** A word recalled
   today is due again after a short gap, then longer ones. Each successful
   first-try recall on a later day stretches the gap; a lapse shrinks it and the
   word is re-learned to criterion that day (*successive relearning*).
4. **Recognition before recall.** Picking from four (multiple choice) is
   recognition — solvable by elimination. Producing the answer (typing it,
   saying it) is recall and is what sticks. Quizlet Learn starts with multiple
   choice and moves each term to written questions as it gets them right.
5. **Mastery is measured, not declared.** Learn marks a term *Familiar* after
   one correct answer and *Mastered* after two (the second on the harder type).
   A learner's own "I know it" is a poor judge — children especially
   over-estimate — so self-rating may SCHEDULE a card (sooner/later) but must
   never alone promote it.
6. **Both directions.** Receptive (가위 → scissors) comes first and is easier;
   productive (scissors / picture / sound → 가위) is harder and is what
   speaking needs. Quizlet lets you choose the side you answer with, or both.
7. **Small batches, immediate feedback.** Learn works in short rounds (~7
   terms), shows the right answer at once on a miss, then asks again later in
   the round. A round ends with a summary.
8. **Dual coding.** Pairing a word with a picture and its sound helps — with the
   picture on the *answer* side (or as the *prompt* when the learner must
   produce the word).

## 2. Quizlet inventory

### Flashcards
- Card front → tap card / **Space** flips; flips freely both ways.
- **← / →** previous / next; progress "n / total".
- Options: which side shows first (term / definition), **shuffle**, **audio**
  (TTS, per-side language, autoplay option), **starred only**.
- **Track progress** on: sort each card into **Still learning** (swipe left /
  key) or **Know** (swipe right / key); live counters for each pile; **undo**
  last sort. End of round → "Keep reviewing the N still learning" → another
  round of only those, until the pile is empty; then restart / go to Learn.
- **Spaced-repetition flashcards** (on by default for large sets): after the
  flip, rate **Repeat / Hard / Okay / Easy** (keys **1–4**). Repeat → back in
  minutes; Hard → soon; Okay → ~a day; Easy → longer. A **memory score**
  estimates recall at future points; it tells you what to review next.
- Star any card; images on the definition side.

### Learn (adaptive)
- Rounds of a few terms; question types **flashcard**, **multiple choice**,
  **written**; harder types appear as a term is answered correctly.
- Miss → correct answer shown immediately (“Continue”), term re-asked later.
- **"Don't know?"** button: reveals the answer, counts as a miss — no guessing
  forced.
- Written: **"Override: I was correct"** for a typo/near-miss.
- Status per term: **New → Seen → Familiar (1 correct) → Mastered (2 correct)**;
  progress bar; round summary grouped by status.
- Options: answer with term / definition / both; question types on/off;
  starred only; goal / study-by date shapes the path.

### Write / Spell (folded into Learn now; still the recall benchmark)
- Write: see prompt, **type** the answer; graded, with override.
- Spell: **hear** the word, type it (dictation).

### Test
- Generated quiz: choose count, types (written, multiple choice, true/false,
  matching), direction. Graded report with per-question review.

### Match
- Timed game: drag term ↔ definition (or picture) tiles until the board is
  clear; best time. Pure play, reinforces association.

### Blast / Live
- Arcade/team games over the same set (classroom).

### Across modes
- **Progress** page: every term grouped by how often it has been answered
  right/wrong across all activities.
- Streaks / reminders; teacher class progress.

## 3. Where the word ladder is today, against that

| Quizlet has | Word ladder today | Verdict |
|---|---|---|
| Flip anytime (tap / Space) | Flip hidden until a recording exists; no tap, no keys | **Broken** |
| Cue side has no answer | Picture on the Korean front | **Wrong — gives the answer** |
| Still-learning pile loops in-session | Each card shown once per day; "Still learning" ends it until tomorrow | **Missing — core mechanic** |
| Small rounds + summary | One pass over all 19 | Missing |
| Recognition → recall progression | Multiple choice only (checks) | Missing recall |
| Mastery from performance (Familiar/Mastered) | CLAIMED from the child's own "I know it" | **Wrong model** |
| Repeat/Hard/Okay/Easy scheduling | Two self-marks; intervals 3/7/14/30 study days after one check | Partial |
| Both directions / choose side | Checks mix directions; study is Korean-first only | Partial |
| Don't know → reveal, counts as miss | Must pick one of four | Missing |
| Audio per side, autoplay | term.mp3 autoplays; gloss.mp3 never used | Partial |
| Shuffle, star, undo | None | Missing |
| Match game | None | Missing |
| Test | Printed OMR quiz (demote-only) | Our analogue — keep |
| Progress view per term | `status.yml` only; no screen | Missing |
| Keyboard + swipe | Buttons only | Missing |
| Speaking | Recording forced before flip | Wrong role — see §4 |

## 4. Recording's place

Recording is **a way to practise and check recall, not a gate or an
assignment**: a *Say it* question — the prompt is the picture, the meaning or
the sound; the child says the Korean; the take plays back, then the native
audio; the child judges **Got it / Not yet** (a self-check, scheduled like one;
it never alone masters a word). Offered only where a mic is available; absence
changes which question types appear, never whether the day can finish.

## 5. Parity target — the learner journey

**One daily sitting (server still owns the plan and the credit):**

1. **Due reviews first** — words whose spacing gap has elapsed, asked at their
   current difficulty (recall where the word has earned it). A miss → relearn
   in this sitting to criterion; its gap shrinks.
2. **New words in a batch of ~5–7** (configurable). Each is *introduced* as a
   flashcard: Korean + sound → flip → picture and/or English (reveal set by
   config) → Next. No self-mark needed to move on.
3. **Learn rounds on that batch** — recognition first (Korean→meaning picture
   or text choices; sound→meaning), then production (picture/meaning→Korean
   choices; then typed Korean via the School Hangul IME, or *Say it*). A miss
   shows the answer and re-queues the word a few items later. A word leaves the
   round at criterion (e.g. correct twice, one of them at production level).
4. **Round summary** — New / Familiar / Mastered for today's words.
5. **Done for the day** = due reviews + today's batch at criterion. Then free
   modes stay open: **Flashcards** (free flip, Still-learning/Know piles that
   loop), **Match**.

**Across days:** first-try result of the day drives the gap (miss → back to
short gaps and relearning; correct → gap grows). Self-ratings (Know / Still
learning, Got it / Not yet) only nudge scheduling.

**Flashcards mode spec (the one that was unusable):** tap card / Space / Enter
flips both ways; ← → move; after a flip, **1 / ←-swipe = Still learning**,
**2 / →-swipe = Know**; counters for both piles; undo; end of round loops the
Still-learning pile; settings: front side (Korean / meaning), reveal (picture,
English, both), audio autoplay, shuffle.

**Screen:** a fixed stage sized from `screens/portal.yml` `resolution`
(1280×800), centred content, design-system touch buttons, text fitted per the
layout rules in the design spec.

## 6. What this changes

The ladder's state machine (NEW → LEARNING → CLAIMED → KNOWN) and the daily plan
shape need redesign around: in-session criterion loops, performance-based
mastery, question-type progression, and batching of new words. Existing
`status.yml` history is keyed by word and event, so migration is a mapping, not
a loss. The printed quiz, the fold, the door, test mode and observability carry
over.
