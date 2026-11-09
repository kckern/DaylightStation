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
    tolerance: 67           # optional dollars left alone; default one day of budget
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
moves.

- **Overspent** (gap < 0): candidates are this month's day-to-day transactions
  tagged `dayTag`, from a `payees` match, dated up to today. They move to `swingTag`.
- **Underspent** (gap > 0): candidates are short-term transactions tagged
  `swingTag`, from a `payees` match, dated in the month up to today. They move to `dayTag`.

The planner picks the subset of candidates whose total is closest to `|gap|`
(0/1 subset sum in cents; ties go to fewer moves, then to not overshooting).
Only the swing tag is replaced; other tags on the row stay.

Each move is written to Buxfer (`updateTransaction(id, { tags })`) and mirrored
into the stored period `transactions.yml`, so the recompile that follows sees it
without a re-fetch. A failed Buxfer edit is logged and not mirrored. A rebalance
error never fails the sync; it lands in `details.rebalance.error`.

**No wiggle room.** If the month is off pace and has no fungible candidates, nothing
moves and `finance.rebalance.no_wiggle_room` is logged. The chart then shows the
real overspend.

**Opting out of a run:** `POST /api/v1/finance/refresh` with `{"skipRebalance": true}`.
The scheduled job always rebalances.

## 4. Observability

| Event | When |
|---|---|
| `finance.rebalance.month` | every planned month: status, balance, target, gap, candidates, moves, movedTotal, balanceAfter |
| `finance.rebalance.moved` | each retag: id, date, amount, from → to |
| `finance.rebalance.move_failed` | a Buxfer edit threw |
| `finance.rebalance.no_wiggle_room` | off pace with nothing fungible to move |
| `harvest.rebalance.failed` | the step itself threw |

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="finance.rebalance.month" AND _time:24h' -d 'limit=50'
```

## 5. Known limits

- **Swings move both ways across the month.** A buy moved out early when the
  month runs hot can move back later when it cools. That is intended; the
  tolerance keeps the sync from flipping on every run.
- **The previous month keeps rebalancing toward $0** for as long as it is the
  previous month, including after a manual retag. Retag a row to a non-swing
  tag to take it out of play.
- Only one `dayTag` ↔ `swingTag` pair per period.
