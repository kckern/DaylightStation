# Life App — Full-Scale UX Audit

**Date:** 2026-07-17
**Scope:** `frontend/src/modules/Life/` + `frontend/src/Apps/LifeApp.jsx`, and `backend/src/2_domains/lifeplan/` (with the `3_applications/lifeplan/*` services and `3_applications/agents/lifeplan-guide/*` that feed the UI).
**Method:** Five parallel read-only investigations — visual/design-system, lifecycle-awareness, coach quality, alerts/nudges, onboarding — each seeded with the prior functional audit and told to **verify current state** (the code moved a lot in the last 8 days). All claims carry `file:line` evidence; the coach findings are corroborated against live prod agent transcripts in `media/logs/agents/lifeplan-guide/`.
**Prior art:** [2026-07-09 user-journey audit](./2026-07-09-life-user-journey-vs-implementation-audit.md) (functional), [2026-03-17 implementation audit](./2026-03-17-lifeplan-domain-implementation-audit.md), and the design reference [docs/reference/life/user-journey.md](../../reference/life/user-journey.md).

---

## Executive Summary

**The user feedback has real substance — but it is measuring a different thing than the last audit did.** Between 2026-07-09 and 2026-07-10 a concentrated remediation wave landed (~12 commits, `6b8052152`→`2d8e506c6`): plan genesis + authoring API, a coach that can actually write the plan, a household user switcher, an in-app notification renderer, create-from-view modals, per-ceremony scheduling, and a nightly drift snapshot. That work closed almost every **S0 "the system literally cannot do this"** finding from July 9. The plumbing now largely works.

What remains — and what the users are reacting to — is **UX quality on top of now-working plumbing.** The app renders real data through undesigned surfaces, doesn't know where the user is in their own journey past day one, ships a coach that still gets its user wrong in production, and surfaces alerts written in model-internal jargon that can't be dismissed. None of the five complaints is baseless; three are strongly substantiated, two are "substantiated but partly overtaken by last week's fixes."

### Complaint scorecard

| # | User complaint | Verdict | The one fact that settles it |
|---|----------------|---------|------------------------------|
| 1 | "ugly af, no design system" | **Substantiated (high)** | Life is the only major app module with **0 SCSS files, no Mantine theme, no color scheme, no tokens** — raw default light-mode Mantine, while Health/Fitness/Piano each ship a deliberate visual identity. `LifeApp.jsx:85` is a bare `<MantineProvider>`. |
| 2 | "no lifecycle awareness" | **Substantiated (moderate); cold-start is stale** | Cold-start now funnels to the coach, but there is a single binary branch (`plan empty? → coach`) and no stage/completeness model — a day-2 user and a day-200 user see the same dashboard. There is no `ceremony_due` priority and no "done today ✓" anywhere. |
| 3 | "agent coach is useless and clueless" | **Substantiated; partially remediated but live legs** | In **today's** prod run the coach called `get_plan` with a fabricated username `user123`, got "no plan," and told a user *with a real plan* they have none. Identity is model-typed, not injected. |
| 4 | "alters [alerts] are vapid and spammy" | **Vapid: substantiated (high). Spammy: partial** | The drift alert a user sees is literally `"Value drift detected (reconsidering)"` / `"Correlation: 0.42"`, with **no tap, no dismiss, no snooze** anywhere in `PriorityList`. The worst 7am-collision spam was fixed; latched false positives and double-senders remain. |
| 5 | "can't even get started" | **Was true 7-09; now largely fixed — one sharp regression** | Three genesis paths + coach authoring + multi-user now exist; no S0 remains. But the **Purpose editor — the first item on the Plan tab — silently swallows a planless user's first input** via an un-surfaced 404. |

**Bottom line:** The July work made the Life app *function*. This audit is about making it *usable*. The highest-leverage fixes are small and concentrated: a theme file + a handful of shared UX primitives; a server-side stage/next-action model the dashboard branches on; infrastructural identity for the coach; and rewriting alerts to name the subject + an action and be dismissable.

---

## 1. Visual design & design system — "ugly af, no design system"

