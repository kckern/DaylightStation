# Agents Reference Docs Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Prerequisite:** This plan runs **after** `2026-05-07-health-coach-reflective-architecture.md` has landed. Doc updates should describe the *settled* architecture, not work-in-progress.

**Goal:** Update `docs/reference/agents/` to describe the cross-cutting patterns introduced by the reflective architecture (domain adapters, user model loading, baseline annotations, reasoning rails) so other agents (lifeplan-guide, future agents) can adopt them, and so newcomers understand the system as it actually works.

**Architecture:** The current `docs/reference/agents/` describes the framework (lifecycle, tools, memory, observability, HTTP, frontend). The reflective architecture introduces *agent-level patterns* that are reusable across agents. Add a new `patterns.md` for those, and cross-link from the existing files. Per memory rule [reference-docs-are-endstate-not-status](#), describe in present tense as the settled way things work — no class names in body, only a directory-pointer footer.

**Tech Stack:** Markdown only.

---

## Exit criteria

- `docs/reference/agents/patterns.md` exists and covers: domain adapters, user model, baseline annotations, reasoning rails.
- `architecture.md` cross-links to `patterns.md`.
- `extending.md` mentions the patterns where relevant.
- `README.md` lists `patterns.md`.
- `docs/docs-last-updated.txt` updated to current HEAD SHA.
- The patterns are described abstractly (no class names in body — `FitnessEventAdapter`, `PersonalBaselineService` etc. only appear in the footer pointer to `backend/src/3_applications/agents/health-coach/services/`).

---

## File structure

**New:**

```
docs/reference/agents/patterns.md
```

**Modified:**

```
docs/reference/agents/README.md          — add patterns.md to index
docs/reference/agents/architecture.md    — cross-link to patterns
docs/reference/agents/extending.md       — point to patterns from "if your agent needs..."
docs/docs-last-updated.txt               — re-stamp HEAD SHA
```

---

## Task 1: Audit what changed post-reflective-architecture

Fast pass over the existing docs to identify stale claims.

**Files (read only):**
- `docs/reference/agents/README.md`
- `docs/reference/agents/architecture.md`
- `docs/reference/agents/extending.md`

- [ ] **Step 1: Diff what's changed since the docs were last reviewed**

```bash
cd /opt/Code/DaylightStation && git diff $(cat docs/docs-last-updated.txt 2>/dev/null || echo HEAD~50)..HEAD -- backend/src/3_applications/agents/ | head -200
```

- [ ] **Step 2: Re-read the three docs and note any stale lines**

Write a short audit memo (no file output — just notes for Tasks 2-4):

- Items in `architecture.md` that no longer match the code (e.g., references to single-domain query patterns that are now multi-domain).
- Items in `extending.md` that don't yet mention domain adapters or user models.
- Items in `README.md` that should index the new `patterns.md`.

This is a thinking step. No commit.

---

## Task 2: Write `patterns.md` — domain adapters

The first cross-cutting pattern: when an agent needs to traverse multiple domain services uniformly, use the EventAdapter pattern.

**Files:**
- Create: `docs/reference/agents/patterns.md`

- [ ] **Step 1: Draft the file with the four patterns**

```markdown
# Agent Patterns

Cross-cutting patterns that apply to any agent reasoning over domain data. Each pattern names a recurring problem and the structural solution. Adopt them when the problem fits; not every agent needs every pattern.

## Pattern: Domain Event Adapter

**Problem.** An agent reasons across multiple domain services (workouts, meals, weigh-ins, sleep, ...). Each service has its own list/detail/aggregate API. Without a unifying surface, each domain becomes a separate tool with its own argument schema, and the agent has to learn a vocabulary per domain.

**Solution.** Each domain implements an `EventAdapter` interface with three methods: `list(period, filter)`, `detail(id)`, `summary(period)`. The agent gets one query surface keyed on `kind` ('workout', 'meal', 'weigh_in', ...) that dispatches to the right adapter. Each adapter returns a consistent event row shape:

```
{
  kind:           'workout' | 'meal' | 'weigh_in',
  id:             string,
  timestamp:      ISO,
  date:           YYYY-MM-DD,
  label:          human-readable summary,
  scalars:        { domain metric snapshot },
  domain_extras:  { fields specific to this kind },
  vs_baseline?:   { ... },         // attached by Baseline Annotation pattern
}
```

`detail(id)` returns the rich domain object (full record from the source service) plus structured coach-friendly summaries (e.g., extracted memos from a workout, items breakdown from a meal). The agent can describe the richness without parsing the raw shape.

**When to use.** When two or more domains carry events the agent reasons about. Don't introduce the pattern for a single domain — direct service wrappers are simpler.

## Pattern: User Model in Prompt Context

**Problem.** Without a model of the user, an agent invents baselines ("typically 3-4 strength sessions/week") and parrots numbers without significance ("you ran 28 minutes" with no sense of whether that's normal). It feels like a decision tree.

**Solution.** Compose a small markdown user model — profile, rolling baselines per domain, and recent context — and prepend it to the system prompt every turn. The agent reasons against this model rather than inventing.

The model has three layers:
- **Profile** — durable user attributes (age, sex, height, weight, training plan).
- **Baselines** — rolling typical patterns per domain (workouts/week by kind, typical run profile, calories/day average, weight trim mean and slope). Computed daily from history; cached.
- **Recent context** — condensed last-7-days summary if relevant.

The agent gets explicit tools to re-fetch any of these on demand, but the markdown injection ensures the model is always present without an extra round-trip.

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
```

- [ ] **Step 2: Commit**

```bash
cd /opt/Code/DaylightStation && git add docs/reference/agents/patterns.md
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
docs(agents): patterns — domain adapters, user model, baseline annotations, rails

Plan / Task 2. Cross-cutting patterns introduced by the reflective
architecture, written for adoption by other agents. Health-coach is
the reference implementation; the patterns live in
backend/src/3_applications/agents/health-coach/services/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Update `architecture.md` — cross-link to patterns

**Files:**
- Modify: `docs/reference/agents/architecture.md`

- [ ] **Step 1: Find the right insertion point**

```bash
cd /opt/Code/DaylightStation && grep -n "^## " docs/reference/agents/architecture.md
```

- [ ] **Step 2: Append a new section near the end (or insert before "Where it lives")**

```markdown
## Reasoning patterns

For agents that reason over domain data — comparing today to typical, narrating the significance of a number, traversing multiple domain services through one query surface — see [patterns.md](patterns.md). Four named patterns (Domain Event Adapter, User Model in Prompt Context, Baseline Annotation, Reasoning Rails) compose into the "reflective" agent shape. Each pattern names a recurring failure mode (decision-tree feel, invented baselines, missed comparisons) and the structural fix.

The patterns are framework-agnostic — they layer on top of the lifecycle, tools, memory, and HTTP described above.
```

- [ ] **Step 3: Verify and commit**

```bash
cd /opt/Code/DaylightStation && grep -q "patterns.md" docs/reference/agents/architecture.md && echo OK
cd /opt/Code/DaylightStation && git add docs/reference/agents/architecture.md
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
docs(agents): architecture — cross-link to reasoning patterns

Plan / Task 3. New section pointing readers to patterns.md after they
understand the framework lifecycle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update `extending.md` — when to reach for the patterns

**Files:**
- Modify: `docs/reference/agents/extending.md`

- [ ] **Step 1: Find the right insertion point**

```bash
cd /opt/Code/DaylightStation && grep -n "^## " docs/reference/agents/extending.md
```

- [ ] **Step 2: Add a "Patterns" section after the agent-class checklist**

```markdown
## Patterns

If your agent reasons over domain data, consider these patterns before designing tools from scratch — see [patterns.md](patterns.md):

- **Reasoning over multiple domains** (workouts + meals + weigh-ins, or notes + tasks + calendar): use the **Domain Event Adapter** pattern. Each domain implements list/detail/summary; the agent gets one query surface.
- **The agent needs to know what's typical for this user**: use the **User Model in Prompt Context** pattern. Compose profile + baselines + recent context into a markdown block prepended to the system prompt.
- **The agent should describe whether values are anomalous**: use the **Baseline Annotation** pattern. Fold `vs_baseline` into adapter rows so the agent reads "delta -12, delta_pct -8" instead of doing the math.
- **The agent drifts into parroting / inventing baselines / listing without comparing**: use **Reasoning Rails** in the system prompt — citation, validation, comparison, default windows, don't-ask-back.

Not every agent needs every pattern. A simple workflow agent that runs a fixed pipeline doesn't need a user model. Pick the patterns that fit the failure modes you're seeing.
```

- [ ] **Step 3: Verify and commit**

```bash
cd /opt/Code/DaylightStation && grep -q "Domain Event Adapter" docs/reference/agents/extending.md && echo OK
cd /opt/Code/DaylightStation && git add docs/reference/agents/extending.md
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
docs(agents): extending — when to reach for reasoning patterns

Plan / Task 4. New "Patterns" section listing the four reflective
patterns and when each fits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update README index + freshness marker

**Files:**
- Modify: `docs/reference/agents/README.md`
- Modify: `docs/docs-last-updated.txt`

- [ ] **Step 1: Update the "Where to read next" list in README**

Replace the existing "Where to read next" block with:

```markdown
## Where to read next

- **[Architecture](architecture.md)** — turn lifecycle, prompt composition, tool decorator chain, memory model, transcript format, HTTP wire formats, frontend chat surface.
- **[Patterns](patterns.md)** — reusable patterns for domain adapters, user models, baseline annotations, and reasoning rails. Read this if your agent needs to reason over domain data.
- **[Extending](extending.md)** — what's required to add a new agent. End-to-end checklist: agent class, tools, prompts, dependencies, registration, HTTP mount, optional frontend.
```

- [ ] **Step 2: Re-stamp the docs freshness marker**

```bash
cd /opt/Code/DaylightStation && git rev-parse HEAD > docs/docs-last-updated.txt
```

- [ ] **Step 3: Verify and commit**

```bash
cd /opt/Code/DaylightStation && grep -q "Patterns" docs/reference/agents/README.md && echo OK
cd /opt/Code/DaylightStation && git add docs/reference/agents/README.md docs/docs-last-updated.txt
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
docs(agents): README index includes patterns; freshness marker re-stamped

Plan / Task 5. Final wiring — docs/reference/agents/ now points to
patterns.md from the index, and docs-last-updated.txt is current.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

- [ ] `patterns.md` exists, covers all four patterns, no class names in body (only in the directory-pointer footer)
- [ ] Each pattern follows the same structure: Problem → Solution → When to use
- [ ] `architecture.md` cross-links to patterns.md
- [ ] `extending.md` lists when to reach for each pattern
- [ ] `README.md` indexes patterns.md
- [ ] `docs/docs-last-updated.txt` is the current HEAD SHA
- [ ] Present-tense / endstate writing throughout — no "we will" / "this proposes" / "as of YYYY-MM-DD"

---

## Notes for the implementer

- **Per memory rule [feedback_reference_docs_endstate.md]:** describe in present tense as if the architecture is settled. Do NOT include status updates, "this was added in plan X", changelog entries. The body is the *current state*. Only the footer points to where it lives.
- **No class names in the body.** `FitnessEventAdapter`, `UserModelService`, `PersonalBaselineService` are concrete implementations — they appear only in the "Where these live in code" footer of `patterns.md`. The body talks about *the pattern*, not the class.
- **Patterns are abstract.** Anyone reading `patterns.md` should be able to apply the pattern to a new domain (notes/tasks/calendar) without reading any code. If a pattern requires reading a specific class, the description is too coupled — abstract it more.
- **Don't pad.** Each pattern should be ~150 words tops. The README + extending.md additions should be ~80 words each. If you find yourself over budget, trim — denser is better.
