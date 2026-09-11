# Sentence Ladder — word glosses and word lookup

**Date:** 2026-09-11
**Status:** TABLED, carved out of
`2026-09-11-sentence-ladder-typing-hints-and-voice.md` at the owner's request so the
rest of that plan could ship.

**Why these two and not one of them:** Task 11 is the UI for Task 10's data. A word
lookup with no gloss behind it has nothing to show, so they are one piece of work or
neither.

**What it costs, which is why it was tabled:** Task 10 is the only part of the parent
plan that needs a model at runtime. The corpus is 4,143 entries of `{seq, text, origin}`
with no word breakdown, and Korean is agglutinative — 날씨가 is 날씨 + 가, 좋아요 is 좋다
conjugated — so the surface form is almost never the dictionary headword and a
dictionary match fails on most words in most sentences. Generating a gloss per sentence
means an AI gateway call, a cache, a sidecar store, a new endpoint, and validation that
the gloss reconstructs the sentence it claims to describe. Everything else in the parent
plan is local UI and pure functions.

**What still holds from the parent plan:**

- The hint/reveal split (Task 9) SHIPPED WITHOUT THIS. A *reveal* is the English answer
  and ends the exercise; a *hint* is partial. Until glosses exist there is no partial
  hint on interpretation — only the reveal — and the UI should not offer a Hint button
  that cannot say anything.
- Interpretation shows the Korean as a tappable sentence, not as a strip aligned to
  anything: the two-row aligned layout does not carry over, because the top row is
  Korean and the bottom is English with different word counts.

---

### Task 10: Word glosses — a data problem, not a UI problem

**Why it is hard:** the corpus is 4,143 entries of exactly
`{seq, text: {EN, KR}, origin}` — sentence pairs and nothing else. There is no word
breakdown to hang a definition on. And Korean is agglutinative: 날씨가 is 날씨 + the
subject particle 가; 좋아요 is 좋다 conjugated. **The surface form is almost never the
dictionary headword**, so matching a tapped word against a dictionary fails on most
words in most sentences.

**Approach: generate a per-sentence gloss once, cache it forever.** The model does the
segmentation and lemmatisation — which is the part that is actually hard — and afterwards
it is static data served offline. Generate **lazily**, for sentences a learner actually
reaches: the daily limit is 5, so it is a handful a day, and tomorrow's queue is already
known and can be pre-warmed. A morphological analyser (mecab-ko and a sourced KO-EN
dictionary) is the alternative; it is a new runtime dependency and a hosting problem, and
it is not obviously more correct on conversational Glossika sentences.

**Files:**
- Create: `backend/src/2_domains/school/language/sentenceGloss.mjs` (+ test) — the shape
  and its validation. A gloss is `{seq, words: [{surface, lemma, gloss, role}]}`, where
  `surface` must be findable in the sentence: **validate that `words.map(w => w.surface)`
  joins back to the KR text**, or a tap will highlight the wrong span.
- Create: `backend/src/1_adapters/school/GlossGenerator.mjs` (+ test with a stub adapter)
- Create: `backend/src/3_applications/school/usecases/GetSentenceGloss.mjs` (+ test)
- Modify: `backend/src/4_api/v1/routers/schoolLifecycle.mjs` — `GET /sentence-ladder/gloss/:corpusId/:seq`
- Storage: a sidecar beside the corpus, `data/content/school/language/gloss/<corpusId>/<seq>.yml`.
  **Not** inside `glossika-korean.yml` — it is already 700KB and read on every day load.

**Test the failure paths, not just the happy one:** gateway unavailable → the endpoint
returns 503 and the UI hides the hint rather than showing an empty popover; a gloss whose
surfaces do not reconstruct the sentence → rejected and regenerated, never served.

### Task 11: Word lookup is a selection, not a navigation

**Why arrow keys are wrong here** — this is the reasoning, not a preference:

- Inside the field, arrows are the text caret, and in Korean they are *destructive*:
  `FieldComposer.#continuous` checks caret position every keystroke, so an arrow
  deliberately ends the composition session.
- Task 8 has already spent a key on "reveal the next glyph".
- Above all: **the learner's eyes are on the model row and their hands are on the answer
  row.** An arrow key moves something at the caret — that is what the gesture means
  everywhere else. Making the same keys walk a highlight through a different row, in a
  different script, that they are reading rather than editing, means steering by feel
  while looking somewhere else.

And the deeper mismatch: **a hint is an action, a lookup is a selection.** "Give me the
next glyph" takes no argument, so a key fits it perfectly. "What does *this* word mean"
must name one of five or six words first, and selections need a pointer or an addressing
scheme — they do not fall out of a directional key.

Note also that the two-row aligned layout **does not carry over to interpretation**: the
top row is Korean and the bottom is English, with different word counts and lengths.
There is no shared column for a cursor to live in. Interpretation shows the Korean as a
tappable sentence, not as a strip aligned to anything.

**So: direct addressing.**
- **Touch** a word — they are on a touch panel and pointing at what you are looking at is
  the entire gesture.
- **Keyboard**: hold a modifier and the words number themselves 1–5; press the digit.
  No cursor, no navigation, and it costs no key that typing needs.

**Files:** `TypedRung.jsx` (or a new `WordLookup.jsx`), `SentenceLadder.scss`,
`languageLog.js`. Log every lookup with the word — `recorded, never gating`.

---
