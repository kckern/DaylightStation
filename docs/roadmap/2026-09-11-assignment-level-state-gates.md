# Assignment-level State Gates — design

**Status:** design, not built. Blocked on a prerequisite named below.

**The ask:** let a household gate something on a *specific* assignment being
done — "maths before screen time" — instead of only on the whole school day.

---

## 1. What exists today

School publishes exactly one fact about a learner per day.
`SchoolStateGatesProducer` (`3_applications/school/SchoolStateGatesProducer.mjs`)
is titled *"Translate authoritative School day completion into State Gates
evidence"*, and it emits:

```js
assertionId:  `school:day-complete:${learnerId}:${day}`
claimTypeId:  'school.day.complete'
subject:      { kind: 'learner', id: learnerId }
period:       { kind: 'interval', id: `school-day:${day}`, startsAt, endsAt }
value:        COMPLETE_STATES.has(state)      // 'complete' | 'no_work_today'
```

One boolean, per learner, per study day. The gate `school.day-complete` is a
single claim lookup over it.

Three consequences worth stating plainly:

- **The flow is School → State Gates, not the reverse.** No school program
  launcher reads State Gates; the only file in `3_applications/school/` that
  mentions it is the producer that writes into it.
- **There is no per-assignment granularity anywhere in State Gates.** A rule
  about maths specifically cannot be expressed at all today.
- **It is already config-driven.** `installedStateGatesPolicy.mjs` says so:
  *"A household-authored `state-gates/config.yml` still takes precedence; this
  graph makes the installed School/Piano/Fitness wiring usable before a
  household needs any custom policy."* Claim types and gates are declarable
  from household config without touching code. That is the configurability
  this design needs, and it already exists.

## 2. The modelling problem

State Gates resolves a claim by **(type, publisher, subject, period)**. That is
the whole address space:

```js
claim: { type: 'school.day.complete', publisher: 'school',
         subject: '$subject', period: '$period' }
```

`subject` must stay the learner — entitlements are about a child, and
`SUBJECT_KINDS` is `['learner', 'room', 'device', 'household']`, with no
`assignment` kind. `period` is already the study day. So "which assignment"
is a **fourth dimension the model does not have**.

### Option A — one claim type per gated subject *(recommended)*

```yaml
claim_types:
  school.subject.math.complete:
    schema_version: 1
    value: { type: boolean }
    subject_kinds: [learner]
    period_kinds: [interval]
    accepted_publishers: [school]
```

The assignment identity rides in the claim type id. No domain change: claim
types are already declared in config, and only the subjects a household
actually gates on need to exist. **Cardinality control falls out of the
design** rather than being bolted on — an undeclared subject emits nothing.

The cost is a claim type per gated subject, which reads as proliferation until
you notice the alternative is proliferation of rows instead.

### Option B — add a qualifier to claims

Give assertions an optional qualifier (`{ subject, qualifier: 'math' }`) and
teach gate expressions to match it. Cleaner conceptually, and correctly says
that "maths" is a dimension of the claim rather than a different *kind* of
claim. But it reaches into assertions, evaluation, aggregates, refs and
replay — every part of the domain — for one consumer.

**Start with A.** It needs no domain change and can be withdrawn by deleting
config. If several subsystems later want the same dimension, B becomes worth
its cost and A's claim types migrate onto it.

## 3. Where the opt-in lives

Two candidate surfaces, and they are not exclusive:

| surface | grants | cost |
|---|---|---|
| household `state-gates/config.yml` | which subjects are gateable at all | already exists |
| the enrollment record | whether *this learner's* assignment emits | new field, new plumbing |

**Start with config only.** If a claim type exists for `math`, School emits for
maths; if it does not, School emits nothing. That is one surface, already built,
and it expresses every rule described so far.

Add the enrollment flag when a real case needs one child's maths gated and
another's not. It is a strictly additive change (an enrollment saying "not me"
suppresses an emission that config permits), so deferring it costs nothing.

## 4. Retraction matters more here than at day level

The existing producer retracts on `indeterminate`, and that path becomes
load-bearing rather than defensive. A day rarely un-completes; an **assignment
does** — a sheet is regraded below threshold, work is retracted, a scan is
reprocessed. A gate that latched true on a since-revised assignment would hand
out an entitlement the child has not earned, and would keep handing it out.

Every emission needs a matching withdrawal path, and the tests should drive the
value *down* as well as up.

## 5. The prerequisite — read this before building

**This needs a per-assignment completion signal that can be trusted, and until
today there was not one.**

The agenda board draws a disc per assignment from plan ∪ evidence, where the
program half is the launcher's `servedWork`. On 2026-09-11 six of nine
launchers reported none, so finished work simply vanished from the board —
which is how this was found. That is fixed (`servedWork` now reported by every
program launcher; see `docs/reference/school/programs.md`).

A second defect is still open and is directly relevant: **the language
day-close bridge has never fired.** `CloseLanguageDay` subscribes to
`school.language.day-complete`, and the emit at
`LanguageStudyService.mjs:203` logs at `info` on the line before it fires —
the production log store has **zero hits over seven days**, for both that event
and its rejection path, while learners demonstrably completed language days.

The lesson for this design: **derive assignment claims from stored evidence on
every read, not from a transition event.** `servedWork` survives a missed
event because it is recomputed; a session created by one is lost forever. An
assignment-level producer built on "fire when it completes" would inherit
exactly the failure that is already live in the language bridge, and a gate
that silently never opens is harder to notice than a missing disc.

## 6. Sketch

- A producer reading the same per-learner agenda projection the board reads,
  emitting one assertion per *declared* subject per learner-day.
- `assertionId: school:subject-complete:<learner>:<day>:<subject>`.
- Value from the section's `obligation.state === 'served'` — the field that was
  already correct today even while the disc was missing.
- Re-derived on each refresh, so a missed event self-heals on the next read.
- Gates authored in household config alongside the claim types.

## 7. Open questions

- Does an entitlement want "maths done" or "maths done **before** X"? Ordering
  is a different question from completion, and the period model may need to
  carry the time the claim became true rather than only that it did.
- What does a subject with no work today assert — `true` (nothing owed),
  `false`, or nothing at all? The day-level producer treats `no_work_today` as
  complete; the same choice at assignment level is less obviously right.
- Does the coin economy want to consume these? It currently earns on piano and
  spends at the arcade; per-subject gates would let it price differently, which
  is a policy question, not a technical one.
