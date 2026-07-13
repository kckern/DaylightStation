# Scale→Nutribot Guardrails + Keyboard Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the food-scale Telegram prompt spam and give the prompt a slim 3×3 density grid with Container / Help / Cancel controls.

**Architecture:** The fix spans three layers. `scaleNutribotConfig` (pure presentation) gains the 3×3 numbered grid, control row, slim + help text, and a `hint` field. `LogFoodFromScale` becomes create-or-edit (idempotent) and always density-first, returning the `messageId`. `ScaleNutribotBridge` replaces its boolean latch with a per-scale state machine: ignore wobble, re-arm only when the scale returns to empty, dedup same-weight re-settles, and edit-in-place on a meaningful weight change. Help is a new toggle use case; Cancel reuses the existing `x`→`DiscardFoodLog` route.

**Tech Stack:** Node.js ESM, Jest (`@jest/globals`), YAML persistence datastores, Telegram Bot API via `TelegramAdapter`.

## Global Constraints

- **Test runner:** `node tests/unit/harness.mjs --pattern=<NamePattern>` (Jest under the hood). Never invoke `jest`/`vitest` directly.
- **Import aliases:** use existing subpath aliases — `#apps/...` (backend/src/3_applications), `#adapters/...` (backend/src/1_adapters). Match neighbouring files.
- **Callback encoding:** scale buttons use the legacy `cmd` form via the injected default `encodeCallback = (cmd, data) => JSON.stringify({ cmd, ...data })`. The router reads `decoded.a || decoded.cmd`. Do NOT change the encoder.
- **Telegram edit semantics:** `messagingGateway.updateMessage(chatId, msgId, { text, choices, inline: true })` calls `editMessageText` *with* `reply_markup` only when BOTH `text` and `choices` are present. Editing text alone strips the keyboard — always pass `choices` when editing a prompt you want to keep tappable.
- **"Untouched" pending scale log:** a scale log is safe to edit-in-place only when `status === 'pending'` AND `metadata.source === 'scale'` AND `metadata.containerId == null` AND `metadata.densityLevel == null`. Any other state means the user already acted — create a fresh prompt instead of clobbering.
- **No hard deletes for cancel:** discard = `foodLogStore.updateStatus(userId, uuid, 'rejected')` + `deleteMessage`, matching `DiscardFoodLog`.
- Deploy is Telegram-only (no frontend bundle) — no garage/kiosk reload needed.

---

### Task 1: Config — 3×3 grid, control row, slim/help text, hint + editDeltaG

**Files:**
- Modify: `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs`
- Test: `tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs`

