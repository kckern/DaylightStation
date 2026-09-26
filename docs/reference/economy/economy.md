# Household Coin Economy — Reference

**Status:** Phase 1 implemented on `feature/household-economy` (2026-07-17).
**Design & plan:** `docs/_wip/plans/2026-07-17-household-economy-design.md`, `…-implementation.md`.

Kids earn a household currency — **coins** — by completing piano lessons (or via
parent deposits) and spend it as a metered drain playing the Fitness arcade
(EmulatorGame). Coins are convertible to real money (cash-out, Phase 2), so the
ledger is append-only and auditable.

> **"coins" vs "rings":** the household currency is `coins`. The Fitness
> HR-zone effort measure is **rings** (renamed from "fitness coins", see
> `docs/superpowers/specs/2026-08-26-rings-and-weekly-measures-design.md`). Rings
> are a measure, not money. They are never exchanged or debited; reaching ring
> thresholds and winning the weekly ring contest earn coin *awards* (not yet wired).

## Currency model & source of truth

The backend is the single source of truth. Balance is **derived by folding an
append-only transaction ledger** — never stored as a mutable number. `wallet.yml`
is a rebuildable cache re-derived on every mutation.

### Data layout (under `data/users/{userId}/apps/economy/`)

```
ledger/{YYYY-MM-DD}.yml   # append-only transactions, sharded by txn date
wallet.yml               # { balance, as_of, session } — cache, reconcilable from ledger
```

Household policy lives at `data/household/config/economy.yml` (auto-loaded as the
`economy` household app config).

### Transaction shape

```yaml
- id: txn_ab12cd34ef
  at: "2026-07-17T20:15:00.000Z"
  kind: earn            # deposit | earn | spend | withdraw | adjust
  delta: 5              # signed integer; sign must match kind
  action: piano-lesson-complete
  source: piano
  ref: "plex:12345"     # traceability handle (dedup key for earns)
```

## Transaction types

- **Discrete** — one atomic entry: parent deposit, piano lesson reward.
- **Metered** — arcade play. Uses **hold-and-settle**: `openSession` places a
  hold (one open session per user = the double-spend guard); the client meters
  locally and `settleSession` charges consumed coins periodically; `closeSession`
  settles the tail and clears the session. A ~25-min run is a handful of ledger
  entries, and a crash costs at most the un-settled tail.
  - **Settle is a cumulative high-water-mark:** the client sends the *total* coins
    consumed since the session opened (monotonic), and the server charges only
    newly-crossed whole coins. This makes settles idempotent (safe to retry) and
    immune to sub-coin flushing.
- **Award** — ring thresholds and the weekly ring contest → coins (not built). Rings are evidence, never exchanged.

## Policy catalog (`economy.yml`)

Every earnable/spendable is an entry with parent rules; `users:` holds per-kid
overrides (most-specific-wins). See the committed example
`data/household/config/economy.yml` for the full annotated schema. Key fields:

- earn: `reward`, `per`, `daily_cap` (per UTC day)
- spend: `cost` + `per` (→ drain rate), `self_serve`, `auth`, `blackout` (local-time windows)

**Config is cached at backend startup** — edits require a dev-server restart
before they take effect.

Card Game's daily-research award uses this configurable catalog entry:

```yaml
earn:
  piano-card-game-daily:
    reward: 2
    per: completion
    daily_cap: 2
```

The Gaming service calls it once when a non-guest user's daily research first becomes
complete. Its `daily:{local-date}` reference makes retries idempotent; a missing economy
catalog leaves the campaign reward visible but skips the wallet mutation.

## API (`/api/v1/economy`)

