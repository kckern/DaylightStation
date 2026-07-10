# Life App — User Journey vs. Implementation Audit

**Date:** 2026-07-09
**Method:** Every beat of [docs/reference/life/user-journey.md](../../reference/life/user-journey.md) walked against the actual code, UX, and data flows. Three targeted code surveys (frontend cold-start behavior, backend plan lifecycle, cadence/time semantics) plus live-run evidence from the 2026-07-09 wiring session. All claims carry file:line evidence.

**Verdict:** The system is a **read-side skeleton with a write-side void**. Every surface that *displays* a plan is built and polished; almost every path by which a plan, its evidence, or its metrics would come into existence is missing, broken, or dead-ended. A brand-new user cannot begin; the one user the system implicitly assumes (the head of household with a hand-authored YAML) hits timing bugs, permanently-empty dashboard panels, and one-way conversations. The journey document's Phase 1 (onboarding) is 0% supported; Phase 2 (daily loop) works only for one specific person and misfires its core ritual times; Phases 3–4 render but their data pipelines produce nothing.

---

## Severity Legend

- **S0 — Showstopper:** the journey phase cannot happen at all.
- **S1 — Broken:** the phase happens but a core mechanism malfunctions.
- **S2 — Stymied:** the user can proceed but is confused, misled, or silently loses value.
- **S3 — Friction:** annoyance, dead weight, or missing polish.

---

## Phase 0 — Discovery: the first sixty seconds

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| 0.1 | **S0** | **The app is single-user by construction.** Every `/life` visitor is resolved to the head of household; there is no user picker, no auth, no per-device identity. A spouse or child opening the shared tablet sees — and edits — the head of household's plan, and the Coach's persistent memory is keyed to that one user. The `?username=` query override exists but nothing in the UI sets it, and the Coach ignores it. | `useLifeUser.js:22-24`, `LifeApp.jsx:57,78,140`; plan views receive no username prop |
| 0.2 | **S1** | **No empty-state funnel.** A planless user's `/life/now` is a lone card reading "No priorities right now." — no explanation, no "create your plan" call to action, no route to the coach. The journey's D0 requirement (one sentence + one button) has no implementation. | `Dashboard.jsx:43-88`, `PriorityList.jsx:12-13` |
| 0.3 | **S2** | **GoalsView renders a literally blank page** for a user with no goals — title, then nothing. No empty copy at all; reads as broken. | `GoalsView.jsx:50-55` |
| 0.4 | **S2** | The Log views *are* the good first impression for a data-rich cold start (they work with zero plan), but errors surface as raw `HTTP 500` red text, and empty weeks rely on the heatmap's fallback copy. | `LogWeekView.jsx:13`, `ActivityHeatmap.jsx:59-61` |

**Journey verdict:** Entry points E1/E3 exist; D0 (engage-or-bounce) is currently rigged to *bounce*.

---

## Phase 1 — Onboarding: from nothing to a plan

This phase is where the implementation's central incorrect assumption lives: **the code assumes a plan already exists.** There is no genesis path — not via API, not via UI, not via the coach.

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| 1.1 | **S0** | **No code path creates a `lifeplan.yml`.** `new LifePlan()` is instantiated in exactly one place — inside `load()`, only when the file already exists. `PATCH /plan/:section` 404s on a null plan; there is no `POST /plan`; every `save()` in the tree is load-then-mutate. A new user is stranded until someone hand-authors YAML on the server. | `YamlLifePlanStore.mjs:16-17`, `plan.mjs:22-26` |
| 1.2 | **S0** | **The coach cannot write the plan.** All plan-affecting tools are `propose_*` — they return proposal objects and never call `save`. The only writer (`record_feedback`) no-ops on a null plan. The coach can *conduct* the onboarding interview the journey describes and then **do nothing with the answers**. Verified live: asked about goals, the coach fabricated one rather than reading the plan. | `PlanToolFactory.mjs:34-131`, `FeedbackService.mjs:12` |
| 1.3 | **S0** | **Proposals go nowhere.** Even the propose-only design has no completion: CoachChat's accept-proposal/start-ceremony action handlers were deliberately dropped ("posted to a broken URL, never functioned"), and no other surface renders proposals. The human-in-the-loop apply step exists in neither half. | `CoachChat.jsx:10-14` comment; no proposal UI anywhere |
| 1.4 | **S0** | **UI creation affordances don't exist.** Except the purpose-statement textarea (the one true create path), no view can add a goal, value, belief, or quality. The card-sort, evidence mirror, and guided first session from the journey are unbuilt — and *couldn't* persist their output if they existed (1.1). | `PurposeView.jsx:20-30` (works); `GoalsView`/`ValuesView`/`BeliefsView`/`QualitiesView` (edit-only) |
| 1.5 | **S2** | **Planless ceremony = misleading dead-end.** `getCeremonyContent` returns null for a missing plan, and the route collapses that into `400 "Unknown ceremony type"` — the same error as a genuinely bad type. The UI renders it as raw red `HTTP 400`. A new user who taps a nudge gets an error blaming the ceremony, not a pointer to the real problem. | `CeremonyService.mjs:24-28`, `plan.mjs:143-144`, `CeremonyFlow.jsx:51-54` |