**Interfaces:**
- Produces:
  - `buildDensityKeyboard(cfg, encodeCallback, logUuid, opts = { showingHelp: false })` → rows: 3× (3 density buttons) + 1 control row `[📦 Container | ❓ Help/⬅️ Back | ❌ Cancel]`. Density button text `"${level} ${emoji}"`, callback `sd {id,l}`. Container `st {id}`. Help `sh {id,h:1}` (or Back `sh {id,h:0}` when `showingHelp`). Cancel `x {id}`.
  - `densityPromptText(grams)` → `"⚖️ ${grams} g"`.
  - `densityHelpText(cfg, grams)` → grams header + one line per level `"${level} ${emoji} ${label} · ${kcal_per_g} kcal/g  (${hint})"`.
  - `normalizeScaleNutribotConfig(raw)` output now also carries `editDeltaG` (number, default 3) and each density level carries `hint` (string, default '').

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('scaleNutribotConfig', …)` block in `tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs` (before the closing `});`), and add `densityHelpText` to the import list at the top of the file:

```js
  it('normalizes editDeltaG and per-level hint with defaults', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(cfg.editDeltaG).toBe(3);
    expect(cfg.densityLevels[0]).toMatchObject({ level: 1, hint: expect.any(String) });
    expect(cfg.densityLevels[0].hint.length).toBeGreaterThan(0);

    const overridden = normalizeScaleNutribotConfig({ nutribot: { edit_delta_g: 10 } });
    expect(overridden.editDeltaG).toBe(10);
  });

  it('buildDensityKeyboard lays out a 3x3 grid + a control row', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildDensityKeyboard(cfg, enc, 'log123');
    // 3 density rows of 3, then 1 control row
    expect(kb).toHaveLength(4);
    expect(kb[0]).toHaveLength(3);
    expect(kb[1]).toHaveLength(3);
    expect(kb[2]).toHaveLength(3);
    expect(kb[3]).toHaveLength(3);
    // density button text = "<level> <emoji>"
    expect(kb[0][0].text).toBe('1 🥬');
    // control row callbacks: container (st), help (sh h:1), cancel (x)
    const ctrl = kb[3].map((b) => JSON.parse(b.callback_data));
    expect(ctrl[0]).toMatchObject({ cmd: 'st', id: 'log123' });
    expect(ctrl[1]).toMatchObject({ cmd: 'sh', id: 'log123', h: 1 });
    expect(ctrl[2]).toMatchObject({ cmd: 'x', id: 'log123' });
  });

  it('buildDensityKeyboard swaps Help for Back when showingHelp', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildDensityKeyboard(cfg, enc, 'log123', { showingHelp: true });
    const help = JSON.parse(kb[3][1].callback_data);
    expect(kb[3][1].text).toBe('⬅️ Back');
    expect(help).toMatchObject({ cmd: 'sh', id: 'log123', h: 0 });
  });

  it('densityPromptText is slim; densityHelpText lists all levels', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(densityPromptText(340)).toBe('⚖️ 340 g');
    const help = densityHelpText(cfg, 340);
    expect(help).toContain('340 g');
    expect(help).toContain('Watery');
    expect(help).toContain('Pure fat');
    expect(help.split('\n').filter((l) => /kcal\/g/.test(l))).toHaveLength(9);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/unit/harness.mjs --pattern=scaleNutribotConfig`
Expected: FAIL — `densityHelpText` is not exported; `editDeltaG`/`hint` undefined; keyboard has 3 rows (5+4+control), not 4×3.

- [ ] **Step 3: Add `hint` to the default density levels**

In `scaleNutribotConfig.mjs`, replace `DEFAULT_DENSITY_LEVELS` (lines 18-28) with:

```js
export const DEFAULT_DENSITY_LEVELS = [
  { level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2, hint: 'broth, greens' },
  { level: 2, label: 'Light', emoji: '🥗', kcal_per_g: 0.6, hint: 'salad, fruit' },
  { level: 3, label: 'Lean', emoji: '🍲', kcal_per_g: 1.0, hint: 'soup, lean meat' },
  { level: 4, label: 'Everyday', emoji: '🍛', kcal_per_g: 1.4, hint: 'rice + veg + protein' },
  { level: 5, label: 'Hearty', emoji: '🍝', kcal_per_g: 1.9, hint: 'pasta, casserole' },
  { level: 6, label: 'Filling', emoji: '🍕', kcal_per_g: 2.6, hint: 'pizza, fried' },
  { level: 7, label: 'Rich', emoji: '🧀', kcal_per_g: 3.8, hint: 'cheese, creamy' },
  { level: 8, label: 'Very rich', emoji: '🥜', kcal_per_g: 6.0, hint: 'nuts, nut butter' },
  { level: 9, label: 'Pure fat', emoji: '🫒', kcal_per_g: 8.5, hint: 'oil, butter' },
];
```

- [ ] **Step 4: Carry `editDeltaG` + `hint` through `normalizeScaleNutribotConfig`**

In the `densityLevels` mapping inside `normalizeScaleNutribotConfig` (around lines 41-45), add `hint` to the mapped object:

```js
  const densityLevels = Array.isArray(nb.density_levels) && nb.density_levels.length
    ? nb.density_levels
        .filter((l) => l && Number.isFinite(Number(l.level)) && Number.isFinite(Number(l.kcal_per_g)))
        .map((l) => ({ level: Number(l.level), label: l.label || `L${l.level}`, emoji: l.emoji || '🍽', kcal_per_g: Number(l.kcal_per_g), hint: l.hint || '' }))
    : DEFAULT_DENSITY_LEVELS;
```

And add `editDeltaG` to the returned object (in the `return { ... }` near line 47):

```js
  return {
    minGrams: num(nb.min_grams, DEFAULT_MIN_GRAMS),
    editDeltaG: num(nb.edit_delta_g, 3),
    containers: {
      thresholdG: num(nb.containers?.threshold_g, DEFAULT_CONTAINERS.thresholdG),
      items,
    },
    densityLevels,
  };
```

- [ ] **Step 5: Rewrite `buildDensityKeyboard` (3×3 + control row) and the text helpers**

Replace `buildDensityKeyboard` (lines 68-78) and `densityPromptText` (lines 97-99) with the following, and add `densityHelpText` right after `densityPromptText`:

```js
export function buildDensityKeyboard(cfg, encodeCallback, logUuid, opts = {}) {
  const showingHelp = opts.showingHelp === true;
  const buttons = cfg.densityLevels.map((l) => ({
    text: `${l.level} ${l.emoji}`,
    callback_data: encodeCallback('sd', { id: logUuid, l: l.level }),
  }));
  const helpBtn = showingHelp
    ? { text: '⬅️ Back', callback_data: encodeCallback('sh', { id: logUuid, h: 0 }) }
    : { text: '❓ Help', callback_data: encodeCallback('sh', { id: logUuid, h: 1 }) };
  const controlRow = [
    { text: '📦 Container', callback_data: encodeCallback('st', { id: logUuid }) },
    helpBtn,
    { text: '❌ Cancel', callback_data: encodeCallback('x', { id: logUuid }) },
  ];
  return [...chunk(buttons, 3), controlRow]; // 3x3 grid + control row
}
```

```js
export function densityPromptText(grams) {
  return `⚖️ ${grams} g`;
}

export function densityHelpText(cfg, grams) {
  const lines = cfg.densityLevels.map(
    (l) => `${l.level} ${l.emoji} ${l.label} · ${l.kcal_per_g} kcal/g${l.hint ? `  (${l.hint})` : ''}`,
  );
  return `⚖️ ${grams} g — tap a level or describe it\n\n${lines.join('\n')}`;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node tests/unit/harness.mjs --pattern=scaleNutribotConfig`
Expected: PASS (all cases, including the pre-existing ones — the old `buildDensityKeyboard` test only asserts 9 `sd` + one `st` and still holds).

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs
git commit -m "feat(nutribot): slim 3x3 density grid + Container/Help/Cancel control row"
```

---

### Task 2: `LogFoodFromScale` — always density-first, return messageId, create-or-edit

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromScale.mjs`
- Test: `tests/unit/suite/applications/nutribot/LogFoodFromScale.test.mjs`

**Interfaces:**
- Consumes: `buildDensityKeyboard`, `densityPromptText` (Task 1); `foodLogStore.findByUuid(uuid, userId)`, `.save(log)`; `messagingGateway.sendMessage`, `.updateMessage`.
- Produces: `execute(input)` where `input` now optionally includes `existingLogUuid` and `messageId`. Returns `{ success, logUuid, messageId, stage:'density', edited? }`. `messageId` is a string (or null if the send returned none). In edit mode on an untouched pending scale log it edits in place and returns `edited:true`; otherwise it creates a fresh prompt.

- [ ] **Step 1: Write the failing tests**

Append these cases to `tests/unit/suite/applications/nutribot/LogFoodFromScale.test.mjs` inside its top-level `describe`. If the file's fixtures differ, mirror the existing `beforeEach` mock shape; the assertions below assume a `messagingGateway` with `sendMessage`/`updateMessage` spies, a `foodLogStore` with `save`/`findByUuid` spies, and a helper `makeUseCase()` returning the wired `LogFoodFromScale`. Adapt names to the file's existing helpers:

```js
  it('create path returns the sent messageId and is density-first', async () => {
    messagingGateway.sendMessage = jest.fn().mockResolvedValue({ messageId: 555 });
    const uc = makeUseCase();
    const res = await uc.execute({ userId: 'kckern', conversationId: 'c', grams: 340, unit: 'g', scaleId: 'kitchen' });
    expect(res).toMatchObject({ success: true, stage: 'density', messageId: '555' });
    expect(messagingGateway.sendMessage).toHaveBeenCalledWith('c', '⚖️ 340 g', expect.objectContaining({ inline: true }));
  });

  it('edit mode updates an untouched pending scale log in place (no new send)', async () => {
    const existing = {
      id: 'log1', status: 'pending',
      items: [{ label: 'Unknown', grams: 210, calories: 0, unit: 'g' }],
      metadata: { source: 'scale', grossGrams: 210, containerId: null, densityLevel: null, messageId: '900' },
      with(patch) { return { ...this, ...patch, with: this.with }; },
    };
    foodLogStore.findByUuid = jest.fn().mockResolvedValue(existing);
    messagingGateway.sendMessage = jest.fn();
    messagingGateway.updateMessage = jest.fn().mockResolvedValue(true);
    const uc = makeUseCase();
    const res = await uc.execute({ userId: 'kckern', conversationId: 'c', grams: 340, unit: 'g', scaleId: 'kitchen', existingLogUuid: 'log1', messageId: '900' });
    expect(res).toMatchObject({ success: true, logUuid: 'log1', edited: true });
    expect(messagingGateway.sendMessage).not.toHaveBeenCalled();
    expect(messagingGateway.updateMessage).toHaveBeenCalledWith('c', '900', expect.objectContaining({ text: '⚖️ 340 g', inline: true }));
  });

  it('edit mode falls through to create when the log was already touched', async () => {
    const touched = {
      id: 'log1', status: 'pending',
      items: [{ label: 'Unknown', grams: 210, calories: 0, unit: 'g' }],
      metadata: { source: 'scale', grossGrams: 210, containerId: null, densityLevel: 5, messageId: '900' },
      with(patch) { return { ...this, ...patch, with: this.with }; },
    };
    foodLogStore.findByUuid = jest.fn().mockResolvedValue(touched);
    messagingGateway.sendMessage = jest.fn().mockResolvedValue({ messageId: 777 });
    const uc = makeUseCase();
    const res = await uc.execute({ userId: 'kckern', conversationId: 'c', grams: 340, existingLogUuid: 'log1', messageId: '900' });
    expect(res).toMatchObject({ success: true, edited: undefined });
    expect(messagingGateway.sendMessage).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/unit/harness.mjs --pattern=LogFoodFromScale`
Expected: FAIL — `execute` ignores `existingLogUuid`, never returns `messageId`, and posts the verbose (non-slim) text / container-first branch.

- [ ] **Step 3: Rewrite `LogFoodFromScale.mjs`**

Replace the whole file body from the imports through `execute` with:

```js
//
// Bridge-invoked entry point: a settled scale weight becomes (or updates) a pending
// NutriLog + a slim Telegram density prompt. Always density-first; the container picker
// is a button on the prompt, not a leading question. No responseContext (not a
// user-initiated event) — uses the raw messagingGateway.
//
// Create-or-edit: when the bridge passes existingLogUuid + messageId and that log is an
// untouched pending scale log, we edit the grams in place instead of posting a new
// message. Anything else (touched / gone / non-pending) creates a fresh prompt.

import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';
import { buildDensityKeyboard, densityPromptText } from '../lib/scaleNutribotConfig.mjs';

export class LogFoodFromScale {
  #messagingGateway; #foodLogStore; #conversationStateStore; #scaleConfig; #config; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#scaleConfig = deps.scaleConfig;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #isUntouched(log) {
    return !!log
      && log.status === 'pending'
      && log.metadata?.source === 'scale'
      && log.metadata?.containerId == null
      && log.metadata?.densityLevel == null;
  }

  async execute(input) {
    const { userId, conversationId, grams, unit, scaleId, existingLogUuid, messageId } = input;
    const gross = Math.round(Number(grams));
    if (!Number.isFinite(gross) || gross <= 0) {
      this.#logger.warn?.('logScale.badGrams', { scaleId, grams });
      return { success: false, error: 'bad grams' };
    }

    const cfg = this.#scaleConfig;

    // Edit-in-place: an untouched pending scale prompt exists → update its grams only.
    if (existingLogUuid && messageId) {
      const existing = await this.#foodLogStore.findByUuid(existingLogUuid, userId);
      if (this.#isUntouched(existing)) {
        const item0 = typeof existing.items[0].toJSON === 'function' ? existing.items[0].toJSON() : { ...existing.items[0] };
        const updated = existing.with({
          items: [{ ...item0, grams: gross }],
          metadata: { ...existing.metadata, grossGrams: gross },
        }, new Date());
        await this.#foodLogStore.save(updated);
        const choices = buildDensityKeyboard(cfg, this.#encodeCallback, existingLogUuid);
        try {
          await this.#messagingGateway.updateMessage(conversationId, messageId, { text: densityPromptText(gross), choices, inline: true });
        } catch (e) {
          this.#logger.warn?.('logScale.editFailed', { error: e.message });
        }
        this.#logger.info?.('logScale.edited', { conversationId, logUuid: existingLogUuid, gross });
        return { success: true, logUuid: existingLogUuid, messageId: String(messageId), stage: 'density', edited: true };
      }
      // not untouched → fall through and create a fresh prompt
    }

    const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
    const nutriLog = NutriLog.create({
      userId,
      conversationId,
      items: [{ label: 'Unknown', grams: gross, calories: 0, unit: unit || 'g', amount: 1, color: 'yellow' }],
      metadata: { source: 'scale', scaleId: scaleId || null, grossGrams: gross },
      timezone,
      timestamp: new Date(),
    });
    await this.#foodLogStore.save(nutriLog);

    const text = densityPromptText(gross);
    const choices = buildDensityKeyboard(cfg, this.#encodeCallback, nutriLog.id);
    if (this.#conversationStateStore) {
      await this.#conversationStateStore.set(conversationId, {
        conversationId,
        activeFlow: 'scale_describe',
        flowState: { pendingLogUuid: nutriLog.id },
      });
    }

    const sent = await this.#messagingGateway.sendMessage(conversationId, text, { choices, inline: true });
    const newMessageId = sent?.messageId;
    if (newMessageId) {
      await this.#foodLogStore.save(nutriLog.with({ metadata: { ...nutriLog.metadata, messageId: String(newMessageId) } }, new Date()));
    }

    this.#logger.info?.('logScale.posted', { conversationId, logUuid: nutriLog.id, gross, stage: 'density' });
    return { success: true, logUuid: nutriLog.id, messageId: newMessageId ? String(newMessageId) : null, stage: 'density' };
  }
}

export default LogFoodFromScale;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/unit/harness.mjs --pattern=LogFoodFromScale`
Expected: PASS. If a pre-existing test asserted the old container-first branch (`stage: 'container'`) or the verbose prompt text, update that assertion to the density-first / slim behavior — the container step is now reachable only via the Container button.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromScale.mjs tests/unit/suite/applications/nutribot/LogFoodFromScale.test.mjs
git commit -m "feat(nutribot): scale prompt is always density-first + create-or-edit in place"
```

---

### Task 3: `ScaleNutribotBridge` — anti-spam state machine

**Files:**
- Modify: `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`
- Test: `tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs`

**Interfaces:**
- Consumes: `nutribotContainer.getLogFoodFromScale().execute({ userId, conversationId, grams, unit, scaleId, existingLogUuid?, messageId? })` returning `{ success, logUuid, messageId }` (Task 2); `scaleConfig.minGrams`, `scaleConfig.editDeltaG` (Task 1).
- Produces: `createScaleNutribotBridge(deps)` → `{ dispose() }`. Per-scale behavior: near-empty re-arms; wobble ignored; first settle creates; weight change ≥ `editDeltaG` edits; same-weight re-settle no-ops; a synchronous re-entrancy guard prevents duplicate creates while a dispatch is in flight.

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs` with:

```js
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeBus() {
  const handlers = {};
  return {
    subscribe: (topic, cb) => { (handlers[topic] ||= []).push(cb); return () => {}; },
    emit: (topic, payload) => (handlers[topic] || []).forEach((cb) => cb(payload)),
  };
}

describe('ScaleNutribotBridge', () => {
  let bus, execute, container;
  beforeEach(() => {
    bus = makeBus();
    execute = jest.fn().mockResolvedValue({ success: true, logUuid: 'l1', messageId: 'm1' });
    container = { getLogFoodFromScale: () => ({ execute }) };
    createScaleNutribotBridge({
      eventBus: bus, nutribotContainer: container,
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('creates one prompt for a settled reading and ignores repeat frames', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' }); // repeat, same weight
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ grams: 240, scaleId: 'kitchen' });
    expect(execute.mock.calls[0][0].existingLogUuid).toBeUndefined();
  });

  it('ignores a wobble (unstable) while loaded — no new prompt', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 235, stable: false, unit: 'g' }); // bump: still loaded, unstable
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });  // re-settles same weight
    await flush();
    expect(execute).toHaveBeenCalledTimes(1); // no second dispatch
  });

  it('edits in place when the settled weight changes by >= editDeltaG', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 210, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 340, stable: true, unit: 'g' });
    await flush();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toMatchObject({ grams: 340, existingLogUuid: 'l1', messageId: 'm1' });
  });

  it('does not re-dispatch for a sub-threshold weight change', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 210, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 212, stable: true, unit: 'g' }); // +2g < editDeltaG(3)
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('re-arms only after the scale returns to (near) empty', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 1, stable: true, unit: 'g' }); // removed → empty
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 300, stable: true, unit: 'g' }); // new item
    await flush();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].existingLogUuid).toBeUndefined(); // fresh create, not an edit
  });

  it('ignores readings below min_grams', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 2, stable: true, unit: 'g' });
    await flush();
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not double-create when two settled frames arrive before the first resolves', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' }); // synchronous, before flush
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/unit/harness.mjs --pattern=ScaleNutribotBridge`
Expected: FAIL — current bridge re-arms on any unstable frame (the wobble test fails), has no edit/delta logic, and no in-flight guard.

- [ ] **Step 3: Rewrite `ScaleNutribotBridge.mjs`**

Replace the file body (keep the header comment / `DEFAULT_TOPICS`) with:

```js
const DEFAULT_TOPICS = ['food-scale'];

