# Health System Reference Docs — Design

**Date:** 2026-05-01
**Owner:** kc
**Output target:** `docs/reference/health/` (new directory)

---

## Purpose

Establish `docs/reference/health/` as the **endstate, capability-first reference** for the health subsystem of DaylightStation. The docs describe what the health system *is for* and *what it does* — not how it is currently built or maintained. They serve as the canonical target the running implementation will be brought up to match, and as the basis for ongoing gap analysis and development.

## Non-goals

- Not a code-walking reference. No class names, call graphs, or component-wiring diagrams in the body.
- Not a status report. The docs do not flag what is built vs. unbuilt.
- Not a replacement for point-in-time specs (`docs/superpowers/specs/`) or runbooks. Those continue to live where they live.
- Not a tutorial. Docs describe the system; they do not teach a reader how to operate or extend it.

## Audience

Two readers, in priority order:

1. **Future AI sessions and the project owner** doing gap analysis or planning new work. They need a clear picture of the *intended* system.
2. **Engineers** orienting before touching code. They want a stable conceptual map, with directory pointers for navigation.

## Reference style

- **Capability-first.** Every section answers "what does this do for the user?" before any technical claim.
- **Endstate / aspirational.** Present tense, declarative. The system *aggregates* — not "will aggregate" or "currently aggregates." Where the running implementation does not yet match, the docs still describe the target.
- **Implementation-light body.** No file paths or class names in narrative sections.
- **Footer of pointers.** Every doc ends with a `## Where it lives` section listing directory entry points, key API routes, and frontend module roots — never class names. The footer is the only part that needs updating when code moves.
- **Diagrams sparingly,** and only for value/data flow ("raw food log → daily summary → coaching snapshot"), never for component wiring.
- **Cross-doc shared concepts** (identity model, time scales, daily-vs-longitudinal) live in the architecture doc; other docs reference back rather than redefine.

## Doc set

Four documents in `docs/reference/health/`:

| File | Lens | Owns |
|---|---|---|
| `health-system-architecture.md` | "What is it?" | Purpose, scope, capabilities, boundaries, identity, time scales, glossary, cross-system relationships |
| `data-pipeline.md` | "What does it ingest and produce?" | Inputs, pipeline stages, daily/longitudinal aggregates, food catalog, guarantees, edge cases, consumers |
| `coaching-system.md` | "How does it speak to the user?" | Insight pipeline, pattern detection, status block, LLM commentary, triggers, delivery, constraints, failure modes |
| `health-app-frontend.md` | "What does the user see and do?" | Hub/detail layout, cards, interactions, states, charts, navigation, input modes |

## Per-doc outlines

### 1. `health-system-architecture.md`

- **Overview** — user-value: longitudinal health awareness + AI coaching for a household.
- **Scope & boundaries** — In scope: weight, nutrition, fitness sessions, goals, sleep (where applicable). Out of scope: real-time workout governance (see fitness reference).
- **Capabilities at a glance** — table summarizing what users can do.
- **Subsystems** — one paragraph each on data pipeline, coaching, frontend; pointers to deep-dive docs.
- **Identity model** — per-user, household-aware.
- **Time scales** — real-time / daily / longitudinal as foundational concept.
- **Data sources** — passive (scale, fitness sessions, integrations) vs. active (food logs, manual entries).
- **Cross-system relationships** — Fitness, Nutribot, Life, Telegram, Mastra.
- **Glossary** — core terms used across all four docs.
- **Where it lives** — directory entry points, API routes, frontend module root.

### 2. `data-pipeline.md`

- **Purpose** — turn raw, multi-source events into normalized longitudinal data the rest of the system can rely on.
- **Inputs** — food logs (Telegram + web), weight measurements, fitness sessions, third-party integrations, manual annotations.
- **Pipeline stages** — ingest → normalize → daily aggregate → longitudinal aggregate → expose.
- **Daily summaries** — shape and meaning: calories, macros, weight, session count, goal progress.
- **Longitudinal aggregations** — sparkline series, ranges, statistical rollups.
- **Food catalog** — frequent-item derivation feeding quick-add.
- **Guarantees** — idempotency, late-arrival reconciliation, per-user isolation, deterministic-given-inputs, immutable history.
- **Edge cases** — cross-day logs, revisions, deletions, missing days, partial data, timezone handling.
- **Consumers** — HealthApp, coaching system, daily Telegram report, fitness coach panel.
- **Where it lives** — directory entry points, datastore locations, API routes serving aggregates.

