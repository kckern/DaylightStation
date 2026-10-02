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
- `decodeReply(text)` — `{ ok, value, droppedRows }` or `{ ok: false, reason }`.
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
| JSON block preceded (within the same paragraph) by a reply cue — `respond … JSON`, `return JSON`, `respond exactly as` (case-insensitive) | **template** | If it contains an array of objects (tabular-eligible) → rewrite to TOON reply skeleton. Otherwise (single flat object, e.g. `ReviseEntryService`) → leave. |
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

1. Reply parses as TOON (`@toon-format/toon`, strict) → value.
   - Truncation: if rows < declared `[N]`, drop the partial last row, keep the
     complete ones, log `droppedRows`.
   - `chat()` / `chatWithImage()` return `JSON.stringify(value)` — callers'
     existing regex + `JSON.parse` receive the same shape they get today.
   - `chatStructured()` returns `value`.
2. Reply is JSON, or TOON decode fails → warn (`ai.wire.decode.fallback`) and
   fall back. `chat()` / `chatWithImage()` return the raw reply unchanged, so
   callers' existing repair logic still applies. `chatStructured()` must return an
   object: a JSON reply is parsed and returned; anything else is re-asked once
   through `inner.chatStructured(originalMessages)`. The worst case is today's
   behaviour (plus one call for `chatStructured`).

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

### `TOON_REPLY_RULES` (fixed, provider-agnostic, ~80 tokens)

```
Reply in TOON, not JSON:
- Scalar fields as `key: value` lines.
- A table: `items[N\t]{f1\tf2…}:` then N rows, each row 2-space-indented, values tab-separated in column order.
- N must equal the row count.
- Leave a cell empty to omit that field.
- Quote a value only if it contains a tab or newline, or has leading/trailing space.
- No code fences, no prose before or after.
```

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
| `ai.wire.skip` | debug | `reason: no-cue\|flat-object\|ambiguous\|mode-off\|not-sampled` |
| `ai.wire.decode.ok` | debug | `rows`, `droppedRows` |
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
