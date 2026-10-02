# AI Structured Wire Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a transparent decorator between the `IAIGateway` port and the provider adapters that re-encodes tabular prompt data and tabular reply templates as TOON, decodes TOON replies back to the shape callers already expect, and is invisible to every use case.

**Architecture:** A `StructuredWireLayer` (in `backend/src/1_adapters/ai/`) wraps each AI adapter at composition time. Pure codec modules in `backend/src/1_adapters/ai/wire/` find JSON blocks in message text, classify them (reply template vs input data), rewrite eligible ones to TOON, and decode TOON replies with fallback to the raw reply. `chatWithJson` is renamed to the format-neutral `chatStructured`; `jsonMode` becomes adapter-internal. Rollout is config-gated (`off` by default).

**Tech Stack:** Node ESM (`.mjs`), vitest, `@toon-format/toon@4.1.1` (MIT, zero deps), existing `usageAttribution`/`AiUsageLedger`, `IntegrationLoader`.

**Spec:** `docs/superpowers/specs/2026-10-01-ai-structured-wire-layer-design.md`

## Global Constraints

- Use cases never see TOON. No file under `backend/src/3_applications/` or `backend/src/2_domains/` may import `@toon-format/toon` or anything in `1_adapters/ai/wire/`.
- `mode: off` (the default when config is absent) must send every call byte-identical to today.
- The layer imports only the port contract (`#apps/common/ports/IAIGateway.mjs`), `0_system` utilities, its `wire/` siblings and `@toon-format/toon`. Never `OpenAIAdapter`/`AnthropicAdapter` (no peer-adapter imports — `npm run audit:layers`).
- The TOON reply path never sends `jsonMode`. The JSON path delegates unchanged to `inner.chatStructured()`.
- Tab delimiter (`\t`) for every TOON table the layer writes or asks for.
- An empty TOON cell decodes to an **absent** key.
- Any decode failure returns today's behaviour: raw reply for `chat`/`chatWithImage`; for `chatStructured`, the JSON reply parsed if it is JSON, else a re-ask through `inner.chatStructured(originalMessages)`.
- Config key: `wire: { mode: off | input | full, sample: 0..1 }` on the `ai` entry of the household `integrations.yml`. Unknown mode → `off`. Sample defaults to `1`, clamped to `[0,1]`.
- Ledger rows gain `wire: toon | json | passthrough` only when the layer set it (rows written without the layer keep their current shape).
- Structured logging only (backend logger, `logger.debug?.(event, data)`), `module: ai-wire`. No `console.*`.
- Commits: conventional messages ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work in a git worktree (CLAUDE.md branch rules); merge to `main` when done.
- No instance-specific values (hosts, ports, paths) in docs — use `{env.*}` placeholders.

## Review Focus

1. **A food name containing a tab, newline, quote or leading space** — must round-trip intact (TOON quoting), never split a row. → Task 3 test "quoted values round-trip".
2. **Model wraps the TOON in a ```` ``` ```` fence or adds a prose preface** — fence is stripped and decodes; a preface fails shape validation and falls back to the raw reply rather than returning an object with a junk key. → Task 3 tests "fenced reply" and "prose preface falls back".
3. **Model answers in JSON despite the TOON instruction** — `chat` returns the raw JSON unchanged; `chatStructured` returns the parsed JSON without a second API call. → Task 5 test "JSON reply on the TOON path".
4. **A string column whose value decodes as a number/boolean** (food named `7`, `true`) — string columns (per the template example) are coerced back to strings so `item.name` stays a string. → Task 3 test "string columns stay strings".
5. **Caller reuses its options object across calls** — the layer must not mutate it (no leaked `usageTags.wire`, no dropped `jsonMode` on the caller's object). → Task 5 test "caller options are not mutated".

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/1_adapters/ai/wire/jsonBlocks.mjs` | Find balanced, parseable JSON spans inside prose. |
| `backend/src/1_adapters/ai/wire/shapes.mjs` | Tabular-eligibility rules for data and templates. |
| `backend/src/1_adapters/ai/wire/replyFormat.mjs` | Reply skeleton, cue-line rewrite, format-sentence stripping, `TOON_REPLY_RULES`, `decodeReply`. |
| `backend/src/1_adapters/ai/wire/planWire.mjs` | Classify blocks per call and produce rewritten messages + decode shape. |
| `backend/src/1_adapters/ai/wire/fixtures/foodPrompts.mjs` | Captures the four REAL food-logging prompts by running the use cases with fakes (test-only helper). |
| `backend/src/1_adapters/ai/StructuredWireLayer.mjs` | The decorator: sampling, delegation, decode, logging, `wire` tag. |
| `backend/src/1_adapters/ai/usageAttribution.mjs` | (modify) carry `wire` onto ledger rows. |
| `backend/src/5_composition/aiWireConfig.mjs` | Read `wire` config from raw integrations config. |
| `backend/src/5_composition/integrations/IntegrationLoader.mjs` | (modify) optional `decorateAdapter` dep hook. |
| `backend/src/5_composition/bootstrap.mjs` | (modify) pass `decorateAdapter` through. |
| `backend/src/app.mjs` | (modify) wrap all three AI construction paths. |
| `cli/ai-wire-ab.cli.mjs` | Offline JSON-vs-TOON equivalence A/B. |
| `docs/reference/core/ai-structured-wire-layer.md` | Reference doc. |

---

### Task 1: Rename `chatWithJson` → `chatStructured`; make `jsonMode` internal

**Files:**
- Modify: `backend/src/3_applications/common/ports/IAIGateway.mjs`
- Modify: `backend/src/1_adapters/ai/OpenAIAdapter.mjs` (`SCOPED_METHODS` line ~26, method ~561)
- Modify: `backend/src/1_adapters/ai/AnthropicAdapter.mjs` (`SCOPED_METHODS` line 18, method ~398)
- Modify: `backend/src/3_applications/ai/AiGatewayService.mjs` (`chatJson` → `chatStructured`, line 47)
- Modify: `backend/src/3_applications/ai/AIConsoleService.mjs` (line 34)
- Modify: `backend/src/4_api/v1/routers/ai.mjs` (line 58)
- Modify: `backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs`
- Modify: `backend/src/3_applications/school/CardLadderTypedJudge.mjs` (line ~91–94; also drop `jsonMode: true`)
- Modify: `backend/src/3_applications/school/remediation/AdaptiveRemediationTutor.mjs`
- Modify: `backend/src/3_applications/finance/TransactionCategorizationService.mjs`
- Modify: `backend/src/1_adapters/harvester/finance/ShoppingHarvester.mjs`
- Modify: `docs/reference/finance/categorization.md` (line 35)
- Test (modify): `tests/isolated/contract/shared/ports/IAIGateway.test.mjs`, `backend/src/3_applications/ai/AiGatewayService.test.mjs`, `backend/src/4_api/v1/routers/capabilityRoutes.characterization.test.mjs`, `backend/src/3_applications/school/CardLadderTypedJudge.test.mjs`, `backend/src/3_applications/school/remediation/AdaptiveRemediationTutor.test.mjs`, `backend/src/5_composition/aiUsageAttribution.consumers.test.mjs`, `backend/src/1_adapters/ai/AiUsageLedger.test.mjs`, `backend/src/1_adapters/ai/usageAttribution.test.mjs`, `tests/isolated/assembly/infrastructure/financeBootstrap.test.mjs`, `tests/isolated/adapter/ai/OpenAIAdapter.test.mjs`, `tests/isolated/adapter/ai/AnthropicAdapter.test.mjs`, `tests/isolated/adapter/harvester/finance/ShoppingHarvester.test.mjs`, `tests/isolated/flow/homebot/ProcessGratitudeInput.test.mjs`, `tests/isolated/adapter/harvester/finance/FinanceCategorization.test.mjs`, `tests/isolated/flow/finance/TransactionCategorizationService.test.mjs`

**Interfaces:**
- Produces: `IAIGateway.chatStructured(messages, options) → Promise<Object>`; `isAIGateway` requires `chatStructured`; `AiGatewayService.chatStructured(messages, { provider, ...options }) → { provider, json }` (HTTP response shape unchanged); both adapters' `SCOPED_METHODS` contain `chatStructured: 1`. Adapters still accept `options.jsonMode` internally (OpenAI `callCompletions`).

- [ ] **Step 1: Update the port contract test first**

In `tests/isolated/contract/shared/ports/IAIGateway.test.mjs`, replace the `chatWithJson throws not implemented` test with:

```javascript
    test('chatStructured throws not implemented', async () => {
      const gateway = new IAIGateway();
      await expect(gateway.chatStructured([])).rejects.toThrow('must be implemented');
    });
```

and anywhere that file builds a fake gateway object for `isAIGateway`, rename the `chatWithJson` key to `chatStructured`. Add:

```javascript
    test('isAIGateway rejects an object that still only has chatWithJson', () => {
      const legacy = { chat() {}, chatWithImage() {}, chatWithJson() {}, transcribe() {}, embed() {} };
      expect(isAIGateway(legacy)).toBe(false);
    });
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/isolated/contract/shared/ports/IAIGateway.test.mjs`
Expected: FAIL (`gateway.chatStructured is not a function`).

- [ ] **Step 3: Rename in the port**

In `IAIGateway.mjs`:
- Delete the `@property {boolean} [jsonMode=false] - Request JSON response format` line from the `ChatOptions` typedef.
- Replace the `chatWithJson` method with:

```javascript
  /**
   * Get a structured response as a plain JS object. The wire format used to
   * obtain it (JSON, TOON, provider-native modes) is the adapter's concern.
   * @param {ChatMessage[]} messages - Conversation messages
   * @param {ChatOptions} [options] - Optional configuration
   * @returns {Promise<Object>} - Parsed structured response
   */
  async chatStructured(messages, options = {}) {
    throw new Error('IAIGateway.chatStructured must be implemented');
  }
```
- In `isAIGateway`'s `requiredMethods`, replace `'chatWithJson'` with `'chatStructured'`.

- [ ] **Step 4: Mechanical rename across the listed source and test files**

```bash
cd <worktree root>
FILES="backend/src/1_adapters/ai/OpenAIAdapter.mjs backend/src/1_adapters/ai/AnthropicAdapter.mjs backend/src/3_applications/ai/AIConsoleService.mjs backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs backend/src/3_applications/school/CardLadderTypedJudge.mjs backend/src/3_applications/school/remediation/AdaptiveRemediationTutor.mjs backend/src/3_applications/finance/TransactionCategorizationService.mjs backend/src/1_adapters/harvester/finance/ShoppingHarvester.mjs docs/reference/finance/categorization.md backend/src/3_applications/ai/AiGatewayService.mjs backend/src/3_applications/ai/AiGatewayService.test.mjs backend/src/4_api/v1/routers/capabilityRoutes.characterization.test.mjs backend/src/3_applications/school/CardLadderTypedJudge.test.mjs backend/src/3_applications/school/remediation/AdaptiveRemediationTutor.test.mjs backend/src/5_composition/aiUsageAttribution.consumers.test.mjs backend/src/1_adapters/ai/AiUsageLedger.test.mjs backend/src/1_adapters/ai/usageAttribution.test.mjs tests/isolated/assembly/infrastructure/financeBootstrap.test.mjs tests/isolated/adapter/ai/OpenAIAdapter.test.mjs tests/isolated/adapter/ai/AnthropicAdapter.test.mjs tests/isolated/adapter/harvester/finance/ShoppingHarvester.test.mjs tests/isolated/flow/homebot/ProcessGratitudeInput.test.mjs tests/isolated/adapter/harvester/finance/FinanceCategorization.test.mjs tests/isolated/flow/finance/TransactionCategorizationService.test.mjs"
sed -i 's/chatWithJson/chatStructured/g' $FILES
sed -i 's/\bchatJson\b/chatStructured/g' backend/src/3_applications/ai/AiGatewayService.mjs backend/src/3_applications/ai/AiGatewayService.test.mjs backend/src/3_applications/ai/AIConsoleService.mjs backend/src/4_api/v1/routers/ai.mjs
grep -rn "chatWithJson\|\bchatJson\b" backend/src cli tests/isolated docs/reference | grep -v node_modules
```
Expected: the final grep prints nothing. If it prints a file not in the list, rename it the same way and add it to this task's commit.

