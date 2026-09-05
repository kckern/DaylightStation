# Nutrition auditor and shared runtime modernization

Approved implementation: align Mastra core 1.64.0, memory 1.28.2, libSQL 1.22.3,
Zod 4.5.4, and Node 22.23.2. Preserve existing agent interfaces while adding
validated structured results, schemas, cancellation, processors, managed runs,
human interaction records, and tracing/evaluation hooks.

The nutrition auditor reads historical records without a date cutoff, but its
automatic writes only affect today/yesterday in the user's timezone. Read-only
reasoning produces proposals; application policy checks evidence, versions,
ownership, grouping, manual overrides and the date boundary at commit time.
Numerical corrections require serving-basis evidence. No automatic food deletion,
new consumption, or confirmation of pending captures.

All repairs have durable before/after audit receipts. User-directed Undo may
restore older repairs when no later edit conflicts. Questions are shared between
Health and optional Telegram, support choices/free text, and are correlated by
question ID rather than the latest conversation. Restart/retry must not duplicate
repairs, questions, or confirmations.

Use existing Health review/sync services and shared UI primitives. Worker defaults:
30s revision checks, 60s debounce (120s maximum), startup and local 03:00 sweep,
one run per user, 120s/20-tool-call reasoning budget, two transient retries.
Development scheduling is off; dry-run precedes automatic activation. Do not
modify production data or deploy as part of implementation.

## Implementation and verification

Implemented in `fix/health-pending-review`, alongside the pending-capture and
group-display repairs. Entry points and operational details:

- [Shared runtime](../../reference/core/agent-runtime.md)
- [Nutrition cleanup](../../reference/health/nutrition-cleanup.md)
- [Rollout and rollback](../../runbooks/nutrition-cleanup-rollout.md)

Local verification on September 4, 2026:

- 1,589 distinct unit/contract tests passed across the scoped regression run and
  supplemental cases, including real Mastra SDK structured output, memory,
  processors, workflow recovery, cancellation, and cross-workflow isolation.
- Four desktop/mobile Playwright fixture journeys passed. Group roll-ups,
  pending review, fixed artwork geometry, cleanup questions and Settings covered.
- Frontend production build passed; existing Sass/asset/chunk warnings remain.
- Layer-import audit, UI-token audit and `git diff --check` passed.
- Startup composition verified with fixture paths, scheduling off and no Telegram.
  No household backend or live food records were used.

Tests used available Node 22.22.0 (above the 22.13.0 SDK floor). The pinned
22.23.2 container/native dependency build and live-model preview evaluation are
still rollout checks; backend dependencies were installed with scripts disabled.
No deployment, production repair, automation activation, or commit was performed.
