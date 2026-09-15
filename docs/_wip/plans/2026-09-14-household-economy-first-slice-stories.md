# Household Economy — First Slice: User Stories

**Date:** 2026-09-14
**Status:** Stories for the first vertical slice. Awaiting owner review, then build approaches.
**Vocabulary and decisions:** `2026-09-14-household-economy-taxonomy.md` (every D-number and L/P/H job below refers to it).
**Seams named here:** `backend/src/3_applications/economy/EconomyService.mjs`,
`backend/src/3_applications/gaming/usecases/GrantPlayTime.mjs`,
`backend/src/1_adapters/gaming/LedgerPlayTimeGrants.mjs`,
`backend/src/4_api/v1/routers/playSessions.mjs` (`POST /grants`),
`backend/src/2_domains/gaming/services/playEligibility.mjs`,
`frontend/src/modules/Fitness/identity/IdentityProvider.jsx`,
`frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx`,
`frontend/src/modules/School/status/AgendaStatusBoard.jsx`.

---

## 1. The slice

One child's week, end to end, on the surfaces that already exist:

> School work Monday to Friday pays silver on the Portal. Saturday morning, makeup and
> extra credit pay too. At Saturday noon the ring awards pay. Saturday afternoon the child
> buys tickets with silver at the garage fitness app, redeems them into minutes with a
> fingerprint, walks to the living-room console, and plays under a countdown that shows
> their name and clock. When the clock runs out the game stops, with warnings. Sunday
> night, unredeemed tickets refund, silver becomes gold, and a green week left a ruby.

The slice proves: **earn → hold → spend → settle** for one learner, on both game surfaces,
with the three access layers refusing legibly. It does not prove pooling, saving, cash-out,
discrete treats, or movies.

### In the slice

| Stage | Stories |
|---|---|
| Earn, weekdays | S1 day earn · S2 unit earn opt-in · S3 week bonus |
| Earn, Saturday | S4 makeup · S5 extra credit · S6 ring awards and contest |
| Hold | S7 wallet |
| Spend | S8 buy tickets · S9 redeem into minutes · S10 console play · S11 browser play · S12 clock runs out · S13 refusals name the layer |
| Settle | S14 Sunday conversion |
| Govern | S15 rules in config · S16 deposit and adjust · S17 migrate existing coins |
| Fail safe | S18 indeterminate and unreachable |

### Out of the slice, on purpose

Movies priced in tickets (D15, the price rule ships in config, no redemption surface yet);
discrete privileges (dessert, bedtime); cash-out and parent-mobile approval; savings, growth,
pools, the household everyone-condition; gem *spending* (gems are minted and shown, nothing
consumes them); the parent weekly digest (events are logged, no report is sent); PIN auth;
TV metered spend.

### Dependencies the slice cannot build itself

| # | Dependency | Owner | Blocks |
|---|---|---|---|
| D14 | Makeup: a grace window per obligation, a way to serve a past weekday, a `timeliness` stamp on the verdict | School | S4, and S3 for made-up weeks |
| — | School schedule config: assignments weekdays only, Saturday designated makeup and extra credit | School config | S4, S5 |
| — | `games.yml → play_sessions.mode: enabled` (today `observe-only`) | Household config | S10, S12 |
| — | Living-room countdown overlay commissioned for the Shield (placement table exists; the overlay is durable device state) | Gaming | S10 |

---

## 2. Conventions

Each story has the role, the situation, the want, the reason; then acceptance criteria that
are observable (a ledger entry, an API answer, a log event, a thing on a screen); then the
jobs it serves and the seam it rides. Log events are named `economy.<verb>` and carry
`context.app: economy`; the criteria name the fields a query needs.

Ledger `ref` shapes used in this slice:

```
school:day:{learner}:{YYYY-MM-DD}:{on-time|makeup}
school:unit:{learner}:{unitId}:{YYYY-MM-DD}
school:extra:{learner}:{unitId}:{YYYY-MM-DD}
school:week:{learner}:{isoWeek}:{on-time|makeup}
fitness:rings:{learner}:{awardWeek}:{threshold}
fitness:contest:{learner}:{awardWeek}
ticket:buy:{learner}:{txnId}
ticket:redeem:{learner}:{grantId}
weekclose:{learner}:{isoWeek}:{refund|convert}
```

---

## 3. Stories

### Earn, weekdays

**S1. A finished day pays, right there.**
As a learner, when the last assignment of my day passes and the card goes green, I want
silver to land and the Portal to say so, so the day and the reward are one moment.