export function createScaleNutribotBridge({ eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics, logger = console }) {
  if (!eventBus?.subscribe) throw new Error('createScaleNutribotBridge: eventBus with subscribe required');
  if (!nutribotContainer?.getLogFoodFromScale) throw new Error('createScaleNutribotBridge: nutribotContainer required');

  const minGrams = scaleConfig?.minGrams ?? 5;
  const editDeltaG = scaleConfig?.editDeltaG ?? 3;
  const state = new Map();     // scaleId -> { logUuid, messageId, lastGrams }
  const inflight = new Set();  // scaleId currently dispatching (re-entrancy guard)

  const dispatch = (grams, extra) =>
    nutribotContainer.getLogFoodFromScale().execute({ userId, conversationId, grams, unit: 'g', ...extra });

  const onPayload = async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';
    const grams = Math.round(Number(payload.grams));
    if (!Number.isFinite(grams)) return;

    // Item removed → re-arm for the next item.
    if (grams < minGrams) { state.delete(id); return; }
    // Wobble while loaded → ignore. This is what kills bump / re-settle spam.
    if (payload.stable !== true) return;

    const cur = state.get(id);
    // No-op fast paths that need no dispatch (checked before the in-flight guard so a
    // steady stable stream at the same weight never blocks on the guard).
    if (cur && Math.abs(grams - cur.lastGrams) < editDeltaG) return;
    if (inflight.has(id)) return; // a create/edit is already in flight for this scale
    inflight.add(id);

    try {
      if (!cur) {
        const res = await dispatch(grams, { scaleId: id });
        if (res?.success && res.logUuid) {
          state.set(id, { logUuid: res.logUuid, messageId: res.messageId || null, lastGrams: grams });
        }
      } else {
        const res = await dispatch(grams, { scaleId: id, existingLogUuid: cur.logUuid, messageId: cur.messageId });
        if (res?.success && res.logUuid) {
          state.set(id, { logUuid: res.logUuid, messageId: res.messageId || cur.messageId, lastGrams: grams });
        } else {
          state.set(id, { ...cur, lastGrams: grams });
        }
      }
    } catch (err) {
      logger.warn?.('scaleNutribot.dispatch.failed', { id, error: err.message });
    } finally {
      inflight.delete(id);
    }
  };

  const unsubs = (topics && topics.length ? topics : DEFAULT_TOPICS).map((t) => eventBus.subscribe(t, onPayload));
  logger.info?.('scaleNutribot.bridge.ready', { conversationId, userId, minGrams, editDeltaG, topics: topics || DEFAULT_TOPICS });

  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createScaleNutribotBridge;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/unit/harness.mjs --pattern=ScaleNutribotBridge`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/hardware/ScaleNutribotBridge.mjs tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs
git commit -m "fix(nutribot): scale bridge ignores wobble, re-arms on empty, edits in place"
```

