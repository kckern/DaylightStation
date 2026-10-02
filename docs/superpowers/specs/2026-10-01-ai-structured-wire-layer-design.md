# AI Structured Wire Layer — Design

**Date:** 2026-10-01
**Status:** Spec — awaiting review
**Scope:** `IAIGateway` port, a new decorator in `1_adapters/ai/`, composition wiring, one method rename

## Intent

Use cases speak plain JS objects to the AI gateway. Wire format — JSON, TOON,
provider-native JSON mode — is an infrastructure detail decided **invisibly**,
between the `IAIGateway` port and the provider adapter. No use case changes to
gain the benefit; no use case ever sees TOON.

The win is mostly on the **output** side: structured replies like the food-logging
item list repeat every key on every row. TOON writes the keys once as a table
header, roughly 2.4× fewer generated tokens on a 4-item meal (measured: ~433 →
~182 rough tokens vs compact JSON). Generated tokens are the user-visible latency
(the nutribot "🔍 Analyzing…" wait) and cost ~4× input tokens.

### Success criteria

1. `LogFoodFromText`, `LogFoodFromImage`, `ProcessRevisionInput` and
   `ReviseEntryService` are untouched by this work and keep passing their tests.
2. With the layer at `mode: full`, their eligible calls return TOON on the wire,
   the callers receive the same JSON-shaped result they receive today, and
   completion tokens and duration drop measurably (A/B in the usage ledger).
3. Parsed food items are equivalent to the JSON path within the JSON path's own
   run-to-run variance (offline A/B CLI).
4. With `mode: off` (the default), every call is byte-identical to today.

## Decisions (agreed in brainstorming)

| Decision | Choice |
|---|---|
| Where conversion lives | Inside the gateway abstraction only — a decorator between port and adapter. Never at use-case level. |
| Caller migration | None. Existing `chat()` callers benefit via conservative template inference. |
| `chatWithJson` | Renamed to format-neutral `chatStructured(messages, options)` → JS object. |
| Format selection by callers | Not exposed. No `mode: 'json'` option. `jsonMode` becomes internal. |
| Inference on `chat()` | Yes, strict: only a JSON reply template containing an array of objects. |

## 1. Placement

### `StructuredWireLayer` — `backend/src/1_adapters/ai/StructuredWireLayer.mjs`

- `extends IAIGateway`, constructed as `new StructuredWireLayer(inner, { mode, sample, logger, random })`.
- Imports only the port contract, `0_system` utilities, its sibling codec module,
  and `@toon-format/toon` (v4.1.1, MIT, zero deps). Never imports a provider
  adapter (no peer-adapter imports).
- Methods:
  - `chat(messages, options)` — inference + rewrite (§2); returns a string.
  - `chatWithImage(messages, image, options)` — same as `chat` (photo logging).
  - `chatStructured(messages, options)` — format choice (§3); returns an object.
  - `transcribe`, `embed`, `isConfigured` — pure pass-through.
  - `scoped(tags)` → `new StructuredWireLayer(inner.scoped(tags), sameConfig)`, so
    usage attribution and the layer both survive scoping.

### Codec — `backend/src/1_adapters/ai/wire/`

Pure functions, no I/O, unit-testable in isolation:

- `findJsonBlocks(text)` — balanced `{…}` / `[…]` spans that `JSON.parse`.
- `classifyBlock(text, block)` — `template` | `data` | `ignore` (§2).
- `toToonTemplate(templateObj)` — skeleton + example row from template values.
- `encodeData(value)` — TOON table for eligible data, else `null`.
- `decodeReply(text, shape)` — `{ ok: true, value }` or `{ ok: false, reason }` (amended 2026-10-01: no `droppedRows`; rows are never dropped).
- `TOON_REPLY_RULES` — the fixed format primer (§3).

### Wiring — composition only

The `ai` gateway is produced in **two** places today; both must wrap:

1. `5_composition/integrations/IntegrationLoader.mjs#loadAdapter` — the
   config-driven adapter returned by `householdAdapters.get('ai')` (consumed
   directly at e.g. `app.mjs:1231` as well as via `sharedAiGateway`). The loader
   gains an injected `decorate(capability, adapter)` hook; `app.mjs` supplies one
   that wraps capability `ai`. The loader stays ignorant of the layer.
2. `app.mjs:720` fallback `new OpenAIAdapter(...)` and `app.mjs:6565`
   `new AnthropicAdapter(...)` — wrapped at construction.

`JevAdapter` (`IDecisionGateway`) is a different port and is out of scope.
`TelegramVoiceTranscriptionService` holds the adapter for `transcribe` only —
pass-through, unaffected.

Config: `wire: { mode: off | input | full, sample: 0..1 }` under the household
AI integration config. Absent → `off`. `input` = re-encode input data only;
`full` = input + reply-format rewrite on a `sample` fraction of eligible calls.

## 2. What gets rewritten

Per message `content` (string only; non-string content passes through):