- Given the completion bridge transitions a learner-day to `complete`, then exactly one
  `earn` entry is appended with ref `school:day:{learner}:{date}:on-time`, amount = the
  day-met rule's tariff, and the wallet answers the new balance on the next read.
- The same transition delivered twice (replay, restart, refetch) appends nothing the
  second time and the API answers `duplicate: true`.
- A day in `no_work_today`, `incomplete`, or `indeterminate` appends nothing.
- The Portal shows the amount earned on the green card within the same refresh the card
  turns green (the board already re-reads on `school` events; the wallet read rides that
  refresh). No score, no ranking, the amount and the coin only.
- Log: `economy.earn` with `learnerId`, `action: school-day-met`, `amount`, `ref`,
  `duplicate`, `capped`.
- Jobs: L1, L2, H1. Seam: the completion bridge's observation stream; `EconomyService.earn`.

**S2. Some assignments pay on their own, and the parent says which.**
As a parent, I want to mark a program unit as paying silver when served, with most units
paying nothing, so the day bonus stays the main event and a few things get a nudge.

- A unit with `reward: 0` (the default) appends nothing when served.
- A unit with `reward: N` appends one `earn` with ref `school:unit:{learner}:{unitId}:{date}`
  the first time it is served that study day; a retry or regrade of the same unit on the
  same day appends nothing.
- The existing piano-lesson and card-game earns are expressed as unit rules in the same
  catalog; their refs and behaviour are unchanged.
- The daily cap for unit earns is per learner per study day, as today.
- Jobs: L1, P1. Seam: the earn catalog in `economy.yml`; the school event stream.

**S3. A green week pays the moment it is green.**
As a learner, when my fifth weekday goes green, I want the week bonus and a ruby without
waiting for anyone, so a whole week feels like a thing I did.

- When every weekday (Monday–Friday) of the current ISO week reads `met` on the term
  grid and the weekly row, if any, reads `met`, exactly one `earn` with ref
  `school:week:{learner}:{isoWeek}:{timeliness}` is appended, plus one gem entry of
  colour `ruby` with the same ref.
- Timeliness is the worst of the five weekdays (D11): all on-time → full week tariff;
  any makeup → makeup week tariff. The ruby is minted either way.
- Evaluation is triggered by the same transition as S1, and by the makeup event in S4;
  there is no scheduled job for the week bonus.
- A week with an exempt weekday (calendar off, not a school day) counts that day as met
  for this rule, since the grid already does not ask for it.
- The status board shows the ruby on the week strip once minted.
- Log: `economy.earn` with `action: school-week-met`, `timeliness`, `isoWeek`.
- Jobs: L3, H1. Seam: term grid read model (`GET …/learners/:id/term`), completion bridge.

### Earn, Saturday

**S4. A made-up day still pays, at the makeup rate.**
As a learner, when I do Tuesday's missed work on Saturday morning, I want Tuesday to go
green and pay something, so catching up is worth doing.

- *Blocked by D14.* When School emits a verdict change for a past weekday to `met` with
  `timeliness: makeup`, exactly one `earn` with ref `school:day:{learner}:{date}:makeup`
  is appended at the makeup tariff.
- If `school:day:{learner}:{date}:on-time` already exists for that date, nothing is
  appended (a day cannot be both).
- The Portal shows the made-up day's earn the same way as S1, and the term grid cell for
  Tuesday recolours to green.
- S3 re-evaluates after this event; a week completed by makeup pays the makeup week
  tariff.
- Work done after the grace window (`timeliness: lapsed`) appends nothing and logs
  `economy.earn.refused` with `reason: lapsed`.
- Jobs: L14, P13, H1. Seam: School's verdict change event (to be defined under D14).

**S5. Extra work on Saturday pays extra.**
As a learner, when nothing is assigned and I do a unit anyway, I want it to pay at the
extra-credit rate, so Saturday is a chance and not just a catch-up.

- A unit served on a day the plan did not assign it, for a program that allows extra
  credit in config, appends one `earn` with ref `school:extra:{learner}:{unitId}:{date}`
  at the extra-credit tariff, subject to an extra-credit daily cap.
- A unit that *was* assigned that day, or a program with extra credit off, appends
  nothing under this rule (it may still pay under S2).
- The status board already draws extra completed work as a `+N` badge; this story adds
  no new board element.
- Jobs: L1, P1. Seam: agenda preview (what was assigned) vs. teacher day digest (what
  was done); the existing `extraCount` derivation in `agendaStatusModel.js`.

