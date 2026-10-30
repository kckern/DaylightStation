# Household Economy — Reference

**Status.** Wallet, ledger and arcade metered spend: Phase 1 (2026-07-17).
Weekly earnings preview: 2026-09-26. School economy slice 1 (2026-10): three
currencies, payouts, the Sunday week close, the early pass, the bank, and the
School and piano surfaces that read them.
**Design & plans (private docs):**
`ops:docs/_wip/plans/2026-07-17-household-economy-design.md` and `…-implementation.md`;
`ops:docs/_wip/plans/2026-09-14-household-economy-taxonomy.md`;
`ops:docs/_wip/plans/2026-09-26-school-economy-earnings-preview.md`;
`ops:docs/superpowers/specs/2026-10-19-school-economy-slice-1-design.md` and
`ops:docs/superpowers/plans/2026-10-19-school-economy-slice-1.md`.

## Overview

Kids earn household coins for schoolwork, piano lessons and fitness rings, and
spend them on privileges: one early piano game before school is done (the early
pass), and metered arcade play. The pieces:

1. **Earn rules** price a week of evidence (graded school work, green days, piano
   lessons, rings). The **earnings preview** evaluates them and writes nothing.
2. **PayoutService** mints what the preview says was earned into an
   append-only **ledger**, on school and piano events and an hourly reconcile.
3. **WeekCloseService** converts each earner's unspent silver to gold on Sunday
   night. Gold and gems are kept for good.
4. **Passes** spend silver or gold on one unit of a privilege. Economy owns the
   purchase, cap, price and refund; the privilege (the piano kiosk) owns
   consumption.
5. **BankService** answers one read for every surface: balances, history in
   plain words, today's pass, offers, and when the week closes.

Every amount comes from the household **catalog** (`economy/config.yml`) and
the earn rules. A catalog `mode` of `off`, `dry-run` or `live` decides whether
any of it writes. Coins are meant to become convertible to real money (cash-out,
a later phase), so the ledger is append-only and auditable.

> **"coins" vs "rings":** the household currency is coins (silver, gold, gems).
> The Fitness HR-zone effort measure is **rings** (renamed from "fitness coins", see
> `ops:docs/superpowers/specs/2026-08-26-rings-and-weekly-measures-design.md`). Rings
> are a measure, not money. They are never exchanged or debited; reaching ring
> thresholds and winning the weekly ring contest earn coin awards, minted by
> PayoutService.

## Currencies

