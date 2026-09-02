# NFC Learner-Card Intent Unification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a school learner card resolve to a normal NFC intent so it works at every reader — not only the one whose taps arrive over the WebSocket bus — and delete the policy `if` chain from the transport module.

**Architecture:** `school_learner` becomes an actionable field in `NfcResolver`, resolving to an action chosen by the reader location's new `learner_action` config key. A new `Response.learner` kind carries it through the existing `mapIntentToResponse` → `responseHandlers` pipeline to an injected registry of learner-action handlers. `nfcTapIngress.mjs` collapses to transport-only: canonicalize, map reader id to location, call `handleEvent`.

**Tech Stack:** Node ESM (`.mjs`), vitest, js-yaml. Backend DDD layers: `1_adapters` (parsers) → `2_domains/trigger` (resolver, Response) → `3_applications/trigger` (mapping, handlers) → `5_composition` (wiring).

**Read first:** `docs/reference/trigger/schema.md`, `docs/reference/trigger-endpoint.md`, and the header comment of `backend/src/5_composition/modules/nfcTapIngress.mjs` (it states the intended design this plan finally implements).

**Run one test file with:** `npx vitest run <path> --reporter=dot` — do NOT use `npm run test:isolated --only=domain`, which routes vitest files to Jest and fails to load them.

---

### Task 1: `learner_action` becomes a reserved location key

The parser currently sweeps every unrecognised key into `defaults`, which inherit into every tag scanned at that reader. `learner_action` must be first-class instead, or it would leak into the load-query string of every book tap at that reader.

**Files:**
- Modify: `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs:18` (the `RESERVED` set) and `:59-67` (the output object)
- Test: `tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs`

**Step 1: Write the failing test**

Append to the existing describe block:

```js
it('extracts learner_action as first-class config, not a tag default', () => {
  const out = parseNfcLocations({
    livingroom: { target: 'livingroom-tv', action: 'play-next', learner_action: 'reading-session' },
  });
  expect(out.livingroom.learner_action).toBe('reading-session');
  expect(out.livingroom.defaults).not.toHaveProperty('learner_action');
});

it('defaults learner_action to null when the location does not declare one', () => {
  const out = parseNfcLocations({ office: { target: 'office-tv' } });
  expect(out.office.learner_action).toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs --reporter=dot`
Expected: FAIL — `expected undefined to be 'reading-session'`

**Step 3: Write minimal implementation**

In `nfcLocationsParser.mjs`, extend the reserved set:

```js
const RESERVED = new Set(['target', 'action', 'auth_token', 'notify_unknown', 'end', 'end_location', 'learner_action']);
```

and add one line to the output object, after `action`:

