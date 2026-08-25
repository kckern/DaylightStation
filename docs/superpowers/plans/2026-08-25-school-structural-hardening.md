# School Structural Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six structural generators that produced fourteen production failures in one day of real use, by moving invariants out of comments and into chokepoints where code enforces them.

**Architecture:** Six independent hardening tasks plus one test-architecture task. Each installs an enforcement point rather than fixing an instance: a shared plan projection replaces six hand-assembled copies; write-time transition validation replaces twenty-six trusted callers; a claim-tier return type replaces a boolean that asserts more than it knows; a stated failure policy replaces per-file improvisation; a reachability split stops completion failing open; a boot-the-image CI check makes "tests pass" reproducible.

**Tech Stack:** Node ESM (`.mjs`), vitest (colocated `backend/src/**/*.test.mjs`), jest (`tests/unit/**`), YAML data in a Docker volume, ESC/POS + IPP printer adapters.

**Source:** structural audit, 2026-08-25. Evidence corpus in `docs/_wip/bugs/2026-08-25-school-morning-scan-and-print-incident.md` and `docs/_wip/bugs/2026-08-25-unprintable-session-already-issued-but-gone.md`.

## Global Constraints

- **Two test runners, split by location.** vitest for colocated `backend/src/**/*.test.mjs`; jest for `tests/unit/**`. Exact invocations:
  ```bash
  # vitest
  node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run <path> --config ./vitest.config.mjs
  # jest (NODE_OPTIONS is REQUIRED; without it jest reports fake parse failures)
  NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js <path>
  ```
  Never pass `--reporter=basic` to vitest — this version rejects it with an opaque `ERR_LOAD_URL`.
- **Baseline: 818 tests / 95 files passing** in `backend/src/3_applications/school/`, plus **3 pre-existing file-level load failures** in `rubiksCube/` (stale `node_modules` missing `cubejs`; absent curriculum `course.yml`). Those 3 are NOT yours. Report real observed numbers; never claim a pass you did not see.
- **Thermal printer tests MUST inject the transport** via `options.createTransport`. `escpos-network` is CJS; module-mocking it is silently bypassed and the adapter opens a **real socket to 10.0.0.50:9100 and prints physical paper**. Documented at the top of `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.flush.test.mjs`.
- **Never raw `console.*`** for diagnostics — use the injected logger. New diagnostics at `info`/`warn`/`error`, **never `debug`** (debug events are never shipped to the production log store, so a debug line is invisible in production).
- **Never `rm` under the data tree.** Move to `data/_deleteme/`. `docker exec` runs as root, so `rm` always appears to succeed — that is the trap.
- **Never `sed -i` on YAML inside the container** — it mangles multi-line structure.
- The container's `grep` is **BusyBox** and does not support `--include`. Use `find … -exec grep -l`.
- **Deploy gate** before any `sudo deploy-daylight`: no active fitness session and no playing video (see `CLAUDE.local.md`). School is in daily use.
- Work in the worktree `/opt/Code/DaylightStation/.claude/worktrees/household-data-reorg`. Do **not** `cd` to the main repo.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `backend/src/3_applications/school/PlanProjection.mjs` | **Create.** One injectable assembler for `{plan, sections}`. Mirrors the `CurriculumAccess` pattern. | 1 |
| `backend/src/3_applications/school/PlanProjection.test.mjs` | **Create.** | 1 |
| `BuildAgenda.mjs`, `ResolveSubjectNext.mjs`, `ResolveAccessCode.mjs`, `GetLearnerDayCompletion.mjs`, `CloseSessionOutcome.mjs` | Consume `PlanProjection` instead of hand-assembling | 2 |
| `backend/src/5_composition/modules/schoolLifecycle.mjs` | Wire `PlanProjection` once, inject into all five | 2 |
| `backend/src/2_domains/school/sessions/sessionEvents.mjs` | Export `statesAccepting(eventType)` derived from `TRANSITIONS` | 3 |
| `backend/src/1_adapters/persistence/yaml/YamlWorkSessionDatastore.mjs` | Validate transitions **at write** inside the existing write queue | 3 |
| `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs` | Claim tier instead of boolean; stop swallowing item errors | 4 |
| `backend/src/3_applications/school/ReceiptPrinting.mjs`, `IssueDocument.mjs` | Consume the claim tier | 4 |
| `backend/src/3_applications/school/CurriculumAccess.mjs` | Log dropped drafts | 5 |
| `docs/reference/school/failure-policy.md` | **Create.** The stated policy. | 5 |
| `backend/src/2_domains/school/agenda.mjs` | Split `blocked_no_offer` on reachability | 6 |
| `frontend/src/modules/Piano/PianoKiosk/useSchoolGameAccess.js` | Fail closed on `indeterminate` | 6 |
| `tests/integration/school/bootImage.test.mjs` | **Create.** Boot the composition root against an image-shaped tree. | 7 |

