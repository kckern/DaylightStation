# School Physical Learning Console — Architecture Design

**Status:** Architecture-level design. Validated section-by-section 2026-07-27.
**Scope:** The whole physical console per the roadmap — curriculum catalog, document
system, work sessions, action tokens, grading/review, media handoff, economy seam.
**Roadmap:** [`docs/roadmap/2026-07-21-school-module-roadmap.md`](../../roadmap/2026-07-21-school-module-roadmap.md)
**Requirements:** [`2026-07-21-portal-homeschool-requirements.md`](./2026-07-21-portal-homeschool-requirements.md)
**Current implementation:** [`docs/reference/school/README.md`](../../reference/school/README.md)

---

## 1. Decisions made in this discovery

| # | Decision | Ruling |
|---|---|---|
| A1 | Spec scope | One architecture spec for the whole physical console; per-slice specs reference it |
| A2 | Anchor unit | A **math worksheet unit** drives the first end-to-end flow (agenda → worksheet → assessment → receipt) — it exercises the document system's hardest cases first |
| A3 | Rendering stack | **Pure-JS in-process**: pdfkit + MathJax→SVG + svg-to-pdfkit. No typesetting binary in the container. Spike **passed 2026-07-27** — print-grade vector math confirmed, subject to three mandatory SVG-normalization rules (see spike results doc) |
| A4 | Curriculum supply chain | **Contracts only.** This spec defines the published runtime catalog and the promotion boundary; the agent ingestion skill suite is a later sibling spec. Runtime never depends on how drafts were made |
| A5 | Coins | **Design the seam, ship it off.** Full reward path specified (outcome IDs, unit policy, `EconomyService.earn()`); default disabled; not in first-slice acceptance |
| A6 | First-slice grading | **Parent review first.** OMR arrives as roadmap delivery item 5 feeding the same submission pipeline; it never blocks the first working loop |
| A7 | Scan ingress | **Self-identifying token prefix** (`sch:`), recognized in the relay's `onScan` router ahead of route dispatch. Any scanner in the house works |
| A8 | Parent surface | Parent review and curriculum planning live in **`frontend/src/modules/Admin/`** (new `Admin/School/` section) — resolves requirements OPEN-7 |

Constraint findings that shaped these (from code discovery, 2026-07-27):

- The barcode relay's route set is closed (`content` \| `nutribot`), hardcoded in the
  composition-root `onScan` closure — hence the prefix branch rather than a route.
- `EconomyService.earn()`'s `ref` replay guard scans **one UTC day's ledger shard**;
  the same ref pays again tomorrow. School must hold its own durable outcome→reward
  record; the economy guard becomes defense-in-depth.
- The School material-progress route currently **discards** the progress store's
  `newlyCompleted` return value — the "verified end" edge exists but is unconsumed.
- OMR: serial protocol fully solved (9600 7E1, volatile `I00` mode), but relay
  backend, persistence, form registry, scoring, and hardware assembly do not exist,
  and **card geometry was unproven** (resolved 2026-07-22: Lincolnshire `3705`
  ordered, 500 cards — see `docs/reference/omr/README.md`) — form layout was a blocker,
  which is why parent-review-first is the sequence.
- `WorksheetRenderer` is 112 lines of pdfkit with three item branches — a rebuild,
  not an extension. `svg-to-pdfkit` is already a dependency (catalog router).
- The language program's append-only event log + derived queue is the in-repo
  precedent for the work-session storage model.
- `categories.mjs` already declares `credit: {coins, curriculum}`; nothing reads it.

---

## 2. System shape

Four new components plus wiring into existing seams. Existing seams are consumed,
never modified: `SchoolService` grading, `PrintService`/laser transport, the thermal
registry, `EconomyService.earn()`, `GetSchoolReport`, dispatch services, the
household roster.

```text
personal card scan ──┐
agenda action scan ──┤                                  ┌─→ laser PDF (worksheet/form)
                     ▼                                  │
        [4] Action token resolver ──→ [3] Work sessions ┼─→ thermal receipt (agenda/result)
                     ▲                        │         │
                     │                        │         └─→ media dispatch (existing)
        [2] Document system ←── [1] Curriculum catalog
             (mints tokens at issue time)     │
                                              ▼
                          existing: grading, attempts, reports, economy
```