| Content | Classified as | Action |
|---|---|---|
| JSON block preceded (same line, or the line directly above) by an imperative reply cue — a verb (`respond`/`reply`/`return`/`answer`/`output`) starting the line, a sentence or a bullet, then `in`/`with`/`as` … `JSON` or `JSON` directly, or `respond`/`reply exactly as` (case-insensitive; amended 2026-10-01: noun uses like "the previous reply as JSON:" are not cues) | **template** | If it contains an array of objects (tabular-eligible) → rewrite to TOON reply skeleton. Otherwise (single flat object, e.g. `ReviseEntryService`) → leave. |
| Any other JSON block | **data** | If an array of ≥ 2 objects with a uniform primitive-valued key set (TOON tabular-eligible) → replace in place with TOON. Otherwise leave (single objects, inline values like `Current food: {…}`). |
| Anything ambiguous | — | Leave the whole call untouched (`ai.wire.skip`). |

Ambiguous = more than one template candidate in the call, a template whose array
rows contain nested arrays/objects, or a block that parses but can't be
round-tripped by the codec.

### Reply template rewrite

- The JSON block is replaced by a TOON skeleton generated from it. Top-level
  scalars become `key: example` lines; the array becomes a tab-delimited table
  header `items[N\t]{name\ticon\t…\tdish}:` with **one example row** built from
  the template's example values, so enum hints (`"g|ml"`, `"green|yellow|orange"`)
  survive.
- Tab delimiter, so commas in food names never split a row.
- Optional fields (e.g. `dish`) stay as columns; an **empty cell decodes to an
  absent key**, preserving callers' `item.dish ? …` checks.
- Format-only sentences are stripped via a fixed, tested list (e.g. `Begin
  response with '{'`, `output only valid JSON`, `no markdown`). Field-meaning
  notes (`("dish" is OPTIONAL …)`) stay — they still describe the columns.
- `TOON_REPLY_RULES` (§3) is appended once, after the skeleton.

### Reply decode (for a call whose template was rewritten)

(Amended 2026-10-01 after the final review: rows are never dropped.)

1. Reply parses as TOON (`@toon-format/toon`, strict, else lax) → value.
   - Rows other than the last are **kept** even when short of columns
     (models omit the trailing tab of an empty last cell); missing cells are
     absent keys, the same as empty cells.
   - A short **last** row in a lax decode is a decode failure (`truncated`).
   - The raw table row lines (indented lines after the `name[N…]{…}:` header)
     must equal both the declared `[N]` and the decoded row count, else the
     decode fails (`row-count-mismatch`). This catches lines the decoder
     silently eats: a `#`-leading row (a comment to it) and an unquoted row
     whose first cell holds a colon (read as a key).
   - Extra cells (`extra-cells`) and a mid-cell `"` (`stray-quote`) fail too.
   - `chat()` / `chatWithImage()` return `JSON.stringify(value)` — callers'
     existing regex + `JSON.parse` receive the same shape they get today.
   - `chatStructured()` returns `value`.
2. Reply is JSON, or TOON decode fails → warn (`ai.wire.decode.fallback`) and
   fall back. A JSON reply is returned raw by `chat()` / `chatWithImage()` and
   parsed by `chatStructured()`. Any other failure is re-asked **once** with the
   original messages, tagged `wire: json`: `chat()` / `chatWithImage()` through
   the same inner method with the caller's original options (`jsonMode` as the
   caller passed it, the image kept), `chatStructured()` through
   `inner.chatStructured(originalMessages)`. The worst case is today's
   behaviour plus one call.

## 3. Provider JSON mode and the TOON primer

- **The TOON path never sends `jsonMode`.** OpenAI `response_format: json_object`
  forces JSON and would make TOON impossible. When the layer picks TOON for
  `chatStructured`, it calls `inner.chat()` without `jsonMode`, bypassing the
  adapter's native-JSON path.
- **The JSON path delegates unchanged** to `inner.chatStructured()`; OpenAI
  native JSON mode keeps working there. Format sentences are never stripped on
  this path, so OpenAI's "messages must mention JSON" requirement always holds.
- `chatStructured` picks TOON only when a tabular-eligible template is detected
  and the call is in the `sample`; otherwise JSON.
- A caller passing `jsonMode: true` (today only `CardLadderTypedJudge.mjs:94`) is
  treated as an explicit structured request for the format decision. After the
  rename it becomes internal-only (§4).

### `TOON_REPLY_RULES` (fixed, provider-agnostic)

As shipped (amended 2026-10-01; `wire/replyFormat.mjs` is the source of truth):

```
Reply in TOON, not JSON, using exactly the layout above:
- Scalar fields are `key: value` lines.
- The table header is `name[N<TAB>]{col1<TAB>col2…}:` where N is the number of rows you write and <TAB> is a tab character.
- Then N rows, each indented two spaces, values separated by tab characters in header column order.
- Every row has a tab between every pair of columns, including before trailing empty cells.
- Leave a cell empty to omit that field.
- Wrap a value in double quotes if it contains a tab, newline, colon or double quote (escape it as \"), starts with # or -, begins or ends with a space, or is text that looks like a number or like true, false or null. Never quote a real number.
- No code fences and no text before or after.
```

