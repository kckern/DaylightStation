# Quick-input intake

A quick input is something captured away from a bot's chat and uploaded to it: a recording, a typed note, a photo. The phone app sends them. Each bot that takes quick inputs has one route per kind, and every such route is the same middleware chain and the same intake, so they answer alike. Telegram stays a full interface to each bot; these routes are an additional way in, and each bot replies in the user's Telegram conversation as it does for a Telegram message of that kind.

| Route | Body | What the bot does |
|---|---|---|
| `POST /api/v1/journalist/voice` | audio | A spoken journal entry. `/api/v1/journalist/memo` is the same intake under its earlier names |
| `POST /api/v1/journalist/text` | text | A typed journal entry |
| `POST /api/v1/nutribot/voice` | audio | A spoken meal description |
| `POST /api/v1/nutribot/text` | text | A typed meal description |
| `POST /api/v1/nutribot/photo` | image | A meal photo |

What each bot does with an input is in its own reference: [Journalist](../journalist/journalist-domain.md#quick-input-intake), [Nutribot](../nutrition/README.md#quick-input-intake).

## Request

```
POST {app_host}<route>?user=<username>
Content-Type: <see kinds>
X-Daylight-Device: fleet:<device key>
X-Daylight-Input-Id: <id>            (X-Daylight-Memo-Id is accepted as an alias)
X-Daylight-Recorded-At: <epoch ms>   (optional)

<raw body>
```

| Part | Rule |
|---|---|
| `user` | Required. A household username that has a conversation with the bot. There is no fallback to another user. |
| `X-Daylight-Device` | Required. `fleet:<key>` (`^fleet:[A-Za-z0-9._-]{1,96}$`), where `<key>` is a device in the household devices file that is bound to `user` for this route's bot. |
| `X-Daylight-Input-Id` | Required. `^[A-Za-z0-9_-]{1,64}$`. The client's id for the input; the same id from the same user on the same route is one input. |
| `X-Daylight-Recorded-At` | Optional. Epoch milliseconds when the input was captured. Believed when it is no more than 5 minutes ahead of the backend clock and no more than 30 days old; otherwise ignored, with `recordedAtIgnored` logged (`not_a_time`, `in_the_future`, `too_old`). |
| `Origin` | Absent (a native client sends none), or its host equals the request's `Host`. |

| Kind | Content-Type (case-insensitive, parameters ignored) | Size limit |
|---|---|---|
| voice | `audio/mp4`, `audio/m4a`, `audio/mpeg`, `audio/mp3`, `audio/ogg`, `audio/webm`, `audio/wav`, `audio/x-wav` | 26,214,400 bytes |
| text | `text/plain` (UTF-8) | 16,384 bytes; must contain a non-whitespace character |
| photo | `image/jpeg`, `image/png`, `image/webp` | 15,728,640 bytes |

The request is answered when the bot has finished with the input. A long recording takes as long as its transcription, so a client needs a generous read timeout.

## Answers

| Status | Body | When |
|---|---|---|
| 200 | `{ok: true, inputId, duplicate: false, ...}` | Processed. A bot may add fields (the Journalist voice route adds `transcriptionLength`) |
| 200 | `{ok: true, inputId, duplicate: true}` | This id was already processed for this user and route; any reply an earlier attempt did not send has now gone |
| 400 | `{ok: false, error: "user_required" \| "invalid_input_id" \| "empty_body" \| "unreadable_body", message}` | No `user`; id missing or malformed; no bytes, or text with nothing in it; a body that could not be read, or text that is not UTF-8 |
| 403 | `{ok: false, error: "cross_origin", message}` | `Origin` present and not this app's own. Also the answer to every `OPTIONS` on these routes |
| 403 | `{ok: false, error: "device_not_allowed", message}` | Device header missing, not a registered device, or not bound to `user` for this route's bot |
| 404 | `{ok: false, error: "unknown_user", message}` | Bound device, but the user has no conversation with this bot |
| 413 | `{ok: false, error: "too_large", message, maxBytes}` | Over the kind's limit |
| 415 | `{ok: false, error: "unsupported_media_type", message}` | Content type not in the kind's list |
| 422 | `{ok: false, error: "empty_transcription" \| "unusable_input", inputId}` | Nothing usable in the input: no intelligible speech; an image that is not the type it says, or that the bot could not find anything in; text the bot could not use. A retry answers 422 again without redoing the work |
| 429 | `{ok: false, error: "daily_limit", message, limit, retryAfterSeconds}` plus `Retry-After: <seconds>` | The user's daily allowance for this bot is used up. `limit` is `"inputs"` or `"bytes"`; `retryAfterSeconds` is the time to the user's local midnight |
| 500 | `{ok: false, error: "processing_failed", inputId}` | The bot's processing or a reply threw. May be retried |
| 503 | `{ok: false, error: "unavailable", message}` | A service the bot needs is not configured on this backend |

`/api/v1/nutribot/text` is the one path that also answers an earlier shape of request: there a `POST` with a JSON or form body goes to that earlier route and its guard, not to `415` ([Nutribot direct-input routes](../nutrition/README.md#direct-input-routes)).

The two Journalist voice routes also carry the id as `memoId`. The `/memo` alias keeps the names it was built with and differs from the table in these ways only: its answers carry `memoId` and no `inputId`, a bad id is `invalid_memo_id`, and the daily limit of inputs is named `"memos"`.

Refusals are decided in this order, all before the body is read: `cross_origin`, `unavailable`, `user_required`, `device_not_allowed`, `unknown_user`, `invalid_input_id`, `unsupported_media_type`, `too_large` (from the declared length), `daily_limit`. Then the body is read (`too_large` again for an upload with no declared length, `unreadable_body`), then `empty_body`, then for a photo the check that the bytes begin as the declared image type does. Nothing is said about a user to a device that may not send for them.

No response from these routes carries an `Access-Control-Allow-*` header. The app-wide CORS handler and body parsers are kept off their paths (`exceptPaths` in `app.mjs`), which is what lets the refusals come before any body is read; a JSON-typed body is refused without being parsed.

## Who may send

An input writes for one person, replies into their chat and spends model money, so the caller must be a household device that has been bound to that person for that bot. The binding is on the device's entry in the household devices file (`hardware/devices.yml`):

```yaml
devices:
  <device key>:
    # ...the device's other settings
    quick_input:
      journalist: [<username>, ...]
      nutribot: [<username>, ...]
```

`voice_memo: { users: [...] }`, the shape the Journalist voice intake started with, still binds a device for Journalist voice (`/voice` and `/memo`) and for nothing else.

The header is an identity the device states and no secret it proves. It stops a device or a web page that was never given this role; it does not stop a caller on the household network that copies a bound device's key. These routes are reachable only from the household network and VPN, like the rest of the API. A per-device secret is a possible later addition.

## Daily allowance and what a day can cost

Per user, per bot, per local day (midnight in the user's household timezone). Set in each bot's app config; these are the defaults:

```yaml
quick_input:
  daily_inputs: 60
  daily_megabytes: 200
```

The Journalist's earlier keys, `voice_memo: { daily_memos, daily_megabytes }`, still count when `quick_input` does not set a value.

Three things are counted, in the bot's quick-input ledger on disk, so a restart does not reset them:

- **Inputs.** Distinct inputs sent to the bot for processing, of every kind together. An input counts once however many times it is retried.
- **Bytes.** Counted every time an input is sent for processing, so an input that keeps failing still runs into the byte limit.
- **Attempts.** Every request that does any work: processing an input, or finishing the replies of one already stored. Four attempts are allowed for each input in the allowance (240 at the default). This is what bounds retries of small inputs, which the byte limit does not.

An answer that does no work (a duplicate, a repeated 422) is never held to the allowance. The check runs before the body is read, from the declared `Content-Length`, and again against the real size before the bot sees the input. Two uploads for one user that pass the check at the same moment are both let through, so a day can end slightly over.

At the defaults, the most one user's day can ask of the paid model APIs through these routes, per bot, is 240 attempts. In model requests:

| Bot | Kind | Per processing attempt | Per attempt to finish replies | A full day, no retries (60 inputs) |
|---|---|---|---|---|
| Journalist | voice | 1 transcription | 2 chat (the follow-up question and its answer choices) | 60 transcriptions, 120 chat |
| Journalist | text | none | 2 chat | 120 chat |
| Nutribot | voice | 1 transcription, 1 chat (food detection) | none | 60 transcriptions, 60 chat |
| Nutribot | text | 1 chat | none | 60 chat |
| Nutribot | photo | 1 vision | none | 60 vision |

The ceiling for a day made entirely of failing retries is 240 of the per-attempt figure: for the Journalist 240 transcriptions or 480 chat requests, for Nutribot 240 transcriptions and 240 chat, or 240 vision requests. One transcription here is one call to the transcriber, which itself retries a dropped connection up to five times. A meal Nutribot commits can also set off the post-meal coaching it sets off for a Telegram message; that is one message per meal, counted by that feature and not here.

## Once, and finished

An input id is processed once per user per route.

- The bot's ledger (`users/<username>/apps/<bot>/…`, one document per user per bot) records how far each input got: started, stored, which replies went out, or that nothing usable was in it.
- A retry of a finished input answers `duplicate: true` and does nothing. This holds across a restart.
- A retry of an input that was stored but whose replies did not all go out sends only the missing ones and answers `duplicate: true`.
- A retry of an input that failed before it was stored is processed again.
- An input with nothing usable in it is noted, and its retry answers 422 without asking a model again.
- Two uploads of one input that overlap share one run.
- Ledger records are dropped after 35 days.

The phone clears a queued capture after an HTTP 200 receipt with JSON `ok: true`, a boolean `duplicate`, and a string `inputId` equal to the submitted ID. On `/api/v1/journalist/memo` it also accepts a matching `memoId` when `inputId` is absent. Both first-time and duplicate receipts use this check, including after offline queue recovery. The receipt must be one complete JSON object with unique member names.

An unexpected receipt leaves the original bytes queued and retries with backoff without counting toward the parking limit. A permanent intake rejection parks the capture with its bytes intact when the status and JSON error match the documented refusal and `ok` is boolean false. The backend does not store the uploaded bytes for retry.

## Privacy and the log

Nothing that was said, typed or photographed goes to any log event or error message from these routes or the intake: ids, byte counts, lengths, durations, states and error codes only. Each bot's reference says what its own use cases log.

Events (`bot` and `kind` on each): `quick_input.received`, `.accepted`, `.duplicate` (`resumed: true` when replies were finished), `.rejected` (`reason`, `status`), `.failed`, `.recordedAtIgnored`, `.apologyFailed`, `.identityResolutionFailed`, `.deviceLookupFailed`, `.ledger.writeFailed`. The `/memo` alias and the Journalist voice intake behind it log the same events as `journalist.memo.*` with a `memoId`.

## Adding an intake to a bot

The shared code is the `quick-input` capability (`__capabilities/quick-input/server/`):

| Piece | What it is |
|---|---|
| `api.mjs` → `quickInputRoute(endpoint, { kind, logger, naming })`, `quickInputPreflight` | The route: gate, body reader, submit. One per kind per bot |
| `public.mjs` → `QuickInputIntake` | Once-only processing, retries, allowance, recorded time. Takes the bot's kind handler |
| `public.mjs` → `QuickInputLedger`, `quickInputLimits` | The per-user record and the daily allowance |
| `public.mjs` → `QuickInputEndpoint`, `boundUsers` | What a route asks of a bot: availability, device binding, the user's conversation, admission, submit |
| `adapters/index.mjs` → `YamlQuickInputLedgerStore` | The ledger as a YAML document in the user's folder for the bot |

A bot supplies a **kind handler**:

- `process(input)` takes the input in and stores it. It returns `{ state?, summary? }`, or `{ nothing: 'empty_transcription' | 'unusable_input', notify? }`, or `{ unavailable: true }`; throwing means the attempt failed and may be retried.
- `lookup(input)` (optional) says whether the bot's own store already holds the input. With it, the bot's store is the record of what was taken in and the ledger only records replies.
- `replies` (optional) is the ordered list of what is sent afterwards, each noted when it has gone.

`input` is `{ conversationId, username, inputId, body, mimeType, capturedAt }`, where `capturedAt` is a `Date` when the client's recorded time was believed and `null` otherwise.

A new route's path also goes in the `exceptPaths` list in `app.mjs`; `memoRouteGuards.wiring.test.mjs` holds the list of record.