**S6. Rings pay at Saturday noon, and the leader wears a mark.**
As a learner, I want my rings this week to earn silver at each threshold and the most
rings to win a prize and a sapphire, judged Saturday noon, so exercise buys Saturday too.

- The award week is Monday 04:00 → Saturday 12:00 local (D10), computed by the economy
  over Fitness's persisted session summaries; the Fitness weekly bar and the
  `fitness.weekly-rings` gate are unchanged.
- For each threshold `k·N` first reached within the award week, exactly one `earn` with
  ref `fitness:rings:{learner}:{awardWeek}:{k}` is appended, at the time it is reached
  (not held to Saturday).
- At Saturday 12:00 the learner with the most award-week rings receives one `prize` with
  ref `fitness:contest:{learner}:{awardWeek}` and one sapphire. Ties resolve per the
  contest rule in config (default: all tied learners win). Adults and guests are never
  contestants.
- The status board's card for the current leader carries a leader mark from Monday to
  Saturday noon, computed from award-week rings, and the winner's card carries a winner
  mark from Saturday noon to Monday. Cards never reorder (D13).
- A contest with no rings from anyone pays nothing and logs `economy.contest.void`.
- Log: `economy.earn` with `action: fitness-ring-threshold`; `economy.prize` with
  `action: fitness-ring-contest`, `awardWeek`, `winners`, `rings`.
- Jobs: L3, L15, H2, H3. Seam: Fitness session summaries; `AgendaStatusBoard` rings chip.

### Hold

**S7. The wallet tells me what kind of money I have.**
As a learner, when I look at my wallet on the Portal or the fitness app, I want silver,
gold, tickets, gems and my clock shown separately, so I know what is for this week and
what is mine for good.

- `GET /api/v1/economy/users/:id/wallet` answers `{ silver, gold, tickets, gems: [{colour,
  count}], clock: { minutesToday, expiresAt }, weekEndsAt }`. Balances are folded from the
  ledger; the clock is read from the play grant ledger.
- The Portal card and the fitness app's identified-user header both show the same
  numbers from the same call; neither invents a zero while the read is in flight.
- The wallet shows what Sunday night will do: "N silver becomes gold, M tickets refund"
  from Saturday onward.
- Jobs: L4, L5, L12. Seam: `EconomyService.getBalance`, `LedgerPlayTimeGrants`.

### Spend

**S8. I buy tickets with my own silver.**
As a learner at the garage fitness app, identified by my fingerprint, I want to turn
silver into tickets, so I can decide how much of my week goes to games.

- The fitness app offers a ticket purchase to an identified non-admin user. The price per
  ticket is the tariff in force now (D9); the screen shows it before confirming.
- On confirm, one `convert` pair is appended (silver debit, ticket credit) with ref
  `ticket:buy:{learner}:{txnId}`, authorised by the identify ceremony (D4).
- Purchasing is refused, with the layer named (S13), when: silver is insufficient
  (affordability); the purchase would exceed the weekly redeemable-minutes cap in ticket
  terms (affordability, `reason: weekly-cap`); the user is a guest or unidentified
  (authorization).
- Tickets are refundable until redeemed; the wallet shows them as tickets, not as silver.
- Log: `economy.convert` with `from: silver`, `to: ticket`, `count`, `price`, `tariff`.
- Jobs: L6, P2, H11. Seam: `IdentityProvider` identify ceremony; a new fitness widget
  alongside `EmulatorGameWidget`.

**S9. I turn tickets into time, and that is the commitment.**
As a learner at the reader, I want to redeem tickets into minutes on my clock, so the
console has time to give me when I get there.

- Redeeming N tickets appends one `convert` (ticket debit) with ref
  `ticket:redeem:{learner}:{grantId}` **and** writes one play-time grant of N × minutes
  per ticket through `GrantPlayTime`, `by: economy`, `reason: ticket-redeem`, on today.
  The two writes are one operation: if the grant fails, the ticket debit is not committed.
- The clock is per day, as the grant ledger already is: minutes redeemed Saturday are
  good Saturday. Redeeming is offered only on days the arcade is open (availability), so
  minutes cannot be stranded on a closed day.
- Redeeming is refused when the day's redeemed minutes plus this redemption would exceed
  the weekly cap (90), naming `weekly-cap`.
- The fitness app shows the clock immediately after redemption.
- Log: `economy.redeem` with `tickets`, `minutes`, `grantId`, `clockAfter`.
- Jobs: L6, L8, H5. Seam: `GrantPlayTime`, `POST /api/v1/play-sessions/grants`.

