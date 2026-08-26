# School cold start — from empty data volume to a working homeschool

> Already running and something's broken? See the
> [day-to-day operations runbook](./school/README.md) instead — this file is
> the one-time installer's sequence.

This is the installer's sequence. It exists because the School app spans four
config surfaces, two content trees, and three hardware integrations, and until
now the order lived only in code and past sessions. Follow it top to bottom; each
step names what fails (and how loudly) when skipped.

The content layout itself is documented in
[`reference/school/authoring/content-layout.md`](../reference/school/authoring/content-layout.md)
and the per-work config in
[`reference/school/authoring/work-config.md`](../reference/school/authoring/work-config.md).
Those two files are the course-creator's manual; this runbook is the operator's.

## 0. What "school" reads at boot

| Path (under the data mount) | What it is | Missing ⇒ |
|---|---|---|
| `household/config/school.yml` | THE config: students, subjects, materials sources, teachers, PINs, periods, printables, lifecycle | School surfaces empty / gated features off |
| `content/school/{subject}/{work}/…` | Authored curriculum tree (works, units, documents, quizzes) | Empty shelves — normal for a fresh install |
| `content/school/generated-banks/recipes.yml` | Generated-bank recipes | Empty generated shelf, **warn log** (`school.generated-banks.recipes-missing`). Malformed ⇒ empty + **error log**. Never a crash. |
| `content/school/catalog/surfaces/*.yml` | Certified surface profiles (paper, screen) — `capabilities:` gates which printables/documents that surface may render | A printable whose bank needs a capability the profile lacks is silently excluded from `GET /print/printables` (see step 2.8) |
| `household/config/works/{slug}.yml` | Per-work enrolment drill-downs | That work unrestricted / unlisted |
| `household/apps/school/*.yml` | Runtime state (periods, overrides, milestones, attestations, notes, quiz-requests) | Created on first write; absence is a valid cold state |
| `household/apps/school/cache/materials.yml` | Disk snapshot of the compiled material index — seeds the units cache at boot (`school.material.snapshot-seeded`) so a redeploy skips the provider's serialized cold sweep | First post-boot sweep pays the full provider fan-out once, then rewrites it. **Regenerable cache** — safe to delete; corrupt = warn + rebuild, never a refusal |
| `users/{id}/apps/school/` | Per-learner attempts, sessions, report cards | Created on first activity |

`school.yml` is **boot-cached**: every edit needs a container restart.

## 1. Roster before school

School filters the household roster; it never defines people. Each learner needs
`data/users/{id}/profile.yml` with a `birthyear` (the adult/child line is 18,
and a missing birthyear FAILS CLOSED for authority checks — an adult without a
birthyear cannot approve anything).

## 2. `school.yml`, key by key (order matters only for your sanity)

1. `students:` — the learner ids enrolled. Not age-derived; explicit.
2. `teachers:` — roster ids with teacher authority (`[kckern, elizabeth]`
   shape). ABSENT key ⇒ any household adult passes the gate; empty list ⇒
   nobody does. Served by `GET /api/v1/school/teachers`.
3. `teacher.pin` — the teacher-console PIN (distinct from `print.teacherPin`).
   Absent ⇒ the console works without a PIN prompt.
4. `print.teacherPin` — gates print-document approval flows.
5. `progress.academicPeriods` — the CONFIG fallback for periods. After the
   first teacher edit, `household/apps/school/periods.yml` wins and this key
   is ignored.
6. `materials.sources` — Plex roots with `category:` (course / reference /
   listening) and `subject:`. Wrong/missing subject routes content to the
   Library silently — check the shelf after adding.
7. `schoolcalc.continuation.learner_slots` — stable digit slots for printed
   continuation codes. Changing a slot invalidates already-printed codes.
8. `printables:` — quota-printed worksheets (`{id, label, type: bank|pdf, …}`).
   **A `type: bank` printable is served only if the paper surface profile
   declares every capability its items need.** The profile
   (`content/school/catalog/surfaces/<profile>.yml` → `capabilities:`,
   boot-cached — see the content-tree table below) must carry
   `response.text@1` for any bank with `short_answer`/`cloze` items and
   `response.matching@1` for any bank with `matching` items, alongside the
   baseline `response.choice@1`/`response.asset-choice@1`. A printable
   missing a capability its bank needs is silently excluded from
   `GET /print/printables` — the Print Center just never lists it — and the
   tell is a warn log naming exactly what's missing:
   `{"event":"print.printable-excluded","data":{"printableId":"...",
   "bankId":"...","reasons":["missing capability response.text@1", ...]}}`.
   Grep for `print.printable-excluded` after standing up any new printable
   whose bank has short-answer or matching items.
9. `lifecycle:` — the physical console (cards, OMR, thermal printer). See
   [`school-physical-console-deploy.md`](school-physical-console-deploy.md).
10. `quiz_pass_percent` (materials config) — the media quiz-gate bar, exposed
    to runners as `quiz.passingPercent`.

## 3. Content tree

Lay out `content/school/{subject}/{work}/{units,documents,quizzes}/` per the
authoring docs. Validate BEFORE mounting:

```bash
node cli/school.mjs docs validate     # print documents
npm run school:certify                    # catalog/surface certification
```

A malformed bank YAML no longer vanishes silently — the boot warm logs every
bank that fails to summarize (`school.bank.summarize-failed`).

## 4. Hardware (each optional; each degrades without the next)

- **Thermal printer + laser printer** — devices.yml; print routes 503 politely
  when absent.
- **NFC card scanner** — card bindings under `household/apps/school/`; the
  lifecycle serves agendas without it via the teacher console.
- **OMR reader (Chatsworth OMR-1100)** — `docs/reference/omr/README.md`. The
  virtual OMR path (tests) needs no hardware.

## 5. Verify

```bash
curl -s localhost:3111/api/v1/school/teachers          # configured + list
curl -s localhost:3111/api/v1/school/roster            # learners only
curl -s localhost:3111/api/v1/school/banks | head -c 200
curl -s localhost:3111/api/v1/school/teacher/today     # one row per learner
```

Then open `/school` (kiosk wall) and `/school/teacher` (console) in a browser.

## 6. Learner departure / rename

There is no automatic cleanup. A departing learner: remove from `students:`
(stops agendas/serving) but LEAVE `users/{id}/` intact — attempts and frozen
report cards are the household's permanent record. A rename is a rekey across
BOTH `users/{id}/` and the household-keyed stores (assignments, sessions,
milestones, attestations, notes) — use `node cli/school.mjs learner`
(wave 8) rather than moving directories by hand.
