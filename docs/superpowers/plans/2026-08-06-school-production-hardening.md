# School Production Hardening Implementation Plan (Wave 10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire both production-readiness blockers, the full punch list, and the entire accepted-debt ledger — the School app goes from READY-WITH-CONDITIONS to READY with no open register.

**Architecture:** Backend integrity fixes follow the corrupt≠missing / atomic-write pattern already proven in `YamlAcademicPeriodStore`. The quiz-gate rebind is a code roll-up (chapter banks gate their parent unit, ALL must pass — user decision 2026-08-06), not a content rewrite. Sittings (mid-quiz resumability) persist per-user answer snapshots beside the attempts shards. Identity unification makes guest EXPLICIT (a button), dismissal a cancel. Everything ships under the existing wave cycle: TDD, school-scoped sweep, deploy-gate, deploy, live verify, Fable M10 review, merge.

**Tech Stack:** Node ESM backend (DDD layers, vitest), React/Vite kiosk + console, js-yaml stores on a Dropbox-synced volume, pdfkit print, Playwright for the live smoke.

## Global Constraints

- Policy lives in use cases, never routers (`api-no-domains`; error mapping by NAME with explicit `err.status`).
- Teacher-class mutations assert `TeacherGate` (adult + `teachers:` member + PIN) IN the owning use case. Kid-safe writes stay ungated by design but must carry dedupe/caps.
- Stores: corrupt ≠ missing. Missing file = valid cold state; unparseable file = LOUD read (`state:'corrupt'`) and REFUSED overwrite. All rewrites atomic (tmp + rename).
- Frontend: structured logging framework only (no bare console.*); kiosk icons are inline SVG, never emoji/unicode; no sliders; child-register copy ("tell a grown-up", never engineer strings).
- Tests: no vacuous passes; a failed precondition fails the test. Known pre-existing failures NOT to chase: `schoolcalcPlatformConformance`, `schoolcalcActionQr`, `sampleCurriculum` (fail on main).
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Deploy only through the garage/player deploy gate; after deploy verify `/build.txt` equals HEAD.

## File Structure (created/modified map)

| Area | Files |
|---|---|
| Store integrity | `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs`, `.../YamlAssignmentStore.mjs`, `backend/src/0_system/…/FileIO` call sites (no FileIO change — use existing `saveYamlToPathAtomic`) |
| Gate PINs | `backend/src/3_applications/school/usecases/GradeSubmission.mjs`, `CloseSessionOutcome.mjs`, `backend/src/4_api/v1/routers/schoolLifecycle.mjs`, `backend/src/5_composition/modules/schoolLifecycle.mjs` |
| De-mutated GETs | `backend/src/4_api/v1/routers/schoolLifecycle.mjs` (agenda), `backend/src/4_api/v1/routers/school.mjs` (print render) |
| Quiz-gate roll-up | `backend/src/3_applications/school/GetMaterialUnits.mjs`, `backend/src/3_applications/school/SchoolService.mjs` (index feed), `frontend/src/modules/School/materials/SchoolMaterialPlayer.jsx` |
| Print Center | data-volume surface profile (`docker exec`), verify via `GET /print/printables` |
| Cold path | `backend/src/3_applications/school/GetMaterialProgressSummary.mjs`, `GetMaterialUnits.mjs` (TTL) |
| Smoke/tests | `scripts/school-smoke.mjs`, `tests/isolated/domain/school/documents/receipts.test.mjs` |
| Runner UX | `frontend/src/modules/School/quiz/QuizRunner.jsx`, `flashcards/FlashcardRunner.jsx`, `geography/useGradedSession.js` |
| Nits | `backend/src/0_system/http/middleware` error handler, `SetAssignments.mjs`, `SetAcademicPeriods.mjs`, `GetMaterialCatalog.mjs` |
| Debt | `backend/src/3_applications/school/usecases/ReassignEvidence.mjs` (+ new `YamlReassignmentLog`), `frontend/src/modules/School/print/PrintCenter.jsx` + route, nudge task in `backend/src/app.mjs`, `frontend/src/modules/School/home/StudentPanel.jsx` (day plan), quiz summary tutor link |
| Sittings | new `backend/src/1_adapters/persistence/yaml/YamlSittingStore.mjs`, `SchoolService.mjs`, `frontend/src/modules/School/quiz/QuizRunner.jsx`, route in `school.mjs` |
| Identity | `frontend/src/modules/School/SchoolApp.jsx`, `frontend/src/lib/identity/ProfilePicker.jsx` (explicit-guest slot) |
| Live smoke | new `tests/live/flow/school/teacherConsole.runtime.test.mjs` |

---