**Ordering:** Task 1 → 2 are sequential (2 consumes 1). Tasks 3–7 are independent of each other and of 1–2. Task 7 is the cheapest and highest-leverage; do it first if you want early protection.

---

## Task 1: `PlanProjection` — one assembler for "what's next"

**The generator (F3).** `planLearnerWork` and `planDailyAgenda` are pure and singular, but the *assembly of their inputs* — assignments + units + raw history + attested-pass overlay + curriculum-exception projection + coursePolicies — is hand-copied with variations across eight files that reference `planDailyAgenda`. The recipes differ: `BuildAgenda.mjs:206-209` wraps history in `withCurriculumExceptions(withAttestedPasses(...))`; `GetLearnerDayCompletion.mjs:46-56` wraps neither; `CloseSessionOutcome.mjs:594-605` wraps neither. Because the recipes differ, the surfaces genuinely disagree — that is the whole "receipt promises what the panel refuses" family.

SSOT holds for the *computation* and not for the *access*. `CurriculumAccess.mjs` is the in-tree pattern for exactly this (an expensive shared read, built once, injected everywhere); it was never applied one level up.

**Files:**
- Create: `backend/src/3_applications/school/PlanProjection.mjs`
- Create: `backend/src/3_applications/school/PlanProjection.test.mjs`

**Interfaces:**
- Consumes: `planLearnerWork` (`#domains/school/planner.mjs`), `planDailyAgenda` (`#domains/school/agenda.mjs`), and the stores/overlays `BuildAgenda` currently uses.
- Produces:
  ```js
  new PlanProjection({ assignments, curriculum, sessions, attestations,
                       curriculumExceptions, launchers, timezone, clock, logger })
  // → project({ learnerId, attested = true, exceptions = true, programStatuses = null })
  //   ⇒ Promise<{ plan, sections, projection: { assignment, units, sessions, works, nowIso } }>
  ```

- [ ] **Step 1: Read the reference pattern before writing anything**

Read `backend/src/3_applications/school/CurriculumAccess.mjs` in full — including its header, which explains why it exists. `PlanProjection` is the same shape one level up. Then read `BuildAgenda.mjs:200-250` — that is the **canonical** recipe this class must reproduce, because it is the one the printed agenda uses.

- [ ] **Step 2: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PlanProjection } from './PlanProjection.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };

describe('PlanProjection', () => {
  it('applies the attested-pass overlay by default', async () => {
    // A learner whose ONLY pass for unit-1 is an attestation (no graded session).
    // With the overlay, unit-2 is unlocked; without it, unit-2 stays locked.
    const projection = new PlanProjection({ /* doubles — see step 3 */ });
    const { plan } = await projection.project({ learnerId: 'lrn' });
    expect(plan.entries.find((e) => e.unitId === 'unit-2').status).not.toBe('locked');
  });

  it('can be asked for the RAW view, without overlays', async () => {
    const projection = new PlanProjection({ /* same doubles */ });
    const { plan } = await projection.project({ learnerId: 'lrn', attested: false });
    expect(plan.entries.find((e) => e.unitId === 'unit-2').status).toBe('locked');
  });

  it('returns sections and the raw projection alongside the plan', async () => {
    const projection = new PlanProjection({ /* same doubles */ });
    const result = await projection.project({ learnerId: 'lrn' });
    expect(Array.isArray(result.sections)).toBe(true);
    expect(result.projection).toMatchObject({ nowIso: expect.any(String) });
  });
});
```

Build the doubles from the shapes `BuildAgenda`'s own tests already use — do not invent new ones.

- [ ] **Step 3: Run to verify it fails**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/school/PlanProjection.test.mjs --config ./vitest.config.mjs
```
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement, copying BuildAgenda's recipe exactly**

