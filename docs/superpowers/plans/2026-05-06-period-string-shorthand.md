# Period String Shorthand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PeriodResolver.resolve()` accept bare-string period shorthand (`'last_30d'`, `'2024-Q3'`, `'this_year'`, etc.) by dispatching to the existing rolling/calendar resolvers. Add a `## Period syntax` section to `chat.mjs` so the model is steered toward the canonical object form. Postel's law: tolerant input, strict output.

**Architecture:** Two coordinated changes. `PeriodResolver.resolve()` gets a string-shorthand branch at the top, with two new private predicates (`#isRollingLabel`, `#isCalendarLabel`) and a hoisted `CALENDAR_NAMED` constant. The `chat.mjs` chat-mode prompt gets a new section after the tool cheatsheet. No callers change — every existing consumer already passes the object form.

**Tech Stack:** Node ESM. Vitest under `tests/isolated/...`. Same conventions as preceding plans.

**Spec:** [docs/superpowers/specs/2026-05-06-period-string-shorthand-design.md](../specs/2026-05-06-period-string-shorthand-design.md)

**Prerequisites:** Plans 1-5 of analytics tier + chat-fix plan all merged to main. `PeriodResolver` exists at `backend/src/2_domains/health/services/PeriodResolver.mjs`. Chat prompt exists at `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`.

---

## File structure

**Modified files:**
- `backend/src/2_domains/health/services/PeriodResolver.mjs` — hoist `CALENDAR_NAMED`, add `#isRollingLabel` / `#isCalendarLabel`, add string branch at the top of `resolve()`
- `backend/src/3_applications/agents/health-coach/prompts/chat.mjs` — append `## Period syntax` section after the tool cheatsheet
- `tests/isolated/domain/health/services/PeriodResolver.test.mjs` — append string-shorthand tests
- `tests/isolated/agents/health-coach/HealthCoachAgent.modePrompt.test.mjs` — assert the new prompt section is present

**New files:** none.

---

## Conventions

- Vitest. Run individual files with `npx vitest run <path>`.
- TDD: test → run-FAIL → impl → run-PASS → commit per task.
- Path aliases: `#system/`, `#domains/`, `#adapters/`, `#apps/`, `#api/`.
- All commits end with: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

---

## Task 1: PeriodResolver accepts bare strings

**Files:**
- Modify: `backend/src/2_domains/health/services/PeriodResolver.mjs`
- Modify: `tests/isolated/domain/health/services/PeriodResolver.test.mjs`

- [ ] **Step 1: Append failing tests**

Append a new `describe` block to `tests/isolated/domain/health/services/PeriodResolver.test.mjs`:

```javascript
describe('PeriodResolver — string shorthand', () => {
  const NOW = new Date('2026-05-05T12:00:00Z');
  const fixedNow = () => NOW;

  it('resolves bare "last_30d" as rolling', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('last_30d');
    expect(out.from).toBe('2026-04-06');
    expect(out.to).toBe('2026-05-05');
    expect(out.label).toBe('last_30d');
    expect(out.source).toBe('rolling');
  });

  it('resolves bare "last_7d"', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('last_7d');
    expect(out.from).toBe('2026-04-29');
    expect(out.to).toBe('2026-05-05');
    expect(out.source).toBe('rolling');
  });

  it('resolves bare "all_time"', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('all_time');
    expect(out.from).toBe('1900-01-01');
    expect(out.to).toBe('2026-05-05');
    expect(out.source).toBe('rolling');
  });

  it('resolves bare "prev_30d"', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('prev_30d');
    // prev_30d is the 30 days adjacent to last_30d — days -60 to -30
    expect(out.from).toBe('2026-03-07');
    expect(out.to).toBe('2026-04-05');
    expect(out.source).toBe('rolling');
  });

  it('resolves bare "2024" as calendar year', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('2024');
    expect(out.from).toBe('2024-01-01');
    expect(out.to).toBe('2024-12-31');
    expect(out.source).toBe('calendar');
  });

  it('resolves bare "2024-08" as calendar month', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('2024-08');
    expect(out.from).toBe('2024-08-01');
    expect(out.to).toBe('2024-08-31');
  });

  it('resolves bare "2024-Q3" as calendar quarter', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('2024-Q3');
    expect(out.from).toBe('2024-07-01');
    expect(out.to).toBe('2024-09-30');
  });

  it('resolves bare "this_year"', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('this_year');
    expect(out.from).toBe('2026-01-01');
    expect(out.to).toBe('2026-12-31');
  });

  it('resolves bare "this_month"', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('this_month');
    expect(out.from).toBe('2026-05-01');
    expect(out.to).toBe('2026-05-31');
  });

  it('resolves bare "last_quarter"', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('last_quarter');
    // May 2026 is Q2; last_quarter = Q1
    expect(out.from).toBe('2026-01-01');
    expect(out.to).toBe('2026-03-31');
  });

  it('throws on unknown string with input echoed', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    await expect(r.resolve('foo_bar')).rejects.toThrow(/unknown period string "foo_bar"/);
  });

  it('throws on empty string', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    await expect(r.resolve('')).rejects.toThrow();
  });

  it('still rejects null/undefined/numbers', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    await expect(r.resolve(null)).rejects.toThrow();
    await expect(r.resolve(undefined)).rejects.toThrow();
    await expect(r.resolve(42)).rejects.toThrow();
  });

  it('object form still works (no regression)', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve({ rolling: 'last_30d' });
    expect(out.from).toBe('2026-04-06');
    expect(out.source).toBe('rolling');
  });

  it('object form { calendar } still works (no regression)', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve({ calendar: '2024-Q3' });
    expect(out.from).toBe('2024-07-01');
    expect(out.source).toBe('calendar');
  });
});
```

- [ ] **Step 2: Run; FAIL — string inputs all throw with "must be an object"**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/PeriodResolver.test.mjs
```

- [ ] **Step 3: Update PeriodResolver — hoist CALENDAR_NAMED, add predicates, add string branch**

In `backend/src/2_domains/health/services/PeriodResolver.mjs`:

(a) Add a module-level constant near the top (just below the existing `PERIOD_*` constants around line 21):

```javascript
const CALENDAR_NAMED = [
  'this_week', 'this_month', 'this_quarter', 'this_year',
  'last_quarter', 'last_year',
];
```

(b) Add two private predicates inside the class (alongside `#today`, `#fmt`, etc.):

```javascript
  #isRollingLabel(label) {
    if (label === 'all_time') return true;
    return /^(last|prev)_\d+[dy]$/.test(label);
  }

  #isCalendarLabel(label) {
    if (CALENDAR_NAMED.includes(label)) return true;
    if (/^\d{4}$/.test(label)) return true;          // YYYY
    if (/^\d{4}-\d{2}$/.test(label)) return true;     // YYYY-MM
    if (/^\d{4}-Q[1-4]$/.test(label)) return true;    // YYYY-Qn
    return false;
  }
```

(c) Update `resolve()` — add the string branch at the very top, before the existing object check:

```javascript
  async resolve(input, ctx = {}) {
    // String shorthand: 'last_30d' → { rolling: 'last_30d' };
    // '2024' / '2024-Q3' / 'this_year' → { calendar: <label> }.
    // Bare strings let the model pass simple labels without the object
    // wrapper. The prompt cheatsheet still teaches the canonical form.
    if (typeof input === 'string') {
      if (this.#isRollingLabel(input)) return this.#resolveRolling(input);
      if (this.#isCalendarLabel(input)) return this.#resolveCalendar(input);
      throw new Error(`PeriodResolver: unknown period string "${input}"`);
    }

    if (!input || typeof input !== 'object') {
      throw new Error('PeriodResolver.resolve: input must be an object or recognized string label');
    }
    if (typeof input.rolling === 'string') return this.#resolveRolling(input.rolling);
    if (typeof input.calendar === 'string') return this.#resolveCalendar(input.calendar);
    if (typeof input.from === 'string' && typeof input.to === 'string') {
      return { from: input.from, to: input.to, label: `${input.from}..${input.to}`, source: 'explicit' };
    }
    if (typeof input.named === 'string') {
      return this.#resolveNamed(input.named, ctx);
    }
    if (input.deduced) {
      throw new Error('deduced period inline resolution is not supported. Call deduce_period() first and pass the result as { from, to }.');
    }
    throw new Error('PeriodResolver.resolve: unknown period input shape');
  }
```

