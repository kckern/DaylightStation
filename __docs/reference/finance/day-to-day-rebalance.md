# Day-to-day Burn-down and Rebalance

The Finance dashboard's **Day-to-day Spending** block charts one month of the
day-to-day budget as a burn-down. The hourly budget sync keeps that month on
its line by retagging *fungible* purchases between day-to-day and a short-term
bucket.

| Piece | File |
|---|---|
| Daily balances, month metrics | `__app_modules/money/finance/server/application/BudgetCompilationService.mjs` (`#buildDayToDayBudget`, `#calculateDailyBalances`) |
| Chart | `__app_modules/money/finance/browser/blocks/daytoday.jsx`, `dayToDayChartOptions.js` |
| Planner (pure) | `__app_modules/money/finance/server/domain/services/DayToDayRebalancer.mjs` |
| Apply step | `__app_modules/money/finance/server/application/DayToDayRebalanceService.mjs` |
| Caller | `FinanceHarvestService.harvest`, after compilation (job `budget` in `system/config/jobs.yml`, hourly) |

---

## 1. The chart

x is the day of the month. x=0 is the opening balance; x=N is the close of day N.

- **Baseline** (red area): the budget falling linearly to $0 on the last day.
  Being *on track* means the bar for today sits on this line.
- **Bars**: the day-to-day balance at each day's close (`dailyBalances[day].endingBalance`).
  Days after today are not drawn. A bar is red once the balance goes below zero,
  and the plot is shaded from that day on.
- **Projection** (dashed, current month only): the pace so far,
  `(budget − today's balance) / days elapsed`, carried from today's bar to the
  last day. It is red when the unclamped end value is below $0.
- Clicking a bar opens the month's day-to-day transactions.

The current month also carries an **Anticipated Day-to-Day Spending** row on its
last day, padding `spending` to the full budget. It has no `expenseAmount`, so it
does not move the daily balances. Month `spent` is `budget − closing balance`.

## 2. The rule

Some purchases can honestly be filed either way. An Amazon order can be
day-to-day **Shopping**, or **Housewares** under the short-term *Home & Auto*
bucket. Groceries, Fuel and every other tag are not fungible and are never
touched.

`budget.config.yml`, per budget period, under `dayToDay`:

```yaml
dayToDay:
  amount: 2000
  tags: [Food, Groceries, Fuel, Shopping, ...]
  rebalance:
    dayTag: Shopping        # day-to-day side of the swing (must be one of dayToDay.tags)
    swingTag: Housewares    # short-term side (must be one of a shortTerm bucket's tags)
    payees: [Amazon]        # optional; description substring, case-insensitive.
                            # Omit to treat every purchase with the tag as fungible.
    tolerance: 67           # optional dollars left alone in the running month; default one day of budget
    closedTolerance: 5      # optional, the same for the month just closed; default 5
```

No `rebalance` key means no rebalancing for that period. A `closed` period is
skipped.

## 3. What the sync does

On every harvest, after compilation, for each open period with a rule it plans
two months:

| Month | Target balance |
|---|---|
| current | the baseline at today's close: `budget × (1 − day / daysInMonth)` |
| previous (if in the same period) | $0 at month end |

`gap = balance − target`. Within `tolerance` the month is **on-pace** and nothing
moves. In the running month, moving buys back *in* waits until the gap passes
**twice** the tolerance. The target is today's close, so the month reads up to a
day under pace before the day's spending lands. Without this, one quiet day would
pull swing buys in and the next grocery run would push them straight back out.

- **Overspent** (gap < 0): candidates are this month's day-to-day transactions
  tagged `dayTag`, from a `payees` match, dated up to today. They move to `swingTag`.
- **Underspent** (gap > 0): candidates are short-term transactions tagged
  `swingTag`, from a `payees` match, dated in the month up to today. They move to `dayTag`.

Candidates carry **exactly one tag**. A row tagged `[Shopping, Groceries]`
would stay in day-to-day after its Shopping tag moved, so retagging it would not
move it.

The planner goes **largest first**: it retags the biggest candidate, re-measures
the gap, then takes the next biggest, and stops once the remaining gap is within
`tolerance`. A candidate that would carry the balance past the line by more than
`tolerance` is skipped for the next smaller one. Overshooting would put the
month off pace in the other direction, and the next hourly run would move buys
straight back. The result is the fewest, most recognisable retags.

**Room in the swing bucket.** Over pace, the total moved is capped at the
`balance` left in the short-term bucket whose `tags` include `swingTag`. Moving an
overspend into a bucket that is already spent would only hide it.

Each move is written to Buxfer (`updateTransaction(id, { tags })`) and mirrored
into the stored period `transactions.yml`, so the recompile that follows sees it
without a re-fetch. A Buxfer edit that throws, or that answers with a non-`OK`
`status`, is logged as failed and is not mirrored. A rebalance error never fails
the sync; it lands in `details.rebalance.error`.

**No wiggle room.** If the month is off pace and nothing fungible can move
(no single-tag swing buys, or no room left in the swing bucket), nothing moves
and `finance.rebalance.no_wiggle_room` is logged. The chart then shows the real
overspend.

**Opting out of a run:** `POST /api/v1/finance/refresh` with `{"skipRebalance": true}`.
The scheduled job always rebalances.

## 4. Observability

| Event | When |
|---|---|
| `finance.rebalance.month` | every planned month: status, balance, target, gap, candidates, moves, movedTotal, balanceAfter |
| `finance.rebalance.moved` | each retag: id, date, amount, from → to |
| `finance.rebalance.move_failed` | a Buxfer edit threw or answered non-`OK` |
| `finance.rebalance.no_wiggle_room` | off pace with nothing fungible to move: no candidates, or no room in the swing bucket |
| `harvest.rebalance.failed` | the step itself threw |

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="finance.rebalance.month" AND _time:24h' -d 'limit=50'
```

## 5. Known limits

- **Swings move both ways across the month.** A buy moved out early when the
  month runs hot can move back later when it cools. That is intended. The
  no-overshoot rule and the doubled pull-back threshold keep a row from bouncing
  between runs.
- **The previous month is closed out in both directions.** A month that finished
  under budget has swing buys pulled back into day-to-day until it reads $0.
- **Description rules must not tag swing payees.** An account-scoped rule in
  `gpt.yml` with a `tag` re-tags its rows on every harvest, before the rebalance
  runs. A rule like `AMAZON → Amazon, tag: Shopping, account: Capital One` would
  undo every rebalance each hour. Give swing-payee rules no `tag`.
- **Refunds stay where they land.** A refund is an income row and is never a
  candidate, so a moved purchase's refund still credits day-to-day.
- **The previous month keeps rebalancing toward $0** for as long as it is the
  previous month, including after a manual retag. Retag a row to a non-swing
  tag to take it out of play.
- Only one `dayTag` ↔ `swingTag` pair per period.
