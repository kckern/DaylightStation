# PeriodResolver String Shorthand — Design

**Date:** 2026-05-06
**Status:** Brainstorm — review before plan
**Author thread:** conversation 2026-05-06 after a deployed transcript showed `metric_trajectory` failing because the model passed `period: 'last_30d'` as a string instead of `{ rolling: 'last_30d' }`.

**Related:**
- [docs/superpowers/specs/2026-05-05-health-coach-data-tier-design.md](2026-05-05-health-coach-data-tier-design.md) — defined the polymorphic period-input vocabulary
- [docs/superpowers/specs/2026-05-05-health-coach-chat-fix-design.md](2026-05-05-health-coach-chat-fix-design.md) — the fix that just deployed and surfaced this issue

---

## Why this exists

Live transcript at `/usr/src/app/media/logs/agents/health-coach/2026-05-06/kckern/012927-301-a51f0bce.json` shows the deployed chat-fix working — the model picked `metric_trajectory` from the cheatsheet, with the resolved `userId: 'user_1'` auto-injected. But the call **errored**:

```json
{
  "name": "metric_trajectory",
  "args": { "metric": "weight_lbs", "period": "last_30d", "userId": "user_1" },
  "ok": false,
  "result": { "error": "..." }
}
```

`period` is a bare string `"last_30d"` — the spec defined it as a polymorphic object `{ rolling: 'last_30d' } | { calendar: '2024' } | { named: '...' } | { from, to }`. `PeriodResolver.resolve()` rejects bare strings:

```javascript
if (!input || typeof input !== 'object') {
  throw new Error('PeriodResolver.resolve: input must be an object');
}
```

The model fell back to the older `get_weight_trend` (which takes `days: number`, not a polymorphic period). The user got a real answer through the fallback path — but the analytical primitive that should have been the primary path errored out.

This spec accepts the bare-string form at the resolver. The model continues to be steered toward the object form via the prompt cheatsheet, but the resolver tolerates strings when it slips.

---

## Design

**Two coordinated changes. Postel's law applied: tolerant input, strict output.**

### Change 1: `PeriodResolver.resolve()` accepts bare strings

Augment `resolve()` with a string-shorthand branch at the top, dispatching to the existing rolling/calendar resolvers:

```javascript
async resolve(input, ctx = {}) {
  // String shorthand — 'last_30d' → { rolling: 'last_30d' }
  if (typeof input === 'string') {
    if (this.#isRollingLabel(input)) return this.#resolveRolling(input);
    if (this.#isCalendarLabel(input)) return this.#resolveCalendar(input);
    throw new Error(`PeriodResolver: unknown period string "${input}"`);
  }

  if (!input || typeof input !== 'object') {
    throw new Error('PeriodResolver.resolve: input must be an object or recognized string label');
  }

  // ... existing object-form dispatch unchanged: rolling / calendar / from-to / named / deduced
}
```

Two private predicates:

```javascript
#isRollingLabel(label) {
  return label === 'all_time' || /^(last|prev)_\d+[dy]$/.test(label);
}

#isCalendarLabel(label) {
  if (CALENDAR_NAMED.includes(label)) return true;          // 'this_year', 'last_quarter', etc.
  return /^\d{4}$/.test(label)                              // 'YYYY'
      || /^\d{4}-\d{2}$/.test(label)                        // 'YYYY-MM'
      || /^\d{4}-Q[1-4]$/.test(label);                      // 'YYYY-Qn'
}
```

Where `CALENDAR_NAMED = ['this_week','this_month','this_quarter','this_year','last_quarter','last_year']` lifts the existing `if/else` branches in `#resolveCalendar` into a constant we can reuse for both predicate and resolver.

Unknown strings (e.g., `"forever"`) throw with the input echoed in the message.

### Change 2: `chat.mjs` cheatsheet — explicit period syntax

Add a "## Period syntax" section to the chat-mode prompt right after the tool cheatsheet:

```
## Period syntax
Most analytical tools take a `period` argument. Accepted forms:
- Rolling: { "rolling": "last_30d" }, { "rolling": "last_year" }, { "rolling": "all_time" }
- Calendar: { "calendar": "2024" }, { "calendar": "2024-Q3" }, { "calendar": "this_month" }
- Named: { "named": "2017-cut" }  — see list_periods for what's available
- Explicit: { "from": "2024-01-01", "to": "2024-03-31" }

Bare strings ("last_30d", "this_year") are also accepted as shorthand for
rolling/calendar labels, but the object form is preferred for clarity.
```

