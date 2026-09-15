# Household Economy — Concepts, Axes, Jobs to be Done

**Date:** 2026-09-14
**Status:** Taxonomy, reviewed with the owner 2026-09-14; D1, D3, D4, D10–D13 decided, D14 a dependency, the rest proposed. Precedes user stories. Nothing here is built.
**Supersedes (in part):** `2026-07-17-household-economy-design.md` currency model. The ledger,
policy-catalog and hold-and-settle mechanics from that plan stand.
**Related:** `docs/reference/economy/economy.md`, `docs/reference/gaming/play-sessions.md`,
`backend/src/2_domains/gaming/services/playEligibility.mjs`,
`docs/reference/school/term-grid.md`, `docs/reference/school/completion-and-rewards.md`,
`docs/reference/state-gates/README.md`, `docs/superpowers/specs/2026-08-26-rings-and-weekly-measures-design.md`

---

## 0. Purpose of this document

Before any use case is written, fix the vocabulary. Every concept below has exactly one
definition and one owning bounded context. Every axis is a set of categories that are
**mutually exclusive** (a thing lands in one and only one) and **collectively exhaustive**
(there is no thing that lands in none). Where a category is deliberately empty, it is
listed and marked empty rather than omitted, so the gap is a decision and not an accident.

Two tests are used throughout and are worth naming:

- **The currency test.** Two things that share every coordinate on the five currency axes
  (section 3.1) are the same currency. If they differ only in face value they are
  *denominations* of one currency, not two currencies. This is what makes "bronze coin"
  and "red ticket" denominations rather than new money.
- **The layer test.** A rule that restricts a spend belongs to exactly one of
  availability, eligibility, affordability (section 4a). A rule that seems to belong to
  two is two rules.

---

## 1. Roles

A role is a set of jobs, not a person. One person can hold several roles; one role can be
held by several people.

| Role | Holds | Jobs (summary) |
|---|---|---|
| **Learner** | a child | earn, hold, spend, save, pool, understand |
| **Parent** | an adult with policy authority | govern, bank, approve, observe |
| **House** | the system itself | observe evidence, settle, enforce, reconcile, fail safe |

MECE check: every job in section 8 belongs to exactly one role. "Settle" is House
(automatic, rule-driven); "adjust" is Parent (manual, discretionary). They do not overlap.

---

## 2. Core concepts

Each concept has one owner. The economy does not own everything it touches.