---

### Task 4: `ShowScaleDensityHelp` use case + container registration

**Files:**
- Create: `backend/src/3_applications/nutribot/usecases/ShowScaleDensityHelp.mjs`
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs`
- Test: `tests/unit/suite/applications/nutribot/ShowScaleDensityHelp.test.mjs`

**Interfaces:**
- Consumes: `buildDensityKeyboard`, `densityPromptText`, `densityHelpText` (Task 1); `foodLogStore.findByUuid`; `messagingGateway.updateMessage` (or `responseContext.updateMessage`).
- Produces: `ShowScaleDensityHelp` with `execute({ userId, conversationId, logUuid, showHelp, messageId, responseContext })` → edits the prompt text between slim and legend and rebuilds the keyboard with the toggled Help/Back button. Container getter `getShowScaleDensityHelp()`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/suite/applications/nutribot/ShowScaleDensityHelp.test.mjs`:

```js
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ShowScaleDensityHelp } from '#apps/nutribot/usecases/ShowScaleDensityHelp.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('ShowScaleDensityHelp', () => {
  let foodLogStore, messagingGateway, uc;
  beforeEach(() => {
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue({
        id: 'log1', status: 'pending',
        items: [{ grams: 340, toJSON() { return { grams: 340 }; } }],
      }),
    };
    messagingGateway = { updateMessage: jest.fn().mockResolvedValue(true) };
    uc = new ShowScaleDensityHelp({
      messagingGateway, foodLogStore,
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('expands to the legend and shows a Back button when showHelp', async () => {
    await uc.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'log1', showHelp: true, messageId: '900' });
    const [, msgId, updates] = messagingGateway.updateMessage.mock.calls[0];
    expect(msgId).toBe('900');
    expect(updates.text).toContain('Watery');
    expect(updates.text).toContain('340 g');
    expect(updates.choices[3][1].text).toBe('⬅️ Back');
  });

  it('collapses to the slim prompt and shows Help when not showHelp', async () => {
    await uc.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'log1', showHelp: false, messageId: '900' });
    const [, , updates] = messagingGateway.updateMessage.mock.calls[0];
    expect(updates.text).toBe('⚖️ 340 g');
    expect(updates.choices[3][1].text).toBe('❓ Help');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/unit/harness.mjs --pattern=ShowScaleDensityHelp`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ShowScaleDensityHelp.mjs`**

```js
//
// 'sh' callback handler: toggle the density prompt between the slim grams line and the
// full legend (label · kcal/g · examples). Pure presentation — never mutates the log.
// The Help/Back button state is carried in the callback (h:1 = show, h:0 = back).