**Verdict: substantiated to a high degree, with one honest caveat.** "No design system" is literally true. Life has **0 of 34 files** as SCSS/CSS, no Mantine theme, no color scheme, no shared tokens, and no layout primitives — it renders unconfigured, light-mode Mantine 7 defaults. Every other app-level module has a deliberate identity: `HealthApp.jsx:57` passes `theme={healthTheme} defaultColorScheme="dark"` backed by `HealthApp.theme.js`; Fitness has ~130 SCSS files, Piano ~30. The caveat: the *component hygiene* is decent — semantic spacing props (`p="sm"`, `gap="md"`, `c="dimmed"`), only 8 inline styles, responsive `SimpleGrid` breakpoints, a couple of genuinely designed empty states. It is not sloppy code; it is **undesigned** code, and "ugly" is the predictable output.

**Findings (severity · evidence):**

- **S1 — No theme at any provider level.** `LifeApp.jsx:85` is a bare `<MantineProvider>` nested inside another bare one at `main.jsx:149`; no `primaryColor`, radius, spacing, typography, or component defaults. No `LifeApp.scss` exists (every other app has an `Apps/*.scss`). Root cause of the whole complaint.
- **S1 — Real rendering defect: near-black heatmap cells on a white page.** `views/log/shared/ActivityHeatmap.jsx:9` returns `var(--mantine-color-dark-6)` (#2e2e2e) for zero-count days, but Life runs the default **light** scheme, so every log view (Week/Month/Season/Year/Category embed the heatmap) shows a grid of near-black squares — the inverse of the faint-gray GitHub look it imitates. Meanwhile `UnitIntention.jsx:66` and `QualitiesView.jsx:77` hardcode light-scheme tints. The module never decided which scheme it lives in.
- **S1 — The same goal state renders two conflicting colors on one card.** `widgets/GoalProgressBar.jsx:3-9` (`committed:'blue'`) vs the `stateColor` map copy-pasted into `GoalsView.jsx:17-23` and `GoalDetail.jsx:6-12` (`committed:'green'`). A "committed" goal shows a green badge over a blue bar. `confidenceColor` is likewise duplicated across `BeliefConfidenceChip.jsx` and `BeliefsView.jsx`. No single source of semantic color.
- **S1 — Fixed-width overflow hazard.** `ActivityHeatmap.jsx:65-67` sets `width={weeks*14+2}` (~744px on the year view) inside a plain `<Stack>` with no `overflow-x` → the page body scrolls horizontally on a portrait tablet. It also mounts one Mantine `Tooltip` portal per day (~365 on the year view).
- **S1 — Incomplete AppShell chrome.** `LifeApp.jsx:90` declares `navbar={{ width: 200, breakpoint: 'sm' }}` with **no `collapsed` state and no Burger** — below the breakpoint the navbar covers content with no way to dismiss it. Header height 48 (`LifeApp.jsx:89`) disagrees with `CoachChat.jsx:21`'s `calc(100vh - 60px)`.
- **S2 — Inconsistent loading & error states.** Half the views render a bare top-left `<Loader size="sm" />` (Dashboard, all Log views, CeremonyFlow); the other half render nothing (`if (loading) return null` in Purpose/Goals/Beliefs/Qualities/GoalDetail/CeremonyConfig). Errors are raw red strings (`<Text c="red">HTTP 500</Text>`) in the Log views and Briefing/GoalDetail, vs proper `<Alert>` in CeremonyFlow/GoalsView/BeliefsView. No skeletons, despite a shared `styles/_skeleton.scss` in the repo.
- **S2 — Machine text shown to humans.** Raw ISO dates as headings (`LogDayDetail.jsx:20` title is literally `2026-07-17`; `LogMonthView.jsx:43` "Week of 2026-07-13") and raw internal IDs as copy (`ValueAllocationChart.jsx:18` prints `{valueId}`; `CadenceIndicator.jsx:13`/`CeremonyConfig.jsx:62` print `{periodId}`; `GoalDetail.jsx:92` prints `{d.type}: {d.target_id}`). This, more than anything, makes screens read as debug output.
- **S2 — Flat hierarchy, one undifferentiated card.** The header brand and every page title are both `Title order={4}`; body copy is near-universally `size="sm"`/`xs` (dense for a wall tablet at distance). ~30 identical `<Paper p="sm|md" withBorder>` with default radius (only 2 places pass `radius="md"`) — the "wall of default cards" complaint is literal (`GoalDetail.jsx` stacks seven).
- **S3 — Widget nits & dead views.** `ValueAllocationChart.jsx:3,21` colors bars by sort position so a value changes color when its rank changes; `CeremonyFlow.jsx:81` uses raw `color="green"`; `Briefing.jsx:67` renders LLM text via `dangerouslySetInnerHTML`. `Dashboard.jsx:70-89` leaves the right grid cell empty when `valueDrift` is null; `Briefing.jsx` is mounted by nothing.

**What's genuinely fine:** the plan-empty onboarding card (`Dashboard.jsx:48-64`), Goals/CeremonyFlow empty & NO_PLAN states, consistent Tabler iconography with a proper `SourceIcon` map, responsive grids, disciplined spacing props. The bones are fine; there is no skin.

---

## 2. Lifecycle awareness — "no lifecycle awareness"

**Verdict: partially substantiated, partially stale.** The July 9 headline ("planless user cannot begin") is remediated — `Dashboard.jsx:48-64` funnels planless users to the coach, `CeremonyFlow.jsx:56-69` catches `NO_PLAN`, GoalsView has an empty-state CTA, and the coach has a real onboarding script. But the complaint holds for **every stage after cold start**: the UI is a static snapshot renderer with a single binary branch (`useLifePlan.js:57-60` `isEmpty`). There is no stage/completeness model, no "what should I do right now," no ceremony-done-today state, and no time-of-day awareness. A user on day 2 sees essentially the same dashboard as one on day 200.

**Findings:**

- **S1 — The daily loop has no persistent anchor; dueness lives in an 8-second toast.** The Dashboard never shows "morning intention due" or "done ✓ today." The only channel is the Mantine toast (`useAppNotifications.js:167`, `autoClose: 8000`), which requires the app to be open at the exact delivery hour. The priority engine has **no `ceremony_due` type** — `AlignmentService.mjs:57-120` fires only `dormant_belief`, `goal_deadline`, `anti_goal_warning`, `drift_alert`. `ceremonyAdherence` is computed as a useless `{ total }` (`AlignmentService.mjs:152-156`) and never rendered. Biggest single gap behind the complaint.
- **S1 — The sparse-plan stage gets a dead dashboard.** With a young plan none of the four priority rules can fire (nothing dormant, no near deadlines, no drift snapshot yet) → "No priorities right now." (`PriorityList.jsx:12-14`), a blank right column, and raw cadence badges. The `isEmpty` branch is binary: one goal and you're "not empty," so all guidance vanishes with nothing to replace it.
- **S2 — No stage/completeness model in the hooks layer.** `useLifePlan` exposes only `isEmpty`; nothing surfaces `hasPurpose`/`valueCount`/`ceremonyStreak`/`daysSinceLastCeremony`, so no view *can* branch on stage even if it wanted to.
- **S2 — Inconsistent empty-state funnels; two dead ends.** `QualitiesView.jsx:43-45` and `PurposeView.jsx:55-57` show one-line "nothing here" text with no coach link and no create path — while Goals gets a full funnel. Purpose is the concept that most needs guided authoring and has the least.
- **S2 — The "now" surfaces are orphaned.** `views/now/Briefing.jsx` (the one narrative "what should I do right now" component) is imported nowhere; `hooks/useDrift.js` likewise. Even Briefing's own design is pull-only ("Generate Briefing" button), not time-aware.
- **S3 — Static navigation, zero progressive disclosure.** `LifeApp.jsx:111-143` always shows all seven sections; a brand-new user immediately faces `cascade_refuted` beliefs, quality "shadows", and "spurious" evidence taxonomies with no scaffolding.
- **S3 — CadenceIndicator is raw data, not orientation.** `CadenceIndicator.jsx:8-17` prints periodId badges — no "day 3 of your cycle," no morning/evening framing.

---

## 3. The AI coach — "useless and clueless"

**Verdict: fully substantiated as of July 9; partially remediated but still has live legs.** A July 10 commit (`0c273b517`, present in the running build) added real plan-write tools and a mandatory-`get_plan` rule, and chat mode demonstrably works (a July 10 transcript shows `get_plan → add_value` persisting a real value). But the remediation is prompt-discipline, not architecture, and it does not cover the scheduled path.

**Single most damning finding — reproduced in prod today:** In transcript `media/logs/agents/lifeplan-guide/2026-07-17/kckern/140026-000-fefb6484.json` (14:00 UTC today), the model called `get_plan` with a **fabricated username `"user123"`**, got "No plan found," and concluded *"It looks like you don't have a life plan set up yet"* — while the user's real plan (2 committed goals, values, purpose) sits at `data/users/kckern/lifeplan.yml`. The coach does not know who it is talking to on its scheduled path. That is the textbook definition of "clueless," in prod, 8 days after the last audit.

**Findings:**

- **CRITICAL — Identity is model-typed, not injected.** Every tool keys on a `username` *parameter the model must supply* (`PlanToolFactory.mjs:19-22` et al.), while the framework's `UserIdInjector` (`framework/decorators/UserIdInjector.mjs:29-38`) injects only `userId`, which these tools ignore. Grounding depends entirely on the prompt's "## Active User" section — and `BaseAgent.runAssignment()` (`BaseAgent.mjs:143`) calls `getSystemPrompt()` directly, **bypassing** `buildPromptSections()`, so scheduled runs get **no Active User section**. `Assignment.execute()` then calls the LLM **even when `buildPrompt()` returns null**, so the daily 7am `CadenceCheck` burns a model call on empty input and the unanchored model improvises `user123`. Transcripts show this daily, Jul 11–17.
- **CRITICAL — The proposal loop is a dead end and the prompt lies about it.** `propose_goal_transition` / `propose_add_belief` / `propose_reorder_values` / `propose_add_evidence` (`PlanToolFactory.mjs:36-134`) return JSON and persist nothing. The system prompt tells the model *"The user sees these as confirmation cards and can Accept, Modify, or Dismiss"* (`prompts/system.mjs:65`) — **false**: the frontend accept-proposal handlers were removed (`CoachChat.jsx:11-14` comment), and proposal output renders only as raw JSON in the collapsed tool-call debug view. So the coach can *create* new items but cannot execute any change to *existing* state — even though REST endpoints for exactly those operations exist (`plan.mjs:124,155,75`).
- **HIGH — Chat history is invisible after reload.** `AgentChatSurface.jsx:54` uses `useLocalRuntime` with no history fetch; `runtime.js:28-40` persists a `threadId` so server-side Mastra memory *remembers* the conversation, but the UI renders a blank thread on every load. The model knows things the user can't see — reads as creepy or clueless.
- **MEDIUM — `trust_level` is a fictional feature.** Referenced in the prompt (`system.mjs:13-17`) and read in `CadenceCheck.mjs:53`, but never written anywhere — permanently `'new'`.
- **MEDIUM — Dead household config override.** `data/household/config/agents.yml`'s `lifeplan-guide` memory override never loads (`loadAgentConfig.mjs:51` reads `data/system/config/agents.yml` — the known household-accessor gotcha). Non-fatal; system defaults do enable memory (verified recall in a July 9 transcript).
- **MEDIUM — Single channel, dead action buttons.** Coach is reachable only at `/life/coach`; no Telegram/inbound routing. `CadenceCheck` emits `actions` arrays with no handler for the action strings.
- **Housekeeping — prod polluted by tests.** The real user's plan purpose is currently `"Playwright audit purpose test"`; test-user `soren`'s July 10 plan has since vanished. Keep Playwright off prod user files.

---

## 4. Alerts & nudges — "alters [alerts] are vapid and spammy"

**Verdict: "vapid" substantiated (high); "spammy" partial** — the worst volumetric bugs from July 9 were fixed (WS topic now has a listener with dedupe at `useAppNotifications.js:37-42`; the morning/evening 7am collision is resolved by per-type delivery hours at `CeremonyScheduler.mjs:38-45`; Telegram inline buttons render at `TelegramNotificationAdapter.mjs:53-60`). What remains is repetitive, un-dismissable, un-actionable, jargon-filled noise rather than raw volume.

**Findings:**

- **S1 — Vapid content: alerts are jargon templates, not guidance.** The drift alert the user reads is literally `"Value drift detected (reconsidering)"` with reason `"Correlation: 0.42"` (`AlignmentService.mjs:109-110`) — an internal model state and a Spearman coefficient, naming neither *which* value nor *what to do*. Anti-goal alert restates the user's nightmare back at them with a proximity enum (`:95-97`); dormant-belief reason is a hardcoded `"Untested for 60+ days"` regardless of actual duration (`:66-68`); every ceremony nudge body is the same `"Your unit intention ceremony is due."` (`CeremonyScheduler.mjs:133-137`). UI badges are single generic words "Drift"/"Warning"/"Belief" (`PriorityList.jsx:6-8`).
- **S1 — Zero actionability.** `PriorityList.jsx:22-37` cards have **no onClick, no dismiss, no snooze, no deep link**; there is no acknowledgement store anywhere in the lifeplan backend. Combined with always-on conditions, identical un-dismissable warnings reappear on every load of `/life/now` — the core "spammy" experience.
- **S1 — Anti-goal warning is a latched, never-computed false positive.** `AntiGoal.mjs:8` `proximity` is a static stored field defaulting to `'distant'`; nothing ever writes it. The alert fires purely off it (`AlignmentService.mjs:91-100`), so it is either permanently silent or — if ever set to `imminent` by YAML/coach — a **critical alarm latched on forever** with no clearing path. `NightmareProximityService` (meant to compute it) is never instantiated and reads a field (`indicators`) that doesn't exist on the entity.
- **S1 — Drift status is structurally noisy → chronic false "reconsidering".** `ValueDriftCalculator.mjs:134-149` runs Spearman over common values; with n=2 the only outputs are ±1 (one flipped pair → −1 → high-urgency alert), n=3 only {1, 0.5, −0.5, −1}. "Observed" ranking is crude flat estimates (every task=15min, scrobble=3min, GitHub event=30min, `:11-26`) against hardcoded category→value ids, so untracked-but-lived values (family) systematically rank last → drift that reflects instrumentation coverage, not the user's life. The `<2 common → insufficient_data` guard fixed only the empty case.
- **S2 — Overlapping 7am senders + "overdue" mislabeling.** `CadenceCheck.mjs:7` hardcodes `'0 7 * * *'` while the hourly ceremony check's intention hour is also 7am — both route category `ceremony`, so an agent-enabled user gets **two 7am pings about the same ritual**. `CeremonyToolFactory.mjs:85,94` labels every not-yet-done daily ceremony "Overdue" at 7am, and the prompt says "Prioritize overdue ceremonies first" — the coach opens each day scolding the user for a ceremony that only just became due.
- **S2 — No rate limiting, quiet hours, or real preferences.** `NotificationService.mjs:35-90` has zero dedupe/cooldown/quiet-hours; `NotificationPreference.mjs` is a static category→channels map. `CeremonyConfig.jsx:13-17` offers channels `push/email/screen` that **no backend reads** and that don't match the real channels (`app/telegram/push`) — a placebo knob; `unit_capture` is missing from the list so the 8pm nudge can't be disabled from the UI.
- **S3 — Standing dead ends.** `pending_nudge` is still written to agent memory "for frontend polling" with zero readers (`CadenceCheck.mjs:126`); LLM-composed action buttons without `data.url` silently render as plain text; Telegram replies route nowhere.

---

## 5. Getting started / onboarding — "can't even get started"

**Verdict: was true on July 9; largely remediated; one sharp S1 hole remains.** No S0 ("literally cannot start") findings survive. A brand-new user can now reach a plan three ways — `POST /api/v1/life/plan` genesis (`plan.mjs:21-31`), create-if-missing on `POST /goals|/values|/beliefs` (`PlanAuthoringService.mjs:50-56`), and coach authoring tools (`PlanToolFactory.mjs:153-239`) — all persisting to `data/users/{username}/lifeplan.yml`. Multi-user is real (`identity.mjs:10-28`, header user Select persisted in localStorage). The complaint "can't even get started" is no longer literally true — but "the first thing I typed vanished without a word" would be.

**Findings:**

- **S1 — The Purpose editor silently destroys a planless user's first input, on the default Plan tab.** "Plan" lands on PurposeView (`LifeApp.jsx:130,152`). User types a purpose, hits Save → `saveEdit` (`PurposeView.jsx:20-23`) → `updateSection` **catches and swallows** the error (`useLifePlan.js:62-71`, no rethrow) → `PATCH /plan/purpose` returns **404 "Plan not found"** for planless users (`plan.mjs:78-79`) → `setEditing(false)` runs unconditionally, the editor closes, and the view shows "No purpose statement defined yet." No error is ever rendered. The backend fix already exists but is unexposed: `PlanAuthoringService.setPurpose` is create-if-missing (`:127-136`) yet has **no REST route** — only the coach tool calls it. This precisely targets the onboarding cohort and lands on the first Plan sub-tab.
- **S2 — CeremonyConfig is a silent no-op for planless users.** `toggleCeremony`/`setChannel` `await updateCadence` with no try/catch (`CeremonyConfig.jsx:26-46`); it throws because `PATCH /cadence` 404s without a plan → unhandled rejection, the switch doesn't move, zero feedback.
- **S2 — The planless funnel misfires for belief-only plans.** `isEmpty` counts only goals/values/purpose (`useLifePlan.js:57-60`), so a user whose first artifact was a belief still sees "You don't have a life plan yet."
- **S3 — QualitiesView is a read-only dead end** (no create path exists anywhere, REST or coach). **Coach pane renders literally nothing if identity fails** (`LifeApp.jsx:161` `lifeUser ? <CoachChat/> : null`). **Stale docs:** `user-journey.md:52,205-206` still marks the funnel and coach onboarding as GAP.

---

## Cross-cutting root causes

1. **"Function was the finish line."** The July wave made every path *work* once; none of it was designed to be *lived in* repeatedly. Genesis exists but the first editor eats input; the coach can write but doesn't know who you are; nudges send but say nothing and can't be cleared.
2. **No design substrate.** With no theme, no semantic-color source, and no shared page/section/empty/loading/error primitives, every view re-improvises — which is why colors conflict, states are inconsistent, and raw IDs leak. This is upstream of most of the "ugly" findings.
3. **The UI is stateless about the user's journey.** One binary `isEmpty` flag is the entire lifecycle model. There is no server-computed stage or next-action, so the dashboard can't say "do your morning intention" or "you haven't set a purpose."
4. **Model-internal concepts leak to humans.** Spearman coefficients, `reconsidering`, `periodId`, `cascade_refuted`, ISO timestamps, `target_id` — the domain's vocabulary is shown verbatim. The translation layer between model and person was never built.
5. **Identity is conversational where it must be infrastructural.** The coach's `username` tool params and the scheduled path's missing Active-User section are the same bug wearing two hats.

---

## Prioritized remediation

### P0 — Stop actively losing user trust (small, surgical)
1. **Expose purpose authoring** (closes the S1 §5): add `POST /life/plan/purpose` mirroring `/values` (~10 lines) calling the existing `PlanAuthoringService.setPurpose`; add `setPurpose` to `useLifePlan`; in `PurposeView.saveEdit` render the error inline and only close the editor on success.
2. **Stop the silent swallows:** `updateSection`/`updateCadence` should rethrow; PurposeView and CeremonyConfig must render errors (or gate planless with the funnel card).
3. **Make coach identity infrastructural** (closes the CRITICAL §3): rename tool params `username → userId` (or teach `UserIdInjector` to inject `username`) so the model has no identity field to fabricate; fix `BaseAgent.runAssignment()` to assemble the full prompt (Active User section), and have `Assignment.execute()` return early when `buildPrompt()` is null (kills the daily wasted call and the improvisation window).
4. **Fix the two latched false-positive alerts:** exclude small-sample drift (require ≥4 common values + N days before any status stronger than "insufficient data", plus hysteresis), and either wire nightmare-proximity computation or remove the `anti_goal_warning` type until it can be computed.

### P1 — Make it usable day-to-day
5. **Design substrate:** add `Apps/LifeApp.theme.js` (decide the scheme — dark matches Health/kiosks — set `primaryColor`, `defaultRadius`, page-title sizes, and `Paper` component defaults to normalize all ~30 cards) and one `modules/Life/theme/semantics.js` (`goalStateColor`/`beliefStateColor`/`confidenceColor`) to delete the five conflicting color maps. Fix the heatmap empty-cell color + wrap its SVG in a scroll container; reconcile the AppShell chrome heights + add a Burger.
6. **Shared UX primitives:** `LifePage`, `SectionCard`, `LoadingState` (skeletons, reuse `styles/_skeleton.scss`), `ErrorState` (Alert), `EmptyState` (icon + copy + CTA). Sweep every view — resolves the loading/error/hierarchy/card-monotony findings at once. Add `formatDate`/`formatPeriod`/ref-name helpers so no ISO string or raw ID reaches the DOM.
7. **Lifecycle model:** compute `stage` + `completeness` server-side in `AlignmentService.computeAlignment` (it already loads plan + cadence + ceremony records) and add `ceremony_due` / `plan_gap` priority types (the scheduler's dueness logic already exists — extract and reuse). Add a persistent "today's ceremony" card on the Dashboard with intention/capture done-state and a Start button. This makes `PriorityList` lifecycle-aware with near-zero frontend change.
8. **Rewrite alert content + add dismiss:** every alert names the concrete subject and next action (drift → *"'Family' is your #1 value but got the least logged time this cycle"* + deep link); add an acknowledgement store so `PriorityList` cards can be dismissed "until tomorrow"/"this period" and tapped through.

### P2 — Close the loops
9. **Coach:** either render proposal cards wired to the existing REST endpoints, or (truer to current design) convert the `propose_*` tools into confirm-in-conversation direct-write tools and delete the false "confirmation cards" prompt paragraph. Restore visible chat history from Mastra memory. Implement or delete `trust_level`.
10. **Notifications:** add a per-user dedupe ledger + household quiet hours at the single `NotificationService.send` choke point; collapse the two 7am senders (let `CadenceCheck` compose the morning slot and suppress the template nudge, or drop its own cron); fix "overdue" semantics; make `CeremonyConfig` honest (real channels, add `unit_capture`, expose the `at` hour, actually read the preference).
11. **Onboarding polish:** fix `isEmpty` to include beliefs/qualities; give Qualities/Purpose the same coach-CTA funnel as Goals; add a sparse-plan first-run checklist card on the Dashboard; give the coach route an error state; refresh `user-journey.md` status markers.

### P3 — The flywheel (mostly inherited from the 07-09 audit)
12. Mount or delete `Briefing.jsx`/`useDrift.js`; auto-generate the briefing in the morning window. Fix drift instrumentation (per-source minute weighting, a value→category mapping editor at value-creation time). Route inbound Telegram replies to the coach. Feed retro outputs into next-cycle intentions.

---

## See also
- [2026-07-09 user-journey audit](./2026-07-09-life-user-journey-vs-implementation-audit.md) — the functional audit this one builds on; its P0/P1 items were largely delivered 07-09/07-10, which is why the failure mode has shifted from "doesn't work" to "works but isn't usable."
- [docs/reference/life/user-journey.md](../../reference/life/user-journey.md) — the "Maya" journey these surfaces are measured against (status markers now stale).
- [docs/reference/life/life-domain-architecture.md](../../reference/life/life-domain-architecture.md)