| Concept | Definition | Owner |
|---|---|---|
| **Subject** | Whose balance it is. A learner, or the household pool. | Economy |
| **Currency** | A denomination family with fixed properties on the five axes (section 3). | Economy |
| **Denomination** | A face value within one currency. Same properties, different size: a red ticket and a blue ticket; a ruby and a sapphire if they differ only in value. | Economy |
| **Measure** | A domain-native score that is *not* money: rings. It is **evidence**, never a balance: reaching a ring threshold earns an award, leading the week earns a prize, and rings themselves are never spent, exchanged or debited. The repo already uses this word (rings spec, section 2). | The producing domain (Fitness) |
| **Account** | One subject × one currency. Balance is *derived* by folding the ledger, never stored. | Economy |
| **Sub-account** | An account partition with a lock (savings). Same currency, different rules. | Economy |
| **Ledger entry** | The only way money moves. Append-only, signed, referenced, kinded (section 4). | Economy |
| **Policy** | The household rule catalog: earn rules, spend rules, contest rules, tariffs, caps, per-learner overrides. | Economy |
| **Tariff** | A time-varying rate attached to any priced rule, earn or spend: a base plus scheduled or dated modifiers. A tariff never says no; it changes the amount. | Economy |
| **Evidence** | An upstream fact that justifies an earn: a completion transition, a term-grid verdict, a ring total, a parent attestation. | The producing context (School, Fitness, Parent) |
| **Timeliness** | Whether evidence arrived on time, as makeup within a grace window, or lapsed. An earn's tariff may key on it. | The producing context declares it; Economy prices it |
| **Contest** | A declared, week-bounded competition among a named set of learners with one winner and a prize. The only *relative* earn rule. | Economy (rule), producing domain (standings) |
| **Period** | A settlement window: instant, day, week, term, open-ended. The week is Monday to Sunday, shared with fitness rings and the school week row. | Household calendar |
| **Voucher** | A pre-purchased, expiring entitlement. **Tickets** are the screen voucher: bought with silver, held, and *redeemed* either into minutes on the play clock or for a whole screen item (a movie is one unit, whatever its length). Not a currency. Unredeemed tickets refund to silver at week end. | Economy |
| **Play clock** | A learner's balance of purchased **minutes**, expiring at week end without refund. Tickets are redeemed into it; games drain it. Redeeming is the irreversible step. | Economy |
| **Grant** | Permission to consume a metered privilege: "this session may play this long for this person." Issued from the play clock's remaining minutes. | Play Sessions |
| **Availability** | Whether a privilege is *open* right now by the clock and calendar. Deterministic; never indeterminate. Games already have this: `windows` in the play-eligibility policy, per-title overridable, administered in the admin app. | Each privilege's own policy |
| **Eligibility** | Whether a subject *may* have a privilege, from evidence: green for the day, ring closed. Four-state; can be indeterminate. | State Gates (assertions), consumed by the privilege's evaluator |
| **Affordability** | Whether the subject can pay the tariff price now, from the balance in the right currency. | Economy |
| **Authorization** | Proof that a specific person approved a specific spend. Distinct from attribution. | Economy (policy declares it), identity providers supply it |
| **Attribution** | Who an earn or a session is *for*. Ambient, low stakes. | The surface (Portal knows the learner; the reader names the player) |
| **Goal** | A named target with a balance: a learner's savings goal, or a household pool goal. | Economy |

Explicitly **not** concepts in this economy:

- **Penalty / fine.** No ledger entry is ever created because something did *not* happen.
  Debt exists only as the residue of a correction (`adjust`) and is repaid by later earning.
