# AI Structured Wire Layer

## What it is

`StructuredWireLayer` (`backend/src/1_adapters/ai/StructuredWireLayer.mjs`) is a
decorator that sits between the `IAIGateway` port and the provider adapters. It
re-encodes tabular data in a prompt, and tabular reply templates, as
[TOON](https://github.com/toon-format/toon) on the wire, and decodes a TOON reply
back into exactly what the caller asked for. Use cases never see TOON: they pass
JSON-shaped prompts and get a JSON string (`chat`) or an object
(`chatStructured`) back. The reason is cost and latency: generated tokens are
the expensive, slow part of a call, and a table written once as a header plus
rows is much shorter than the same table as repeated JSON objects.

Every failure path falls back to what the call would have done without the
layer. In `mode: off` (the default) the call is byte-identical: nothing is
rewritten, logged or tagged.

## Where it sits

The layer wraps the three places an AI adapter is built, all in composition
(`backend/src/app.mjs`, helper `wrapAiWire`):

| Path | Wrapped by |
|------|-----------|
| Integration loader: `IntegrationLoader` calls the `decorateAdapter(capability, adapter, serviceConfig)` hook after constructing an adapter; `app.mjs` supplies a hook that wraps only `capability === 'ai'`. The adapter never receives the hook. | `decorateAdapter` |
| Fallback OpenAI adapter, built when no `ai` integration is configured | `wrapAiWire(new OpenAIAdapter(...))` |
| The Anthropic adapter behind the AI console | `wrapAiWire(new AnthropicAdapter(...))` |

Config is read once at boot from the household integrations config
(`5_composition/aiWireConfig.mjs`, `readAiWireConfig`) and logged as
`ai.wire.config`.

`scoped(tags)` returns a **new** layer around `inner.scoped(tags)` with the same
config and merged tags, so per-app views keep the layer. `transcribe`, `embed`
and `isConfigured` delegate. The layer is a Proxy: any member not on the port
(adapter getters, helpers) resolves on the adapter, so wrapping hides nothing.

## Classification rules

`planWire` (`wire/planWire.mjs`) is pure: it never mutates the caller's messages
and returns the same array when nothing changes. It finds JSON blocks in each
string `content` (`wire/jsonBlocks.mjs`), then classifies each.

A block is a **reply template** when a cue matches the regex

```
\b(?:respond|reply|return|answer|output)\b.*\b(?:json|exactly as)\b   (case-insensitive)
```

The cue must be on the **same line** as the block (the text before it) or on the
**line directly above it**. A blank line in between means no cue; a cue from an
earlier paragraph does not count.

| Class | Condition | Action |
|-------|-----------|--------|
| Reply template, table | Cued block that is an object with exactly one array of flat example rows (same key set, primitive values) and only primitive siblings | Eligible for a TOON reply: template becomes a TOON skeleton, cue says TOON, JSON-forcing sentences are stripped, a fixed rules primer is appended |
| Reply template, flat | Cued block with no array | Untouched (`flat-object`): TOON gains nothing |
| Input data | Uncued block that is a table of 2+ flat rows, or an object of primitives and 2+-row tables | Re-encoded as tab-delimited TOON in place (`input` rewrite) |
| Ambiguous | See below | The whole call passes through untouched (`ambiguous`) |

A call is **ambiguous** when:

- more than one reply template is found;
- a template has nested rows, more than one array, or an array alongside a
  nested object;
- a data block overlaps the template's cue line.

Other blocks (single objects, one-row arrays, prose-embedded JSON that is
neither) are left as they are.

## Reply decode and fallback guarantee

A TOON reply is decoded by `decodeReply` (`wire/replyFormat.mjs`) against the
template's shape:

- Code fences are removed, and the ends are trimmed **without removing tabs**,
  because a trailing tab delimits an empty last cell.
- A reply starting with `{` or `[` is a JSON reply (`json-reply`).
- Parse is strict first; on failure it re-parses non-strict and treats the
  reply as truncated. Keys outside the template, or a missing array, are a
  `shape-mismatch`.
- A row missing any template column is dropped as truncated. If every row is
  partial the decode fails as `truncated-empty`.
- An empty cell becomes an **absent key**.
- String columns (typed by the template's example value) are coerced back to
  strings, so `"5"` never returns as the number 5.

Per entry point:

- **`chat` / `chatWithImage`** return a JSON string (`JSON.stringify` of the
  decoded object). On any decode failure the raw reply is returned unchanged,
  which is what the caller would have parsed anyway.
- **`chatStructured`** returns an object. On a TOON decode failure: if the
  reply was JSON, it is parsed and returned with **no second call**; otherwise
  the call is re-asked **once** through the adapter's own JSON path with the
  **original** messages, tagged `wire: json`.

## Provider JSON mode

The TOON path never sends `jsonMode`. Provider JSON mode does not validate a
reply; it forces the model to emit JSON (`response_format: {type: 'json_object'}`
in `OpenAIAdapter`). Sent on the TOON path it would make the model answer in
JSON, which decodes as `json-reply` and falls back, defeating the TOON reply.
OpenAI can also error when `json_object` is set but the messages no longer
mention "JSON", as happens once the cue line is rewritten to TOON. The layer
therefore strips `jsonMode` from a copy of the caller's options, never from the
caller's object. Every other path, including the
`chatStructured` re-ask, delegates to the adapter with options intact so the
adapter's JSON mode applies as before.

## Config

In `integrations.yml`, on the `ai` entry:

```yaml
ai:
  - provider: openai
    wire:
      mode: off      # off | input | full
      sample: 1      # share of eligible calls that get TOON replies (0..1)
```

| Mode | Behaviour |
|------|-----------|
| `off` | Default. Layer inert; calls byte-identical, no logs, no `wire` tag |
| `input` | Re-encode input tables only; replies stay JSON |
| `full` | Input tables plus TOON replies for eligible templates, at the `sample` rate |

Missing or unrecognised values mean `off` / `sample: 1`. Integrations load at
boot, so a change needs a backend restart.

## Observability

Events carry `app` and `feature` from the scoped tags (`context.module` is
`ai-wire`).

| Event | Level | Meaning |
|-------|-------|---------|
| `ai.wire.config` | info | Resolved `{ mode, sample }` at boot |
| `ai.wire.rewrite` | debug | One per rewritten block: `kind: input` (`rows`) or `kind: template` (`columns`) |
| `ai.wire.skip` | debug | Nothing was sent as TOON; `reason` below |
| `ai.wire.decode.ok` | debug | `rows`, `droppedRows` |
| `ai.wire.decode.fallback` | warn | `reason` and a 200-char `sample` of the reply |

`ai.wire.skip` reasons: `no-messages` (not an array), `no-cue` (no reply
template), `flat-object`, `ambiguous`, `not-sampled` (eligible, sampling said
JSON), `input-only` (eligible, `mode: input`). Debug events are not shipped to
the log store; the warn fallback is.

Decode-fallback `reason`s: `not-text`, `json-reply`, `toon-parse`,
`shape-mismatch`, `truncated-empty`.

The usage ledger row carries `wire` (`1_adapters/ai/usageAttribution.mjs`):

| `wire` | Meaning |
|--------|---------|
| `toon` | A TOON reply was requested |
| `json` | The call was eligible but not sampled (or `input` mode), or it was the `chatStructured` re-ask |
| `passthrough` | Nothing eligible |
| absent | Layer off, or row written without the layer |

```bash
curl -s {env.log_store_url}/select/logsql/query -d 'query="ai.wire.decode.fallback" AND _time:24h'
node cli/openai-usage.cli.mjs ledger --by app,feature,wire
```

Compare `wire` values within one `app`/`feature` only. The `json` rows are the
control group for the `toon` rows.

### A/B check

`cli/ai-wire-ab.cli.mjs` replays real food descriptions through
`LogFoodFromText` on the JSON path and the TOON path and scores them
(`cli/ai-wire-ab.lib.mjs`). Run it inside the container:

```bash
sudo docker exec daylight-station node cli/ai-wire-ab.cli.mjs \
  --texts-b64 "$(printf '%s\n' 'two eggs and toast' 'a bowl of oatmeal' | base64 -w0)" --runs 3
```

`--texts-b64` is a base64 newline-separated list; `--runs` defaults to 3.
Exit codes: 0 PASS, 1 FAIL, 2 usage/setup error. Calls are attributed to app
`ai-wire-ab`, feature `cli`. It fails closed on any errored run, a JSON baseline
with 0 items, a text missing a path, or no texts. Pass thresholds: TOON
fallback rate at most 5%; item count matching the JSON path's most frequent
count(s) for at least 90% of texts; kcal within the JSON spread +/-15% for at
least 90% of texts. Token savings are read from the ledger (`wire` plus
completion tokens), not from the CLI's reply-size column.

## Adding a new structured caller

Prefer `chatStructured`: it gets the decode, the JSON-reply shortcut and the
re-ask for free. If you write a prose prompt with a reply template, qualify
automatically by:

- putting the JSON block on the same line as, or directly under, a cue line
  such as "Respond in JSON format:" (no blank line between);
- using exactly one array of flat example objects, with primitive scalar
  siblings only;
- putting field notes in prose, not inside the template;
- using one reply template per prompt.

Anything else passes through untouched, which is safe, just not cheaper.