```js
    out[locationId] = {
      target: locConfig.target,
      action: locConfig.action ?? null,
      // What a SCHOOL LEARNER CARD means at this reader. The card names the
      // person; the reader decides what happens to them — print an agenda in
      // the study, open a reading session in the living room. Null means a
      // learner card is simply not actionable here, which resolves to the
      // ordinary unknown-tag capture rather than a silent wrong action.
      learner_action: locConfig.learner_action ?? null,
      auth_token: locConfig.auth_token ?? null,
      notify_unknown: locConfig.notify_unknown ?? null,
      end: locConfig.end ?? null,
      end_location: locConfig.end_location ?? null,
      defaults,
    };
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs --reporter=dot`
Expected: PASS (all pre-existing tests still green)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs
git commit -m "feat(trigger): learner_action as a first-class NFC reader key"
```

---

### Task 2: `NfcResolver` resolves a learner card to an intent

**Files:**
- Modify: `backend/src/2_domains/trigger/services/NfcResolver.mjs` — `RESERVED_KEYS` (`:27`), the intent build (`:126-145`)
- Test: `tests/isolated/domain/trigger/services/NfcResolver.test.mjs`

**Step 1: Write the failing test**

```js
describe('school learner cards', () => {
  const registry = {
    locations: {
      study: { target: 'portal', action: 'play-next', learner_action: 'print-agenda', defaults: {} },
      livingroom: { target: 'livingroom-tv', action: 'play-next', learner_action: 'reading-session', defaults: {} },
      office: { target: 'office-tv', action: 'play-next', learner_action: null, defaults: {} },
    },
    tags: {
      '048ba600cc2a81': { global: { note: 'User_4 personal card (red)', school_learner: 'user_4' }, overrides: {} },
    },
  };

  it('resolves to the reader location learner_action, carrying the learner', () => {
    const intent = NfcResolver.resolve({
      location: 'study', value: '04:8B:A6:00:CC:2A:81', registry,
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent).toMatchObject({ action: 'print-agenda', learnerId: 'user_4' });
  });

  it('gives the SAME card a different action at a different reader', () => {
    const intent = NfcResolver.resolve({
      location: 'livingroom', value: '048ba600cc2a81', registry,
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent.action).toBe('reading-session');
    expect(intent.learnerId).toBe('user_4');
  });

  it('resolves to null at a reader that declares no learner_action', () => {
    expect(NfcResolver.resolve({
      location: 'office', value: '048ba600cc2a81', registry,
      contentIdResolver: makeContentIdResolver(),
    })).toBeNull();
  });

  it('never leaks school_learner into params', () => {
    const intent = NfcResolver.resolve({
      location: 'study', value: '048ba600cc2a81', registry,
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent.params).not.toHaveProperty('school_learner');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/trigger/services/NfcResolver.test.mjs --reporter=dot`
Expected: FAIL — `expected null to match object` (a learner card currently has no actionable field, so it resolves to null)

**Step 3: Write minimal implementation**

Add to `RESERVED_KEYS` (so it never reaches `params`, and never becomes a shorthand candidate):

```js
const RESERVED_KEYS = new Set([
  'action', 'target', 'content',
  'scene', 'service', 'entity', 'data',
  'end', 'end_location', 'endpoint',
  // A learner card names a PERSON. It is actionable, but its action comes
  // from the reader location (`learner_action`), never from the tag — the
  // same card must be able to mean "print my agenda" in the study and
  // "start my reading session" in the living room.
  'school_learner',
]);
```

Then, in `resolve`, immediately after `const merged = {...}` and the `action`/`target` chain, insert the learner branch **before** content resolution (a learner card has no content and must not fall into shorthand expansion):

```js
    // A learner card resolves against the READER, not the tag. No
    // learner_action at this reader means the card is not actionable here,
    // and a null intent routes it into the ordinary unknown-tag capture —
    // which is the honest answer, and lets a mis-tapped card be noticed.
    const schoolLearner = merged.school_learner;
    if (schoolLearner !== undefined && schoolLearner !== null) {
      const learnerAction = locationConfig.learner_action;
      if (!learnerAction) return null;
      return { action: learnerAction, target, learnerId: String(schoolLearner), params: {} };
    }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/trigger/services/NfcResolver.test.mjs --reporter=dot`
Expected: PASS. Also run the sibling suites — they exercise the same resolver:

```bash
npx vitest run tests/isolated/domain/trigger/ tests/isolated/adapter/trigger/ --reporter=dot
```

**Step 5: Commit**

```bash
git add backend/src/2_domains/trigger/services/NfcResolver.mjs tests/isolated/domain/trigger/services/NfcResolver.test.mjs
git commit -m "feat(trigger): resolve school learner cards to a per-reader intent"
```

---

### Task 3: `Response.learner` value object

**Files:**
- Modify: `backend/src/2_domains/trigger/Response.mjs`
- Test: `tests/isolated/domain/trigger/Response.test.mjs` (create if absent)

**Step 1: Write the failing test**

```js
import { Response } from '#domains/trigger/Response.mjs';
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

describe('Response.learner', () => {
  it('freezes a learner response carrying op, learner and location', () => {
    const r = Response.learner({ op: 'print-agenda', learnerId: 'user_4', location: 'study', target: 'portal' });
    expect(r).toMatchObject({ kind: 'learner', op: 'print-agenda', learnerId: 'user_4', location: 'study' });
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('refuses a learner response with no learnerId', () => {
    expect(() => Response.learner({ op: 'print-agenda' })).toThrow(ValidationError);
  });

  it('refuses a learner response with no op', () => {
    expect(() => Response.learner({ learnerId: 'user_4' })).toThrow(ValidationError);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/trigger/Response.test.mjs --reporter=dot`
Expected: FAIL — `Response.learner is not a function`

**Step 3: Write minimal implementation**

Add to the `Response` object in `Response.mjs`, after `script`:

```js
  /**
   * A tap that named a PERSON rather than a piece of content. `op` is the
   * reader location's `learner_action`; what it does is the injected
   * learner-action registry's business, not this layer's.
   *
   * @param {{op:string, learnerId:string, location?:string, target?:string}} a
   */
  learner({ op, learnerId, location, target } = {}) {
    if (!op) throw new ValidationError('Response.learner op required', { code: 'RESPONSE_LEARNER_OP' });
    if (!learnerId) throw new ValidationError('Response.learner learnerId required', { code: 'RESPONSE_LEARNER_ID' });
    return Object.freeze({ kind: 'learner', op, learnerId, location, target });
  },
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/trigger/Response.test.mjs --reporter=dot`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/trigger/Response.mjs tests/isolated/domain/trigger/Response.test.mjs
git commit -m "feat(trigger): Response.learner kind"
```

---

### Task 4: Map a learner intent to a learner Response

**Files:**
- Modify: `backend/src/3_applications/trigger/mapIntentToResponse.mjs`
- Test: `tests/isolated/application/trigger/mapIntentToResponse.test.mjs` (create if absent)

**Step 1: Write the failing test**

```js
import { mapIntentToResponse } from '#apps/trigger/mapIntentToResponse.mjs';

it('maps any intent carrying a learnerId to a learner Response', () => {
  const r = mapIntentToResponse({ action: 'print-agenda', learnerId: 'user_2', target: 'portal', params: {} });
  expect(r).toMatchObject({ kind: 'learner', op: 'print-agenda', learnerId: 'user_2' });
});

it('maps a reading-session intent the same way — the op is not enumerated here', () => {
  const r = mapIntentToResponse({ action: 'reading-session', learnerId: 'user_5', target: 'livingroom-tv', params: {} });
  expect(r).toMatchObject({ kind: 'learner', op: 'reading-session', learnerId: 'user_5' });
});

it('still maps content actions unchanged', () => {
  const r = mapIntentToResponse({ action: 'play-next', target: 'livingroom-tv', content: 'plex:620681', params: {} });
  expect(r.kind).toBe('content');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/trigger/mapIntentToResponse.test.mjs --reporter=dot`
Expected: FAIL — `UnknownActionError: mapIntentToResponse: unknown action "print-agenda"`

**Step 3: Write minimal implementation**

In `mapIntentToResponse`, add the learner branch **first**, before `CONTENT_ACTIONS`. Discriminating on the presence of `learnerId` rather than on an enumerated action list is deliberate: adding a new learner action must be a config + handler change, never an edit here.

```js
export function mapIntentToResponse(intent, { posture = 'authoritative' } = {}) {
  if (!intent) return null;
  const { action } = intent;

  // Discriminated by the PAYLOAD, not by an action allow-list: a new learner
  // action (`reading-session`, whatever comes next) must be a config key plus
  // a registered handler, never an edit to this mapper.
  if (intent.learnerId) {
    return Response.learner({
      op: action, learnerId: intent.learnerId, location: intent.location, target: intent.target,
    });
  }

  if (CONTENT_ACTIONS.has(action)) {
  // ... unchanged
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/trigger/ --reporter=dot`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/mapIntentToResponse.mjs tests/isolated/application/trigger/mapIntentToResponse.test.mjs
git commit -m "feat(trigger): map learner intents to Response.learner"
```

---

### Task 5: The `learner` response handler and its action registry

**Files:**
- Create: `backend/src/3_applications/trigger/learnerActions.mjs`
- Modify: `backend/src/3_applications/trigger/responseHandlers.mjs`
- Test: `tests/isolated/application/trigger/learnerActions.test.mjs`

**Step 1: Write the failing test**

```js
import { createLearnerActions } from '#apps/trigger/learnerActions.mjs';
import { responseHandlers } from '#apps/trigger/responseHandlers.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

it('routes a registered op to its handler with the learner and location', async () => {
  const seen = [];
  const learnerActions = createLearnerActions({ logger: silent });
  learnerActions.register('print-agenda', async ({ learnerId, location }) => {
    seen.push({ learnerId, location });
    return { status: 'agenda_printed' };
  });
  const result = await responseHandlers.learner(
    { kind: 'learner', op: 'print-agenda', learnerId: 'user_4', location: 'study' },
    { learnerActions, logger: silent },
  );
  expect(seen).toEqual([{ learnerId: 'user_4', location: 'study' }]);
  expect(result.status).toBe('agenda_printed');
});

it('refuses an unregistered op by NAME rather than falling back to another handler', async () => {
  const learnerActions = createLearnerActions({ logger: silent });
  learnerActions.register('print-agenda', async () => ({ status: 'agenda_printed' }));
  const result = await responseHandlers.learner(
    { kind: 'learner', op: 'reading-session', learnerId: 'user_5', location: 'livingroom' },
    { learnerActions, logger: silent },
  );
  expect(result).toMatchObject({ status: 'no_handler', op: 'reading-session' });
});

it('never rejects when a handler throws', async () => {
  const learnerActions = createLearnerActions({ logger: silent });
  learnerActions.register('boom', async () => { throw new Error('printer on fire'); });
  const result = await responseHandlers.learner(
    { kind: 'learner', op: 'boom', learnerId: 'user_2', location: 'study' },
    { learnerActions, logger: silent },
  );
  expect(result).toMatchObject({ status: 'failed' });
  expect(result.error).toContain('printer on fire');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/trigger/learnerActions.test.mjs --reporter=dot`
Expected: FAIL — cannot resolve `#apps/trigger/learnerActions.mjs`

**Step 3: Write minimal implementation**

Create `backend/src/3_applications/trigger/learnerActions.mjs`:

```js
/**
 * learnerActions — what a school learner card DOES, keyed by the reader
 * location's `learner_action`.
 *
 * Layer: APPLICATION (3_applications/trigger). A registry, not a policy: it
 * knows the op names and nothing about School, so the trigger pipeline stays
 * free of a domain dependency and School registers itself at composition.
 *
 * AN UNREGISTERED OP IS A NAMED REFUSAL, NEVER A FALLBACK. If `reading-session`
 * has no handler yet, the tap must say so — not quietly run `print-agenda`
 * because it happens to be the only learner action wired. A preschooler tapping
 * their card in the living room and hearing a printer start up two rooms away
 * is worse than nothing happening.
 *
 * @module applications/trigger/learnerActions
 */
export function createLearnerActions({ logger = console } = {}) {
  const handlers = new Map();
  return {
    register(op, handler) {
      if (!op || typeof handler !== 'function') throw new Error('learnerActions.register requires an op and a function');
      if (handlers.has(op)) throw new Error(`learnerActions: duplicate handler for '${op}'`);
      handlers.set(op, handler);
      logger.debug?.('trigger.learner.registered', { op });
    },
    has(op) { return handlers.has(op); },
    list() { return [...handlers.keys()]; },
    get(op) { return handlers.get(op) ?? null; },
  };
}

export default createLearnerActions;
```

Add the handler to `responseHandlers.mjs`, after `script`:

```js
  // A tap that named a person. Never rejects: a card tap that throws must
  // still answer the dispatcher, or a child gets silence and taps harder.
  learner: async (response, deps) => {
    const handler = deps.learnerActions?.get?.(response.op) ?? null;
    if (!handler) {
      deps.logger?.warn?.('trigger.learner.no_handler', {
        op: response.op, learnerId: response.learnerId, location: response.location,
      });
      return { status: 'no_handler', op: response.op, learnerId: response.learnerId };
    }
    try {
      const result = await handler({
        learnerId: response.learnerId, location: response.location, target: response.target,
      });
      deps.logger?.info?.('trigger.learner.dispatched', {
        op: response.op, learnerId: response.learnerId, location: response.location, status: result?.status ?? null,
      });
      return result ?? { status: 'ok' };
    } catch (err) {
      deps.logger?.error?.('trigger.learner.failed', {
        op: response.op, learnerId: response.learnerId, location: response.location, error: err.message,
      });
      return { status: 'failed', op: response.op, error: err.message };
    }
  },
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/trigger/ --reporter=dot`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/learnerActions.mjs backend/src/3_applications/trigger/responseHandlers.mjs tests/isolated/application/trigger/learnerActions.test.mjs
git commit -m "feat(trigger): learner response handler with a named-refusal registry"
```

---

### Task 6: Wire the registry into composition and register `print-agenda`

`schoolLifecycle` is composed at `backend/src/app.mjs:3383`, well before `createTriggerApiRouter` at `:4025`, so `resolvePersonalCard` can be injected directly — no late binding needed.

**Files:**
- Modify: `backend/src/5_composition/modules/triggerApi.mjs` (accept `learnerActions`, pass into `TriggerDispatchService` deps)
- Modify: `backend/src/app.mjs:4025-4040`
- Test: `tests/isolated/composition/triggerLearnerActions.test.mjs`

**Step 1: Write the failing test**

```js
import { createLearnerActions } from '#apps/trigger/learnerActions.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

it('print-agenda calls ResolvePersonalCard and reports its status', async () => {
  const calls = [];
  const resolvePersonalCard = {
    execute: async ({ learnerId }) => { calls.push(learnerId); return { status: 'agenda_printed', printed: true }; },
  };
  const learnerActions = createLearnerActions({ logger: silent });
  learnerActions.register('print-agenda', async ({ learnerId }) => resolvePersonalCard.execute({ learnerId }));

  const result = await learnerActions.get('print-agenda')({ learnerId: 'user_2', location: 'study' });
  expect(calls).toEqual(['user_2']);
  expect(result.status).toBe('agenda_printed');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/composition/triggerLearnerActions.test.mjs --reporter=dot`
Expected: PASS trivially at first (it exercises the registry only). This test is the contract pin; the wiring below is verified by Task 9's end-to-end check.

**Step 3: Write the implementation**

In `triggerApi.mjs`, accept `learnerActions` in `createTriggerApiRouter(config)` and include it in the deps object handed to `new TriggerDispatchService({...})` (the same object `responseHandlers` receives as `deps`).

In `app.mjs`, immediately before the `createTriggerApiRouter` call at `:4025`:

```js
  // What a school learner card DOES, per reader. Registered here rather than
  // inside the trigger module so the trigger pipeline keeps no School import.
  // `reading-session` is deliberately NOT registered yet — see plan 03. Until
  // it is, a card tapped in the living room answers `no_handler` and says so,
  // rather than printing an agenda in the study.
  const { createLearnerActions } = await import('#apps/trigger/learnerActions.mjs');
  const learnerActions = createLearnerActions({ logger: rootLogger.child({ module: 'trigger-learner' }) });
  if (schoolLifecycle.useCases?.resolvePersonalCard) {
    learnerActions.register('print-agenda', ({ learnerId }) =>
      schoolLifecycle.useCases.resolvePersonalCard.execute({ learnerId }));
  } else {
    rootLogger.warn?.('trigger.learner.school-unwired', { reason: 'no resolvePersonalCard' });
  }
```

and add `learnerActions,` to the `createTriggerApiRouter({ ... })` argument object.

**Step 4: Verify the app still boots**

Run: `npm run check:parse`
Expected: PASS. Do **not** start a second backend to test this — see `CLAUDE.local.md`; `node backend/index.js` is a live household controller and a second instance makes real Home Assistant calls.

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/triggerApi.mjs backend/src/app.mjs tests/isolated/composition/triggerLearnerActions.test.mjs
git commit -m "feat(trigger): register print-agenda as a learner action at composition"
```

---

### Task 7: Declare `learner_action` per reader

**Files:**
- Modify: `$DAYLIGHT_BASE_PATH/data/household/triggers/sources.yml`

**Step 1: Read the current file**

```bash
cat "$DAYLIGHT_BASE_PATH/data/household/triggers/sources.yml"
```

**Step 2: Add `learner_action` to each NFC source**

```yaml
livingroom:
  modality: nfc
  target: livingroom-tv
  action: play-next
  end: tv-off
  end_location: living_room
  notify_unknown: mobile_app_kc_phone
  # A learner card here opens that child's reading session on the TV.
  # No handler is registered until plan 03 ships; until then a tap answers
  # `no_handler` and is acknowledged rather than doing something else.
  learner_action: reading-session
```

The study reader's source is **not** in `sources.yml` today — its taps arrive on the bus and `nfcTapIngress` supplies the location from `school.lifecycle.nfcLocation`. Task 8 changes that. Add its source entry now:

```yaml
study:
  modality: nfc
  target: portal
  action: play-next
  learner_action: print-agenda
```

**Step 3: Verify the config parses**

```bash
node -e "const y=require('js-yaml');const fs=require('fs');console.log(Object.keys(y.load(fs.readFileSync(process.env.DAYLIGHT_BASE_PATH+'/data/household/triggers/sources.yml','utf8'))))"
```
Expected: lists `livingroom`, `livingroom-state`, `ds2278`, `study`

**Step 4: Note the deploy hazard**

The data tree is Dropbox-synced and shared with prod (see memory `reference_shared_dropbox_data_tree_deploy_hazard`): **this config edit goes live on prod before the code does.** A `learner_action` key on a backend that has not yet shipped Task 1 lands in `defaults` and would be forwarded into the load query of every book tap at that reader. So **deploy the code first, then edit the YAML** — or make this edit only after Tasks 1–6 are deployed.

**Step 5: Commit**

Config lives outside the repo; nothing to commit. Record the change in the deploy notes for this branch.

---

### Task 8: Collapse `nfcTapIngress` to transport-only

**Files:**
- Modify: `backend/src/5_composition/modules/nfcTapIngress.mjs`
- Modify: `backend/src/app.mjs:4088-4100` (the wiring)
- Test: `tests/isolated/composition/nfcTapIngress.test.mjs`, `backend/src/5_composition/modules/nfcTapIngress.shutdown.test.mjs`

**Step 1: Write the failing test**

Replace the school-branch assertions in `nfcTapIngress.test.mjs` with transport assertions:

```js
it('hands a learner card to the trigger pipeline like any other tag', async () => {
  const handled = [];
  const ingress = createNfcTapIngress({
    eventBus: { subscribe: () => () => {} },
    readerLocations: { 'study-omr': 'study' },
    triggerDispatchService: { handleEvent: async (e) => { handled.push(e); return { ok: true }; } },
    logger: silent,
  });
  await ingress.handleTap({ uid: '04:8B:A6:00:CC:2A:81', id: 'study-omr' });
  expect(handled).toEqual([{ location: 'study', source: 'nfc', value: '048ba600cc2a81' }]);
});

it('maps each reader id to its own location', async () => {
  const handled = [];
  const ingress = createNfcTapIngress({
    eventBus: { subscribe: () => () => {} },
    readerLocations: { 'study-omr': 'study', 'livingroom-nfc': 'livingroom' },
    triggerDispatchService: { handleEvent: async (e) => { handled.push(e.location); return { ok: true }; } },
    logger: silent,
  });
  await ingress.handleTap({ uid: 'deadbeef', id: 'livingroom-nfc' });
  expect(handled).toEqual(['livingroom']);
});

it('reports an unmapped reader rather than guessing a location', async () => {
  const ingress = createNfcTapIngress({
    eventBus: { subscribe: () => () => {} },
    readerLocations: { 'study-omr': 'study' },
    triggerDispatchService: { handleEvent: async () => ({ ok: true }) },
    logger: silent,
  });
  expect(await ingress.handleTap({ uid: 'deadbeef', id: 'unknown-reader' })).toMatchObject({ status: 'unmapped_reader' });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/composition/nfcTapIngress.test.mjs --reporter=dot`
Expected: FAIL — the module still takes a single `location` and still forks on `school_learner`

**Step 3: Write the implementation**

Rewrite `handleTap` in `nfcTapIngress.mjs`. Delete the `SCHOOL_LEARNER_FIELD` constant, the `triggerConfig`/`resolvePersonalCard` deps, the learner branch, and the `agenda-suppressed` broadcast (that acknowledgement moves to the `print-agenda` learner action in Task 9). **Keep the shutdown pre-check** — see the note below. Replace the `location` param with `readerLocations`:

```js
/**
 * nfcTapIngress — TRANSPORT ONLY. Turns an NFC tap arriving on a hardware-relay
 * bus topic into a trigger event and hands it to the one pipeline every other
 * reader in the house already uses.
 *
 * It used to hold the "who owns this tag" decision as an if-chain, which meant
 * a learner card worked at exactly one reader in the house — the only one whose
 * taps arrive over this bus. That decision now lives where both ingress doors
 * already converge: `school_learner` is an actionable field in `NfcResolver`,
 * and the reader location's `learner_action` decides what it means.
 *
 * THE SHUTDOWN TAG IS THE ONE EXCEPTION AND IT STAYS. Its UID lives in
 * `shutdown.yml` rather than the tag registry, it is a household safety command
 * rather than a media or identity tag, and it must outrank everything. Moving it
 * into the registry is a config migration on a safety path — separate work,
 * deliberately not taken here.
 */
async function handleTap({ uid, id = null } = {}) {
  const canonical = canonicalizeNfcUid(uid);
  if (!canonical) {
    logger.warn?.('nfc.tap.no_uid', { reader: id });
    return { status: 'no_uid' };
  }

  const shutdown = getShutdownConfig?.() ?? null;
  const shutdownUid = typeof shutdown?.nfc?.tag_uid === 'string' ? canonicalizeNfcUid(shutdown.nfc.tag_uid) : null;
  const shutdownReaderId = shutdown?.nfc?.reader_id ?? null;
  if (shutdownService?.activate && shutdownUid === canonical && (!shutdownReaderId || shutdownReaderId === id)) {
    const state = await shutdownService.activate({ readerId: id, tagUid: canonical });
    logger.info?.('nfc.tap.shutdown', { reader: id, uid: canonical, lockedUntil: state.lockedUntil });
    return { status: 'shutdown_locked', lockedUntil: state.lockedUntil };
  }

  const location = readerLocations?.[id] ?? null;
  if (!triggerDispatchService?.handleEvent || !location) {
    logger.warn?.('nfc.tap.unmapped_reader', { reader: id, uid: canonical, known: Object.keys(readerLocations ?? {}) });
    return { status: 'unmapped_reader', reader: id };
  }
  const outcome = await triggerDispatchService.handleEvent({ location, source: 'nfc', value: canonical });
  logger.info?.('nfc.tap.trigger', { reader: id, uid: canonical, location, ok: outcome?.ok, code: outcome?.code ?? null });
  return { status: outcome?.ok ? 'triggered' : (outcome?.code ?? 'trigger_failed') };
}
```

Update the factory signature: replace `triggerConfig`, `resolvePersonalCard`, `location` with `readerLocations = {}`.

In `app.mjs`, update the call site:

```js
  const nfcTapIngress = createNfcTapIngress({
    eventBus,
    topics: ['omr'],
    triggerDispatchService,
    shutdownService,
    getShutdownConfig: readShutdownConfig,
    // Reader id -> trigger location. Was a single global `location`, which
    // assumed every bus reader was in one room.
    readerLocations: configService.getHouseholdAppConfig?.(householdId, 'school')?.lifecycle?.nfcReaderLocations
      ?? { 'study-omr': 'study' },
    logger: rootLogger.child({ module: 'nfc-tap' }),
  });
```

**Step 4: Run tests**

```bash
npx vitest run tests/isolated/composition/ backend/src/5_composition/modules/nfcTapIngress.shutdown.test.mjs --reporter=dot
npm run check:parse
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/nfcTapIngress.mjs backend/src/app.mjs tests/isolated/composition/nfcTapIngress.test.mjs
git commit -m "refactor(nfc): nfcTapIngress becomes transport-only; one fork for both doors"
```

---

### Task 9: Preserve the cooldown acknowledgement

`nfcTapIngress` used to broadcast `agenda-suppressed` on the `omr` topic when a repeat tap fell inside the print cooldown — the only feedback a child gets for a tap that produces no paper (`useScanCeremony.js` renders it). Task 8 deleted that broadcast. It must reappear in the `print-agenda` learner action or the acknowledgement is silently lost.

**Files:**
- Modify: `backend/src/app.mjs` (the `print-agenda` registration from Task 6)
- Test: `tests/isolated/composition/triggerLearnerActions.test.mjs`

**Step 1: Write the failing test**

```js
it('broadcasts agenda-suppressed so a cooldown tap is still acknowledged on screen', async () => {
  const broadcasts = [];
  const eventBus = { broadcast: (topic, payload) => broadcasts.push({ topic, payload }) };
  const resolvePersonalCard = {
    execute: async () => ({ status: 'agenda_suppressed', sinceMinutes: 3, cooldownMinutes: 15 }),
  };
  const handler = makePrintAgendaHandler({ resolvePersonalCard, eventBus });
  await handler({ learnerId: 'user_3', location: 'study' });
  expect(broadcasts).toEqual([{
    topic: 'omr',
    payload: expect.objectContaining({ event: 'agenda-suppressed', learnerId: 'user_3', sinceMinutes: 3, cooldownMinutes: 15 }),
  }]);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/composition/triggerLearnerActions.test.mjs --reporter=dot`
Expected: FAIL — `makePrintAgendaHandler is not defined`

**Step 3: Write the implementation**

Extract the handler into `backend/src/5_composition/modules/learnerCardActions.mjs` so it is testable without booting `app.mjs`:

```js
/**
 * The `print-agenda` learner action: School's ResolvePersonalCard, plus the
 * on-screen acknowledgement a cooldown-suppressed tap depends on.
 *
 * THE BROADCAST IS NOT OPTIONAL. A repeat tap inside the print cooldown gets no
 * paper, and this is that tap's ONLY feedback — without it a child who taps and
 * gets nothing just taps harder, which is the exact behaviour the cooldown
 * exists to stop. It rides the `omr` topic because `useScanCeremony.js` already
 * subscribes there; no new transport.
 */
export function makePrintAgendaHandler({ resolvePersonalCard, eventBus, logger = console }) {
  return async ({ learnerId, location }) => {
    const result = await resolvePersonalCard.execute({ learnerId });
    logger.info?.('nfc.tap.school_card', {
      location, learnerId, status: result?.status, printed: result?.printed,
    });
    if (result?.status === 'agenda_suppressed') {
      eventBus?.broadcast?.('omr', {
        event: 'agenda-suppressed',
        learnerId,
        sinceMinutes: result.sinceMinutes ?? null,
        cooldownMinutes: result.cooldownMinutes ?? null,
        timestamp: Date.now(),
      });
    }
    return result ?? { status: 'unknown' };
  };
}
```

Use it in `app.mjs`'s registration instead of the inline arrow.

**Step 4: Run tests**

```bash
npx vitest run tests/isolated/composition/ --reporter=dot
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/learnerCardActions.mjs backend/src/app.mjs tests/isolated/composition/triggerLearnerActions.test.mjs
git commit -m "fix(school): keep the cooldown acknowledgement when the fork moved"
```

---

### Task 10: Register the unregistered living-room book tag

A real tap on 2026-08-26 at 16:48:07Z resolved `trigger-not-registered` for uid `04ffca71cc2a81` (a Dr. Seuss book). It is already in the observed registry (`state/nfc.observed.yml`, first seen 2026-05-10).

**Files:**
- Modify: `$DAYLIGHT_BASE_PATH/data/household/triggers/bindings/nfc/books.yml`

**Step 1: Find the Plex rating key for the book**

```bash
TOKEN=$(node -e "const y=require('js-yaml'),fs=require('fs');console.log(y.load(fs.readFileSync(process.env.DAYLIGHT_BASE_PATH+'/data/household/auth/plex.yml','utf8')).token)")
curl -s -H "Accept: application/json" "https://plex.kckern.net/search?query=<title>&X-Plex-Token=$TOKEN" | jq -r '.MediaContainer.Metadata[] | "\(.ratingKey) \(.title)"'
```

**Step 2: Add the tag**

Keys stay quoted where a separator-free hex uid is valid YAML scientific notation — see the file's own header. `04ffca71cc2a81` is safe unquoted, but match the file's surrounding style.

```yaml
04ffca71cc2a81:
  note: <book title>
  plex: <ratingKey>
```

**Step 3: Verify**

```bash
node -e "const y=require('js-yaml'),fs=require('fs');const t=y.load(fs.readFileSync(process.env.DAYLIGHT_BASE_PATH+'/data/household/triggers/bindings/nfc/books.yml','utf8'));console.log(t['04ffca71cc2a81'])"
```
Expected: the note and plex key

**Step 4: Restart is required**

Trigger config is boot-cached. The tag will not resolve until the container restarts.

---

### Task 11: Update the docs

**Files:**
- Modify: `docs/reference/trigger/schema.md` — document `learner_action` under the reserved fields of `nfc/locations.yml`, and add a "Learner cards" section explaining that `school_learner` is actionable and reader-scoped
- Modify: `docs/reference/school/README.md` — the personal-card section now points at the trigger pipeline rather than at `nfcTapIngress`
- Modify: `docs/docs-last-updated.txt` — `git rev-parse HEAD > docs/docs-last-updated.txt`

**Commit**

```bash
git add docs/
git commit -m "docs(trigger): learner_action and reader-scoped learner cards"
```

---

## Acceptance

After this plan, with `reading-session` deliberately unregistered:

| Tap | Reader | Result |
|---|---|---|
| User_2's card | study | agenda prints (unchanged behaviour) |
| User_2's card, twice inside 15min | study | second tap: no paper, `agenda-suppressed` ceremony on the panel (unchanged) |
| User_5's card | livingroom | resolves to `reading-session`, answers `no_handler`, logs `trigger.learner.no_handler` — **does not print in the study** |
| A registered book | livingroom | plays on the TV (unchanged) |
| `04ffca71cc2a81` | livingroom | plays, once Task 10 lands and the container restarts |
| An unknown tag | livingroom | observed-registry write + phone push (unchanged) |