- **Standing.** Shared displays never *order* people or label anyone last. Counts may be
  visible side by side (the status board already shows every child's rings). A **contest**
  is declared in advance, marks a leader and a winner, and never names a loser. School
  work is never a contest.
- **Purchasable care.** Affection, belonging, meals, and broad "good behaviour" are never priced.
- **Automatic claw-back.** A verdict that changes after payout never silently reverses a
  ledger entry. It surfaces for a Parent adjust.
- **"Fitness coins."** The measure is called **rings**. Any remaining "fitness coins"
  wording is stale and is to be corrected on sight.

---

## 3. Currencies and their axes

### 3.1 The axes

| Axis | Categories | Question it answers |
|---|---|---|
| **Lifetime** | expiring-weekly · evergreen | Does it die at week end? |
| **Unit** | quantity · minutes · milestone-count | What is one of it? |
| **Proportionality** | volume-scaled · equal-per-milestone | Does a bigger workload earn more of it? |
| **Reach** | metered-privilege · discrete-privilege · cash · goal · none | What can it buy? (multi-valued) |
| **Transferability** | none · gift · pool | Can it leave its owner's account? |

### 3.2 The currencies

| Currency | Lifetime | Unit | Proportionality | Reach | Transferability |
|---|---|---|---|---|---|
| **Silver** | expiring-weekly | quantity | volume-scaled | metered-privilege (via tickets), discrete-privilege | none |
| **Gold** | evergreen | quantity | volume-scaled | discrete-privilege, cash, goal | gift, pool |
| **Gems** | evergreen | milestone-count | equal-per-milestone | goal (pooled), household event | pool |
| **Tickets** (voucher) | expiring-weekly | ticket | n/a (purchased) | play clock; discrete screen items (a movie) | none |
| **Play clock** (minutes) | expiring-weekly, no refund | minutes | n/a (redeemed) | metered-privilege only | none |
| **Rings** (measure, not money) | n/a (a score) | quantity | volume-scaled | none; rings are evidence for awards, not a balance | none |

Readings:

- **Silver** is this week's work. It cannot outlive the week; what is unspent becomes gold.
  This single property carries the rule "you play this week on this week's work".
- **Gold** is the evergreen store and can *never* reach metered-privilege. That is the
  hard wall between "wealth" and "screen time".
- **Gems** answer fairness across ages. Silver scales with workload, so an older learner
  always out-earns a younger one. A gem is one per milestone regardless. Gems are the unit
  of household pooling so no one learner dominates the pool, and the unit of the
  **everyone-condition**: "if every learner holds this week's gem, the house earns X."
- **Tickets** and the **play clock** are the two halves of metered spend. Tickets are
  bought with silver and refundable; minutes are redeemed from tickets at the fitness app
  with a fingerprint and are not refundable. Games never see tickets or silver, only the
  clock. The 90-minute weekly cap is a cap on minutes *redeemed* per week.
- **Rings** are the Fitness effort measure, already renamed from "fitness coins" and
  live. They sit in this table only to show they are *not* a currency: there is no
  exchange, no rate, no debit. Rings are evidence for two earn rules, both **awards**:
  an absolute **threshold award** (every N rings reached pays silver, once per
  threshold) and a relative weekly **contest prize** (most rings this week). The ring
  total is never reduced by either.

### 3.3 Denominations

A denomination changes the size of a unit and nothing else. Denominations are how colour
enters the system without multiplying currencies.

| Currency | Denominations (proposed) | What the colour means |
|---|---|---|
| Tickets | red = 10 min · blue = 30 min (or as configured) | face value |
| Gems | ruby · sapphire · emerald · diamond | **provenance** by default: which milestone earned it (a green school week, a ring contest win, a household everyone-week). All equal value, all pooled-only, unless config says otherwise. |
| Silver | none | — |
| Gold | none | — |

The currency test decides when a colour is more than a denomination: a gem colour that
needs a *different reach* (say, a diamond that may be cashed out) is a different currency
and gets its own row in 3.2. Start with none such; promote a colour only when a real
reach difference is wanted (D12).

By the same test, a **bronze coin** for makeup work is *not* a currency: it would share
every axis with silver and differ only in value. Makeup work pays **fewer silver** via a
timeliness tariff (section 5), which is the same thing without a new account to explain.

### 3.4 Deliberately empty cells

- *Expiring + milestone-count*: an expiring gem. Empty; a milestone that dies is not a milestone.
- *Evergreen + minutes*: a hoardable time voucher. Empty on purpose; it would defeat the weekly cap.
- *Expiring + cash reach*: silver cannot cash out. Empty on purpose; cash-out is a gold job.
- *Rings with any reach*: rings buy nothing and exchange into nothing. Empty on purpose; they are evidence.

---

## 4. Money movement (ledger entry kinds)

MECE by direction relative to the system, then by counterparty. Every ledger entry is
exactly one kind. A "move" is one logical transaction producing paired entries.

| Class | Kind | Direction | Justified by |
|---|---|---|---|
| **Mint** | `earn` | outside → account | evidence + an earn rule (absolute basis) |
| **Mint** | `prize` | outside → account | a contest closing (relative basis) |
| **Mint** | `deposit` | outside → account | a Parent, with a note; outside any rule |
| **Mint** | `growth` | outside → account | a savings rule and a period elapsing |
| **Burn** | `spend-metered` | play clock → outside | minutes consumed by observed play |
| **Burn** | `spend-discrete` | account → outside | a priced menu item + authorization |
| **Burn** | `cash-out` | account → outside | a Parent approval |
| **Burn** | `expire` | account → outside | week close (only for things that do not convert) |
| **Move** | `convert` | account → account, different currency | silver→gold at week close; silver→ticket at purchase; ticket→silver at refund; ticket→play clock at redemption |
| **Move** | `transfer` | account → account, different subject | gift to a sibling; contribution to a pool |
| **Move** | `lock` / `unlock` | account → sub-account | savings with a term |
| **Correct** | `adjust` | either | a Parent, or a system reconciliation, with a ref to what it corrects |

Invariants:

- Every `earn` and `prize` carries an idempotent `ref` naming its evidence (learner +
  granularity + period + timeliness). Replaying evidence never double-pays.
- `convert` and `transfer` are atomic pairs. One side cannot commit without the other.
- Every priced entry records the **tariff in force** and the timeliness it was priced at.
- Only `adjust` may take a balance negative. Display floors at zero; earning repays.
- Nothing in **Burn** is ever created by the absence of an action.

---

## 4a. The three questions every spend passes

Three independent axes decide whether a privilege can be bought at this moment. They
have different authors, different inputs, and different failure postures, so they are
never folded into one rule. A surface asks them in order and reports **which one said
no**, because the learner needs a different answer for each.

| Order | Question | Axis | Input | Can be indeterminate? | Answer when no |
|---|---|---|---|---|---|
| 1 | **Is it open?** | Availability | clock + household calendar | never | "closed until Saturday 09:00" |
| 2 | **Am I allowed?** | Eligibility | evidence via State Gates | yes | "finish school first" / "can't tell yet" |
| 3 | **Can I afford it?** | Affordability | balance × tariff at this instant | no | "3 more silver" |

Games already run questions 1 and 2 in one evaluator: `assessEligibility` takes the
privilege's `windows` (availability, per-title overridable, admin-administered) and the
learner's satisfied state-gate assertions (`requires`), and returns every refusal with a
reason (`outside_play_window`, an unmet assertion, `device_unobservable`). That is the
shape to keep: **availability lives with the privilege, eligibility comes from State
Gates, affordability comes from the economy, and one evaluator per privilege asks all
three and names the refuser.**

MECE check on the two clock-driven ones: availability and tariff are both functions of
time but occupy different cells. A closed window makes a thing **impossible**; a
surcharge makes it **expensive but possible**. A parent who wants "TV on a school night
is possible but costs double" writes a tariff; one who wants "no TV after seven" writes
an availability window. The same hour can carry both.

| | Price unchanged | Price modified |
|---|---|---|
| **Open** | ordinary purchase | discount day / surcharge hour (tariff) |
| **Closed** | closed (availability) | *empty on purpose: a price during a closed window is meaningless* |

The clock currently has **three** homes in code: the gaming policy's `windows` (live,
admin-edited), the State Gates `schedule` expression, and the economy policy's
`blackout`. Conceptually they are one axis. D8 keeps the first, allows the second for
gates that are genuinely about time, and retires the third.

