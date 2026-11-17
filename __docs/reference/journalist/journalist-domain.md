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

## Morning debrief inputs

`GenerateMorningDebrief` (application layer) builds the daily message from the lifelog aggregate. Three rules keep it truthful:

- **Journal entries feed it.** The journalist lifelog extractor matches entries by *local* date and reads both stored timestamp shapes: legacy local `YYYY-MM-DD HH:mm:ss` and ISO UTC. Entries stopped reaching the debrief for most of 2026 when the store switched to ISO; a late-evening ISO entry belongs to the day it was written, not the next UTC day.
- **GitHub reports what moved, not time spent.** Most commits are made by AI coding agents running in the background. The GitHub extractor groups commit messages by repo, counts agent co-authored commits, and prints no clock times. The prompt forbids inferring late nights, sprints or focus from commits.
- **It sees its own recent output.** The last seven debriefs' hooks and questions go to the model as shapes to avoid. Without them it settles into a template ("X crowded out your day", "What drove the late-night push—deadline or momentum?"). The prompt also bans displacement and grind framing, either/or question menus, and the stock music and email questions. Household speakers mean children's listening shows up in scrobbles.

Starting an interview preserves the delivered debrief, its message IDs and category questions. Interview progress lives in `flowState`; the existing root fields remain available to debrief callbacks. The transition sets `subFlow: 'interview'` so an earlier source picker cannot keep handling replies.

---

## Boundary

The domain does not:

- Talk to Telegram, the AI provider, or the YAML store directly — those are adapters, invoked from the application layer.
- Read clocks or generate timestamps on its own — all time values are passed in as arguments from the application layer, so the domain stays deterministic and testable.
- Know about user identity, authentication, or device routing — it works in terms of opaque chat IDs.
- Decide *when* to initiate a session or *whom* to send to — scheduling and dispatch live in `3_applications/journalist/` (use cases, jobs, container).

---

## Where it lives

`__app_modules/personal/journalist/server/domain/` — entities, value objects, and pure domain services.

Adjacent layers that depend on this domain:

- **Use cases & orchestration:** `__app_modules/personal/journalist/server/application/`
- **Persistence:** `__app_modules/personal/journalist/server/adapters/persistence/` (journal entries, message queues, quiz state)
- **Messaging & AI gateways:** `__backend/src/1_adapters/messaging/`, `__backend/src/1_adapters/ai/`
- **HTTP surface:** `__app_modules/personal/journalist/server/api/journalist.mjs` and its adjacent handlers


## Optional knowledge follow-ups

Journalist consumes Lifelog through injected `IFollowUpSource` and
`IKnowledgeCompanion` ports. The implementation is optional and remains off until
runtime commissioning. Missing or unhealthy KB selection preserves the ordinary
debrief. A healthy KB day uses only selected deterministic questions, with a
maximum of two and no invented replacement for an empty selection. Generation
uses today's user-local `askDate` separately from yesterday's report date.

Model output places its question block inside `KB_QUESTIONS_BEGIN/END`. The
presentation seam removes that block and appends the selected templates. Extra
questions, ungrounded names or malformed blocks fall back to deterministic facts.
Question-shaped hooks are removed; KB days do not spend another model call
rewriting them. Delivery reserves tokens before sending and binds them only after
a Telegram message acknowledgement. Preparation failure sends facts only.

Every webhook carries its own immutable identity and response context. New
verified private text/voice receipts retain original Telegram IDs and reply links,
with a hash over final persisted fields. Repeated source receipts are idempotent;
conflicting duplicates fail before maintenance. Unverified historical messages
remain available for ordinary journaling and read-only preview, without becoming
trusted KB mutation evidence.

KB callbacks route before legacy quiz callbacks, even when conversational AI is
offline. Ask uses the stored debrief's knowledge selection, and existing quiz
controls apply only to the active acknowledged KB quiz. Long verified entries can
suppress immediate conversational questions and schedule a validated delayed echo
after the journal save. See [Lifelog knowledge](../lifelog/knowledge.md) for
storage, authority, maintenance and rollout constraints.


Telegram corrections bypass command/special-start interpretation, version the
verified source receipt and revoke superseded references. Missing provenance can
invalidate an old trusted receipt without making the corrected text trusted.
Debrief storage, interviews and Details reads are scoped by the requested user.
A reply to two questions counts one engagement without marking both loops answered;
old Ask controls are bound to their delivered local day and explain expiry.
