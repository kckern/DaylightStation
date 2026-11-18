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

## Quick-input intake

A recording or a typed note captured away from the chat (the phone app) enters the journal over HTTP. The routes, headers, answers, device binding, daily allowance and retry rules are the shared quick-input intake: [`__docs/reference/core/quick-input.md`](../core/quick-input.md). This section is what the Journalist does with an input.

| Route | Input | What happens |
|---|---|---|
| `POST {app_host}/api/v1/journalist/voice` | audio | Transcribed, saved as a journal entry, the transcript echoed to the user's Journalist conversation, then the follow-up question sent there |
| `POST {app_host}/api/v1/journalist/memo` | audio | The same intake as `/voice`, under the names it was built with |
| `POST {app_host}/api/v1/journalist/text` | `text/plain` | Saved as a journal entry, then the follow-up question sent. No echo, as a Telegram text message gets none |

The replies go to the user's Journalist conversation in Telegram; the HTTP answer only says what happened to the input.

### Where an input joins the Telegram path

A Telegram message reaches a use case through the Journalist's input router, which first looks for slash commands and open flows (a debrief interview, a quiz). A quick input is always a new entry, so it joins at the use cases:

- **Voice** uses `ProcessVoiceEntry`'s steps: `transcribe` (the audio is handed over as `{ buffer, mimeType }`, which the Telegram adapter's `transcribeVoice` takes in place of a file id), `sendTranscription`, `sendNotUnderstood`.
- **Voice and text** use `ProcessTextEntry.saveUserMessage` to save the entry and `ProcessTextEntry.execute` with `userMessageSaved` to send the follow-up question.

The order differs from a Telegram message in one way. A quick input comes from a client that retries, so its entry is saved as soon as there is text to save, before anything is sent, and each reply is noted when it has gone out. A Telegram voice message keeps its own order (echo, then save): Telegram does not retry.

The handlers are `journalVoiceHandler` and `journalTextHandler` in `application/services/journalInputs.mjs`; `journalQuickInputs.mjs` assembles them over one ledger.

### One input, one entry

- A recording's entry is saved under the journal id `memo:<input id>`, a note's under `note:<input id>`. The journal is the record of what was taken in; the ledger (`users/<username>/apps/journalist/memo_ledger.yml`) records which replies went out.
- A retry that finds the entry does not transcribe again. It sends only the replies not yet noted, from the saved entry's text, and answers `duplicate: true`. An outage of the chat costs one transcription however many times the client retries, and the follow-up question is not lost.
- A recording found empty gets the "couldn't understand" message in the chat once, and its retry answers `422 empty_transcription` without another transcription.
- An entry that is in the journal with no ledger record (records are dropped after 35 days) is treated as finished.
- `/voice` and `/memo` are one intake: an id sent to one is a duplicate on the other. A note and a recording with the same id are two inputs.
- If a multi-part transcript echo failed part way, the retry sends all of its parts again.

### When the entry is dated

An input captured offline and uploaded later is journaled at the time it was captured: a believed `X-Daylight-Recorded-At` becomes the stored entry's timestamp, so the entry sorts and is found by date where it belongs. The Journalist's replies are stamped when they are sent.

The entry time is an optional input to `ProcessVoiceEntry`, `ProcessTextEntry` and the journal repository's `saveMessage`. A Telegram message passes none and is stamped when it is processed, as before.

### The `/memo` alias

`/memo` answers and logs with the names it had before the routes were generalized, and is otherwise `/voice`:

| | `/voice` | `/memo` |
|---|---|---|
| Id in answers | `inputId` and `memoId` | `memoId` |
| Bad id | `400 invalid_input_id` | `400 invalid_memo_id` |
| Daily limit of inputs in the 429 body | `limit: "inputs"` | `limit: "memos"` |
| Log events | `quick_input.*` with `bot`, `kind`, `inputId` | `journalist.memo.*` with `memoId` |

Both accept `X-Daylight-Input-Id` and `X-Daylight-Memo-Id`.

### Config

Device binding, on the device's entry in the household devices file:

```yaml
devices:
  <device key>:
    quick_input:
      journalist: [<username>, ...]
```

`voice_memo: { users: [...] }` on the device still binds it for `/voice` and `/memo`, and for those only.

Daily allowance, in the journalist app config (defaults shown). Recordings and notes count against the same day:

```yaml
quick_input:
  daily_inputs: 60
  daily_megabytes: 200
```

`voice_memo: { daily_memos, daily_megabytes }` still counts where `quick_input` sets no value.

At the defaults one user's day is at most 60 inputs and 240 attempts: with no retries, 60 transcriptions and 120 chat requests if every input is a recording. The ceiling with retries is in the [shared page](../core/quick-input.md#daily-allowance-and-what-a-day-can-cost).

### What is logged

Neither the audio nor the words in an entry go to the log from anywhere on this path. The voice use case logs a recording as `{bytes, mimeType}` and a Telegram voice message as its file id; an AI reply that cannot be parsed is logged by its length. The text is stored in the journal and, as for every entry, in the Journalist's AI interaction file.

---

## Boundary

The domain does not:

- Talk to Telegram, the AI provider, or the YAML store directly — those are adapters, invoked from the application layer.
- Read clocks or generate timestamps on its own — all time values are passed in as arguments from the application layer, so the domain stays deterministic and testable.
- Know about user identity, authentication, or device routing — it works in terms of opaque chat IDs.
- Decide *when* to initiate a session or *whom* to send to — scheduling and dispatch live in the module's `application/` folder (use cases, container) and `__backend/src/3_applications/journalist/` (jobs).

---

## Where it lives

`__app_modules/personal/journalist/server/domain/` — entities, value objects, and pure domain services.

Adjacent layers that depend on this domain:

- **Use cases & orchestration:** `__app_modules/personal/journalist/server/application/`
- **Persistence:** `__app_modules/personal/journalist/server/adapters/persistence/` (journal entries, message queues, quiz state)
- **Messaging & AI gateways:** `__backend/src/1_adapters/messaging/`, `__backend/src/1_adapters/ai/`
- **HTTP surface:** `__app_modules/personal/journalist/server/api/journalist.mjs` and its adjacent handlers
- **Wiring:** `__app_modules/personal/journalist/server/composition/journalistApi.mjs`

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

## Optional Work companion

Journalist renders Work's bounded task and maintenance controls through a
request-local companion port. Routine entry persistence and KB source verification
stay independent. The morning generator attaches one optional offer as metadata;
the sender prepares it only after the KB count/experiment arm is known. Two KB
questions leave no Work slot. Shared-cap denial sends facts rather than adding a
replacement question. A Work invitation is excluded from the archived base
summary so a cached/control-date debrief cannot replay it.

`Review work` (`/work_review`), `Review suggestions` (`/suggestions`) and
`Link work` (`/link_work`) open user-requested flows. Typed labels approve nothing.
Opaque Work callbacks are routed before legacy handlers. The callback request's
independent KB principal is forwarded unchanged only when private review is
requested; Work never creates that principal. No new autonomous delivery job is
introduced. Preparation, transport ACK and both owners' receipts remain separate;
unknown delivery is quarantined and does not automatically resend.