| Method / Path | Body | Returns |
|---|---|---|
| GET `/users/:userId/wallet` | — | `{ userId, balance, session }` |
| POST `/users/:userId/deposit` | `{ amount, note? }` | `{ userId, balance }` |
| POST `/users/:userId/earn` | `{ action, source, ref? }` | `{ userId, earned, capped, duplicate, balance }` |
| POST `/users/:userId/sessions` | `{ action, source }` | `{ userId, sessionId, balance, drainPerSecond }` |
| POST `/users/:userId/sessions/:sessionId/settle` | `{ coins }` (cumulative) | `{ userId, balance, depleted }` |
| POST `/users/:userId/sessions/:sessionId/close` | `{ coins? }` (cumulative) | `{ userId, balance }` |

Domain errors map to HTTP: `ValidationError` → 400 (bad amount, blackout, no
balance, existing session), `EntityNotFoundError` → 404 (unknown user).

## Integration points

- **Grade reconciliation (School):** `EconomyService.adjust(userId,
  { delta, source, ref, note })` applies an exact signed correction outside
  earn caps. The reference is derived from the append-only grade adjustment or
  retraction id, making retries idempotent. The ledger may go negative; the
  displayed wallet remains floored at zero and later earnings repay the debt.
  School appends a reconciliation success or failure event so a partial
  failure can be retried safely without replacing the original machine grade.