The class does three things and nothing else: load the inputs, apply the overlays, call the two pure functions. **No policy of its own.** Put a short-TTL dedupe on concurrent identical `project()` calls, matching `CurriculumAccess`'s approach.

The header comment must state, in one paragraph: this is the only sanctioned way to obtain a plan or sections; hand-assembly is what caused the receipt/agenda/panel disagreements; the `attested`/`exceptions` flags exist because `GetLearnerDayCompletion` historically wrapped neither and changing that silently would move completion semantics.

- [ ] **Step 5: Run to verify it passes**

Same command. Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/school/PlanProjection.mjs \
        backend/src/3_applications/school/PlanProjection.test.mjs
git commit -m "feat(school): PlanProjection — one assembler for plan + sections

Eight files reference planDailyAgenda and hand-assemble its inputs with
different recipes, so the agenda, the receipt and the resolvers can
disagree. SSOT held for the computation but not the access.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Migrate the five call sites onto `PlanProjection`

**Files:**
- Modify: `usecases/BuildAgenda.mjs`, `usecases/ResolveSubjectNext.mjs`, `usecases/ResolveAccessCode.mjs`, `GetLearnerDayCompletion.mjs`, `usecases/CloseSessionOutcome.mjs`
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs`

**Interfaces:**
- Consumes: `PlanProjection.project(...)` from Task 1.
- Produces: no external signature changes. All five keep their current public shapes.

⚠️ **Migrate one file per commit, running the full layer between each.** These five feed a child's day; a silent semantic shift in any one of them changes what work is offered. Five small commits are reviewable; one big one is not.

⚠️ **`GetLearnerDayCompletion` is the dangerous one.** It currently wraps **neither** overlay. Migrating it with `attested: true` would change completion semantics — and completion gates the piano games unlock (`useSchoolGameAccess.js:6`). **Migrate it with `attested: false, exceptions: false` to preserve exact current behaviour**, and leave a comment saying the divergence is now visible and deliberate rather than accidental. Whether it *should* use the overlays is a separate decision with household consequences; do not make it here.

- [ ] **Step 1: Write the consistency test first — it is the point of the task**

Create `backend/src/3_applications/school/planConsistency.test.mjs`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';

describe('surfaces agree on what is next', () => {
  it('BuildAgenda, ResolveSubjectNext and ResolveAccessCode name the same unit', async () => {
    // One learner, one shared set of stores. Build all three use cases over the
    // SAME PlanProjection instance and assert they resolve the same unitId for
    // the same subject at the same instant.
    //
    // This is the regression net for the whole disagreement family: it is the
    // test that would have caught the receipt promising a lesson the panel
    // refused (2026-08-25 12:15).
    expect(agendaNext.unitId).toBe(subjectNext.unitId);
    expect(agendaNext.unitId).toBe(accessCodeNext.unitId);
  });
});
```

- [ ] **Step 2: Run to verify it fails or is inconclusive**

If it passes before migration, the fixture is too weak to distinguish the recipes — strengthen it with an attested pass, which is the input the recipes disagree about, until it fails.

- [ ] **Step 3–7: Migrate one file per commit**