import { buildDensityKeyboard, densityPromptText, densityHelpText } from '../lib/scaleNutribotConfig.mjs';

export class ShowScaleDensityHelp {
  #messagingGateway; #foodLogStore; #scaleConfig; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#scaleConfig = deps.scaleConfig;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #getMessaging(responseContext, conversationId) {
    if (responseContext) return responseContext;
    return { updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates) };
  }

  async execute(input) {
    const { userId, conversationId, logUuid, showHelp, messageId, responseContext } = input;
    if (!messageId) return { success: false, error: 'no message' };
    const messaging = this.#getMessaging(responseContext, conversationId);

    const log = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!log || !log.items?.length) return { success: false, error: 'log not found' };
    const item0 = typeof log.items[0].toJSON === 'function' ? log.items[0].toJSON() : { ...log.items[0] };
    const grams = Math.round(Number(item0.grams));

    const text = showHelp ? densityHelpText(this.#scaleConfig, grams) : densityPromptText(grams);
    const choices = buildDensityKeyboard(this.#scaleConfig, this.#encodeCallback, logUuid, { showingHelp: showHelp });
    try {
      await messaging.updateMessage(messageId, { text, choices, inline: true });
    } catch (e) {
      this.#logger.warn?.('scaleHelp.updateFailed', { error: e.message });
    }

    return { success: true, showHelp: !!showHelp };
  }
}

