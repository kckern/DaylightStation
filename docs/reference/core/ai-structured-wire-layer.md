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
layer, at worst at the cost of one re-ask. In `mode: off` (the default) the
call is byte-identical: nothing is rewritten or tagged, and no per-call event
is logged. The resolved config (`ai.wire.config`) is still logged once at boot
on the root logger; per-call events go to `module: ai-wire`.

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

A block is a **reply template** when its cue is an **imperative** about the
reply format (`REPLY_CUE` in `planWire.mjs`, case-insensitive):

- a verb (`respond`, `reply`, `return`, `answer`, `output`) that starts the
  line, follows sentence punctuation (`.` `:` `!` `?`) or follows a bullet or
  number (`-`, `*`, `2.`);
- then, within the same sentence, `in` / `with` / `as` followed (optionally
  after more words) by `JSON` — "Respond in JSON format:", "Return the list as
  JSON:" — or `JSON` directly ("Return JSON:");
- or `respond exactly as` / `reply exactly as`.

Noun uses are not cues: "Here is the previous reply as JSON data:" and "The
answer in JSON from yesterday:" leave the block below them as input data.

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
- The reply may hold **one** array header line (`key[N…]…:`); a second one,
  for any key, fails as `multiple-tables`. That header must declare the tab
  delimiter, a tab right before `]` as in `items[3<TAB>]{…}:`. Any other form
  (`items[3]{a,b}:`, TOON's default comma, or `[3|]`) fails as
  `wrong-delimiter`: with a comma header a name like `Chicken Breast, Grilled`
  splits into two cells and every later column shifts by one, which lax decode
  would otherwise return as `ok`.
- Parse is strict first; on failure it re-parses non-strict (lax). Keys
  outside the template, or a missing array or table header, are a
  `shape-mismatch`.
- **Rows are positional, so the table must be exactly as wide as the
  template.** One slipped tab moves every later value into the wrong column,
  and optional cells make that impossible to repair case by case (a dish-less
  row missing its trailing tab plus one doubled tab among the nutrients is
  exactly full width again, with every nutrient after the slip one column
  over). So:
  - The header's column list must equal the template's columns, **in the same
    order**, else `column-mismatch`.
  - Every row, middle and last alike, must have exactly one cell per column,
    counted by splitting on unquoted tabs. Fewer fails as `short-row`
    (including a row whose empty last value lost its tab, and a reply cut
    mid-row); more fails as `extra-cells` (lax decode would silently drop the
    surplus). An empty cell written with its tab is an **absent key**.
  - A `"` anywhere but the start of a cell fails as `stray-quote`: the
    decoder would open a quoted string there and swallow the following tabs
    (`12" Sub`).
- **Rows are never dropped.** The decoder silently skips some lines: a row
  whose first cell starts with `#` is a comment to it, and an unquoted row
  whose first cell holds a colon (`Soup: Miso`) reads as a key. So the raw
  row lines (indented, non-blank lines after the header) are counted; if they
  differ from the declared `[N]` or from the decoded rows, the decode fails as
  `row-count-mismatch`. This runs after strict decodes too, because strict
  mode skips a `#` row without complaint when `[N]` already agrees with what
  is left.
- **Type check** (`type-mismatch`), by the template's example value
  (`stringColumns`, `numberColumns`, `booleanColumns` in the shape), for
  every row:
  - a number column must decode to a number or `null`;
  - a boolean column must decode to a boolean or `null`;
  - a text column must not hold a **bare** number or boolean: `7` is a slip,
    `"7"` (quoted, as the primer asks) decodes as the string `7`.

  Empty cells are absent keys and always pass. A shift that survives the width
  check (two slips that cancel out) almost always lands text in a number
  column or a number in a text column, which this catches.
- Order of checks: `multiple-tables`, `wrong-delimiter`, `toon-parse`,
  `shape-mismatch`, `column-mismatch`, `row-count-mismatch`, then per raw row
  `stray-quote`, `extra-cells`, `short-row`, then `type-mismatch`.
- Success is `{ ok: true, value }`; failure is `{ ok: false, reason }`.

Per entry point:

- **`chat` / `chatWithImage`** return a JSON string (`JSON.stringify` of the
  decoded object). If the reply was JSON (`json-reply`), it is returned raw:
  the caller parses JSON. On any other decode failure the call is re-asked
  **once** through the same inner method (`chatWithImage` keeps its image)
  with the **original** messages and the caller's original options
  (`jsonMode` exactly as the caller passed it), tagged `wire: json`, and that
  raw reply is returned.
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
caller's object. Every other path, including the `chat` / `chatWithImage` and
`chatStructured` re-asks, delegates to the adapter with options intact so the
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
| `off` | Default. Layer inert; calls byte-identical, no per-call logs, no `wire` tag (`ai.wire.config` still logs once at boot) |
| `input` | Re-encode input tables only; replies stay JSON |
| `full` | Input tables plus TOON replies for eligible templates, at the `sample` rate |

Missing or unrecognised values mean `off` / `sample: 1`. Integrations load at
boot, so a change needs a backend restart.

## Observability

Per-call events carry `app` and `feature` from the scoped tags
(`context.module` is `ai-wire`). `ai.wire.config` is logged once at boot on
the root logger, in every mode including `off`.

| Event | Level | Meaning |
|-------|-------|---------|
| `ai.wire.config` | info | Resolved `{ mode, sample }` at boot (root logger) |
| `ai.wire.rewrite` | debug | One per rewritten block: `kind: input` (`rows`) or `kind: template` (`columns`) |
| `ai.wire.skip` | debug | Nothing was sent as TOON; `reason` below |
| `ai.wire.decode.ok` | debug | `rows` |
| `ai.wire.decode.fallback` | warn | `reason` and a 200-char `sample` of the reply; a re-ask follows unless `reason` is `json-reply` |

`ai.wire.skip` reasons: `no-messages` (not an array), `no-cue` (no reply
template), `flat-object`, `ambiguous`, `not-sampled` (eligible, sampling said
JSON), `input-only` (eligible, `mode: input`). Debug events are not shipped to
the log store; the warn fallback is.

Decode-fallback `reason`s: `not-text`, `json-reply`, `toon-parse`,
`multiple-tables`, `wrong-delimiter`, `shape-mismatch`,
`column-mismatch`, `row-count-mismatch`, `stray-quote`, `extra-cells`,
`short-row`, `type-mismatch`. Mode `off` emits no skip reason (nothing is planned).

The usage ledger row carries `wire` (`1_adapters/ai/usageAttribution.mjs`):

| `wire` | Meaning |
|--------|---------|
| `toon` | A TOON reply was requested |
| `json` | The call was eligible but not sampled (or `input` mode), or it was a re-ask after a decode failure (`chat`, `chatWithImage` or `chatStructured`) |
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
least 90% of texts; food-name overlap for at least 90% of texts. The fallback
rate counts every `ai.wire.decode.fallback`, whatever its reason (each one cost
a re-ask). Name overlap: each run records `names`, its lowercased item labels
with group headers excluded; a TOON run's overlap is the share of its names
present in the union of that text's JSON-run names (containment rather than
Jaccard, so JSON's own run-to-run variety does not count against TOON), and a
text passes when every TOON run reaches 0.5. Token savings are read from the ledger (`wire` plus
completion tokens), not from the CLI's reply-size column.

## Adding a new structured caller

Prefer `chatStructured`: it gets the decode, the JSON-reply shortcut and the
re-ask for free. If you write a prose prompt with a reply template, qualify
automatically by:

- putting the JSON block on the same line as, or directly under, an
  imperative cue line such as "Respond in JSON format:" (no blank line
  between);
- using exactly one array of flat example objects, with primitive scalar
  siblings only;
- putting field notes in prose, not inside the template;
- using one reply template per prompt.

Anything else passes through untouched, which is safe, just not cheaper.