In the adapters, the JSDoc above each renamed method should read "Get a structured response (JSON on this adapter's wire)". In `OpenAIAdapter.chatStructured` keep the internal `{ ...options, jsonMode: true }` call — `jsonMode` stays a private parameter of `callCompletions`.

- [ ] **Step 5: Drop the caller-visible `jsonMode` in `CardLadderTypedJudge`**

In `backend/src/3_applications/school/CardLadderTypedJudge.mjs` `#askModel`, change the options object to:

```javascript
    ], { model: this.#model, reasoningEffort: 'minimal', timeout: this.#timeoutMs });
```
Then: `grep -rn "jsonMode" backend/src/3_applications backend/src/2_domains backend/src/4_api` → expected: no output.

- [ ] **Step 6: Run the affected suites — expect PASS**

```bash
npx vitest run tests/isolated/contract/shared/ports/IAIGateway.test.mjs tests/isolated/adapter/ai tests/isolated/adapter/harvester/finance tests/isolated/flow/homebot/ProcessGratitudeInput.test.mjs tests/isolated/flow/finance/TransactionCategorizationService.test.mjs tests/isolated/assembly/infrastructure/financeBootstrap.test.mjs backend/src/3_applications/ai backend/src/4_api/v1/routers/capabilityRoutes.characterization.test.mjs backend/src/3_applications/school/CardLadderTypedJudge.test.mjs backend/src/3_applications/school/remediation backend/src/5_composition backend/src/1_adapters/ai
echo "exit=$?"
```
Expected: `exit=0`. A test asserting the old `jsonMode: true` on `CardLadderTypedJudge`'s options must be updated to assert its absence.

- [ ] **Step 7: Commit**

```bash
git add -A backend/src tests/isolated docs/reference/finance/categorization.md
git commit -m "refactor(ai): chatWithJson becomes format-neutral chatStructured; jsonMode is adapter-internal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: TOON dependency, JSON block finder, tabular shape rules

**Files:**
- Modify: `backend/package.json`, `backend/package-lock.json` (via npm)
- Create: `backend/src/1_adapters/ai/wire/jsonBlocks.mjs`
- Create: `backend/src/1_adapters/ai/wire/shapes.mjs`
- Test: `backend/src/1_adapters/ai/wire/jsonBlocks.test.mjs`, `backend/src/1_adapters/ai/wire/shapes.test.mjs`

**Interfaces:**
- Produces:
  - `findJsonBlocks(text: string) → Array<{ start: number, end: number, value: any }>` (end exclusive)
  - `isPrimitive(v) → boolean`
  - `isTable(value, minRows: number) → boolean`
  - `isEncodableData(value) → boolean`
  - `templateShape(value) → null | { kind: 'flat' } | { kind: 'table', arrayKey: string, columns: string[], scalarKeys: string[], stringColumns: string[] }`

- [ ] **Step 1: Install the codec**

```bash
cd backend && npm install --save-exact @toon-format/toon@4.1.1 && cd ..
node -e "import('@toon-format/toon').then(m => console.log(typeof m.encode, typeof m.decode))" --input-type=module
```
Run the node check from `backend/`. Expected: `function function`.

- [ ] **Step 2: Write failing tests**

`backend/src/1_adapters/ai/wire/jsonBlocks.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { findJsonBlocks } from './jsonBlocks.mjs';

describe('findJsonBlocks', () => {
  it('finds a multi-line object after prose and reports exact offsets', () => {
    const text = 'Respond in JSON format:\n{\n  "items": [{"a": 1}]\n}\nThanks';
    const [block] = findJsonBlocks(text);
    expect(block.value).toEqual({ items: [{ a: 1 }] });
    expect(text.slice(block.start, block.end)).toBe('{\n  "items": [{"a": 1}]\n}');
  });

  it('finds several blocks, including a top-level array, in order', () => {
    const text = 'Current: [{"a":1},{"a":2}]\nThen {"b":"x"}';
    expect(findJsonBlocks(text).map(b => b.value)).toEqual([[{ a: 1 }, { a: 2 }], { b: 'x' }]);
  });

  it("ignores a lone brace in prose such as Begin response with '{' character", () => {
    expect(findJsonBlocks("Begin response with '{' character - output only valid JSON")).toEqual([]);
  });

  it('respects braces inside JSON strings', () => {
    const [block] = findJsonBlocks('x {"s":"a}b{c","n":[1,2]} y');
    expect(block.value).toEqual({ s: 'a}b{c', n: [1, 2] });
  });

  it('skips a balanced span that is not JSON and keeps scanning inside it', () => {
    expect(findJsonBlocks('{not json {"ok":true}}').map(b => b.value)).toEqual([{ ok: true }]);
  });
});
```

`backend/src/1_adapters/ai/wire/shapes.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { isTable, isEncodableData, templateShape } from './shapes.mjs';

describe('isTable', () => {
  it('accepts objects of primitives sharing one key set, in any key order', () => {
    expect(isTable([{ a: 1, b: 'x' }, { b: 'y', a: 2 }], 2)).toBe(true);
  });
  it('rejects differing key sets, nested values, and too few rows', () => {
    expect(isTable([{ a: 1 }, { b: 2 }], 2)).toBe(false);
    expect(isTable([{ a: { n: 1 } }, { a: { n: 2 } }], 2)).toBe(false);
    expect(isTable([{ a: 1 }], 2)).toBe(false);
  });
});

describe('isEncodableData', () => {
  it('accepts a top-level table of 2+ rows', () => {
    expect(isEncodableData([{ a: 1 }, { a: 2 }])).toBe(true);
  });
  it('accepts an object of primitives plus 2+-row tables', () => {
    expect(isEncodableData({ date: 'd', items: [{ a: 1 }, { a: 2 }] })).toBe(true);
  });
  it('rejects single objects and one-row arrays', () => {
    expect(isEncodableData({ name: 'Rice', grams: 158 })).toBe(false);
    expect(isEncodableData([{ a: 1 }])).toBe(false);
  });
});