**S10. The console shows my name and my clock, and stops when it is spent.**
As a learner on the living-room console, I want the overlay to show who is playing and
how much time is left, and the game to stop only after warnings, so I am never surprised.

- With `play_sessions.mode: enabled`, a session opened for a learner with a grant shows
  the countdown overlay in the bezel zone for that system, with name and remaining
  minutes; the overlay is armed on confirmed play and torn down at session end.
- Time is billed only on observed play (existing meter); paused and title-screen time
  does not drain the clock.
- Warnings at 5:00, 1:00 and 0:20 on screen and out loud; at zero the game is stopped
  and the screen returns to the kiosk. A stop that fails does not settle the session.
- A learner with no grant is refused at launch by `assessEligibility` with the reasons
  it already produces plus `no-play-time`; the launcher shows S13's message.
- An adult plays without a ceiling, as today.
- Jobs: L7, H5, H6. Seam: play sessions, `LedgerPlayTimeGrants`, the countdown overlay.

**S11. The browser arcade reads the same clock.**
As a learner on the garage browser arcade, I want the same clock the console would show,
so where I play does not change what I have.

- `EmulatorGameWidget` reads the learner's grant from the play-session feed and draws the
  server-authoritative clock in its React tree; the old `coinMeteredGate` and
  `session.coins` drain are removed, not left behind a flag.
- Depletion behaves as S10: warnings, then pause, then "Out of time, redeem more".
- The admin fingerprint gate before first launch is unchanged.
- Jobs: L7. Seam: `EmulatorGameWidget`, `play-session:<deviceId>` subscription.

**S12. When the clock runs out I know what to do next.**
As a learner whose game just stopped, I want the screen to tell me I can redeem more
tickets at the reader if I have any, so the end of time is not the end of the day.

- The depleted message states remaining tickets and where to redeem them, or that the
  weekly cap is reached, or that the arcade closes at a time; each is a different
  sentence from a different layer (S13).
- The play session is settled with witnessed time; unused minutes stay on the clock
  until the day ends.
- Jobs: L8, L13. Seam: play-session `ended` message; wallet read.

**S13. A refusal names the layer.**
As a learner, when I cannot buy, redeem or play, I want to be told whether it is closed,
not allowed, or unaffordable, and what would change it.

- Every refusal from S8–S11 carries `layer: availability | eligibility | affordability |
  authorization` and `reason`, and a `nextChange` where one is knowable (`opensAt`,
  `needs: school-day-complete`, `short: 3 silver`).
- The order of evaluation is open → allowed → affordable (taxonomy 4a); a closed arcade
  is reported as closed even if the learner is also broke.
- Log: `economy.refused` with `layer`, `reason`, `learnerId`, `action`.
- Jobs: L13, H11. Seam: `assessEligibility` reasons; `EconomyService` validation errors.

### Settle

**S14. Sunday night squares the week.**
As the house, at the week's end, I want to refund unredeemed tickets, convert silver to
gold, and leave gems and gold untouched, so Monday starts clean and nothing is lost by
surprise.

- At the configured week close (default Sunday 23:59 local, or on the first economy read
  after it if the process was down), for each learner: one `convert` pair ticket→silver
  for unredeemed tickets with ref `weekclose:{learner}:{isoWeek}:refund`, then one
  `convert` pair silver→gold at the conversion tariff with ref
  `weekclose:{learner}:{isoWeek}:convert`. Both idempotent on ref.
- Minutes left on the clock expire with the day, as the grant ledger already does;
  nothing is written for them.
- Gems and gold are untouched. A learner with zero silver and zero tickets gets no entries.
- The wallet after close answers `silver: 0`, `tickets: 0`.
- Log: `economy.weekclose` with `learnerId`, `isoWeek`, `refunded`, `converted`.
- Jobs: L5, H3. Seam: a new scheduled settlement in the economy composition module,
  plus a lazy catch-up on read.

### Govern

**S15. The rules live in one file.**
As a parent, I want every rate, cap, tariff and window for this slice in `economy.yml`
(and game hours where they already are), with per-learner overrides, so I write it once.

- `economy.yml` declares: currencies (silver, gold, gems with colours), the ticket
  (minutes per ticket, price tariff), the weekly minute cap, earn rules for each cell in
  the slice (day-met, unit, extra, week-met, ring-threshold with N, ring-contest with tie
  rule), timeliness tariffs (on-time, makeup, extra), the conversion tariff, the week
  close time, and `users:` overrides for any field.
- Game hours stay in the gaming policy `windows` (D8). The economy's `blackout` field is
  removed from the schema and ignored if present, with a startup warning.
