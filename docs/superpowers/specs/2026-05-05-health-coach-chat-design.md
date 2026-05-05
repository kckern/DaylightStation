# Health Coach Chat — Design

**Date:** 2026-05-05
**Status:** Brainstorm — review before plan
**Author thread:** conversation 2026-05-05 about giving HealthApp a chat interface for the health-coach agent with `@`-mention attachments.
**Related:**
- [docs/superpowers/specs/2026-05-05-health-coach-data-tier-design.md](2026-05-05-health-coach-data-tier-design.md) — the analytical capability tier the health-coach agent uses
- `frontend/src/Apps/HealthApp.jsx` — current dashboard host
- `frontend/src/modules/Chat/` — pre-existing generic chat module (kept for `lifeplan-guide`; not used here)

---

## Why this exists

The health-coach agent shipped with 18 analytical tools (across Plans 1-5) plus 26 pre-existing tools (longitudinal queries, dashboard, fitness content, messaging). It can answer questions like "how is my weight trending vs. `2017-cut`?" or "when food is being tracked, what does my weight do?" — but only via Telegram (the existing nutribot integration) or programmatic API calls. There's no in-app chat surface where you sit with the data on screen and converse with the coach.

This design adds that surface to `frontend/src/Apps/HealthApp.jsx` and gives the agent first-class access to **structured user references** through `@`-mentions. When you type `@last_30d` or `@'2017-cut'` or `@2026-05-04`, those become typed attachments the agent can reason about explicitly — so it knows what window or day or workout you mean without you having to spell out dates or describe the period.

---

## Design philosophy

**One library, two halves.** `@assistant-ui/react` is the primary dependency. It provides the chat shell (Thread, Composer, Message rendering) AND the `@`-mention behavior (cursor-aware trigger detection, keyboard navigation, suggestion search) AND the attachment system in one cohesive package. We don't roll our own input UX or maintain parallel mention/attachment infrastructure.

**By-reference, not by-value.** When you mention `@last_30d`, we send the agent a structured reference (`{ type: 'period', value: { rolling: 'last_30d' } }`) — not the actual data for the last 30 days. The agent already has 18+ tools to fetch any of this on demand. Materializing data on the client would (a) duplicate work, (b) slow down the input, (c) blow up payload size for richer mentions like multi-month periods.