- **Earn (piano):** `POST /api/play/log` fires `economyService.earn(...,
  { action: 'piano-lesson-complete', ref: 'plex:{id}' })` fire-and-forget the
  first time `UserVideoProgressStore` stamps `completedAt`. An economy failure
  never breaks progress recording. (Assumes `/log` `userId` is piano-kiosk-only —
  see the design doc's "Known assumptions".)
- **Earn (Card Game):** the Gaming session service fires `piano-card-game-daily`
  after the first qualifying battle/featured-skill completion of the local day. Guest
  play and repeated session commands never pay durable coins.
- **Spend (arcade):** `frontend/.../EmulatorGame/coinMeteredGate.js` opens a spend
  session and drains coins as the timer runs, surfacing the balance in the
  EmulatorConsole overlay (`session.coins`) and its `depleted` state
  ("Out of coins — earn more!"). Off by default — enabled per-widget via
  `config.economy.enabled`.

## Weekly earnings preview (school → economy)

**Status:** preview only (2026-09-26). It prices a week of evidence in
**silver** (the weekly currency of the taxonomy,
`docs/_wip/plans/2026-09-14-household-economy-taxonomy.md`) and writes nothing to
any ledger. Design: `docs/_wip/plans/2026-09-26-school-economy-earnings-preview.md`.

### Earn rules

`<household>/economy/earn-rules.yml` (read fresh per request, so a rate edit takes
effect at once; missing = the built-in defaults at revision 0; corrupt = an error,
never a silent fallback). Every write archives the replaced revision under
`economy/earn-rules.history/NNNN.yml` and stamps `revision`, `revisedAt`,
`revisedBy`.

| kind | pays for |
|---|---|
| `unit` | each graded work session matching `match: {subject, courseId, unitId (prefix)}` |
| `section-day` | each day the subject was served ("Korean pays every day it's done") |
| `section-week` | the week, once every day the subject was obligated reads served (or `excused: weekly_satisfied`) |
| `day-met` | each green day (term grid `met`) |
| `week-met` | a green week: every study day green AND the weekly row satisfied |
| `ring-threshold` | `rate: {rings, silver}` (silver per whole N rings) plus each threshold crossed |
| `ring-contest` | most rings in the roster at award-week close; `tie: all\|split\|none` |

Rewards are a currency map (`{silver, gems}`; a bare number is silver). A rule that
pays twice is two rules. Per-learner overrides live under `users.<id>`:
`multiplier` (scales silver, not gems) and per-rule `reward` / `rate` /
`thresholds` / `disabled`. Optional `effective: {from, to}` scopes a rule to dates.

### Windows and statuses

- **School week** Monday → Sunday; **ring award week** Monday 04:00 → Saturday 12:00
  (D10). The contest line is `pending` (leader mark only) until Saturday noon.
- Week kinds stay `pending` until the evidence reaches Friday — all-green-so-far on
  a Wednesday is not a green week.
- A failed evidence source makes its lines `indeterminate` ("can't tell"), never
  `none`. Other statuses: `earned`, `none` (with a note saying why), `disabled`.
- Every line carries `ref` = `earn:<learner>:<rule>:<period>:<timeliness>` — the
  future payout's idempotency key. The rules revision is recorded on the line
  (`priced`), never in the ref, so a rate edit cannot pay a week twice.

### API

| Method / Path | Returns |
|---|---|
| GET `/api/v1/earnings/preview?week=` | the roster's week: `{windows, contestClosed, rulesRevision, learners[]}` |
| GET `/api/v1/earnings/preview/:learnerId?week=` | one learner: `{totals, pending, lines[], work, evidence, multiplier, rulesRevision}` |
| GET `/api/v1/earnings/rules` | `{ruleset, kinds}` |
| PUT `/api/v1/school/teacher/economy/earn-rates/:learnerId` | `{actorId, pin, patch}` → the new ruleset (TeacherGate) |
| PUT `/api/v1/school/teacher/economy/earn-rules` | `{actorId, pin, doc}` → the new ruleset (TeacherGate) |

`week` is any study day in the wanted week (default: today's). The read routes
are reusable by any surface; writes live with each surface's own gate (the
teacher capability cookie is scoped to `/api/v1/school`).

### Code

- `2_domains/economy/earnings/` — `validateRuleset`, `resolveRules`,
  `withUserOverride`, `evaluateEarnings` (pure).
- `3_applications/economy/EarningsPreviewService.mjs` (windows, contest close,
  per-source failure handling), `EarnRulesService.mjs` (revisions), ports
  `IEarnRulesStore`, `IEarningEvidenceSource`.
- Evidence: `3_applications/school/SchoolEarningEvidence.mjs` (term verdicts
  read with `detail: true` for per-subject rows; graded sessions + curriculum
  subject/course) and `fitnessRingsProvider.standings` (rings by session start
  instant).
- `1_adapters/persistence/yaml/YamlEarnRulesStore.mjs`,
  `4_api/v1/routers/earnings.mjs`, `3_applications/school/usecases/ManageEarnRules.mjs`.
- Teacher console: the **Coins** tab (`CoinsPanel`) and section (`CoinsRosterPanel`).

## Backend architecture (DDD)

- `2_domains/economy/` — `Transaction` (factory + `foldBalance`), `policy`
  (`resolvePolicy`/`inBlackout`/`drainPerSecond`). Pure, no I/O.
- `3_applications/economy/EconomyService.mjs` — all balance math + policy
  enforcement (deposit/earn/openSession/settleSession/closeSession/getBalance).
- `1_adapters/persistence/yaml/YamlEconomyDatastore.mjs` — dumb ledger/wallet
  storage.
- `4_api/v1/routers/economy.mjs` + `5_composition/modules/economyApi.mjs` —
  thin HTTP shell; registered in `app.mjs` (`v1Routers.economy`) and the
  `api.mjs` routeMap (`'/economy': 'economy'`).

## Roadmap: reinforcement programs

The ledger is a dependable accounting primitive, but it is not by itself a
parenting program. Later economy work should support small, configurable,
time-bounded **reinforcement programs**: help a particular learner establish
one observable habit, then fade the external reward as the habit becomes more
reliable. Coins and privileges are optional consequences, not the point of the
program and not a substitute for specific human acknowledgement.

### Program model

A program config should express the whole loop, rather than only an `earn`
action:

```yaml
id: piano-starting-routine
learner: child-a
goal:
  observable: begins the assigned piano activity
  current_step: sits down, opens it, and plays the first prompt
reinforcement:
  coins: 1
  acknowledgement: "You got yourself started."
  choices: [choose-next-game, choose-dessert]
schedule:
  type: fixed
  max_per_day: 1
support:
  choices: [start-alone, start-together, choose-activity-order]
  prompt: "Would you like to begin together or on your own?"
fading:
  after: { successes: 8, within_days: 10 }
  next: { coins: 0, acknowledgement: true }
privacy: learner-and-parents
pause_when: [illness, travel, family-stress]
review: weekly
```

The goal is intentionally concrete and begins at the learner's present
ability. A program may use successive **shaping rungs** (for example: begin
with support → begin independently → complete a short loop) instead of paying
only for a distant ideal. Every program must also have an explicit fading or
exit condition; economy should help launch habits, not make permanent payment
the price of ordinary responsibility.

### Product rules

- Use coins for bounded, elective privileges. Do not make affection, family
  belonging, essential needs, or broad "good behavior" purchasable.
- Preserve learner choice where possible: order, mode, support level, or a
  pre-agreed reward menu. Configuration is an invitation, not merely a rule.
- Pair every awarded transaction with an opportunity for immediate, specific
  acknowledgement by a parent or trusted adult. A notification may prompt this,
  but must not demand a response or block settlement.
- Support an observation-only baseline and a periodic review: if the target
  behavior is not becoming more frequent or easier, change the support or
  consequence rather than escalating it automatically.
- Pausing a program must be ordinary and consequence-free during illness,
  travel, family stress, or other approved context changes. A pause neither
  creates debt nor lowers standing.
- Privacy, visibility, caps, eligibility, reward menus, support, and exit
  criteria are household- and learner-configurable. Shared displays should
  communicate logistics and encouragement, never rankings or public failure.
- Where developmentally appropriate, let the learner co-author a program's
  goal, support choices, and reward menu; a parent still approves the policy.
  This makes the program practice negotiation and commitment, not only
  compliance.
- Limit the number of active programs per learner. A household should not turn
  every worthwhile behavior into a simultaneous behavior-management project.
- Declare the accepted evidence source for an award (`parent-confirmed`,
  `self-report`, `trusted-device-event`, or `assessment-result`) and its
  policy. This makes trust explicit rather than silently treating every child
  action as suspicious.
- A repeated miss is a **help-not-fail** signal: notify the parent privately to
  lower the current rung, offer a start-together option, change the support, or
  pause the program. Never create automatic penalties, debt, or public failure
  from missed targets.
- Reviews may include a small optional learner reflection (for example, “too
  easy / about right / too hard” or “what helped?”). Reflection is not a grade
  or a condition of earning.
- Each program should name its intended natural reward or social destination
  (such as playing a piece for someone, choosing a duet, or fluently making a
  chess move). Fade coins as that destination becomes reinforcing in its own
  right.
- Permit parent-issued, optionally private appreciation deposits with a note
  outside any performance program. Generosity and recognition must not imply
  that all care is transactional.
- On exit, retain the program and its ledger evidence in a private “graduated
  habits” archive rather than leaving it among active obligations.

### Delivery sequence

1. Build the configuration schema and read-only program status; do not add new
   automatic awards yet.
2. Pilot one learner-selected, low-stakes program with a parent-configured
   baseline, one current shaping rung, and a small fixed reward.
3. Add an idempotent award path whose ledger `ref` identifies the program,
   learner, rung, and qualifying occurrence. Record a reviewable program event
   alongside the financial transaction.
4. Add review, pause, rung advancement, and fading/exit actions. Advancement
   must be explicit or policy-derived and auditable, never an opaque score.
5. Only after household experience validates the model, consider broader
   reward menus, parent surfaces, and real-money cash-out. Cash-out remains a
   separate, parent-approved concern.

## Not yet built (later phases)

Weekly earnings PAYOUT (the preview above prices; nothing mints yet), week close + silver→gold conversion, tickets and the play clock, TV/screen-framework metered spend, cash-out + parent-mobile approval, PIN/NFC/
biometric auth, parent dashboard, deposit admin UI
(Phase 1 deposits are API-only).