---

## 5. Earning triggers

MECE by domain × granularity. A cell is one rule with its own `ref` shape and its own
policy defaults. Anything that mints silver or gems lands in exactly one cell.

| Domain \ Granularity | Unit | Day | Week | Term |
|---|---|---|---|---|
| **School** | unit served (default 0; per-unit config opts in); **extra credit**: an unassigned unit served, typically Saturday, at its own tariff | day `met` (paid live on the completion transition; **or on makeup**, at the makeup tariff) | week `met`: every study day green and the weekly row green → silver + 1 gem (ruby) | *empty for now* |
| **Fitness** | *empty* (a workout is not paid) | *empty* | (a) ring **threshold award**: each N rings reached in the award week → silver, once per threshold (absolute); (b) ring **contest prize**: most rings in the award week → silver + 1 gem (sapphire) (relative). The **award week is Monday 04:00 → Saturday 12:00**; the fitness bar's Monday→Monday week is untouched | *empty* |
| **Piano practice** | qualified take (existing rule, cooldown-limited) | *empty* | *empty* | *empty* |
| **Household** (subject = pool) | *empty* | *empty* | **everyone-condition**: every learner holds this week's gem → household gem (emerald) or a declared event | *empty* |
| **Parent** | appreciation `deposit` (not granular; outside this table by design) | | | |
| **System** | | | | `growth` on a locked savings sub-account, per its own period |

### 5.1 Basis: absolute or relative

