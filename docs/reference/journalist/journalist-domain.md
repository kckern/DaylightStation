# Journalist Domain

The Journalist domain models a daily journaling conversation: a structured back-and-forth where the user records what happened, how they feel, and how the day fits the broader arc of their life. It is the pure-logic core behind the Journalist Telegram bot and the morning debrief pipeline.

The domain has no I/O. It defines the shapes that flow through a journaling session — messages, queued prompts, quiz items, journal entries — and the rules that turn loose conversation into a saved daily record. Persistence, network calls, AI invocation, and Telegram delivery all live in adjacent layers and depend on this one.

---

## What it does

### Models a conversation as a stream of messages

A conversation is a sequence of messages, each tagged with a chat, sender, timestamp, and free-form foreign-key references to whatever produced it (a queued prompt, a quiz question, an inbound webhook). Inbound Telegram updates are normalized into the same message shape that bot-authored replies use, so the rest of the domain treats both sides uniformly.

### Treats prompts as a queue, not a script

A journaling session may need to ask several follow-up questions in a row. The domain models that as a queue of pending prompts: each prompt knows its target chat, its text, optional keyboard choices, and the foreign keys that link it back to the question that spawned it. Sending a prompt marks the queue item as sent (without mutating — entities are frozen and produce updated copies). The domain provides the rules for advancing the queue, formatting choices as a numbered keyboard, and deciding when a user response has drifted far enough off-topic that the remaining queued prompts no longer apply.

### Aggregates messages into journal entries

A day's worth of user messages collapses into one or more journal entries, grouped by time-of-day period (morning / afternoon / evening / night). Each entry tracks how it was captured — typed text, transcribed voice, callback-button selection, or system-generated — and can carry an optional analysis block (themes, sentiment, insights, therapist-style note) added after the fact.

### Carries a structured quiz alongside free-form journaling

Some prompts are open-ended; others are categorical (mood, goals, gratitude, reflection, habits) with a fixed set of choices. The domain models quiz questions as reusable items with a "last asked" timestamp, and quiz answers as references back to the question plus the user's choice index or text. This lets the bot rotate through questions over time without re-asking the same one too soon.

### Builds prompts and parses responses for the AI layer

The AI gateway lives outside the domain, but the *shape* of what gets sent to it is domain logic. The domain knows how to build the system + user message pair for each prompt type — biographer follow-ups, autobiographer openings, therapist analysis, multiple-choice generation, conversational replies, and continue/abandon evaluation — and how to parse the AI's response back into a clean list of questions, whether the model returned JSON, a code-fenced block, or compound prose.

### Formats history and splits long messages

Conversation history flows into prompts as a chat transcript, a chat-context array for chat-completion APIs, or a user-text-only stream for analysis. The domain truncates history to a target length while preserving the most recent turns. When a single outbound message would exceed Telegram's 4096-character ceiling, the domain splits it at natural boundaries (paragraph, then sentence, then word) and numbers the parts.

---

## Prompt types

The domain defines a fixed vocabulary of prompt purposes that the AI layer dispatches against:

| Purpose | Used for |
|---------|----------|
| Biographer | Generate follow-up questions after a user shares an entry |
| Autobiographer | Generate an opening question to start a session |
| Multiple choice | Generate short answer options for a question |
| Conversational | One-shot natural follow-up in a casual register |
| Conversational choices | Personalized short answers informed by history and today's debrief |
| Evaluate response | Decide whether the remaining queued questions still apply |
| Therapist analysis | Multi-paragraph reflective analysis over a window of entries |

---

## Quiz categories

Categorical prompts cover five reflection surfaces: mood, goals, gratitude, reflection, and habits. Each category carries a display emoji and a one-line description so downstream consumers (the bot, exports) render consistently without re-deriving labels.

---

## Entry sources

A journal entry's `source` records how it was captured: typed text, voice-transcribed, button callback, or system-generated. Source drives display affordances (e.g., voice entries surface the transcription separately) and lets analysis distinguish deliberate reflection from quick taps.

---

## Boundary

The domain does not:

- Talk to Telegram, the AI provider, or the YAML store directly — those are adapters, invoked from the application layer.
- Read clocks or generate timestamps on its own — all time values are passed in as arguments from the application layer, so the domain stays deterministic and testable.
- Know about user identity, authentication, or device routing — it works in terms of opaque chat IDs.
- Decide *when* to initiate a session or *whom* to send to — scheduling and dispatch live in `3_applications/journalist/` (use cases, jobs, container).

---

## Where it lives

`backend/src/2_domains/journalist/` — entities, value objects, and pure domain services.

Adjacent layers that depend on this domain:

- **Use cases & orchestration:** `backend/src/3_applications/journalist/`
- **Persistence:** `backend/src/1_adapters/persistence/yaml/` (journal entries, message queues, quiz state)
- **Messaging & AI gateways:** `backend/src/1_adapters/messaging/`, `backend/src/1_adapters/ai/`
- **HTTP surface:** `backend/src/4_api/v1/routers/journalist.mjs` and handlers under `backend/src/4_api/v1/handlers/journalist/`