The cheatsheet teaches the canonical form. The resolver's permissive parsing handles the case where the model still passes a string.

---

## Architecture / file structure

**Modified files:**
- `backend/src/2_domains/health/services/PeriodResolver.mjs` — add string branch, two predicates, `CALENDAR_NAMED` constant
- `backend/src/3_applications/agents/health-coach/prompts/chat.mjs` — append Period syntax section
- `tests/isolated/domain/health/services/PeriodResolver.test.mjs` — add string-shorthand cases

No new files. No callers change — `MetricAggregator`/`MetricComparator`/`MetricTrendAnalyzer` already pass object form. CoachChat / dscli also pass objects (or `{from, to}`). The string path is only exercised by model output.

---

## Test plan

Add to existing `PeriodResolver.test.mjs`:

```javascript
describe('PeriodResolver — string shorthand', () => {
  const NOW = new Date('2026-05-05T12:00:00Z');
  const fixedNow = () => NOW;

  it('resolves bare "last_30d" string as rolling', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('last_30d');
    expect(out.from).toBe('2026-04-06');
    expect(out.to).toBe('2026-05-05');
    expect(out.source).toBe('rolling');
  });

  it('resolves bare "all_time"', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('all_time');
    expect(out.from).toBe('1900-01-01');
    expect(out.source).toBe('rolling');
  });

  it('resolves bare "2024" as calendar year', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    const out = await r.resolve('2024');
    expect(out.from).toBe('2024-01-01');
    expect(out.to).toBe('2024-12-31');
    expect(out.source).toBe('calendar');
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

  it('throws on unknown string with input echoed', async () => {
    const r = new PeriodResolver({ now: fixedNow });
    await expect(r.resolve('foo_bar')).rejects.toThrow(/unknown period string "foo_bar"/);
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
});
```

The `chat.mjs` change is a string append — covered by the existing mode-prompt tests asserting `## Tool Cheatsheet` is present (the new section is included as-is). Optionally add an assertion that `## Period syntax` is present.

---

## Edge cases

- **Empty string `""`**: throws — neither predicate matches.
- **`{rolling: 'last_30d'}` (object form)**: unchanged path; tests verify no regression.
- **Future named-period strings (`'2017-cut'`)**: NOT auto-resolved as a string. Named periods require the explicit `{named: '...'}` form because they need ctx.userId for lookup. The string branch only handles vocabulary that's deterministic without context. Documented in the prompt.
- **`from`/`to` shorthand `'2024-01-01..2024-03-31'`**: NOT supported. We're not inventing a new mini-syntax; if the model wants explicit dates, it uses `{from, to}`. Out of scope.
- **Whitespace**: throws — we don't trim. The model produces tokens cleanly; sloppy whitespace would mask a real bug.

---

## Why this shape

**One change at the right layer.** The resolver is the single chokepoint where every period input is normalized. Fixing it once covers every consumer (`aggregate_metric`, `aggregate_series`, `metric_trajectory`, `compare_metric`, `summarize_change`, `conditional_aggregate`, `correlate_metrics`, `metric_distribution`, `metric_percentile`, `detect_*`, `metric_snapshot`).

**No client-side change.** Frontend / CLI / agent tools already pass object form. The only consumer that needs string tolerance is the model — and the resolver is downstream of every tool call.

**Prompt + parser belt-and-suspenders.** The cheatsheet teaches the canonical form so most calls are object-formed. The resolver tolerates strings so the occasional model slip lands the right answer instead of an error.

**Strict output, tolerant input.** Every successful resolve still returns the same `{from, to, label, source}` tuple. Downstream code doesn't change at all.

---

## Out of scope

- Adding string shorthand to attachment payloads (the attachment system requires structured objects for semantic clarity — different concern).
- Auto-converting string args inside `MastraAdapter` to objects (cleaner to fix at the resolver — single chokepoint).
- Adding `{deduced: criteria}` string equivalent (the deduce path requires criteria objects, not labels — no useful string form exists).
- Resolving named-period slugs from a bare string. Named period lookup needs `userId` context; the string branch is intentionally context-free. The model uses `{named: 'slug'}` explicitly, which the existing object branch handles.
