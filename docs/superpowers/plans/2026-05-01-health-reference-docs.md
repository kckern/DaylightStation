# Health Reference Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the four-document endstate reference set at `docs/reference/health/`, each describing what the health system *is for* and *what it does* — capability-first, present-tense, aspirational, with a directory-pointer footer.

**Architecture:** One file per task; the architecture doc is written first because it owns the shared glossary and concept definitions the others reference back to. A final cross-doc consistency pass verifies glossary coverage, term consistency, and footer compliance before merge.

**Tech Stack:** Markdown only. No code changes.

**Spec:** `docs/superpowers/specs/2026-05-01-health-reference-docs-design.md`

---

## Source-of-Truth Reference

This is research material the writer reads to build a complete mental model of what the system *does*. The body of the docs must NOT cite these files — they exist to inform the writer, not to anchor the docs.

**Common (read for every doc):**
- The spec: `docs/superpowers/specs/2026-05-01-health-reference-docs-design.md`
- Existing reference style examples: `docs/reference/fitness/fitness-system-architecture.md`, `docs/reference/life/life-domain-architecture.md`

**Architecture-doc sources:**
- `backend/src/2_domains/health/index.mjs`, `backend/src/2_domains/nutrition/index.mjs` (boundary check)
- `backend/src/3_applications/health/`, `backend/src/3_applications/coaching/`, `backend/src/3_applications/agents/health-coach/`, `backend/src/3_applications/nutribot/index.mjs` (capability survey)
- `frontend/src/modules/Health/HealthHub.jsx`, `frontend/src/modules/Health/HealthDetail.jsx` (frontend boundary)
- `data/household/config/integrations.yml` (cross-system relationships) — read via `sudo docker exec daylight-station sh -c 'cat data/household/config/integrations.yml'`

**Data-pipeline-doc sources:**
- `backend/src/3_applications/health/AggregateHealthUseCase.mjs`
- `backend/src/3_applications/health/HealthDashboardUseCase.mjs`
- `backend/src/3_applications/health/LongitudinalAggregationService.mjs`
- `backend/src/3_applications/health/FoodCatalogService.mjs`
- `backend/src/3_applications/health/ReconciliationProcessor.mjs`
- `backend/src/3_applications/health/ports/`
- `backend/src/2_domains/health/entities/HealthMetric.mjs`, `WorkoutEntry.mjs`, `FoodCatalogEntry.mjs`
- `backend/src/2_domains/nutrition/entities/NutriLog.mjs`, `FoodItem.mjs`
- `backend/src/4_api/v1/routers/health.mjs`, `health-dashboard.mjs`, `nutrition.mjs`
- Specs/audits: `docs/superpowers/specs/2026-04-03-health-dashboard-api-design.md`, `docs/_wip/plans/2026-01-25-health-api-redesign.md`, `docs/_wip/audits/2026-03-27-nutribot-coaching-data-audit.md`

**Coaching-doc sources:**
- `backend/src/3_applications/coaching/CoachingOrchestrator.mjs`, `CoachingMessageBuilder.mjs`, `CoachingCommentaryService.mjs`, `patterns.mjs`, `snapshots.mjs`
- `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`, `prompts/`, `schemas/`, `tools/`, `assignments/`
- Specs/plans: `docs/superpowers/specs/2026-04-07-coaching-redesign-design.md`, `docs/superpowers/specs/2026-03-25-nutribot-coaching-redesign.md`, `docs/superpowers/plans/2026-04-07-coaching-redesign.md`, `docs/roadmap/2026-02-02-health-coach-design.md`

**Frontend-doc sources:**
- `frontend/src/modules/Health/HealthHub.jsx`, `HealthDetail.jsx`, `cards/`, `detail/`, `Nutrition.jsx`, `Weight.jsx`, `NutritionDay.jsx`
- Specs/plans: `docs/superpowers/specs/2026-04-03-health-frontend-design.md`, `docs/superpowers/plans/2026-04-03-health-frontend.md`

---

## Acceptance Reminders (apply to every task)

The body of every doc must:

- Be in present tense, declarative ("the system aggregates", not "will" or "currently").
- Contain **no** class names, file paths, or function names. (Footer-only.)
- Contain **no** "currently", "as of today", "in flight", "TODO", "WIP", or status hedging.
- End with a `## Where it lives` section listing only directory paths, API routes, and frontend module roots — never class names.
- Reference shared concepts (identity, time scales) by linking back to `health-system-architecture.md` rather than redefining them.

