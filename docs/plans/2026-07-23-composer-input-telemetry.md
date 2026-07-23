# Composer Input Telemetry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture every numpad key, MIDI note, and toolbar tap in the Composer mode, plus the model edit each one produced, buffered so it costs no frames on the SM-T590, persisted to `media/logs/piano-composer/{ts}.events` (+ sibling `.jsonl`) and replayable as one interleaved input+edit stream.

**Architecture:** Reuse the merged SheetMusic input-telemetry infra (`frontend/src/lib/logging/inputRecorder.js`, `decodeEvents.js`, `midiTap.js`, `gestureCoalescer.js`, backend `sessionEventsFile.mjs` + `channel:'input'` routing). Add two recorder kinds (`KEY`, `EDIT`) and a header wall-clock anchor, extract the config-gate/sender into a shared lib helper, then wire Composer's inputs and edits into the recorder and route Composer's existing rich semantic logging to a session file.

**Tech Stack:** Vanilla JS typed arrays, existing DaylightLogger WS transport, Vitest. React (Composer is `.jsx`).

**Design doc:** `docs/_wip/plans/2026-07-23-composer-input-telemetry.md`
**Reference implementation:** the SheetMusic sibling — `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (see `inputTelemetryEnabled`, `makeInputSender`, `tapIntent`, the lifecycle effect, and the MIDI `subscribeRaw` effect). Copy those patterns; do not reinvent them.

**Run a test:** `npx vitest run <path> --reporter=dot`
**Commit discipline:** isolated feature branch `feature/composer-input-telemetry`; commit per task.

---

## Task 1: Add KEY + EDIT recorder kinds (+ decoder cases)

**Files:** Modify `frontend/src/lib/logging/inputRecorder.js`; Modify `frontend/src/lib/logging/decodeEvents.js`; Test both `.test.js` / `.e2e.test.js`.

**Step 1: failing test** (append to `inputRecorder.e2e.test.js`) — PRODUCTION ORDER (intern AFTER buildHeader, the class of bug the SheetMusic BLOCKER was):

```js
it('decodes KEY and EDIT events interned after the header (production order)', () => {
  __resetRecorder();
  const header = buildHeader({ session: 's', score: 'x', ctx: {} });
  record(KIND.KEY, intern('Numpad5'), intern('duration'), 0, 0);
  record(KIND.EDIT, intern('insert-note'), 60, 3, intern('quarter'));
  const events = decodeEvents(header, [encodeBatch()]);
  expect(events[0]).toMatchObject({ event: 'key', code: 'Numpad5', intent: 'duration' });
  expect(events[1]).toMatchObject({ event: 'edit', editType: 'insert-note', note: 60, measure: 3, duration: 'quarter' });
});
```

**Step 2: run → FAIL** (`KIND.KEY` undefined; events decode as `unknown`).

**Step 3: implement.** In `inputRecorder.js` extend the frozen enum (append; ids 1–10 unchanged) and the name map:
```js
export const KIND = Object.freeze({
  MIDI_ON: 1, MIDI_OFF: 2, SUSTAIN: 3, CC: 4,
  TAP: 5, TOUCH_START: 6, TOUCH_MOVE: 7, TOUCH_END: 8,
  UI_INTENT: 9, RENDER: 10, KEY: 11, EDIT: 12,
});
const KIND_NAME = { /* …existing… */ 11: 'key', 12: 'edit' };
```
In `decodeEvents.js` add two cases to the switch in `decodeRow` (note `d` is `row[5]`):
```js
case 'key':
  return { t, event, code: internedString(strings, a), intent: internedString(strings, b) };
case 'edit':
  return { t, event, editType: internedString(strings, a), note: b, measure: c, duration: internedString(strings, row[5]) };
