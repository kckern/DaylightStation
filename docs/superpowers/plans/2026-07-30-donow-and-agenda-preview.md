# DoNow Dispatch + Agenda Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship (A) the dry-run agenda preview PNG with real QR modules, and (B) the household DoNow dispatch contract — closed surface registry, occupancy policy, HA parental override — with the curriculum as its first caller.

**Architecture:** Phase A adds a `scanCodes` option to the receipt PNG renderer and a side-effect-free preview route composed from no-op write ports. Phase B builds a pure policy domain + application service facade over the existing dispatch seams (WakeAndLoad, SendHubCommand, school WS topic, kiosk relay, printers), two new WS-reachable surfaces (garage fitness, piano), presence trackers for soft occupancy, an HA actionable-notification approval loop, and the school-side `launch:` unit machinery (one new session event + an honor-close door).

**Tech Stack:** Node ESM (`.mjs`), vitest, YAML persistence, `qrcode` npm (already a dep), WebSocket event bus, Home Assistant notify passthrough, React hooks.

**Specs (read the relevant sections before your task):**
- `docs/superpowers/specs/2026-07-30-school-agenda-preview-design.md` (Phase A)
- `docs/superpowers/specs/2026-07-30-household-donow-dispatch-design.md` (Phase B — §3 contract, §4 approvals incl. dedup + approve-time table, §5/§5.1 registry + occupancy mechanisms, §6 curriculum mechanics, §9 test rows)

## Global Constraints

- Tests: `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run <paths>` (worktree may lack node_modules; symlink from the main repo if missing).
- WORKSPACE DISCIPLINE: work ONLY in `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3`, branch `school-dispatch-preview`. IMMEDIATELY before every `git commit`, verify `git rev-parse --show-toplevel` prints that path and `git branch --show-current` prints `school-dispatch-preview`. Two implementers in the prior wave committed to the main checkout — do not be the third.
- Commit per task with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Backend layering: `2_domains` pure (no I/O/clock); `3_applications` sees ports; `5_composition` names adapters. Closed sets in code; config selects.
- Derived, never stored (rollups); append-only date-sharded logs (economy-ledger pattern).
- Scan-never-silent on every school-facing path; ASCII only in printed strings.
- Occupancy fail-closed: stale-idle clobbers a human (forbidden); `unknown` → pending. Freshness windows are the spec §5.1 numbers verbatim: portal 10 min, piano 5 min, garage 3 min, living room 2 min.
- No new locking anywhere — TOCTOU is accepted by spec §4.
- Structured logging only (`logger.child({...})`), never console.*.
- Known baseline noise: `tests/isolated/` has ~19 pre-existing failing files unrelated to school/donow (localContent, piano-router, configLoader, Immich, fitness-debug, nutribot, UserSwitcher, WeeklyReview, scripture, infrastructure-ownership, playlistSorter, paginationScrollGuard, active-participant/build-session fitness units). Gate on YOUR directories, not the whole tree.

---

## PHASE A — Agenda preview

### Task 1: `scanCodes: 'qr'` in the receipt PNG renderer

**Files:**
- Modify: `backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs`
- Test: `tests/isolated/rendering/school/documentReceiptRenderer.test.mjs` (extend)

**Interfaces:**
- Produces: `createDocumentReceiptRenderer({ scanCodes: 'box'|'qr' = 'box', ...existing })`. In `'qr'` mode the action block's code area is filled with real QR modules for `code`; `'box'` mode is byte-identical to today. Task 2 constructs with `'qr'`.

- [ ] **Step 1: Write the failing test** (append to the existing file, reusing its render harness — read it first):

```js
describe("scanCodes: 'qr'", () => {
  const scanDoc = {
    id: 'qr-probe', seed: 0, variant: 0, target: ['receipt'],
    blocks: [{ type: 'scan_action', action: 'sch:ABCDEFGH23456789', label: 'Scan me' }],
  };
  const darkPixelsInCodeArea = (canvas, theme) => {
    const ctx = canvas.getContext('2d');
    const size = theme.action.codeAreaPx - 8; // inside the border
    const x = theme.canvas.width - theme.layout.margin - theme.action.padding - theme.action.codeAreaPx + 4;
    // find the action op's y: sample generously below the top margin
    const img = ctx.getImageData(x, 0, size, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < img.length; i += 4) if (img[i] < 96) dark += 1;
    return dark;
  };
  it('draws real QR modules into the code area', async () => {
    const qr = createDocumentReceiptRenderer({ scanCodes: 'qr' });
    const box = createDocumentReceiptRenderer();
    const a = await qr.render(scanDoc, { tokens: {} });
    const b = await box.render(scanDoc, { tokens: {} });
    const darkQr = darkPixelsInCodeArea(a.canvas, documentReceiptTheme);
    const darkBox = darkPixelsInCodeArea(b.canvas, documentReceiptTheme);
    expect(darkQr).toBeGreaterThan(darkBox * 3); // modules vs an empty stroked box
  });
  it('default stays box — construction without the option is unchanged', async () => {
    const r = createDocumentReceiptRenderer();
    const out = await r.render(scanDoc, { tokens: {} });
    expect(out.codes).toHaveLength(1); // existing contract intact
  });
});
```

