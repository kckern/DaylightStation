# OpenAI Chat Completions wire-format baseline

These two files capture the byte-exact response shape that
`OpenAIChatCompletionsTranslator` (the pre-Phase-3 implementation) produced for
a known fixture. They serve as golden masters for the Phase 3
`wireFormats/openaiChatCompletions.mjs` module.

**Recapture:** un-skip the two tests in `capture.test.mjs` and re-run. They
write the files automatically, with `id` and `created` redacted as
`{UUID}` / `{TS}` (non-deterministic).

**Fixture:** see `capture.test.mjs` — a fake runner that yields:
1. text-delta "Hello"
2. tool-start remember_note (suppressed — not emitted to client, per Spec §7.2)
3. tool-end remember_note (suppressed)
4. text-delta " from"
5. text-delta " the kitchen."
6. finish stop

**SSE chunks produced (6 `res.write` calls):**
| # | Content |
|---|---------|
| 1 | role-init chunk — `delta: { role: "assistant" }` |
| 2 | text-delta "Hello" |
| 3 | text-delta " from" |
| 4 | text-delta " the kitchen." |
| 5 | finish chunk — `delta: {}, finish_reason: "stop"` |
| 6 | `data: [DONE]` |

**Why tool events are absent:** The translator intentionally suppresses
`tool-start` / `tool-end` events from the SSE stream (wire clients only see
text deltas and the finish chunk). This matches the OpenAI streaming spec and
keeps HA Voice satellite parsing simple.

**Why this matters:** HA Voice satellites parse this stream with their own
OpenAI-compatible SSE consumer. Any deviation — extra fields, removed fields,
different framing — is a production-breaking change.