Every earn rule has exactly one basis.

| Basis | Pays when | Needs | Kind |
|---|---|---|---|
| **absolute** | a threshold or completion is reached by *this* learner | evidence for one subject | `earn` |
| **relative** | this learner ranks first among a named set at period close | standings across subjects; a tie rule | `prize` |

Only contests are relative. A relative rule is always week-bounded, always declared in
policy with its subject set and tie rule (split, all-win, or none), and its standings are
shown only as a leader mark during the week and a winner mark after, never as an ordered
list; where counts are already public (the status board), they stay in roster order.

### 5.2 Timeliness: on-time, makeup, lapsed

Every day-granularity earn has exactly one timeliness, stamped by School. A week's
timeliness is the worst of its weekdays: one made-up Tuesday makes the week bonus a
makeup-rate bonus (D11).

| Timeliness | Meaning | Pays |
|---|---|---|
| **on-time** | served within the study day | full tariff |
| **makeup** | served after the day closed but within the grace window (a Saturday makeup turns an amber day green) | makeup tariff (fewer silver) |
| **lapsed** | beyond the grace window | nothing; the day stays as it was |

Makeup is a **School** feature that does not yet exist: today the term grid replays a day
using only evidence stamped before that day's window closed, so late work cannot recolour
it. The economy consumes whatever verdict School emits and prices it by the timeliness
School stamps. The `ref` includes timeliness, so an on-time earn and a makeup earn for the
same day are distinct facts and the one that never happened is never paid.

### 5.3 Evidence trust

Declared per rule (categories from the existing economy roadmap):

| Evidence source | Example |
|---|---|
| `trusted-device-event` | completion bridge transition; ring totals; play-session observation |
| `assessment-result` | a graded quiz; a term-grid verdict |
| `parent-confirmed` | an attestation at the teacher console; an appreciation deposit |
| `self-report` | *not used by any earn rule in this design* |

### 5.4 Settlement timing

- **Unit** and **Day**: paid live, on the event. Immediate feedback is the point. A makeup
  day pays live on the makeup event, on the day the work was done.
- **Week**: paid the moment the week condition is met, not at a fixed close. For school
  that is Friday afternoon at the earliest and Saturday after makeup at the latest, so the
  bonus is in hand for Saturday's games. The ring award week closes Saturday noon for the
  same reason. Sunday night is the *conversion* close only: tickets refund, silver becomes gold.
  A week greened by makeup counts (D11 decides at which tariff).
- **Verdict drift**: the term grid re-colours the past when config changes. A payout is a
  fact about the verdict *as observed at settlement*. Drift never reverses it; it surfaces
  to the Parent as a candidate `adjust`.

---

## 6. Spending shapes

MECE by what the learner receives.

| Shape | Receives | Priced in (all tariff-bearing) | Consumed | Cap lives on |
|---|---|---|---|---|
| **Metered privilege** | time on a screen | minutes on the play clock (tickets redeemed at the reader) | by observed play, to the minute | minutes redeemed per week (90) |
| **Discrete screen privilege** | a whole movie or show, one unit whatever its length | tickets, per item | at redemption | per-item weekly cap |
| **Discrete privilege** | a menu item: dessert pick, late bedtime | silver or gold, per item | at authorization | per-item daily/weekly cap |
| **Cash-out** | real money | gold | at Parent approval | Parent approval |
| **Goal contribution** | progress toward a named target | gold (own goal) or gems (pool) | at lock/transfer | none |

Not spending shapes, though they reduce a balance: `convert`, `expire`, `adjust`. The learner receives nothing for them. Keeping them out of this table keeps
"what did I buy" answerable.

---

## 7. Cross-cutting axes

These slice every concept above. Each earn or spend rule takes exactly one value on each.

### 7.1 Period
`instant` · `day` · `week` · `term` · `open`. Earn refs key on unit/day/week. Expiry and
conversion key on week. Caps key on day or week. Savings terms key on months, i.e. `open`
with a lock date.

