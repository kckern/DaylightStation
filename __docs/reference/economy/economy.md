# Household Coin Economy — Reference

**Status:** Phase 1 implemented on `feature/household-economy` (2026-07-17).
**Design & plan:** `ops:docs/_wip/plans/2026-07-17-household-economy-design.md`, `…-implementation.md`.

Kids earn a household currency — **coins** — by completing piano lessons (or via
parent deposits) and spend it as a metered drain playing the Fitness arcade
(EmulatorGame). Coins are convertible to real money (cash-out, Phase 2), so the
ledger is append-only and auditable.

> **"coins" vs "rings":** the household currency is `coins`. The Fitness
> HR-zone effort measure is **rings** (renamed from "fitness coins", see
> `ops:docs/superpowers/specs/2026-08-26-rings-and-weekly-measures-design.md`). Rings
> are a measure, not money. They are never exchanged or debited; reaching ring
> thresholds and winning the weekly ring contest earn coin *awards*, paid by
> PayoutService (see "Weekly earnings payout").

## Currency model & source of truth

The backend is the single source of truth. Balance is **derived by folding an
append-only transaction ledger** — never stored as a mutable number. `wallet.yml`
is a rebuildable cache re-derived on every mutation.

### Data layout (under `data/users/{userId}/apps/economy/`)

```
ledger/{YYYY-MM-DD}.yml   # append-only transactions, sharded by txn date
wallet.yml               # { balance, balances, as_of, session } — cache, reconcilable from ledger
```

`balances` is `{ silver, gold, gems }`, each folded on its own and floored at 0.
`balance` is the silver figure, kept for callers that predate currencies.

Writes to a user's ledger are serialized through one per-user queue and land
atomically (staged file, then rename), so concurrent appends never lose an entry
or leave a half-written day file. `withUserLock(userId, fn)` holds that queue for
a read-check-write (a purchase that checks a balance before it debits); an append
made inside the lock writes straight through rather than waiting on itself, but
only while the lock's body is running: a timer it left behind queues normally.
`earn`, `adjust`, `deposit`, `settleSession` and `closeSession` each run their
whole check-and-append inside the lock, so a retried earn with the same ref
cannot pay twice. A day file that exists but does not parse is never appended
to: the append fails (`CORRUPT_LEDGER`) and the file stays as it was.

Household policy lives at `data/household/economy/config.yml` (registered as the
`economy` household app config in `shared/contracts/householdConfig.mjs`). The earn
rules sit beside it in `economy/earn-rules.yml`.

### Transaction shape

```yaml
- id: txn_ab12cd34ef
  at: "2026-07-17T20:15:00.000Z"
  kind: earn            # deposit | earn | prize | spend | withdraw | adjust | convert | pass
  currency: silver      # silver | gold | gems; an entry with no currency is silver
  delta: 5              # signed integer; sign must match kind
  action: piano-lesson-complete
  source: piano
  ref: "plex:12345"     # traceability handle (dedup key for earns)
  # optional, written only when set:
  ruleId: korean-daily  # the earn rule that paid it
  price: { silver: 3 }  # what a pass cost
  timeliness: on-time
  evidenceRef: "unit:abc"
  meta: { … }
```

## Transaction kinds

| Kind | Delta | Use |
|---|---|---|
| `deposit`, `earn` | > 0 | parent deposit; rewards |
| `prize` | > 0 | a contest win (the weekly ring contest), minted by PayoutService |
| `spend`, `withdraw` | < 0 | arcade drain; cash-out |
| `adjust` | ≠ 0, either sign | auditable reconciliation (may push the ledger below zero) |
| `convert` | ≠ 0, either sign | one half of a conversion: a −silver entry paired with a +gold entry. The ledger does not enforce the pairing; the week close writes both halves under the user lock |
| `pass` | exactly 0 | voucher marker; the coin it cost is a separate `spend` |

## Discrete vs metered entries

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
- **Award** — ring thresholds and the weekly ring contest → silver and gems, minted by PayoutService from the earnings preview. Rings are evidence, never exchanged.

## Policy catalog (`economy/config.yml`)

One file holds the payout mode, the Sunday week close, the pass definitions, the
parent digest schedule, and the legacy keyed `earn`/`spend` maps:

```yaml
schema: household.economy/v1
mode: dry-run              # off | dry-run | live
rules_source: earn-rules   # economy/earn-rules.yml
week_close:
  cron: "30 23 * * 0"      # Sunday 23:30 local
  convert:
    - { from: silver, to: gold, rate: 1 }
passes:
  early-pass:
    privileges: [piano.games]
    price: { silver: 0, gold: 0 }   # 0 means "not sold in this coin"
    cap: { per: study-day, count: 1, across: all-passes }
    authorization: trust
    refund_within_ms: 60000
digest:
  cron: "0 18 * * *"
  zero_days_alert: 2
earn: {}
spend: {}
```

`EconomyConfigProjection` reads it two ways:

- `policy()` is the raw doc (`{}` when there is no file). `EconomyService.earn` and
  `openSession` read its `earn`/`spend` maps.
- `catalog()` is the doc with every section filled: `mode: off`,
  `rules_source: earn-rules`, `week_close: { cron: null, convert: [] }`,
  `passes: {}`, `digest: { cron: null, zero_days_alert: null }`. A section of the
  wrong type reads as its default. A `mode` other than `off`, `dry-run` or `live`
  reads as `off` and logs `economy.catalog.unknown-mode` (once per distinct bad
  value); a typo never pays out. A bare `mode:` (null) counts as unknown; only a
  missing key is quietly `off`.

**Modes** (read by PayoutService on every settle). `off`: payouts do nothing. `dry-run`: payouts log
`economy.payout.would-mint` and change no balance. `live`: payouts write the ledger.

