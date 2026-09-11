# Sentence Ladder — word glosses and word lookup

**Date:** 2026-09-11
**Status:** TABLED — handoff, not a started piece of work.
**Carved out of:** `2026-09-11-sentence-ladder-typing-hints-and-voice.md` (Tasks 10–11),
at the owner's request, so the rest of that plan could ship.

---

## 1. What a reader needs to know first

The Sentence Ladder drills a child through 4,143 Korean sentences on a living-room touch
panel. On the **interpretation** rung the task is *"type what this Korean means in
English"*. A child who is stuck there has exactly two options today: get it, or give up.

The parent plan (Task 9) draws the line this work sits on:

- a **reveal** is the English answer. It ends the exercise and is recorded *as a reveal*,
  never as an attempt the child got right.
- a **hint** is partial — one word's meaning — and leaves the sentence to build.

**The reveal shipped. The hint did not, because there is no data behind it.** That is the
whole of this document: the hint needs a per-word gloss, and the corpus has none.

> **Consequence for what is live now:** with no glosses there is no partial hint on
> interpretation, only the reveal. Do not draw a Hint control that has nothing to say.

## 2. Why this is a data problem and not a UI problem

### What the corpus actually contains

`data/content/school/language/glossika-korean.yml` — 702,600 bytes, **4,143 sentences**,
every one of exactly this shape:

```yaml
id: glossika-korean
label: Glossika Korean
languages: { source: EN, target: KR }
audio_base: apps/school/language/glossika-korean
sentences:
  - seq: 1
    text:
      EN: The weather's nice today.
      KR: 오늘 날씨가 좋아요.
    origin: glossika
```

Sentence pairs and a sequence number. **There is no word breakdown to hang a definition
on**, and nothing anywhere else in the tree has one.

### Why you cannot just look the word up

Korean is agglutinative, so the form in the sentence is almost never the form in a
dictionary. From `seq: 1` alone:

| in the sentence | what it is | dictionary headword |
|---|---|---|
| 오늘 | today | 오늘 ✓ *(the easy case)* |
| 날씨가 | weather + subject particle 가 | 날씨 |
| 좋아요 | 좋다 conjugated, polite present | 좋다 |

Two of the three words in a three-word sentence do not match their headword. A tap-to-
define built on string matching against a KO-EN dictionary fails on **most words in most
sentences**, and fails *silently* — it returns nothing, or worse, matches a different
word that happens to share a prefix.

So the hard part is **segmentation and lemmatisation**, not lookup. Whatever does that is
the actual system being built here.

## 3. The two approaches, and why the plan chose the one it did

**A. Generate a gloss per sentence with a model, once, and cache it forever.**
The model does the segmentation and lemmatisation — the part that is genuinely hard — and
afterwards it is static data served offline with no runtime dependency.

**B. A morphological analyser (mecab-ko) plus a sourced KO-EN dictionary.**
Deterministic, free per lookup, and no model in the loop. But it is a new native runtime
dependency and a hosting problem, the dictionary has to be sourced and licensed, and it
is **not obviously more correct** on conversational Glossika sentences, which are full of
contractions, speech-level endings and idiom that a headword dictionary handles badly.

The parent plan chose **A**, and the reason is worth preserving: this is a household of a
handful of children doing five sentences a day. The total corpus is 4,143 glosses,
generated at most once each, ever. That is a bounded, cacheable, one-time cost — the
profile that suits a model call and does not suit standing up a native analyser.

**Generate lazily.** Only for sentences a learner actually reaches. The daily limit is 5,
so it is a handful a day, and tomorrow's queue is already known and can be pre-warmed.

## 4. What to build

### 4.1 The shape, and the validation that makes it trustworthy

```js
{ seq: 1,
  words: [
    { surface: '오늘',   lemma: '오늘', gloss: 'today',            role: 'adverb' },
    { surface: '날씨가', lemma: '날씨', gloss: 'weather (subject)', role: 'noun+가' },
    { surface: '좋아요', lemma: '좋다', gloss: 'is good',          role: 'verb, polite' },
  ] }
```

**The one validation that matters:** `words.map(w => w.surface)` must join back to the
sentence's KR text. If it does not, the gloss describes a sentence other than the one on
screen, and a tap will highlight the wrong span — a child is then told that 날씨가 means
something that belongs to a different word. **Reject and regenerate; never serve it.**