1. **Curriculum catalog** — published, reviewed units at `data/content/school/curriculum/`,
   validated by a pure domain module. The promotion boundary is "valid YAML in this
   directory"; runtime is ignorant of authoring.
2. **Document system** — typed-block document model validated in the domain,
   rendered by two targets (Letter PDF, thermal receipt) in `1_rendering/school/`.
3. **Work sessions** — durable lifecycle records: append-only events per session,
   derived state, stable outcome IDs.
4. **Action token resolver** — server-owned opaque tokens minted at document issue
   time, resolved from any scanner via the `sch:` prefix.

### Layer placement (checked against `docs/reference/core/layers-of-abstraction/`)

| Piece | Layer | Notes |
|---|---|---|
| Unit/document/manifest validation, session event reducer, token semantics, planner policy, layout *constraints as data* | `2_domains/school/` | Pure; school stays Level 2, imports only `core`/`content` — never `barcode`/`trigger` |
| WorkSession aggregate | `2_domains/school/entities/` | References attempts/units/artifacts **by ID only** |
| Use cases: `IssueDocument`, `ResolveScanAction`, `SubmitPaperWork`, `RecordMediaCompletion`, `CloseSessionOutcome`, `ValidateCatalog` | `3_applications/school/usecases/` | One business operation each |
| Ports: `ICurriculumCatalog`, `IWorkSessionRepository`, `ITokenRegistry`, `IDocumentArtifactStore` | `3_applications/school/ports/` | D3: ports live in applications only; datastores `extends` them (D7) |
| YAML datastores for sessions/tokens/artifacts/catalog | `1_adapters/persistence/yaml/` | No FileIO in the app layer (D5) |
| Document layout engine + PDF/receipt renderers + themes | `1_rendering/school/` | Measurement, pagination, typography = rendering. Receives pre-computed data; returns artifacts; no persistence, no service imports |
| Relay `onScan` prefix branch, reporter registration, service wiring | composition root (`app.mjs` / `5_composition`) | D1: nothing imports concrete adapters except bootstrap |
| Routers: session/submission/review/planner endpoints | `4_api/v1/routers/school.mjs` (extended) | Thin shell, error→status map |
| Parent surface | `frontend/src/modules/Admin/School/` | Review queue, planning, sign-off, reassignment, reports |

**Token minting is a use-case concern, not a renderer concern.** `IssueDocument`
mints tokens through `ITokenRegistry`, passes the token *values* to the renderer,
persists the returned `{pdf, formMap, pageCount}` through ports. Publish-time
validation may invoke the layout engine's measure pass (D2 allows applications to
import rendering) to reject oversized atomic fragments before a unit is published.

---

## 3. Curriculum contracts

### 3.1 Unit

A unit YAML at `data/content/school/curriculum/{unitId}.yml` carries:

- **Identity:** `unitId` (stable, never reused), `title`.
- **Pedagogy:** objectives, `subject` (the nine-subject wall), estimated effort.
- **Placement:** `courseId` + `sequence` when sequential; standalone otherwise.
  Gate policy follows the existing rule: only `course`-category sequences gate.
- **Applicability:** learner list or grade range (reuses `grades.mjs` ladder).
- **Policy:** passing rule, retry/remediation policy, optional `reward:` block
  (amount, cap, `requiresSignoff`). Reward policy lives with the unit, per roadmap §7.2.
- **Composition references:** `bank:` (existing question-bank ID — format untouched),
  `document:` (document artifact ID), `media:` (manifest ID), `review:` (parent-review
  rubric for unscorable work).
- **Provenance:** source, licence context, review state. Runtime ignores it;
  validation requires it.

Validation is one pure entry point — `validateUnit(raw, {banks, documents, manifests})` —
resolving every cross-reference at publish time. Runtime never discovers a dangling
reference.

### 3.2 Media manifest

External locators are not identities. A manifest holds the *current* locator
(`plex:<ratingKey>`) plus durable metadata: title, series, season/episode, duration,
aliases, provenance. Runtime resolves manifest → locator through one function; a
failed resolve is a loud, recoverable error. A repair tool can rebind locators
without touching units.