- A rate is a tariff: `{ base, modifiers: [{ schedule|dates, multiply|set }] }`; the
  first matching modifier wins (D9). A bare number is accepted as `{ base }`.
- Invalid config fails validation at startup with the offending path; the economy then
  refuses earns and spends (S18) rather than guessing.
- The committed example `data/household/config/economy.yml` carries a full annotated
  slice config with the placeholder rates derived in the taxonomy (D5).
- Jobs: P1, P2, P3, P10, P11. Seam: household app config loader.

**S16. A parent can give and correct from the command line.**
As a parent, I want to deposit silver or gold with a note, and adjust with a reason,
without a UI, so the slice does not wait on an admin screen.

- `POST /users/:id/deposit` takes `{ amount, currency, note }`; a CLI wraps it.
- `EconomyService.adjust` takes `{ delta, currency, ref, note }` and is the only path that
  may take a balance negative; the CLI wraps it and prints the resulting balance.
- Both append one entry with `by: parent:{id}`; both log `economy.deposit` /
  `economy.adjust`.
- Jobs: P5, P6. Seam: existing deposit endpoint and `adjust`; `cli/`.

**S17. Existing coins are not lost.**
As a learner with a Phase-1 coin balance, I want it to survive, so the new economy does
not start by taking something away.

- On first start with the new schema, every existing ledger entry without a `currency` is
  read as `silver`. At the first week close they convert to gold like any other silver
  (D6). No entry is rewritten; the reader supplies the default.
- The wallet endpoint's old `balance` field is kept for one release, equal to `silver`,
  and logged as deprecated on use.
- Jobs: P6, H7. Seam: `YamlEconomyDatastore`, `foldBalance`.

### Fail safe

**S18. When the house cannot tell, it neither pays nor punishes.**
As the house, when evidence is indeterminate or the economy is unreachable, I want
nothing minted, nothing spent, and the surface to say so, so a fault never looks like a
lazy week or a free one.

- A completion read of `indeterminate` appends nothing and logs `economy.earn.deferred`
  with the fault; the next transition re-evaluates.
- If the economy API is unreachable, the Portal shows the day's green card without an
  amount and a small "balance unavailable" mark; the fitness app disables buy and redeem
  with "wallet offline"; the console's play grant is whatever the grant ledger already
  holds (gaming does not depend on the economy at play time).
- If the play grant write fails during S9, the ticket debit is rolled back and the
  learner is told to try again; nothing is half-done.
- A week close that cannot read the ledger logs `economy.weekclose.failed` and retries on
  the next read; it never partially converts.
- Log: `economy.unavailable` with `surface`, `operation`.
- Jobs: H9, H10, P9. Seam: every surface's error path.

---

## 4. Traceability

| Job | Stories |
|---|---|
| L1 | S1, S2, S5 |
| L2 | S1 |
| L3 | S3, S6 |
| L4, L5 | S7, S14 |
| L6 | S8, S9 |
| L7 | S10, S11 |
| L8 | S9, S12 |
| L12 | S7 |
| L13 | S12, S13 |
| L14 | S4 |
| L15 | S6 |
| P1, P2, P3, P10, P11 | S15 |
| P5, P6 | S16, S17 |
| P9 | S18 |
| P13 | S4 |
| H1 | S1, S3, S4 |
| H2 | S6 |
| H3 | S6, S14 |
| H5, H6 | S9, S10 |
| H7 | S17 |
| H9, H10 | S18 |
| H11 | S8, S13 |

Jobs deliberately not covered by this slice: L9, L10, L11, L16, L17 (discrete, savings,
pool, tariff-aware shopping, everyone-week); P4, P7, P8, P12, P14 (pause, mobile approval,
digest, green-day gate as a *configured* gate, contest declaration UI); H4, H8 (growth;
lost-session settlement already exists in gaming and is not changed here).

---

## 5. Open before approaches

1. **Where the ticket screens live.** S8 and S9 assume a new widget in the fitness app's
   menu next to the emulator, under the same identify ceremony. The alternative is folding
   purchase and redemption into the game launcher itself (identify → buy → redeem → launch
   in one flow). The one-flow version is fewer taps on Saturday and one more coupling.
2. **Week bonus trigger for exempt weekdays.** S3 treats a calendar-off weekday as met.
   Confirm that a four-day week pays the full bonus.
3. **The week close job.** S14 needs the economy's first scheduled action. The house has a
   scheduler (NewsReporter, school lifecycle timers); the approaches will pick one.