**Legacy `earn`/`spend` maps.** Every earnable/spendable is a keyed entry with
parent rules; `users:` holds per-kid overrides (most-specific-wins). Key fields:

- earn: `reward`, `per`, `daily_cap` (per UTC day)
- spend: `cost` + `per` (→ drain rate), `self_serve`, `auth`, `blackout` (local-time windows)

`earn` skips (returns `skipped: true`, no ledger entry) when there is no `earn`
map (`reason: 'no-catalog'`) and when the map is empty (`reason: 'not-priced'`),
so the always-on piano lesson hook stays quiet. An unknown action in a non-empty map is a
`ValidationError`.

Both reads go through `getHouseholdAppConfig`, so `dscli system reload
--allow-write` (or `--app economy`) picks up an edit to `mode`, `passes` and the
`earn`/`spend` maps without a restart. Cron schedules (`week_close.cron`,
`digest.cron`, the payout reconcile) are registered at startup and need a restart. To stop payouts, set
`mode: off`; do not delete the file, because a reload keeps the old snapshot when
the file is missing.

## API (`/api/v1/economy`)

| Method / Path | Body | Returns |
|---|---|---|
| GET `/users/:userId/wallet` | — | `{ userId, balance, balances, session }` |
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
- **Payout (school, fitness, piano → ledger):** `PayoutService.settle` mints what
  the weekly earnings preview says was earned (next section). Wired by
  `startEconomyPayouts` (`composition/earnings.mjs`): it settles a learner 30 s after
  the last `school.session.outcome-recorded` (`{learnerId}`) or
  `piano.lesson.completed` (`{userId}`), and every learner every 15 min
  (`economy:payout-reconcile`). School's own per-unit reward in
  `CloseSessionOutcome` stays off (`lifecycle.economy.enabled: false` in
  `school.yml`): school work is paid by PayoutService only, and turning both on
  would pay a unit twice.
- **Spend (arcade):** `frontend/.../EmulatorGame/coinMeteredGate.js` opens a spend
  session and drains coins as the timer runs, surfacing the balance in the
  EmulatorConsole overlay (`session.coins`) and its `depleted` state
  ("Out of coins — earn more!"). Off by default — enabled per-widget via
  `config.economy.enabled`.

## Weekly earnings preview (school → economy)

**Status:** the preview (2026-09-26) prices a week of evidence in
**silver** (the weekly currency of the taxonomy,
`ops:docs/_wip/plans/2026-09-14-household-economy-taxonomy.md`) and writes nothing to
any ledger; PayoutService (2026-10-20) mints what it prices. Design: `ops:docs/_wip/plans/2026-09-26-school-economy-earnings-preview.md`.

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
- The evaluator is given `today`. Today (and later) is **open**: its unfinished work
  is "still to do" (`pending`), never missed — today's term-grid row is live, so a
  row dated Friday is not a Friday that is over. Week kinds settle once Friday has
  passed (Saturday is payday, D1); all-green-so-far on a Wednesday is `pending`.
- A day the grid has not worked out yet (`unknown`, e.g. right after a cache wipe)
  never counts as "not done": `section-day` notes it, `section-week` and
  `week-met` are `indeterminate` on it.
- A week outside the school term reads "Outside the school term"; a week that has
  not started reads "Not started yet" — never "Not on the plan this week".
- A failed evidence source makes its lines `indeterminate` ("can't tell"), never
  `none`. Other statuses: `earned`, `none` (with a note saying why), `disabled`.
- Every line carries `ref` = `earn:<learner>:<rule>:<period>:<timeliness>` — the
  payout's idempotency key. The rules revision is recorded on the line
  (`priced`), never in the ref, so a rate edit cannot pay a week twice.

### Payout

`PayoutService` (`application/PayoutService.mjs`) reads `catalog().mode` on every
settle, then previews the learner's week (`week` = any study day in it; the
triggers pass none, which is the preview's current study day at the 4 am
boundary).

- Only `earned` lines pay. `indeterminate` and `pending` lines are held (H9) and
  logged `economy.payout.held` (`info` for indeterminate, `debug` for pending);
  `none` and `disabled` pay nothing.
- A line that pays both currencies writes one entry per currency: silver under the
  line's `ref`, gems under `<ref>:gems`. Each entry carries `ruleId`,
  `timeliness`, `evidenceRef` (the line's `ref`) and `source: payout`. The ring
  contest is kind `prize`; every other rule is `earn`.
- `EconomyService.mint(userId, { currency, amount, kind, ref, ... })` treats
  `amount` as what the ref is worth in total and pays only the shortfall, read
  from the whole ledger under the user lock. A second settle writes nothing; two
  racing settles (an event and the reconcile) pay once; a line that grew
  (Tuesday's green day on top of Monday's, more rings) pays the difference. A ref
  already paid more than the line now says (a rate cut, a retracted grade) is not
  clawed back; that is an `adjust`.
- `dry-run` logs `economy.payout.would-mint { learnerId, ref, currency, amount,
  ruleId }` per entry and writes nothing (no wallet snapshot either). `off` skips
  the preview.
- A settle failure is logged `economy.payout.failed` and never thrown into the
  event bus or the scheduler. A player who is not on the school roster logs
  `economy.payout.unknown-learner` at debug.
- The reconcile settles the current week only. Evidence for a past week that
  lands after its Monday 04:00 rollover (a late grade) is not paid automatically.

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

Week close + silver→gold conversion, tickets and the play clock, TV/screen-framework metered spend, cash-out + parent-mobile approval, PIN/NFC/
biometric auth, parent dashboard, deposit admin UI
(Phase 1 deposits are API-only).