For each of `BuildAgenda`, `ResolveSubjectNext`, `ResolveAccessCode`, `CloseSessionOutcome`, `GetLearnerDayCompletion`: replace the inline assembly with a `project()` call, delete the now-dead local loading, run the full layer, commit.

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/school/ --config ./vitest.config.mjs
```

After all five, wire one `PlanProjection` in `schoolLifecycle.mjs` and inject it into each. Verify the composition root still imports:

```bash
node -e "import('./backend/src/5_composition/modules/schoolLifecycle.mjs').then(()=>console.log('OK')).catch(e=>console.log('FAIL',e.message))"
```

- [ ] **Step 8: Resolve `plan.next`**

`planner.mjs:384` exports `next` and **nothing reads it** (grep-verified; only `enrollment.test.mjs:110,123` touch it). A dead API that looks canonical is what a six-assembler world produces. Either give it its one real consumer inside `PlanProjection`, or delete it. **Decide and state which in the commit message.**

---

## Task 3: Enforce session transitions at write time

**The generator (F2).** `sessionEvents.mjs` has a real `TRANSITIONS` table, but it is enforced **only in `reduceSession`, at read time**, as `errors[]` accumulation with the offending event skipped. `YamlWorkSessionDatastore.appendEvent` validates id safety and sequence — nothing else. **26 files call `appendEvent`**, each hand-copying its own legality projection (`IssueDocument`'s `ISSUABLE` set is a manual mirror of `TRANSITIONS`). When the table changes, the mirrors drift silently.

Read-total is correct *for reads*. It was silently extended to *writes*, where it is wrong. That is how a session came to hold an `issued` event whose artifact never existed.

**Files:**
- Modify: `backend/src/2_domains/school/sessions/sessionEvents.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlWorkSessionDatastore.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/YamlWorkSessionDatastore.transitions.test.mjs` (create)

**Interfaces:**
- Produces: `export function statesAccepting(eventType): Set<string>` from `sessionEvents.mjs`. `appendEvent` rejects illegal transitions by throwing a `DomainInvariantError` with `code: 'ILLEGAL_TRANSITION'`.

- [ ] **Step 1: Write the failing test**

```js
  it('refuses an event the transition table does not allow from the current state', async () => {
    const store = new YamlWorkSessionDatastore({ /* mkdtemp root, as sibling tests do */ });
    await store.appendEvent('ses_x', createEvent({ type: 'created', /* … */ }).event);
    // 'graded' is not reachable from 'created' without an intervening submission.
    await expect(store.appendEvent('ses_x', createEvent({ type: 'graded', /* … */ }).event))
      .rejects.toThrow(/ILLEGAL_TRANSITION|transition/i);
  });

  it('still accepts a legal transition', async () => {
    // created → issued must pass, unchanged.
  });
```

Confirm the illegal pair against the real `TRANSITIONS` table before writing — do not guess which pair is illegal.

- [ ] **Step 2: Run to verify it fails**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/1_adapters/persistence/yaml/ --config ./vitest.config.mjs
```
Expected: FAIL — the illegal append resolves instead of rejecting.

- [ ] **Step 3: Export `statesAccepting` from `sessionEvents.mjs`**

Derive it from `TRANSITIONS` — do not hand-write a second table. That duplication is the defect.

- [ ] **Step 4: Validate inside the existing write queue**

`appendEvent` already serialises through a write chain. Inside it, reduce `existing + candidate`; if the candidate lands in `errors[]`, throw instead of writing. All 26 writers converge on this one point; nothing else needs touching.

- [ ] **Step 5: Run the full layer — expect fallout, and read it**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run backend/src/ --config ./vitest.config.mjs
```

**Existing tests that append illegal sequences will now fail. That is the point — each failure is a real invariant violation someone wrote.** For each: if the sequence is genuinely legal, the table is wrong (fix the table, say so); if the test was constructing an impossible world, fix the test. Do not weaken the check to make tests pass.

- [ ] **Step 6: Delete the hand-copied legality sets**

Replace `IssueDocument`'s `ISSUABLE` (`:52`) with `statesAccepting('issued')`. Grep for other mirrors and replace them too.

- [ ] **Step 7: Commit**

```bash
git commit -m "fix(school): enforce session transitions at write time, not just read

TRANSITIONS was authoritative only in reduceSession. 26 files appended
directly, each mirroring legality by hand. A session could record an
'issued' event whose artifact never existed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The printer reports what it knows, not what it hopes

**The generator (F1).** `ThermalPrinterAdapter.print()` returns a bare boolean, resolved after "our bytes flushed + a drain timer elapsed." The adapter **has** `getStatus()` (`:274`, DLE EOT paper/cover/cutter queries) and the print path **never calls it** — verified: `getStatus` appears exactly once in the file, at its own definition. `IssueDocument` then appends `issued` — a permanent, cooldown-arming fact — on that claim.

