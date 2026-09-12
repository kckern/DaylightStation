# Pen Pal — Conversational Language Learning (Glossed Chat)

**Status:** Proposed (brainstorm → roadmap item)
**Created:** 2026-09-11
**Owners:** School / Agents / Frontend platform
**Working name decision:** the School program is **Pen Pal** (`program_id: pen-pal`). The reusable substrate underneath it is deliberately *not* called Pen Pal — see §3. Rename the program freely; the substrate names are the ones that must survive.

---

## 1. Summary

A chat program where a child converses with an in-character agent **in the target language**, with two safety rails that make the conversation survivable at a low level:

1. **Every incoming message is pre-glossed.** The agent does not return a string; it returns an ordered list of *tokens* (word or sub-word), each carrying a part-of-speech / grammatical role and a meaning. The UI renders the plain sentence; tapping any token reveals its gloss instantly, with no round trip and no dictionary lookup latency.
2. **Every outgoing message passes a light-touch proofread gate.** Before the learner's reply enters the transcript, an inexpensive model pass may offer "did you mean…?" with per-item accept/decline. Configurable, including fully off.

Beside the composer sits a **source → target lexicon panel**: the learner types "backpack", gets candidate target-language words with glosses, and taps one to insert it into the draft.

The first proof of concept: **Korean**, persona **Professor Oak**, learner role **Pokémon trainer**, topic **the learner's own Pokémon Red playthrough**, which the agent can query by tool call.

The product promise:

> Talk to someone interesting, in a language you barely know, without ever being stuck and without being corrected in public.

### Goals

- One conversation loop that works at A0 through B1 without changing programs.
- Separation of concerns that survives the second and third persona: language, level, persona, topic and knowledge corpus are five independent axes (§4).
- A chat surface, a gloss renderer, a lexicon service and a proofread gate that are **not** School-specific and can be mounted anywhere in the app.
- Persona-specific knowledge (a Pokémon playthrough, a Pokémon-names-in-Korean glossary) reached by **tool call**, never by prompt stuffing.

### Non-goals for v1

- Speech: no ASR of the learner's spoken reply, no pronunciation scoring. TTS playback of the agent's line is in scope as a stretch (§10); the learner types.
- A general SRS/vocabulary-retention engine. Flashcards and Sentence Ladder already own spaced repetition; Pen Pal *feeds* them at most.
- Grading, term credit, or report-card contribution beyond "minutes on task + turns completed".
- Free-form user-authored personas in the UI. Personas are authored as data files by a grown-up.

---

## 2. What already exists (verified 2026-09-11)

This is the reuse inventory. Every path below was read, not assumed.

| Capability | Where | Reusable as-is? |
|---|---|---|
| Shared agent chat surface (assistant-ui v0.12.28): thread, composer, streaming, tool-call attribution, `@`-mention popover, session persistence | `frontend/src/modules/Agent/AgentChatSurface.jsx` + `runtime.js` | **Yes** — already reused by Health CoachChat and Life CoachChat. Needs an extension point for custom message bodies (§6). |
| Agent HTTP surface: `POST /api/v1/agents/{agentId}/run`, `/run-stream` (SSE), `/run-background`, plus context/thread plumbing | `backend/src/4_api/v1/agents/mountAgentHttp.mjs` | **Yes** |
| Agent runtime with tools, memory, transcript, structured output (`options.outputSchema` → `structuredOutput`, strict) | `backend/src/1_adapters/agents/MastraAdapter.mjs` | **Yes for `execute`.** `streamExecute` does **not** apply `outputSchema` — a real constraint, see §7. |
| Agent base class, tool factories, assignments, working memory | `backend/src/3_applications/agents/framework/BaseAgent.mjs`, `ToolFactory.mjs`, `ToolBundle.mjs` | Yes |
| JSON-schema output validation with correction retry | `backend/src/3_applications/agents/framework/OutputValidator.mjs` | Yes — the fallback path when strict structured output fails |
| Per-agent memory config (`last_messages`, working memory, observational) | `data/system/config/agents.yml` | Yes |
| School program pattern end to end: launcher → service → enrollment validator → frontend program component → per-learner records | `SentenceLadderProgramLauncher.mjs` / `LanguageProgramLauncher.mjs`, `LanguageStudyService.mjs`, `SchoolProgramEnrollmentValidators.mjs`, `frontend/src/modules/School/Programs/SentenceLadder/` | **Yes** — copy the shape exactly |
| Language corpus domain: bands, scope ranges, named units, day queue, rollover | `backend/src/2_domains/school/language/` | Partially — corpus/units/scope ideas transfer; sentence-pair mechanics do not |
| Target-language audio serving (prompt audio, recorded takes, cues) | `backend/src/3_applications/school/LanguageAudioResource.mjs` | Yes, for pre-generated lines |
| Text-to-speech API | `backend/src/4_api/v1/routers/tts.mjs`, `backend/src/3_applications/tts/SpeechSynthesis.mjs` | Yes — voice inventory per language needs confirming before relying on it |
| Emulator saves for Pokémon Red/Yellow, per learner | `media/emulation/gb/saves/{learner}/pokemon-red.srm` (32 KB Gen-1 SRAM) | **Raw material only** — see §8 |