Import `documentReceiptTheme` from `./documentReceiptTheme.mjs` path used by the test file already (check its imports; adjust the sampling helper to the real render() call signature the existing tests use — mirror them exactly).

- [ ] **Step 2: Run — FAIL** (`scanCodes` unknown / dark counts equal).
- [ ] **Step 3: Implement.** In `createDocumentReceiptRenderer({ theme, texToSvg, rasterizeSvg, fontDir, scanCodes = 'box' })`: in the draw pass where the action op strokes the code box (`ctx.strokeRect(codeX, codeY, codeAreaPx, codeAreaPx)` around line 241), when `scanCodes === 'qr'`:

```js
import QRCode from 'qrcode'; // top of file — direct dep, same encoder as 1_rendering/qrcode
// in the action draw branch:
const qr = QRCode.create(op.code, { errorCorrectionLevel: 'M' });
const count = qr.modules.size;
const quiet = 2; // modules of quiet zone inside the box
const cell = Math.floor(theme.action.codeAreaPx / (count + 2 * quiet));
const offset = Math.floor((theme.action.codeAreaPx - cell * count) / 2);
ctx.fillStyle = '#000';
for (let r = 0; r < count; r += 1) {
  for (let c = 0; c < count; c += 1) {
    if (qr.modules.get(r, c)) {
      ctx.fillRect(codeX + offset + c * cell, codeY + offset + r * cell, cell, cell);
    }
  }
}
```

Keep the border stroke and the token text beneath in BOTH modes. The module math is synchronous inside the existing async `render()` — do not restructure the await (spec §4 wording).

- [ ] **Step 4: Run the rendering dir** — `... run tests/isolated/rendering/school/` — PASS (goldens untouched because default is `'box'`).
- [ ] **Step 5: Commit** (`feat(school): receipt PNG renderer draws real QR modules (scanCodes option)`).

---

### Task 2: Dry-run preview composition + route

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` (previewAgenda + preview renderer)
- Modify: `backend/src/4_api/v1/routers/schoolLifecycle.mjs` (the route)
- Modify: `backend/src/3_applications/school/LanguageStudyService.mjs` (ONE comment on `todayStatus` — see step 3)
- Test: `tests/isolated/e2e/school/agendaPreview.e2e.test.mjs` (new; use `tests/_lib/school/lifecycleHarness.mjs` — read how `agendaV2LanguageJourney.e2e.test.mjs` wires it)

**Interfaces:**
- Consumes: Task 1's `scanCodes: 'qr'`; the shipped `BuildAgenda` constructor (curriculum, assignments, sessions, tokens, launchers, timezone, clock, rng, newSessionId, subjectTokenTtlHours, logger).
- Produces: lifecycle result gains `previewAgenda` (a BuildAgenda instance) and `renderers.receiptPng`; router mounts `GET /learners/:learnerId/agenda/preview`.

- [ ] **Step 1: Failing e2e test** — through the harness: (a) `GET .../agenda/preview` for a learner with an assignment → 200, body starts with PNG magic (`89 50 4E 47`), `content-type: image/png`, `content-disposition` contains a slugified filename; (b) DRY-RUN PROOF: after the preview, the harness's session store shows ZERO new sessions for the learner, the token registry has ZERO records, AND no language progress file was written (assert on the harness's language datastore — the fake's `writeProgress` spy is uncalled; this pins `todayStatus` read-only-ness per spec §3); (c) a real tap afterwards still creates sessions/tokens normally; (d) unknown learner → 200 PNG (the notice renders). If the harness serves routes via supertest/express, mirror the existing e2e's route invocation style; if it calls use cases directly, add the router with a minimal express app the way other router tests do (`grep -rln createSchoolLifecycleRouter tests/`).
- [ ] **Step 2: Run — FAIL** (no route).
- [ ] **Step 3: Implement.**
  - Composition: after the real `buildAgenda`, construct:

```js
const previewSessions = {
  listForLearner: (id) => stores.sessions.listForLearner(id),
  readEvents: (sid) => stores.sessions.readEvents(sid),
  appendEvent: async () => {}, // dry run: ensureSession reduces locally
};
const previewAgenda = new BuildAgenda({
  curriculum, assignments: stores.assignments, sessions: previewSessions,
  tokens: { put: async () => {} }, launchers, timezone, clock, rng, newSessionId,
  logger: logger.child ? logger.child({ preview: true }) : logger,
});
const { createDocumentReceiptRenderer } = await import('#rendering/school/documents/DocumentReceiptRenderer.mjs');
const receiptPngRenderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
```

  Expose both through the lifecycle return (`useCases.previewAgenda`, `renderers.receiptPng`) and thread into the router deps.
  - Router (beside the JSON `/agenda` route):

```js
if (previewAgenda && receiptPngRenderer) {
  router.get('/learners/:learnerId/agenda/preview', asyncHandler(async (req, res) => {
    const result = await previewAgenda.execute({
      learnerId: req.params.learnerId,
      learnerName: typeof req.query.name === 'string' ? req.query.name : null,
    });
    const rendered = await receiptPngRenderer.render(result.document, { tokens: {} });
    const buffer = rendered.canvas.toBuffer('image/png');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `inline; filename="agenda-${slugify(req.params.learnerId, 'learner')}.png"`);
    res.send(buffer);
  }));
} else if (previewAgenda || receiptPngRenderer) { /* mount 501 like gratitude's not-configured posture */ }
```

  Import `slugify` from `#domains/school/documents/receipts.mjs`. Check `render`'s real signature in the renderer (`render(document, { tokens })` — confirm from the existing renderer test) and pass the document's tokens map the way the tape path does — the agenda document's scan_action `action` fields already carry the token values, so `tokens: {}` falls back to `block.action` (verify `actionOp`'s `tokens?.[block.action] ?? ... ?? block.action` chain renders the token; it does).
  - `LanguageStudyService.todayStatus`: add one comment line above it: `// READ-ONLY by contract: the agenda preview GET depends on status() never writing (preview spec §3).`