describe('templateShape', () => {
  it('describes a one-array template with scalar siblings', () => {
    expect(templateShape({ date: 'YYYY-MM-DD', items: [{ name: 'Food', grams: 100, dish: 'Smoothie' }] })).toEqual({
      kind: 'table', arrayKey: 'items', columns: ['name', 'grams', 'dish'], scalarKeys: ['date'], stringColumns: ['name', 'dish'],
    });
  });
  it('calls a template with no array flat (even with a nested object)', () => {
    expect(templateShape({ name: '', volume: { amount: 1, unit: 'cup' } })).toEqual({ kind: 'flat' });
  });
  it('returns null (ambiguous) for two arrays, nested rows, or array plus nested object', () => {
    expect(templateShape({ a: [{ x: 1 }], b: [{ y: 1 }] })).toBeNull();
    expect(templateShape({ a: [{ x: { y: 1 } }] })).toBeNull();
    expect(templateShape({ a: [{ x: 1 }], meta: { k: 1 } })).toBeNull();
    expect(templateShape([{ x: 1 }])).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run backend/src/1_adapters/ai/wire/`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement**

`backend/src/1_adapters/ai/wire/jsonBlocks.mjs`:

```javascript
/**
 * JSON spans embedded in prompt prose — the reply templates and input data
 * that callers paste into message text. Offsets are into the original text
 * (end exclusive) so a caller can splice replacements in place.
 * @param {string} text
 * @returns {Array<{start: number, end: number, value: any}>}
 */
export function findJsonBlocks(text) {
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') { i += 1; continue; }
    const end = matchBracket(text, i);
    if (end !== -1) {
      try {
        blocks.push({ start: i, end: end + 1, value: JSON.parse(text.slice(i, end + 1)) });
        i = end + 1;
        continue;
      } catch { /* balanced but not JSON — keep scanning inside it */ }
    }
    i += 1;
  }
  return blocks;
}

/** Index of the bracket closing the one at `start`, honouring JSON strings; -1 if none. */
function matchBracket(text, start) {
  const stack = [];
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}
```

`backend/src/1_adapters/ai/wire/shapes.mjs`:

```javascript
/**
 * Which structured values TOON pays for. TOON's win is a uniform array of flat
 * objects written once as a table header plus rows; everything else stays JSON.
 */
export const isPrimitive = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isRow = (v) => isPlainObject(v) && Object.keys(v).length > 0 && Object.values(v).every(isPrimitive);
const keySet = (row) => Object.keys(row).sort().join('\u0000');

/** An array of flat objects sharing one key set, with at least `minRows` rows. */
export function isTable(value, minRows) {
  return Array.isArray(value) && value.length >= minRows && value.every(isRow)
    && value.every((row) => keySet(row) === keySet(value[0]));
}

/** Input data worth re-encoding: a 2+-row table, or an object of primitives and 2+-row tables. */
export function isEncodableData(value) {
  if (isTable(value, 2)) return true;
  if (!isPlainObject(value)) return false;
  const values = Object.values(value);
  return values.some((v) => isTable(v, 2)) && values.every((v) => isPrimitive(v) || isTable(v, 2));
}

/**
 * The shape of a reply template.
 * - `{ kind: 'table', … }` — exactly one array of flat example rows plus scalar siblings: TOON-eligible.
 * - `{ kind: 'flat' }` — no array at all: TOON gains nothing, leave it.
 * - `null` — anything else: ambiguous, leave the whole call alone.
 */
export function templateShape(value) {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  const arrays = entries.filter(([, v]) => Array.isArray(v));
  if (arrays.length === 0) return { kind: 'flat' };
  if (arrays.length !== 1) return null;
  const [arrayKey, rows] = arrays[0];
  if (!isTable(rows, 1)) return null;
  if (!entries.every(([key, v]) => key === arrayKey || isPrimitive(v))) return null;
  const columns = Object.keys(rows[0]);
  return {
    kind: 'table',
    arrayKey,
    columns,
    scalarKeys: entries.filter(([key]) => key !== arrayKey).map(([key]) => key),
    stringColumns: columns.filter((column) => typeof rows[0][column] === 'string'),
  };
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run backend/src/1_adapters/ai/wire/`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/1_adapters/ai/wire/
git commit -m "feat(ai): JSON block finder and TOON tabular shape rules for the wire layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reply format — skeleton, cue rewrite, format-sentence stripping, decode

**Files:**
- Create: `backend/src/1_adapters/ai/wire/replyFormat.mjs`
- Test: `backend/src/1_adapters/ai/wire/replyFormat.test.mjs`

**Interfaces:**
- Consumes: `templateShape` result `{ kind:'table', arrayKey, columns, scalarKeys, stringColumns }` (Task 2).
- Produces:
  - `TOON_REPLY_RULES: string`
  - `buildReplySkeleton(template: object, shape) → string`
  - `rewriteCueLine(line: string) → string`
  - `stripFormatSentences(text: string) → string`
  - `decodeReply(text: string, shape) → { ok: true, value: object, droppedRows: number, truncated: boolean } | { ok: false, reason: 'not-text'|'json-reply'|'toon-parse'|'shape-mismatch'|'truncated-empty' }`

- [ ] **Step 1: Write failing tests**

`backend/src/1_adapters/ai/wire/replyFormat.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { encode } from '@toon-format/toon';
import { buildReplySkeleton, rewriteCueLine, stripFormatSentences, decodeReply, TOON_REPLY_RULES } from './replyFormat.mjs';
import { templateShape } from './shapes.mjs';

const template = {
  date: 'YYYY-MM-DD',
  time: 'evening',
  items: [{ name: 'Food Name In Title Case', unit: 'g|ml', grams: 100, dish: 'Smoothie' }],
};
const shape = templateShape(template);

describe('buildReplySkeleton', () => {
  it('writes scalar lines and a tab table header with one example row from the template values', () => {
    expect(buildReplySkeleton(template, shape)).toBe(
      'date: YYYY-MM-DD\ntime: evening\nitems[N\t]{name\tunit\tgrams\tdish}:\n  Food Name In Title Case\tg|ml\t100\tSmoothie',
    );
  });
});

describe('rewriteCueLine', () => {
  it('names TOON instead of JSON and keeps the rest of the line', () => {
    expect(rewriteCueLine('Respond in JSON format with the COMPLETE revised list:')).toBe('Respond in TOON format with the COMPLETE revised list:');
  });
});

describe('stripFormatSentences', () => {
  it("removes LogFoodFromText's JSON-only closing instruction entirely", () => {
    expect(stripFormatSentences("Use USDA values.\nBegin response with '{' character - output only valid JSON, no markdown.")).toBe('Use USDA values.\n');
  });
  it('leaves field-meaning notes alone', () => {
    const note = '("dish" is OPTIONAL — omit it for a standalone item.)';
    expect(stripFormatSentences(note)).toBe(note);
  });
});

describe('TOON_REPLY_RULES', () => {
  it('is fixed text that never mentions a specific array name', () => {
    expect(TOON_REPLY_RULES).toMatch(/^Reply in TOON, not JSON/);
    expect(TOON_REPLY_RULES).not.toMatch(/items/);
  });
});

describe('decodeReply', () => {
  const reply = 'date: 2026-10-01\ntime: evening\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Chicken, Rice\tg\t150\t\n  Broccoli\tg\t80\tBowl';

  it('decodes rows and turns an empty cell into an absent key', () => {
    expect(decodeReply(reply, shape)).toEqual({
      ok: true, droppedRows: 0, truncated: false,
      value: { date: '2026-10-01', time: 'evening', items: [
        { name: 'Chicken, Rice', unit: 'g', grams: 150 },
        { name: 'Broccoli', unit: 'g', grams: 80, dish: 'Bowl' },
      ] },
    });
  });

  it('drops a truncated partial last row and keeps the complete ones', () => {
    const cut = 'date: 2026-10-01\nitems[3\t]{name\tunit\tgrams\tdish}:\n  A\tg\t1\t\n  B\tg\t2\tX\n  C\tg';
    const result = decodeReply(cut, shape);
    expect(result.ok).toBe(true);
    expect(result.droppedRows).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.value.items.map(i => i.name)).toEqual(['A', 'B']);
  });

  it('fails truncated-empty when every row was partial', () => {
    expect(decodeReply('items[2\t]{name\tunit\tgrams\tdish}:\n  A\tg', shape)).toEqual({ ok: false, reason: 'truncated-empty' });
  });

  it('accepts a correct table with zero rows', () => {
    expect(decodeReply('date: 2026-10-01\nitems[0\t]{name\tunit\tgrams\tdish}:', shape).value.items).toEqual([]);
  });

  it('reports a JSON reply instead of decoding it', () => {
    expect(decodeReply('{"items":[]}', shape)).toEqual({ ok: false, reason: 'json-reply' });
  });

  // Review Focus 2
  it('fenced reply: strips a ```toon fence and decodes', () => {
    expect(decodeReply('```toon\n' + reply + '\n```', shape).ok).toBe(true);
  });
  it('prose preface falls back instead of returning a junk key', () => {
    expect(decodeReply('Here you go:\n' + reply, shape)).toEqual({ ok: false, reason: 'shape-mismatch' });
  });

  // Review Focus 1
  it('quoted values round-trip: tab, newline, quote and leading space in a name', () => {
    const items = [
      { name: 'Mac\t"n" Cheese', unit: 'g', grams: 200, dish: '' },
      { name: ' Leading space\nand newline', unit: 'g', grams: 50, dish: 'Plate' },
    ];
    const result = decodeReply(encode({ date: 'd', items }, { delimiter: '\t' }), shape);
    expect(result.ok).toBe(true);
    expect(result.value.items[0].name).toBe('Mac\t"n" Cheese');
    expect(result.value.items[1].name).toBe(' Leading space\nand newline');
  });

  // Review Focus 4
  it('string columns stay strings when the cell looks like a number or boolean', () => {
    const result = decodeReply('items[2\t]{name\tunit\tgrams\tdish}:\n  7\tg\t330\t\n  true\tg\t1\t', shape);
    expect(result.value.items.map(i => i.name)).toEqual(['7', 'true']);
    expect(result.value.items[0].grams).toBe(330);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run backend/src/1_adapters/ai/wire/replyFormat.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`backend/src/1_adapters/ai/wire/replyFormat.mjs`:

```javascript
import { decode } from '@toon-format/toon';

/**
 * Fixed primer appended after a rewritten reply template. Identical bytes on
 * every call so provider prompt caching of the stable prefix is unaffected.
 */
export const TOON_REPLY_RULES = [
  'Reply in TOON, not JSON, using exactly the layout above:',
  '- Scalar fields are `key: value` lines.',
  '- The table header is `name[N<TAB>]{col1<TAB>col2…}:` where N is the number of rows you write and <TAB> is a tab character.',
  '- Then N rows, each indented two spaces, values separated by tab characters in header column order.',
  '- Leave a cell empty to omit that field.',
  '- Quote a value only if it contains a tab or newline, or begins or ends with a space.',
  '- No code fences and no text before or after.',
].join('\n');

const cell = (v) => (v === null ? 'null' : String(v));

/** The TOON layout the model should copy, built from the caller's JSON template. */
export function buildReplySkeleton(template, shape) {
  const lines = [];
  for (const [key, value] of Object.entries(template)) {
    if (key !== shape.arrayKey) { lines.push(`${key}: ${cell(value)}`); continue; }
    lines.push(`${key}[N\t]{${shape.columns.join('\t')}}:`);
    lines.push(`  ${shape.columns.map((column) => cell(value[0][column])).join('\t')}`);
  }
  return lines.join('\n');
}

/** "Respond in JSON format:" → "Respond in TOON format:". */
export function rewriteCueLine(line) {
  return line.replace(/\bJSON\b/i, 'TOON');
}

/** Sentences that only exist to force JSON output; field-meaning notes are never in this list. */
const FORMAT_SENTENCES = [
  /Begin (?:the |your )?response with ['"`]?[{[]['"`]?(?: character)?\s*(?:[-–—,]\s*)?/gi,
  /(?:output|return|respond with) only valid JSON(?:,?\s*no markdown)?\.?/gi,
  /Respond with valid JSON only\.?(?:\s*No additional text or markdown\.)?/gi,
];

export function stripFormatSentences(text) {
  return FORMAT_SENTENCES.reduce((out, pattern) => out.replace(pattern, ''), text);
}

/**
 * Decode a TOON reply against the template's shape. Never throws: a reply
 * that is JSON, unparseable, or not the requested shape returns `ok: false`
 * so the caller can fall back to today's behaviour.
 */
export function decodeReply(text, shape) {
  if (typeof text !== 'string') return { ok: false, reason: 'not-text' };
  const body = text.trim().replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '').trim();
  if (/^[{[]/.test(body)) return { ok: false, reason: 'json-reply' };

  let value;
  let truncated = false;
  try {
    value = decode(body, { strict: true });
  } catch {
    truncated = true;
    try { value = decode(body, { strict: false }); } catch { return { ok: false, reason: 'toon-parse' }; }
  }

  const allowed = new Set([...shape.scalarKeys, shape.arrayKey]);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value[shape.arrayKey])
    || Object.keys(value).some((key) => !allowed.has(key))) {
    return { ok: false, reason: 'shape-mismatch' };
  }

  const rows = value[shape.arrayKey];
  const complete = rows.filter((row) => row && typeof row === 'object' && shape.columns.every((c) => Object.hasOwn(row, c)));
  const droppedRows = rows.length - complete.length;
  if (droppedRows > 0 && complete.length === 0) return { ok: false, reason: 'truncated-empty' };

  return {
    ok: true,
    value: { ...value, [shape.arrayKey]: complete.map((row) => cleanRow(row, shape)) },
    droppedRows,
    truncated,
  };
}

/** Empty cell → absent key; a string column never comes back as a number/boolean. */
function cleanRow(row, shape) {
  const out = {};
  for (const column of shape.columns) {
    const v = row[column];
    if (v === '') continue;
    const coerce = shape.stringColumns.includes(column) && (typeof v === 'number' || typeof v === 'boolean');
    out[column] = coerce ? String(v) : v;
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run backend/src/1_adapters/ai/wire/replyFormat.test.mjs`
Expected: PASS. If "quoted values round-trip" fails, print `encode(...)` output and adjust only the test's expectation of *how* the library quotes — the round-trip equality must hold.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/ai/wire/replyFormat.mjs backend/src/1_adapters/ai/wire/replyFormat.test.mjs
git commit -m "feat(ai): TOON reply skeleton, primer and tolerant decode for the wire layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `planWire` — classify and rewrite a call's messages, against the real prompts

**Files:**
- Create: `backend/src/1_adapters/ai/wire/planWire.mjs`
- Create: `backend/src/1_adapters/ai/wire/fixtures/foodPrompts.mjs`
- Test: `backend/src/1_adapters/ai/wire/planWire.test.mjs`

**Interfaces:**
- Consumes: `findJsonBlocks` (Task 2), `isEncodableData`, `templateShape` (Task 2), `buildReplySkeleton`, `rewriteCueLine`, `stripFormatSentences`, `TOON_REPLY_RULES` (Task 3).
- Produces: `planWire(messages, { reply: boolean }) → { messages, shape: object|null, toonReply: boolean, replyEligible: boolean, rewrites: Array<{kind:'input'|'template', rows?:number, columns?:number}>, skip: null|'no-messages'|'no-cue'|'flat-object'|'ambiguous' }`. When nothing is rewritten, `messages` is the **same array instance** passed in.
- Produces (test helper): `captureTextPrompt()`, `captureImagePrompt()`, `captureRevisionPrompt()`, `captureReviseEntryPrompt()` — each `→ Promise<ChatMessage[]>`.

- [ ] **Step 1: Write the real-prompt capture helper**

`backend/src/1_adapters/ai/wire/fixtures/foodPrompts.mjs` (test-only; the `fixtures/` folder is exempt from the layer audit):

```javascript
/**
 * The four food-logging prompts exactly as production builds them — captured
 * by running each use case against fakes — so wire-layer tests can never drift
 * from the real templates.
 */
import { vi } from 'vitest';
import { LogFoodFromText } from '#apps/nutribot/usecases/LogFoodFromText.mjs';
import { LogFoodFromImage } from '#apps/nutribot/usecases/LogFoodFromImage.mjs';
import { ProcessRevisionInput } from '#apps/nutribot/usecases/ProcessRevisionInput.mjs';
import { ReviseEntryService } from '#apps/health/ReviseEntryService.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const empty = JSON.stringify({ items: [] });

export async function captureTextPrompt() {
  const chat = vi.fn(async () => empty);
  const uc = new LogFoodFromText({
    messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
    aiGateway: { chat },
    foodLogStore: { save: vi.fn(async () => {}) },
    logger: silent,
  });
  await uc.execute({ userId: 'alice', conversationId: 'web:alice', text: 'two eggs and toast', messageId: 1 });
  return chat.mock.calls[0][0];
}

export async function captureImagePrompt() {
  const chatWithImage = vi.fn(async () => empty);
  const uc = new LogFoodFromImage({
    messagingGateway: {
      sendMessage: vi.fn(async () => ({ messageId: 'm1' })), sendPhoto: vi.fn(async () => ({ messageId: 'p1' })),
      updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}), getFileUrl: vi.fn(async () => null),
    },
    aiGateway: { chatWithImage },
    foodLogStore: { save: vi.fn(async () => {}) },
    imageDownloader: { download: vi.fn(async () => Buffer.from('unused')) },
    logger: silent,
  });
  const url = `data:image/jpeg;base64,${Buffer.from('not a real jpeg').toString('base64')}`;
  await uc.execute({ userId: 'alice', conversationId: 'web:alice', imageData: { url } });
  return chatWithImage.mock.calls[0][0];
}

export async function captureRevisionPrompt() {
  const chat = vi.fn(async () => empty);
  const items = [
    { id: 'toast00001', label: 'Toast', grams: 40, unit: 'slice', amount: 1, color: 'yellow', calories: 120 },
    { id: 'eggs000001', label: 'Fried Egg', grams: 100, unit: 'g', amount: 2, color: 'yellow', calories: 180 },
  ];
  const uc = new ProcessRevisionInput({
    receipts: () => ({ interaction: vi.fn(async () => {}) }),
    messagingGateway: { sendMessage: vi.fn(), updateMessage: vi.fn(), deleteMessage: vi.fn() },
    aiGateway: { chat },
    foodLogStore: {
      findByUuid: vi.fn(async () => ({ id: 'log-1', userId: 'kc', status: 'pending', meal: { date: '2026-09-02', time: 'morning' }, items, metadata: { source: 'text' } })),
      updateItems: vi.fn(async () => ({ id: 'log-1', items })),
      save: vi.fn(async () => {}),
    },
    nutriListStore: { syncFromLog: vi.fn(async () => {}) },
    conversationStateStore: {
      get: vi.fn(async () => ({ activeFlow: 'revision', flowState: { pendingLogUuid: 'log-1', originalMessageId: 'bot-1' } })),
      set: vi.fn(async () => {}), clear: vi.fn(async () => {}),
    },
    logger: silent,
  });
  const responseContext = { sendMessage: vi.fn(async () => ({ messageId: 'm' })), updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}) };
  await uc.execute({ userId: 'kc', conversationId: 'web:kc', text: 'make it 2 slices', messageId: 'user-1', responseContext }).catch(() => {});
  return chat.mock.calls[0][0];
}

export async function captureReviseEntryPrompt() {
  const chat = vi.fn(async () => JSON.stringify({ name: 'Cauliflower Rice', grams: 57 }));
  const row = { uuid: 'r1', name: 'Rice', grams: 158, amount: 158, unit: 'g', calories: 205, protein: 4.3, carbs: 45, fat: 0.4 };
  const service = new ReviseEntryService({ nutritionItems: { findByUuid: vi.fn(async () => row) }, aiGateway: { chat } });
  await service.propose('alice', { entryUuid: 'r1', instruction: 'cauliflower rice' }).catch(() => {});
  return chat.mock.calls[0][0];
}
```

If `#apps/...` aliases do not resolve from this folder, use relative paths (`../../../../3_applications/...`). If any capture function throws before the AI call, read that use case's existing test (`LogFoodFromImage.micros.test.mjs`, `ProcessRevisionInput.commit.test.mjs`, `ReviseEntryService.test.mjs`) and copy the missing fake from it — the AI call must be reached.

- [ ] **Step 2: Write failing tests**

`backend/src/1_adapters/ai/wire/planWire.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { planWire } from './planWire.mjs';
import { captureTextPrompt, captureImagePrompt, captureRevisionPrompt, captureReviseEntryPrompt } from './fixtures/foodPrompts.mjs';

const system = (messages) => messages.find(m => m.role === 'system')?.content ?? messages[0].content;

describe('planWire on the real food-logging prompts', () => {
  it('LogFoodFromText: rewrites the reply template to a TOON table and removes every JSON instruction', async () => {
    const original = await captureTextPrompt();
    const plan = planWire(original, { reply: true });
    expect(plan.toonReply).toBe(true);
    expect(plan.shape.arrayKey).toBe('items');
    expect(plan.shape.columns).toContain('dish');
    const content = system(plan.messages);
    expect(content).toMatch(/items\[N\t\]\{name\ticon\tnoom_color\t/);
    expect(content).toMatch(/Respond in TOON format:/);
    expect(content).not.toMatch(/JSON/);
    expect(content).not.toMatch(/'\{'/);
    expect(content).toMatch(/"dish" is OPTIONAL/);
    expect(content.endsWith('No code fences and no text before or after.')).toBe(true);
    expect(system(original)).toMatch(/Respond in JSON format:/); // caller's array untouched
  });

  it('LogFoodFromImage: reply template rewritten', async () => {
    const plan = planWire(await captureImagePrompt(), { reply: true });
    expect(plan.toonReply).toBe(true);
    expect(system(plan.messages)).toMatch(/items\[N\t\]\{name\t/);
  });

  it('ProcessRevisionInput: current items re-encoded as input AND reply template rewritten', async () => {
    const plan = planWire(await captureRevisionPrompt(), { reply: true });
    expect(plan.rewrites.map(r => r.kind).sort()).toEqual(['input', 'template']);
    const content = system(plan.messages);
    expect(content).toMatch(/\[2\t\]\{/);
    expect(content).not.toMatch(/"label": "Toast"/);
  });

  it('ReviseEntryService: flat template left alone, call untouched', async () => {
    const original = await captureReviseEntryPrompt();
    const plan = planWire(original, { reply: true });
    expect(plan).toMatchObject({ toonReply: false, replyEligible: false, skip: 'flat-object' });
    expect(plan.messages).toBe(original);
  });

  it('reply:false still re-encodes input data but leaves the template', async () => {
    const plan = planWire(await captureRevisionPrompt(), { reply: false });
    expect(plan.toonReply).toBe(false);
    expect(plan.replyEligible).toBe(true);
    expect(plan.rewrites.map(r => r.kind)).toEqual(['input']);
    expect(system(plan.messages)).toMatch(/Respond in JSON format with the COMPLETE revised list:/);
  });
});

describe('planWire edge cases', () => {
  it('no JSON at all: same array back, skip no-cue', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const plan = planWire(messages, { reply: true });
    expect(plan.messages).toBe(messages);
    expect(plan.skip).toBe('no-cue');
  });

  it('two templates: ambiguous, untouched', () => {
    const t = 'Respond in JSON:\n{"items":[{"a":1}]}';
    const messages = [{ role: 'system', content: t }, { role: 'user', content: t }];
    expect(planWire(messages, { reply: true })).toMatchObject({ skip: 'ambiguous', toonReply: false });
  });

  it('template with nested rows: ambiguous, untouched (even its data blocks)', () => {
    const messages = [{ role: 'user', content: 'Data: [{"a":1},{"a":2}]\nReturn JSON:\n{"items":[{"x":{"y":1}}]}' }];
    const plan = planWire(messages, { reply: true });
    expect(plan.skip).toBe('ambiguous');
    expect(plan.messages).toBe(messages);
  });

  it('non-string content passes through', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'x' }] }];
    expect(planWire(messages, { reply: true }).messages).toBe(messages);
  });

  it('inline single-object data is not re-encoded', () => {
    const messages = [{ role: 'user', content: 'Current food: {"name":"Rice","grams":158}' }];
    expect(planWire(messages, { reply: true }).messages).toBe(messages);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run backend/src/1_adapters/ai/wire/planWire.test.mjs`
Expected: FAIL (`planWire` not found).

- [ ] **Step 4: Implement**

`backend/src/1_adapters/ai/wire/planWire.mjs`:

```javascript
import { encode } from '@toon-format/toon';
import { findJsonBlocks } from './jsonBlocks.mjs';
import { isEncodableData, isTable, templateShape } from './shapes.mjs';
import { buildReplySkeleton, rewriteCueLine, stripFormatSentences, TOON_REPLY_RULES } from './replyFormat.mjs';

/** The nearest non-blank text before a block reads like an instruction about the reply's format. */
const REPLY_CUE = /\b(?:respond|reply|return|answer|output)\b.*\b(?:json|exactly as)\b/i;

/** The nearest non-blank line (or same-line prefix) before `index`, with its span. */
function cueLineBefore(text, index) {
  let end = index;
  while (end > 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1;
    const line = text.slice(start, end);
    if (line.trim()) return { start, end, line };
    if (start === 0) return null;
    end = start - 1;
  }
  return null;
}

function applyEdits(text, edits) {
  return [...edits].sort((a, b) => b.start - a.start)
    .reduce((out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end), text);
}

const rowCount = (value) => (Array.isArray(value)
  ? value.length
  : Object.values(value).filter((v) => isTable(v, 2)).reduce((n, v) => n + v.length, 0));

/**
 * Decide, for one call, what to re-encode as TOON. Pure: never mutates the
 * caller's messages; returns the same array when nothing changes.
 * @param {Array} messages
 * @param {{reply?: boolean}} opts - reply: rewrite an eligible reply template to TOON
 */
export function planWire(messages, { reply = false } = {}) {
  const untouched = (skip) => ({ messages, shape: null, toonReply: false, replyEligible: false, rewrites: [], skip });
  if (!Array.isArray(messages)) return untouched('no-messages');

  const found = messages.map((message) => {
    const templates = [];
    const data = [];
    if (typeof message?.content !== 'string') return { templates, data };
    for (const block of findJsonBlocks(message.content)) {
      const cue = cueLineBefore(message.content, block.start);
      if (cue && REPLY_CUE.test(cue.line)) templates.push({ ...block, cue });
      else if (isEncodableData(block.value)) data.push(block);
    }
    return { templates, data };
  });

  const templates = found.flatMap((f, index) => f.templates.map((t) => ({ ...t, messageIndex: index })));
  if (templates.length > 1) return untouched('ambiguous');
  const template = templates[0] ?? null;
  const shape = template ? templateShape(template.value) : null;
  if (template && shape === null) return untouched('ambiguous');

  const replyEligible = shape?.kind === 'table';
  const toonReply = replyEligible && reply;
  const rewrites = [];

  const out = messages.map((message, index) => {
    const edits = found[index].data.map((block) => {
      rewrites.push({ kind: 'input', rows: rowCount(block.value) });
      return { start: block.start, end: block.end, text: encode(block.value, { delimiter: '\t' }) };
    });
    const ownsTemplate = toonReply && template.messageIndex === index;
    if (ownsTemplate) {
      edits.push({ start: template.start, end: template.end, text: buildReplySkeleton(template.value, shape) });
      edits.push({ start: template.cue.start, end: template.cue.end, text: rewriteCueLine(template.cue.line) });
      rewrites.push({ kind: 'template', columns: shape.columns.length });
    }
    if (!edits.length) return message;
    let content = applyEdits(message.content, edits);
    if (ownsTemplate) content = `${stripFormatSentences(content).trimEnd()}\n\n${TOON_REPLY_RULES}`;
    return { ...message, content };
  });

  let skip = null;
  if (!rewrites.length) skip = !template ? 'no-cue' : shape.kind === 'flat' ? 'flat-object' : null;
  return { messages: rewrites.length ? out : messages, shape: toonReply ? shape : null, toonReply, replyEligible, rewrites, skip };
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run backend/src/1_adapters/ai/wire/`
Expected: PASS. If the LogFoodFromText test fails on `not.toMatch(/JSON/)`, print the rewritten content, find the remaining JSON-only sentence, and add a pattern for it to `FORMAT_SENTENCES` in `replyFormat.mjs` (plus a `stripFormatSentences` test case for it) — do not weaken the assertion.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/ai/wire/
git commit -m "feat(ai): planWire classifies prompt JSON and rewrites tabular templates/data to TOON

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `StructuredWireLayer` decorator + `wire` on ledger rows

**Files:**
- Create: `backend/src/1_adapters/ai/StructuredWireLayer.mjs`
- Modify: `backend/src/1_adapters/ai/usageAttribution.mjs` (`usageAttribution`, lines ~21–28)
- Test: `backend/src/1_adapters/ai/StructuredWireLayer.test.mjs`
- Test (modify): `backend/src/1_adapters/ai/usageAttribution.test.mjs`

**Interfaces:**
- Consumes: `planWire` (Task 4), `decodeReply` (Task 3), `IAIGateway`, `scopedGateway` (port).
- Produces: `new StructuredWireLayer(inner, { mode?: 'off'|'input'|'full', sample?: number, logger?: object, random?: () => number, tags?: object })` — an `IAIGateway` whose unknown properties resolve on `inner`. `usageAttribution(tags)` returns `wire` when `tags.wire` is set.

- [ ] **Step 1: Write failing tests**

Add to `backend/src/1_adapters/ai/usageAttribution.test.mjs`:

```javascript
describe('usageAttribution wire tag', () => {
  it('carries wire only when set', () => {
    expect(usageAttribution({ app: 'health', wire: 'toon' })).toMatchObject({ app: 'health', wire: 'toon' });
    expect(Object.hasOwn(usageAttribution({ app: 'health' }), 'wire')).toBe(false);
  });
});
```
(Import `usageAttribution` and `describe/it/expect` if the file does not already.)

`backend/src/1_adapters/ai/StructuredWireLayer.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { StructuredWireLayer } from './StructuredWireLayer.mjs';
import { IAIGateway } from '#apps/common/ports/IAIGateway.mjs';

const TEMPLATE_PROMPT = [
  { role: 'system', content: 'Analyze food.\nRespond in JSON format:\n{\n  "time": "evening",\n  "items": [{ "name": "Food", "grams": 100, "dish": "Bowl" }]\n}\nBegin response with \'{\' character - output only valid JSON, no markdown.' },
  { role: 'user', content: 'eggs' },
];
const TOON_REPLY = 'time: morning\nitems[1\t]{name\tgrams\tdish}:\n  Fried Egg\t100\t';

function fakeInner({ chat = async () => TOON_REPLY, chatStructured = async () => ({ from: 'json-path' }) } = {}) {
  const inner = {
    chat: vi.fn(chat),
    chatWithImage: vi.fn(async () => TOON_REPLY),
    chatStructured: vi.fn(chatStructured),
    transcribe: vi.fn(async () => 'words'),
    embed: vi.fn(async () => [1, 2]),
    isConfigured: () => true,
    model: 'gpt-4.1',
    scoped: vi.fn((tags) => ({ ...inner, scopedWith: tags })),
  };
  return inner;
}
const layer = (inner, opts = {}) => new StructuredWireLayer(inner, { mode: 'full', sample: 1, random: () => 0, ...opts });

describe('StructuredWireLayer', () => {
  it('is an IAIGateway and forwards unknown properties to the inner adapter', () => {
    const l = layer(fakeInner());
    expect(l).toBeInstanceOf(IAIGateway);
    expect(l.model).toBe('gpt-4.1');
  });

  it('mode off: passes the exact messages array and options object through', async () => {
    const inner = fakeInner({ chat: async () => 'raw' });
    const options = { maxTokens: 10 };
    expect(await layer(inner, { mode: 'off' }).chat(TEMPLATE_PROMPT, options)).toBe('raw');
    expect(inner.chat.mock.calls[0][0]).toBe(TEMPLATE_PROMPT);
    expect(inner.chat.mock.calls[0][1]).toBe(options);
  });

  it('chat on the TOON path: rewritten prompt out, JSON string back, wire tag set, jsonMode never sent', async () => {
    const inner = fakeInner();
    const out = await layer(inner).chat(TEMPLATE_PROMPT, { maxTokens: 4096, jsonMode: true });
    expect(JSON.parse(out)).toEqual({ time: 'morning', items: [{ name: 'Fried Egg', grams: 100 }] });
    const [sent, opts] = inner.chat.mock.calls[0];
    expect(sent[0].content).toMatch(/items\[N\t\]\{name\tgrams\tdish\}:/);
    expect(opts).toMatchObject({ maxTokens: 4096, usageTags: { wire: 'toon' } });
    expect(Object.hasOwn(opts, 'jsonMode')).toBe(false);
  });

  it('chat: an undecodable reply comes back raw', async () => {
    const inner = fakeInner({ chat: async () => 'I could not do that' });
    expect(await layer(inner).chat(TEMPLATE_PROMPT)).toBe('I could not do that');
  });

  // Review Focus 3
  it('JSON reply on the TOON path: chat returns it raw; chatStructured parses it without a second call', async () => {
    const json = '{"time":"x","items":[]}';
    const inner = fakeInner({ chat: async () => json });
    expect(await layer(inner).chat(TEMPLATE_PROMPT)).toBe(json);
    expect(await layer(inner).chatStructured(TEMPLATE_PROMPT)).toEqual({ time: 'x', items: [] });
    expect(inner.chatStructured).not.toHaveBeenCalled();
  });

  it('chatStructured on the TOON path returns the decoded object via inner.chat', async () => {
    const inner = fakeInner();
    expect(await layer(inner).chatStructured(TEMPLATE_PROMPT)).toEqual({ time: 'morning', items: [{ name: 'Fried Egg', grams: 100 }] });
    expect(inner.chatStructured).not.toHaveBeenCalled();
  });

  it('chatStructured: TOON garbage re-asks through inner.chatStructured with the ORIGINAL messages', async () => {
    const inner = fakeInner({ chat: async () => 'nonsense: [' });
    expect(await layer(inner).chatStructured(TEMPLATE_PROMPT)).toEqual({ from: 'json-path' });
    expect(inner.chatStructured.mock.calls[0][0]).toBe(TEMPLATE_PROMPT);
    expect(inner.chatStructured.mock.calls[0][1].usageTags.wire).toBe('json');
  });

  it('not sampled: template untouched, tagged json (A/B control group)', async () => {
    const inner = fakeInner({ chat: async () => 'raw' });
    await layer(inner, { sample: 0.5, random: () => 0.9 }).chat(TEMPLATE_PROMPT);
    const [sent, opts] = inner.chat.mock.calls[0];
    expect(sent).toBe(TEMPLATE_PROMPT);
    expect(opts.usageTags.wire).toBe('json');
  });

  it('mode input: never rewrites the reply format', async () => {
    const inner = fakeInner({ chat: async () => 'raw' });
    await layer(inner, { mode: 'input' }).chat(TEMPLATE_PROMPT);
    expect(inner.chat.mock.calls[0][0][0].content).toMatch(/Respond in JSON format:/);
  });

  it('a call with no structure is tagged passthrough', async () => {
    const inner = fakeInner({ chat: async () => 'hi' });
    await layer(inner).chat([{ role: 'user', content: 'hello' }]);
    expect(inner.chat.mock.calls[0][1].usageTags.wire).toBe('passthrough');
  });

  it('chatWithImage keeps the image argument and decodes', async () => {
    const inner = fakeInner();
    const out = await layer(inner).chatWithImage(TEMPLATE_PROMPT, 'data:image/png;base64,AA', {});
    expect(inner.chatWithImage.mock.calls[0][1]).toBe('data:image/png;base64,AA');
    expect(JSON.parse(out).items[0].name).toBe('Fried Egg');
  });

  it('scoped() wraps inner.scoped() in a new layer with the same config', async () => {
    const inner = fakeInner();
    const view = layer(inner).scoped({ app: 'health' });
    expect(view).toBeInstanceOf(StructuredWireLayer);
    expect(inner.scoped).toHaveBeenCalledWith({ app: 'health' });
    expect(JSON.parse(await view.chat(TEMPLATE_PROMPT)).items).toHaveLength(1);
  });

  it('transcribe, embed and isConfigured pass straight through', async () => {
    const inner = fakeInner();
    const l = layer(inner);
    expect(await l.transcribe(Buffer.from('a'), { language: 'en' })).toBe('words');
    expect(inner.transcribe).toHaveBeenCalledWith(Buffer.from('a'), { language: 'en' });
    expect(await l.embed('t')).toEqual([1, 2]);
    expect(l.isConfigured()).toBe(true);
  });

  // Review Focus 5
  it('caller options are not mutated', async () => {
    const options = { maxTokens: 5, jsonMode: true, usageTags: { feature: 'x' } };
    const snapshot = structuredClone(options);
    await layer(fakeInner()).chat(TEMPLATE_PROMPT, options);
    await layer(fakeInner()).chatStructured(TEMPLATE_PROMPT, options);
    expect(options).toEqual(snapshot);
  });

  it('logs a warn on decode fallback with the reason', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    await layer(fakeInner({ chat: async () => 'nope' }), { logger }).chat(TEMPLATE_PROMPT);
    expect(logger.warn).toHaveBeenCalledWith('ai.wire.decode.fallback', expect.objectContaining({ reason: expect.any(String), sample: 'nope' }));
  });

  it('mode off: chatStructured passes the exact arguments through', async () => {
    const inner = fakeInner();
    const options = { maxTokens: 10 };
    await layer(inner, { mode: 'off' }).chatStructured(TEMPLATE_PROMPT, options);
    expect(inner.chatStructured.mock.calls[0][0]).toBe(TEMPLATE_PROMPT);
    expect(inner.chatStructured.mock.calls[0][1]).toBe(options);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run backend/src/1_adapters/ai/StructuredWireLayer.test.mjs backend/src/1_adapters/ai/usageAttribution.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Carry `wire` in `usageAttribution`**

In `backend/src/1_adapters/ai/usageAttribution.mjs` replace the body of `usageAttribution`:

```javascript
export function usageAttribution(usageTags = null) {
  return {
    app: usageTags?.app ?? null,
    feature: usageTags?.feature ?? null,
    origin: currentOrigin() ?? null,
    // Set only by StructuredWireLayer; absent keeps pre-layer rows unchanged.
    ...(usageTags?.wire ? { wire: usageTags.wire } : {}),
  };
}
```
Update its JSDoc `@returns` to include `wire?: 'toon'|'json'|'passthrough'`.

- [ ] **Step 4: Implement the layer**

`backend/src/1_adapters/ai/StructuredWireLayer.mjs`:

```javascript
/**
 * StructuredWireLayer — decides the wire format of structured data between
 * the IAIGateway port and a provider adapter. Use cases speak JS objects and
 * JSON-shaped strings; this layer may send tabular data and reply templates
 * as TOON and decodes TOON replies back into exactly what the caller expects.
 * Every failure falls back to today's behaviour. See
 * docs/reference/core/ai-structured-wire-layer.md.
 */
import { IAIGateway } from '#apps/common/ports/IAIGateway.mjs';
import { planWire } from './wire/planWire.mjs';
import { decodeReply } from './wire/replyFormat.mjs';

const MODES = new Set(['off', 'input', 'full']);

export class StructuredWireLayer extends IAIGateway {
  #inner;
  #config;

  /**
   * @param {IAIGateway} inner - The provider adapter (or a scoped view of it)
   * @param {Object} [config]
   * @param {'off'|'input'|'full'} [config.mode='off']
   * @param {number} [config.sample=1] - Share of eligible calls that get a TOON reply
   * @param {Object} [config.logger]
   * @param {() => number} [config.random=Math.random]
   * @param {Object} [config.tags] - Attribution tags, for log context only
   */
  constructor(inner, { mode = 'off', sample = 1, logger = null, random = Math.random, tags = {} } = {}) {
    super();
    this.#inner = inner;
    this.#config = {
      mode: MODES.has(mode) ? mode : 'off',
      sample: Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 1,
      logger, random, tags,
    };
    // Anything not on the port (adapter getters, helpers) resolves on the
    // inner adapter, so wrapping never hides an existing member.
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in target) {
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        const value = target.#inner?.[prop];
        return typeof value === 'function' ? value.bind(target.#inner) : value;
      },
    });
  }

  chat(messages, options = {}) {
    return this.#textCall(messages, options, (m, o) => this.#inner.chat(m, o));
  }

  chatWithImage(messages, image, options = {}) {
    return this.#textCall(messages, options, (m, o) => this.#inner.chatWithImage(m, image, o));
  }

  async chatStructured(messages, options = {}) {
    const plan = this.#plan(messages);
    if (plan.wire === 'off') return this.#inner.chatStructured(messages, options);
    if (!plan.toonReply) return this.#inner.chatStructured(plan.messages, this.#options(options, plan));
    const raw = await this.#inner.chat(plan.messages, this.#options(options, plan));
    const decoded = this.#decode(raw, plan);
    if (decoded.ok) return decoded.value;
    if (decoded.reason === 'json-reply') {
      try { return JSON.parse(raw.trim()); } catch { /* fall through to the JSON path */ }
    }
    return this.#inner.chatStructured(messages, this.#options(options, { wire: 'json', toonReply: false }));
  }

  transcribe(audioBuffer, options = {}) { return this.#inner.transcribe(audioBuffer, options); }
  embed(text, options = {}) { return this.#inner.embed(text, options); }
  isConfigured() { return typeof this.#inner.isConfigured === 'function' ? this.#inner.isConfigured() : Boolean(this.#inner); }

  scoped(tags = {}) {
    const inner = typeof this.#inner.scoped === 'function' ? this.#inner.scoped(tags) : this.#inner;
    return new StructuredWireLayer(inner, { ...this.#config, tags: { ...this.#config.tags, ...tags } });
  }

  async #textCall(messages, options, call) {
    const plan = this.#plan(messages);
    if (plan.wire === 'off') return call(messages, options);
    const raw = await call(plan.messages, this.#options(options, plan));
    if (!plan.toonReply) return raw;
    const decoded = this.#decode(raw, plan);
    return decoded.ok ? JSON.stringify(decoded.value) : raw;
  }

  #plan(messages) {
    const { mode, sample, random } = this.#config;
    if (mode === 'off') return { messages, wire: 'off', toonReply: false };
    const plan = planWire(messages, { reply: mode === 'full' && random() < sample });
    for (const rewrite of plan.rewrites) this.#log('debug', 'ai.wire.rewrite', rewrite);
    const reason = plan.skip ?? (plan.replyEligible && !plan.toonReply ? (mode === 'input' ? 'input-only' : 'not-sampled') : null);
    if (reason) this.#log('debug', 'ai.wire.skip', { reason });
    return { ...plan, wire: plan.toonReply ? 'toon' : plan.replyEligible ? 'json' : 'passthrough' };
  }

  /** A copy of the caller's options: never mutate theirs. TOON replies cannot use provider JSON mode. */
  #options(options, plan) {
    const { jsonMode, ...rest } = options ?? {};
    const out = plan.toonReply ? rest : { ...options };
    return { ...out, usageTags: { ...options?.usageTags, wire: plan.wire } };
  }

  #decode(raw, plan) {
    const decoded = decodeReply(raw, plan.shape);
    if (decoded.ok) this.#log('debug', 'ai.wire.decode.ok', { rows: decoded.value[plan.shape.arrayKey].length, droppedRows: decoded.droppedRows });
    else this.#log('warn', 'ai.wire.decode.fallback', { reason: decoded.reason, sample: typeof raw === 'string' ? raw.slice(0, 200) : null });
    return decoded;
  }

  #log(level, event, data) {
    const { app = null, feature = null } = this.#config.tags;
    this.#config.logger?.[level]?.(event, { app, feature, ...data });
  }
}

export default StructuredWireLayer;
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run backend/src/1_adapters/ai/`
Expected: PASS (new tests plus every existing adapter test).

- [ ] **Step 6: Check the layer rule**

Run: `npm run audit:layers`
Expected: no new violations involving `StructuredWireLayer.mjs` or `wire/`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/ai/StructuredWireLayer.mjs backend/src/1_adapters/ai/StructuredWireLayer.test.mjs backend/src/1_adapters/ai/usageAttribution.mjs backend/src/1_adapters/ai/usageAttribution.test.mjs
git commit -m "feat(ai): StructuredWireLayer decides wire format between the port and the adapter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Composition — wrap every AI construction path, config-gated

**Files:**
- Create: `backend/src/5_composition/aiWireConfig.mjs`
- Modify: `backend/src/5_composition/integrations/IntegrationLoader.mjs` (`#loadAdapter`, lines 92–113)
- Modify: `backend/src/5_composition/bootstrap.mjs` (`loadHouseholdIntegrations`, lines 489–499)
- Modify: `backend/src/app.mjs` (integration load ~line 686, fallback ~line 720, Anthropic ~line 6565)
- Test: `backend/src/5_composition/aiWireConfig.test.mjs`, `backend/src/5_composition/integrations/IntegrationLoader.decorate.test.mjs`, `backend/src/5_composition/aiWireWrapping.wiring.test.mjs`

**Interfaces:**
- Consumes: `StructuredWireLayer` (Task 5).
- Produces: `readAiWireConfig(rawIntegrationsConfig) → { mode: 'off'|'input'|'full', sample: number }`; `IntegrationLoader` honours `deps.decorateAdapter(capability, adapter, serviceConfig) → adapter`; `loadHouseholdIntegrations({ ..., decorateAdapter })`.

- [ ] **Step 1: Write failing tests**

`backend/src/5_composition/aiWireConfig.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { readAiWireConfig } from './aiWireConfig.mjs';

describe('readAiWireConfig', () => {
  it('reads wire from the ai list entry', () => {
    expect(readAiWireConfig({ ai: [{ provider: 'openai', wire: { mode: 'full', sample: 0.5 } }] })).toEqual({ mode: 'full', sample: 0.5 });
  });
  it('defaults to off when absent, malformed or unknown', () => {
    expect(readAiWireConfig(null)).toEqual({ mode: 'off', sample: 1 });
    expect(readAiWireConfig({ ai: [{ provider: 'openai' }] })).toEqual({ mode: 'off', sample: 1 });
    expect(readAiWireConfig({ ai: [{ wire: { mode: 'toon-everything' } }] })).toEqual({ mode: 'off', sample: 1 });
  });
  it('clamps sample and accepts a single ai object', () => {
    expect(readAiWireConfig({ ai: { wire: { mode: 'input', sample: 7 } } })).toEqual({ mode: 'input', sample: 1 });
  });
});
```

`backend/src/5_composition/integrations/IntegrationLoader.decorate.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { IntegrationLoader } from './IntegrationLoader.mjs';

describe('IntegrationLoader decorateAdapter hook', () => {
  it('passes each loaded adapter through decorateAdapter and never hands the hook to the adapter', async () => {
    const Adapter = vi.fn(function Adapter(config, deps) { this.deps = deps; this.isConfigured = () => true; });
    const registry = { getManifest: vi.fn(() => ({ adapter: async () => ({ default: Adapter }) })) };
    const configService = {
      getIntegrationsConfig: () => ({ openai: {} }), getHouseholdAuth: () => null,
      getSystemAuth: () => 'k', getSecret: () => null, resolveServiceUrl: () => null,
    };
    const decorateAdapter = vi.fn((capability, adapter) => (capability === 'ai' ? { wrapped: adapter, isConfigured: () => true } : adapter));
    const adapters = await new IntegrationLoader({ registry, configService, logger: {} })
      .loadForHousehold('default', { decorateAdapter });
    expect(decorateAdapter).toHaveBeenCalledWith('ai', expect.any(Adapter), expect.any(Object));
    expect(adapters.get('ai').wrapped).toBeInstanceOf(Adapter);
    expect(adapters.get('ai').wrapped.deps.decorateAdapter).toBeUndefined();
  });
});
```

`backend/src/5_composition/aiWireWrapping.wiring.test.mjs`:

```javascript
/**
 * Guard: every AI provider adapter app.mjs constructs is wrapped in the
 * structured wire layer, and the integration loader is handed the hook.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const app = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'app.mjs'), 'utf8');

describe('AI wire layer wiring', () => {
  it('wraps every new OpenAIAdapter / AnthropicAdapter in app.mjs', () => {
    const ctors = [...app.matchAll(/new\s+(OpenAIAdapter|AnthropicAdapter)\s*\(/g)];
    expect(ctors.length).toBeGreaterThan(0);
    for (const m of ctors) {
      expect(app.slice(Math.max(0, m.index - 20), m.index)).toMatch(/wrapAiWire\(\s*$/);
    }
  });
  it('hands decorateAdapter to loadHouseholdIntegrations', () => {
    expect(app).toMatch(/loadHouseholdIntegrations\(\{[\s\S]*?decorateAdapter[\s\S]*?\}\)/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run backend/src/5_composition/aiWireConfig.test.mjs backend/src/5_composition/integrations/IntegrationLoader.decorate.test.mjs backend/src/5_composition/aiWireWrapping.wiring.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `aiWireConfig.mjs`**

```javascript
/**
 * The structured wire layer's config, from the `ai` entry of the household
 * integrations config: `ai: [{ provider: openai, wire: { mode, sample } }]`.
 * Absent or unrecognised → off, so the layer is inert until configured.
 */
const MODES = new Set(['off', 'input', 'full']);

export function readAiWireConfig(rawIntegrations) {
  const ai = rawIntegrations?.ai;
  const entries = Array.isArray(ai) ? ai : ai ? [ai] : [];
  const wire = entries.find((entry) => entry?.wire)?.wire ?? {};
  const mode = MODES.has(wire.mode) ? wire.mode : 'off';
  const sample = Number.isFinite(wire.sample) ? Math.min(1, Math.max(0, wire.sample)) : 1;
  return { mode, sample };
}
```

- [ ] **Step 4: Add the loader hook**

In `IntegrationLoader.mjs` `#loadAdapter`, replace the `try` block body:

```javascript
    try {
      const { default: AdapterClass } = await manifest.adapter();
      // decorateAdapter is composition's hook (e.g. the AI wire layer); the
      // adapter itself never receives it.
      const { decorateAdapter, ...sharedDeps } = deps;
      // Scope the shared logger per provider so adapter events (openai.usage,
      // openai.error, …) carry a module tag and ship to the log store instead
      // of defaulting to console/stdout.
      const adapterDeps = sharedDeps.logger?.child
        ? { ...sharedDeps, logger: sharedDeps.logger.child({ module: `${provider}-adapter` }) }
        : sharedDeps;
      const adapter = new AdapterClass(config, adapterDeps);
      return typeof decorateAdapter === 'function' ? (decorateAdapter(capability, adapter, serviceConfig) ?? adapter) : adapter;
    } catch (err) {
```

In `bootstrap.mjs` `loadHouseholdIntegrations`:

```javascript
  const { householdId, httpClient, logger = console, aiUsageLedger = null, decorateAdapter = null } = config;
  ...
  const adapters = await integrationLoaderInstance.loadForHousehold(
    householdId,
    { httpClient, logger, aiUsageLedger, ...(decorateAdapter ? { decorateAdapter } : {}) }
  );
```
Add `@param` for `decorateAdapter` to that function's JSDoc.

- [ ] **Step 5: Wire `app.mjs`**

Just before the `try { integrationSystem = await initializeIntegrations(...)` block (~line 679), add:

```javascript
  // Structured wire layer: every AI adapter is wrapped once where it is built,
  // so all consumers (and every scoped view) get it without knowing. Inert
  // unless integrations.yml sets ai[].wire.mode. See ai-structured-wire-layer.md.
  const { StructuredWireLayer } = await import('#adapters/ai/StructuredWireLayer.mjs');
  const { readAiWireConfig } = await import('#composition/aiWireConfig.mjs');
  const aiWire = readAiWireConfig(configService.getIntegrationsConfig?.(defaultHouseholdId));
  const aiWireLogger = rootLogger.child({ module: 'ai-wire' });
  const wrapAiWire = (adapter) => (adapter ? new StructuredWireLayer(adapter, { ...aiWire, logger: aiWireLogger }) : adapter);
  rootLogger.info('ai.wire.config', aiWire);
```

In the `loadHouseholdIntegrations({ ... })` call add:

```javascript
      decorateAdapter: (capability, adapter) => (capability === 'ai' ? wrapAiWire(adapter) : adapter),
```

Fallback (~line 720):

```javascript
    sharedAiGateway = wrapAiWire(new OpenAIAdapter({ apiKey: openaiApiKey }, { httpClient: axios, logger: rootLogger.child({ module: 'shared-ai' }), aiUsageLedger }));
```

Anthropic (~line 6565):

```javascript
    aiAnthropicAdapter = wrapAiWire(new AnthropicAdapter(
      { apiKey: anthropicApiKey },
      { httpClient: axios, logger: rootLogger.child({ module: 'ai-anthropic' }), aiUsageLedger }
    ));
```

Check `#composition/` is a valid import alias (`grep -n '"#composition' backend/package.json package.json`); if not, use the alias other `app.mjs` imports of `5_composition` use (e.g. the `createAgentUsageRecorder` import at ~line 672).

- [ ] **Step 6: Run — expect PASS, including the existing scoping guard**

```bash
npx vitest run backend/src/5_composition/ backend/src/1_adapters/ai/
echo "exit=$?"
```
Expected: `exit=0`. In particular `aiGatewayScoping.wiring.test.mjs` must still pass: `sharedAiGateway` and `aiAnthropicAdapter` are named roots, so assignments through `wrapAiWire(...)` remain declarations/assignments. If it flags a new offender, read its allowed-reference rules (top of that file) and fix the wiring — do not loosen the guard.

- [ ] **Step 7: Boot check**

```bash
ss -tlnp | grep 3112 || (cd backend && timeout 40 node index.js > /tmp/claude-wire-boot.log 2>&1; true)
grep -E "ai.wire.config|integrations.loaded|Error" /tmp/claude-wire-boot.log | head
```
If a dev backend is already listening on 3112, skip starting one and instead check its log for `ai.wire.config`. Expected: an `ai.wire.config` line with `{"mode":"off","sample":1}` and no boot error.

- [ ] **Step 8: Commit**

```bash
git add backend/src/5_composition/ backend/src/app.mjs
git commit -m "feat(ai): wrap every AI adapter in the structured wire layer at composition (off by default)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end — `LogFoodFromText` cannot tell the difference

**Files:**
- Test: `backend/src/1_adapters/ai/StructuredWireLayer.logFoodFromText.test.mjs`

**Interfaces:**
- Consumes: `StructuredWireLayer` (Task 5), `LogFoodFromText` (unchanged).

- [ ] **Step 1: Write the test**

```javascript
/**
 * The use case is unchanged and must not notice the wire layer: a TOON reply
 * through the layer yields the same saved items as the equivalent JSON reply.
 */
import { describe, it, expect, vi } from 'vitest';
import { encode } from '@toon-format/toon';
import { StructuredWireLayer } from './StructuredWireLayer.mjs';
import { LogFoodFromText } from '#apps/nutribot/usecases/LogFoodFromText.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const COLUMNS = ['name', 'icon', 'noom_color', 'quantity', 'unit', 'grams', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol', 'dish'];
const payload = {
  date: '2026-09-02', time: 'evening',
  items: [
    { name: 'Rice Noodles, In Broth', icon: 'default', noom_color: 'yellow', quantity: 200, unit: 'g', grams: 200, calories: 260, protein: 5, carbs: 55, fat: 1, fiber: 2, sugar: 1, sodium: 600, cholesterol: 0, dish: 'Curry Noodle Soup' },
    { name: 'Chicken Thigh', icon: 'default', noom_color: 'yellow', quantity: 120, unit: 'g', grams: 120, calories: 250, protein: 28, carbs: 0, fat: 15, fiber: 0, sugar: 0, sodium: 110, cholesterol: 140, dish: 'Curry Noodle Soup' },
    { name: 'Iced Tea', icon: 'default', noom_color: 'green', quantity: 350, unit: 'ml', grams: 350, calories: 5, protein: 0, carbs: 1, fat: 0, fiber: 0, sugar: 0, sodium: 10, cholesterol: 0 },
  ],
};
const toonReply = encode({ ...payload, items: payload.items.map((i) => Object.fromEntries(COLUMNS.map((c) => [c, i[c] ?? '']))) }, { delimiter: '\t' });

async function savedItems(aiGateway) {
  const saved = [];
  const uc = new LogFoodFromText({
    messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
    aiGateway,
    foodLogStore: { save: vi.fn(async (log) => { saved.push(log); }) },
    logger: silent,
  });
  await uc.execute({ userId: 'alice', conversationId: 'web:alice', text: 'curry noodle soup and an iced tea', messageId: 1 });
  return saved.at(-1).items.map(({ id, parentId, ...rest }) => rest);
}

describe('LogFoodFromText over the wire layer', () => {
  it('a TOON reply saves the same items as the equivalent JSON reply', async () => {
    const viaJson = await savedItems({ chat: vi.fn(async () => JSON.stringify(payload)) });
    const innerChat = vi.fn(async () => toonReply);
    const viaToon = await savedItems(new StructuredWireLayer({ chat: innerChat }, { mode: 'full', sample: 1, random: () => 0 }));
    expect(innerChat.mock.calls[0][0][0].content).toMatch(/items\[N\t\]\{name\t/); // TOON really was requested
    expect(viaToon).toEqual(viaJson);
    expect(viaToon.length).toBeGreaterThan(3); // dish header + members + standalone
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run backend/src/1_adapters/ai/StructuredWireLayer.logFoodFromText.test.mjs`
Expected: PASS. If `viaToon` differs, print both and fix the cause in the layer/codec (typically an empty-cell or type coercion issue) — never in `LogFoodFromText`. If saved items carry other generated ids (e.g. a nested uuid), extend the destructure in `savedItems` to drop exactly those fields and say which in the commit message.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/ai/StructuredWireLayer.logFoodFromText.test.mjs
git commit -m "test(ai): LogFoodFromText saves identical items through the TOON wire layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Offline A/B CLI

**Files:**
- Create: `cli/ai-wire-ab.cli.mjs`
- Create: `cli/ai-wire-ab.lib.mjs`
- Test: `cli/ai-wire-ab.lib.test.mjs`

**Interfaces:**
- Consumes: `StructuredWireLayer`, `OpenAIAdapter`, `LogFoodFromText`, `getConfigService` (`cli/_bootstrap.mjs`), `createCliAiUsageLedger`, `cliUsageTags` (`cli/_aiUsage.mjs`), `runWithOrigin`.
- Produces: `summarize(results) → { perPath, verdict: { pass: boolean, reasons: string[] } }` where `results: Array<{ text, path: 'json'|'toon', run, ms, replyChars, itemCount, kcal, fallback }>`.

- [ ] **Step 1: Write the failing test for the pure scoring**

`cli/ai-wire-ab.lib.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { summarize } from './ai-wire-ab.lib.mjs';

const row = (text, path, run, kcal, itemCount, extra = {}) => ({ text, path, run, ms: path === 'toon' ? 900 : 2000, replyChars: path === 'toon' ? 300 : 900, itemCount, kcal, fallback: false, ...extra });

describe('summarize', () => {
  it('passes when TOON stays inside the JSON run-to-run spread', () => {
    const results = [
      row('a', 'json', 1, 500, 2), row('a', 'json', 2, 540, 2), row('a', 'toon', 1, 520, 2),
      row('b', 'json', 1, 100, 1), row('b', 'json', 2, 110, 1), row('b', 'toon', 1, 105, 1),
    ];
    const { verdict, perPath } = summarize(results);
    expect(verdict.pass).toBe(true);
    expect(perPath.toon.meanMs).toBe(900);
    expect(perPath.json.meanReplyChars).toBe(900);
  });

  it('fails on fallbacks above 5% or item-count / kcal drift', () => {
    const results = [
      row('a', 'json', 1, 500, 2), row('a', 'json', 2, 500, 2), row('a', 'toon', 1, 900, 4, { fallback: true }),
    ];
    const { verdict } = summarize(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/fallback/);
    expect(verdict.reasons.join(' ')).toMatch(/item count|kcal/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run cli/ai-wire-ab.lib.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the scoring lib**

`cli/ai-wire-ab.lib.mjs`:

```javascript
/**
 * Scoring for the JSON-vs-TOON food-logging A/B. Models are not deterministic,
 * so TOON is judged against the JSON path's OWN run-to-run spread per text.
 */
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const mode = (xs) => [...xs].sort((a, b) => xs.filter((v) => v === b).length - xs.filter((v) => v === a).length)[0];

export function summarize(results) {
  const perPath = {};
  for (const path of ['json', 'toon']) {
    const rows = results.filter((r) => r.path === path);
    perPath[path] = {
      runs: rows.length,
      meanMs: mean(rows.map((r) => r.ms)),
      meanReplyChars: mean(rows.map((r) => r.replyChars)),
      fallbacks: rows.filter((r) => r.fallback).length,
    };
  }

  const texts = [...new Set(results.map((r) => r.text))];
  let countOk = 0;
  let kcalOk = 0;
  for (const text of texts) {
    const json = results.filter((r) => r.text === text && r.path === 'json');
    const toon = results.filter((r) => r.text === text && r.path === 'toon');
    if (!json.length || !toon.length) continue;
    const modal = mode(json.map((r) => r.itemCount));
    if (toon.every((r) => r.itemCount === modal)) countOk += 1;
    const lo = Math.min(...json.map((r) => r.kcal)) * 0.85;
    const hi = Math.max(...json.map((r) => r.kcal)) * 1.15;
    if (toon.every((r) => r.kcal >= lo && r.kcal <= hi)) kcalOk += 1;
  }

  const reasons = [];
  const toonRuns = perPath.toon.runs || 1;
  if (perPath.toon.fallbacks / toonRuns > 0.05) reasons.push(`fallback rate ${perPath.toon.fallbacks}/${toonRuns} exceeds 5%`);
  if (countOk / texts.length < 0.9) reasons.push(`item count matched JSON's modal count for only ${countOk}/${texts.length} texts`);
  if (kcalOk / texts.length < 0.9) reasons.push(`kcal inside JSON spread ±15% for only ${kcalOk}/${texts.length} texts`);
  return { perPath, verdict: { pass: reasons.length === 0, reasons } };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run cli/ai-wire-ab.lib.test.mjs`
Expected: PASS.

- [ ] **Step 5: Implement the CLI**

`cli/ai-wire-ab.cli.mjs`:

```javascript
#!/usr/bin/env node
/**
 * ai-wire-ab — replay real food descriptions through LogFoodFromText on the
 * JSON path and the TOON wire-layer path; compare items, kcal, reply size and
 * wall time. Exit 0 = TOON is equivalent; 1 = not; 2 = usage/setup error.
 *
 *   node cli/ai-wire-ab.cli.mjs --texts-b64 <base64 of newline-separated descriptions> [--runs 3]
 *
 * Calls are attributed to app ai-wire-ab, feature cli, with wire tags.
 */
import axios from 'axios';
import { getConfigService } from './_bootstrap.mjs';
import { createCliAiUsageLedger, cliUsageTags } from './_aiUsage.mjs';
import { runWithOrigin } from '#system/runtime/aiContext.mjs';
import { summarize } from './ai-wire-ab.lib.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

async function main() {
  const b64 = arg('--texts-b64');
  if (!b64) { process.stderr.write('usage: --texts-b64 <base64> [--runs N]\n'); process.exit(2); }
  const texts = Buffer.from(b64, 'base64').toString('utf8').split('\n').map((t) => t.trim()).filter(Boolean);
  const runs = Number(arg('--runs', '3'));

  const cfg = await getConfigService();
  const apiKey = cfg.getSystemAuth('openai', 'api_key');
  if (!apiKey) { process.stderr.write('OpenAI api_key not resolved from config\n'); process.exit(2); }

  const { OpenAIAdapter } = await import('#adapters/ai/OpenAIAdapter.mjs');
  const { StructuredWireLayer } = await import('#adapters/ai/StructuredWireLayer.mjs');
  const { LogFoodFromText } = await import('#apps/nutribot/usecases/LogFoodFromText.mjs');

  const base = new OpenAIAdapter({ apiKey }, { httpClient: axios, aiUsageLedger: createCliAiUsageLedger(cfg) })
    .scoped(cliUsageTags('ai-wire-ab'));
  let fallbacks = 0;
  const wireLogger = { debug() {}, info() {}, error() {}, warn: (event) => { if (event === 'ai.wire.decode.fallback') fallbacks += 1; } };
  const gateways = {
    json: base,
    toon: new StructuredWireLayer(base, { mode: 'full', sample: 1, logger: wireLogger }),
  };

  const results = [];
  for (const text of texts) {
    for (let run = 1; run <= runs; run += 1) {
      for (const path of ['json', 'toon']) {
        let replyChars = 0;
        const measured = {
          chat: async (messages, options) => {
            const reply = await gateways[path].chat(messages, options);
            replyChars = String(reply).length;
            return reply;
          },
        };
        const saved = [];
        const silent = { debug() {}, info() {}, warn() {}, error() {} };
        const uc = new LogFoodFromText({
          messagingGateway: { sendMessage: async () => ({ messageId: 'ab' }), updateMessage: async () => {}, deleteMessage: async () => {} },
          aiGateway: measured,
          foodLogStore: { save: async (log) => { saved.push(log); } },
          logger: silent,
        });
        const before = fallbacks;
        const started = Date.now();
        await uc.execute({ userId: 'ai-wire-ab', conversationId: 'cli:ai-wire-ab', text, messageId: null }).catch(() => {});
        const items = (saved.at(-1)?.items ?? []).filter((i) => i.kind !== 'group');
        results.push({
          text, path, run, ms: Date.now() - started, replyChars,
          itemCount: items.length,
          kcal: items.reduce((n, i) => n + (Number(i.calories) || 0), 0),
          fallback: fallbacks > before,
        });
      }
    }
  }

  const { perPath, verdict } = summarize(results);
  process.stdout.write(`${JSON.stringify({ texts: texts.length, runs, perPath, verdict }, null, 2)}\n`);
  process.exit(verdict.pass ? 0 : 1);
}

runWithOrigin('cli:ai-wire-ab', main).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(2);
});
```

Note: the JSON path's `replyChars` is the raw JSON; the TOON path's is the JSON string the layer reconstructs — so `meanReplyChars` compares *returned* sizes only. Token savings are read from the ledger (`wire` + `completionTokens`) in Task 10, not from this number. Keep that note as a comment above `replyChars` in the CLI.

- [ ] **Step 6: Smoke-check usage handling (no API call)**

Run: `node cli/ai-wire-ab.cli.mjs; echo "exit=$?"`
Expected: usage line on stderr, `exit=2`.

- [ ] **Step 7: Commit**

```bash
git add cli/ai-wire-ab.cli.mjs cli/ai-wire-ab.lib.mjs cli/ai-wire-ab.lib.test.mjs
git commit -m "feat(cli): ai-wire-ab replays food descriptions through JSON vs TOON wire paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation

**Files:**
- Create: `docs/reference/core/ai-structured-wire-layer.md`
- Modify: `docs/reference/core/configuration.md` (AI usage ledger section, ~line 162)
- Modify: `CLAUDE.md` (Navigation table)

- [ ] **Step 1: Write the reference doc**

`docs/reference/core/ai-structured-wire-layer.md` must contain these sections, written as current-state reference (not a changelog):

1. **What it is** — one paragraph: decorator between `IAIGateway` and provider adapters; use cases never see TOON; why (generated tokens are latency and cost).
2. **Where it sits** — the three construction paths it wraps (integration loader hook, fallback OpenAI adapter, Anthropic adapter); `scoped()` returns a new layer around `inner.scoped()`; unknown members resolve on the adapter.
3. **Classification rules** — the table from spec §2 (reply template / flat template / input data / ambiguous) and the exact cue regex `\b(?:respond|reply|return|answer|output)\b.*\b(?:json|exactly as)\b`.
4. **Reply decode and fallback guarantee** — empty cell → absent key; string columns coerced; truncated partial rows dropped; `chat` returns a JSON string; `chatStructured` returns an object; JSON replies and failures fall back exactly as in spec §2/§3, including the `chatStructured` re-ask.
5. **Provider JSON mode** — TOON path never sends `jsonMode`; JSON path delegates.
6. **Config** — `integrations.yml`:
   ```yaml
   ai:
     - provider: openai
       wire:
         mode: off      # off | input | full
         sample: 1      # share of eligible calls that get TOON replies
   ```
   Changes need a backend restart (integrations load at boot).
7. **Observability** — the four log events with levels; ledger `wire` values and what each means (`toon` = TOON reply requested, `json` = eligible but not sampled / control, `passthrough` = nothing eligible); a LogsQL example using `{env.log_store_url}`:
   `curl -s {env.log_store_url}/select/logsql/query -d 'query="ai.wire.decode.fallback" AND _time:24h'`
8. **Adding a new structured caller** — prefer `chatStructured`; if writing a prose template, put the JSON block directly under a cue line, use one array of flat example objects, and put field notes in prose — then it qualifies automatically.

- [ ] **Step 2: Update configuration.md**

In the AI usage ledger section add one paragraph: rows may carry `wire: toon | json | passthrough` (set by the structured wire layer; absent on rows written without it) and that `--by wire` style comparisons should filter by `app`/`feature` first. Link to `ai-structured-wire-layer.md`. Also document the `ai[].wire` config key next to the other `integrations.yml` AI keys if that file lists them.

- [ ] **Step 3: Update CLAUDE.md navigation**

Add a row to the Navigation table after the "AI spend attribution" row:

```markdown
| AI structured wire layer (TOON inside the gateway: classification, fallback, config) | `docs/reference/core/ai-structured-wire-layer.md` |
```

- [ ] **Step 4: Commit**

```bash
git add docs/reference/core/ai-structured-wire-layer.md docs/reference/core/configuration.md CLAUDE.md
git commit -m "docs(ai): structured wire layer reference, config and ledger wire field

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Merge, deploy inert, run the A/B, enable

**Files:** none (operational). Data file edited inside the container: `data/household/integrations.yml`.

- [ ] **Step 1: Full gate run in the worktree**

```bash
npm run test:unit:vitest; echo "vitest exit=$?"
npm run audit:layers; echo "audit exit=$?"
```
Expected: both exit 0, or only failures that also fail on `main` (verify by running the same failing file on `main`; list them in the merge commit message). New files must not appear in any failure.

- [ ] **Step 2: Merge to main and delete the branch**

From the main checkout:
```bash
git merge --no-ff <wire-layer-branch> -m "Merge: AI structured wire layer (inert until configured)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git worktree remove <worktree-path> && git branch -d <wire-layer-branch>
```

- [ ] **Step 3: Deploy with the layer OFF (no behaviour change)**

Per CLAUDE.local.md, chained so the gate's CLEAR is used immediately:
```bash
./scripts/build-daylight.sh && until ./scripts/deploy-gate.sh; do sleep 60; done && \
  sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
curl -s http://localhost:3111/build.txt
```
Expected: `/build.txt` shows the merge commit. Then confirm in the log store: `"ai.wire.config" AND _time:10m` shows `mode: off`.

- [ ] **Step 4: Collect real food descriptions**

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="logText.start" AND _time:7d' -d 'limit=200' \
  | jq -r '."data.text" // empty' | awk 'length > 8' | sort -u | head -30 > /tmp/claude-wire-texts.txt
wc -l /tmp/claude-wire-texts.txt
```
Expected: ~30 lines. (`{env.log_store_url}` per CLAUDE.local.md / `.claude/settings.local.json`.)

- [ ] **Step 5: Run the A/B inside the container**

```bash
B64=$(base64 -w0 /tmp/claude-wire-texts.txt)
sudo docker exec daylight-station node cli/ai-wire-ab.cli.mjs --texts-b64 "$B64" --runs 3; echo "ab exit=$?"
```
Expected: JSON summary; `ab exit=0` means PASS. On exit 1, stop here: report `verdict.reasons`, leave the layer off, and diagnose with the per-text results before changing anything.

- [ ] **Step 6: Enable at 50%**

Read the current file, then write the COMPLETE file back with the `wire` block added to the `ai` entry (never `sed -i` YAML in the container):
```bash
sudo docker exec daylight-station sh -c 'cat data/household/integrations.yml'
sudo docker exec daylight-station sh -c "cat > data/household/integrations.yml << 'EOF'
<entire file, with under the ai entry:
    wire:
      mode: full
      sample: 0.5>
EOF"
```
Restart through the gate (integrations load at boot):
```bash
until ./scripts/deploy-gate.sh; do sleep 60; done && sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```
Expected: `"ai.wire.config" AND _time:10m` shows `{"mode":"full","sample":0.5}`.

- [ ] **Step 7: Verify live**

After the next real food log (or post one through the web nutribot yourself as a test user), check:
```bash
sudo docker exec daylight-station sh -c 'tail -50 data/system/history/ai-usage/$(date +%Y-%m)*.jsonl' | grep '"wire"'
curl -s {env.log_store_url}/select/logsql/query -d 'query="ai.wire.decode.fallback" AND _time:24h'
```
Expected: rows with `"wire":"toon"` and `"wire":"json"` for `health`/nutribot features; no (or rare) decode fallbacks.

- [ ] **Step 8: Record the follow-up decision point**

Add to `docs/_wip/plans/2026-10-01-ai-wire-layer-rollout.md` (date-prefixed): the A/B summary JSON from Step 5, the date `sample: 0.5` went live, and the exact ledger query for the one-week comparison (`completionTokens` and `durationMs` grouped by `feature` and `wire`, from `openai-usage` or a jq over the month file). Commit it. Moving to `sample: 1` (or back to `off`) is a config-only change made after that week's data.