**Journey verdict:** Phase 1 is 0% supported. The deepest myopia in the system: it was built from the vantage point of someone who already had a plan file and could edit YAML — plan *genesis* was never designed.

---

## Phase 2 — The daily loop

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| 2.1 | **S0** | **Most household members can receive no nudge on any channel.** Telegram requires `identities.telegram.user_id` (1 of 6 profiles has it); HA push requires `identities.homeassistant.notify_service` (none have it); and the in-app fallback channel **broadcasts to a WebSocket topic no frontend listens to** — zero renderers for the `notification` topic exist. For everyone but the head of household, the entire cue system is silent. | profile survey; `AppNotificationAdapter.mjs`; frontend grep: no `notification` topic subscriber |
| 2.2 | **S1** | **"Morning" and "evening" ceremonies both fire at 7am.** For a 1-day unit, `periodEnd === periodStart` (`start + (1-1)×86400000`), and `#daysDiff` is absolute — so `start_of_unit` *and* `end_of_unit` are both "due" at the single daily 7am check. The evening-capture ritual the journey (and the ceremony's own copy) describes has no evening semantics anywhere; there is **no per-ceremony time-of-day knob at all** — the one `'0 7 * * *'` cron is the system's only clock. | `CadenceService.mjs:54-64,133-135`, `app.mjs` task registration |
| 2.3 | **S1** | **Evening completions are misfiled into tomorrow.** All period boundaries are UTC-midnight while the server and cron run Pacific. Any completion after ~4pm PST (5pm PDT) resolves to the *next* UTC day's periodId — so the user's "today" capture is recorded against tomorrow, tomorrow's period is pre-satisfied, and **tomorrow's nudge is suppressed**. A conscientious evening user chronically loses every other day's prompt. | `CadenceService.mjs:117-125` (UTC math), `CeremonyService.mjs:89-95` vs `CeremonyScheduler.mjs:66-78`; Docker `TZ=America/Los_Angeles` |
| 2.4 | **S2** | **The capture ceremony never echoes the morning's intentions.** UnitCapture shows active goals and a generic prompt; the morning's `intentions`/`energy` are not fetched or displayed. The core narrative loop of the day — "did I do what I said this morning?" — has no data connection between its two halves. | `UnitCapture.jsx:4-19`, `CeremonyService.mjs` unit_capture content |
| 2.5 | **S2** | **Nudges are one-way and button-less.** The Telegram message is plain text — `intent.actions` ("Begin" deep-link) is never rendered as an inline keyboard even though the adapter supports keyboards. And a *reply* to the nudge goes nowhere: no lifeplan webhook route, no InputRouter, no bots.yml entry — inbound messages can never reach the lifeplan-guide agent. The journey's reply-in-Telegram micro-interview loop is structurally impossible today. | `TelegramNotificationAdapter.mjs` (no reply_markup); webhook routes: nutribot/journalist/homebot only |
| 2.6 | **S3** | **The coach's daily nudge writes to a mailbox nobody checks.** `CadenceCheck.act` stores `pending_nudge` in working memory "for frontend polling" — grep finds zero readers in the entire repo. Write-only dead state. | `CadenceCheck.mjs:126`; repo-wide grep |

**Journey verdict:** Phase 2 functions for exactly one person, on one channel, with both daily ceremonies colliding at 7am and evening diligence punished by the timezone math.

---

## Phase 3 — The weekly cycle

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| 3.1 | **S1** | **The weekly retro lands on Tuesday.** The default cadence epoch is `2025-01-01` (a UTC Wednesday), so cycles run Wed→Tue and `end_of_cycle` fires Tuesday — not the Sunday ritual the journey (and the household's existing Weekly Review habit) assumes. Nothing aligns cycles to human weeks; phases (30d) drift off calendar months (P2 starts Mar 2), seasons (90d) drift off quarters. | `CadenceService.mjs:1-7,102,122-125`; worked boundaries in audit survey |
| 3.2 | **S1** | **The drift moment — the emotional center of the week — can never happen.** Three independent failures stack: (a) `DriftService` is constructed **without `cadenceService`**, so the only drift-computation endpoint (`POST /now/drift/refresh`) throws `TypeError` and 500s for every user; (b) even fixed, nothing *schedules* drift computation — no task ever calls `computeAndSave`; (c) even computed, value→category mapping falls back to hardcoded ids (`health/craft/family/wealth`) — any user whose value ids don't literally match gets Spearman over an empty intersection → correlation 0 → **permanent "reconsidering" false alarm**, which also trips the dashboard drift alert and coach nudge. The mechanism designed to reflect reality would instead gaslight precisely the user who named values in her own words. | `modules/lifeplan.mjs:49-53` vs `DriftService.mjs:27`; `ValueDriftCalculator.mjs:1-9,66-83,129-131`; `AlignmentService.mjs:104-112` |
| 3.3 | **S2** | **Ceremony adherence is permanently null** — `AlignmentService` is composed without `ceremonyRecordStore`, so the dashboard's adherence panel can never populate no matter how faithfully ceremonies are done. | `modules/lifeplan.mjs:67-71`, `AlignmentService.mjs:150-151` |
| 3.4 | **S2** | **The retro can't act on its own insights.** CycleRetro displays values read-only; re-ranking (the journey's "my ranking was wrong" branch) lives only in ValuesView. Retro answers are recorded but nothing routes them into next week's intentions or the coach's context. | `CycleRetro.jsx:24-97` |
| 3.5 | **S3** | Weekly Review (TV) narration is transcribed but never mined into plan evidence — known gap, unchanged. | journey doc; no consumer in lifeplan |

**Journey verdict:** The ritual renders, on the wrong day, around a gauge that is structurally incapable of ever showing data.

---

## Phase 4 — Monthly and beyond

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| 4.1 | **S1** | **Belief evidence only moves by hand.** `BeliefSignalDetector` / `LifeEventSignalDetector` are never constructed; the coach's `propose_add_evidence` writes nothing; the sole evidence path is a manual `POST /plan/beliefs/:id/evidence`. The journey's promise — "I'll quietly collect evidence and tell you if you're right" — is currently fiction. Bias calibration, dormancy surfacing, and cascade review all starve downstream of this. | adapter grep (zero constructions); `PlanToolFactory.mjs:107-131` |
| 4.2 | **S2** | **Completing an unimplemented ceremony silences it for the whole period.** `season_alignment`/`era_vision` render "not yet implemented" *with a working Complete button* that posts empty responses — writing a ceremony record that then dedupes the nudge for the entire season/era. One curious tap mutes a quarterly ritual for three months. | `CeremonyFlow.jsx:16-25,94`; dedupe via `hasRecord` |
| 4.3 | **S2** | `MetricsService` (monthly rollups) and `BriefingService` (AI briefing) remain orphaned — never constructed; the `mode=briefing` API path is served by AlignmentService's context instead. Monthly review has no computed month to review. | composition grep |
| 4.4 | **S3** | `#formatPeriodId` mixes local-time year with UTC-derived index — period labels can be wrong near year boundaries. | `CadenceService.mjs:128-130` |

---

## Cross-cutting: why the tests didn't catch any of this

The cadence/ceremony suites feed date-only strings (parsed as UTC midnight) and assert tz-tolerant shapes (id regexes, counts). No test pins weekday alignment, calendar-boundary behavior, `#daysDiff` sign, dual-due daily ceremonies, or any timezone rollover — one test even asserts "2025-01-01 is a cycle start" without noticing it's a Wednesday. **The entire UTC-vs-local class of defects is invisible to the current suite**, and the composition bugs (missing `cadenceService`/`ceremonyRecordStore` injections) slip through because unit tests construct services with full mocks rather than exercising `bootstrapLifeplan`.

---

## Root-Cause Themes (the myopias)

1. **"The plan already exists."** Genesis was never designed. Every write path assumes load-then-mutate; the author had a hand-written YAML, so nobody ever traveled the road a new user must take.
2. **"The user is the developer."** Single-user identity, YAML as the real editor, raw `HTTP 400`/`HTTP 500` strings in the UI, misleading error collapse. Fine for the person with SSH access; hostile to everyone else.
3. **"UTC is close enough to a human day."** Ceremonies are *wall-clock rituals* — morning coffee, evening wind-down, Sunday couch — built on UTC-midnight arithmetic in a Pacific household with a single 7am cron. Time-of-day is the product; it was modeled as a date.
4. **"Read first, write later — and later never came."** Dashboards, charts, and flows for data that no pipeline produces: drift never computed, adherence never injected, evidence never detected, rollups never constructed, proposals never applied. The demo renders; the flywheel has no crank.
5. **"Send equals deliver."** The notification stack ends at the transport. No in-app renderer, no action buttons, no reply routing, no per-user channel reality-check (5 of 6 household members are unreachable on every channel).
6. **"One epoch, one cron, one user fits all."** A single arbitrary epoch anchors all cadences (Wed→Tue weeks), a single cron carries all ceremony timing, and a single implicit user carries all identity. Each singleton is a design shortcut that a real household breaks immediately.

---

## Prioritized Remediation (P0 → P3)

**P0 — unbreak the existing user (small, surgical):**
1. Inject `cadenceService` (+ `clock`) into `DriftService` and `ceremonyRecordStore` into `AlignmentService` in `modules/lifeplan.mjs` — two one-line composition fixes that un-500 drift refresh and un-null adherence.
2. Distinguish "no plan" (404 + `code: NO_PLAN`) from "unknown ceremony type" (400) in `plan.mjs`; friendly empty-state in `CeremonyFlow` instead of raw HTTP text.
3. Remove the Complete button from unimplemented ceremony types (prevents season/era self-silencing).
4. Schedule drift computation (e.g., nightly per user with a plan, alongside `lifeplan:ceremony-check`).

**P1 — make the daily loop honest:**
5. Local-day cadence: resolve period boundaries in the household timezone (single seam: `CadenceService` date math), pin with tz tests; align default cycle epoch to Monday (or make epoch/weekday configurable in CeremonyConfig).
6. Per-ceremony delivery times (`ceremonies.<type>.at`) + a second scheduler check (e.g., 7:00/21:00), replacing the dual-fire at 7am.
7. Echo morning intentions in unit_capture content (CeremonyService already loads the record store).
8. Telegram inline "Begin" button (adapter already supports keyboards) — one-tap cue→action.

**P2 — open the doors:**
9. Plan genesis: `POST /plan` seeding an empty-but-valid plan + a plan-apply endpoint for coach proposals; give the coach explicit, confirmed write tools (create goal/value/belief) so the onboarding interview can persist its output.
10. Empty-state funnel on `/life/now` → coach-led first session; minimum creation affordances in Goals/Values/Beliefs views.
11. Household identity: user picker (or per-device default), notification-channel reality check per user, and coach memory keyed per person.
12. In-app notification renderer (the `notification` WebSocket topic) as the zero-config fallback channel.

**P3 — the flywheel:**
13. Wire signal detectors + MetricsService on a schedule; value→category mapping editor (or map at value-creation time); inbound lifeplan Telegram routing for replies; retro outputs feeding next-cycle intentions; Weekly Review transcript mining.

---

## See Also
- [user-journey.md](../../reference/life/user-journey.md) — the journey this audit evaluates
- [life-domain-architecture.md](../../reference/life/life-domain-architecture.md)
- 2026-03-17 lifeplan implementation audit (prior art; its "router not mounted" blocker is fixed, its Phase 1–4 framing still stands)