### What does not exist

- **No dictionary/lexicon service anywhere in the backend.** Grepping for `dictionary`/`lexicon`/`gloss` across `backend/src` returns only finance and book-shelf false positives. This is net-new.
- **No token-level gloss contract.** Agent replies are plain text today.
- **No structured pre-send gate.** Every existing chat sends the raw composer text.
- **No persona model.** Agents are singletons (`health-coach`, `lifeplan-guide`) with a hardcoded prompt and id. Nothing today parameterises one agent class into many characters.
- **No Pokémon journey history.** There is a `pokemon-journey-foundations` reference inside one generated piano/card-battle definition, and there are `.srm` save files — but no timeline, no episode log, no queryable record of what the child did. §8 says what to do about it.

---

## 3. Layering — five things, four of them not School's

The single most important structural decision: **Pen Pal is the thinnest layer.** Everything interesting lives below it and is mountable elsewhere.

```text
┌─────────────────────────────────────────────────────────────┐
│ L4  School program: pen-pal                                 │ School-specific
│     enrollment, scheduling, day credit, records, launcher   │
├─────────────────────────────────────────────────────────────┤
│ L3  Conversation Partner agent (persona-parameterised)      │ app-wide
│     one agent class × N persona definitions × tool bundles  │
├─────────────────────────────────────────────────────────────┤
│ L2  Glossed chat UI: GlossedMessage, TokenPeek,             │ app-wide
│     LexiconPanel, ProofreadGate — extensions of             │
│     AgentChatSurface, not a fork of it                      │
├─────────────────────────────────────────────────────────────┤
│ L1  Annotated-message contract (schema, shared/)            │ app-wide
│     tokens, glosses, corrections — one JSON shape           │
├─────────────────────────────────────────────────────────────┤
│ L0  Lexicon service: look up a word, either direction,      │ app-wide
│     scoped by language + optional overlay corpora           │
└─────────────────────────────────────────────────────────────┘
```

Rules that keep the layering honest:

- **L0–L2 must never import from `modules/School` or `applications/school`.** An `audit:ui`-style lint or a plain import check in the test suite should enforce it.
- **L1 is the only contract L2 and L3 share.** The frontend never learns which model produced a gloss; the agent never learns how a gloss is rendered.
- **L3 knows nothing about school days, minutes, or credit.** It produces turns. L4 counts them.
- A second consumer is the acceptance test for the layering. Candidate: the Health coach glossing a nutrition label, or a Media-app "what did they just say" overlay. If L0–L2 cannot serve one of those without edits, the seam is in the wrong place.

---

## 4. The configuration taxonomy — five independent axes