```

**Step 4: run → PASS.**  **Step 5: commit** `feat(composer): add KEY and EDIT recorder kinds`

---

## Task 2: Header wall-clock anchor (align .events with .jsonl)

**Files:** Modify `frontend/src/lib/logging/inputRecorder.js`; Test `inputRecorder.test.js`.

**Step 1: failing test:**
```js
it('header carries a t0 perf/wall anchor', () => {
  __resetRecorder();
  const h = buildHeader({ session: 's', score: 'x', ctx: { user: 'u' } });
  expect(h.ctx.user).toBe('u');            // existing ctx preserved
  expect(typeof h.ctx.t0.perf).toBe('number');
  expect(typeof h.ctx.t0.wall).toBe('number');
});
```

**Step 2: run → FAIL.**

**Step 3: implement** — in `buildHeader`, merge a `t0` into ctx (do NOT overwrite caller ctx):
```js
export function buildHeader({ session, score, ctx }) {
  const t0 = {
    perf: (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
    wall: Date.now(),
  };
  return { h: 1, session, score, ctx: { ...(ctx || {}), t0 }, kinds: { ...KIND_NAME }, strings: internList.slice() };
}
```
`Date.now()` here is off-hot-path (once per session start) — allowed. Do NOT touch `record()` (allocation guard).

**Step 4: run → PASS** (and confirm the hot-path allocation guard test still passes).  **Step 5: commit** `feat(logging): header wall-clock anchor for event/jsonl alignment`

---

## Task 3: Extract shared config gate + sender

**Files:** Create `frontend/src/lib/logging/inputTelemetryGate.js` + `.test.js`; Modify `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` to import from it (keep SheetMusic green).

**Step 1: failing test** (`inputTelemetryGate.test.js`):
```js
import { inputTelemetryEnabled, makeInputSender } from './inputTelemetryGate.js';
it('gate reads nested flag', () => {
  expect(inputTelemetryEnabled({ inputTelemetry: { enabled: true } })).toBe(true);
  expect(inputTelemetryEnabled({ composer: { inputTelemetry: { enabled: true } } })).toBe(true); // composer-nested
  expect(inputTelemetryEnabled({})).toBe(false);
  expect(inputTelemetryEnabled(null)).toBe(false);
});
it('sender tags the given app + input channel, one event per call', () => {
  const calls = []; const fakeLogger = { info: (e, d, o) => calls.push({ e, d, o }) };
  const send = makeInputSender('piano-composer', () => fakeLogger);
  send({ h: 1 }); send({ b: [] });
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ e: 'input.header', o: { context: { app: 'piano-composer', channel: 'input' } } });
  expect(calls[1].e).toBe('input.batch');
});
```

**Step 2: run → FAIL.**

**Step 3: implement** `inputTelemetryGate.js`:
```js
import getLogger from './Logger.js';
// Enabled when either the app-nested or top-level flag is set. `composer` and
// `sheetmusic` may each carry their own inputTelemetry block; fall back to a
// shared top-level one.
export function inputTelemetryEnabled(config) {
  return !!(config?.inputTelemetry?.enabled
    || config?.composer?.inputTelemetry?.enabled
    || config?.sheetmusic?.inputTelemetry?.enabled);
}
// One WS event per batch/header, tagged with the app + input channel (no sessionLog),
// so the backend routes it to {app}/{ts}.events. getLoggerFn is injectable for tests.
export function makeInputSender(app, getLoggerFn = getLogger) {
  return (payload) => getLoggerFn().info(payload.h ? 'input.header' : 'input.batch', payload, {
    context: { app, channel: 'input' },
  });
}
```
Then in `ScorePlayer.jsx`: delete its local `inputTelemetryEnabled` and `makeInputSender`, import both from the gate, and change its sender call to `makeInputSender('piano-sheetmusic')`. Run the FULL SheetMusic suite to prove no regression.

**Step 4:** `npx vitest run frontend/src/lib/logging/inputTelemetryGate.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic --reporter=dot` → all PASS.  **Step 5: commit** `refactor(logging): share input-telemetry gate + sender across modes`

---

## Task 4: Composer session-logged child (persist the semantic .jsonl)

**Files:** Modify `Composer.jsx`; Test `Composer.test.jsx`.

Composer.jsx line 39 creates `getLogger().child({ component: 'composer-mode' })` with no `app`/`sessionLog`. Change it to a session-logged child and thread it down so the whole existing `composer.*` stream persists to `media/logs/piano-composer/`.

**Step 1: failing test** — assert the mode's child logger context carries `{ app: 'piano-composer', sessionLog: true }` (spy on `getLogger().child`, as the SheetMusic Task-10 test does). FAILS today.

**Step 2: run → FAIL.**

**Step 3: implement.** `Composer.jsx:39`:
```js
const logger = useMemo(() => getLogger().child({ component: 'composer', app: 'piano-composer', sessionLog: true }), []);
```
`Composer` already passes `logger` to `useCompositionsApi` and renders `EditorSurface`; ensure `EditorSurface` uses THIS logger rather than minting its own bare child. Since `EditorSurface` currently does `getLogger().child({ component: 'composer-editor' })` (line 308), pass the mode logger down as a prop and derive the editor child from it: `logger.child({ component: 'composer-editor' })` — the child inherits `app`+`sessionLog`, so ONE session file, and the `session-log.start` auto-emits exactly once (from the mode logger's creation). Do NOT add sessionLog to the editor child separately. Verify exactly one `session-log.start` per mount.

**Step 4: run** Composer.test.jsx + EditorSurface.test.jsx → PASS.  **Step 5: commit** `feat(composer): route composer telemetry to a session log`

---

## Task 5: Numpad KEY + model EDIT capture (useComposerInput)

**Files:** Modify `useComposerInput.js`; Test `useComposerInput.test.js`.

Add recorder taps ALONGSIDE the existing semantic logs (do not remove them).

**Step 1: failing tests:**
- After a mapped keydown (e.g. dispatch `Numpad5`), `__snapshotForTest()` contains a `KIND.KEY` with `a === intern('Numpad5')`.
- After an armed MIDI note-on inserts, a `KIND.EDIT` with `editType` interning `insert-note` and `note === <midi>` is recorded.

**Step 2: run → FAIL.**

**Step 3: implement.** Import `{ record, intern, KIND }`. In the `onKey` handler, after `const m = mapKey(e.code); if (!m) return;`, add:
```js
const kid = intern(e.code), mkid = intern(m.kind);
record(KIND.KEY, kid, mkid, 0, 0);
const t0 = performance.now();
requestAnimationFrame(() => record(KIND.TAP, kid, Math.round(performance.now() - t0), 0, 0));
```
At each model-mutation site, record an EDIT with the resulting essentials. Helper:
```js
const recordEdit = (type, note = 0, measure = 0, duration = '') =>
  record(KIND.EDIT, intern(type), note | 0, measure | 0, intern(duration));