### 3.3 Document

An ordered list of typed blocks from a **closed set** (same posture as item types
and metric kinds — a new block type is a code change):

`rich_text`, `math`, `plot`, `geometry`, `asset`, `question`/`answer_space`,
`omr_response`, `media_action`/`scan_action`.

- Documents carry a deterministic `seed`: regeneration is byte-identical.
- A `variant` axis produces an equivalent-retry form — different seed, same unit.
- `omr_response` blocks declare their answer map (item ID → mark positions)
  abstractly; the renderer owns physical geometry and emits a **form map artifact**
  (exact mark coordinates) alongside the PDF — the contract the future OMR resolver
  grades against.
- LaTeX is the authoring syntax for `math`; plots and geometry are declarative
  specs, not embedded markup; maps/licensed art are curated `asset` blocks.

---

## 4. Layout engine and rendering targets

The renderer never streams blocks to the page. **Two passes:**

1. **Measure** — every block reports its extent at the current width (math SVGs
   and plots have intrinsic sizes; text measures via font metrics before drawing).
2. **Place** — applying layout rules:

- **Keep-together atomics.** A question + its answer space/choices/OMR row never
  splits across a page break. An atomic taller than a page fails *publish-time*
  validation, not print time.
- **Widow/orphan control.** Paragraphs carry min-lines-before/after-break
  constraints; a heading never sits alone at a page bottom; a paragraph's last
  line never opens a page alone.
- **Vertical rhythm, not accumulation.** Blocks place on a baseline grid with
  named spacing classes; inter-block space is a decision, not a residue. Trailing
  page space distributes into `answer_space` blocks within their declared
  min/max — no cramped work areas above a half-empty final page.
- **Typography via theme.** A document theme per target (font family/sizes/
  leading/measure) in one place; blocks request semantic styles, never raw sizes.
  Receipt layout is single-column with cut points and its own keep-togethers.
- **Bounded adaptive fitting.** Font-size shrink is allowed one step within a
  declared range; beyond that the layout paginates rather than degrades.

Letter PDF and receipt render from the same document data; neither is a second
authoring path. Answer keys render separately from learner copies. Generated forms
carry stable artifact IDs.

**Golden tests are page-image assertions:** a stress corpus (long expressions,
tall matrices, break-forcing sequences, widow bait, QR/asset placement) is
pixel-diffed per target; the OMR form map is additionally asserted **numerically**
— mark coordinates exact, not "looks right."

---

## 5. Work sessions

### 5.1 Storage

`data/apps/school/sessions/{YYYY-MM-DD}/{sessionId}/events.yml` — append-only
events; state is derived on read (the language-ladder pattern; a mutable record is
rejected). A small per-day index supports "what's open for this learner" without
scanning history. Corrections are events; nothing is edited.

### 5.2 Lifecycle

`created` → `issued` → `in_progress` → `submitted` → `graded` → terminal:
`passed` \| `needs_remediation` \| `abandoned` (explicit and parent-visible, never
a silent timeout).

- Reprints append events under the **same artifact ID**, preserving lineage.
- Remediation opens a *linked* session referencing the original — retries are
  attributable to the lineage while every attempt stays individual evidence.
- Every non-terminal state has at least one printed action that moves it.

### 5.3 Identity discipline

The session ID is minted server-side; every downstream artifact — document seed,
tokens, form map, attempts, outcome — carries it. Attempts still append to the
existing per-user attempt log **unchanged**; the session references attempt IDs,
never copies. Reassignment appends a `reassigned` event and rides the existing
`attributedTo` mechanics for the evidence itself.

### 5.4 Outcome and reward idempotency

A terminal state emits exactly one **outcome record** with deterministic ID
`out:{sessionId}`. Reward path (when unit policy enables it and the household
economy is on):

1. Check the session's own durable record for `rewardTxn`.
2. If absent, `EconomyService.earn(ref = outcomeId)`.
3. Append the returned transaction ID to the session.

School's own check closes the cross-day double-pay gap (the economy's replay guard
is per-UTC-day); the economy guard remains as defense-in-depth. Coins remain a
policy result of a stable outcome — never of a scan or a printer request.