**Hybrid completions.** For finite catalogs (the user's named periods, recent days, the metric registry), the suggestion dropdown is data-driven via a small backend API. For arbitrary historical dates (workouts/nutrition/weight on `2018-08-15`), the dropdown surfaces a date-picker fallback rather than trying to enumerate years of entries.

**Health-specific, not generic.** This module lives at `frontend/src/modules/Health/CoachChat/` — it's the health-coach's chat. The existing `frontend/src/modules/Chat/` keeps powering the `lifeplan-guide` chat. If patterns repeat enough across agents later, we extract a shared layer; YAGNI for now.

---

## Architecture

### Frontend

```
frontend/src/modules/Health/CoachChat/
├── index.jsx                     — <CoachChat /> — assistant-ui Thread + Composer
├── runtime.js                    — LocalRuntime adapter (calls /api/v1/agents/health-coach/run)
├── mentions/
│   ├── index.js                  — exports the assistant-ui mention extension config
│   ├── periodSuggestions.js      — period autocomplete (calls suggestions API)
│   ├── daySuggestions.js         — recent-day autocomplete
│   ├── metricSuggestions.js      — metric-snapshot composite mentions
│   └── attachmentTypes.js        — type schemas + serialization helpers
├── chips/
│   ├── PeriodChip.jsx            — chip rendered when @period is selected
│   ├── DayChip.jsx
│   ├── WorkoutChip.jsx
│   ├── NutritionChip.jsx
│   ├── WeightChip.jsx
│   └── MetricSnapshotChip.jsx
├── CoachChat.scss                — Mantine variable bridge to assistant-ui CSS vars
└── README.md                     — module overview
```

### Backend

```
backend/src/4_api/v1/routers/health-mentions.mjs       NEW
  GET /api/v1/health/mentions/periods?prefix=&user=
  GET /api/v1/health/mentions/recent-days?days=30&user=
  GET /api/v1/health/mentions/metrics?prefix=
  GET /api/v1/health/mentions/days/:date/refs?user=    — what's available on a day
                                                          (workout/nutrition/weight presence)

backend/src/3_applications/agents/framework/BaseAgent.mjs
  run(input, context)
    context.attachments?: AttachmentRef[]
      ↳ rendered into the system prompt as a "## User Mentions" preamble
        before delegating to the model

backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
  buildAttachmentsPreamble(attachments)
    Produces a structured Markdown block like:
      ## User Mentions
      The user's message refers to:
      - `@last_30d` → period (rolling): from 2026-04-06 to 2026-05-05
      - `@'2017-cut'` → period (named, declared): from 2017-01-15 to 2017-04-30
      - `@2026-05-04` → day reference
```

### HealthApp integration

```jsx
// frontend/src/Apps/HealthApp.jsx — minimal change
import CoachChat from '../modules/Health/CoachChat';

// Existing dashboard logic preserved. Add a tab/view for Coach.
const VIEWS = ['hub', 'detail', 'coach'];

// In render: when view === 'coach', render <CoachChat />
```

A persistent tab strip at the top of HealthApp gives "Hub | Coach | Detail" navigation. The chat lives full-height under "Coach". Mantine's `Tabs` component handles the navigation.

---

## Mention vocabulary (v1)

The autocomplete dropdown groups suggestions by category. Each group has a distinct icon + color so the user can scan quickly.

| Category | Trigger pattern | Examples | Backed by |
|---|---|---|---|
| **Period** (rolling/calendar/named) | `@period:` or bare `@` | `@last_30d`, `@2024-Q3`, `@'2017-cut'` | `list_periods` from Plan 4 + standard rolling/calendar vocab |
| **Day** | `@day:` or `@2026-` | `@2026-05-04` | recent-days suggestions API; date-picker fallback |
| **Workout** | `@workout:` | `@workout:2026-05-04` | recent-days API filtered to days with workouts |
| **Nutrition log** | `@nutrition:` | `@nutrition:2026-05-04` | recent-days API filtered to days with nutrition |
| **Weight reading** | `@weight:` | `@weight:2026-05-04` | recent-days API filtered to days with weight |
| **Metric snapshot** | `@metric:` | `@metric:weight_lbs:last_30d` | metric registry + period vocab |

Bare `@` opens an unfiltered dropdown showing all categories (top-level mention prefixes). The user can either:
- Pick a category prefix and continue typing within it, OR
- Start typing the value directly — the suggestion engine searches across all categories simultaneously and scopes to the most relevant.

### Attachment payload shape

What the runtime adapter sends to the agent:

```typescript
type AttachmentRef =
  | { type: 'period';          value: PeriodInput;          label: string }   // see PeriodResolver
  | { type: 'day';             date: string;                label: string }   // 'YYYY-MM-DD'
  | { type: 'workout';         date: string;                label: string }
  | { type: 'nutrition';       date: string;                label: string }
  | { type: 'weight';          date: string;                label: string }
  | { type: 'metric_snapshot'; metric: string;
      period: PeriodInput;     label: string };

// PeriodInput is the same polymorphic input PeriodResolver accepts.
```

Each attachment includes a human-readable `label` (the chip text, e.g. "Last 30 days" or "2017 Cut") so the agent's preamble can reference both the structured form and the natural-language label.

---

## Backend: agent attachment handling

`BaseAgent.run(input, context)` already accepts an arbitrary `context` object. We formalize the `attachments` field:

```javascript
// backend/src/3_applications/agents/framework/BaseAgent.mjs
async run(input, context = {}) {
  const attachments = Array.isArray(context.attachments) ? context.attachments : [];
  const augmentedSystemPrompt = attachments.length
    ? `${this.getSystemPrompt(context.userId)}\n\n${this.formatAttachments(attachments)}`
    : this.getSystemPrompt(context.userId);
  // ...rest of existing run flow with augmentedSystemPrompt
}

formatAttachments(attachments) {
  // Override-able per agent. Default rendering is generic; HealthCoachAgent
  // provides a richer one that resolves periods to absolute dates inline.
  return [
    '## User Mentions',
    'The user\'s message refers to the following items. Use your tools to fetch ',
    'data when relevant.',
    '',
    ...attachments.map(a => `- ${this.formatAttachment(a)}`),
  ].join('\n');
}
```

`HealthCoachAgent.formatAttachment` overrides:
- For `{ type: 'period', value }`, calls `this.deps.periodResolver.resolve(value, { userId })` and includes the resolved `from..to` so the model doesn't have to call its own tools just to learn what dates "last_30d" means.
- For `{ type: 'day' | 'workout' | 'nutrition' | 'weight' }`, renders the date and tells the model which tool to call to look it up if it cares (`get_health_summary`, `query_historical_workouts`, etc.).
- For `{ type: 'metric_snapshot' }`, resolves the period AND tells the model `aggregate_metric` is the right tool.

This keeps the agent in control of WHEN to fetch data while giving it a clear handle on WHAT the user is asking about.

---

## Suggestion APIs

Five small read-only endpoints under `/api/v1/health/mentions/*`. Each returns `{ suggestions: [{ slug, label, value, group, icon }, ...] }`. Group is one of `period | day | workout | nutrition | weight | metric_snapshot`.

### `GET /api/v1/health/mentions/periods?prefix=&user=`
Combines:
- Rolling vocabulary (last_7d, last_30d, ..., all_time, prev_30d, ...) — always included, filtered by prefix
- Calendar vocabulary (this_year, this_month, this_quarter, last_quarter, ...) — always included
- Named periods from `list_periods` — declared/remembered/deduced

Filter by `prefix` substring match against label (case-insensitive).

### `GET /api/v1/health/mentions/recent-days?user=&days=30`
Returns the last `days` (default 30) days as suggestions. For each day, a flag indicates whether weight/nutrition/workout data exists (helps the UI render a hint like `2026-05-04 · 1 workout · 2100 kcal · 197.5 lbs`).

### `GET /api/v1/health/mentions/metrics?prefix=`
Returns the 11 registered metrics from `MetricRegistry.list()`. Static; cacheable indefinitely.

### `GET /api/v1/health/mentions/days/:date/refs?user=`
For a specific date, returns which categories have data (`{ workout: true, nutrition: true, weight: false }`). Used by the chip renderer to show appropriate icons.

### `GET /api/v1/health/mentions/all?prefix=&user=`
Cross-category search for the bare `@` case. Calls all of the above internally and returns a flat ranked list, capped at 20 results.

---

## Runtime adapter

```javascript
// frontend/src/modules/Health/CoachChat/runtime.js
import { LocalRuntime } from '@assistant-ui/react';

export function makeHealthCoachRuntime({ userId }) {
  return new LocalRuntime({
    async onSendMessage({ message, attachments = [] }) {
      const refs = attachments
        .filter(a => a.type === 'health-mention')
        .map(a => a.payload);

      const res = await fetch('/api/v1/agents/health-coach/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: message.content,
          context: {
            userId,
            attachments: refs,
          },
        }),
      });

      if (!res.ok) throw new Error(`Agent error: ${res.status}`);
      const data = await res.json();
      return {
        role: 'assistant',
        content: data.output,
        // Optionally surface tool calls as collapsible details
        meta: { toolCalls: data.toolCalls },
      };
    },
  });
}
```

(The exact `LocalRuntime` API may differ slightly; the implementation plan will pin to the actual signature when we install the dep.)

---

## Tool-call surfacing

The agent already returns `toolCalls` in its response (per `agents.mjs`). Each tool call is `{ name, args, result }`. assistant-ui's tool-rendering primitives let us show these inline as collapsible details:

> *🔧 aggregate_metric* — `weight_lbs / last_30d / mean` → 197.4 lbs (covered 28/30 days)
> [▶ details]

This is opt-in: by default tool calls render as a compact collapsed row; the user clicks to expand. For coaching transparency this is high-value — the user sees what the agent looked up.

---

## Mantine ↔ assistant-ui styling reconciliation

assistant-ui ships its own Tailwind-based primitives. Two integration paths:

1. **CSS variable bridge** — set assistant-ui's CSS custom properties (e.g., `--aui-primary`, `--aui-bg`, etc.) to Mantine equivalents (`var(--mantine-color-blue-6)`, etc.) inside `CoachChat.scss`. Tested approach for adopting any Tailwind-CSS-vars library inside a Mantine app.

2. **Component override** — pass Tailwind classes via `className` props on assistant-ui's primitives, customizing piecewise.

We use **(1)** — minimal surface area, no per-component overrides needed.

---

## Data flow (end-to-end)

```
1. User types "How is my weight in @las" in the composer
2. assistant-ui mention behavior fires search('las', cursor)
3. periodSuggestions.js calls GET /api/v1/health/mentions/periods?prefix=las&user=kc
4. Returns: [{ slug:'last_7d',label:'Last 7 days',value:{rolling:'last_7d'},group:'period'},...]
5. Dropdown renders suggestions; user picks "last_30d"
6. Mention inserted as token; chip renders inline; attachment recorded
   in composer state as { type:'period', value:{rolling:'last_30d'}, label:'Last 30 days' }
7. User finishes typing "doing?" and submits
8. Runtime adapter receives { message: '...', attachments: [{ type:'period',...}] }
9. POST /api/v1/agents/health-coach/run with body
   { input: 'How is my weight in @last_30d doing?',
     context: { userId:'kc', attachments:[ {type:'period',value:{rolling:'last_30d'},label:'Last 30 days'} ] }
   }
10. BaseAgent.run() prepends a "## User Mentions" preamble naming the period
    and its absolute resolved bounds.
11. Agent runs; model decides to call aggregate_metric({metric:'weight_lbs',
    period:{rolling:'last_30d'}, statistic:'mean'}) and metric_trajectory
    for the trend.
12. Tool calls execute against the existing HealthAnalyticsService.
13. Response { output: '...markdown...', toolCalls: [...] } returned.
14. assistant-ui renders the message; tool calls appear as collapsed details.
```

---

## Error handling

| Failure | UX | Recovery |
|---|---|---|
| Suggestion API timeout/error | Composer keeps typing input; dropdown silently shows no suggestions | Manual entry still works (e.g., paste in `@2024-Q3`) |
| Agent run failure (5xx) | assistant-ui shows error message inline with retry button | Built-in retry; one click to resend |
| Network failure | Same as agent run failure | Built-in |
| Malformed attachment (e.g., unknown period) | Backend returns `{ output: 'I couldn\'t resolve "@xxx" — could you clarify?' }` from the agent | Conversational; user clarifies |
| Unauthorized (no Bearer token, future) | 401 from API | App-level redirect to auth (existing pattern) |

---

## Testing strategy

- **Component tests** (vitest + @testing-library/react): `<CoachChat />` renders with a mocked runtime; verifies thread + composer + a mock mention insertion → submission cycle.
- **Mention adapter tests**: mock the suggestion APIs, test that completion calls return correctly shaped attachment refs.
- **Runtime adapter tests**: mock fetch, verify the POST body shape includes attachments correctly.
- **Backend mention API tests**: integration tests for each endpoint (`/periods`, `/recent-days`, etc.) against fixture user data.
- **BaseAgent.formatAttachments test**: verify the prepended system-prompt block matches expected structure.
- **End-to-end (Playwright)**: type, mention, submit, receive — against the real backend with a deterministic fixture user.

---

## What this design does NOT include

To keep scope tight:

- **Streaming responses** — health-coach runs are one-shot. If the agent later supports streaming, assistant-ui already has streaming primitives we can light up by adopting `ExternalStoreRuntime` or a custom transport.
- **Multi-thread / conversation persistence** — v1 is single-thread, in-memory. Conversation history is lost on reload. Persistence is a follow-up using assistant-ui's history adapter or our own working-memory backend.
- **Voice input** — assistant-ui supports it; we don't enable it yet.
- **File / image attachments** — the spec's attachment system is structured-reference-only. No file uploads.
- **Mention vocabulary: notes, playbook sections** — defer. The 6 listed types cover the data the agent's analytical surface actually consumes.
- **Inline tool call rendering for currently-running tools** — health-coach is non-streaming, so all tool calls are complete by the time the response renders. No live progress UI needed.
- **Agent suggestions / proposed prompts** — we don't seed the chat with auto-generated questions. User-driven from the empty state.
- **Lifeplan-guide migration** — existing `Chat/` module continues to power that. Migration to assistant-ui is a separate project if/when desired.

---

## Open questions for the implementation plan

1. **assistant-ui version** — pin to the latest stable as of merge date. Verify the `LocalRuntime` API matches what we describe in the runtime section.
2. **Mantine `Tabs` vs custom navigation in HealthApp** — Tabs is straightforward; verify it doesn't conflict with HealthApp's existing view-state machine (`view: 'hub'|'detail'`).
3. **Suggestion API caching** — TTL-cached on the backend, or fresh each request? Initial proposal: TTL 60s for periods (named periods rarely change mid-session), 30s for recent days, indefinite for metrics.
4. **Attachment chip styling** — assistant-ui's default vs. custom Mantine-pill styling. Decide visually during impl.
5. **Empty-state UX** — what does CoachChat look like before any messages? Initial proposal: a heading "Hi — ask me about your data" + 3 suggested starter prompts (e.g., "How is my @last_30d?"). Refine in impl.

---

## Why this is the right shape

**The agent's analytical surface and the chat input share one vocabulary.** Mentions resolve to the same `PeriodInput`, the same metric names, the same date references the agent's tools already accept. The model never has to translate between user-speak and tool-speak — the user speaks the tools' native vocabulary directly.

**The library does the heavy UI lifting.** assistant-ui handles cursor-aware mention triggering, keyboard navigation, attachment composition, message rendering, retries, and markdown — all things we'd otherwise spend weeks rebuilding. We provide the data adapters; the library provides the experience.

**By-reference attachments scale.** The agent fetches data when it needs it; the client doesn't have to know what slice the agent will examine. A user can chain "Compare @last_30d to @'2017-cut' on @weight" without paying any data-fetch cost in the input — the agent does the work.
