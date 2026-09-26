# School → Economy: Weekly Earnings Preview

**Date:** 2026-09-26
**Status:** Building (preview only — no ledger writes)
**Builds on:** `2026-09-14-household-economy-taxonomy.md` (vocabulary, currencies,
earning triggers §5, decisions D10–D13), `docs/reference/economy/economy.md`.
**Design review:** Fable (2026-09-26), adopted in full — see "Decisions".

## Why

It is Saturday. The owner wants to show each child what this week's work is worth
in **silver** (the weekly currency that later buys game time), before the bank /
exchange exists and before rates are fixed. That needs:

1. a rule model that can pay per assignment, per subject-day, per subject-week,
   per green day, per green week, and for rings (thresholds + a weekly contest);
2. per-learner rates (preschoolers get more for simpler tasks);
3. a teacher-console view per student: the week's work, the silver it earns under
   today's rules, and inline rate edits;
4. abstract, reusable APIs (teacher today; fitness / admin later), DDD-clean.

## Model

### Evidence (produced by School and Fitness through ports)

Economy never reads school or fitness files. Each port returns facts already
windowed for its period. Fact vocabularies are copied verbatim from the term grid.

| Fact | Shape | Source |
|---|---|---|
| section-day | `{day, subject, state: served\|obligated\|excused\|faulted, reason}` | term verdict rows (`TermVerdictService.read({detail:true})`) |
| day | `{day, state: met\|partial\|none\|exempt\|unknown, reason}` | term verdict rows |
| week | `{weekId, state, reason, open}` | term verdict week row |
| unit | `{day, unitId, subject, courseId}` | learner sessions with an outcome, dated to the week |
| rings | `{learnerId, rings}` per roster learner, award week | fitness session summaries |

Every fact carries `timeliness: 'on-time'` (makeup — D14 — is not built; the field is
reserved so refs are stable when it lands).

Two windows, never cut by the evaluator:
- **school week** Monday → Sunday (study days);
- **ring award week** Monday 04:00 → Saturday 12:00 (D10).

### Rules (economy-owned; household file with revisions)

`household/economy/earn-rules.yml`:

```yaml
revision: 3
revisedAt: 2026-09-26T16:00:00Z
revisedBy: kckern
currency: silver
rules:
  - id: korean-daily
    label: Korean (each day)
    kind: section-day          # each day the matched section is served
    match: { subject: language }
    reward: { silver: 2 }
  - id: scripture-week
    label: Scripture (whole week)
    kind: section-week         # every obligated day served (weekly_satisfied counts), ≥1 served
    match: { subject: scripture }
    reward: { silver: 5 }
  - id: green-day
    kind: day-met
    reward: { silver: 1 }
  - id: green-week
    kind: week-met
    reward: { silver: 5, gems: 1 }
  - id: rings
    kind: ring-threshold
    rate: { rings: 100, silver: 1 }   # 1 silver per whole 100 rings (rings run to hundreds a week)
    thresholds: [{ at: 250, reward: { silver: 2 } }]
  - id: ring-contest
    kind: ring-contest
    tie: all                   # split | all | none
    reward: { silver: 5, gems: 1 }
users:
  preschooler-id:
    multiplier: 2
    rules: { korean-daily: { reward: { silver: 3 } }, ring-contest: { disabled: true } }
```

Rule kinds (MECE: scope × period):

| kind | pays for | taxonomy §5 cell |
|---|---|---|
| `unit` | each served unit matching the selector | School × Unit |
| `section-day` | each day the matched section is `served` | School × Day, subject-scoped |
| `section-week` | the week, when every day the section was `obligated` reads `served` (or `excused: weekly_satisfied`), with ≥1 served | School × Week, subject-scoped |
| `day-met` | each term-grid day `met` | School × Day |
| `week-met` | the week row `met` | School × Week (+1 ruby) |
| `ring-threshold` | `rate` (silver per whole N rings), plus each threshold crossed in the award week | Fitness × Week (a) |
| `ring-contest` | first in the roster at Saturday 12:00 (relative; leader mark before) | Fitness × Week (b) |