### 3. `coaching-system.md`

- **Purpose** — turn aggregated data into timely, actionable user-facing reflection.
- **Insight pipeline** — pattern detection → snapshot → status block → LLM commentary → delivery.
- **Pattern detection** — trends, plateaus, breaks, comparisons, goal-progress signals.
- **Status block** — the deterministic, factual layer the LLM cannot rewrite.
- **LLM commentary** — Mastra agent, persona, tone constraints, capabilities and prohibitions.
- **Triggers** — post-daily-report, end-of-day, on-demand (`/coach`).
- **Delivery** — Telegram as primary surface; dashboard renders the same content.
- **Time and budget awareness** — remaining-budget framing late in the day; no piling-on after the day's target is met.
- **Hard constraints** — never invent numbers; always anchor on real data; comparison-driven framing.
- **Failure modes** — LLM unavailable, sparse data, partial day; graceful degradation rules.
- **Where it lives** — coaching application directory, agent directory, prompts, delivery adapters.

### 4. `health-app-frontend.md`

- **Purpose** — at-a-glance daily check-in plus drill-down history.
- **Layout** — Hub of summary cards → tap → Detail view.
- **Hub cards** — Weight, Nutrition, Sessions, Recency, Goals: summary semantics for each.
- **Detail views** — per-card deep dives with charts and history.
- **Inline interactions** — food logging from card, accept/discard AI parse, quick-add chips, goal edits.
- **States** — empty, loading, error, fresh, stale.
- **Charts** — multi-axis history, sparklines, time-range controls.
- **Navigation** — entry points (Life view, direct route), link to Telegram bot, return paths.
- **Accessibility & input modes** — touch, keyboard, gamepad.
- **Where it lives** — frontend module root, supporting hooks, asset locations.

## Cross-doc conventions

- **Tone & tense.** Present tense. Declarative. No hedging.
- **No "currently".** No "as of today". No "in flight". The system does what the docs say it does.
- **No status callouts.** The docs are the contract for completion; gap analysis happens externally.
- **Glossary owned by architecture doc.** Other docs link back rather than redefine. If a term needs definition and it isn't in the glossary, add it there rather than locally.
- **Footer format.** Each doc ends with `## Where it lives`. Each entry is a directory or route, never a class name. Allowed entries: backend directory paths, API routes, frontend module roots, persistence/datastore directories, prompt/template directories.
- **Diagrams.** Optional. ASCII or mermaid. Always show value/data flow, never component wiring.

## Acceptance criteria

The doc set is complete when:

1. All four files exist at `docs/reference/health/<filename>.md`.
2. Each file follows the per-doc outline above.
3. No body section names a class, file, or function. (Footer-only.)
4. No body section uses "currently", "as of today", "in flight", "TODO", "WIP", or status hedging.
5. Each file has a `## Where it lives` footer with directory- or route-level pointers only.
6. Shared concepts (identity, time scales) are defined exactly once, in the architecture doc, and referenced from the others.
7. The architecture doc's glossary covers every term used across the four docs that a new reader would need to look up.
8. The doc set, read top-to-bottom in the order listed, leaves the reader with a complete mental model of the health system's *intended* behavior.

## Out of scope for this work

- Updating or auditing the implementation to match the docs. That is the *gap analysis* phase that follows.
- Writing migration plans for existing point-in-time specs in `docs/superpowers/`, `docs/_wip/`, `docs/plans/`, `docs/roadmap/`. Those stay where they are.
- Producing reference docs for adjacent systems (Fitness, Nutribot as a Telegram surface, Life). The Nutribot Telegram bot is referenced from these docs as a data source / delivery surface, not documented in full here.

## Open questions

None at spec-approval time. Resolved during brainstorming:
- Doc set granularity: 4 broad docs (chosen).
- Abstraction level: capability-first body + `Where it lives` footer (Option B).
- Steady-state vs. status-of-today: endstate / aspirational; reference is the contract for completion.