### 4.2 Files

- Create `backend/src/2_domains/school/language/sentenceGloss.mjs` (+ test) — the shape
  and its validation. Pure; no I/O.
- Create `backend/src/1_adapters/school/GlossGenerator.mjs` (+ test with a stub adapter).
- Create `backend/src/3_applications/school/usecases/GetSentenceGloss.mjs` (+ test).
- Modify `backend/src/4_api/v1/routers/schoolLifecycle.mjs` —
  `GET /sentence-ladder/gloss/:corpusId/:seq`.
- Storage: a sidecar **beside** the corpus,
  `data/content/school/language/gloss/<corpusId>/<seq>.yml`.
  **Not** inside `glossika-korean.yml` — that file is already 700KB and is read on every
  day load, so growing it costs every child every morning.

### 4.3 What already exists to build on — do not rewrite these

- **`backend/src/1_adapters/ai/OpenAIAdapter.mjs`** has **`chatWithJson(messages, options)`**
  (line ~549). That is the seam for structured generation; do not hand-roll a JSON parse
  around `chat()`.
- **`backend/src/1_adapters/ai/AiUsageLedger.mjs`** already records every AI call to
  `<dataDir>/system/history/ai-usage/YYYY-MM.jsonl` for billing questions that outlive the
  log store's 7-day window. Gloss generation must go through it like everything else, or
  this becomes the one AI cost nobody can account for.
- The `1_adapters/persistence/yaml/` stores show the house pattern for a per-key sidecar
  with a serialized write chain and a never-throws read — `YamlAgendaCooldownStore.mjs` is
  the smallest complete example.

### 4.4 Test the failure paths, not just the happy one

- Gateway unavailable → the endpoint returns **503** and the UI **hides** the hint rather
  than showing an empty popover.
- A gloss whose surfaces do not reconstruct the sentence → rejected and regenerated,
  never served (§4.1).
- A `seq` that is not in the corpus → 404, not a generated gloss for a sentence that does
  not exist.

## 5. The UI, once the data exists (parent plan's Task 11)

### Why arrow keys are wrong here — this is reasoning, not preference

- Inside the field, arrows are the text caret, and in Korean they are **destructive**:
  `FieldComposer.#continuous` checks caret position every keystroke, so an arrow
  deliberately ends the composition session.
- The peek (shipped, Task 8) has already spent a key on "show me the sentence".
- **The learner's eyes are on the model row and their hands are on the answer row.** An
  arrow key moves something at the caret — that is what the gesture means everywhere
  else. Making the same keys walk a highlight through a different row, in a different
  script, that they are reading rather than editing, means steering by feel while looking
  somewhere else.

And the deeper mismatch: **a hint is an action, a lookup is a selection.** "Give me the
next glyph" takes no argument, so a key fits it perfectly. "What does *this* word mean"
must name one of five or six words first, and selections need a pointer or an addressing
scheme — they do not fall out of a directional key.

### So: direct addressing

- **Touch** a word. They are on a touch panel; pointing at what you are looking at is the
  entire gesture.
- **Keyboard**: hold a modifier and the words number themselves 1–5; press the digit. No
  cursor, no navigation, and it costs no key that typing needs.

Note that the two-row aligned strip **does not carry over to interpretation**: the top row
is Korean and the bottom is English, with different word counts and lengths, so there is
no shared column for a cursor to live in. Interpretation shows the Korean as a tappable
sentence, not as a strip aligned to anything.

Log every lookup with the word, through `languageLog.js`. Per
`docs/reference/school/sentence-ladder.md` §3, this is **recorded, never gating**.

## 6. Acceptance

- A child on interpretation can tap a Korean word and get one word's meaning, without
  being handed the sentence.
- A gloss is generated at most once per sentence, ever, and is served from disk
  thereafter with no model call.
- Every generation appears in the AI usage ledger.
- With the gateway down, the hint control is absent — not present-and-broken.
- `docs/reference/school/sentence-ladder.md` gains the gloss sidecar, the endpoint, and
  the hint/reveal distinction.

## 7. A note on test fixtures

This repo is public and a pre-commit hook rejects household names in any staged, unstaged
**or untracked** file. Use `test-learner` / `Test Learner` throughout — never a real
child's name, not even in a comment or an ASCII sketch.