### 7.2 Authorization strength (spends only; earns need only attribution)
| Level | Mechanism | Fits |
|---|---|---|
| `trust` | active avatar, ambient | tiny self-serve discrete spends |
| `identify` | fingerprint reader ceremony (exists) | ticket purchase; most self-serve |
| `pin` | personal PIN at a kiosk (not built) | later |
| `parent-mobile` | async approval over the notification stack | cash-out; big-ticket |

### 7.3 Subject
`learner` · `household`. A pool is a household-subject account. Contributions are
`transfer` entries from a learner subject. Household earns (the everyone-condition) mint
straight into the household subject.

### 7.4 Basis
`absolute` · `relative` (section 5.1).

### 7.5 Timeliness
`on-time` · `makeup` · `lapsed` (section 5.2). Spends are always `on-time`; the axis is
listed here because every *priced* entry records it.

### 7.6 Visibility
`private` (learner + parents) · `shared-logistics` (a balance chip, a countdown, a pool
thermometer, a contest leader). There is no `shared-standing` category, on purpose.

### 7.7 Access layer
Every rule that restricts a spend belongs to exactly one of `availability` · `eligibility`
· `affordability` (section 4a).

### 7.8 Surface
Where a job is performed. Each job in section 8 names at least one.

| Surface | Exists | Economy role |
|---|---|---|
| School Portal (tablet, FKB) | yes | earn feedback; day-met and makeup celebration |
| Piano kiosk | yes | earn feedback (existing rules) |
| Fingerprint reader | yes | identify; ticket purchase ceremony |
| Living-room console (Shield + RetroArch + FKB overlay) | observability yes; overlay yes | countdown, identity, tickets remaining |
| Browser arcade (garage Firefox, tablets) | yes, metered-spend exists | same clock in React |
| Garage fitness display | yes | rings to next award; contest leader |
| Status board / living-room screen | yes | balances, pool progress, household gem |
| Parent phone (Telegram / journalist bot) | yes | approvals, weekly digest, adjust prompts |
| Teacher console | yes | attestations; makeup marking; maybe deposits |
| Admin app | yes | game hours today; tariffs and rules later |
| CLI | yes | deposit, adjust, ledger inspection |

---

## 8. Jobs to be done

Format: *When [situation], I want to [motivation], so I can [outcome].* Grouped by role,
then by lifecycle stage. Each job maps to one stage; stages together cover the whole life
of a coin: **earn → hold → spend → settle → govern → observe**.

### 8.1 Learner

**Earn**
- L1. When I finish a piece of school work, I want to see right away what it earned, so effort and reward feel connected. *(Portal)*
- L2. When I finish everything for the day, I want the day bonus shown and celebrated, so the whole day feels like the unit that matters. *(Portal, status board)*
- L3. When I finish a green week or win the ring contest, I want that to pay out without anyone remembering to do it. *(House, status board)*
- L14. When I missed a day, I want a way to make it up on Saturday and still earn something for it, so one bad Tuesday does not write off the week.
- L15. When I move a lot, I want to see how close my rings are to the next award, so exercise counts toward the same things school does.

**Hold**
- L4. When I look at my wallet, I want to see silver, gold, tickets and gems separately, so I know what I must use this week and what is mine for good.
- L5. When the week is ending, I want to know what will convert or refund, so Sunday night never surprises me.

**Spend**
- L6. When I want to play, I want to buy tickets and turn them into time myself with my own finger, so playing is not a negotiation with a grown-up. *(fitness app, reader)*
- L7. While I play, I want to see my name and my clock, and be warned before it ends, so I am never cut off mid-level. *(console overlay, browser arcade)*
- L8. When I stop early, I want the minutes I did not use still on my clock, and tickets I never redeemed refunded Sunday, so buying ahead is not a gamble.
- L9. When I want a treat from the menu, I want to buy it and have a parent told, so I do not have to ask twice.
- L16. When something is cheaper tonight, I want to know, so I can choose to spend on the good night.