If a doc fails any of these checks, fix before committing.

---

## Task 1: Create directory and write `health-system-architecture.md`

**Files:**
- Create: `docs/reference/health/health-system-architecture.md`

**This doc owns the shared glossary and the time-scales concept. The other three docs link back here, so it must be written first.**

- [ ] **Step 1: Create the target directory**

```bash
mkdir -p docs/reference/health
```

- [ ] **Step 2: Read the spec**

Read `docs/superpowers/specs/2026-05-01-health-reference-docs-design.md` end to end. Internalize the per-doc outline for `health-system-architecture.md` (Section 1 of the spec) and the cross-doc conventions.

- [ ] **Step 3: Read style references**

Read `docs/reference/fitness/fitness-system-architecture.md` and `docs/reference/life/life-domain-architecture.md` to calibrate length, voice, and section depth — but consciously ignore their implementation-walking style; the spec mandates capability-first.

- [ ] **Step 4: Survey health source material**

Read the architecture-doc sources listed in the Source-of-Truth Reference above. Build a mental map of: what users can do, what subsystems exist, what flows between them, what's in scope vs. out of scope.

- [ ] **Step 5: Draft `health-system-architecture.md`**

Write the file with these sections, in order:

1. **Overview** — opening paragraph: what the health system is for at a household scale (longitudinal awareness + AI coaching). Link out to the three deep-dive docs.
2. **Scope & boundaries** — bullet list of in-scope (weight, nutrition, fitness sessions, goals, sleep where applicable) and out-of-scope (real-time workout governance — see fitness reference).
3. **Capabilities at a glance** — markdown table: "User can…" | "Surface" | "Data behind it" — covering all major capabilities.
4. **Subsystems** — one paragraph each: Data Pipeline, Coaching System, Health App. Each paragraph names the subsystem, says what it does in one sentence, and links to the deep-dive doc (`data-pipeline.md`, `coaching-system.md`, `health-app-frontend.md`).
5. **Identity model** — per-user vs. household-wide data, how the system addresses individuals.
6. **Time scales** — the foundational concept: real-time / daily / longitudinal. Define each.
7. **Data sources** — table of source × type (passive sensor, manual entry, integration) × what it produces.
8. **Cross-system relationships** — short paragraphs on Fitness, Nutribot (Telegram surface), Life, Telegram (delivery), LLM provider.
9. **Glossary** — alphabetical definitions of every term used across all four docs that a new reader would need to look up. Examples to include: aggregate, daily summary, food catalog, goal, household, longitudinal, macro, pattern, reconciliation, session, snapshot, status block.
10. **Where it lives** — directory entry points (`backend/src/2_domains/health/`, `backend/src/2_domains/nutrition/`, `backend/src/3_applications/health/`, `backend/src/3_applications/coaching/`, `backend/src/3_applications/agents/health-coach/`, `frontend/src/modules/Health/`); top-level API routes (`/api/v1/health/*`, `/api/v1/health-dashboard/*`, `/api/v1/nutrition/*`); supporting data (`data/household/config/integrations.yml`).

Aim for 300–600 lines. Use markdown headings, tables, bullet lists. One small value-flow diagram (ASCII or mermaid) is allowed if it clarifies how the subsystems compose.

- [ ] **Step 6: Self-check against acceptance criteria**

Grep the file for forbidden tokens:

```bash
grep -nE 'currently|as of today|in flight|TODO|WIP|will be|going to' docs/reference/health/health-system-architecture.md
```

Expected: no matches.

```bash
grep -nE '\.mjs|\.jsx|class |function |const ' docs/reference/health/health-system-architecture.md
```

Expected: matches ONLY inside the `## Where it lives` footer (paths to directories may include `.mjs`-free directory names, but if any extension shows up, it must be in the footer).

Verify the doc has all 10 sections. Verify the glossary covers every term the reader of the other three docs will need.

- [ ] **Step 7: Commit**