---

## 6. Action tokens and scan ingress

### 6.1 Token model

A token is a random opaque ID printed as `sch:<id>` (QR or Code128), minted at
issue time, stored in a registry (`data/apps/school/tokens/`) mapping to
`{action, sessionId|learnerId, issuedAt, expiry, semantics}`. Semantics are
per-action-class, declared in code:

| Class | Semantics |
|---|---|
| Personal card (`identify`) | No expiry, reusable forever; resolves learner → prints/reprints current agenda |
| Selection / media / remediation | Renewable: valid until the session leaves the state that makes them meaningful. Re-scan while valid re-executes idempotently; re-scan after state advance prints a friendly "already done" line — never an error dead-end |
| Recovery | Valid while the session is open; only ever reprints |

Tokens never encode meaning client-side (no learner IDs, media IDs, or policy in
the barcode). Revocation and expiry are registry operations. Expiry defaults are
conservative: agenda actions expire when the next agenda is issued (roadmap Q3
becomes per-class config).

### 6.2 Ingress

One new branch at the **top** of the relay's `onScan` router in the composition
root: `code.startsWith('sch:')` → `ResolveScanAction`. Existing routes
(`content`, `nutribot`) untouched; the trigger pipeline untouched; any scanner in
the house works. The resolver's response is always physical — something prints
(agenda, form, result, or an explanation slip for expired/unknown tokens on the
nearest thermal printer). **A scan never succeeds silently.**

### 6.3 Planner

A pure policy module answering: given this learner, catalog, session history, and
time — what is expected, available, and next. Output renders as the agenda
document. First-slice policy is minimal: assigned units in sequence order,
electives after, one open session per unit per learner. The planner creates the
work session before any work is issued.

---

## 7. Grading, parent review, and the Admin surface

### 7.1 One grading engine

Paper answers become the same `answer` calls the on-screen quiz makes: the
submission flow maps form entries (item ID → given value) through `SchoolService`'s
existing grade path, producing normal attempt records with `mode: 'quiz'` plus one
additive field, `transport: 'paper'`. Score, pass evaluation, and gate release
reuse `quizSessionPassed` and `materialPolicy`. Paper earns nothing the screen
couldn't.

### 7.2 Admin/School section

`frontend/src/modules/Admin/School/` hosts:

- **Review queue** — unscored submissions; later, ambiguous/rejected OMR scans.
- **Curriculum planning** — assign units/courses, priority, elective status.
  Planning writes planner config, never the published catalog.
- **Work-session history** with remediation lineage.
- **Sign-off, reassignment, overrides** — each recorded as events (`reviewedBy`,
  decision, notes) appended to the session; adult check reuses the print-approval
  pattern (`birthyear`-derived, fails closed).
- **Printable reports** (portfolio/transcript later).

First-slice paper grading: the parent enters the child's answers (engine grades)
or directly marks free-response items (`gradedBy` recorded). When OMR lands, clean
scans grade automatically and ambiguous ones fall into this same queue — OMR is an
additional feeder, not a new pipeline.

### 7.3 Reporting

The planner/work-session layer registers as one more `IProgramReporter`; the
parent board gains session and review-state facts through the existing
`GetSchoolReport` contract. No bespoke dashboard.

---

## 8. Media handoff and verified completion