The quoting line matches what the library's encoder quotes (`isSafeUnquoted`):
an unquoted `#` at a row start is a comment to the decoder, and an unquoted
colon before the first tab makes the row read as a key.

Identical bytes every call, placed after the stable prompt prefix, so provider
prompt caching of that prefix is unaffected. Input-side TOON needs no primer.

## 4. Port changes

- `IAIGateway.chatWithJson` → `chatStructured(messages, options)`; contract
  unchanged (messages in, parsed JS object out). JSDoc no longer says "JSON".
- `isAIGateway` required-method list updated.
- `ChatOptions.jsonMode` removed from the public typedef; adapters keep it as an
  internal parameter used by their own `chatStructured`.
- Renamed call sites (mechanical): `OpenAIAdapter`, `AnthropicAdapter`,
  `AiGatewayService` (`chatJson` → `chatStructured`), `AIConsoleService`,
  `4_api/v1/routers/ai.mjs`, `ProcessGratitudeInput`, `CardLadderTypedJudge`
  (also drop its `jsonMode: true`), `AdaptiveRemediationTutor`,
  `TransactionCategorizationService`, `ShoppingHarvester`, plus test doubles
  (e.g. `capabilityRoutes.characterization.test.mjs`).
- No alias for the old name; all callers are in-repo.

## 5. Observability

Backend structured logger, `module: ai-wire`:

| Event | Level | Data |
|---|---|---|
| `ai.wire.rewrite` | debug | `kind: template\|input`, `columns`, `rows`, `app`, `feature` |
| `ai.wire.skip` | debug | `reason: no-messages\|no-cue\|flat-object\|ambiguous\|not-sampled\|input-only` (none in mode off: nothing is planned) |
| `ai.wire.decode.ok` | debug | `rows` |
| `ai.wire.decode.fallback` | warn | `reason`, `sample` (first 200 chars), `app`, `feature` |

Usage ledger: the layer adds `wire: toon | json | passthrough` to the call's
`usageTags`; `usageAttribution` copies it onto the ledger row beside
`app`/`feature`. Existing `completionTokens` + `durationMs` then give the A/B
comparison per feature with no new storage.

## 6. Testing

Vitest (`npm run test:unit:vitest`):

- **Codec** — fixtures are the four real food-logging prompts:
  - `LogFoodFromText`, `LogFoodFromImage`, `ProcessRevisionInput` templates rewritten; `ReviseEntryService` left alone.
  - `ProcessRevisionInput` `currentJson` re-encoded as input data.
  - Format-sentence stripping list.
  - Decode: tab rows, empty cell → absent key, truncated → partial row dropped, JSON reply passthrough, garbage passthrough, value containing a comma.
- **Layer** — TOON path never sends `jsonMode`; JSON path delegates to
  `inner.chatStructured`; `scoped()` preserves tags and the layer; `transcribe`
  / `embed` pass through; `mode: off` byte-identical messages; `sample` honoured
  with an injected `random`.
- **End-to-end** — `LogFoodFromText` over the layer with a fake inner gateway
  returning TOON yields the same parsed items as the fake returning equivalent
  JSON.
- **Wiring** — extend `5_composition/aiGatewayScoping.wiring.test.mjs` (or a
  sibling) to assert the `ai` gateway from both construction paths is a
  `StructuredWireLayer`.

### Offline A/B — `cli/ai-wire-ab.cli.mjs`

Replays ~30 real `sourceText` food descriptions through `LogFoodFromText`'s
prompt on both paths, K runs each. Reports per path: item count, food-name
overlap, grams / kcal distributions vs the JSON path's own run-to-run spread,
decode-fallback count, completion tokens, wall time. This gates step 2 of
rollout.

## 7. Rollout

1. Ship rename + layer with config absent (`off`). Zero behaviour change.
2. Run the offline A/B. If it passes, set `mode: full, sample: 0.5`.
3. After ~1 week of ledger data: `sample: 1` if fallback rate and quality hold;
   else back to `input` / `off`. Config only.
4. Docs: AI section of `docs/reference/core/configuration.md` (wire config +
   ledger `wire` field); new `docs/reference/core/ai-structured-wire-layer.md`
   describing classification rules and the fallback guarantee.

## Sequencing note

A separate change is in flight fixing unattributed AI usage (scoped gateway
wiring in `app.mjs`). This work touches the same composition code; implement
after that merges to avoid conflicts.

## Out of scope

- Migrating prose-JSON `chat()` callers to `chatStructured` (possible later
  cleanup; not required for the benefit).
- JSON-Schema-enforced structured outputs.
- Agent (Mastra) tool-result serialization — not routed through `IAIGateway`.
- `IDecisionGateway` / `JevAdapter`.