export default ShowScaleDensityHelp;
```

- [ ] **Step 4: Register the use case in `NutribotContainer.mjs`**

Add the import next to the other scale-use-case imports (near line 35):

```js
import { ShowScaleDensityHelp } from './usecases/ShowScaleDensityHelp.mjs';
```

Add a private field alongside the other scale fields (find the block declaring `#selectScaleDensity;` and add on the next line):

```js
  #showScaleDensityHelp;
```

Add the getter right after `getSelectScaleDensity()` (after line 305):

```js
  getShowScaleDensityHelp() {
    if (!this.#showScaleDensityHelp) {
      this.#showScaleDensityHelp = new ShowScaleDensityHelp({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        scaleConfig: this.#scaleConfig,
        logger: this.#logger,
      });
    }
    return this.#showScaleDensityHelp;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/unit/harness.mjs --pattern=ShowScaleDensityHelp`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/ShowScaleDensityHelp.mjs backend/src/3_applications/nutribot/NutribotContainer.mjs tests/unit/suite/applications/nutribot/ShowScaleDensityHelp.test.mjs
git commit -m "feat(nutribot): ShowScaleDensityHelp toggles the density legend in place"
```

---

### Task 5: Router — wire the `sh` (Help toggle) callback

**Files:**
- Modify: `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs`
- Test: `tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs`

**Interfaces:**
- Consumes: `container.getShowScaleDensityHelp().execute(...)` (Task 4).
- Produces: a `case 'sh'` in `handleCallback` mapping `decoded.id`/`decoded.h` → `getShowScaleDensityHelp`. (Cancel needs no new route — its button emits `x`, already mapped to `REJECT_LOG` → `DiscardFoodLog`, which sets status `rejected` and deletes the message.)

- [ ] **Step 1: Write the failing test**

In `tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs`, add `getShowScaleDensityHelp` to `makeContainer` and add `help` to the spies, then add two cases.

In `makeContainer` (after the `getSelectScaleDensity` line, ~line 9):

```js
    getShowScaleDensityHelp: () => ({ execute: spies.help }),