| Currency | Earned by | Spent on | Lifetime |
|---|---|---|---|
| `silver` | payouts (every earn rule), parent deposits, legacy earns, pass refunds | early passes, arcade metered spend | the week: unspent silver of a payout earner becomes gold at the Sunday close |
| `gold` | the week close (`silver → gold` at the catalog's rate, 10:1) | early passes | kept for good; **fractional** (see below) |
| `gems` | earn rules that pay gems (for example ring thresholds or the contest) | nothing | kept for good, never converted, never buy a pass |

An entry written before currencies existed has no `currency` and is silver.
Each currency is folded on its own (`foldBalances`) and floored at 0 for display.

### Fractional gold

The week close converts silver to gold at **10 silver : 1 gold**
(`rate: 0.1`, which multiplies). Gold keeps the fraction: 56 silver closes to
exactly **5.6 gold**, and fractions accumulate across weeks (5.6 + 4.7 = 10.3).
Silver and gems stay whole coins; only gold may be fractional
(`FRACTIONAL_CURRENCIES` in `domain/coins.mjs`).

- **Precision.** A gold amount is a whole number of micro-gold
  (1 gold = 10⁶ µg), carried as a number rounded to 6 decimals.
  `createTransaction` snaps a gold `delta` to that grid (56 × 0.1 =
  5.6000000000000005 is stored as 5.6) and refuses one that rounds to 0;
  `foldBalances` and the history's `balanceAfter` sum gold in integer
  micro-gold, so a balance never reads 10.299999999999999. Six places is far
  finer than any rate (silver is whole, so silver × 0.1 has one decimal place)
  and integer sums stay exact up to ~9 billion gold.
- **Display.** Every screen shows `Math.floor` of a gold figure — 5.6 reads
  **5**, 10.3 reads **10**. A child never sees a decimal. The API
  (`balances.gold`, history `legs` and `balanceAfter`, a refusal's
  `details.balance`/`shortfall`) carries the exact stored figure; the server's
  history sentences (`text`) are already floored ("56 silver → 5 gold ·
  Sunday", "+5 gold · …"). Browser surfaces floor through
  `frontend/src/lib/coins/coinFigure.js` (`coinFigure`, `coinMagnitude`; it
  mirrors `displayCoins`): the bank's balance cards, its ledger amounts and
  balances, the status board's gold figure. A coin shortfall reads in whole
  coins rounded **up** (`coinsShort`; the piano lock's "N more gold"): short
  by 0.4 reads "1 more gold", matching the floored 5 shown against a price of 6.
- **Under one coin.** A real amount below one gold never reads "0": the
  history sentence says "6 silver → less than 1 gold · Sunday", a signed
  amount "+<1 gold", and the bank ledger's leg and balance "+<1" / "<1 gold"
  (`displayCoinsText` on the server, `coinMagnitudeText` in the browser).
  Otherwise the floor: 56 silver reads "→ 5 gold". The big balance cards and
  the status board stay plain floored figures.
- **Negatives.** `displayCoins`/`coinFigure` round toward zero, never past a
  figure's size: −0.4 reads 0 (not −1), −5.6 reads −5, never "−0".
- **Corrections.** `POST /api/v1/economy/users/:id/adjust` takes
  `currency` (default `silver`; one of silver, gold, gems). Silver and gems
  take whole deltas; gold any figure non-zero on the 6-place grid. A
  `reverse:<ref>` adjust un-pays that ref in its own currency only. A ref is
  used once across currencies: the same ref, delta and currency is a
  duplicate; any other currency or delta under it is refused.
- **Spending.** Prices stay whole. Affordability compares the **exact**
  balance: `balance >= price`. 5.6 gold buys a 5-gold pass (leaving 0.6) and
  cannot buy a 6-gold one (`PASS_UNAFFORDABLE`, `shortfall: 0.4`). What a
  floor-displayed balance of N can buy is therefore exactly what N whole gold
  can buy — the fraction never lets a child buy more than the screen shows.
- **Old ledgers.** Every gold row written before this is a whole number and
  folds unchanged.

### How a coin looks (`CoinIcon`)

Every coin drawn on a screen is `frontend/src/lib/icons/CoinIcon.jsx`: the
Twemoji coin (CC-BY 4.0, attribution in the file header). Printed receipts are
text and draw no coin.

- `metal: 'gold' | 'silver'` picks a palette in `COIN_PALETTES`. Each palette
  fills five named roles of the art: rim, inner, face, light, highlight. Gold is
  the default.
- `color` (a hex) is the escape hatch shared with `TicketIcon` and `GemIcon`. It
  rebuilds the five roles as a tint ladder around that one colour and wins over
  `metal`.
- Gems are `GemIcon`, a separate component with the same conventions.
- The coin FIGURES' text colours are not part of the icon: they stay the School
  tokens `--school-coin-silver` and `--school-coin-gold`.
- Add a coin only through this component. Never draw one as an emoji, a unicode
  glyph or a CSS circle (kiosk icons are SVG components).

## Ledger

The backend is the single source of truth. A balance is **derived by folding an
append-only transaction ledger**, never stored as a mutable number. `wallet.yml`
is a rebuildable cache re-derived on every mutation.

### Data layout (under `data/users/{userId}/apps/economy/`)

```
ledger/{YYYY-MM-DD}.yml   # append-only transactions, sharded by txn date (UTC)
wallet.yml               # { balance, balances, as_of, session } — cache, reconcilable from ledger
```

`balances` is `{ silver, gold, gems }`. `balance` is the silver figure, kept for
callers that predate currencies; it is never gold.

### Writes, the user lock and strict reads

Writes to a user's ledger are serialized through one per-user queue and land
atomically (staged file, then rename), so concurrent appends never lose an entry
or leave a half-written day file. `withUserLock(userId, fn)` holds that queue for
a read-check-write (a purchase that checks a balance before it debits). The lock
is reentrant: an append made inside the lock, or a nested lock, writes straight
through rather than waiting on itself, but only while the lock's body is
running; a timer it left behind queues normally. `earn`, `adjust`, `deposit`,
`mint`, `convert`, `buyPass`, `consumePass`, `refundPass`, `settleSession` and
`closeSession` each run their whole check-and-append inside the lock, so a
retried write with the same ref cannot pay twice.

A day file that exists but does not parse is never appended to: the append fails
(`CORRUPT_LEDGER`) and the file stays as it was. Reads come in two strengths
(`readAllTransactions(userId, { strict })`):

- **Lenient** (the default, for display): a shard that does not parse reads as
  empty.
- **Strict**, for every read-check-append (`mint`, `adjust`, `convert`, passes)
  and the bank's pass state: a shard that does not parse or is not a list
  throws `CORRUPT_LEDGER` and nothing is written, so a lost day is never read
  as "never paid" or "pass unused".

### Transaction shape

```yaml
- id: txn_ab12cd34ef
  at: "2026-07-17T20:15:00.000Z"
  kind: earn            # deposit | earn | prize | spend | withdraw | adjust | convert | pass
  currency: silver      # silver | gold | gems; an entry with no currency is silver
  delta: 5              # signed; sign must match kind. Whole for silver/gems; gold may be fractional (6 places)
  action: payout:math-daily
  source: payout
  ref: "earn:learner_a:math-daily:2026-W42:on-time"   # traceability and idempotency key
  # optional, written only when set:
  ruleId: math-daily    # the earn rule that paid it
  price: { silver: 3 }  # what a pass cost
  timeliness: on-time
  evidenceRef: "earn:learner_a:math-daily:2026-W42:on-time"
  meta: { … }
```

### Transaction kinds

| Kind | Delta | Use |
|---|---|---|
| `deposit` | > 0 | parent deposit |
| `earn` | > 0 | a payout line (`source: payout`), a legacy keyed earn, a pass refund |
| `prize` | > 0 | a contest win (the weekly ring contest), minted by PayoutService |
| `spend` | < 0 | a pass price; arcade drain |
| `withdraw` | < 0 | cash-out (not built) |
| `adjust` | ≠ 0, either sign | auditable reconciliation (may push the ledger below zero) |
| `convert` | ≠ 0, either sign | one half of a conversion: a −silver entry paired with a +gold entry. The ledger does not enforce the pairing; the week close writes both halves under the user lock |
| `pass` | exactly 0 | voucher marker; the coin it cost is a separate `spend`. A state change is a new marker entry (see [Early passes](#early-passes)) |

`PAID_KINDS` (`earn`, `prize`) are the kinds a payout mints. `isPayoutEntry(t)`
is true only for a paid kind with `source: payout` **and** an `action` in the
`payout:` namespace, which only `mint` stamps; `source` alone is not proof,
because older entry points let a caller name it. The week close and the parent
digest both use this test.

### Discrete vs metered entries

- **Discrete:** one atomic entry: a deposit, a payout line, a pass purchase.
- **Metered:** arcade play. Uses **hold-and-settle**: `openSession` places a
  hold (one open session per user = the double-spend guard); the client meters
  locally and `settleSession` charges consumed coins periodically; `closeSession`
  settles the tail and clears the session. A ~25-min run is a handful of ledger
  entries, and a crash costs at most the un-settled tail.
  - **Settle is a cumulative high-water-mark:** the client sends the *total* coins
    consumed since the session opened (monotonic), and the server charges only
    newly-crossed whole coins. This makes settles idempotent (safe to retry) and
    immune to sub-coin flushing. A settle never charges more than the silver
    balance.

## Catalog and modes (`economy/config.yml`)

Household policy lives at `data/household/economy/config.yml`, registered as the
`economy` household app config in `shared/contracts/householdConfig.mjs`. One
file holds the payout mode, the Sunday week close, the pass definitions, the
parent digest schedule, and the legacy keyed `earn`/`spend` maps. The earn rules
sit beside it in `economy/earn-rules.yml` (see [Earn rules](#earn-rules)).

An example catalog, with placeholder prices:

```yaml
schema: household.economy/v1
mode: dry-run              # off | dry-run | live
rules_source: earn-rules   # economy/earn-rules.yml
week_close:
  cron: "30 23 * * 0"      # Sunday 23:30 local
  convert:
    - { from: silver, to: gold, rate: 0.1 }   # rate multiplies: 10 silver → 1 gold
passes:
  early-pass:
    privileges: [piano.games]
    price: { silver: 0, gold: 0 }   # 0 means "not sold in this coin"
    cap: { per: study-day, count: 1, across: all-passes }
    authorization: trust
    refund_within_ms: 60000         # default when omitted
    max_active_ms: 1800000          # default when omitted (30 minutes)
digest:
  cron: "0 18 * * *"
  zero_days_alert: 2
earn: {}
spend: {}
```

`EconomyConfigProjection` (`adapters/config/EconomyConfigProjection.mjs`) reads
it two ways:

- `policy()` is the raw doc (`{}` when there is no file). `EconomyService.earn` and
  `openSession` read its `earn`/`spend` maps.
- `catalog()` is the doc with every section filled, so payouts, the week close,
  passes and the digest read it without null checks. Defaults: `mode: off`,
  `rules_source: earn-rules`, `week_close: { cron: null, convert: [] }`,
  `passes: {}`, `digest: { cron: null, zero_days_alert: null }`. A section of the
  wrong type reads as its default. Each pass that leaves them out gets
  `refund_within_ms: 60000` and `max_active_ms: 1800000`; a value that is set
  (0 included) is kept as written.

**Modes.** `off`: nothing runs (no preview, no ledger, no per-line logs).
`dry-run`: payouts log `economy.payout.would-mint` and the week close logs
`economy.week-close.would-convert`; no balance changes and no wallet snapshot
is written. `live`: payouts and the close write the ledger. A `mode` other than
`off`, `dry-run` or `live` reads as `off` and logs `economy.catalog.unknown-mode`
(once per distinct bad value), so a typo never pays out. A bare `mode:` (null)
counts as unknown and warns; only a missing key reads as `off` without a
warning. Passes are sold only in `live`: in `off` and `dry-run`, `buyPass`
refuses with `PASS_NOT_SOLD` ("the economy is not live") and the bank offers
nothing (`offers: {}`). Consume and refund do not read the mode, so a pass
bought while live still settles after a switch away from it.

Each section's reader:

| Section | Read by | See |
|---|---|---|
| `mode` | PayoutService (every settle), WeekCloseService (every close), `rewardFor`, the parent digest (every run), `buyPass` and the bank's `offers`/`mode`, School's agenda line | [Payouts](#payouts), [Week close](#week-close) |
| `week_close` | WeekCloseService; BankService for `weekEndsAt` | [Week close](#week-close) |
| `passes` | `EconomyService` pass methods, BankService offers | [Early passes](#early-passes) |
| `digest` | School's parent digest | [Integration points](#integration-points) |
| `earn` / `spend` | `EconomyService.earn`, `openSession` | below |

**Legacy `earn`/`spend` maps.** Every earnable/spendable is a keyed entry with
parent rules; `users:` holds per-kid overrides (most-specific-wins). Key fields:

- earn: `reward`, `per`, `daily_cap` (per UTC day)
- spend: `cost` + `per` (→ drain rate), `self_serve`, `auth`, `blackout` (local-time windows)

`earn` skips (returns `skipped: true`, no ledger entry) when there is no `earn`
map (`reason: 'no-catalog'`) and when the map is empty (`reason: 'not-priced'`),
so the always-on piano lesson hook writes and logs nothing. An unknown action in
a non-empty map is a `ValidationError`.

## Earn rules and the weekly preview

The preview prices a week of evidence in silver (and gems) and writes nothing to
any ledger. PayoutService mints what it prices, so the School board's "this
week's silver" and the ledger read one evaluator.

### Earn rules

`<household>/economy/earn-rules.yml` is read fresh per request, so a rate edit
takes effect at once. A missing file means the built-in defaults at revision 0; a
corrupt file is an error (`economy.earn-rules.corrupt`), never a fallback to the
defaults. Every write archives the replaced revision under
`economy/earn-rules.history/NNNN.yml` and stamps `revision`, `revisedAt`,
`revisedBy` (`economy.earn-rules.revised`).

| kind | pays for |
|---|---|
| `unit` | each graded work session matching `match: {subject, courseId, unitId (prefix)}` |
| `section-day` | each day the subject was served ("a subject pays every day it's done") |
| `section-week` | the week, once every day the subject was obligated reads served (or `excused: weekly_satisfied`) |
| `day-met` | each green day (term grid `met`) |
| `week-met` | a green week: every study day green AND the weekly row satisfied |
| `ring-threshold` | `rate: {rings, silver}` (silver per whole N rings) plus each threshold crossed |
| `ring-contest` | most rings in the roster at award-week close; `tie: all\|split\|none` |
| `debrief-day` | each day whose school debrief meets `match.criterion`: `completed`, `substantive` (on time, score at or above the threshold, not a fallback day) or `quiz-passed` (not a fallback day) |
| `debrief-week` | the week, once every owed debrief day is completed (late counts) or excused **and at least one is completed**: excused only keeps a day from blocking, so an all-excused week pays nothing ("No debriefs done this week"). Pending until Friday's grace closes. See [School debrief](../school/school-debrief.md) |

Rewards are a currency map (`{silver, gems}`; a bare number is silver). A rule that
pays twice is two rules. Per-learner overrides live under `users.<id>`:
`multiplier` (scales silver, not gems) and per-rule `reward` / `rate` /
`thresholds` / `disabled`. Optional `effective: {from, to}` scopes a rule to dates.
A line's silver is `round(count × silver × multiplier)` for the whole line.

### Windows and statuses

- **School week** Monday → Sunday; **ring award week** Monday 04:00 → Saturday 12:00
  (D10). The contest line is `pending` (leader mark only) until Saturday noon.
- **Study day.** The 4 am boundary in the household timezone
  (`studyDayForInstant`). `createEconomyApi({ timezone })` builds one
  `studyCalendar` and hands it to the preview, the passes, the bank and the
  parent digest, so they all agree on "today".
- The evaluator is given `today`. Today (and later) is **open**: its unfinished work
  is "still to do" (`pending`), never missed; today's term-grid row is live, so a
  row dated Friday is not a Friday that is over. Week kinds settle once Friday has
  passed (Saturday is payday, D1); all-green-so-far on a Wednesday is `pending`.
- A day the grid has not worked out yet (`unknown`, e.g. right after a cache wipe)
  never counts as "not done": `section-day` notes it, `section-week` and
  `week-met` are `indeterminate` on it.
- A week outside the school term reads "Outside the school term"; a week that has
  not started reads "Not started yet", never "Not on the plan this week".
- A failed evidence source makes its lines `indeterminate` ("can't tell"), never
  `none` (`economy.earnings.school-unavailable`,
  `economy.earnings.rings-unavailable`). Other statuses: `earned`, `none` (with a
  note saying why), `disabled`.
- Every line carries `ref` = `earn:<learner>:<rule>:<period>:<timeliness>`, the
  payout's idempotency key. The rules revision is recorded on the line
  (`priced`), never in the ref, so a rate edit cannot pay a week twice. A
  settle prices with the current ruleset, so a past week is re-priced under
  today's rates only when it is settled again (see [Grace](#late-evidence-and-grace)).
  A raise then pays the difference; a cut is never clawed back.

### Preview and rules API

| Method / Path | Returns |
|---|---|
| GET `/api/v1/earnings/preview?week=` | the roster's week: `{windows, contestClosed, rulesRevision, learners[]}` |
| GET `/api/v1/earnings/preview/:learnerId?week=` | one learner: `{totals, pending, lines[], work, evidence, multiplier, rulesRevision}` |
| GET `/api/v1/earnings/rules` | `{ruleset, kinds}` |
| PUT `/api/v1/school/teacher/economy/earn-rates/:learnerId` | `{actorId, pin, patch}` → the new ruleset (TeacherGate) |
| PUT `/api/v1/school/teacher/economy/earn-rules` | `{actorId, pin, doc}` → the new ruleset (TeacherGate) |

`week` is any study day in the wanted week (default: today's). The read routes
are reusable by any surface; writes live with each surface's own gate (the
teacher capability cookie is scoped to `/api/v1/school`). The teacher console
edits rules in the **Coins** tab (`CoinsPanel`) and section (`CoinsRosterPanel`).

## Payouts

`PayoutService` (`application/PayoutService.mjs`) reads `catalog().mode` on every
settle, then previews the learner's week (`week` = any study day in it; `null`
is the preview's current study day, `currentStudyDay()`).

### Minting

- Only `earned` lines pay. `indeterminate` and `pending` lines are held (H9) and
  logged `economy.payout.held`; `none` and `disabled` pay nothing. Evidence
  missing is not evidence of work, and an open period is not over.
- A line that pays both currencies writes one entry per currency: silver under the
  line's `ref`, gems under `<ref>:gems`. Each entry carries `ruleId`,
  `timeliness` (the line's), `evidenceRef` (the line's `ref`), `source: payout`,
  `meta` (`payoutMeta`: what the line looked like when it paid, so the bank can
  say what the entry was for) and `action: payout:<ruleId>`, a namespace `earn()`'s per-action daily cap never
  counts. The ring contest is kind `prize`; every other rule is `earn`.
- **Top-up.** `EconomyService.mint(userId, { currency, amount, kind, ref, ... })`
  treats `amount` as what the ref is worth in total and pays only the shortfall,
  read strictly from the whole ledger under the user lock. A second settle
  writes nothing; two racing settles (an event and the reconcile) pay once; a
  line that grew (Tuesday's green day on top of Monday's, more rings) pays the
  difference. A ref already paid more than the line now says (a rate cut, a
  retracted grade) is not clawed back. "Paid" counts only `PAID_KINDS` entries:
  a clawback is an `adjust` under its own ref (e.g. `<ref>:clawback`), and even
  an adjust that reuses the line's ref does not count, so a correction never
  makes the payout mint again.
- **Rings pay per finished workout.** A `ring-threshold` line's `count` and
  `amount` stay live (the board and its pop count rings as they happen), but the
  payout mints only for its FINISHED workouts: the line's `sessions`
  (`fitnessRingsProvider.standings`), kept when `final` (finalized, or ended
  longer ago than the 30-minute resume window, `evaluateRecapReadiness`), taken
  in end order and each priced at the week's running ring total with
  `ringAmount` (`ringSteps`). Each step mints under the line's one ref, so it
  pays only what is still short: one entry per workout, with
  `meta.session = { id, title, startMs, rings }`; a workout that crosses no
  new silver step writes nothing and its rings roll into the next entry; a
  week already paid at live rates is not paid twice. A running workout waits
  for a later hourly reconcile, so the bank trails the board by up to about
  90 minutes after a workout ends.
- **What a workout was worth, before the bank has it.** `WorkoutEarningsService`
  (`application/WorkoutEarningsService.mjs`) prices one ride with the same steps
  as the payout — the ring line's sessions in end order, this one counted even
  before it is final — so the fitness coin ceremony's "+N" matches the entry
  that lands later. Its `total` is the wallet plus the ring silver still owed
  under the line's ref, i.e. what the bank will hold once the payouts land.
  `GET /api/v1/earnings/workout/:sessionId` (learners in that session only;
  one failing wallet omits that learner, `economy.workout-earnings.learner-failed`)
  and `GET /api/v1/earnings/standings` (per learner: wallet silver, week rings,
  `gem: 'leading' | 'won' | null` from the `ring-contest` line). Both read-only,
  `no-store`; with the catalog `off` they return no learners. Logged
  `economy.workout-earnings.query`.
- A corrupt shard throws `CORRUPT_LEDGER` inside `mint` and nothing is written;
  the payout logs it at `error`.
- A learner on the roster who is not a household user (no wallet) logs
  `economy.payout.not-a-user` at info once per process, then is skipped. A
  player who is not on the school roster logs `economy.payout.unknown-learner`
  at debug.

### Triggers

`startEconomyPayouts` (`composition/earnings.mjs`) wires two triggers onto one
path:

- **Events.** `school.session.outcome-recorded` (`{learnerId, studyDay?}`) and
  `piano.lesson.completed` (`{userId}`), debounced per learner and week (30 s)
  so a burst of grades settles once. A fact that names a study day settles that
  day's week, so a late grade re-prices the week the work belongs to. Only a
  first settle or a grade correction names it, never a resettle such as a
  retried close or a late sign-off. A study day in the current week shares the
  current week's debounce.
- **Hourly reconcile.** `economy:payout-reconcile` (`0 * * * *`) settles every
  learner for the current week. It catches what no event announces: day-met and
  week-met lines turn true as days close, and the ring contest at Saturday noon.
  The agents scheduler runs a task at most once per clock hour (it dedupes on
  `<task>:<YYYY-MM-DDTHH>`), so a finer cron would still run hourly.

Both triggers are gated like the other scheduled jobs (production, or
`ENABLE_CRON=true`); a backend without cron logs `economy.payout.disabled` and
subscribes to nothing. Enabled, they always subscribe and register, so a reload
from `off` to `dry-run` or `live` needs no restart; while the catalog reads `off`
both return before any preview (`economy.payout.off`, debug). A settle failure
is logged `economy.payout.failed` (error for `CORRUPT_LEDGER`, warn otherwise)
and never thrown into the event bus or the scheduler.

### Late evidence and grace

While today's study day is Monday, Tuesday or Wednesday, the hourly reconcile
also settles the **previous** week, each week in its own try so one failing does
not skip the other. "Today" is the preview's own `currentStudyDay()`, the same
clock, timezone and boundary hour `week: null` resolves with. A grade event
names its session's study day at any time. Later than Wednesday, with no event, a
past week is not paid automatically. Silver minted after Sunday's week close
sits in the wallet and converts at the next close.

### Dry-run and logging

- `dry-run` logs `economy.payout.would-mint { learnerId, ref, currency, amount,
  ruleId }` per entry and writes nothing (no wallet snapshot either). These
  lines are what the owner prices the catalog against before going live (see
  [Rollout](#rollout)).
- `live` logs `economy.mint` at info for each entry that minted.
- Settles repeat, so `would-mint`, `held` and `bad-amount` (a non-integer amount,
  never minted) log only when that line's status or amount changed since the
  process last logged it. The per-settle summary `economy.payout.settled` is
  `debug` unless something minted or a count changed.

## Week close

`WeekCloseService` (`application/WeekCloseService.mjs`) turns unspent silver into
gold, which is kept for good. `startWeekClose` (`composition/earnings.mjs`)
registers `economy:week-close` on `week_close.cron` (for example
`"30 23 * * 0"`, Sunday 23:30 local), behind the same scheduler gate as the
payouts (`economy.week-close.disabled` when off). The cron is read once at boot,
so a change needs a restart; a null or blank cron registers nothing and logs
`economy.week-close.no-cron` once. The task is registered in every mode, so a
reload from `off` needs no restart.

Per close, `catalog()` is read once (mode and rules):

- **Which week.** The week whose Sunday is today's study day or has most
  recently passed (`closingWeekFor`, from the preview's `currentStudyDay()`).
  At Sunday 23:30 that is the current week. The only other entry point is a
  direct `WeekCloseService.close()` call from code (no route or CLI runs it,
  and `scheduler.trigger` runs agent assignments, not tasks); with no week, a
  call on Monday to Saturday closes the previous week. A week whose Sunday is
  still ahead is refused: `economy.week-close.refused { weekId, today,
  reason: week-not-ended }` and a `ValidationError` with code `WEEK_NOT_ENDED`.
  The scheduler has no catch-up: a close missed while the backend was down
  waits for next Sunday, which converts the whole balance anyway.
- **Settle first.** `PayoutService.settleAll({ week })` once more, for the
  last-minute contest and day-met lines. One learner's failed settle is logged
  by the payout and does not block that learner's close. A week-wide failure
  (the roster read) logs `economy.week-close.settle-failed` (warn; error for
  `CORRUPT_LEDGER`) and the close goes on without the roster.
- **Whose wallets.** Every roster learner from that settle (a roster learner
  the payout reports `not-a-user` has no wallet and is skipped), plus every
  other household user (`EconomyConfigProjection.users()`) who has at least
  one payout entry: a kid who left the roster, a piano-only earner. A payout
  entry is one `isPayoutEntry` accepts, so a deposit that names
  `source: payout` does not count. That check runs inside the convert lock
  (`convert({ requireEntry: isPayoutEntry })`, status `not-an-earner`). Parents'
  and legacy-deposit silver never converts: arcade metered spend runs on
  silver, and a wallet that never had a payout keeps it. Without a roster only
  the payout earners close.
- **What converts.** The wallet's whole silver balance at close time (the fold of
  the whole ledger), not the week's earnings. Gold = silver × rate, exact
  (`convertedAmount(amount, rate, 'gold')`, quantized to 6 places): 56 silver
  at 0.1 is 5.6 gold, 3 silver is 0.3. A rule into a whole-coin currency
  (gems) still floors, and a balance too small for one coin there converts
  nothing and logs `economy.week-close.below-rate`: silver is never spent for
  zero. Zero silver writes nothing.
- **Rules.** Each `week_close.convert` entry needs `from` and `to` in
  silver/gold/gems and different, and `rate` a positive finite number; a
  currency may appear in only one rule. A bad entry logs
  `economy.week-close.bad-rule { rule, reason }` and is skipped. Only listed
  rules run (the household's is `silver → gold` at 0.1).
- **The pair.** `EconomyService.convert` reads the ledger strictly, checks
  idempotency and appends both halves inside one user-lock body, so a payout or
  spend cannot land between the balance read and the pair. Both halves share one
  `at`, `action: week-close`, `source: week-close`,
  `evidenceRef: close:<learner>:<week>` and
  `meta: { weekId, from, to, rate, spent, got }` (enough for the history line
  "56 silver → 5 gold · Sunday", figures floored):

  | Half | `ref` | `currency` | `delta` |
  |---|---|---|---|
  | out | `close:<learner>:<week>` | silver | −balance |
  | in | `close:<learner>:<week>:gold` | gold | +balance × rate (exact, 6 places) |

- **Idempotent.** The out half's ref means the week is closed: a second close
  writes nothing (`already-converted`). The out half is written first, so a
  crash between the appends leaves gold owed, never gold from nothing, and
  `wallet.yml` is rewritten from the ledger even when the in half throws (a
  snapshot failure then logs `economy.convert.snapshot-failed` at error and
  the append's own error still reaches the caller). The
  next close of that week writes the missing in half from the out half's own
  `meta` (`economy.week-close.repaired`, warn) without re-reading the balance:
  its `to`, `rate` and `got`, even if the rule has changed since (a different
  target logs `economy.convert.repair-original-target`). An out half whose
  figures do not add up (delta not negative, `meta.from` not the rule's
  `from`, a bad `meta.to` or `meta.rate`, or `meta.got` not a valid positive
  amount in `meta.to` — whole for silver/gems, fractional allowed for gold —
  or above `convertedAmount(spent, rate, to)`) is refused (`BAD_CONVERT_HALF`), as is an in
  half without its out half (`ORPHAN_CONVERT_HALF`). A corrupt shard throws
  `CORRUPT_LEDGER` and nothing is written. Those three need a person and log
  `economy.week-close.failed` at error; any other failure logs it at warn.
- **Modes.** `off`: nothing (no settle, no read; `economy.week-close.off` at
  debug). `dry-run`: logs
  `economy.week-close.would-convert { learnerId, weekId, silver, gold, rate }`
  and writes nothing. `live`: writes and logs `economy.week-close.converted` per
  learner at info (the one info line per conversion; `EconomyService` logs
  `economy.convert` at debug). A wallet with nothing to do logs
  `economy.week-close.skipped { status }` at debug. Every run ends with
  `economy.week-close.closed` (counts).
- A metered session open at close time spends 0 for the rest of its run: the
  silver it was drawing on has become gold, and a settle never charges more
  than the silver balance.

## Early passes

One pass a day lets a learner open one unit of a privilege (one piano game)
before the day's schoolwork is done, paid in silver or gold. Economy owns the
purchase, the cap and the price; the privilege owns consumption (the piano
kiosk consumes the pass when the game ends). Authorization is `trust`: no PIN,
a kid buys their own. The pure helpers are `domain/passes.mjs`; `EconomyService`
does the locking and the writes.

**Price.** `passes.<key>.price.{silver,gold}`; a price of 0 (or unset, or not a
whole number) means not sold in that coin, so a catalog priced
`{ silver: 0, gold: 0 }` sells nothing until the owner prices it. Gems never buy
a pass (`PASS_SELLABLE_COINS` is silver and gold). Buying while the catalog
mode is not `live`, in a coin it is not sold in, or an unknown coin, or for a
privilege no pass lists, is `PASS_NOT_SOLD`.

**Cap.** `cap: { per: study-day, count, across }`. `count` passes per learner
per study day, in any state: a refunded pass still uses up the day.
`across: all-passes` counts every pass that day, whatever privilege; any other
value counts only this pass. A `per` other than `study-day` (or `day`) sells
nothing. No `cap` reads as one a day across all passes.

**Study day.** The 4 am boundary in the household timezone, from the same
`studyCalendar` as the earnings preview. A pass expires when the study day
rolls over: `activePass` returns null after 4 am.

**Active limit.** An active pass also ends `max_active_ms` after its purchase
(recorded on the marker as `maxActiveMs`; an older marker without it reads the
30-minute default, `DEFAULT_MAX_ACTIVE_MS`). Past the limit `passState` reads
it `consumed` with `reason: 'expired'` and `endedAt` at the limit. Nothing is
written and nothing is refunded. `activePass`, `passesToday`, the bank and the
kiosk's access read the same state, so a kiosk reload or a consume that never
landed cannot open a second game after the limit. A real transition in the
ledger always wins. A late consume of an expired pass is a no-op
(`duplicate: true`); a refund is `PASS_NOT_ACTIVE`, because the limit is
checked before the refund window. The window (60 s) is far shorter than the
limit, so this only matters for a catalog that sets them the other way round.

**Ledger entries.** The pass id is `pass:{learnerId}:{studyDay}` (a second
pass the same day, only when `count` allows it, is `….2`). Every entry carries
`evidenceRef` = the pass id and `source: pass`; the action is the catalog key.

| Entry | `ref` | Written by |
|---|---|---|
| `pass` marker, `meta.state: active` (`privilege, coin, price, boughtAt, refundWithinMs, maxActiveMs`) | pass id | buy |
| `spend`, −price in the coin | pass id | buy |
| `pass` marker, `meta.state: consumed` (`playedMs`) | `{id}:consumed` | consume |
| `earn`, +what was paid, action `{key}-refund` | `{id}:refund` | refund |
| `pass` marker, `meta.state: refunded` (`playedMs, reason`) | `{id}:refunded` | refund |

The ledger is append-only, so a state change is a new marker. `passState`
reads the first transition (a consumed marker, or the refund's first write),
as the writes enforce. Every buy and transition runs in the user lock over a
strict ledger read, and affordability is the folded ledger balance, never the
wallet snapshot. A refusal writes nothing.

**Transitions.** The first transition wins: consuming a refunded pass, or
refunding a consumed one, is `PASS_NOT_ACTIVE`. Consuming twice, or refunding
twice, is a no-op (`duplicate: true`) and refunds once.

**Write order fails safe for the kid.** A purchase writes the marker, then the
spend: a crash between leaves a pass nobody paid for (`paid: 0`), never coins
gone with no pass; it is not charged later. The buy still fails: the error
carries `passId`, and `economy.pass.unpaid { learnerId, passId, error }` is logged
at error. A marker that fails writes nothing. A refund writes the earn, then the
marker: the earn is the refund's commit point, so with it present the pass reads
refunded and a retried refund writes only the missing marker. The refund hands
back what was paid (0 for an unpaid pass). The wallet snapshot is refreshed
after either, even when an append fails; the append's error is what the caller
sees (`economy.pass.snapshot-failed` logs a snapshot failure).

**Refund window.** Allowed only while the pass is active, on its own study day,
when the client's `playedMs` is under `refund_within_ms` (recorded on the
purchase marker) **and** the server's time since purchase is under that window
plus `REFUND_SETUP_MS` (5 minutes for picking and loading a game, exported from
`EconomyService.mjs`). The second bound stops a client claiming `playedMs: 0` an
hour later. A catalog pass that omits `refund_within_ms` gets 60000; one set to
0 has no refund window. Otherwise `PASS_REFUND_CLOSED`.

The pass state carries `refundWithinMs` (as recorded on the purchase, null on
an older marker that lacks it) and `maxActiveMs`, so the bank's
`pass[privilege]` and the kiosk's `access.pass` say the window. The kiosk
refunds only when `playedMs` is under that window minus a 5 s network margin;
with no window (null or 0) it consumes.

**Gating fails closed.** `activePass`, used for gating, reads strictly: on
`CORRUPT_LEDGER` it logs `economy.pass.ledger-unreadable` (warn) and returns
null, so games stay locked. It never falls back to a lenient read: a study day
spans two UTC shards, so a purchase can sit in one shard and its `:consumed`
marker in the next, and skipping the unreadable one would make a used pass
read active again.

**Logs** (info, one line each): `economy.pass.bought`, `economy.pass.consumed`,
`economy.pass.refunded`, `economy.pass.refused` with `{ learnerId, privilege,
coin, price, reason }` (the refusal code as `reason`).

## Bank and HTTP API (`/api/v1/economy`)

| Method / Path | Body | Returns |
|---|---|---|
| GET `/users/:userId/wallet` | — | `{ userId, balance, balances, session }` |
| GET `/users/:userId/bank` | — | `{ userId, mode, studyDay, balances, history, pass: { [privilege]: … }, offers, weekEndsAt, weekEndsOn }` |
| POST `/users/:userId/deposit` | `{ amount, note? }` | `{ userId, balance }` |
| POST `/users/:userId/earn` | `{ action, ref?, amount? }` | `{ userId, earned, capped, duplicate, balance }` |
| POST `/users/:userId/sessions` | `{ action, source }` | `{ userId, sessionId, balance, drainPerSecond }` |
| POST `/users/:userId/sessions/:sessionId/settle` | `{ coins }` (cumulative) | `{ userId, balance, depleted }` |
| POST `/users/:userId/sessions/:sessionId/close` | `{ coins? }` (cumulative) | `{ userId, balance }` |
| POST `/users/:userId/passes` | `{ privilege, coin }` | `{ userId, pass, balances }` |
| POST `/users/:userId/passes/:passId/consume` | `{ playedMs? }` | `{ userId, pass, duplicate }` |
| POST `/users/:userId/passes/:passId/refund` | `{ playedMs, reason? }` | `{ userId, pass, refunded, duplicate, balances }` |

The routes are unauthenticated in slice 1 (decided). The ledger `source` of a
deposit (`admin`) or an earn (`api`) is set by the router; a body's `source` is
ignored, so no request can write an entry that passes for a payout or a week
close. The pass routes read only the fields above from the body.

**Errors.** Domain errors map to HTTP: `ValidationError` → 400 (bad amount,
blackout, no balance, existing session), `EntityNotFoundError` → 404 (unknown
user). Pass errors carry a `code`. `PASS_CAP`, `PASS_NOT_SOLD`, `PASS_NOT_ACTIVE`
and `PASS_REFUND_CLOSED` → 409: the request is well-formed, and the day, the
catalog or the pass's state refuses it (a price the owner sets later can make
the same request succeed). `PASS_UNAFFORDABLE` → 402 with `{ coin, price,
balance, shortfall }`. An unknown pass, or one of another learner → 404; a
missing privilege or coin, or a `playedMs` that is not a non-negative number →
400.

### The bank (`BankService`)

`GET …/bank` (`application/BankService.mjs`, `Cache-Control: no-store`) is the
one read the Portal bank screen (opened from the board's coin cell), the piano
kiosk and its lock screen share.

**History** is the last 50 ledger lines in plain words, newest first
(`{ text, at, kind, ids, source, label, detail, legs, balanceAfter }`, from
`domain/historyText.mjs`). `text` is the sentence; the rest is the same line
broken into parts so a client can lay it out as a table. `source` is
`entrySource`: `payout`, `earn`, `prize`, `refund`, `spend`, `deposit`,
`correction`, `withdraw`, `conversion` (or `other`). `label` is the words after
the amount, `detail` what a payout was for (below, or null), `legs` the signed amounts per currency (a conversion has two), and
`balanceAfter` the `{ silver, gold, gems }` balances once the line landed. It is
folded oldest first over the whole ledger read, before the 50-line cut, each
currency floored at 0, so line 50 still knows what older lines left behind. An
older client reads `text` only. Figures in `text` are floored (gold is
fractional; `legs` and `balanceAfter` are exact). The sentences: "+2 silver · Green
day", "−3 silver · early pass", "+3 silver · early pass refunded", "56 silver →
5 gold · Sunday", "+2 silver · Korean · Tuesday", "+6 silver · Rings · Sonic &
Sega All Stars Racing · 7:19 pm · 588 rings". A payout's `detail` comes from the
`meta` the payout keeps on the entry (`payoutMeta`: the line's `kind`, `count`
and, for `section-day` and `day-met`, the study `days` that paid so far; for a
ring entry, `ringSteps`' `session`). A ring entry names its workout: the media
title (or "Workout" when nothing played), its start time in the household
timezone and the kid's rings in it. A ring entry from before per-workout pay
reads "N this week". A week line pays its growth in
several entries under one ref, so a per-day entry's detail is the weekday(s) in
its `days` that no older entry of the same ref and currency had; a ring entry's
is the week's ring count when it paid. With a day detail the rule's trailing
bracket ("(each day done)") is dropped from `label`. An entry minted before
`meta` existed has no detail and reads as its label. A payout is named by the current week's preview line it paid
for (its `evidenceRef`), then by the ruleset's label for its `ruleId`, then
"schoolwork" (`economy.bank.labels-unavailable` when a label source fails). The
preview labels are cached per learner and week for 60 s (`cachedWeekPreview`,
shared with `rewardFor`), so a polled bank runs one preview a minute. Pass
spends and refunds are matched on `source: pass`. The two halves of a conversion
(same `evidenceRef`, opposite signs; `at` is not compared, so a repaired pair
still pairs) read as one line, named by the local weekday. Zero-delta `pass`
markers are left out.

**Balances and offers.** `balances` and each offer's `affordable` are folded
from the same ledger read as the history, never the wallet snapshot, so an offer
says what `buyPass` will decide. `offers` maps each privilege a pass opens to
its quote: `[{ coin, price, affordable }]`, one row per coin the pass is sold
in, so `[]` means not for sale. Unless the catalog mode is `live`, `offers`
is `{}`. `mode` is the catalog mode, so the Portal shows a neutral bank
("Coins start soon", no balance number) until coins are live.

**Pass, keyed by privilege.** `pass['piano.games']` is that privilege's latest
pass today, or the "none" shape (`passId: null, state: 'none'`, the same keys a
real pass has), plus `capUsed`: whether today's passes already use up its cap
(across all passes, a pass for another privilege counts). Today's shards are
read strictly here: one that does not parse gives `state: 'unknown',
capUsed: null` and logs `economy.bank.pass-unreadable`, rather than claiming the
day's pass is unused.

**When the week ends.** `weekEndsAt` is the next fire of `week_close.cron` in
the household timezone, by cron-parser (the scheduler's parser), so any cron the
scheduler accepts works. No cron, or one that does not parse (logged
`economy.bank.cron-unreadable`), gives the end of the week's Sunday study day
(Monday at 4 am). `weekEndsOn` is the study day that close belongs to
(`weekCloseStudyDay`: the instant read a millisecond early, in the household
timezone with its boundary hour, so a Monday 4 am close is Sunday's). A client
counts days to the close as `weekEndsOn − studyDay`, by date alone, with no
timezone of its own. Two caveats:

- The scheduler (`AgentAssignmentScheduler.registerTask`) parses the cron with
  no timezone, so the job fires in the **process** TZ. In the container that is
  `TZ`, set by `docker/entrypoint.sh` from `system.yml` `.timezone` (the
  Dockerfile defaults it to `America/Los_Angeles`). The bank and the passes read
  the household timezone (`getHouseholdTimezone`), a separate setting. The two
  must match, or `weekEndsAt` and the real close disagree. `createEconomyApi`
  logs `economy.timezone-mismatch` at warn on boot when `TZ` is set and differs.
  School's configured zone must match both too: the process TZ, the household
  TZ and School's zone are one setting in practice.
- The job's cron is read once at boot, while the bank reads the live catalog. After
  a cron edit and a reload, `weekEndsAt` shows the new schedule but the job keeps
  the old one until a restart.

**For the kiosk and Portal.**

- Check `pass['piano.games']` (`state === 'active'`) for the game unlock, and
  `capUsed` for "sneak used today".
- `state: 'unknown'` means the ledger could not be read: treat games as locked
  and offer no sale.
- After **any** `POST /passes` failure, re-read the bank (refresh in a
  `finally`). A storage failure after the marker leaves an unpaid pass that is
  real and active. The error then carries `passId`, and the server logs
  `economy.pass.unpaid` at error.
- Pass ids hold colons and may end in `.2`; `encodeURIComponent` them in the
  consume and refund paths.

## Integration points

School and piano import no economy code. Composition hands them duck-typed ports
built from `economyApi` (`composition/economyApi.mjs`).

- **School: what a sheet is worth (`rewardFor`).** School's "print my next sheet"
  dry run (`GET /api/v1/school/self-service/learners/:id/next`, behind the
  Portal bank screen's ways to earn, the agenda tape's `Next: Math +2`
  and the piano lock's button) asks `rewardFor({learnerId, unit})` for
  `{silver, gems}` or null. `createEconomyApi` hands School a late-bound thunk
  (`economyApi.rewardFor`, passed by `lifecycle-runtime.mjs`); the earnings
  runtime binds it with `useSheetRewards(cachedSheetRewards(...))` once the
  preview exists. Until then, and whenever the answer is unclear, it is null and
  no surface shows an amount. The answer is `sheetReward`
  (`domain/earnings/sheetReward.mjs`) over the learner's current-week preview,
  from the same 60 s cache as the bank's labels. Reward labels on every surface
  read `+N silver` / `+N gem(s)` from it.
  - An amount only when the catalog is `live` (off and dry-run are null, without
    running a preview: dry-run coins are not real, and the digest says so), the
    school evidence is `ok`, and exactly one sheet-kind rule matches the unit.
  - The amount assumes the sheet is required work and is passed; a unit marked
    `elective` is null (School's `unitView` sets it when today's section is
    `excused`).
  - **Total-gain pricing.** It is what one more occurrence adds to the line's
    rounded total, `round((n+1)·s·m) − round(n·s·m)` at the learner's (possibly
    overridden) reward `s` and multiplier `m`, because a payout mints
    `round(total) − paid`: at ×1.5 a 1-silver day with one day served adds 1,
    not 2. A learner override is priced, not refused.
  - `section-day` (matched on subject only, as the evaluator does): one more
    day while today's section is `obligated`; null once it is `served`
    (another sheet adds nothing), and for an elective, a faulted day or no row
    today.
  - `section-week` (subject only): the week's price only when this sheet
    finishes the week: Friday or later, the line `pending`, every earlier day
    served or excused, today obligated, nothing obligated after today, no day
    unworked.
  - `unit` (subject, unit-id prefix, course, as `matchesUnit`): the per-unit
    price while the rule's `effective` dates include today. A unit rule keyed
    by `courseId` is null: the sheet does not carry its course.
  - `day-met`, `week-met`, `ring-threshold`, `ring-contest`: never credited to a
    sheet, and they do not count as a match.
  - Two matching rules, a unit with no subject, or one more occurrence that adds
    no silver and no gems are null too. A failure (preview or catalog) is null
    and warns `economy.sheet-reward.failed` once per learner until a read for
    that learner works again; a learner off the roster is null, unwarned. The
    cache means a section finished a moment ago can still show its `+N` for up
    to a minute.
- **School: the agenda tape's economy line.** The morning agenda opens with
  `In the bank: 7 silver · Next: Math`, only while the catalog mode is `live`
  (an `economyMode` reader, `() => configProjection.catalog().mode`, is handed
  to `createSchoolLifecycle`). School's composition (`agendaEconomy.mjs`)
  builds a `bankSummary(learnerId)` port over `economyService.peekBalance(id).silver`:
  the *unspent* silver in the bank (the figure the Portal bank screen shows and
  the week close converts), not the week's mints. `peekBalance` is the pure
  read: `#assertUser`, then `foldBalances` over the ledger, with no wallet
  write and no session reap (unlike `getBalance`). The port checks `hasUser`
  first, so a learner without a wallet gets no line and one info log, not a
  warn on every print. Read at print time with a 2 s bound; a failure, a timeout
  or an unknown figure prints no line and never delays or breaks the tape. See
  the [School reference](../school/README.md), "The first line under the name
  is the week's silver".
- **School: the parent digest port.** The 6 pm parent digest and the zero-days
  alert are School's (`SchoolParentDigest`, composed in
  `composition/parentDigest.mjs`; see
  [push-standard.md](../notifications/push-standard.md#the-parent-digest-and-the-zero-days-alert)).
  The economy supplies the catalog's `digest` block, `mode`, the
  `studyCalendar`, and `economyService.getHistory` / `hasUser`, from which
  `createDigestEconomyPort` reads the day's silver (positive silver deltas on
  payout entries, the `isPayoutEntry` test, inside the study day) and passes
  used (the day's purchase markers less refunds). `digest.cron` is read once at
  boot (`school:parent-digest`, plus an hourly `school:parent-digest-retry`);
  `zero_days_alert` and `mode` are read on every run, and null turns the alert
  off. In `dry-run` the digest shows no silver figure and ends `Coins not live
  yet`; with `off` coins are not mentioned.
- **School: Portal coin cell, bank door and bank screen.** The board's coin
  cell opens the bank door, and the bank screen reads `GET …/bank`; there is no
  bank strip. See the School README ("The coin cell is the bank's door", "The
  bank screen").
  School forwards `economy.coins-changed` to the Portal's `school` topic
  (`EventBusSchoolRealtimeAdapter.relayCoinsChanged`, see
  [Events](#events-and-logging)).
- **School: no per-unit coins.** School's own per-unit reward in
  `CloseSessionOutcome` (`lifecycle.economy.enabled` in `school.yml`) stays off
  (`false`): school work is paid by PayoutService only, and turning both on
  would pay a unit twice.
- **School: grade reconciliation.** `EconomyService.adjust(userId,
  { delta, source, ref, note })` applies an exact signed correction outside
  earn caps. The reference is derived from the append-only grade adjustment or
  retraction id, making retries idempotent. The ledger may go negative; the
  displayed wallet remains floored at zero and later earnings repay the debt.
  School appends a reconciliation success or failure event so a partial
  failure can be retried safely without replacing the original machine grade.
- **Piano: the early pass.** The kiosk reads `GET …/bank` only after School's
  entitlement says a real `incomplete`, unlocks Games for an active
  `pass['piano.games']`, buys from `SchoolLock`, and consumes or refunds when the
  game ends. The Games tile stays enabled under the school lock whenever today's
  cap is unused (`capUsed === false`, `state` not `unknown`), whether or not an
  offer is affordable, so a child with no silver still reaches the lock's Print
  button; with School's self-service off (`…/next` answers 404) the lock shows
  progress only. The kiosk side is in
  [games-budget-gate.md](../piano/games-budget-gate.md#the-early-pass-on-the-tablet).
- **Piano: lesson completions.** `piano.lesson.completed` (`{userId}`) is a
  payout trigger. Separately, the playback progress use case
  (`__capabilities/playback/server/application/usecases/RecordPlaybackProgress.mjs`)
  fires `economyService.earn(..., { action: 'piano-lesson-complete', source:
  'piano', ref })` fire-and-forget the first time a lesson is newly completed.
  That legacy earn pays only if the catalog's `earn` map prices the action;
  with an empty map it skips. An economy failure never breaks progress
  recording. (Assumes the `/log` `userId` is piano-kiosk-only; see the design
  doc's "Known assumptions".)
- **Fitness: rings.** `fitnessRingsProvider.standings` (rings by session start
  instant) is the ring evidence the preview prices.
- **Arcade: metered spend.**
  `__app_modules/wellness/fitness/browser/widgets/EmulatorGame/coinMeteredGate.js`
  opens a spend session and drains coins as the timer runs, surfacing the balance
  in the EmulatorConsole overlay (`session.coins`) and its `depleted` state
  ("Out of coins — earn more!"). Off by default; enabled per widget via
  `config.economy.enabled`.

## Events and logging

**`economy.coins-changed`.** With an `eventBus` (from `createEconomyApi`), every
write that moves a balance or a pass publishes `economy.coins-changed {userId,
reason}` on the internal bus through the `IEconomyEvents` port
(`adapters/eventbus/EventBusEconomyEvents.mjs`). It uses `publish` only, never
`broadcast`, so the topic never reaches WebSocket clients; a bus with no
`publish` gets nothing (`economy.coins-changed.no-publish`, logged once). It
fires after the write's per-user lock is released: a subscriber that writes the
same user's ledger in reply would otherwise wait on the lock its caller holds.
`reason` is `deposit`, `adjust`, `earn`, `mint`, `convert`, `pass-bought`,
`pass-consumed` or `pass-refunded`. A dry run (no `would-mint` publishes), a
duplicate, a zero grant or a refusal publishes nothing. Metered sessions do not
publish. A listener that throws is logged
(`economy.coins-changed.publish-failed`) and never fails the write. A payout run
mints entry by entry, so the events come in bursts. School forwards it to the
Portal's `school` topic as `{event: 'coins-changed', learnerId}`.

**Topics the economy subscribes to:** `school.session.outcome-recorded` and
`piano.lesson.completed` (payout triggers).

**Log events,** by area (info unless noted):

| Area | Events |
|---|---|
| Catalog and boot | `economy.catalog.unknown-mode` (warn), `economy.timezone-mismatch` (warn), `economy.earnings.unavailable` (error: the earnings runtime, the payouts or the week close failed to start; School boots without them) |
| Earn rules and preview | `economy.earn-rules.revised`, `economy.earn-rules.corrupt` (error), `economy.earnings.school-unavailable` / `rings-unavailable` (warn) |
| Payouts | `economy.payout.would-mint`, `held`, `bad-amount`, `settled` (debug unless something changed), `off` (debug), `not-a-user`, `unknown-learner` (debug), `failed` (warn; error for `CORRUPT_LEDGER`), `disabled`; `economy.mint` |
| Week close | `economy.week-close.would-convert`, `converted`, `skipped` (debug), `closed`, `below-rate`, `bad-rule`, `refused`, `repaired` (warn), `settle-failed`, `failed`, `off` (debug), `no-cron`, `disabled`; `economy.convert` (debug), `economy.convert.repaired` (debug), `economy.convert.repair-original-target`, `economy.convert.snapshot-failed` (error) |
| Passes | `economy.pass.bought`, `consumed`, `refunded`, `refused`, `unpaid` (error), `snapshot-failed`, `ledger-unreadable` (warn) |
| Bank | `economy.bank.pass-unreadable`, `economy.bank.cron-unreadable` (warn), `economy.bank.labels-unavailable` (warn), `economy.history.unreadable-at` (warn) |
| School reward port | `economy.sheet-reward.failed` (warn, once per learner) |
| Events | `economy.coins-changed.no-publish`, `economy.coins-changed.publish-failed` |

Client-side events (`economy.bank.door-opened`, `economy.bank.door-open-failed`,
`economy.bank.opened`,
`piano.early-pass.*`) are listed with their surfaces in the School README and
games-budget-gate.md.

## Config reload and restarts

`policy()` and `catalog()` read the served snapshot through
`getHouseholdAppConfig`, so `dscli system reload --allow-write` (or `--app
economy`) picks up these edits without a restart:

- `mode` (payouts, week close, `rewardFor` and the digest read it per run);
- `passes` (prices, caps, refund window);
- `week_close.convert` rules (read per close);
- `digest.zero_days_alert`;
- the legacy `earn`/`spend` maps.

`earn-rules.yml` is read fresh per request and needs no reload at all.

**Needs a restart:** every cron, because the scheduler registers tasks at boot
and has no unregister.

| Job | Cron | Source |
|---|---|---|
| `economy:payout-reconcile` | `0 * * * *` | fixed in code |
| `economy:week-close` | `week_close.cron` | catalog, read at boot |
| `school:parent-digest` | `digest.cron` | catalog, read at boot |
| `school:parent-digest-retry` | `0 * * * *` | fixed in code |

All four register only where the scheduler runs (production, or
`ENABLE_CRON=true`). A null cron registers nothing, and setting one later needs a
restart. The payout triggers and the week-close task register in every mode, so
moving `mode` off → dry-run → live needs only a reload.

To stop payouts, set `mode: off`; do not delete the file, because a reload keeps
the old snapshot when the file is missing.

## Rollout

1. Ship the catalog in `mode: dry-run` with passes priced 0 (not for sale). Payouts
   log `economy.payout.would-mint`, the week close logs
   `economy.week-close.would-convert`, `rewardFor` answers null (no `+N` on any
   surface), and the digest ends `Coins not live yet`. No balance moves. No pass
   can be bought before live (`PASS_NOT_SOLD`) and the bank offers nothing.
   The kid surfaces show no silver figure: the agenda prints no economy line,
   and the Portal bank screen says "Coins start soon".
   With `passes` in the catalog, a school-locked kid's piano Games tile is
   enabled and opens SchoolLock (today's progress and the Print button). That
   is intended, not the gate failing open: SchoolLock sells nothing until live.
2. Run one week in dry-run. The owner reads the would-mint volumes per learner
   and rule and prices the earn rules, the conversion rate and the pass.
3. Set `mode: live` and reload. Payouts mint from the next settle (event or the
   hourly reconcile); minting tops up to what each line is worth, so the
   current week's earned lines are paid in full at the first live settle.
4. Keep `lifecycle.economy.enabled: false` in `school.yml`, so school work is
   paid by PayoutService only.

The household's own prices and schedule are private configuration, not part of
this reference.

## Architecture

All economy code lives in `__app_modules/money/economy/server/`:

| Layer | Files |
|---|---|
| Domain (pure, no I/O) | `domain/entities/Transaction.mjs` (`createTransaction`, `CURRENCIES`, `PAID_KINDS`, `isPayoutEntry`, `foldBalances`, `foldBalance`); `domain/services/policy.mjs` (`resolvePolicy`, `inBlackout`, `drainPerSecond`); `domain/passes.mjs`; `domain/historyText.mjs`; `domain/earnings/` (`validateRuleset`, `resolveRules`, `withUserOverride`, `evaluateEarnings`, `earningRef`, `sheetReward`); barrel `domain/index.mjs` |
| Application | `application/EconomyService.mjs` (balance math, policy, `mint`, `convert`, passes, `peekBalance`, `getHistory`, `REFUND_SETUP_MS`); `EarningsPreviewService.mjs` (windows, contest close, per-source failures); `PayoutService.mjs`; `WeekCloseService.mjs`; `BankService.mjs`; `EarnRulesService.mjs` (revisions); ports `ports/IEarnRulesStore.mjs`, `ports/IEarningEvidenceSource.mjs`, `ports/IEconomyEvents.mjs` |
| Adapters | `adapters/persistence/YamlEconomyDatastore.mjs` (ledger and wallet storage, `withUserLock`, strict reads); `adapters/persistence/YamlEarnRulesStore.mjs`; `adapters/config/EconomyConfigProjection.mjs`; `adapters/eventbus/EventBusEconomyEvents.mjs`; `adapters/school/SchoolEarningEvidence.mjs` (term verdicts read with `detail: true` for per-subject rows; graded sessions plus curriculum subject/course) |
| API | `api/economy.mjs` (`/api/v1/economy`), `api/earnings.mjs` (`/api/v1/earnings`) |
| Composition | `composition/economyApi.mjs` (`createEconomyApi`: services, `studyCalendar`, `rewardFor`, router); `composition/earnings.mjs` (`createEconomyEarningsRuntime`, `cachedWeekPreview`, `cachedEvidenceLabels`, `cachedSheetRewards`, `startEconomyPayouts`, `startWeekClose`) |

Wiring outside the module: `__backend/src/app.mjs` creates `economyApi`, the
earnings runtime and both start functions, and mounts `v1Routers.economy` and
`v1Routers.earnings`; `__backend/src/4_api/v1/routers/api.mjs` maps `'/economy'`
and `'/earnings'`. School's side is
`__app_modules/learning/school/server/composition/agendaEconomy.mjs`,
`composition/parentDigest.mjs`, `application/usecases/ManageEarnRules.mjs` and
`application/usecases/IssueSubjectNext.mjs`; ring evidence is
`__app_modules/wellness/fitness/server/application/measures/fitnessRingsProvider.mjs`.

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
  policy. This makes trust explicit rather than treating every child action
  as suspicious by default.
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

Tickets and the play clock, TV/screen-framework metered spend, cash-out + parent-mobile approval, PIN/NFC/
biometric auth (passes are `trust` only), bank route authentication, parent
dashboard, deposit admin UI (deposits are API-only).