(d) Optionally remove the redundant inline check inside `#resolveCalendar` for `CALENDAR_NAMED` labels — the existing `if (label === 'this_year') ...` chain still works fine; we don't need to refactor that. Leave it as-is.

- [ ] **Step 4: Run tests; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/PeriodResolver.test.mjs
```

Expected: every existing test still passes (object-form regression), and the new 14 string-shorthand tests pass.

- [ ] **Step 5: Run downstream tests to confirm no regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/domain/health/services/ \
  tests/isolated/agents/health-coach/
```

Expected: all green. Plans 1-5 + chat-fix tests should be unaffected.

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/health/services/PeriodResolver.mjs \
        tests/isolated/domain/health/services/PeriodResolver.test.mjs
git commit -m "$(cat <<'EOF'
feat(period-resolver): accept bare-string shorthand

Plan / Task 1. resolve() now accepts strings matching rolling vocab
(last_*, prev_*, all_time) or calendar vocab (YYYY, YYYY-MM, YYYY-Qn,
this_*, last_*) by dispatching to the existing private resolvers.
Unknown strings throw with input echoed.

Surfaced by a deployed transcript where the model passed
period: 'last_30d' as a string, breaking metric_trajectory. The chat
prompt continues to teach the object form; this lands the
belt-and-suspenders parser fix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: chat.mjs — append `## Period syntax` section

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`
- Modify: `tests/isolated/agents/health-coach/HealthCoachAgent.modePrompt.test.mjs`

- [ ] **Step 1: Append failing test**

Append to the existing `describe('HealthCoachAgent.getSystemPrompt mode routing', ...)` block in `tests/isolated/agents/health-coach/HealthCoachAgent.modePrompt.test.mjs`:

```javascript
  it('chat-mode prompt includes a "## Period syntax" section', async () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    const prompt = await agent.getSystemPrompt({ mode: 'chat' });
    expect(prompt).toMatch(/## Period syntax/);
    // The section names the four canonical forms
    expect(prompt).toMatch(/Rolling: \{ "rolling":/);
    expect(prompt).toMatch(/Calendar: \{ "calendar":/);
    expect(prompt).toMatch(/Named: \{ "named":/);
    expect(prompt).toMatch(/Explicit: \{ "from":/);
    // Bare-string shorthand mentioned (so the model knows it works)
    expect(prompt).toMatch(/[Bb]are strings.*shorthand/);
  });

  it('dashboard-mode prompt does NOT include the Period syntax section', async () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    const prompt = await agent.getSystemPrompt({ mode: 'dashboard' });
    expect(prompt).not.toMatch(/## Period syntax/);
  });
```

- [ ] **Step 2: Run; FAIL — section doesn't exist yet**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/HealthCoachAgent.modePrompt.test.mjs
```

- [ ] **Step 3: Append the Period syntax section to chat.mjs**

In `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`, find the existing `## Default time windows` section (or wherever the cheatsheet ends) and insert this section just after the tool cheatsheet table, before `## Default time windows`:

```javascript
// (inside the existing exported template literal, append after the cheatsheet table)

## Period syntax
Most analytical tools take a `period` argument. Accepted forms:
- Rolling: { "rolling": "last_30d" }, { "rolling": "last_year" }, { "rolling": "all_time" }
- Calendar: { "calendar": "2024" }, { "calendar": "2024-Q3" }, { "calendar": "this_month" }
- Named: { "named": "2017-cut" } — see list_periods for what's available
- Explicit: { "from": "2024-01-01", "to": "2024-03-31" }

Bare strings ("last_30d", "this_year") are also accepted as shorthand for
rolling/calendar labels, but the object form is preferred for clarity.
```

If the existing chat.mjs is structured as a single template literal with `## Default time windows` already present, append the new section IMMEDIATELY before that header. If unsure, find this string in chat.mjs:

```
## Default time windows
- When the user doesn't specify a period, default to last_30d
```

And insert the Period syntax block just above it.

- [ ] **Step 4: Run tests; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/HealthCoachAgent.modePrompt.test.mjs
```

Expected: the two new tests pass; existing chat-mode tests still pass.

- [ ] **Step 5: Run all health-coach tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/prompts/chat.mjs \
        tests/isolated/agents/health-coach/HealthCoachAgent.modePrompt.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-coach): chat prompt — Period syntax section

Plan / Task 2. Adds a '## Period syntax' section after the tool
cheatsheet, naming the four canonical forms (rolling/calendar/named/
explicit) with concrete examples. Mentions bare-string shorthand as
the second-class fallback Task 1 enabled.

Steers the model toward the object form by default; the resolver's
permissive parsing handles the case where it slips.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: End-to-end verification

- [ ] **Step 1: Full suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/domain/health/services/ \
  tests/isolated/agents/ \
  tests/isolated/adapters/agents/
```

Expected: every test green. The cumulative count should be ~292+ across the agents + adapters surface (one new from Task 1, two new from Task 2).

- [ ] **Step 2: Live smoke against the running container** (optional — only if deployed)

Trigger the same query that originally errored:

```bash
curl -s -X POST http://localhost:3111/api/v1/agents/health-coach/run \
  -H "Content-Type: application/json" \
  -d '{"input":"whats my weight trend?","context":{"userId":"default"}}' | head -c 300
```

Then read the latest transcript:

```bash
sudo docker exec daylight-station sh -c \
  'find /usr/src/app/media/logs/agents/health-coach -name "*.json" -mmin -2 | sort -r | head -1 | xargs cat' \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
for c in d.get("toolCalls", []):
    print(c["name"], "ok=" + str(c["ok"]), "args=", c["args"])
'
```

Expected:
- The first tool call is `metric_trajectory` (or another analytical tool)
- `ok: True`
- The model either passed the canonical object form (`period: { rolling: 'last_30d' }`) — Task 2 worked — OR a bare string `period: 'last_30d'` and the resolver accepted it — Task 1 worked. Either way, no error.

- [ ] **Step 3: Final empty commit (optional)**

```bash
git commit --allow-empty -m "chore(period-resolver): plan complete — string shorthand shipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| Why this exists | (purpose) |
| Change 1: PeriodResolver string branch | 1 |
| Change 2: chat.mjs Period syntax section | 2 |
| Test cases (string forms, regression on object form, error path) | 1 |
| Edge cases (empty string, null/undefined, named not auto-resolved, no `..` shorthand) | 1 (negative tests) |
| Architecture / file structure | (defined upfront) |
| Out of scope | DEFERRED (attachment string shorthand, adapter-layer conversion, deduced strings, named-from-string lookup) |

---

## Notes for the implementer

- **No callers change.** `MetricAggregator`, `MetricComparator`, `MetricTrendAnalyzer`, etc. all already pass `{ rolling: ... }` etc. The string branch only fires for model-supplied args.
- **Existing `resolve()` async signature.** `resolve()` was made async in Plan 4 (named-period lookup needs it). Tests must `await`. The string branch is synchronous internally but the function still returns a Promise.
- **`#resolveRolling` / `#resolveCalendar` already throw on unknown labels** with helpful messages. The string branch catches the predicate-failure case and throws with the bare input echoed; the underlying resolvers are unchanged.
- **The `chat.mjs` existing structure**: it's a single exported template literal (`export const chatPrompt = \`...\`;`). Inserting the new section means editing inside the backtick block. Use `Edit` with a unique anchor (the `## Default time windows` line) to be precise.
- **Existing test `chat-mode prompt includes a "## Period syntax" section`** asserts the literal heading text. If you reword the section, update the test to match.
