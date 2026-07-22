# Glossika Program — Design

> **Status:** built and verified 2026-07-22. Legacy import revised after the
> 2016–2020 database dump was recovered (§6).
> Revives the 2016–2017 `korean.kckern.info` sentence-drill app
> (see `LifeArchive/Vol 0/projects/0 Software/2016-glossika.yml`) as a School
> program at `frontend/src/modules/School/Programs/Glossika/`.

---

## 1. What it is

A **daily sentence-drill program**. Each sentence climbs a four-rung ladder,
one rung per day. A day's queue is *N brand-new sentences* plus *every sentence
that cleared rung k yesterday but has not yet cleared rung k+1*.

This is the original 2016 design, recovered from `index.php` / `newday.php` /
`lib.js`. It is deliberately **not** SM-2: no ease factors, no intervals, no
grading feedback loop. A sentence is seen exactly four times, in four different
cognitive modes, on four different days. The pacing knob is one number —
new sentences per day.

### The four rungs

**No rung names a language.** Rungs are defined over two roles — `source` is
the language the learner already has, `target` is the one being acquired — and
the corpus binds those roles to codes (`source: EN, target: KR`). A Spanish
course, or a course running the other direction (a Korean speaker acquiring
English), is a corpus file plus an adapter; no domain code changes.

| Rung | Prompt (audio played) | Response | Records |
|---|---|---|---|
| `repetition` | source → target → target | none | completion only |
| `dictation` | target (replay on demand) | text, in **target** | typed text + accuracy |
| `recording` | target → ding | audio, in **target** | audio file |
| `interpretation` | target | text, in **source** | typed text |

Repetition plays target twice: hearing it once is recognition, hearing it again
after attempting it is correction. That second play is the shadowing mechanic,
not a stutter. It is also the only rung with no response, which is why it is
the rung new sentences enter on — it runs on any device.

### Graceful degradation (decided 2026-07-21)

The Portal is touch-only and may have no mic. Capability is detected at runtime
and the **ladder chain is filtered, not stalled**: a rung whose input capability
is absent is removed from the chain, and sentences graduate across the gap.

Capabilities are `{ microphone: bool, textInput: [langCode…] }`. **Text input is
per-language, not one boolean** — `dictation` needs an IME for the target
script while `interpretation` needs only the source script. A plain US keyboard
satisfies interpretation and not dictation; collapsing both to `keyboard` would
offer the learner a rung they physically cannot enter. For an EN→KR corpus:

| Device | Active chain |
|---|---|
| mic + Hangul IME + Latin | all four |
| Latin keyboard only, no mic | `repetition → interpretation` |
| mic only (bare kiosk) | `repetition → recording` |
| nothing | `repetition` alone; a sentence retires after one rung |

A capability-blocked rung is **never rendered as a dead input** — the queue
simply never contains it. Same principle as the materials framework's "a locked
unit always names what to do": the kiosk must not dead-end.

---

## 2. Data model

### Corpus — shared, read-only

`data/content/language/glossika-korean.yml`

```yaml
id: glossika-korean
label: Glossika Korean
# Binds the ladder's two roles to concrete codes. The ONLY place EN/KR appear.
languages:
  source: EN
  target: KR
audio_base: apps/school/language/glossika-korean
sentences:
  - seq: 1
    text:
      EN: The weather's nice today.
      KR: 오늘 날씨가 좋아요.
```

Sentence text is keyed **by language code**, not by fixed `en:`/`kr:` fields,
so the corpus shape is identical for every language pair and the domain reads
it as `text[resolveRole('target', languages)]`.

4143 sentences, ingested from the recovered 2016–2020 database dump (§6).
Boot-cached like every other content file. A sentence carries `origin`
(`glossika` | `naver-tts`) and, when its audio was never split, `audio: false`.

> The 2016 `Rawtext` PDF dump also carries romanization and IPA per sentence,
> but is mojibake-encoded and interleaved with page-number noise. **Not
> ingested** — YAGNI until a rung actually needs it.