```
Wire it: `setDuration` → `recordEdit('duration', 0, 0, type)`; `toggleDot` → `recordEdit('dot')`; `toggleArm` → `recordEdit('arm')`; `addRest` → `recordEdit('insert-rest', 0, 0, sticky.current.type)`; `deleteAtCaret` → `recordEdit('delete')`; `deleteBack` → `recordEdit('delete-back')`; caret case → `recordEdit('caret')`; the armed note insert (line ~216) → `recordEdit('insert-note', evt.note, /*measure*/ 0, sticky.current.type)` (measure unknown here — pass 0; the rich detail incl. caret is in the time-aligned `.jsonl` `composer.editor.state`). Keep all existing `log.*` calls.

**Step 4: run → PASS** (existing useComposerInput tests stay green).  **Step 5: commit** `feat(composer): capture numpad keys and model edits`

---

## Task 6: MIDI raw capture (EditorSurface)

**Files:** Modify `EditorSurface.jsx`; Test `EditorSurface.test.jsx`.

Add a `subscribeRaw` recorder tap (full fidelity: note-off, sustain, velocity), independent of the editor's parsed `subscribe`. Reuse `midiToRecord` from the SheetMusic module — import it: `import { midiToRecord } from '../SheetMusic/midiTap.js';` (it's a pure helper; verify the relative path). `usePianoMidi()` exposes `subscribeRaw` (SheetMusic uses it). Remember: `emitRaw` wraps bytes as `{ data, time }`, so the listener reads `evt?.data`.

**Step 1: failing test** — invoke the raw MIDI callback the mock provides with `{ data: [0x90, 72, 88] }`; assert a `KIND.MIDI_ON` note 72 vel 88 in the ring. FAILS today.

**Step 2: run → FAIL.**

**Step 3: implement** in EditorSurface: destructure `subscribeRaw` from `usePianoMidi()`, add an effect:
```js
useEffect(() => {
  if (!subscribeRaw) return undefined;
  const off = subscribeRaw((evt) => { const r = midiToRecord(evt?.data); if (r) record(r.kind, r.a, r.b, 0, 0); });
  return off;
}, [subscribeRaw]);
```
Import `{ record }` (and `midiToRecord`). Always-on (cheap; shipping gated in Task 8).

**Step 4: run** EditorSurface.test.jsx → PASS.  **Step 5: commit** `feat(composer): capture raw MIDI into the recorder`

---

## Task 7: Toolbar tap capture (EditorSurface + DurationPalette)

**Files:** Modify `EditorSurface.jsx`, `DurationPalette.jsx`; Tests for each.

Add UI_INTENT + latency TAP to each control. Define a shared `tapIntent(name)` in EditorSurface (copy the SheetMusic pattern, but with no `stepRef` — pass 0):
```js
const tapIntent = useCallback((name) => {
  const id = intern(name);
  record(KIND.UI_INTENT, id, 0, 0, 0);
  const t0 = performance.now();
  requestAnimationFrame(() => record(KIND.TAP, id, Math.round(performance.now() - t0), 0, 0));
}, []);
```
Call it in: `doUndo` (`'undo'`, also `recordEdit`-style `record(KIND.EDIT, intern('undo'),0,0,0)`), `doRedo` (`'redo'` + EDIT), `togglePlay` (`'play'`), the Songs button (`'songs'`), `toggleHelp` (`'help'`), TitleControl open (`'title'`). For `DurationPalette`, pass a callback so its buttons (each duration, dot, write/arm, rest, delete) call `tapIntent(name)` — thread a single `onTap` prop into DurationPalette and call `onTap('duration-'+d.type)` / `'dot'` / `'write'` / `'rest'` / `'delete'` in the existing onClick handlers, alongside the existing setDuration/toggle calls.

**Step 1: failing test** — click Undo (or trigger a toolbar handler) → a `KIND.UI_INTENT` with `control === 'undo'` is in the ring. FAILS today.
**Step 2 → 4:** fail, implement, pass (existing toolbar tests stay green).
**Step 5: commit** `feat(composer): capture toolbar taps with input→paint latency`

---

## Task 8: Recorder lifecycle + gate + kill switch (EditorSurface)

**Files:** Modify `EditorSurface.jsx`; Test `EditorSurface.test.jsx` (+ maybe a `EditorSurface.telemetry.test.jsx`).

Copy the SheetMusic ScorePlayer lifecycle block (`startInputRec`/`stopInputRec`, the `window.__INPUT_REC__` effect, the config-gated auto effect). Differences: import `inputTelemetryEnabled`, `makeInputSender` from the shared gate (Task 3); `makeInputSender('piano-composer')`; `session = new Date().toISOString()`; `score: songId ?? 'draft'`; `ctx: { user: /* from config or props */ }`. Gate reads the `config` prop (`config.composer` block may not exist here since EditorSurface gets `config.composer || {}` from Composer — verify what `config` holds; gate on `inputTelemetryEnabled(config)` where `config` is what EditorSurface receives).

**Step 1: failing test** — with gate off (default mock config) `startRecorder` is NOT called on mount; with an enabled config it IS. Spy on the recorder module. Existing EditorSurface tests must stay green (telemetry off by default).
**Step 2 → 4:** fail, implement, pass.
**Step 5: commit** `feat(composer): config-gated recorder lifecycle + kill switch`

---

## Task 9: Backend retention for piano-composer

**Files:** Modify `backend/src/0_system/logging/transports/sessionEventsFile.mjs` (only if retention is per-app hard-coded); Test if changed.

**Step 1:** Read `sessionEventsFile.mjs` — it keys the file dir on `context.app`, so `piano-composer` files are written with no change. Check whether `maxAgeDays` is a single value (then piano-composer already gets 30d — DONE, no change) or a per-app map (then add `piano-composer: 30`). Do the minimal correct thing; if no change is needed, note that in the commit-less step and skip. If a change is needed, add a test asserting a `piano-composer/*.events` file older than 30d is pruned and a fresh one is kept.

**Step 2–5:** only if a change is required. Commit `chore(logging): 30-day retention for piano-composer events` if changed.

---

## Task 10: End-to-end round-trip + gate wiring

**Files:** Extend `frontend/src/lib/logging/inputRecorder.e2e.test.js`; wire any NEW backend test into `package.json` `test:refactor` (the SheetMusic build proved untgated tests are decoration).

**Step 1:** Add an e2e test scripting a realistic Composer session (header → KEY Numpad5 → EDIT duration → MIDI_ON → EDIT insert-note → UI_INTENT undo → EDIT undo) through `record`/`encodeBatch`/`decodeEvents`, asserting the decoded stream matches, in order, and that the header `ctx.t0` maps a record `t` to wall-clock (`t0.wall + (t − t0.perf)` is finite and increasing).
**Step 2 → 4:** fail, implement helper if needed, pass.
Then run the FULL surface: `npx vitest run frontend/src/lib/logging tests/unit/system/logging frontend/src/modules/Piano/PianoKiosk/modes/Composer frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic --reporter=dot` → all green. Confirm `npm run test:refactor` still green (and includes any new backend test).
**Step 5: commit** `test(composer): end-to-end key/edit round-trip`

---

## Deferred (NOT in this plan)

- **Replay viewer** — extend the (unbuilt) SheetMusic viewer with `key`/`edit` lanes once real `.events` exist.
- **On-tablet perf verification** — REQUIRED before enabling `inputTelemetry` in prod `piano.yml`. Do not enable the flag until measured on the real SM-T590 (before/after `perf.diagnostics`).
- **Per-session `seq`** on batches (transport-loss visibility) — still deferred, shared with SheetMusic.

## Post-implementation

1. Full gate: `npm run test:refactor` + the colocated frontend surface.
2. Do NOT enable `composer.inputTelemetry` in prod `piano.yml` until on-tablet perf passes.
3. Final adversarial review (`/grouchy-fable`) over the branch before merge — the SheetMusic build proved it catches production-order bugs green tests hide.
4. Use superpowers:finishing-a-development-branch to merge.
