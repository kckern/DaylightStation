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

A voice memo recorded away from the chat (the phone app) enters the journal over HTTP and then takes the steps a Telegram voice message takes: `SubmitVoiceMemo` has `ProcessVoiceEntry` transcribe the audio bytes and echo the transcript to the user's Journalist conversation, and `ProcessTextEntry` save the entry and send the follow-up question. The replies go to that conversation in Telegram; the HTTP answer only says what happened to the memo.

```
POST {app_host}/api/v1/journalist/memo?user=<username>
Content-Type: audio/mp4
X-Daylight-Device: fleet:<device key>
X-Daylight-Memo-Id: <id>
X-Daylight-Recorded-At: <epoch ms>     (optional)

<raw audio bytes>
```

| Part | Rule |
|------|------|
| `user` | Required. A household username that has a Journalist conversation. There is no fallback to another user: a memo is personal. |
| `X-Daylight-Device` | Required. `fleet:<key>`, where `<key>` is a device in the household devices file whose `voice_memo.users` lists `user` (see "Who may send"). |
| `Content-Type` | One of `audio/mp4`, `audio/m4a`, `audio/mpeg`, `audio/mp3`, `audio/ogg`, `audio/webm`, `audio/wav`, `audio/x-wav`. Parameters after `;` are ignored. |
| `X-Daylight-Memo-Id` | Required. 1 to 64 characters of `A-Z a-z 0-9 _ -`. The client's id for the recording; the same id from the same user is one memo. |
| `X-Daylight-Recorded-At` | Optional. Epoch milliseconds when the recording started (see "When the entry is dated"). |
| `Origin` | Must be absent (a native client sends none) or this app's own origin. |
| Body | The audio, not empty, at most 25 MB (the transcriber's upload ceiling). |

The request is answered when processing has finished, as the Telegram webhook is. A long recording takes as long as its transcription, so the client needs a generous read timeout.

### Answers

| Answer | Body | Meaning | A client should |
|--------|------|---------|-----------------|
| `200` | `{ok: true, memoId, duplicate: false, transcriptionLength}` | Transcribed, journaled and answered in the chat | Drop the recording |
| `200` | `{ok: true, memoId, duplicate: true}` | This memo is already in the journal (any reply an earlier attempt did not send has now gone) | Drop the recording |
| `400` | `{ok: false, error: "user_required", message}` | No `user` | Fix its config; not retry as is |
| `400` | `{ok: false, error: "invalid_memo_id", message}` | Memo id missing or malformed | Not retry |
| `400` | `{ok: false, error: "empty_body", message}` | No audio bytes | Not retry |
| `400` | `{ok: false, error: "unreadable_body", message}` | The body could not be read | Not retry |
| `403` | `{ok: false, error: "cross_origin", message}` | The request, or its preflight, came from another web origin | Not applicable to a native client |
| `403` | `{ok: false, error: "device_not_allowed", message}` | `X-Daylight-Device` is missing, is not a registered device, or the device is not bound to `user` | Keep the recording; it will go once the device is bound |
| `404` | `{ok: false, error: "unknown_user", message}` | The user has no Journalist conversation | Keep the recording until the user is set up |
| `413` | `{ok: false, error: "too_large", message, maxBytes}` | Over the size limit | Not retry |
| `415` | `{ok: false, error: "unsupported_media_type", message}` | Not one of the audio types above | Not retry |
| `422` | `{ok: false, error: "empty_transcription", memoId}` | Nothing intelligible in the audio | Not retry |
| `429` | `{ok: false, error: "daily_limit", message, limit, retryAfterSeconds}` plus a `Retry-After: <seconds>` header | The user's daily allowance is used up. `limit` is `"memos"` or `"bytes"`; `retryAfterSeconds` is the time to the user's local midnight | Keep the recording and send it again after `retryAfterSeconds` |
| `500` | `{ok: false, error: "processing_failed", memoId}` | Transcription, the journal or a reply failed | Retry with backoff |
| `503` | `{ok: false, error: "unavailable", message}` | No AI gateway, journal or memo ledger on this backend | Retry with backoff |

Refusals are decided in this order, all of them before the body is read: `cross_origin`, `unavailable`, `user_required`, `device_not_allowed`, `unknown_user`, `invalid_memo_id`, `unsupported_media_type`, `too_large` (from the declared length), `daily_limit`. Then the body is read (`too_large` again for an upload with no declared length, `unreadable_body`), then `empty_body`. Nothing is said about a user to a device that may not write for them.

The route guards itself, so the app-wide CORS handler and body parsers are kept off its path (`exceptPaths` in `app.mjs`). No response from it carries an `Access-Control-Allow-*` header, and a JSON-typed body is refused without being parsed.

### Who may send

A memo writes to one person's journal, echoes into their chat and spends transcription money, so the caller must be a household device that has been bound to that person. The binding is on the device's entry in the household devices file (`hardware/devices.yml`):

```yaml
devices:
  <device key>:
    # ...the device's other settings
    voice_memo:
      users: [<username>, ...]
```

The client sends `X-Daylight-Device: fleet:<device key>`. A device with no `voice_memo.users`, a key that is not in the file, a `browser:` id or a missing header is refused with `403 device_not_allowed`, as is a bound device asking for a user it does not list.

The header is an identity the device states, not a secret it proves. It stops a device or a web page that was never given this role from writing to a journal by naming a user; it does not stop a caller on the household network that copies a bound device's key. The route is reachable only from the household network and VPN, like the rest of the API.

### Daily allowance

Each user may send 60 memos and 200 MB of audio for transcription per local day. Both are set in the journalist app config:

```yaml
voice_memo:
  daily_memos: 60
  daily_megabytes: 200
```

- A memo counts once per day however many times it is retried. Bytes are counted every time audio is sent to the transcriber, so a memo that keeps failing there still runs into the byte limit.
- A retry that will not transcribe (the entry is already journaled, or the memo was found empty) is never held to the allowance.
- The check runs before the body is read, from the declared `Content-Length`, and again against the real size before transcription.
- The day ends at midnight in the user's household timezone. The count is kept in the memo ledger on disk, so a restart does not reset it.
- The limit is on bytes, not minutes: the length of a recording is not known until it has been transcribed. 200 MB is roughly seven hours of the phone's AAC recording.
- Two uploads for one user that pass the check at the same moment are both let through, so the day can end slightly over.

### When the entry is dated

A memo recorded offline and uploaded later is journaled at the time it was recorded: `X-Daylight-Recorded-At` becomes the stored entry's timestamp, so the entry sorts and is found by date where it belongs. The header is believed when it is a number of epoch milliseconds no more than 5 minutes ahead of the backend's clock and no more than 30 days old. Otherwise it is ignored, the entry is stamped when it is processed, and `journalist.memo.recordedAtIgnored` is logged with the reason (`not_a_time`, `in_the_future`, `too_old`). The Journalist's replies are stamped when they are sent.

The entry time is an optional input to `ProcessVoiceEntry`, `ProcessTextEntry` and the journal repository's `saveMessage`. A Telegram message passes none and is stamped when it is processed, as before.

### One memo, one entry, one transcription

The memo's journal entry is saved under the id `memo:<memo id>`, and a per-user memo ledger (`users/<username>/apps/journalist/memo_ledger.yml`) records how far each memo got.

- The entry is saved as soon as the transcript exists, before anything is sent to the chat. A Telegram voice message keeps its own order (echo, then save): Telegram does not retry, so it has no need of this.
- The ledger notes each reply (the transcript echo, the follow-up question) when it has gone out.
- A retry that finds the entry does not transcribe again. It sends only the replies not yet noted, from the saved entry's text, and answers `duplicate: true`. So an outage of the chat costs one transcription however many times the client retries, and the follow-up question is not lost.
- A retry of a finished memo answers `duplicate: true` and does nothing else. This holds across a backend restart.
- A memo found empty is noted too, and its retry answers `422` without another transcription.
- Two uploads of one memo that overlap share one run.
- Ledger records are dropped after 35 days. An entry that is in the journal with no ledger record is treated as finished.

A `500` means the memo may be retried. If a multi-part echo failed part way, the retry sends all of its parts again. The backend does not keep the audio: a client must hold the recording until it has a `200`.

### Log events

Module `journalist-api`: `journalist.memo.received`, `.accepted`, `.duplicate` (`resumed: true` when replies were finished), `.rejected` (with `reason` and `status`), `.failed`, `.recordedAtIgnored`, `.apologyFailed`, `.identityResolutionFailed`, `.deviceLookupFailed`, `.ledger.writeFailed`. They carry the memo id, username, device id, byte count, transcript length and duration.

Neither the audio nor the words in it go to the log from anywhere on the voice path. The voice use case logs a memo's audio as `{bytes, mimeType}` and a Telegram voice message as its file id; an AI reply that cannot be parsed is logged by its length. The transcript is stored in the journal and, as for every entry, in the Journalist's AI interaction file.

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