Also still live: `#processItem` catches per-item errors, logs, and returns the accumulated buffer anyway (`:851-855`). A receipt whose image fails to load still emits header + padding + **auto-cut** — blank paper with a cut, logged as `job.complete`.

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs`
- Modify: `backend/src/3_applications/school/ReceiptPrinting.mjs`
- Test: `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.claimtier.test.mjs` (create, **jest**)

**Interfaces:**
- Produces: `print()` returns `{ dispatched: boolean, verified: boolean, printerState: object|null }`. **`ReceiptPrinting.print()` keeps returning `{ printed, reason }`** so its callers are unchanged; it maps `verified === true` → `printed: true`.

⚠️ **`getStatus()` currently opens its own socket.** This printer refuses concurrent connections (an ~11.5 s lockout was observed 2026-08-25). The post-check must run **after** `device.close()`, never inside the `device.open` callback. Consult `docs/_wip/bugs/2026-08-25-school-morning-scan-and-print-incident.md` §RC-5 before wiring it.

⚠️ **Verified hardware facts** (probed 2026-08-25, read-only): this printer answers all four `DLE EOT` queries but supports **neither** `GS r` nor `ESC v` — so there is **no end-of-job barrier**. `verified` can therefore only mean "the printer reports it *can* print and reports no error after the job," never "this raster rendered." Say so in the code comment; do not oversell the tier.

⚠️ **`DLE EOT 1` bit 2 is the cash-drawer pin, not cover-open.** Cover state comes from `DLE EOT 2` only. `#parseStatusResponses` case 0 misdecodes this; on healthy hardware the live reply `0x16` has bit 2 set, so gating on it would refuse **every** job. Fix the decode before gating on it.

- [ ] **Step 1: Write the failing tests (jest, injected transport)**

Cover: a healthy print returns `{dispatched: true, verified: true}`; a printer reporting paper-out returns `verified: false`; an item that throws during processing does **not** emit an auto-cut.

- [ ] **Step 2: Run to verify they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js \
  tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.claimtier.test.mjs
```

- [ ] **Step 3: Fix the `coverOpen` misdecode, then implement the tier**

Case 0 must stop reading bit 2 as cover; case 1 (`DLE EOT 2`) owns cover state.

- [ ] **Step 4: Stop swallowing item errors**

`#processItem` must propagate — a job that could not build its content is a failed job, not a cut blank.

- [ ] **Step 5: Map the tier in `ReceiptPrinting`**

Keep its `{ printed, reason }` contract; add `reason: 'unverified'` when dispatched but not verified.

- [ ] **Step 6: Run the whole thermal suite**

```bash
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js \
  tests/unit/adapters/hardware/thermal-printer/
```
All pre-existing suites (flush, raster, abort, status) must still pass.

- [ ] **Step 7: Commit**

---

## Task 5: One stated failure policy

**The generator (F4).** Three files, three policies for the same class of problem. `CurriculumAccess.mjs:107-108` drops unpublishable units with **no log and no counter** while logging invalid ones one line below (`:110`) — so the only downstream symptom is `planner.mjs:98`'s "assigned but no published units belong to it", which names the wrong cause and sent a full investigation into loaders, manifests and schemas. `courseCatalog.mjs:8` did module-scope I/O and threw, killing the entire subsystem. `GeneratedBankSource.mjs:33-45` warns and continues.

**Files:**
- Modify: `backend/src/3_applications/school/CurriculumAccess.mjs`
- Create: `docs/reference/school/failure-policy.md`
- Test: extend `CurriculumAccess`'s existing tests

- [ ] **Step 1: Write the failing test**

A catalog containing one `approved` and two `draft` units logs `school.curriculum.drafts-dropped` with `{ count: 2 }` and the dropped ids, at `warn`.

- [ ] **Step 2: Run to verify it fails, then implement**

Log the drop beside the existing invalid-units warn. Same shape, same level — the asymmetry is the bug.

- [ ] **Step 3: Write the policy document**

`docs/reference/school/failure-policy.md`, present-tense, no class names (house style for reference docs):

- **Content problems** (a unit is draft, a bank is missing, a recipe is absent) fail **soft, per item, with a visible receipt** — the item is skipped and the skip is logged at `warn` with a count and identifiers. Never silent: a silent drop relocates the symptom to somewhere that names the wrong cause.
- **Wiring problems** (a required collaborator is absent, a config is malformed) fail **loud at startup for that subsystem only** — never take the process down.
- **No filesystem or network I/O at module scope**, anywhere in `backend/src`. A static import cannot be wrapped in the composition root's try/catch, so module-scope I/O converts a missing file into a dead subsystem. Load lazily, or inject.

- [ ] **Step 4: Commit**

---

## Task 6: Completion must fail closed

**The generator (F6).** `agenda.mjs:222-232` maps "no actionable non-elective work + something locked" to `excused: blocked_no_offer`; only `program_unavailable` earns `faulted`. `completion.mjs:30-36` then treats a day with no obligated sections as satisfied. So a curriculum broken *in a way that produces a lock* reads as excused, the day completes, and the completion unlocks games.

