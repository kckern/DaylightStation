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

## Voice memo intake

A voice memo recorded away from the chat (the phone app) enters the journal over HTTP and then takes the same path as a Telegram voice message: `SubmitVoiceMemo` hands the audio bytes to `ProcessVoiceEntry`, which transcribes them, echoes the transcript to the user's Journalist conversation, saves the entry and sends the follow-up question. The reply goes to that conversation in Telegram; the HTTP answer only says what happened to the memo.

```
POST {app_host}/api/v1/journalist/memo?user=<username>
Content-Type: audio/mp4
X-Daylight-Memo-Id: <id>
X-Daylight-Recorded-At: <epoch ms>     (optional)

<raw audio bytes>
```

| Part | Rule |
|------|------|
| `user` | Required. A household username that has a Journalist conversation. There is no fallback to another user: a memo is personal. |
| `Content-Type` | One of `audio/mp4`, `audio/m4a`, `audio/mpeg`, `audio/mp3`, `audio/ogg`, `audio/webm`, `audio/wav`, `audio/x-wav`. Parameters after `;` are ignored. |
| `X-Daylight-Memo-Id` | Required. 1 to 64 characters of `A-Z a-z 0-9 _ -`. The client's id for the recording; the same id from the same user is one memo. |
| `X-Daylight-Recorded-At` | Optional. Logged only. The journal entry is stamped with the time the memo was processed, as every entry is. |
| Body | The audio, not empty, at most 25 MB (the transcriber's upload ceiling). |

The request is answered when processing has finished, as the Telegram webhook is. A long recording takes as long as its transcription, so the client needs a generous read timeout.

| Answer | Body | Meaning | A client should |
|--------|------|---------|-----------------|
| `200` | `{ok: true, memoId, duplicate: false, transcriptionLength}` | Transcribed and journaled | Drop the recording |
| `200` | `{ok: true, memoId, duplicate: true}` | This memo is already in the journal | Drop the recording |
| `400` | `{ok: false, error: "user_required", message}` | No `user` | Fix its config; not retry as is |
| `400` | `{ok: false, error: "invalid_memo_id", message}` | Memo id missing or malformed | Not retry |
| `400` | `{ok: false, error: "empty_body", message}` | No audio bytes | Not retry |
| `400` | `{ok: false, error: "unreadable_body", message}` | The body could not be read | Not retry |
| `404` | `{ok: false, error: "unknown_user", message}` | The user has no Journalist conversation | Keep the recording until the user is set up |
| `413` | `{ok: false, error: "too_large", message, maxBytes}` | Over the size limit | Not retry |
| `415` | `{ok: false, error: "unsupported_media_type", message}` | Not one of the audio types above | Not retry |
| `422` | `{ok: false, error: "empty_transcription", memoId}` | Nothing intelligible in the audio | Not retry |
| `500` | `{ok: false, error: "processing_failed", memoId}` | Transcription, the journal or the reply failed | Retry with backoff |
| `503` | `{ok: false, error: "unavailable", message}` | No AI gateway or no journal on this backend | Retry with backoff |

The user, memo id, content type and declared length are checked before the body is read, so a refused request is not buffered.

**One memo, one entry.** The memo's journal entry is saved under the id `memo:<memo id>`. Before processing, the journal is asked for that id; if it is there the answer is `duplicate: true` and nothing else happens. The journal is the record, so this holds across a backend restart and for a memo whose entry was saved but whose reply then failed (the retry answers `duplicate: true`; the follow-up question for that memo is not sent again). Two uploads of one memo that overlap share one run.

**Failure after partial work.** A `500` means the memo may be retried. If the failure came after the transcript echo and before the entry was saved, the retry sends the echo to the conversation a second time. Nothing is stored outside the journal: the backend does not keep the audio, so a client must hold the recording until it has a `200`.

**Log events** (module `journalist-api`): `journalist.memo.received`, `.accepted`, `.duplicate`, `.rejected` (with `reason` and `status`), `.failed`, and `journalist.memo.identityResolutionFailed`. They carry the memo id, username, byte count, transcript length and duration. The audio and the transcript text are never logged by this route.

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
- **Persistence:** `__app_modules/personal/journalist/server/adapters/persistence/` (journal entries, message queues)
- **Messaging & AI gateways:** `__backend/src/1_adapters/messaging/`, `__backend/src/1_adapters/ai/`
- **HTTP surface:** `__app_modules/personal/journalist/server/api/journalist.mjs` and handlers under `api/handlers/`
- **Wiring:** `__app_modules/personal/journalist/server/composition/journalistApi.mjs`