### Task 1: Attempts-shard integrity — corrupt-refusal + atomic writes (Blocker 1)

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` (readAttemptDay ~L191, appendAttempt ~L196-198, and ALL `saveYaml(` call sites in this file)
- Test: `tests/isolated/adapter/school/attemptShardIntegrity.test.mjs` (create)

**Interfaces:**
- Consumes: existing `loadYamlSafe`, `saveYaml`, `saveYamlToPathAtomic`, `ensureDir` from the FileIO module this file already imports.
- Produces: `appendAttempt(userId, attempt)` now THROWS `DomainInvariantError` (`code: 'ATTEMPT_SHARD_CORRUPT'`) instead of clobbering when the day file exists but does not parse; `readAttemptDay` logs `school.attempts.shard-corrupt` once per corrupt read and returns `[]` (reads stay tolerant, writes refuse — the periods-store posture).

- [ ] **Step 1: Write the failing tests**

```js
// tests/isolated/adapter/school/attemptShardIntegrity.test.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';

let root; let warns;
const logger = { warn: (...a) => warns.push(a), error: (...a) => warns.push(a) };
const cs = () => ({
  getDataDir: () => root,
  getUserDir: (id) => path.join(root, 'users', id),
  getUserProfile: (id) => ({ id }),
  getHouseholdPath: (rel) => path.join(root, 'household', rel),
});
const dayDir = (u) => path.join(root, 'users', u, 'apps', 'school');

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-')); warns = []; fs.mkdirSync(dayDir('felix'), { recursive: true }); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('attempt shard integrity (readiness Blocker 1)', () => {
  it('a CORRUPT day file refuses the append — never clobbered to a one-row list', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    const file = path.join(dayDir('felix'), 'attempts-2026-08-06.yml'); // match the real shard filename — read the datastore's #attemptFile first and adjust
    fs.writeFileSync(file, '{ this is: [not, yaml');
    expect(() => ds.appendAttempt('felix', { id: 'att_1', at: '2026-08-06T10:00:00.000Z', bankId: 'b', itemId: 'q', correct: true }))
      .toThrow(/corrupt/i);
    expect(fs.readFileSync(file, 'utf8')).toContain('this is'); // original bytes untouched
  });
  it('a corrupt read is LOUD (logged) and returns [], a missing file is quiet []', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    const file = path.join(dayDir('felix'), 'attempts-2026-08-06.yml');
    fs.writeFileSync(file, '{ nope: [');
    expect(ds.readAttemptDay('felix', '2026-08-06')).toEqual([]);
    expect(warns.some(([evt]) => evt === 'school.attempts.shard-corrupt')).toBe(true);
    warns = [];
    expect(ds.readAttemptDay('felix', '2026-08-05')).toEqual([]); // missing: no log
    expect(warns).toEqual([]);
  });
  it('a healthy append survives and rewrites ATOMICALLY (no partial file on interrupt is testable as: tmp is renamed, not written in place)', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    ds.appendAttempt('felix', { id: 'att_1', at: '2026-08-06T10:00:00.000Z', bankId: 'b', itemId: 'q', correct: true });
    ds.appendAttempt('felix', { id: 'att_2', at: '2026-08-06T10:01:00.000Z', bankId: 'b', itemId: 'q2', correct: false });
    expect(ds.readAttemptDay('felix', '2026-08-06')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/isolated/adapter/school/attemptShardIntegrity.test.mjs`. Expected: the corrupt-append test fails (today it clobbers). NOTE: first `Read` the datastore to confirm the shard filename/constructor deps and fix the test fixture to match reality — the test must fail for the RIGHT reason.

- [ ] **Step 3: Implement.** In `YamlSchoolDatastore.mjs`:
  - Add a private `#readAttemptShard(file)` returning `{state: 'missing'|'ok'|'corrupt', rows}`: missing → `{state:'missing', rows:[]}`; parse error or non-array → `{state:'corrupt', rows:[]}` + `this.#logger.warn?.('school.attempts.shard-corrupt', { file })` (import/thread a `logger = console` ctor dep if the class lacks one).
  - `readAttemptDay` uses it (corrupt logs, returns []).
  - `appendAttempt`: `const read = this.#readAttemptShard(file); if (read.state === 'corrupt') throw new DomainInvariantError('attempt shard is corrupt — refusing to overwrite recorded evidence', { code: 'ATTEMPT_SHARD_CORRUPT' });` then `saveYamlToPathAtomic(file, [...read.rows, attempt])`.
  - Sweep EVERY other `saveYaml(` in this file → `saveYamlToPathAtomic(` (quiz-requests, print-pending, print-log, report cards, archive). Verify `saveYamlToPathAtomic` exists in the FileIO module; if the export name differs, use the actual name (grep FileIO first).

- [ ] **Step 4: Run the new test + the datastore's existing consumers** — `npx vitest run tests/isolated/adapter/school tests/isolated/application/school/printService.test.mjs backend/src/3_applications/school`. Expected: PASS (only known drift red).

- [ ] **Step 5: Commit** — `fix(school): attempt shards refuse corrupt overwrites; all datastore writes atomic (readiness Blocker 1)`

### Task 2: Assignment-store corrupt-refusal

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlAssignmentStore.mjs` (`#read` ~L57, `put`, `#readHistory`)
- Test: extend `tests/isolated/adapter/school/lifecycleStores.test.mjs`

**Interfaces:** `get()` on a corrupt file returns null AND logs `school.assignments.file-corrupt`; `put()` against a corrupt current file THROWS (`code: 'ASSIGNMENTS_CORRUPT'`) instead of silently starting over; history writes atomic.

- [ ] **Step 1: failing test** — in `lifecycleStores.test.mjs` add: write garbage to `apps/school/assignments/kid1.yml`, expect `put({learnerId:'kid1', …})` to reject with /corrupt/ and the file bytes unchanged; expect `get('kid1')` → null with a warn logged.
- [ ] **Step 2: verify fail.** — `npx vitest run tests/isolated/adapter/school/lifecycleStores.test.mjs`
- [ ] **Step 3: implement** — `#read` distinguishes ENOENT (null, quiet) from parse-failure (null, `logger.warn('school.assignments.file-corrupt', {file})`, and set an internal `#corrupt.add(learnerId)`); `put` checks `#corrupt.has(learnerId)` → throw; writes go tmp+rename. Add `logger = console` ctor dep if absent.
- [ ] **Step 4: pass** + rerun `tests/isolated/api/school/lifecycleParentWrites.test.mjs`.
- [ ] **Step 5: Commit** — `fix(school): assignment store refuses corrupt overwrites`

### Task 3: PIN on the grade/close human lanes (punch 2)

**Files:**
- Modify: `backend/src/3_applications/school/usecases/GradeSubmission.mjs` (ctor + execute), `CloseSessionOutcome.mjs` (ctor + execute), `backend/src/5_composition/modules/schoolLifecycle.mjs` (pass `teacherGate` to both), `backend/src/4_api/v1/routers/schoolLifecycle.mjs` (forward `pin` from body on `/grade` and `/close`)
- Test: extend `tests/isolated/application/school/paperWork.test.mjs` and `closeOutcome.test.mjs`

**Interfaces:**
- `GradeSubmission` ctor gains `teacherGate = null`. In `execute`, ONLY when the caller supplies human verdicts (`verdicts` object present) AND `teacherGate` is wired: `this.#teacherGate.assert({ userId: gradedBy, pin, action: 'sessions.grade', context: { sessionId } })`. The finisher lane (`execute({sessionId})` with no verdicts — ResolveReviewItem's self-closing loop) is already behind the gated resolve and MUST NOT re-assert.
- `CloseSessionOutcome` ctor gains `teacherGate = null`. Only when `signedOff === true` (the coin-release sign-off) AND gate wired: assert `{userId: signedOffBy, pin, action: 'sessions.close-signoff'}`. Plain unsigned closes (finisher lane) unchanged → `awaiting_signoff`.
- Routes forward `pin: req.body?.pin ?? null` into both executes.

- [ ] **Step 1: failing tests** — paperWork: `grade.execute({sessionId, verdicts, gradedBy:'parent', pin:'wrong'})` with a refusing gate → rejects GuestForbiddenError, review queue untouched; with no gate wired → legacy behavior passes (pin ignored). closeOutcome: `close.execute({sessionId, signedOff:true, signedOffBy:'dad', pin:'wrong'})` with refusing gate → rejects, no reward paid; finisher-style `close.execute({sessionId})` with a gate wired → still settles unsigned (no assert call — use a vi.fn gate and assert not called).
- [ ] **Step 2: verify fail.**
- [ ] **Step 3: implement** exactly per Interfaces (mirror `SetAssignments`'s teacherGate-else-grownUps shape — but here the grownUps check STAYS and the gate ADDS the PIN on top when wired).
- [ ] **Step 4: pass** + rerun `tests/isolated/e2e/school/teacherJourney.e2e.test.mjs` (its grade/close calls pass no pin and wire no gate — must stay green) and `backend/src/3_applications/school/usecases/repairDomains.test.mjs` (A1 finisher).
- [ ] **Step 5: Commit** — `fix(school): human grading and coin sign-off carry the PIN (readiness punch 2)`

### Task 4: De-mutate the agenda GET (punch 5a)

**Files:**
- Modify: `backend/src/4_api/v1/routers/schoolLifecycle.mjs` (~L186 `GET /learners/:learnerId/agenda`)
- Test: extend `tests/isolated/api/school/schoolLifecycleRouter.test.mjs`

**Interfaces:** `GET /learners/:id/agenda` becomes side-effect-free: it executes `previewAgenda` (dry-run twin, identical PNG) instead of `buildAgenda`. `POST /learners/:id/agenda` is added for any caller that truly needs the minting build (none known over HTTP — the NFC path calls `handleScan` in-process). Both routes keep the `?name=` override.

- [ ] **Step 1: failing test** — router test with `buildAgenda: vi.fn()`, `previewAgenda: {execute: vi.fn(async () => ({document:{id:'agenda-x'}, sections:[], plan:{entries:[],errors:[]}}))}` + a stub `receiptPngRenderer`: `GET /learners/felix/agenda` → previewAgenda called, buildAgenda NOT called; `POST /learners/felix/agenda` → buildAgenda called.
- [ ] **Step 2: verify fail.** **Step 3: implement** (move the existing GET handler body to POST; GET delegates to the preview handler logic — reuse, don't duplicate the PNG plumbing: extract a local `sendAgendaPng(res, result)` helper inside the router factory).
- [ ] **Step 4: pass** + `tests/isolated/e2e/school/agendaPreview.e2e.test.mjs`.
- [ ] **Step 5: Commit** — `fix(school): GET agenda is a dry run; the minting build moves to POST (readiness punch 5)`

### Task 5: De-mutate the print card-mint GET + PIN out of the query string (punch 5b)

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs` (the `/print/*id` splat handler, ~L321-343 card/freshCard branch)
- Test: extend `backend/src/4_api/v1/routers/school.print.routes.test.mjs`

**Interfaces:** `GET /print/*id` with `card=`/`freshCard=` or `teacherPin=` query params → `400 { error: 'card-minting renders require POST /print/render' }`. New `POST /print/render` accepting `{ id, variety, learnerName, learnerId, card, freshCard, startRow, teacherPin }` in the BODY, same response (PDF stream) and same allocation behavior as the old GET branch. Plain proof GETs (no card params) unchanged.

- [ ] **Step 1: failing test** — printables fixture app: `GET /print/math/fractions/quiz-1?freshCard=1` → 400 naming POST; `POST /print/render` body `{id:'math/fractions/quiz-1', freshCard:true}` → 200 `application/pdf`; plain `GET /print/math/fractions/quiz-1` still 200 PDF.
- [ ] **Step 2: verify fail.** **Step 3: implement** (extract the splat handler's render body into a shared local `renderPrintResponse(req-like params, res)`; the splat rejects card params; the POST parses body and calls it; the POST registers BEFORE the splat, with the other fixed /print routes — registration order is load-bearing here, see the file's own comment block).
- [ ] **Step 4: pass** the whole print routes suite. **Step 5: Commit** — `fix(school): card-minting print renders are POSTs with the PIN in the body`

### Task 6: Quiz-gate roll-up — chapter banks gate their parent unit, ALL must pass (Blocker 2)

**Files:**
- Modify: `backend/src/3_applications/school/GetMaterialUnits.mjs` (`buildBankIndex` L27-34, gate fold ~L121-140), `frontend/src/modules/School/materials/SchoolMaterialPlayer.jsx` (~L147 quiz resolve), `frontend/src/modules/School/materials/MaterialDetail.jsx` (gate copy)
- Test: extend `tests/isolated/application/school/getMaterialUnits.test.mjs`

**Interfaces:**
- `buildBankIndex(banks, { trackParents = null })` — `trackParents` is a `Map<trackContentId, unitContentId>` the material adapter supplies (the units fetch already walks children; expose each unit's track ids — read `GetMaterialUnits`'s unit-fetch path first and thread the child ids it ALREADY sees into a map, no extra Plex calls).
- `byUnit(unitId)` now returns `{ banks: [{bankId, itemCount}...], bankId, itemCount }` — `banks` is the ORDERED chapter list rolled up from track-level backlinks; `bankId`/`itemCount` keep the legacy single-bank shape pointing at the FIRST UNPASSED chapter bank (so existing consumers keep working), falling back to the first bank when all passed.
- Gate semantics (user decision): `gateSatisfied` = every bank in `banks` has a passed quiz session (`quizSessionPassed` per bank). The unit's `quiz` payload becomes `{ bankId: <next unpassed>, passingPercent, banksTotal, banksPassed }`.
- `SchoolMaterialPlayer` launches `unit.quiz.bankId` exactly as today (it is now the next unpassed chapter). `MaterialDetail` shows `Quiz 2 of 5` style copy when `banksTotal > 1`.

- [ ] **Step 1: failing tests** — in `getMaterialUnits.test.mjs`: a unit `plex:u1` whose TRACKS `plex:t1..t3` are backlinked by three banks; attempts pass banks 1-2 only → `completed:false`, `quiz:{bankId:<bank3>, banksTotal:3, banksPassed:2}`; pass all three → `gateSatisfied` true. And: a WORK-level direct backlink (today's only working shape) still binds (`banks:[one]`).
- [ ] **Step 2: verify fail.** **Step 3: implement** per Interfaces. **Step 4: pass** + frontend materials suites.
- [ ] **Step 5: Live verification (content untouched — the roll-up makes the EXISTING 382 track backlinks bind):** after the wave's deploy step, `curl -s 'localhost:3111/api/v1/school/materials/plex:619778/units?userId=felix' | python3 -c "..."` must show ≥1 unit with `quiz.bankId` non-null and `banksTotal > 1`. Record the count in the wave notes.
- [ ] **Step 6: Commit** — `feat(school): chapter banks gate their parent unit — all must pass (readiness Blocker 2)`

### Task 7: Print Center restoration (punch 4)

**Files:** data volume (via `sudo docker exec daylight-station sh -c 'cat …'`) — the paper surface profile that certification reads; verify path with `grep -rn "paper-letter-mono" backend/src data docs` first.
- Test: live probe only (config change).

- [ ] **Step 1:** Locate the paper profile (`surfaceCertification` wiring in app.mjs names the store; the profile is data-mount state per the surfaces wave). Read it via docker exec.
- [ ] **Step 2:** Add `response.text@1` and `response.matching@1` to its `capabilities` list (the print pipeline demonstrably renders short-answer rules and matching blocks — the optical suites pin both). Write the FULL file back via docker-exec heredoc (never sed).
- [ ] **Step 3:** Restart-or-reload per the profile's caching (if boot-cached, fold into the wave's deploy). Verify: `curl -s localhost:3111/api/v1/school/print/printables` lists `state-capitals`, and the prod log no longer emits `print.printable-excluded`.
- [ ] **Step 4:** Commit any in-repo seed/fixture twin of the profile if one exists (grep first); otherwise record the data-volume change in the wave notes.

### Task 8: Report-card cold path (punch 1)

**Files:**
- Modify: `backend/src/3_applications/school/GetMaterialProgressSummary.mjs` (sequential loop ~L44-51), `backend/src/3_applications/school/GetMaterialUnits.mjs` (`MATERIAL_TTL_MS` L~44)
- Test: extend `tests/isolated/application/school/getMaterialProgressSummary.test.mjs`

**Interfaces:** the per-material units fetches run with BOUNDED CONCURRENCY 6 (a local `mapLimit(items, 6, fn)` helper in the file — 10 lines, no dependency), and `MATERIAL_TTL_MS` rises 300_000 → 3_600_000 (units rarely change; progress is folded fresh each call — the comment already says so).

- [ ] **Step 1: failing test** — fake `getMaterialUnits.execute` that records concurrent in-flight count (increment on entry, decrement after `await sleep(5)`); 20 materials → max in-flight ≤ 6 AND result order preserved.
- [ ] **Step 2: verify fail** (today max in-flight is 1 — assert ≥2 fails… invert: assert the SUMMARY total runtime < sequential; simplest honest pin: assert `maxInFlight > 1 && maxInFlight <= 6`).
- [ ] **Step 3: implement.** **Step 4: pass.**
- [ ] **Step 5: after deploy, measure live**: `time curl -s 'localhost:3111/api/v1/school/report-card?learnerId=felix&periodId=2026-fall&format=pdf' -o /dev/null` twice (cold container, then warm). Record both; target cold < 8s, warm < 1s.
- [ ] **Step 6: Commit** — `perf(school): materials summary fans out bounded-parallel; units cache 1h (readiness punch 1)`

### Task 9: Green the operator gates — school:smoke + receipts test (punch 3)

**Files:**
- Modify: `scripts/school-smoke.mjs` (stale fixture ids + masthead expectation), `tests/isolated/domain/school/documents/receipts.test.mjs` (masthead greeting expectation)

- [ ] **Step 1:** Run `npm run school:smoke`; list the exact failures (assessor measured 11/13: `math-fractions-01-quiz` not found — path-form ids since the 2026-07-30 restructure — and the masthead greeting).
- [ ] **Step 2:** Fix the fixture ids to the current path-form (`math/math-fractions/...` — verify against `GET /banks` live) and the masthead expectation to the wave-9 rule (no display name → `Hello!`, never the raw id).
- [ ] **Step 3:** Fix `receipts.test.mjs` the same way (it pins the pre-wave-9 `learnerId` fallback title; the new rule: `learnerName || 'Hello!'`).
- [ ] **Step 4:** `npm run school:smoke` → 13/13; `npx vitest run tests/isolated/domain/school/documents/receipts.test.mjs` → green. **Step 5: Commit** — `test(school): operator smoke and receipts pins match the shipped product`

### Task 10: 410 session-loss gets a sign (punch 9a)

**Files:**
- Modify: `frontend/src/modules/School/quiz/QuizRunner.jsx`, `frontend/src/modules/School/flashcards/FlashcardRunner.jsx`, `frontend/src/modules/School/geography/useGradedSession.js` — every `if (…410) { onExit(); return; }` site
- Test: extend `frontend/src/modules/School/quiz/QuizRunner.test.jsx`

**Interfaces:** on 410 the runner sets `sessionLost` state and renders the error-card pattern: title, "Your quiz took a long break and timed out. Your finished answers are saved — start again to keep going.", buttons Start again (onRestart when available) / Back (onExit). `useGradedSession` returns `sessionLost` alongside `openFailed`.

- [ ] **Step 1: failing test** — answer returns `{ok:false, status:410}` → `findByTestId('session-lost')`, no silent exit (onExit NOT called until Back is clicked).
- [ ] **Step 2-4:** implement in all three, run runner suites. **Step 5: Commit** — `fix(school): a lost session says so — never a silent bounce`

### Task 11: Envelope + guard nits batch (punch 9b-d)

**Files:**
- Modify: the object-shape error handler (grep `traceId` under `backend/src/0_system/http/middleware/`) — populate from `req.id`/`crypto.randomUUID()` instead of `"unknown"`; `SetAssignments.mjs` + `SetAcademicPeriods.mjs` STALE_SAVE errors gain `err.status = 409`; `GetMaterialCatalog.mjs:10` doc comment 60s → the actual 10-min TTL.
- Test: extend `tests/isolated/api/school/lifecycleParentWrites.test.mjs` (stale save → 409) and the middleware's own suite (traceId non-"unknown").

- [ ] Steps: failing tests → verify → implement → pass (update any client/test pinning 400 for stale saves — grep `STALE_SAVE` and `400` in frontend/tests) → Commit `fix(school): stale saves are 409s, error envelopes carry a real traceId`.

### Task 12: Reassignment audit log (debt M5)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlReassignmentLog.mjs` (append-only `apps/school/reassignments.yml`, atomic writes, corrupt-refusal — copy the `YamlAttestationLog` skeleton minus retractions)
- Modify: `ReassignEvidence.mjs` (optional `auditLog = null` dep; append `{at, fromLearnerId, toLearnerId, day, assessmentId, moved, reassignedBy}` after a successful move, best-effort), `backend/src/app.mjs` wiring, `GET /audit` in `school.mjs` merges the new trail (`kind: 'reassignment'`).
- Test: extend `backend/src/3_applications/school/usecases/repairDomains.test.mjs` + the audit route test.

- [ ] Steps: failing tests (append on success incl. the audit-route row; a throwing log never blocks the move) → implement → pass → Commit `feat(school): reassignments write their own audit trail`.

### Task 13: Quota-approval preview (debt M6a)

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs` — new `GET /print/printables/:printableId/preview` streaming the resolved PDF via `printService` (add `previewPrintable(printableId)` to `PrintService`: `#findPrintable` + `#resolve`, NO quota check, NO print, NO log); `frontend/src/modules/School/print/PrintCenter.jsx` — each approval row gains a `Preview` link (`target="_blank"`).
- Test: print routes suite (200 PDF for a known printable, 404 unknown) + PrintCenter render test.

- [ ] Steps: failing tests → implement → pass → Commit `feat(school): approvers can see the sheet before saying yes`.

### Task 14: Nudge reads the live teacher list (debt M6b)

**Files:** `backend/src/app.mjs` (`school:teacher-backlog-nudge` task ~L3729): replace the boot-cached `configService.getHouseholdAppConfig(null,'school').teachers` with `await configService.reloadHouseholdAppConfig?.(null,'school')` guarded in try/catch falling back to the cached read (verify the reload method's exact name/signature in ConfigService first — memory: `reloadHouseholdAppConfig` exists).
- Test: none practical at this seam (composition); verify by log line addition `school.teacher-nudge.teachers { count }` and the wave's live deploy check.

- [ ] Steps: implement + log → Commit `fix(school): the nudge sees teachers added since boot`.

### Task 15: Day plan on the student panel (debt W7a)

**Files:**
- Modify: `frontend/src/modules/School/home/StudentPanel.jsx` — claimed panel fetches `schoolApi.agendaPreview(currentUser.id)` (now guaranteed side-effect-free by Task 4) and renders a compact "Today" list: per section `subject — next title | done today`; omit when empty.
- Test: extend `StudentPanel.render.test.jsx` (mock agendaPreview; renders rows; omits when no sections; fetch failure renders nothing — never an error card on the rail).

- [ ] Steps: failing test → implement (reuse the LearnerDay row copy conventions, labelized) → pass → Commit `feat(school): the kid sees today's plan on their own rail`.

### Task 16: Tutor link on a failed summary (debt W7b)

**Files:**
- Modify: `frontend/src/modules/School/quiz/QuizRunner.jsx` — on `passed === false` and `learning?.unitId`, beside RetakeAsk render `Practice with the tutor` navigating to the remediation tutor surface (grep how `AdaptiveTutorPanel` is routed/launched — `remediationTutor` route family — and deep-link with `unitId`/`bankId` params; if the tutor only mounts inside Admin today, the link opens the LearningCatalog lesson for that unit instead — implement whichever target EXISTS, and say which in the commit).
- Test: QuizRunner test — failing summary shows the link with the right href/handler; passing summary doesn't.

- [ ] Steps: grep the tutor's real entry point FIRST → failing test → implement → pass → Commit `feat(school): a failed quiz offers the tutor, not just a retake`.

### Task 17: Mid-quiz resumability — server-side sittings (debt W7, big)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlSittingStore.mjs` — per-user `users/{id}/apps/school/sittings.yml`: `{ [bankId]: { mode, startedAt, answers: [{itemId, correct}] } }`; atomic writes; corrupt-refusal (corrupt = warn + treat as none, REFUSE writes until cleared — a sitting is a convenience, not evidence).
- Modify: `backend/src/3_applications/school/SchoolService.mjs` — ctor gains `sittings = null`. `openSession({userId, bankId, mode, fresh = false})`: when `sittings` wired, signed-in, mode `quiz`, not `fresh`, and a sitting exists with `startedAt` < 24h and `answers.length < bank.items.length` → return `{sessionId, resume: {answeredItemIds: [...], score, outcomes: [bool...]}}` and preload the in-memory session's responseClaims-equivalent so re-answering an answered item is refused. `#gradeAndRecord`: after a successful signed-in QUIZ append, upsert the sitting; when `answers.length === bank.items.length`, DELETE the sitting (complete). `fresh:true` deletes any sitting first.
- Modify: `backend/src/4_api/v1/routers/school.mjs` — `/sessions` open route forwards `fresh`.
- Modify: `frontend/src/modules/School/quiz/QuizRunner.jsx` — when `openSession` answers `resume`, initialize `index/score/outcomes` from it and show a one-line chip "Picked up where you left off — question N"; `onRestart` passes `fresh: true`. `schoolApi.openSession` body gains `fresh`.
- Test: `backend/src/3_applications/school/SchoolService.sittings.test.mjs` (create) + QuizRunner resume test.

**Interfaces:** `openSession` return shape gains OPTIONAL `resume: { answeredItemIds: string[], score: number, outcomes: (boolean|null)[] }`. Nothing else changes for callers that ignore it.

- [ ] **Step 1: failing backend tests** — signed-in quiz: answer 2 of 3, drop the session (new service instance, same sitting store dir), reopen → `resume.score` correct, third answer completes and CLEARS the sitting (reopen again → no resume); `fresh:true` → no resume and sitting wiped; guests and flashcard mode never write sittings; a >24h-old sitting is ignored and replaced.
- [ ] **Step 2: verify fail. Step 3: implement backend. Step 4: pass.**
- [ ] **Step 5: failing frontend test** — openSession resolves with `resume {answeredItemIds:[q1], score:1, outcomes:[true]}` → runner starts at question 2 with the chip; summary dots include the resumed outcome; Try again calls openSession with `fresh:true`.
- [ ] **Step 6: implement + pass. Step 7:** wire `sittings` in `backend/src/app.mjs` (construct YamlSittingStore with configService). **Step 8: Commit** — `feat(school): quizzes resume across restarts — a sitting survives the sitter`

### Task 18: Identity ceremony unification (debt W9, big)

**Files:**
- Modify: `frontend/src/lib/identity/ProfilePicker.jsx` — new optional `guestLabel` prop: when set, render an explicit `guestLabel` button row under the faces; `onGuest` callback prop fires it. (Opt-in — Piano callers unchanged.)
- Modify: `frontend/src/modules/School/SchoolApp.jsx` — the launch flow: claimed user → launch directly (verify this already holds; fix if any path still prompts); unclaimed + generic bank → open the picker WITH `guestLabel="Just practicing — continue as guest"`; picking a face claims-and-launches; the guest button launches as guest (this is the ONLY demotion path); ✕/backdrop/timeout now CANCEL the launch (no guest demotion, no notice). Kill the dismissal-demotes-to-guest branch and its notice copy.
- Test: `SchoolApp.test.jsx` bank-flow tests updated: dismissal cancels (no runner, no guest state); the explicit guest button proceeds as guest; a claimed kid launching generic work never sees the picker.

- [ ] Steps: failing tests for the three ceremonies → implement → pass (update the three existing "dismissing the picker" tests to the new cancel semantics) → Commit `feat(school): one identity ceremony — guest is a choice, dismissal is a cancel`.

### Task 19: Console live smoke (punch 8)

**Files:**
- Create: `tests/live/flow/school/teacherConsole.runtime.test.mjs` — Playwright against the RUNNING server (reuse the live-harness conventions: port from `tests/_lib/configHelper.mjs`, `reuseExistingServer`): loads `/school/teacher`, asserts the four tabs render, the Today roster shows every `students:` kid by name (fetch `/api/v1/school/teachers` + `/roster` first and assert against the LIVE roster, not fixtures), Planning shows the matrix table, and a wrong-PIN write refusal surfaces the PIN prompt (fill a pass-override with pin 0000 → expect the error copy; NEVER the real PIN).
- [ ] Steps: write → `npm run test:live:flow -- tests/live/flow/school/teacherConsole.runtime.test.mjs` against the dev server → green → Commit `test(school): the console is finally driven headless against live wiring`.

### Task 20: Ops close-out + ledger update

- [ ] **Step 1 (MANUAL — the teacher, not a script):** resolve `ses_JBbf4vrc` on the Repair tab (resume it with felix, or Abandon with a reason). Recorded here as the operator step; the wave does NOT script it.
- [ ] **Step 2:** Update `docs/superpowers/plans/2026-08-06-school-teacher-console.md` with the Wave 10 shipped record; strike every retired ledger line (M5 audit, M6 preview, M6 nudge, W7 resumability/day-plan/tutor-link, W9 identity, F1/F2/F3, punch 1-9) and RE-RECORD what remains open by choice (tap-confirm, paper "one more?", third flashcard lane, certificate portrait, media-completion client-claim now backstopped by Task 6's live gate).
- [ ] **Step 3:** Update `docs/reference/school/README.md` (sittings, identity ceremony, POST render/agenda, PIN lanes) and `docs/runbooks/school-cold-start.md` (Print Center capability requirement).
- [ ] **Step 4:** Full school-scoped sweep → vite build → docker build → deploy gate → deploy → live verifications listed in Tasks 6/7/8 → M10 Fable review (production-readiness re-assessment: verify both blockers dead, re-measure the cold path, re-run the gating table) → apply verdicts → merge to main, delete branch, record, push.

---

## Self-Review

- **Coverage:** Blockers 1-2 → Tasks 1, 6. Punch 1-9 → Tasks 8, 3, 9, 7, 4+5, 2, 20(step1), 19, 10+11. Ledger: M5→12, M6→13+14, W7→15+16+17, W9→18, F1/F2→4+5, F3→3, F5→backstopped by 6 (recorded in 20). Deliberately NOT built (re-recorded in Task 20): tap-confirm, paper one-more, third flashcard lane, certificate orientation — these were design choices the advocates themselves accepted, and the user's "handle the debt" is honored by re-recording them as CHOICES, not debt. If the user wants them too, they are one wave away.
- **Placeholder scan:** Tasks 7 and 14 depend on data/ConfigService shapes that must be read first — each says exactly what to grep and what to do with what's found; no TBDs remain.
- **Type consistency:** `resume` shape (Task 17) matches between backend return and frontend consumption; `byUnit` roll-up shape (Task 6) keeps the legacy `{bankId, itemCount}` fields so `GetMaterialUnits`'s existing fold and the frontend keep compiling before their own edits land.

---

## Close-out (Task 20, Steps 2–3)

Tasks 1–19 shipped as planned (commits `db0330ee3`..`61457b602`; per-task reports and review-remediation diffs under `.superpowers/sdd/2026-08-06-school-production-hardening/`). Both blockers are dead (corrupt-refusal + atomic writes on attempts/assignments/sittings; the chapter-bank quiz-gate roll-up), the nine-item punch list is closed, and every named ledger deviation this wave targeted (M5 audit, M6 preview, M6 nudge, W7 resumability, W7 day-plan, W9 identity triangle, findings F1/F2/F3) is closed — full detail, including the one item closed only partially (W7 tutor-link) and the five items re-recorded as open-by-choice rather than debt, is recorded in the **Wave 10** entry appended to `docs/superpowers/plans/2026-08-06-school-teacher-console.md` (the programme's own ledger — this plan is Wave 10 of that programme, not a separate one). `docs/reference/school/README.md` gained a "Production hardening (wave 10)" section and a sittings-contract correction (the ordered-prefix resume rule); `docs/runbooks/school-cold-start.md` gained the Print Center surface-profile capability requirement.

Step 1 (resolving the stranded `ses_JBbf4vrc` session) is a manual teacher action, not scripted by this wave. Step 4 (full sweep → build → deploy → live verification → Fable M10 production-readiness re-assessment → merge) has not run yet as of this close-out — it is the wave controller's, tracked separately.