### Audio — shared, read-only

`media/apps/school/language/glossika-korean/{NNNN}-EN.mp3`
`media/apps/school/language/glossika-korean/{NNNN}-KR.mp3`

3325 contiguous pairs covering seq 1–3325; the remaining 818 corpus sentences
have no audio and are history-only. Served through the
School router by `(course, seq, lang)` slug — never by raw path — matching the
emulator's "address media by safe slugs, resolve real filenames server-side"
rule.

### Per-user progress — mutable, small

`data/users/{userId}/apps/school/language/{corpusId}/progress.yml`

```yaml
corpus: glossika-korean
day: 42
daily_limit: 5
last_activity: 2026-07-21T09:15:03Z
```

The **only** mutable per-user store. It holds pacing state, never evidence.

### Per-user attempt log — append-only, date-sharded

`data/users/{userId}/apps/school/language/{corpusId}/log/{YYYY-MM-DD}.yml`

```yaml
- at: 2026-07-21T09:15:03Z
  day: 42
  seq: 1
  rung: repetition
  attributedTo: kckern
- at: 2026-07-21T09:15:44Z
  day: 42
  seq: 17
  rung: dictation
  given: 오늘 날씨가 조아요.
  expected: 오늘 날씨가 좋아요.
  accuracy: 0.94
  attributedTo: kckern
```

Mirrors the School attempt log exactly: **one event per action, carrying
`attributedTo`, append-only, never rolled up.** The day queue is *derived from
this log on every read* — there is no stored queue table. That is what makes a
parent's later reassignment move the evidence and the pacing together.

> This is the direct fix for the 2017 failure mode. Elizabeth's progress
> silently stopped advancing because the queue was **stored state** in
> `user_queue` and a server migration lost the writes. A derived queue cannot
> desynchronise from its evidence.

### Recordings

`media/apps/school/language/{corpusId}/recordings/{userId}/{NNNN}-{LANG}.{ext}`

The recording rung writes the file, then appends its log event. A recording
whose log event is missing is treated as **not done** — evidence is the log,
never the filesystem.

---

## 3. Ladder rules (pure domain)

`backend/src/2_domains/school/language/`

```
ladder.mjs         RUNGS over roles, chainFor(capabilities, languages)
dayQueue.mjs       buildDayQueue({ log, day, dailyLimit, corpusSize,
                                   capabilities, languages, playable })
transcription.mjs  accuracy(given, expected) — normalized char-level similarity
rollover.mjs       shouldRollDay({ queue, lastActivity, now, boundaryHour })
corpus.mjs         validateCorpus(raw) — strict, fails the whole file
```

**Queue construction** (`buildDayQueue`), all derived from the log:

1. `newcomers` — the next `dailyLimit` sequences never logged at ANY rung, in
   sequence order, skipping anything without audio. Capped by `corpusSize`.
   (Checking only the entry rung would re-admit imported sentences whose first
   surviving evidence is further up the ladder.)
2. `graduates` — for each adjacent pair `(k, k+1)` in the capability-filtered
   chain: every seq logged at `k` but never at `k+1`.
3. Queue = newcomers + graduates, each entry `{ seq, rung }`.
4. Entries already logged **for the current day** are marked complete, not
   removed — the UI needs the denominator for its progress bar.

**Rollover** (`shouldRollDay`): the current day's queue is fully complete AND
`now` is past the `boundaryHour` (default 4am, local) boundary following
`last_activity`. Keeps the 2016 rule that a late-night session and the next
morning are the same study day.

**Dictation accuracy** is recorded but **never gates anything**. Consistent with
"No second gate anywhere" — only sequential courses lock. A wrong dictation
still graduates; the diff is for the learner's review, not for the scheduler.

---

## 4. Layers