```bash
git add docs/reference/health/health-system-architecture.md docs/superpowers/specs/2026-05-01-health-reference-docs-design.md docs/superpowers/plans/2026-05-01-health-reference-docs.md
git commit -m "$(cat <<'EOF'
docs(health): architecture reference with glossary and subsystem map

Capability-first endstate doc; describes scope, identity, time scales,
data sources, cross-system relationships. Owns the shared glossary
the other three health reference docs link back to.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Write `data-pipeline.md`

**Files:**
- Create: `docs/reference/health/data-pipeline.md`

- [ ] **Step 1: Re-read the spec section for this doc**

Re-read the per-doc outline for `data-pipeline.md` (Section 2 of the spec).

- [ ] **Step 2: Survey data-pipeline source material**

Read the data-pipeline-doc sources listed above. Build a mental model of: how raw events arrive, how they're normalized, what daily summaries contain, how longitudinal rollups are produced, what guarantees the system makes, and how late arrivals / revisions / deletions are handled.

- [ ] **Step 3: Draft `data-pipeline.md`**

Write the file with these sections:

1. **Purpose** — one paragraph: turn raw, multi-source events into normalized longitudinal data the rest of the system can rely on.
2. **Inputs** — table or list: food logs (Telegram + web), weight measurements, fitness sessions, third-party integrations, manual annotations. For each: *what it represents* (semantically), not *how it's structured*.
3. **Pipeline stages** — narrative walk: ingest → normalize → daily aggregate → longitudinal aggregate → expose. One paragraph per stage describing what it does and what guarantees it provides. Optional small ASCII/mermaid value-flow diagram.
4. **Daily summaries** — what a day's summary contains and what each field means: total calories, macro breakdowns, weight, session count, goal progress.
5. **Longitudinal aggregations** — sparkline series (recent rolling windows), statistical rollups (averages, ranges over weeks/months), date-range queries.
6. **Food catalog** — frequent-item derivation: what makes an item appear in the catalog, how the catalog is consumed (quick-add).
7. **Guarantees** — bulleted, definitive: idempotency, late-arrival reconciliation, per-user isolation, deterministic-given-inputs, immutable history.
8. **Edge cases** — sub-bullets per case: cross-day logs, revisions, deletions, missing days, partial data, timezone handling. State the system's behavior, not the implementation.
9. **Consumers** — who reads from the pipeline and what they consume: HealthApp, coaching system, daily Telegram report, fitness coach panel. Cross-link to the relevant docs.
10. **Where it lives** — `backend/src/3_applications/health/` (pipeline orchestration), `backend/src/2_domains/health/`, `backend/src/2_domains/nutrition/` (entities), persistence locations, API routes (`/api/v1/health/*`, `/api/v1/health-dashboard/*`, `/api/v1/nutrition/*`).

Aim for 300–500 lines.

- [ ] **Step 4: Self-check**

```bash
grep -nE 'currently|as of today|in flight|TODO|WIP|will be|going to' docs/reference/health/data-pipeline.md
```

Expected: no matches.

```bash
grep -nE 'AggregateHealthUseCase|LongitudinalAggregationService|FoodCatalogService|ReconciliationProcessor|HealthMetric|NutriLog' docs/reference/health/data-pipeline.md
```

Expected: matches ONLY in the `## Where it lives` footer (or zero matches; class names are forbidden — directories are allowed).

Verify shared concepts (identity, time scales, daily summary as a term) link back to `health-system-architecture.md` rather than redefine.

- [ ] **Step 5: Commit**

```bash
git add docs/reference/health/data-pipeline.md
git commit -m "$(cat <<'EOF'
docs(health): data pipeline reference

Capability-first endstate doc; describes inputs, pipeline stages,
daily and longitudinal aggregates, food catalog derivation,
guarantees, edge cases, and downstream consumers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write `coaching-system.md`

**Files:**
- Create: `docs/reference/health/coaching-system.md`

- [ ] **Step 1: Re-read spec section**

Re-read the per-doc outline for `coaching-system.md` (Section 3 of the spec).

- [ ] **Step 2: Survey coaching source material**

Read the coaching-doc sources listed above, especially `2026-04-07-coaching-redesign-design.md` — that document captures the *intended* coaching architecture and is the closest thing to the steady-state design. Where it disagrees with the running code, the spec wins (this is endstate documentation).

- [ ] **Step 3: Draft `coaching-system.md`**

Write the file with these sections:

1. **Purpose** — one paragraph: turn aggregated data into timely, actionable user-facing reflection.
2. **Insight pipeline** — narrative walk: pattern detection → snapshot → status block → LLM commentary → delivery. One paragraph per stage. Optional small value-flow diagram.
3. **Pattern detection** — what kinds of patterns the system detects: trends (calorie trajectory week-over-week), plateaus (weight stalled), breaks (logging streak ended), comparisons (today vs. last week), goal-progress signals. State *what is detected*, not *how*.
4. **Status block** — the deterministic, factual layer the LLM cannot rewrite. What appears in it (raw numbers, comparisons, goal progress); the contract that LLM commentary cites it but does not contradict it.
5. **LLM commentary** — agent persona, tone constraints (concise, encouraging, never preachy), what it may say (interpretation, encouragement, framing) and may not say (invented numbers, medical advice, contradicting the status block).
6. **Triggers** — when the coach speaks: post-daily-report (after the daily Telegram summary), end-of-day (if logging incomplete), on-demand (`/coach` slash command, dashboard refresh).
7. **Delivery** — Telegram as primary surface; dashboard renders the same content; messages are user-scoped.
8. **Time and budget awareness** — remaining-budget framing late in the day; no piling-on after the day's calorie target is met; rounded numbers, not decimals.
9. **Hard constraints** — definitive bulleted list: never invent numbers; always anchor on real data; comparison-driven framing; rounded numbers; no medical advice; respect quiet hours.
10. **Failure modes** — graceful degradation when LLM is unavailable, data is sparse, or the day is partial: fall back to the status block alone; never block the daily report.
11. **Where it lives** — `backend/src/3_applications/coaching/` (orchestration), `backend/src/3_applications/agents/health-coach/` (LLM agent, prompts, tools, assignments), delivery adapters (Telegram, dashboard).

Aim for 300–500 lines.

- [ ] **Step 4: Self-check**

```bash
grep -nE 'currently|as of today|in flight|TODO|WIP|will be|going to' docs/reference/health/coaching-system.md
```

Expected: no matches.

```bash
grep -nE 'CoachingOrchestrator|CoachingCommentaryService|CoachingMessageBuilder|HealthCoachAgent|patterns\.mjs|snapshots\.mjs' docs/reference/health/coaching-system.md
```

Expected: matches ONLY in the footer (or zero — directory references are preferred).

Verify the doc reads like a contract for what the coach does, not a description of what's been built.

- [ ] **Step 5: Commit**

```bash
git add docs/reference/health/coaching-system.md
git commit -m "$(cat <<'EOF'
docs(health): coaching system reference

Capability-first endstate doc; describes the insight pipeline (pattern
detection, status block, LLM commentary), triggers, delivery, time
and budget awareness, hard constraints, and failure modes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write `health-app-frontend.md`

**Files:**
- Create: `docs/reference/health/health-app-frontend.md`

- [ ] **Step 1: Re-read spec section**

Re-read the per-doc outline for `health-app-frontend.md` (Section 4 of the spec).

- [ ] **Step 2: Survey frontend source material**

Read the frontend-doc sources listed above, especially `2026-04-03-health-frontend-design.md` for the intended UX.

- [ ] **Step 3: Draft `health-app-frontend.md`**

Write the file with these sections:

1. **Purpose** — at-a-glance daily check-in plus drill-down history.
2. **Layout** — Hub of summary cards → tap a card → Detail view. Describe the navigation feel.
3. **Hub cards** — sub-section per card with summary semantics: Weight (latest reading + trend arrow), Nutrition (today's calories vs. budget), Sessions (recent activity count), Recency (last logged times), Goals (goal progress badges).
4. **Detail views** — sub-section per detail screen: what charts and history each shows. Per-card drill-downs.
5. **Inline interactions** — food logging from the Nutrition card (text input + AI parse + accept/discard), quick-add chips for frequent items, goal edits, weight entry.
6. **States** — empty (no data ever), loading, error, fresh data, stale data. Define each visually and behaviorally.
7. **Charts** — multi-axis history (weight + calories + workouts on shared time axis), sparklines on hub cards, time-range controls (week / month / year).
8. **Navigation** — entry points (direct route, Life view tile), link out to Telegram bot for richer logging, return paths from detail views.
9. **Accessibility & input modes** — touch (large tap targets), keyboard (arrow + enter navigation), gamepad (D-pad + buttons via Gamepad API).
10. **Where it lives** — `frontend/src/modules/Health/` (hub, detail, cards), supporting hooks under `frontend/src/hooks/`, asset locations.

Aim for 200–400 lines.

- [ ] **Step 4: Self-check**

```bash
grep -nE 'currently|as of today|in flight|TODO|WIP|will be|going to' docs/reference/health/health-app-frontend.md
```

Expected: no matches.

```bash
grep -nE '\.jsx|HealthHub|HealthDetail|NutritionCard|HistoryChart' docs/reference/health/health-app-frontend.md
```

Expected: matches ONLY in the footer (or zero).

- [ ] **Step 5: Commit**

```bash
git add docs/reference/health/health-app-frontend.md
git commit -m "$(cat <<'EOF'
docs(health): frontend health app reference

Capability-first endstate doc; describes hub/detail layout, cards,
detail views, inline interactions, states, charts, navigation,
and input modes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Cross-doc consistency pass

**Files:**
- Modify (potentially all four): `docs/reference/health/*.md`

- [ ] **Step 1: Term-coverage check**

For each capitalized or italicized term used in `data-pipeline.md`, `coaching-system.md`, `health-app-frontend.md` that a new reader would need to look up, verify it appears in the glossary in `health-system-architecture.md`. Add missing terms.

- [ ] **Step 2: Term-consistency check**

For each shared term (e.g., "daily summary", "longitudinal aggregate", "status block", "snapshot", "household"), grep across the four files and verify it is used identically:

```bash
grep -nE 'daily summary|longitudinal|status block|snapshot|household' docs/reference/health/*.md
```

Resolve any inconsistencies (e.g., "daily aggregate" vs. "daily summary" — pick one).

- [ ] **Step 3: Cross-link check**

Verify that `data-pipeline.md`, `coaching-system.md`, and `health-app-frontend.md` link back to `health-system-architecture.md` for shared concepts rather than redefining them. Verify forward links from `health-system-architecture.md`'s "Subsystems" section work.

- [ ] **Step 4: Forbidden-token sweep across the set**

```bash
grep -rnE 'currently|as of today|in flight|TODO|WIP|will be|going to' docs/reference/health/
```

Expected: no matches.

- [ ] **Step 5: Footer compliance**

Verify each of the four files ends with a `## Where it lives` section. Verify each entry is a directory path, API route, or frontend module root — not a class or function name.

```bash
for f in docs/reference/health/*.md; do
  echo "=== $f ==="
  awk '/^## Where it lives/,EOF' "$f" | head -30
done
```

Inspect output. Fix any class/function names.

- [ ] **Step 6: Acceptance-criteria walk-through**

Open `docs/superpowers/specs/2026-05-01-health-reference-docs-design.md`, scroll to "Acceptance criteria" (lines ~111–122), and confirm each numbered item is satisfied. List any failure and fix it.

- [ ] **Step 7: Commit consistency fixes (if any)**

Only if Steps 1–6 produced edits:

```bash
git add docs/reference/health/
git commit -m "$(cat <<'EOF'
docs(health): cross-doc consistency pass

Term coverage in glossary, consistent terminology across the four
reference docs, footer compliance, and forbidden-token sweep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no edits were needed, skip this commit.

---

## Self-Review

Spec coverage check:

- Spec §"Reference style" → enforced in every task's self-check step (forbidden tokens, footer-only class names).
- Spec §"Doc set" (4 files) → Tasks 1–4, one per file.
- Spec §"Per-doc outlines" → each task lists the exact sections from the spec.
- Spec §"Cross-doc conventions" → enforced in per-task self-checks and again in Task 5.
- Spec §"Acceptance criteria" → walked explicitly in Task 5 Step 6.
- Spec §"Out of scope" — not implemented (that's the point: out of scope). No task needed.

Placeholder scan: no "TBD" / "TODO" / "implement later" in plan steps; every step has the concrete action and (where applicable) the exact command.

Type consistency: not applicable — no code types in this plan. Doc filenames are consistent across tasks (`health-system-architecture.md`, `data-pipeline.md`, `coaching-system.md`, `health-app-frontend.md`).