```

In `beforeEach` spies (after the `density:` line, ~line 22):

```js
      help: jest.fn().mockResolvedValue({ ok: true }),
```

Add these cases before the closing `});`:

```js
  it("routes 'sh' (h:1) to ShowScaleDensityHelp with showHelp true", async () => {
    await router.handleCallback(evt({ payload: { callbackData: JSON.stringify({ cmd: 'sh', id: 'log1', h: 1 }) } }), {});
    expect(spies.help).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', showHelp: true }));
  });

  it("routes 'sh' (h:0) to ShowScaleDensityHelp with showHelp false", async () => {
    await router.handleCallback(evt({ payload: { callbackData: JSON.stringify({ cmd: 'sh', id: 'log1', h: 0 }) } }), {});
    expect(spies.help).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', showHelp: false }));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/unit/harness.mjs --pattern=NutribotInputRouterScale`
Expected: FAIL — no `sh` case, so `getShowScaleDensityHelp` is never called (and may throw as undefined).

- [ ] **Step 3: Add the `sh` case**

In `NutribotInputRouter.mjs`, immediately after the `case 'sd': { … }` block (ends ~line 231), add:

```js
      case 'sh': {
        // Scale help — toggle the density legend in place (h:1 show, h:0 back)
        const useCase = this.container.getShowScaleDensityHelp();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          showHelp: decoded.h === 1 || decoded.h === '1',
          messageId: event.messageId,
          responseContext,
        });
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/unit/harness.mjs --pattern=NutribotInputRouterScale`
Expected: PASS (existing `st`/`sd`/describe cases plus the two new `sh` cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/nutribot/NutribotInputRouter.mjs tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs
git commit -m "feat(nutribot): route 'sh' scale help toggle callback"
```

---

### Task 6: Full suite green + deploy

**Files:** none (verification + deploy)

- [ ] **Step 1: Run the nutribot + hardware slices together**

Run: `node tests/unit/harness.mjs --pattern=Scale`
Then: `node tests/unit/harness.mjs --pattern=Nutribot`
Expected: PASS. Investigate and fix any pre-existing test that asserted the old container-first / rows-of-5 behavior (update the assertion to match the new density-first slim design — do not weaken coverage).

- [ ] **Step 2: Confirm it is safe to deploy (no active workout / no video playing)**

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```
Expected clear-to-deploy: `0` render lines; no `videoState:"playing"`; `sessionActive:false`; `rosterSize:0`. If either gate is active, wait.

- [ ] **Step 3: Build + deploy**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Live smoke test on the physical scale**

Put an item on the scale and confirm in Telegram: one slim `⚖️ N g` prompt with a 3×3 grid + `[📦 Container | ❓ Help | ❌ Cancel]`. Bump the scale → no new message. Add food → the same message updates its grams. Tap Help → legend expands, Back collapses it. Tap Cancel → message disappears. Tap a density level → resolves to kcal with Accept/Revise/Discard. Watch logs:

```bash
sudo docker logs --since 3m daylight-station 2>&1 | grep -iE "logScale|scaleNutribot|selectDensity"
```
Expected: `logScale.posted` once per item, `logScale.edited` on weight changes, no burst of `logScale.posted`.

---

## Self-Review

**Spec coverage:**
- Spam guardrail (ignore wobble / re-arm on empty / dedup / edit-in-place) → Tasks 2 + 3. ✓
- 3×3 numbered grid + slim text → Task 1. ✓
- Container as a button, density-first → Tasks 1 (button) + 2 (drops container-first branch). ✓
- Help toggle with legend → Tasks 1 (text/keyboard) + 4 (use case) + 5 (route). ✓
- Cancel = silent delete + discard → Task 1 (button emits `x`) + reuse of existing `DiscardFoodLog`. ✓
- Config knobs (`edit_delta_g`, `hint`) → Task 1. ✓
- Rollout → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows real assertions. ✓

**Type consistency:** `existingLogUuid`/`messageId` inputs and `{ success, logUuid, messageId, stage, edited }` return shape match between Task 2 (producer) and Task 3 (consumer). `buildDensityKeyboard(cfg, enc, id, { showingHelp })` signature identical across Tasks 1, 2, 4. `showHelp` boolean flows router (Task 5) → use case (Task 4). `sh {id,h}` / `x {id}` / `st {id}` / `sd {id,l}` callback shapes consistent across Tasks 1 and 5. ✓
