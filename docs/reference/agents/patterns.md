# Agent Patterns

Cross-cutting patterns that apply to any agent reasoning over domain data. Each pattern names a recurring problem and the structural solution. Adopt them when the problem fits; not every agent needs every pattern.

## Pattern: Domain Event Adapter

**Problem.** An agent reasons across multiple domain services (workouts, meals, weigh-ins, sleep, ...). Each service has its own list/detail/aggregate API. Without a unifying surface, each domain becomes a separate tool with its own argument schema, and the agent has to learn a vocabulary per domain.

**Solution.** Each domain implements a small adapter interface with three primitives: `list(period, filter)`, `detail(id)`, `summary(period)`. The agent gets one query surface keyed on `kind` ('workout', 'meal', 'weigh_in', ...) that dispatches to the right adapter. Each adapter returns a consistent event row shape:

```
{
  kind:           'workout' | 'meal' | 'weigh_in',
  id:             string,
  timestamp:      ISO,
  date:           YYYY-MM-DD,
  label:          human-readable summary,
  scalars:        { domain metric snapshot },
  domain_extras:  { fields specific to this kind },
  vs_baseline?:   { ... },         // attached by the Baseline Annotation pattern
}
```

`detail(id)` returns the rich domain object (full record from the source service) plus structured coach-friendly summaries (e.g., extracted memos from a workout, items breakdown from a meal). The agent describes the richness without parsing the raw shape.

**When to use.** When two or more domains carry events the agent reasons about. Don't introduce the pattern for a single domain — direct service wrappers are simpler.

## Pattern: User Model in Prompt Context

**Problem.** Without a model of the user, an agent invents baselines ("typically 3-4 strength sessions per week") and parrots numbers without significance ("you ran 28 minutes" with no sense of whether that's normal). It feels like a decision tree.

**Solution.** Compose a small markdown user model — profile, rolling baselines per domain, and recent context — and prepend it to the system prompt every turn. The agent reasons against this model rather than inventing.

The model has three layers:
- **Profile** — durable user attributes (age, sex, height, weight, training plan).
- **Baselines** — rolling typical patterns per domain (workouts/week by kind, typical run profile, calories per day average, weight trim mean and slope). Computed daily from history; cached.
- **Recent context** — condensed last-7-days summary if relevant.

The agent has explicit tools to re-fetch any of these on demand, but the markdown injection ensures the model is always present without an extra round-trip.

**When to use.** Whenever an agent needs to reason about whether something is significant for *this* user, not in the abstract.

## Pattern: Baseline Annotation on Tool Results

**Problem.** Agents are bad at remembering to compare. They list current numbers; they don't compute deltas. Even when a baseline is available in context, the agent forgets to use it.

**Solution.** Annotate tool result rows with comparisons against the user's baseline at retrieval time. Each event row carries `vs_baseline: { metric: { typical, delta, delta_pct } }`. The agent reads "typical: 148, delta: -12, delta_pct: -8" and narrates "12 bpm below typical" without doing the math.

Fold the annotation in the adapter, not in a downstream tool — the data is freshest at the source and the prompt token cost is paid once.

**When to use.** Anywhere the agent needs to reason about whether a value is high, low, normal, or anomalous. Especially valuable for time-series and event data.

## Pattern: Reasoning Rails

**Problem.** Even with rich data and a user model, agents drift into safe-but-useless responses: parroting back the user's question, listing facts side-by-side without computing the comparison, inventing comfortable-sounding baselines, asking clarifying questions when the answer is obvious.

**Solution.** Three explicit rails in the system prompt — each names a forbidden pattern with examples and the corrected behavior:

- **Citation rail.** Every numeric claim must trace to a tool result or fetched baseline. Forbid invented norms.
- **Validation rail.** When the user offers an interpretation of their data ("I took it easy"), test it against the data and either confirm with numbers or push back with numbers.
- **Comparison rail.** When comparison is asked or implied, always compute the delta. Don't list two values side-by-side.

Plus a default-windows rule (pick a default period; don't ask) and a don't-ask-back rule (run the query, present, offer to refine).

**When to use.** Whenever a coach-shaped agent needs to feel like it's *thinking*, not retrieving. The rails encode reasoning judgment that the model otherwise has to infer.

---

## Where these live in code

- Domain adapter interface: `backend/src/3_applications/agents/health-coach/services/EventAdapter.mjs`
- Concrete adapters: `backend/src/3_applications/agents/health-coach/services/adapters/`
- User model composition: `backend/src/3_applications/agents/health-coach/services/UserModelService.mjs`
- Personal baselines: `backend/src/3_applications/agents/health-coach/services/PersonalBaselineService.mjs`
- Reasoning rails: `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`

The health-coach is the reference implementation for all four patterns.