- **Target policy** (roadmap Q2): per-target config `child_selectable: true|false`.
  The agenda prints one action per allowed target ("Watch on TV" / "Listen on
  headset"); non-selectable targets simply don't print on a child's agenda.
- **Dispatch** reuses `ContentDispatcher`/`WakeAndLoadService` for screens and the
  playback-hub adapter for headsets. The session appends `media_dispatched` with
  the dispatch correlator.
- **Verified end.** The School progress route starts consuming the progress
  store's `newlyCompleted` return (today discarded) plus `materialPolicy`
  thresholds. Screens report through `POST /play/log`; the session service
  correlates completion for its dispatched content + learner → `media_completed`.
  Playback-hub devices report no playhead: fallback is duration-based verification
  via the hub status endpoint, recorded as `media_completed (verified: duration)`
  so reports can distinguish confidence.
- Only `media_completed` releases the linked quiz/form issue action. Starting
  playback is never completion.
- **Interruption:** no completion after duration + grace → `media_stalled`; the
  next agenda or recovery scan offers replay/resume. The session never wedges.
- The in-app Portal player flow is untouched; when a session exists it merely
  records those events.

---

## 9. Failure handling and idempotency

Every physical operation returns through one of three paths:

1. **Success** — with printed evidence.
2. **Retryable failure** — the session appends a `failed` event; the *same token
   stays valid* because state didn't advance, so the next scan retries.
3. **Needs-adult** — falls into the Admin queue.

Printer offline is the canonical case: the job queues, the session records
`print_pending`, printing resumes when the printer returns, and a Portal-visible
banner surfaces it (paper can't announce its own absence).

### Idempotency acceptance matrix

| Replay | Invariant |
|---|---|
| Re-scan personal card | Reprints agenda; never a new session |
| Re-scan select-unit token | Same session resumed; no duplicate |
| Reprint worksheet | Same artifact ID + lineage event; identical form map |
| Duplicate submission entry | Second grade attempt rejected, points at existing result |
| Re-scan media action mid-play | No second dispatch |
| Outcome reached twice (race) | One outcome record, one earn ref |
| Earn retried across days | Outcome record blocks re-pay |

---

## 10. Testing

1. **Pure-domain suites** (isolated, like the existing 20): planner policy, token
   semantics, session reducer, validation, layout constraint math.
2. **Golden rendered-page tests**: pixel diffs over the stress corpus per target;
   numeric form-map assertions.
3. **Contract tests** for seams with fakes: relay branch, earn call, dispatch
   correlation, progress consumption.
4. **One Playwright flow** for the Admin review queue.
5. **Physical acceptance** — real scanner, both printers, card stock — is a
   scripted manual checklist per delivery item, never pretend-automated.

Test discipline per CLAUDE.md: no vacuous passes; a precondition failure fails
the test.

---

## 11. Delivery mapping

Aligned to roadmap §9; this spec is the reference for each slice's own spec/plan.

| Roadmap item | This spec's components |
|---|---|
| 1. Curriculum contract + document spike | §3 contracts; §4 engine; **spike: MathJax→SVG→pdfkit print quality — PASSED 2026-07-27**, see [`docs/_wip/plans/2026-07-27-school-math-rendering-spike-results.md`](../../_wip/plans/2026-07-27-school-math-rendering-spike-results.md) (three mandatory SVG-normalization rules) |
| 2. Document system + print QA | §4 targets, golden tests, artifact IDs, print failure flow (§9) |
| 3. Work sessions + barcode actions | §5, §6 |
| 4. First end-to-end paper unit | Anchor math unit; parent-review grading (§7); acceptance = the §9 matrix rows that apply |
| 5. OMR relay + form pipeline | Form map contract (§3.3) + submission feeder (§7.2); relay/persistence per the OMR bring-up plan |
| 6. Remote media completion bridge | §8 |
| 7. Parent review + economy policy | §7 full surface; §5.4 reward path switched on by household policy |
| 8. Curriculum ingestion skill suite | Out of scope here (A4); consumes §3 contracts |

---

## 12. Open questions — resolved vs. remaining

| Roadmap §11 | Status |
|---|---|
| Q1 OMR optical/dropout constraints | **Remaining.** Blocked on hardware assembly + card sourcing; form geometry per the OMR card spec. Gates item 5 only |
| Q2 Media target autonomy | **Mechanism decided** (§8 per-target `child_selectable`); actual per-target values are household config |
| Q3 Token validity | **Mechanism decided** (§6.1 per-action-class semantics); durations are config with conservative defaults |
| Q4 Source licences | Deferred with the ingestion spec (A4); `provenance` field is required from day one |
| Q5 Minimum review workflow for promotion | Deferred with the ingestion spec; the promotion boundary (§3) is fixed now |
| Q6 Which outcomes earn coins | **Seam decided** (A5, §5.4); which outcomes/amounts is household policy, default off |
| Q7 Lost paper / equivalent retry | **Decided:** recovery tokens (§6.1) + `variant` seeds (§3.3) + linked remediation sessions (§5.2) |