Selectors: `match: { subject | courseId | unitId (prefix) }`, all optional, all ANDed.
Optional `effective: {from, to}` scopes a rule to dates (a term, a mid-term change).
A rule that pays twice is two rules — no `bonus:` field.

Per-learner overrides under `users.<id>`: `multiplier` (applies to silver) and per-rule
`reward`, `rate`, `thresholds`, `disabled`. Most-specific wins, like `resolvePolicy`.

### Evaluation (pure domain)

`evaluateEarnings({ ruleset, facts, learnerId, standings })` →

```
{ rulesRevision, currency, windows: {school, rings},
  totals: { silver, gems },
  lines: [{ ruleId, label, kind, status: 'earned'|'none'|'pending'|'indeterminate',
            count, amount: {silver, gems},
            priced: { revision, reward, multiplier },
            evidence: [{ day|unitId|threshold, state }], note, ref }] }
```

- `status: indeterminate` when a matched fact is `faulted` / `unknown` — never a
  silent zero (H9). `pending` for a still-open week or a contest before Sat noon.
- `ref = earn:<learner>:<rule>:<period>:<timeliness>` — the future payout's idempotency
  key. The revision is recorded **on** the line (`priced`), never in the ref, so a rate
  edit can never pay a week twice.

### Revisions

Every write stores the previous document under
`household/economy/earn-rules.history/<revision>.yml` and bumps `revision`, stamping
`revisedAt` / `revisedBy` (the teacher gate's identity). The preview reports
`rulesRevision`.

## Architecture (DDD)

```
2_domains/economy/earnings/        pure: rule validation, override resolution, evaluateEarnings
3_applications/economy/
  ports/IEarnRulesStore.mjs        read/write + history
  ports/IEarningEvidenceSource.mjs schoolWeek(learnerId, week), awardWeekRings(learnerIds, week)
  EarningsPreviewService.mjs       gather facts via ports → evaluate (no ledger writes)
  EarnRulesService.mjs             read, replaceRuleset, setUserOverride (revisions)
3_applications/school/SchoolEarningEvidence.mjs     port impl over TermVerdictService + sessions
3_applications/measures/fitnessRingsProvider.mjs    + awardWeek(learnerIds, window)
1_adapters/persistence/yaml/YamlEarnRulesStore.mjs
4_api/v1/routers/earnings.mjs      GET /api/v1/earnings/preview[?week], /preview/:learnerId, /rules (read-only)
4_api/v1/routers/school.mjs        PUT /teacher/economy/earn-rates/:learnerId, /earn-rules (ManageEarnRules → TeacherGate)
5_composition                      wires ports, stores, gate
```

## Teacher view

A **Coins** tab per learner (teacher console):
- header: silver total, gems, rules revision, week stepper (Mon–Sun);
- the week's work: Mon–Sun day chips (term-grid state) and per-subject served marks;
- one row per rule line: label, evidence chips, rate (inline number for this learner;
  writes the per-learner override, re-fetches), amount; zero / indeterminate lines say
  why; rings row shows count, next threshold, leader mark.

## Decisions (Fable review, 2026-09-26)

1. Seven kinds as above; no `bonus`; `ring-contest` included now; timeliness reserved.
2. Rules are economy-owned, not on enrollments (a frozen snapshot) or the term grid
   (a derived cache). `effective` instead of `terms`.
3. `multiplier` + per-rule override under `users:`; append-only revisions; ref excludes
   the revision.
4. Two windows (school week, ring award week); reward is a currency map.
5. Minimal Saturday view as above; no ledger, no bank — next piece.

## Not in this slice

Ledger payout, week close / silver→gold conversion, tickets and the play clock,
makeup timeliness, the bank/exchange widget, household gems.