**Save and pool**
- L10. When I want something big, I want to lock gold away with a date and watch it grow, so I learn what waiting buys.
- L11. When the family wants something together, I want to put in a gem and see the pool fill, so my contribution counts the same as my older sibling's.
- L17. When all of us earned our gem this week, I want the house to notice and unlock the thing we agreed on, so a good week is a shared win.

**Understand**
- L12. When my balance is not what I expected, I want to see the history in words I understand, so I can trust the number.
- L13. When something is refused, I want to be told *which* of the three said no (closed, not allowed, can't afford) and what would change it, so I know whether to wait, work, or save.

### 8.2 Parent

**Govern**
- P1. When the term starts, I want to write the rules once (rates, caps, tariffs, per-learner overrides), so I am not adjudicating daily.
- P2. I want screen time capped per week regardless of how much is earned, so a productive week cannot become a lost weekend.
- P3. I want evergreen wealth never to buy screen time, so saving is safe from the arcade.
- P4. I want a rule I can pause during illness or travel with no debt and no lost standing.
- P10. I want to set opening hours per privilege (games on Saturdays, screens off at 19:00) independently of anything the learner has earned or done. *(exists for games)*
- P11. I want to make some moments cheap and others dear (movie night at a discount, a school-night show at a surcharge) without closing them, so the price carries the nudge.
- P12. I want a gate such that no balance, however large, buys a privilege before the day is green.
- P13. I want makeup work to count, at a rate I set, so the incentive to catch up survives a missed day without making lateness free.
- P14. I want to declare a contest (who, what measure, what prize, how ties resolve) for one week at a time, so competition is something I chose and can stop.

**Bank**
- P5. I want to deposit an appreciation with a note, outside any rule, so generosity is not disguised as payment.
- P6. I want to correct a mistake with a reason and an audit trail, so the ledger stays true without being rewritten.

**Approve**
- P7. When a learner asks to cash out or buy something big, I want to approve or decline from my phone, and the funds held until I do.

**Observe**
- P8. Each week I want to see who earned what and why, so I can talk about it with specifics.
- P9. I want to be told when a payout was refused, blocked, or indeterminate, so silent failure cannot look like a lazy week.

### 8.3 House

**Observe evidence**
- H1. When School says a learner-day is complete, on time or as makeup, mint the day earn once and only once, keyed on learner, date and timeliness.
- H2. When Fitness ring totals reach an award threshold, mint the award once, keyed on learner, threshold and period; never touch the ring total.

**Settle**
- H3. At week close: pay week bonuses from the term grid, close contests and pay prizes, evaluate the everyone-condition, refund unused tickets to silver, convert silver to gold, mint gems, and record each as its own entry.
- H4. At a savings term's end: mint growth and unlock.

**Enforce**
- H5. When play is requested, issue a grant only from the player's play clock, bill only observed play to the minute, and warn before stopping.
- H6. When a gate says play may not begin, do not issue a grant, whatever the balance.
- H11. When a spend is requested, evaluate open → allowed → affordable in that order, price it at the tariff in force at that instant, and record which layer refused and the price quoted.

**Reconcile**
- H7. When evidence changes after settlement, never rewrite. Surface a candidate adjust to the Parent.
- H8. When a metered session is lost, settle only witnessed time and return the rest.

**Fail safe**
- H9. When evidence is indeterminate, neither pay nor punish; retry, and say so.
- H10. When the economy is unreachable, the surface degrades visibly rather than inventing a balance.

---

## 9. Ownership map

Which bounded context answers which question. No question has two owners.

| Question | Owner |
|---|---|
| Was the day / week met, and was it on time or makeup? | School (term grid, completion bridge) |
| How many rings, and who leads this week? | Fitness |
| Is this person who they say they are? | Identity (reader, Portal login) |
| Is this privilege open right now? | The privilege's own policy (games: play-eligibility `windows`) |
| Is this learner allowed this privilege? | State Gates (evidence gates) |
| What does it cost right now? | Economy (tariff) |
| How much did they earn, hold, spend, convert? | Economy |
| How many minutes are on the clock, and how many were played? | Economy (play clock) with Play Sessions (grant and meter) |
| Where does the countdown draw, and what does it say? | Play Sessions (placement) and the surface |
| Was the parent asked, and what did they say? | Notification stack, recorded by Economy |

---

## 10. Open decisions carried forward

Recorded here so the stories doc inherits them as settled or as explicit unknowns.

| # | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | Pay period | **decided 2026-09-14:** spend as you earn at every granularity. Assignments run Monday–Friday; Saturday is makeup, extra-credit, payday and game day, with nothing assigned. The week bonus pays the moment every weekday is green (Friday at the earliest, Saturday after makeup at the latest), never held to Monday. Sunday night: tickets refund, silver converts. Consequences: a School × Unit **extra-credit** earn cell; the ring award week closes Saturday noon so prizes are playable Saturday (D10); School schedule config marks Saturday as makeup/extra-credit | decided |
| D2 | Silver→gold rate | 1:1 base tariff | proposed |
| D3 | Ticket billing | **decided 2026-09-14:** tickets are not billed. They are *redeemed* into a per-learner **play clock** of minutes; games drain the clock to the minute. Unredeemed tickets refund to silver Sunday; redeemed minutes expire Sunday without refund | decided |
| D4 | Where tickets are bought and redeemed | **decided 2026-09-14:** in the fitness app, at the garage fingerprint reader, for both game surfaces. Config-driven so other identify-capable surfaces can be allowed later | decided |
| D5 | Rates | doc carries a derivation from the 90-minute cap; numbers are placeholders | proposed |
| D6 | Existing `coins` ledger entries | tagged silver, converted to gold at the first week close | proposed |
| D7 | Relation to the reinforcement-programs roadmap | this economy is the privilege-gating layer; fading is out of scope here | proposed |
| D8 | Home for availability windows | with each privilege's own policy, as games already do (`windows`, admin-edited); State Gates `schedule` only for gates that are genuinely about time; retire the economy `blackout` field | proposed |
| D9 | Tariff shape | base + ordered modifiers, each with a schedule or date span and a multiplier or absolute override; first match wins; evaluated per entry and recorded on it; applies to earns (timeliness) as well as spends | proposed |
| D10 | Ring threshold awards | **decided 2026-09-14:** no exchange. Rings are evidence; each threshold reached pays an award, idempotent per learner + threshold + award week. The **award week is Monday 04:00 → Saturday 12:00**, an economy-side window over Fitness's session data; the contest is judged at Saturday noon. Rings after that still show on the Monday→Monday fitness bar but earn nothing (config knob to roll them into next week, default off) | decided |
| D11 | Week bonus when a day was made up | **decided 2026-09-14:** pays, at the makeup tariff if any weekday in the week was makeup. The week's timeliness is the worst timeliness of its days | decided |
| D12 | Gem colours | **decided 2026-09-14:** one currency; colour = provenance (ruby: green school week, sapphire: ring contest win, emerald: household everyone-week); every gem is worth one; pooled-only. A colour becomes its own currency only if a real reach difference is ever wanted | decided |
| D13 | Contests vs the no-standing rule | **decided 2026-09-14:** every child's weekly ring count is *already* public on the school status board (`AgendaStatusBoard`, one card per child, roster order). The contest adds only a leader mark on the leading card during the award week and a winner mark after Saturday noon. Cards are never reordered by rank and nobody is labelled last. The leader mark reads the Monday→Saturday-noon award-week count, not the board's Monday→Monday `fitness.weekly-rings` figure, since they diverge after Saturday noon | decided |
| D15 | Ticket colours and movie tickets | one ticket type; items priced in tickets (10 game minutes = 1, a movie = N); colour = face value only. A movie-only ticket a game cannot use would be a second voucher with its own cap and refund rules; not proposed | proposed |
| D14 | Makeup mechanics | a School feature: a grace window per obligation, a way to serve a past day, and a `timeliness` stamp on the verdict. Blocks L14/P13 until built | dependency |
