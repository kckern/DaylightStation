# Completion and rewards

For the full planner-to-agenda flow and obligation vocabulary, see
[Agenda and daily completion](./agenda-and-completion.md).

Learner-day completion is a derived, side-effect-free projection over the same
plan and agenda rules that issue work. It is never a mutable “done” flag.

`GET /api/v1/school/lifecycle/learners/:learnerId/completion` returns the study
date, one of `incomplete | complete | no_work_today | indeterminate`, excused
sections, and faults. `Cache-Control: no-store` prevents a stale reward answer.

Faults win: catalog/plan errors and an unavailable required program produce
`indeterminate`. A healthy obligated section produces `incomplete`; fully
served obligations produce `complete`; an otherwise healthy day with no
obligations produces `no_work_today`.

Piano Games unlocks only for an identified learner in `complete` or
`no_work_today`. Guest, transport failure, and `indeterminate` lock it. The one
exception is the **early pass**: on a real `incomplete` (never `indeterminate`,
Guest or a failed read), a learner may buy one pass per study day, in silver or
gold, that opens one game. It is consumed when the game ends, refunded if the
game ends inside the refund window, and expires at the 4 am rollover. Economy
owns the purchase, cap and price
([economy.md § Early passes](../economy/economy.md#early-passes)); the kiosk side
is in
[games-budget-gate.md](../piano/games-budget-gate.md#the-early-pass-on-the-tablet).
Coins are paid by the economy, not by this projection (see [Coins](#coins)).

The completion bridge emits an initial observation and every subsequent state
transition. Consumers must be idempotent and use learner plus study date as the
logical key.

For operations:

```bash
node cli/school.mjs ops completion learner3
node cli/school.mjs ops status learner3
node cli/school.mjs ops monitor learner3 learner4 --watch --interval 15
```

## Coins

School does not pay coins itself. Its own per-unit reward in
`CloseSessionOutcome` (`lifecycle.economy.enabled` in `school.yml`) stays
`false`: turning it on alongside the payouts would pay a unit twice. Coins come
from the economy's **PayoutService**, which mints what the weekly earnings
preview prices from School's evidence (graded sessions, served sections, green
days). It settles after `school.session.outcome-recorded` and on an hourly
reconcile (the previous week too, Monday to Wednesday), and writes nothing
unless the economy catalog's `mode` is `live`; `dry-run` only logs what it would
mint. See [economy.md § Payouts](../economy/economy.md#payouts).

**Reward labels.** School surfaces show what the next sheet is worth through
the optional `rewardFor({learnerId, unit})` port, wired to the economy: the
Portal bank screen's ways to earn ("+2 silver · Math 4-02"), the
agenda tape's `Next: Math +2`, and the piano lock's Print button. The amount is
what passing the sheet would add to the week's payout at the learner's own
rate. It is null, and no amount is shown, unless the economy is `live` and
exactly one earn rule prices the sheet; an elective sheet (today's section
`excused`) is never priced. See
[economy.md § Integration points](../economy/economy.md#integration-points).