That happened: a learner read `state: "complete"` because his only subject was excused **for being broken**, and his games unlocked on it.

`blocked_no_offer` is genuinely two different situations wearing one name: *blocked by a sibling you can do next* (legitimate) versus *blocked by something nothing can reach* (a fault). The classifier cannot currently tell them apart because the lock carries no provenance — but reachability is computable from data already in hand.

**Files:**
- Modify: `backend/src/2_domains/school/agenda.mjs`
- Modify: `frontend/src/modules/Piano/PianoKiosk/useSchoolGameAccess.js`
- Test: `backend/src/2_domains/school/agenda.test.mjs` (extend), plus the kiosk hook's tests

- [ ] **Step 1: Write the failing tests**

- A section locked by a blocker that is itself `available`/`in_progress` ⇒ `excused: blocked_no_offer` (unchanged — the child has something to do).
- A section locked by a blocker that is **unreachable** (itself locked, upcoming, or absent from the plan) ⇒ `faulted`, reason `blocked_unreachable`.
- `resolveDayCompletion` over a faulted section ⇒ `state: 'indeterminate'`.
- `completionAllowsGames('indeterminate') === false`.

- [ ] **Step 2: Run to verify they fail, then implement the split**

Follow blocker chains to a fixpoint — `planner.mjs:218-223` returns only the *nearest* unpassed predecessor, which may itself be locked.

- [ ] **Step 3: Make the consumer fail closed**

`useSchoolGameAccess.js:6` — `UNLOCKED_STATES` must not include `indeterminate`. Verify it does not today and add the test that pins it. **A reward gate that fails open on breakage eventually pays out on breakage.**

- [ ] **Step 4: Run both suites, commit**

> **Household note:** this makes a broken curriculum *lock* games where it previously unlocked them. That is correct, and it is a visible behaviour change for the children. Do not deploy it silently.

---

## Task 7: Make "tests pass" a reproducible claim

**The generator (F7), and the cheapest fix in this plan.** `schoolLifecycleWiring.test.mjs` imports the composition root, which imported `courseCatalog`, which did `readFileSync('course.yml')` — a file matching both `.gitignore` and `.dockerignore`, existing only where someone authored it locally. Nothing anywhere boots the subsystem against a production-shaped filesystem, so a whole-subsystem-dead-in-prod defect was structurally undetectable while the suite was green.

**Files:**
- Create: `tests/integration/school/bootImage.test.mjs`

- [ ] **Step 1: Write the test**

Copy the tree with `.gitignore` and `.dockerignore` rules applied (or build the image), then boot `createSchoolLifecycle` and assert `wired: true`. Assert it does not throw and that the school routes mount.

- [ ] **Step 2: Prove it would have caught the real defect**

Temporarily restore the module-scope `readFileSync` throw in `courseCatalog.mjs`, run the test, confirm it **fails**, then revert. Paste both outputs. A guard that was never seen failing is not a guard.

- [ ] **Step 3: Wire it into the test harness and commit**

---

## Deferred — not in this plan

| Item | Why |
|---|---|
| **F5 — enrollment snapshot invalidation** | Needs a record migration (v2→v3) and a planner change; medium-sized and touches a learner's frozen plan mid-course. Also entangled with `enrollment.mjs:38`'s `closesOn >= today` filter, which silently drops closed weeks on re-materialization. Its own plan. |
| **Cross-surface property test over generated states** | Task 2's consistency test covers the three resolvers concretely. A generative version is worth more but needs a state generator that does not exist yet. |
| **`print_failed` token leak** (`ResolvePersonalCard.mjs:179-188`) | Pre-existing; the other half of L-5. Small, tracked separately. |
| **Laser adapter claim tier** | Task 4 covers thermal. `LaserPrinterAdapter.printPdf` has the same "IPP acceptance = success" defect and should follow once the thermal tier proves out. |

---

## Post-merge verification

- [ ] Deploy gate, build, deploy.
- [ ] Live: one card tap ⇒ exactly one `nfc.tap.school_card`, one receipt, one session.
- [ ] Live: a graded worksheet's "One more?" panel code resolves (not `kind: 'served'`).
- [ ] Confirm zero `school.curriculum.drafts-dropped` surprises — if the count is large, that is real content needing review, not a bug.
- [ ] Confirm games remain locked for a learner whose curriculum is faulted.