- [ ] **Step 4: Run** the e2e file + `tests/isolated/composition/` + `tests/isolated/rendering/school/` — PASS.
- [ ] **Step 5: Commit** (`feat(school): dry-run agenda preview endpoint — PNG with real QR`).

---

## PHASE B — DoNow

### Task 3: Pure policy domain

**Files:**
- Create: `backend/src/2_domains/donow/policy.mjs`
- Test: `tests/isolated/domain/donow/policy.test.mjs`

**Interfaces:**
- Produces:

```js
export const DECISIONS = Object.freeze(['dispatch', 'pending_approval', 'denied']);
// initial request (spec §3 table):
export function decideDispatch({ occupancy, learnerId, force }) → 'dispatch'|'pending_approval'|'denied'
//   occupancy: { state:'idle'|'active'|'unknown', occupantId:string|null }
//   force==='never_ask' converts every pending_approval outcome into 'denied'
// approve-time re-check (spec §4 table):
export function decideOnApprove({ occupancy, learnerId, pendingOccupant, repended }) →
//   'dispatch' | 'repend' | 'denied'
//   idle → dispatch; occupant===learnerId → dispatch; occupant===pendingOccupant → dispatch;
//   different-or-unknown → repended ? 'denied' : 'repend'
```

- [ ] **Step 1: Failing tests** — every row of BOTH spec tables plus: `force:'never_ask'` with active-other → denied and with idle → dispatch; unknown + never_ask → denied; approve-time unknown first time → repend, second time → denied; null occupantId active → pending.
- [ ] **Step 2: FAIL. Step 3: Implement (pure, ~30 lines). Step 4: PASS. Step 5: Commit** (`feat(donow): pure dispatch policy — busy table + approve-time re-check`).

---

### Task 4: Pending store + dispatch log (persistence)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlDoNowDatastore.mjs`
- Test: `tests/isolated/adapter/donow/doNowDatastore.test.mjs`