**Glossika is a vendor name, not domain vocabulary.** The drill ladder is not
Glossika-specific and never was: the 2016 `import.php` pulled sentences from
Naver Wordbook into the same `sentences` table and drove them up the same
ladder. Glossika is one *source* feeding a vendor-neutral pedagogy, so the
vendor lives in an adapter and the pedagogy lives in the domain.

The domain is named for what bounds it: the atom is a **bilingual sentence
pair**, and all four rungs are irreducibly bilingual (hear-EN-say-KR,
transcribe KR, speak KR, interpret KR→EN). This ladder cannot be pointed at
math facts or state capitals, which is what makes `language` the right width —
wider than `shadowing` (only rung 1 shadows), narrower than `drill`.

> `drill` was rejected: School **already** uses it for flashcards ("a flashcard
> drill resurfaces missed cards until they are got"), and two mechanics sharing
> one word in one module is the exact ambiguity the ubiquitous-language rule
> exists to prevent. `ladder` was likewise semi-taken by `fitness.cycleLadder`.

| Layer | Path | Holds |
|---|---|---|
| Domain (pure) | `backend/src/2_domains/school/language/` | ladder, day queue, rollover, transcription accuracy — no vendor terms |
| Adapter (vendor) | `backend/src/1_adapters/glossika/` | their TSV, their `{NNNN}-{EN,KR}.mp3` naming, the 2016 legacy layout |
| Persistence | `backend/src/1_adapters/persistence/yaml/YamlLanguageStudyDatastore.mjs` | progress + attempt log |
| Application | `backend/src/3_applications/school/LanguageStudyService.mjs` | orchestration |
| API | `backend/src/4_api/v1/routers/language.mjs` → `/api/v1/school/language` | HTTP shell |
| Frontend | `frontend/src/modules/School/Programs/Glossika/` | the Glossika *course* as a School program |
| Corpus | `data/content/language/{corpusId}.yml` | content type, id as filename |
| Audio | `media/apps/school/language/{corpusId}/` | corpus-scoped, multi-course ready |
| Ingest CLI | `cli/glossika.cli.mjs` | vendor ingest |

Code layers are vendor-free; asset paths are **corpus-scoped**, so a learner
studying two courses can never have their counters, logs or recordings collide.
A second source adds an adapter and a corpus file and touches no domain code —
which is not hypothetical: this corpus already carries two, the commercial
course and the wordbook import, distinguished only by each sentence's `origin`.

> `school` was missing from the domain-level table in
> `docs/reference/core/layers-of-abstraction/ddd-reference.md` despite the
> domain already existing. Added as **Level 2 — Features** alongside the other
> feature domains.

### API

```
GET  /courses                      → available courses
GET  /users/:userId/day            → { day, dailyLimit, queue, progress, capabilities }
POST /users/:userId/log            → append one attempt event
POST /users/:userId/recording      → multipart upload; writes file, appends event
PUT  /users/:userId/pacing         → { dailyLimit }
POST /users/:userId/roll           → advance the day (server re-checks the rule)
GET  /users/:userId/history        → log folded by day, for the Review surface
GET  /audio/:course/:seq/:lang     → sentence audio by slug
GET  /recordings/:userId/:seq      → a user's own recording
```

`userId` is required on every write. **A guest produces no records** — the
frontend hides the program for an unclaimed identity rather than letting it
fail on submit, matching the School convention.

---

## 5. Frontend

```
Programs/Glossika/
  GlossikaProgram.jsx      shell: day header, rung tabs, progress bar
  rungs/RepetitionRung.jsx audio-only shadowing loop
  rungs/DictationRung.jsx  Hangul entry + replay
  rungs/RecordingRung.jsx  MediaRecorder capture + playback + accept
  rungs/InterpretationRung.jsx  English entry
  ReviewPanel.jsx          history by day, dictation diffs, recording playback
  useGlossikaAudio.js      sequenced playback + next-item preload
  useCapabilities.js       mic / keyboard detection
  glossikaApi.js           fetch wrapper, mirrors schoolApi.js
```

Registered as a home-grid section alongside the built-ins, following
`home/sections.js`. **A tile never points at an absent endpoint** — the section
renders only once the corpus is confirmed present.

`useGlossikaAudio` preserves the 2016 preload trick (the *next* item's audio is
loaded into a spare element while the current one plays) — on a slow panel that
gap is the difference between a drill and a slideshow. Audio uses the logging
framework, not `console.*`, and every rung logs mount, advance, save, and
failure.

---

## 6. Legacy import (revised 2026-07-22 — the database was recovered)

> An earlier revision of this document stated the 2016 MySQL database was gone
> and that only voice recordings survived. **That was wrong.** A dump exists at
> `dbbackup/2020-12-01/glossika.gz`, and it carries the entire study history.

**`import-db` is the authoritative import.** It supersedes `ingest-corpus` +
`import-legacy`, which between them could only reconstruct `recording` events
from file mtimes — no day numbers, no typed answers, and only the one rung that
happened to leave a file behind.

What the dump restores:

| | mtime reconstruction | recovered dump |
|---|---|---|
| Events | 519, recordings only | **5,348**, all four rungs |
| Day numbers | none | **real** — KC 1–59, Elizabeth 1–119 |
| Typed answers | lost | **2,655**, all scored on import |
| Sentences | 3,000 | **4,143** |
| Span | inferred | KC 2017-10→2019-12, Elizabeth 2016-12→2020-01 |

Reading it lives in `1_adapters/glossika/LegacyDumpReader.mjs` — an
anti-corruption layer that is the only code aware of the old vocabulary
(`action`→rung, `data`→given, `val`→target text, `ekern`→`elizabeth`).

**Two sources, one corpus.** Sequences 1–3000 are the commercial course read by
native speakers; 3001–4143 were appended by the original `import.php` from a
scraped wordbook whose audio was **TTS**. Each sentence records its `origin`,
because the two do not sound alike and only the TTS half is regenerable — which
also explains why 818 sentences have no audio at all. They stay in ONE corpus
deliberately: the 2016 app drove both up a single ladder with one continuous
sequence and one day counter, so splitting them now would invent a division the
study history never had.

**A sentence with no audio can be history but not work.** Every rung's prompt
is audio, so `buildDayQueue` takes a `playable` set and never queues an
unplayable sentence — while still counting it as studied, so it is not
re-admitted as new material either.

**Ownership on re-run is `source`.** An event carrying a source marker is
imported evidence and may be replaced by a later import; an event with no
source is live study done here and is always preserved. That rule is what lets
`import-db` clear the superseded `legacy-2017` events rather than leaving them
as duplicates of their own better-dated selves.

**Skips are counted, never silent.** 18 rows carry an empty `sentence_id` — the
2016 app's `loadSeq` could yield null and still POST. They are genuinely
unusable, and reported rather than dropped quietly.

Imported events carry `source: legacy-db` so an audit can always tell recovered
evidence from live evidence.

---

## 7. Deliberately not built

Named deferrals, not gaps:

- **Romanization / IPA** — present in `Rawtext` but mojibake-encoded; no rung
  needs it yet.
- **Regenerating the missing TTS audio** for the 818 audio-less sentences.
  They are wordbook vocabulary whose audio was synthesised in the first place,
  so it is reproducible — but nothing depends on it, and they remain fully
  intact as history meanwhile.
- **The "Reader" companion** (`kckern.info/korean/articles/`) — a separate
  reading-comprehension surface; out of scope.
- **Speech scoring on recordings.** The 2016 app never scored them either; a
  recording is evidence for self-review, not a graded artifact.
- **Coin economy credit.** Sub-project 4 consumes what this records; this
  program only produces the events.
- **Non-Korean courses.** The corpus format is course-keyed and the service
  takes a course id, so a second language is config plus assets — but only
  Korean is ingested.