The user's central requirement, stated as a model. Each axis is a separate file with a separate id, and a *enrollment* is a tuple of them.

| Axis | Answers | Owns |
|---|---|---|
| **Language pair** | Korean from English | script, direction, tokenizer hints, TTS voice, default lexicon |
| **Level** | A1, "third-grade reading" | sentence length ceiling, allowed grammar, gloss verbosity, whether the source language may appear at all |
| **Persona** | Professor Oak | name, portrait, voice, speech register, personality prompt, greeting behaviour, **tool bundle** |
| **Topic** | "your Pokémon journey" | conversation goal, opening moves, subject vocabulary overlay, knowledge sources |
| **Learner role** | "you are a trainer named …" | how the agent addresses the learner, what it may assume they know |

Relationships, as the user described them:

- A **persona has one or more topics**; a topic belongs to exactly one persona. A persona with a single topic is the common case and must not require a second file.
- **Language and level are orthogonal to persona.** Professor Oak in Korean A1 and Professor Oak in Spanish B1 are the same persona file with a different enrollment.
- **Vocabulary overlays attach at persona OR topic level** (Pokémon names in Korean attach to the *topic*; Oak's verbal tics attach to the *persona*).
- **Knowledge sources attach at topic level** and are expressed as tool grants, never as inlined text.

### Enrollment = the tuple

```yaml
# per learner, in the School assignment record
programId: pen-pal
personaId: prof-oak            # → personas/prof-oak.yml
topicId: pokemon-journey        # must be listed by that persona
language: { source: EN, target: KO }
level: a1
learnerRole: pokemon-trainer
policy:
  proofread: suggest            # off | suggest | require-review
  lexicon: enabled              # enabled | disabled
  glossDepth: word              # word | morpheme
  turnsPerSession: 8
  reward: { amount: 5 }
```

`SchoolProgramEnrollmentValidators.mjs` gets one more entry; validation must reject a `topicId` the persona does not declare, an unknown `level`, and a `language.target` with no lexicon installed. Follow the existing pattern: **reject, never silently drop** — a mistyped persona should refuse the enrollment, exactly as a mistyped language unit does today.

### Where the files live

```text
data/content/language/
  lexicons/{ko}/…                     # L0 corpus, see §5
  levels/{a1,a2,b1}.yml               # level ladders, language-agnostic where possible
  personas/{persona-id}.yml           # portrait, register, prompt, topics[], toolGrants[]
  personas/{persona-id}/topics/{topic-id}.yml
  overlays/{overlay-id}.yml           # e.g. pokemon-names-ko
data/household/school/records/pen-pal/…      # household-level program config
data/users/{learnerId}/apps/school/pen-pal/  # transcripts, turn counts, seen-vocabulary
```

This mirrors the existing split exactly: shared content under `data/content/school/language/`, per-learner state under `data/users/{id}/apps/school/`.

---

## 5. L0 — the Lexicon service

**Decision: SQLite, not YAML.** A usable Korean↔English lexicon is 50k–150k entries. YAML means parsing megabytes at boot and a linear scan per lookup. The agents stack already ships a SQLite file (`data/agents/memory.db`), so the dependency and the ops story exist. A YAML *source* file per language is fine as the authoring format; a build step compiles it into the database, the way generated banks are built today.

### Interface (domain port, adapter behind it)

```text
lookup({ language, term, direction, overlays[], limit })
  → [{ lemma, reading, pos, senses: [{ gloss, register, example? }], frequency, source }]

annotate({ language, text, level, overlays[] })   # tokenizer + gloss attach
  → token[]  (the L1 shape)
```

Two operations, two very different cost profiles:

- `lookup` is the composer's dictionary sidebar. Pure data, no model, sub-10 ms, cacheable, and works offline.
- `annotate` is the fallback path for glossing text the agent did *not* gloss (e.g. pasted text, or a persona that returned a bare string). For v1 the agent glosses its own output, so `annotate` is optional — build the port, defer the implementation.

### Overlays

An overlay is a small YAML file merged over the base lexicon at query time, with higher precedence:

```yaml
id: pokemon-names-ko
language: KO
entries:
  - lemma: 파이리
    pos: proper-noun
    senses: [{ gloss: "Charmander", note: "Pokémon species" }]
```

Overlays are the answer to "Pokémon names in Korean, and other topic-specific words that no dictionary has." They attach at persona or topic level (§4) and are cheap to author by hand.

### Sourcing the base data

Candidates for Korean↔English, in rough order of preference — **every licence below must be confirmed against its current terms before the build step is written**, this is the one external dependency in the whole design:

| Candidate | Shape | Note |
|---|---|---|
| Korean-English Learners' Dictionary (National Institute of Korean Language) | Curated learner glosses, levelled | Best fit for a child learner; open-licence terms and bulk-download route need checking |
| Wiktionary extracts (e.g. a machine-readable dump) | Broad, uneven | CC BY-SA — attribution obligation is real and must reach the UI's `source` field |
| `kengdic`-style community wordlists | Small, plain, easy to compile | Thin senses; usable as a fallback layer under a better source |

Whatever is chosen, `source` is mandatory on every entry and surfaced in the peek — a wrong gloss must be traceable, and an attribution-bearing licence makes that non-optional anyway. Layering is allowed: a curated source first, a broad source as fallback, overlays on top.

**Tokenization.** Korean is agglutinative, so offsets cannot be found by splitting on spaces. For v1 the agent emits its own token offsets (§7) and no tokenizer is needed. The `annotate` fallback, when it is built, needs a real morphological analyser (the `mecab-ko` family, or an equivalent); treat that as a separate decision at the time, not a P1 dependency.

---

## 6. L1 & L2 — the annotated-message contract and the glossed UI

### The contract (lives in `shared/contracts/`, imported by both sides)

```jsonc
{
  "role": "assistant",
  "language": "KO",
  "text": "오늘 어떤 포켓몬을 잡았어요?",      // the plain string, authoritative for display
  "tokens": [
    { "s": 0, "e": 2, "surface": "오늘", "lemma": "오늘",
      "pos": "adverb", "gloss": "today", "confidence": 0.98 },
    { "s": 3, "e": 5, "surface": "어떤", "lemma": "어떤",
      "pos": "determiner", "gloss": "which / what kind of" },
    { "s": 6, "e": 10, "surface": "포켓몬을", "lemma": "포켓몬",
      "pos": "noun", "gloss": "Pokémon", "source": "overlay:pokemon-names-ko",
      "parts": [ { "surface": "포켓몬", "role": "stem" },
                 { "surface": "을", "role": "particle",
                   "gloss": "object marker", "note": "marks the thing being caught" } ] },
    { "s": 11, "e": 16, "surface": "잡았어요", "lemma": "잡다",
      "pos": "verb", "gloss": "to catch",
      "parts": [ { "surface": "잡", "role": "stem" },
                 { "surface": "았", "role": "tense", "gloss": "past" },
                 { "surface": "어요", "role": "ending", "gloss": "polite" } ] }
  ],
  "notes": [ { "kind": "structure", "spans": [[6,16]],
               "text": "Object + verb: Korean puts the verb last." } ]
}
```

Design points, each load-bearing:

- **`text` is authoritative for display; `tokens` are an overlay keyed by character offsets.** If the token list is malformed, truncated or missing, the UI still renders a correct sentence — it just loses the tapping. This is the difference between a degraded feature and a broken screen, and it is why tokens carry offsets rather than the UI concatenating surfaces.
- **`parts` is the sub-word level** the user asked for: particles, tense markers, honorific endings. `glossDepth: word` collapses it; `morpheme` exposes it.
- **`notes` carries the "weird sentence structure" case** — a span-anchored remark that is not attached to a single token.
- **`pos` is a closed vocabulary** defined in the contract, so the UI can colour-code without string-matching model output.

### The UI components

```text
<AgentChatSurface>                     (existing, unchanged for existing callers)
  └── components.AssistantMessage ──▶  <GlossedMessage tokens=… />   NEW
                                         └── <TokenPeek />            NEW popover
  └── components.Composer      ──▶     <LexiconComposer />            NEW
                                         ├── <LexiconPanel />         NEW sidebar
                                         └── <ProofreadGate />        NEW pre-send modal
```

The required change to the shared surface is **one prop**: `components`, an override map for message and composer slots, defaulting to today's implementations. `AgentChatSurface` already hardcodes `UserMessage`/`AssistantMessage` into `ThreadPrimitive.Messages`; threading a prop through is a small, safe, backwards-compatible edit. **Do not fork the surface.**

`Popover.jsx` already exists in the SentenceLadder folder and is the natural donor for `TokenPeek` — promote it to the shared UI library rather than copying it.

Interaction detail worth stating now: tapping a token is **peek, not navigate**. No page change, no scroll jump, dismiss on outside tap, and the peek records a `vocab.peeked` event — that event is the most useful learning signal the program produces and should exist from turn one.

---

## 7. L3 — the Conversation Partner agent

### One class, many personas

`ConversationPartnerAgent extends BaseAgent`, instantiated per `(personaId, topicId, language, level)`. `BaseAgent.getSystemPrompt(context)` already accepts a context argument, so the persona/topic/level compose into the prompt without touching the framework. The prompt is assembled from four fragments — persona voice, topic goal, level constraints, learner role — each from its own file, never one monolithic string.

Registration: today `AgentOrchestrator.register(AgentClass, deps)` keys on `AgentClass.id`. Personas need **either** one registered agent id (`conversation-partner`) that takes persona/topic from request context, **or** dynamic registration per persona. **Decision: one registered id, persona in context.** It keeps the agent registry small, keeps `/api/v1/agents/conversation-partner/run` stable, and matches how `contextExtractor` already works in `mountAgentHttp`. Thread ids must then include the persona and learner so two personas do not share memory: `t-{learnerId}-{personaId}-{topicId}`.

### Structured output — the one real architectural constraint

`MastraAdapter.execute()` supports `options.outputSchema` and enforces it strictly. **`streamExecute()` does not.** Streaming yields text deltas and never validates an object.

Consequences, and the decision:

- A glossed reply **cannot** be produced by the existing streaming path. Use `execute()` with `outputSchema`, i.e. a single non-streaming call per turn.
- That is acceptable and arguably better here: the "… is typing" indicator the user described is exactly the UX for a non-streamed turn, and a sentence that appears whole is easier to read at A1 than one that types itself out character by character.
- Keep `OutputValidator.validateWithRetry` as the recovery path: if strict structured output fails, retry once with the correction prompt, then fall back to `{ text, tokens: [] }` — an un-tappable but correct sentence (§6's degradation rule).
- **Do not** extend `streamExecute` to validate schemas for v1. Revisit only if turn latency proves unbearable, and then stream the `text` field while the token list arrives at the end.

### Tools, not prompt stuffing

The persona file grants a tool bundle. For the Pokémon proof of concept:

| Tool | Purpose |
|---|---|
| `lookupJourney({ query, since })` | Query the learner's playthrough record (§8) |
| `lookupLexicon({ term, direction })` | The same L0 service the sidebar uses — so the agent's glosses agree with the dictionary |
| `lookupTopicOverlay({ term })` | Species names and topic vocabulary |
| `recallLearner()` | Working memory: what this learner has struggled with, names they use |

Tool results are recorded in the transcript already (`AgentTranscript`), which means "why did Oak say that?" is answerable after the fact.

---

## 8. The Pokémon journey corpus — honest status

The user's framing was "we may have the entire game history". We do not. What exists:

- `media/emulation/gb/saves/{learner}/pokemon-red.srm` — a 32 KB Gen-1 SRAM image per learner. This is a **snapshot**, not a history: party, boxed Pokémon, badges, Pokédex seen/owned bitfields, money, player name, playtime. Well-documented layout; parsing it is a contained, deterministic job with no model involved.
- Save-state directories per learner per game.
- Emulator session records in the gaming app (session start/stop, which is *when they played*, not *what happened*).

**Decision: build a `JourneyProjection` from repeated SRAM snapshots, and do not attempt event-level history in v1.**

- A small ingestor parses `pokemon-red.srm` into a structured YAML snapshot (`data/users/{id}/apps/gaming/journeys/pokemon-red/{timestamp}.yml`).
- Running it on a schedule, or on emulator-session end, turns a sequence of snapshots into a **diff timeline**: "between Tuesday and Thursday: Boulder Badge earned, Pikachu reached level 14, Pokédex 12 → 18". That is more than enough for "how did you get that badge?" and it is real data, not invented.
- Historic depth is limited to when ingestion starts. Say so in the persona prompt: the agent may ask about things it cannot see, but must never assert an event it has no record of.

This also generalises: `JourneyProjection` is a gaming-domain concept, and a second topic (a different game, a fitness quest, a reading log) can implement the same port.

---

## 9. The turn lifecycle

```text
  OPEN
   └─ persona greeting  ── agent turn (glossed) ──▶ rendered; tokens tappable

  LEARNER COMPOSES
   ├─ types freely in target language
   ├─ stuck → LexiconPanel: type "backpack" (source lang) → candidates → tap → inserted at caret
   └─ presses Send
        │
        ▼
  PROOFREAD GATE   (policy: off | suggest | require-review)
   ├─ off          → straight through
   ├─ suggest      → cheap model pass; if it has nothing to say, straight through (no modal)
   │                 if it does: original vs. suggested, per-item accept/decline,
   │                 one-line "why" per item; learner may Send Anyway
   └─ require-review → same, but a deliberate action is required even on a clean pass
        │
        ▼
  SEND  → transcript records BOTH the learner's original and what was sent, plus which
          corrections were accepted. That pair is the program's best learning signal.
        │
        ▼
  TYPING INDICATOR (real latency, not a fake delay — the structured turn takes a second or two)
        │
        ▼
  AGENT TURN (glossed)  → loop
```

The gate is explicitly **not** a grader. Its instructions cap it: name at most three issues, prefer the one that would most confuse a listener, never rewrite the learner's meaning, and never comment on content. A second, *much* cheaper model than the conversation agent — this call happens on every single turn.

"We don't want them to speed-run it" (user's words) is implemented as: the gate's suggestions cannot be dismissed by pressing Enter twice. Accepting or declining is an explicit tap. That is the whole friction budget — no timers, no forced reading delays.

---

## 10. Surfaces and input — the risk nobody thinks about until demo day

Pen Pal requires **typing in the target language**, which is different from every existing School program.

- On the **Portal tablet** (FullyKiosk WebView), typing Korean requires a Korean IME installed and selectable in the Android keyboard settings. Unverified. If it is missing, the program is unusable on the surface the children actually use.
- **Decision: ship an in-app on-screen keyboard for the target language's script**, rendered by the app, not the OS. For Korean that is a 2-set Hangul keyboard with jamo composition — a known, bounded problem, and it removes the dependency on device IME configuration entirely. It also makes the LexiconPanel's tap-to-insert consistent with how the rest of the text is entered.
- The existing rule that **school surfaces stay hands-free at every step** still binds the *navigation*: arriving at Pen Pal, starting a conversation, and ending it must all work from the keyboard/remote. Only the composing step requires touch.
- TTS playback of the persona's line: use the existing `/api/v1/tts` route. **Confirm a Korean voice exists before promising it**; if not, ship silent v1 and add audio as a follow-up. Audio must obey the master volume binding, as all school audio does.

---

## 11. Delivery phases

| Phase | Deliverable | Done when |
|---|---|---|
| **P0 — Contract** | L1 annotated-message schema in `shared/contracts/`, with fixtures and a validator | A fixture round-trips; the schema rejects a token whose offsets fall outside `text` |
| **P1 — Lexicon** | L0 service: port, SQLite adapter, build step, one language (KO), overlay merge, `GET /api/v1/lexicon` | `lookup` returns glosses both directions in < 10 ms; an overlay entry beats the base entry |
| **P2 — Glossed reading** | `GlossedMessage` + `TokenPeek`; `components` prop on `AgentChatSurface`; a static fixture conversation at `/dev/…` | Tapping any token peeks; a message with `tokens: []` still renders correctly |
| **P3 — The agent** | `ConversationPartnerAgent`, persona/topic/level file format, structured output via `execute` + `outputSchema`, one persona (Prof. Oak) with no tools | A real turn comes back glossed and schema-valid; a forced schema failure degrades to plain text |
| **P4 — Composing** | `LexiconPanel`, tap-to-insert, in-app Hangul keyboard | A learner can produce a Korean sentence with no OS IME |
| **P5 — The gate** | `ProofreadGate`, three policy modes, per-item accept, transcript records original + sent + accepted | A clean sentence passes with no modal in `suggest` mode |
| **P6 — School wrapper** | `pen-pal` enrollment validator, launcher, program component, day credit, records, teacher visibility | A grown-up can enrol a child from the Teacher console and the child can reach it from the Portal |
| **P7 — Journey knowledge** | SRAM ingestor, `JourneyProjection`, `lookupJourney` tool, topic overlay for species names | Oak asks about a badge the child actually earned |

P0–P2 are useful on their own: they make any agent in the app able to speak a foreign language legibly. P6 is the only School-coupled phase, and it is the smallest.

---

## 12. Decisions already taken (revisit only with a reason)

1. **SQLite for the lexicon**, YAML for authoring and overlays.
2. **One registered agent id** (`conversation-partner`), persona supplied by request context.
3. **Non-streaming structured turns** with a typing indicator; do not teach `streamExecute` to validate schemas.
4. **`text` is authoritative, tokens are an overlay** — malformed glosses degrade, never break.
5. **In-app script keyboard**, not the device IME.
6. **Journey knowledge is a snapshot-diff projection**, not an event log; the agent may not assert unrecorded events.
7. **Program name `pen-pal`**; substrate names (`lexicon`, `annotated-message`, `conversation-partner`) are the durable ones.
8. **The proofread gate uses a cheaper model** than the conversation agent, and is capped at three observations per turn.

## 13. Questions that genuinely change the build

These are the only ones worth a decision from the user before P1 starts:

- **Which base Korean lexicon**, and is its licence acceptable for a household-only, non-redistributed deployment? Everything in P1 hangs on the answer, and the wrong choice is expensive to unpick.
- **Does the target device have a Korean IME?** If yes, P4 shrinks to the LexiconPanel alone. Ten minutes with the tablet answers it and may remove a whole phase.

Everything else in this document is decided.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Gloss quality: a model invents a plausible wrong meaning | Cross-check the agent's gloss against the L0 lexicon for known lemmas; flag disagreement in the peek rather than hiding it. `source` is always shown. |
| Cost: two model calls per turn, every turn | Gate uses a small model; conversation turn is capped in length by the level ladder; per-session turn cap in policy. Track against the existing `AiUsageLedger`. |
| Latency: a structured turn is slower than a streamed one | Typing indicator is honest, not decorative. If p95 exceeds ~4 s, split the call: text first, tokens second. |
| A persona breaks character or drifts above level | Level constraints are prompt-enforced *and* post-checked: a reply whose token count exceeds the level ceiling is regenerated once. |
| The layering rots and L0–L2 grow School imports | An import-boundary check in the test suite from P2 onward, not a convention in a doc. |
| Child pastes English and the persona answers in English | Persona prompt forbids it; the gate is the natural place to catch a fully-source-language reply and ask for a target-language attempt. |