**Interfaces:**
- Produces (mirror `YamlWorkSessionDatastore`'s constructor/`dataDir` conventions — read it first):

```js
class YamlDoNowDatastore {
  constructor({ dataDir, logger })
  // pending (data/apps/donow/pending.yml) — spec §4 record shape:
  async listPending()                 → [{ id, surface, action, label, learnerId, requestedBy, ref, occupant, createdAt, expiresAt, repended?: boolean }]
  async putPending(record)            // upsert by id
  async removePending(id)
  async findPending({ surface, ref }) → record|null   // UNEXPIRED only (caller passes now? no — takes nowIso opt)
  async prunePending(nowIso)          // drop expired; called on every read path
  // dispatch log (data/apps/donow/log/{YYYY-MM-DD}.yml, append-only):
  async appendDispatch({ at, surface, decision, learnerId, requestedBy, ref, programId, approvalId })
  async listDispatches({ dayStamp })  → rows for that UTC date file
}
```

- [ ] **Step 1: Failing tests** in a tmp dir (`fs.mkdtempSync`, the workSessionDatastore test arrangement): pending CRUD round-trip; `findPending` matches surface+ref and ignores expired; prune drops expired only; dispatch log appends preserve order and shard by date; `listDispatches` reads back exactly what was appended; programId persists when present, absent when not.
- [ ] **Steps 2-4: FAIL → implement → PASS. Step 5: Commit** (`feat(donow): yaml pending store + append-only dispatch log`).

---

### Task 5: DoNowService — the dispatch path

**Files:**
- Create: `backend/src/3_applications/donow/DoNowService.mjs`
- Create: `backend/src/3_applications/donow/ports/IDoNowSurface.mjs` (doc-only; mirror `IProgramLauncher.mjs`'s style exactly: id, validateAction, occupancy, dispatch, label — spec §3)
- Test: `tests/isolated/application/donow/doNowService.test.mjs`

**Interfaces:**
- Consumes: Task 3 policy, Task 4 datastore.
- Produces:

```js
new DoNowService({ surfaces /* Map id→adapter */, datastore, notifier = null,
                   eventBus = null, clock = () => new Date(), timezone = null,
                   approvalTtlSeconds = 120, newId = () => `dnr_${shortId(8)}`, logger })
async dispatch({ surface, action, learnerId = null, requestedBy, ref = null,
                 programId = null, force = undefined })
  → { decision: 'dispatched'|'pending_approval'|'denied'|'failed', approvalId?, message }
```

Behavior (spec §3, §4, §6): unknown surface / `validateAction` errors → `failed` with the errors in `message`; adapter `occupancy()` throw → treated as `unknown` (fail closed); **pending dedup FIRST** — an unexpired pending with same surface+ref returns its `approvalId` as `pending_approval`, notifier NOT called; policy `dispatch` → adapter.dispatch in try/catch (throw or `dispatched:false` → `failed`), on success append dispatch log row (with `programId` when supplied) and emit `eventBus?.broadcast('donow', { type: 'donow.dispatched', ref, surface, requestedBy })`; policy `pending_approval` → persist pending record (label from `adapter.label(action)`, occupant from the probe), call `notifier?.notify(record)` in try/catch (notify failure logged loudly, request still pends), return approvalId; `denied` → message names the occupant-free remedy ("The <label surface> is busy right now.").

- [ ] **Step 1: Failing tests with fake adapters** (`{ id, validateAction: () => [], occupancy: vi.fn(), dispatch: vi.fn(), label: () => 'Dance video in the garage' }`) and a fake notifier: one test per behavior above, INCLUDING spec §9 row 7 verbatim — impatient re-dispatch while pending → SAME approvalId, notifier called exactly ONCE; and the dispatch-log row carrying programId for `requestedBy:'school-program'`.
- [ ] **Steps 2-4. Step 5: Commit** (`feat(donow): DoNowService dispatch path — policy, dedup, log, bus event`).

---

### Task 6: Approvals — lifecycle service + HA notifier + router

**Files:**
- Create: `backend/src/3_applications/donow/DoNowApprovals.mjs`
- Create: `backend/src/1_adapters/home-automation/donow/HaApprovalNotifier.mjs`
- Create: `backend/src/4_api/v1/routers/donow.mjs`
- Test: `tests/isolated/application/donow/doNowApprovals.test.mjs`, `tests/isolated/api/routers/donow.test.mjs`

**Interfaces:**
- Consumes: Tasks 3-5.
- Produces:

```js
new DoNowApprovals({ service /* DoNowService */, datastore, notifier, clock, logger })
async approve({ id }) → { decision: 'dispatched'|'pending_approval'|'denied'|'expired', message }
async deny({ id })    → { decision: 'denied'|'expired', message }
async listPending()   → records
// approve applies decideOnApprove: re-probe the surface adapter (service exposes
// #occupancyFor or approvals receives surfaces Map directly — pick one, document it);
// 'repend' → update record { repended: true, expiresAt: now+ttl, occupant: newOccupant },
// notifier.notify(updated record) once; second flip → denied.
// expired/unknown id → 'expired' with the friendly message; double-approve idempotent
// (first outcome recorded on the record before removal; second call reads it — simplest:
// remove on terminal outcomes and treat missing as 'expired', message says it already settled).

// HaApprovalNotifier — actionable notification via the injected HA call service:
new HaApprovalNotifier({ callHomeAssistant /* {execute({domain,service,data})} */, notifyService /* e.g. 'notify.mobile_app_parent_phones' from config */, callbackBase, logger })
async notify(record) // service: notifyService split at the dot →
//   execute({ domain:'notify', service:<after dot>, data:{ title, message: record.label…,
//   data:{ actions:[{action:`DONOW_APPROVE_${record.id}`, title:'Approve'},
//                   {action:`DONOW_DENY_${record.id}`, title:'Deny'}] } } })

// Router (mount pattern: copy a small existing router, e.g. the trigger router's shape):
POST /api/v1/donow/dispatch          → service.dispatch({ ...body, requestedBy:'api' })
GET  /api/v1/donow/surfaces          → { surfaces: [{ id, label? }] } (ids + human labels only)
GET  /api/v1/donow/approvals         → { pending }
POST /api/v1/donow/approvals/:id/approve|deny  → guarded by the trigger-style location token:
//   reuse authenticate from backend/src/3_applications/trigger/guards/authenticate.mjs with
//   an expectedToken injected from config (donow.approvalsToken — read via configService in
//   composition); providedToken from ?token= or body.token. 401 on mismatch WHEN a token is
//   configured; open when not configured (the trigger router's exact posture — verify by
//   reading it).
```

- [ ] **Step 1: Failing tests.** Approvals: approve→idle→dispatched (and the session… no — school loop is Task 12; here assert service.dispatch fired via the fake adapter); approve→same pending occupant→dispatched; approve→NEW occupant→repend once (record updated, notifier called once more) then second flip→denied; deny; expired id; double-approve idempotent. Notifier: fake callHomeAssistant captures `{domain:'notify', service, data.data.actions}` with both action ids. Router: supertest-style like existing router tests (`grep -rln "supertest\|express()" tests/isolated/api/routers | head`) — dispatch happy path, approve with wrong token → 401 when configured, surfaces list shape.
- [ ] **Steps 2-4. Step 5: Commit** (`feat(donow): approvals lifecycle, HA actionable notifier, donow router`).

---

### Task 7: Presence trackers (piano, fitness, living-room playback)

**Files:**
- Create: `backend/src/3_applications/donow/presence/MidiPresenceTracker.mjs`
- Create: `backend/src/3_applications/donow/presence/FitnessPresenceTracker.mjs`
- Create: `backend/src/3_applications/donow/presence/PlaybackPresenceTracker.mjs`
- Test: `tests/isolated/application/donow/presenceTrackers.test.mjs`

**Interfaces:**
- Produces (all three share the shape):

```js
new MidiPresenceTracker({ eventBus, clock, ttlMs = 5*60_000 })      // subscribes 'midi'
new FitnessPresenceTracker({ eventBus, clock, freshMs = 3*60_000 }) // see source below
new PlaybackPresenceTracker({ eventBus, clock, freshMs = 2*60_000 })// subscribes 'playback.log' (verify the exact topic WakeAndLoadService's watchdog subscribes to — grep playback.log in WakeAndLoadService.mjs — and use the same)
tracker.occupancy() → { state, occupantId }   // per spec §5.1 rules
tracker.stop()                                 // unsubscribes
```

Rules (spec §5.1 verbatim): midi — any `session_start`/`note_on`/`session_end` payload refreshes `lastSeen`; active iff activity within ttl (missed session_end self-heals); silence → idle. Fitness — the kiosk's `fitness-profile` log events: find where frontend log messages enter the backend (`backend/src/0_system/logging/ingestion.mjs` — read it; if ingestion re-broadcasts or exposes a hook, subscribe there; if not, the tracker exports `observe(logEvent)` and composition wires it into the ingestion pipeline with a one-line tap — choose whichever ingestion.mjs actually supports and document it in the report). `sessionActive:true` within freshMs → active (occupantId null — the roster isn't identity), `false` within freshMs → idle, silence → `unknown`. Playback — a playing-state event within freshMs → active/null; otherwise UNRESOLVED here: the tracker only answers `playingRecently()`; the living-room adapter (Task 8) combines it with the TV power sensor.

- [ ] **Step 1: Failing tests** with a fake bus (capture subscriber, feed events, advance a fake clock): each state transition + decay per source, including the BLE-flap case (session_start, no session_end, clock +6 min → idle) and fitness silence → unknown.
- [ ] **Steps 2-4. Step 5: Commit** (`feat(donow): presence trackers — midi, fitness, playback with decay rules`).

---

### Task 8: Surface adapters

**Files:**
- Create: `backend/src/3_applications/donow/surfaces/PortalSurface.mjs`
- Create: `backend/src/3_applications/donow/surfaces/ThermalSurface.mjs`
- Create: `backend/src/3_applications/donow/surfaces/LaserSurface.mjs`
- Create: `backend/src/3_applications/donow/surfaces/PlaybackHubSurface.mjs`
- Create: `backend/src/3_applications/donow/surfaces/LivingroomTvSurface.mjs`
- Create: `backend/src/3_applications/donow/surfaces/GarageFitnessSurface.mjs`
- Create: `backend/src/3_applications/donow/surfaces/PianoKioskSurface.mjs`
- Modify: `backend/src/3_applications/school/SchoolService.mjs` (ONE read method for portal occupancy)
- Test: `tests/isolated/application/donow/surfaces.test.mjs`

**Interfaces (each implements IDoNowSurface; constructor deps injected, all optional-degrading):**

```js
PortalSurface({ eventBus, schoolActivity, freshMs = 10*60_000 })
//  dispatch: eventBus.broadcast('school', { type:'school.launch', learnerId, target: action.target })
//    action: { target: { kind:'bank'|'program', ... } } — validateAction requires a well-formed target
//  occupancy: schoolActivity.activeSittings() → [{ userId, lastActiveAt }] — ADD to SchoolService:
//    a read-only method returning live in-memory sessions' {userId, lastActiveAt} (read
//    SchoolService.mjs #sessions Map first; expose without leaking session objects).
//    newest within freshMs → active+that user; else idle (spec: silence IS idle here).
ThermalSurface({ receipts /* ReceiptPrinting */ })          // action: { document } → receipts.print;
//  occupancy: always idle (a queue, not a stage)
LaserSurface({ issueOrPrint })  // v1: action { printableRef } is DEFERRED-thin: validateAction
//  accepts { document? } and dispatch prints via the injected port; occupancy always idle.
//  Attribution logging NON-OPTIONAL: log donow.laser.print { learnerId, requestedBy } at info.
PlaybackHubSurface({ sendHubCommand })   // action: { action:'play', target:'red|all…', contentId, volume?, durationMin? }
//  dispatch → sendHubCommand.execute(action); occupancy: synchronous probe via the gateway
//  status — read SendHubCommand.mjs + HttpPlaybackHubAdapter.getStatus() first; any slot in
//  action's target set playing → active/null; probe throw → unknown.
LivingroomTvSurface({ wakeAndLoad, tvState /* {isOn():Promise<bool>} wrap of TVControlAdapter/HA sensor */, playback /* PlaybackPresenceTracker */, deviceId = 'livingroom-tv' })
//  dispatch → wakeAndLoad.execute(deviceId, action.query) — action: { query: {play|queue…} }
//  occupancy: !isOn → idle; isOn && playback.playingRecently() → active/null; isOn quiet → idle;
//  isOn() throw → unknown.
GarageFitnessSurface({ eventBus, presence /* FitnessPresenceTracker */ })
//  dispatch → eventBus.broadcast('fitness', { type:'fitness.launch', learnerId, episodeId: action.episodeId })
//  occupancy: presence.occupancy() (active/idle/unknown per tracker).
PianoKioskSurface({ eventBus, presence /* MidiPresenceTracker */, kioskDeviceParam })
//  dispatch → eventBus.broadcast('kiosk.launch', { topic:'kiosk.launch', deviceId: kioskDeviceParam, contentId: action.contentId, type:'piano.launch' })
//  NOTE (spec §5 addressing caveat): kioskDeviceParam is the tablet's ?device= identity string,
//  NOT a devices.yml id — composition supplies it from config; name this in a comment citing
//  the screensaver shared-deviceId bug.
//  occupancy: presence.occupancy().
```

- [ ] **Step 1: Failing tests** — per adapter: validateAction rejects garbage; dispatch delegates with the exact payload (fake seams, deep-equal); occupancy per source including throw→unknown paths; portal's SchoolService method via a stub `{ activeSittings: () => [...] }` AND a real-SchoolService test for `activeSittings()` itself (extend the SchoolService test file — read it, reuse its session-creation arrangement, assert the projection shape and that expired sittings vanish after the sweep).
- [ ] **Steps 2-4. Step 5: Commit** (`feat(donow): seven v1 surface adapters over existing seams`).

---

### Task 9: Frontend — `useFitnessLaunch` + piano launch handling

**Files:**
- Create: `frontend/src/hooks/fitness/useFitnessLaunch.js` + wire in `frontend/src/Apps/FitnessApp.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/useKioskLaunchCommand.js` (piano.launch arm) — or a sibling hook if cleaner; state the choice
- Test: `frontend/src/hooks/fitness/useFitnessLaunch.test.jsx`, extend `frontend/src/modules/Piano/PianoKiosk/useKioskLaunchCommand.test.js`

**Interfaces:**
- Consumes: `useWebSocketSubscription` (read `frontend/src/hooks/useWebSocket.js` filter semantics); FitnessApp's `/fitness/play/:episodeId` route + `handlePlayFromUrl` (read FitnessApp.jsx ~line 812 first); the kiosk message shape `{ topic:'kiosk.launch', deviceId, contentId, type? }` and its deviceId filter (read useKioskLaunchCommand.js in full).
- Produces: garage kiosk navigates to `/fitness/play/<episodeId>` on `{type:'fitness.launch'}` addressed messages (topic `fitness`); piano kiosk, on a `kiosk.launch` message with `type:'piano.launch'` passing the EXISTING deviceId filter, opens the piano content named by `contentId` through the same path a menu tap takes (read `usePianoList`/`PianoMenu.jsx` to find it; if content-open plumbing is not reachable from the hook, log a structured warn and no-op — state this in the report as the v1 boundary) instead of the retroarch intent path.

- [ ] **Step 1: Failing hook tests** (vi.mock the useWebSocket module, the SchoolApp.launch.test.jsx pattern): fitness — well-formed → navigation callback with episodeId; malformed → ignored; piano — piano.launch type routes to the piano-open callback, NEVER `launchIntent`; wrong deviceId ignored (existing behavior intact — the retroarch tests must stay green unedited).
- [ ] **Steps 2-4** (structured logging, `child({ component: ... })`). Gate: `... run frontend/src/hooks/fitness/ frontend/src/modules/Piano/PianoKiosk/useKioskLaunchCommand.test.js frontend/src/modules/School/` all green.
- [ ] **Step 5: Commit** (`feat(donow): fitness + piano kiosks gain launch reachability`).

---

### Task 10: School closed-set change #1 — `launch_dispatched` event

**Files:**
- Modify: `backend/src/2_domains/school/sessions/sessionEvents.mjs`
- Test: `tests/isolated/domain/school/sessions/sessionEvents.test.mjs` (extend; find the exact file via `grep -rln reduceSession tests/isolated/domain`)

**Interfaces:**
- Produces: SCHEMA entry `launch_dispatched: { fields: ['surface','decision','approvalId'], validate: stringField('surface') }`; TRANSITIONS: `created: [...existing, 'launch_dispatched']` and `launch_dispatched: ['outcome_recorded', 'abandoned']`; reducer handler recording `s.launch = { surface: e.surface, at: e.at }` and state advance; `nextAction` for `launch_dispatched` → `act('record_outcome', 'Waiting for the work to be done')` (non-terminal, never null — the property test over all states must stay green).

- [ ] **Step 1: Failing tests**: legal sequence created→launch_dispatched→outcome_recorded reduces with state/launch fields; illegal from `issued` rejected; nextAction non-null at `launch_dispatched`; EVENT_TYPES gains the kind (update any exact-list assertions the way Task 4 of the prior wave did — grow, don't weaken).
- [ ] **Steps 2-4** (run the whole domain/school dir — the all-states property tests must pass). **Step 5: Commit** (`feat(school): launch_dispatched session event — state, transitions, next action`).

---

### Task 11: School closed-set change #2 — the honor-close door + `launch:` validation

**Files:**
- Modify: `backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs`
- Modify: `backend/src/2_domains/school/curriculum/unitValidation.mjs`
- Modify: `backend/src/3_applications/school/CurriculumAccess.mjs` + `usecases/ValidateCatalog.mjs` (thread a `surfaces` validation option beside `programIds`)
- Test: extend `tests/isolated/application/school/closeOutcome.test.mjs` + `tests/isolated/domain/school/curriculum/unitValidation.test.mjs`

**Interfaces:**
- Produces:
  - `CloseSessionOutcome.execute({ sessionId, honorClose = false, signedOff, signedOffBy })`: when `honorClose` and state is EXACTLY `launch_dispatched` → append `outcome_recorded { result:'passed', reason:'launch_dispatched' }` (check the outcome event's SCHEMA fields — `reason` is already a field) and ride the existing `#settle`; when `honorClose` from ANY other state → the existing `unavailable` refusal (spec §9 row 6: the door stays a door). Non-honor calls byte-identical to today.
  - `validateUnit` accepts `launch: { surface, ...payload }`: joins the at-least-one-reference list; mutually exclusive with `media`, `bank`, `document`, `review`, `program` (one clear error each, the Task-2-of-prior-wave pattern); surface resolved against injected `sets.surfaceValidators` (`Map id → validateAction`) — unknown surface or non-empty `validateAction(payload)` errors reject the unit; normalized unit carries `launch` (undefined otherwise).
- [ ] **Step 1: Failing tests**: honor-close from launch_dispatched → passed outcome, settle ran (reward guard path — reuse closeOutcome.test.mjs fakes); honor-close from created/issued/graded → unavailable; regular close unchanged (existing tests green unedited); validation — legal launch-only unit normalizes; each exclusivity pair rejects; unknown surface rejects; adapter errors reject.
- [ ] **Steps 2-4. Step 5: Commit** (`feat(school): honor-close door + launch unit validation`).

---

### Task 12: School routing — launch arm, DoNow calls, ownership subscription, SurfaceProgramLauncher

**Files:**
- Modify: `backend/src/3_applications/school/usecases/offerSession.mjs` (nextMove launch arm)
- Modify: `backend/src/3_applications/school/usecases/ResolveSubjectNext.mjs` (launch kind out)
- Modify: `backend/src/3_applications/school/usecases/ResolveScanAction.mjs` (route it)
- Create: `backend/src/3_applications/school/SurfaceProgramLauncher.mjs`
- Create: `backend/src/3_applications/school/DoNowSchoolBridge.mjs` (the donow.dispatched subscription + honor-close, ownership-filtered)
- Test: extend `resolveSubjectNext.test.mjs` / `resolveScanAction.test.mjs`; new `tests/isolated/application/school/surfaceProgramLauncher.test.mjs`, `doNowSchoolBridge.test.mjs`

**Interfaces:**
- `nextMove`: state `created` + `unit.launch` → `{ kind: 'launch', tokenClass: 'select_unit', label: unit.launch.labelHint ?? 'go do this' }` — CHECK the shipped label conventions first and pick wording consistent with `agendaLabel`'s voice; the label prints on the agenda.
- `ResolveSubjectNext` move result may carry `move.kind === 'launch'`; `ResolveScanAction.#subjectNext` routes it: `donow.dispatch({ surface: unit.launch.surface, action: unit.launch, learnerId, requestedBy: 'school-scan', ref: sessionId })`; slip wording per decision (spec §6): dispatched → append `launch_dispatched` + `closeSessionOutcome.execute({ sessionId, honorClose: true })`, slip "Starting — off you go."; pending → slip "…is busy — we asked a grown-up."; denied/failed → slip with the remedy. ALSO the per-unit path: `#start` on a launch unit (select_unit token) routes identically — one helper, two callers.
- `SurfaceProgramLauncher`: `{ id, label, surface, action, subject }` from config; `launch({userId})` → `donow.dispatch({ surface, action, learnerId: userId, requestedBy: 'school-program', ref: id, programId: id })`; `status({userId})` → reads `datastore.listDispatches({ dayStamp: todayInHouseholdTz })` filtering `programId === id && learnerId === userId` within the CURRENT STUDY DAY (reuse `isSameStudyDay` from `#domains/school/studyDay.mjs` against row `at`) → `{ doneToday, progressLabel: null, score: null }` — and spec §9 row 8: a same-surface same-learner same-day row WITHOUT programId is ignored.
- `DoNowSchoolBridge`: subscribes `eventBus` topic `donow`; on `{type:'donow.dispatched', requestedBy:'school-scan', ref}` → `sessions.readEvents(ref)` resolves to a session at `created` owned by this store (repository lookup, never shape matching) → append `launch_dispatched` + honor-close. Anything else ignored.
- [ ] **Step 1: Failing tests** per behavior including §9 rows 6-8 and the pending-then-approve bridge path (fake bus: emit donow.dispatched, assert events + close). Run the full application/school + e2e/school dirs — the shipped agenda-v2 suites must stay green.
- [ ] **Steps 2-4. Step 5: Commit** (`feat(school): launch routing through DoNow, surface programs, dispatched bridge`).

---

### Task 13: Composition + app wiring + config + docs alignment

**Files:**
- Create: `backend/src/5_composition/modules/donow.mjs`
- Modify: `backend/src/app.mjs` (mount donow after the seams it wraps exist; pass into school lifecycle)
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` (surfaces for validation, donow dep, SurfaceProgramLauncher registration from `school.yml` `programs:`, bridge start)
- Modify: `docs/superpowers/specs/2026-07-29-school-agenda-v2-design.md` + `docs/reference/school/README.md` (the closed-set sentence refinement — spec §10 shipping note)
- Test: `tests/isolated/composition/donowWiring.test.mjs` (the schoolLifecycleWiring.test.mjs pattern — read it)

**Wiring facts:** `WakeAndLoadService`/`SendHubCommand`/`CallHomeAssistantService`/`eventBus`/`thermalPrinterRegistry` all already exist in app.mjs — grep each for the construction site and inject; config knobs under a new `donow:` block in system/household config read via configService (`approvalsToken`, `notifyService`, `pianoKioskDeviceParam`, `livingroomDeviceId` default `livingroom-tv`); school.yml `programs:` list → SurfaceProgramLauncher instances merged into the launchers Map with the collision-is-boot-error check. Fail-closed: no eventBus/no seams → the affected adapters degrade (occupancy unknown / dispatch failed), service still constructs; donow router mounts only when the service exists.

- [ ] **Step 1: Failing wiring test**: composition with fakes exposes service + router + all seven surfaces; program config collision with 'language' throws at boot; missing optional seams degrade rather than throw.
- [ ] **Steps 2-4**: `node --check backend/src/app.mjs`; run tests/isolated/composition/ + application/donow + application/school. Docs edits per the shipping note (both files, one sentence each + the new layer-table rows in the README for donow files).
- [ ] **Step 5: Commit** (`feat(donow): composition + app wiring + config + docs alignment`).

---

### Task 14: End-to-end proof + full gate

**Files:**
- Create: `tests/isolated/e2e/donow/launchJourney.e2e.test.mjs` (harness: extend `tests/_lib/school/lifecycleHarness.mjs` with a donow module the way Task 14 of the prior wave added languageStudyService — read the harness first)
- Test: the whole affected tree.

- [ ] **Step 1: The journey test**: seed a `launch:` unit (garage-fitness, fake adapter wired occupied-by-other) + a `pe-daily` surface program; (a) tap → agenda shows the launch unit's subject with a QR; (b) scan → `pending_approval`, slip printed, exactly ONE notification (fake notifier); (c) re-scan → same approvalId, still one notification (§9 row 7); (d) approve → fake adapter dispatched, bridge closed the session (passed outcome, `reason: launch_dispatched`), subject serves today; (e) scan the pe-daily program subject with the garage idle → dispatched immediately, dispatch log row carries programId, `status()` reports doneToday, next tap shows done-today; (f) preview endpoint still dry (no new sessions/tokens after a preview mid-journey).
- [ ] **Step 2: Full gate** — run: `tests/isolated/domain/ tests/isolated/application/ tests/isolated/adapter/ tests/isolated/api/routers/donow.test.mjs tests/isolated/composition/ tests/isolated/e2e/ tests/isolated/rendering/school/ frontend/src/modules/School/ frontend/src/hooks/fitness/ frontend/src/modules/Piano/PianoKiosk/useKioskLaunchCommand.test.js` — everything green EXCEPT the known pre-existing baseline failures listed in Global Constraints (compare failing FILE list against that list; any new name = your regression). Capture the real exit code per directory group.
- [ ] **Step 3: Commit** (`feat(donow): e2e journey proof`).

---

## Self-review notes (applied)

- Spec coverage: preview §1-§7 → Tasks 1-2; DoNow §3 → Tasks 3/5; §4 (incl. dedup + approve table + TOCTOU-no-locks) → Tasks 4/5/6; §5+§5.1 → Tasks 7/8 (+9 for the two new reachabilities); §6 (two closed-set changes, surface programs, dispatch log semantics, ownership filter, nextMove arm) → Tasks 10/11/12 (+4 for the log); §7 API → Task 6; §8 errors → distributed through 5/6/8; §9 test rows 1-8 → named in Tasks 3/5/6/8/11/12/14; §10 shipping note → Task 13.
- The `launch` arm intentionally routes BOTH the subject QR and the per-unit select_unit token through one helper (Task 12) — composition-and-state routing, the agenda-v2 lesson.
- Type consistency: `dispatch()` result `{decision, approvalId?, message}` used identically in Tasks 5/6/12/14; presence `occupancy()` shape shared by Tasks 7/8; `sets.surfaceValidators` named once (Task 11) and supplied in Task 13.
