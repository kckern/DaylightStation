# Household Coin Economy — Reference

**Status:** Phase 1 implemented on `feature/household-economy` (2026-07-17).
**Design & plan:** `docs/_wip/plans/2026-07-17-household-economy-design.md`, `…-implementation.md`.

Kids earn a household currency — **coins** — by completing piano lessons (or via
parent deposits) and spend it as a metered drain playing the Fitness arcade
(EmulatorGame). Coins are convertible to real money (cash-out, Phase 2), so the
ledger is append-only and auditable.

> **"coins" vs "fitness coins":** the household currency is `coins`. The Fitness
> HR-zone earnings are a *separate* currency ("fitness coins") that does not
> auto-convert. An explicit exchange bridges them (Phase 3, not yet wired).

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
- **Exchange** — fitness coins ↔ coins (Phase 3, not built).

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

TV/screen-framework metered spend, cash-out + parent-mobile approval, PIN/NFC/
biometric auth, fitness↔coins exchange, parent dashboard, deposit admin UI
(Phase 1 deposits are API-only).
