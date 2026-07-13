# Scale → Nutribot Density Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each settled kitchen-scale weight into a nutribot food-log entry whose quantity is exact and whose only estimate is caloric density — chosen by tapping a non-linear density level or by describing the food (AI estimates blended kcal/g), with an optional container (tare) subtraction step.

**Architecture:** A new application-layer bridge subscribes the existing `food-scale` event-bus topic, filters to settled readings, and invokes a `LogFoodFromScale` use case that posts a Telegram prompt to the household head. Resolution happens through three more use cases (`SelectScaleContainer`, `SelectScaleDensity`, `LogScaleFoodFromText`) wired into the existing `NutribotInputRouter` callback/text seams. `calories = netGrams × kcalPerGram`.

**Tech Stack:** Node ESM, Express 5, Jest (`npx jest <path>`), js-yaml config, existing nutribot DDD container.

## Global Constraints

- **Test runner:** `npx jest <path/to/test.mjs>` — config at `jest.config.js`, aliases `#apps/* → backend/src/3_applications/*`, `#domains/*`, `#adapters/*`. Test files end `.test.mjs`, use `import { describe, it, expect, jest, beforeEach } from '@jest/globals'`.
- **Callback encoding:** use cases default `encodeCallback = (cmd, data) => JSON.stringify({ cmd, ...data })`. The router decodes `action = decoded.a || decoded.cmd`. New actions: `'st'` (container) `{ cmd:'st', id, c }`, `'sd'` (density) `{ cmd:'sd', id, l }`. NutriLog ids are short (`shortId()`), so payloads stay under Telegram's 64-byte limit.
- **Density source of truth:** `kcal_per_g` per level in config; `level` is an ordinal only.
- **Net grams before calories:** the container step, when shown, runs before density.
- **Target chat:** resolved at wiring time from `configService.getHeadOfHousehold()` → `userIdentityService.resolvePlatformId('telegram', head)` → `telegram:b<botId>_c<platformId>`. Not in config.
- **Messaging:** resolve use cases (invoked by the router) receive `responseContext` and use the `#getMessaging(responseContext, conversationId)` pattern (see `LogFoodFromUPC`). `LogFoodFromScale` (bridge-invoked) has no `responseContext` and calls the raw `messagingGateway` directly.
- **Deploy:** this host is prod; after merge, `docker build` + `sudo deploy-daylight` are allowed — but never redeploy during an active fitness session or a playing Player video (see CLAUDE.local.md gates). This feature is backend-only; no garage kiosk reload needed.

**Spec:** `docs/superpowers/specs/2026-07-13-scale-nutribot-density-logging-design.md`

---

## File Structure

- `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs` (new) — pure config normalizer + defaults + keyboard/text builders. No I/O.
- `backend/src/3_applications/nutribot/usecases/LogFoodFromScale.mjs` (new) — creates the pending entry, posts container-or-density keyboard.
- `backend/src/3_applications/nutribot/usecases/SelectScaleContainer.mjs` (new) — `'st'` handler: subtract container, post density keyboard.
- `backend/src/3_applications/nutribot/usecases/SelectScaleDensity.mjs` (new) — `'sd'` handler: `net × kcal/g` → resolve.
- `backend/src/3_applications/nutribot/usecases/LogScaleFoodFromText.mjs` (new) — describe path: AI blended density × net.
- `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs` (new) — event-bus subscriber + settle latch.
- `backend/src/3_applications/nutribot/NutribotContainer.mjs` (edit) — four getters + `scaleConfig`.
- `backend/src/5_composition/bootstrap.mjs` (edit) — normalize + pass `scaleConfig`, return it.
- `backend/src/app.mjs` (edit) — construct the bridge.
- `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` (edit) — `'st'`/`'sd'` callbacks + `scale_describe` text branch.
- `_extensions/food-scale-relay/config.example.yml` (edit) — document the `nutribot` block.

---

## Task 1: Scale config normalizer + builders

**Files:**
- Create: `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs`
- Test: `tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs`

**Interfaces:**
- Produces:
  - `normalizeScaleNutribotConfig(rawScalesYml) → { minGrams:number, containers:{ thresholdG:number, items:Array<{id,label,emoji,grams}> }, densityLevels:Array<{level,label,emoji,kcal_per_g}> }`
  - `densityForLevel(cfg, level) → level obj | null`
  - `buildDensityKeyboard(cfg, encodeCallback, logUuid) → choices[][]`
  - `buildContainerKeyboard(cfg, encodeCallback, logUuid) → choices[][]`
  - `buildConfirmButtons(encodeCallback, logUuid) → choices[][]`
  - `densityPromptText(grams) → string`
  - `containerPromptText(grams) → string`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs
import { describe, it, expect } from '@jest/globals';
import {
  normalizeScaleNutribotConfig,
  densityForLevel,
  buildDensityKeyboard,
  buildContainerKeyboard,
  buildConfirmButtons,
} from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

describe('scaleNutribotConfig', () => {
  it('supplies defaults when the nutribot block is absent', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(cfg.minGrams).toBe(5);
    expect(cfg.containers.thresholdG).toBe(150);
    expect(cfg.containers.items.length).toBeGreaterThan(0);
    expect(cfg.densityLevels).toHaveLength(9);
    expect(cfg.densityLevels[3]).toMatchObject({ level: 4, label: 'Everyday', kcal_per_g: 1.4 });
  });

  it('honours provided overrides', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: {
        min_grams: 10,
        containers: { threshold_g: 200, items: [{ id: 'plate', label: 'Plate', emoji: '🍽', grams: 300 }] },
        density_levels: [{ level: 1, label: 'Zero', emoji: '💧', kcal_per_g: 0 }],
      },
    });
    expect(cfg.minGrams).toBe(10);
    expect(cfg.containers.thresholdG).toBe(200);
    expect(cfg.containers.items).toHaveLength(1);
    expect(cfg.densityLevels).toHaveLength(1);
  });

  it('densityForLevel finds by ordinal', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(densityForLevel(cfg, 9)).toMatchObject({ label: 'Pure fat', kcal_per_g: 8.5 });
    expect(densityForLevel(cfg, 99)).toBeNull();
  });

  it('buildDensityKeyboard encodes sd callbacks with level + a container affordance', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildDensityKeyboard(cfg, enc, 'log123');
    const decoded = kb.flat().map((b) => JSON.parse(b.callback_data));
    const sd = decoded.filter((d) => d.cmd === 'sd');
    expect(sd).toHaveLength(9);
    expect(sd[0]).toMatchObject({ cmd: 'sd', id: 'log123', l: 1 });
    // container affordance: 'st' with no container id = show the picker
    const affordance = decoded.find((d) => d.cmd === 'st');
    expect(affordance).toMatchObject({ cmd: 'st', id: 'log123' });
    expect(affordance.c).toBeUndefined();
  });

  it('buildContainerKeyboard puts None first and encodes st callbacks', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildContainerKeyboard(cfg, enc, 'log123');
    expect(JSON.parse(kb[0][0].callback_data)).toMatchObject({ cmd: 'st', id: 'log123', c: 'none' });
    const encoded = kb.flat().map((b) => JSON.parse(b.callback_data));
    expect(encoded.some((e) => e.c === 'dinner-plate')).toBe(true);
  });

  it('buildConfirmButtons emits accept/revise/discard', () => {
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const rows = buildConfirmButtons(enc, 'log123');
    const cmds = rows.flat().map((b) => JSON.parse(b.callback_data).cmd);
    expect(cmds).toEqual(['a', 'r', 'x']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs`
Expected: FAIL — "Cannot find module '#apps/nutribot/lib/scaleNutribotConfig.mjs'".

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs
//
// Pure config + presentation helpers for the scale→nutribot feature. No I/O.
// Reads the `nutribot` block of scales.yml and supplies defaults so the feature
// works before the real file is edited.

export const DEFAULT_MIN_GRAMS = 5;

export const DEFAULT_CONTAINERS = {
  thresholdG: 150,
  items: [
    { id: 'dinner-plate', label: 'Dinner plate', emoji: '🍽', grams: 340 },
    { id: 'dinner-bowl', label: 'Dinner bowl', emoji: '🥣', grams: 250 },
    { id: 'small-bowl', label: 'Small bowl', emoji: '🍚', grams: 180 },
    { id: 'mug', label: 'Mug', emoji: '☕', grams: 350 },
  ],
};

export const DEFAULT_DENSITY_LEVELS = [
  { level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2 },
  { level: 2, label: 'Light', emoji: '🥗', kcal_per_g: 0.6 },
  { level: 3, label: 'Lean', emoji: '🍲', kcal_per_g: 1.0 },
  { level: 4, label: 'Everyday', emoji: '🍛', kcal_per_g: 1.4 },
  { level: 5, label: 'Hearty', emoji: '🍝', kcal_per_g: 1.9 },
  { level: 6, label: 'Filling', emoji: '🍕', kcal_per_g: 2.6 },
  { level: 7, label: 'Rich', emoji: '🧀', kcal_per_g: 3.8 },
  { level: 8, label: 'Very rich', emoji: '🥜', kcal_per_g: 6.0 },
  { level: 9, label: 'Pure fat', emoji: '🫒', kcal_per_g: 8.5 },
];

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function normalizeScaleNutribotConfig(raw = {}) {
  const nb = (raw && raw.nutribot) || {};

  const items = Array.isArray(nb.containers?.items) && nb.containers.items.length
    ? nb.containers.items
        .filter((c) => c && c.id && Number.isFinite(Number(c.grams)))
        .map((c) => ({ id: String(c.id), label: c.label || c.id, emoji: c.emoji || '📦', grams: Number(c.grams) }))
    : DEFAULT_CONTAINERS.items;

  const densityLevels = Array.isArray(nb.density_levels) && nb.density_levels.length
    ? nb.density_levels
        .filter((l) => l && Number.isFinite(Number(l.level)) && Number.isFinite(Number(l.kcal_per_g)))
        .map((l) => ({ level: Number(l.level), label: l.label || `L${l.level}`, emoji: l.emoji || '🍽', kcal_per_g: Number(l.kcal_per_g) }))
    : DEFAULT_DENSITY_LEVELS;

  return {
    minGrams: num(nb.min_grams, DEFAULT_MIN_GRAMS),
    containers: {
      thresholdG: num(nb.containers?.threshold_g, DEFAULT_CONTAINERS.thresholdG),
      items,
    },
    densityLevels,
  };
}

export function densityForLevel(cfg, level) {
  const n = Number(level);
  return cfg.densityLevels.find((l) => l.level === n) || null;
}

function chunk(arr, size) {
  const rows = [];
  for (let i = 0; i < arr.length; i += size) rows.push(arr.slice(i, i + size));
  return rows;
}

export function buildDensityKeyboard(cfg, encodeCallback, logUuid) {
  const buttons = cfg.densityLevels.map((l) => ({
    text: `${l.emoji} ${l.label}`,
    callback_data: encodeCallback('sd', { id: logUuid, l: l.level }),
  }));
  // Always offer a container (tare) affordance, even when the reading was below
  // the prompt threshold (e.g. a light item on a paper towel or small plate).
  // 'st' with no `c` = "show the container picker" (SelectScaleContainer show mode).
  const containerRow = [{ text: '📦 On a container?', callback_data: encodeCallback('st', { id: logUuid }) }];
  return [...chunk(buttons, 5), containerRow]; // rows of 5 + container affordance
}

export function buildContainerKeyboard(cfg, encodeCallback, logUuid) {
  const none = [{ text: '🚫 No container', callback_data: encodeCallback('st', { id: logUuid, c: 'none' }) }];
  const containers = cfg.containers.items.map((c) => ({
    text: `${c.emoji} ${c.label} −${c.grams}`,
    callback_data: encodeCallback('st', { id: logUuid, c: c.id }),
  }));
  return [none, ...chunk(containers, 3)];
}

export function buildConfirmButtons(encodeCallback, logUuid) {
  return [[
    { text: '✅ Accept', callback_data: encodeCallback('a', { id: logUuid }) },
    { text: '✏️ Revise', callback_data: encodeCallback('r', { id: logUuid }) },
    { text: '🗑️ Discard', callback_data: encodeCallback('x', { id: logUuid }) },
  ]];
}

export function densityPromptText(grams) {
  return `⚖️ ${grams} g — what is it?\n\nTap a density level, or just describe it and I'll estimate.`;
}

export function containerPromptText(grams) {
  return `⚖️ ${grams} g — in a container?\n\nPick one to subtract its weight, or “No container”.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs
git commit -m "feat(nutribot): scale density config normalizer + keyboard builders"
```

---

## Task 2: `LogFoodFromScale` use case

**Files:**
- Create: `backend/src/3_applications/nutribot/usecases/LogFoodFromScale.mjs`
- Test: `tests/unit/suite/applications/nutribot/LogFoodFromScale.test.mjs`

**Interfaces:**
- Consumes: `scaleNutribotConfig.mjs` (Task 1); `NutriLog.create` (`#domains/nutrition/entities/NutriLog.mjs`).
- Produces: `new LogFoodFromScale({ messagingGateway, foodLogStore, conversationStateStore, scaleConfig, config, logger })` with `execute({ userId, conversationId, grams, unit, scaleId }) → { success, logUuid, stage:'container'|'density' }`. Creates a pending `NutriLog` (item `{ label:'Unknown', grams, calories:0, unit:'g', amount:1, color:'yellow' }`, metadata `{ source:'scale', scaleId, grossGrams:grams }`); posts the container keyboard when `grams > scaleConfig.containers.thresholdG`, else the density keyboard; on the density stage sets state `{ activeFlow:'scale_describe', flowState:{ pendingLogUuid } }`; stores `metadata.messageId`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/nutribot/LogFoodFromScale.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LogFoodFromScale } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('LogFoodFromScale', () => {
  let messaging, foodLogStore, stateStore, useCase, saved;

  beforeEach(() => {
    saved = [];
    messaging = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: '900' }),
      updateMessage: jest.fn().mockResolvedValue({}),
    };
    foodLogStore = { save: jest.fn().mockImplementation((log) => { saved.push(log); return Promise.resolve(); }) };
    stateStore = { set: jest.fn().mockResolvedValue({}) };
    useCase = new LogFoodFromScale({
      messagingGateway: messaging,
      foodLogStore,
      conversationStateStore: stateStore,
      scaleConfig: normalizeScaleNutribotConfig({}),
      config: { getUserTimezone: () => 'America/Los_Angeles' },
      logger,
    });
  });

  it('creates a pending entry and posts the density keyboard for a light reading', async () => {
    const res = await useCase.execute({ userId: 'kckern', conversationId: 'telegram:b1_c2', grams: 90, unit: 'g', scaleId: 'kitchen' });
    expect(res.stage).toBe('density');
    expect(foodLogStore.save).toHaveBeenCalled();
    const text = messaging.sendMessage.mock.calls[0][1];
    expect(text).toContain('90 g');
    // density keyboard present (9 density levels + a container affordance)
    const sd = messaging.sendMessage.mock.calls[0][2].choices.flat()
      .map((b) => JSON.parse(b.callback_data)).filter((d) => d.cmd === 'sd');
    expect(sd).toHaveLength(9);
    // scale_describe state set at density stage
    expect(stateStore.set).toHaveBeenCalledWith('telegram:b1_c2', expect.objectContaining({ activeFlow: 'scale_describe' }));
    // created log item + metadata shape (saved objects are NutriLog instances)
    const created = saved[0].toJSON();
    expect(created.items[0]).toMatchObject({ label: 'Unknown', grams: 90, calories: 0, amount: 1, color: 'yellow' });
    expect(created.metadata).toMatchObject({ source: 'scale', scaleId: 'kitchen', grossGrams: 90 });
    // messageId persisted after send (second save)
    expect(foodLogStore.save.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(saved[saved.length - 1].toJSON().metadata.messageId).toBe('900');
  });

  it('posts the container keyboard for a heavy reading (above threshold)', async () => {
    const res = await useCase.execute({ userId: 'kckern', conversationId: 'telegram:b1_c2', grams: 480, unit: 'g', scaleId: 'kitchen' });
    expect(res.stage).toBe('container');
    const choices = messaging.sendMessage.mock.calls[0][2].choices;
    expect(JSON.parse(choices[0][0].callback_data)).toMatchObject({ cmd: 'st', c: 'none' });
    // container stage does NOT arm scale_describe yet
    expect(stateStore.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/nutribot/LogFoodFromScale.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/nutribot/usecases/LogFoodFromScale.mjs
//
// Bridge-invoked entry point: a settled scale weight becomes a pending NutriLog and
// a Telegram prompt. No responseContext (not a user-initiated event) — uses the raw
// messagingGateway. Posts the container keyboard first when the gross weight exceeds
// the configured threshold, otherwise the density keyboard.

import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';
import {
  buildDensityKeyboard,
  buildContainerKeyboard,
  densityPromptText,
  containerPromptText,
} from '../lib/scaleNutribotConfig.mjs';

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

  async execute(input) {
    const { userId, conversationId, grams, unit, scaleId } = input;
    const gross = Math.round(Number(grams));
    if (!Number.isFinite(gross) || gross <= 0) {
      this.#logger.warn?.('logScale.badGrams', { scaleId, grams });
      return { success: false, error: 'bad grams' };
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

    const cfg = this.#scaleConfig;
    const useContainer = gross > cfg.containers.thresholdG && cfg.containers.items.length > 0;

    let text, choices, stage;
    if (useContainer) {
      text = containerPromptText(gross);
      choices = buildContainerKeyboard(cfg, this.#encodeCallback, nutriLog.id);
      stage = 'container';
    } else {
      text = densityPromptText(gross);
      choices = buildDensityKeyboard(cfg, this.#encodeCallback, nutriLog.id);
      stage = 'density';
      // Arm the describe path only once grams are final (no container step).
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.set(conversationId, {
          conversationId,
          activeFlow: 'scale_describe',
          flowState: { pendingLogUuid: nutriLog.id },
        });
      }
    }

    const sent = await this.#messagingGateway.sendMessage(conversationId, text, { choices, inline: true });
    const messageId = sent?.messageId;
    if (messageId) {
      await this.#foodLogStore.save(nutriLog.with({ metadata: { ...nutriLog.metadata, messageId: String(messageId) } }, new Date()));
    }

    this.#logger.info?.('logScale.posted', { conversationId, logUuid: nutriLog.id, gross, stage });
    return { success: true, logUuid: nutriLog.id, stage };
  }
}

export default LogFoodFromScale;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/nutribot/LogFoodFromScale.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromScale.mjs tests/unit/suite/applications/nutribot/LogFoodFromScale.test.mjs
git commit -m "feat(nutribot): LogFoodFromScale use case (pending entry + container/density keyboard)"
```

---

## Task 3: `SelectScaleContainer` use case (tare)

**Files:**
- Create: `backend/src/3_applications/nutribot/usecases/SelectScaleContainer.mjs`
- Test: `tests/unit/suite/applications/nutribot/SelectScaleContainer.test.mjs`

**Interfaces:**
- Consumes: `scaleNutribotConfig.mjs` (Task 1).
- Produces: `new SelectScaleContainer({ messagingGateway, foodLogStore, conversationStateStore, scaleConfig, logger })` with `execute({ userId, conversationId, logUuid, containerId, messageId, responseContext }) → { success, net } | { success, shown:true }`. **Show mode** (`containerId` absent — the density keyboard's "📦 On a container?" affordance): posts the container picker against gross grams, no subtraction. **Apply mode** (`containerId` an id or `'none'`): subtracts the container weight from the pending item's grams (`net = max(1, gross − containerGrams)`, computed from `metadata.grossGrams` so re-taring is idempotent; keeps gross and warns if the container ≥ gross), then edits the message into the density prompt + density keyboard and arms `scale_describe` state.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/nutribot/SelectScaleContainer.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SelectScaleContainer } from '#apps/nutribot/usecases/SelectScaleContainer.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeLog(grams) {
  return { id: 'log1', userId: 'kckern', status: 'pending',
    items: [{ label: 'Unknown', grams, calories: 0, unit: 'g' }],
    metadata: { source: 'scale', grossGrams: grams },
    with(updates) { return { ...this, ...updates, with: this.with }; } };
}

describe('SelectScaleContainer', () => {
  let messaging, foodLogStore, stateStore, useCase, savedLog;
  beforeEach(() => {
    messaging = { updateMessage: jest.fn().mockResolvedValue({}) };
    savedLog = null;
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue(makeLog(480)),
      save: jest.fn().mockImplementation((l) => { savedLog = l; return Promise.resolve(); }),
    };
    stateStore = { set: jest.fn().mockResolvedValue({}) };
    useCase = new SelectScaleContainer({
      messagingGateway: messaging, foodLogStore, conversationStateStore: stateStore,
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('subtracts a known container and shows the density keyboard on net grams', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      containerId: 'dinner-plate', messageId: '900', responseContext: messaging,
    });
    expect(res.net).toBe(140); // 480 − 340
    expect(savedLog.items[0].grams).toBe(140);
    const update = messaging.updateMessage.mock.calls[0][2];
    expect(update.text).toContain('140 g');
    const sd = update.choices.flat().map((b) => JSON.parse(b.callback_data)).filter((d) => d.cmd === 'sd');
    expect(sd).toHaveLength(9);
    expect(stateStore.set).toHaveBeenCalledWith('telegram:b1_c2', expect.objectContaining({ activeFlow: 'scale_describe' }));
  });

  it('none keeps gross grams', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      containerId: 'none', messageId: '900', responseContext: messaging,
    });
    expect(res.net).toBe(480);
    expect(savedLog.items[0].grams).toBe(480);
  });

  it('guards against a container heavier than the reading', async () => {
    foodLogStore.findByUuid = jest.fn().mockResolvedValue(makeLog(200));
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      containerId: 'mug', messageId: '900', responseContext: messaging, // mug=350 > 200
    });
    expect(res.net).toBe(200); // kept gross
  });

  it('show mode (no containerId) posts the container picker without subtracting', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      containerId: undefined, messageId: '900', responseContext: messaging,
    });
    expect(res.shown).toBe(true);
    // no subtraction / no save happened
    expect(foodLogStore.save).not.toHaveBeenCalled();
    const update = messaging.updateMessage.mock.calls[0][2];
    const containerBtns = update.choices.flat().map((b) => JSON.parse(b.callback_data)).filter((d) => d.cmd === 'st');
    expect(containerBtns.some((d) => d.c === 'none')).toBe(true);
    expect(containerBtns.some((d) => d.c === 'dinner-plate')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/nutribot/SelectScaleContainer.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/nutribot/usecases/SelectScaleContainer.mjs
//
// 'st' callback handler: subtract a known container weight from the gross scale
// reading, then advance to the density stage (edit the message into the density
// keyboard + arm the describe path).

import {
  buildDensityKeyboard, densityPromptText,
  buildContainerKeyboard, containerPromptText,
} from '../lib/scaleNutribotConfig.mjs';

export class SelectScaleContainer {
  #messagingGateway; #foodLogStore; #conversationStateStore; #scaleConfig; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#scaleConfig = deps.scaleConfig;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #getMessaging(responseContext, conversationId) {
    if (responseContext) return responseContext;
    return {
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
    };
  }

  async execute(input) {
    const { userId, conversationId, logUuid, containerId, messageId, responseContext } = input;
    const messaging = this.#getMessaging(responseContext, conversationId);

    const nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!nutriLog || !nutriLog.items?.length) return { success: false, error: 'log not found' };
    if (nutriLog.status !== 'pending') return { success: false, error: 'already processed' };

    const item0 = typeof nutriLog.items[0].toJSON === 'function' ? nutriLog.items[0].toJSON() : { ...nutriLog.items[0] };
    const gross = Math.round(Number(nutriLog.metadata?.grossGrams ?? item0.grams));

    // Show mode: the density keyboard's "📦 On a container?" button routes here with
    // no containerId. Post the container picker (against gross) without subtracting.
    if (containerId === undefined || containerId === null || containerId === '') {
      const choices = buildContainerKeyboard(this.#scaleConfig, this.#encodeCallback, logUuid);
      if (messageId) {
        try { await messaging.updateMessage(messageId, { text: containerPromptText(gross), choices, inline: true }); }
        catch (e) { this.#logger.warn?.('selectContainer.showFailed', { error: e.message }); }
      }
      return { success: true, shown: true };
    }

    let net = gross;
    let containerId2 = null, containerGrams = 0;
    if (containerId && containerId !== 'none') {
      const c = this.#scaleConfig.containers.items.find((x) => x.id === containerId);
      if (c) {
        if (c.grams >= gross) {
          this.#logger.warn?.('selectContainer.tooHeavy', { logUuid, container: c.id, containerGrams: c.grams, gross });
        } else {
          net = Math.max(1, gross - c.grams);
          containerId2 = c.id;
          containerGrams = c.grams;
        }
      }
    }

    const updatedItem = { ...item0, grams: net };
    const updatedLog = nutriLog.with({
      items: [updatedItem],
      metadata: { ...nutriLog.metadata, containerId: containerId2, containerGrams },
    }, new Date());
    await this.#foodLogStore.save(updatedLog);

    // Advance to density stage (edit the container message in place).
    const choices = buildDensityKeyboard(this.#scaleConfig, this.#encodeCallback, logUuid);
    if (messageId) {
      try {
        await messaging.updateMessage(messageId, { text: densityPromptText(net), choices, inline: true });
      } catch (e) {
        this.#logger.warn?.('selectContainer.updateFailed', { error: e.message });
      }
    }
    if (this.#conversationStateStore) {
      await this.#conversationStateStore.set(conversationId, {
        conversationId, activeFlow: 'scale_describe', flowState: { pendingLogUuid: logUuid },
      });
    }

    this.#logger.info?.('selectContainer.done', { logUuid, gross, net, containerId: containerId2 });
    return { success: true, net };
  }
}

export default SelectScaleContainer;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/nutribot/SelectScaleContainer.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/SelectScaleContainer.mjs tests/unit/suite/applications/nutribot/SelectScaleContainer.test.mjs
git commit -m "feat(nutribot): SelectScaleContainer tare use case"
```

---

## Task 4: `SelectScaleDensity` use case

**Files:**
- Create: `backend/src/3_applications/nutribot/usecases/SelectScaleDensity.mjs`
- Test: `tests/unit/suite/applications/nutribot/SelectScaleDensity.test.mjs`

**Interfaces:**
- Consumes: `scaleNutribotConfig.mjs` (Task 1: `densityForLevel`, `buildConfirmButtons`).
- Produces: `new SelectScaleDensity({ messagingGateway, foodLogStore, conversationStateStore, scaleConfig, logger })` with `execute({ userId, conversationId, logUuid, level, messageId, responseContext }) → { success, calories }`. Sets the pending item's `calories = round(grams × kcal/g[level])` and `label`, clears the conversation state, edits the message into a confirmation + Accept/Revise/Discard row.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/nutribot/SelectScaleDensity.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SelectScaleDensity } from '#apps/nutribot/usecases/SelectScaleDensity.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeLog(grams) {
  return { id: 'log1', userId: 'kckern', status: 'pending',
    items: [{ label: 'Unknown', grams, calories: 0, unit: 'g' }],
    metadata: { source: 'scale' },
    with(updates) { return { ...this, ...updates, with: this.with }; } };
}

describe('SelectScaleDensity', () => {
  let messaging, foodLogStore, stateStore, useCase, savedLog;
  beforeEach(() => {
    messaging = { updateMessage: jest.fn().mockResolvedValue({}) };
    savedLog = null;
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue(makeLog(240)),
      save: jest.fn().mockImplementation((l) => { savedLog = l; return Promise.resolve(); }),
    };
    stateStore = { clear: jest.fn().mockResolvedValue({}) };
    useCase = new SelectScaleDensity({
      messagingGateway: messaging, foodLogStore, conversationStateStore: stateStore,
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('computes calories = grams × kcal/g[level] and shows confirm buttons', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      level: 4, messageId: '900', responseContext: messaging, // 1.4 kcal/g
    });
    expect(res.calories).toBe(336); // 240 × 1.4
    expect(savedLog.items[0].calories).toBe(336);
    expect(savedLog.items[0].label).toBe('Everyday');
    expect(stateStore.clear).toHaveBeenCalledWith('telegram:b1_c2');
    const cmds = messaging.updateMessage.mock.calls[0][2].choices.flat().map((b) => JSON.parse(b.callback_data).cmd);
    expect(cmds).toEqual(['a', 'r', 'x']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/nutribot/SelectScaleDensity.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/nutribot/usecases/SelectScaleDensity.mjs
//
// 'sd' callback handler: resolve a pending scale entry by tapping a density level.
// calories = round(netGrams × kcal_per_g). Then show Accept/Revise/Discard.

import { densityForLevel, buildConfirmButtons } from '../lib/scaleNutribotConfig.mjs';

export class SelectScaleDensity {
  #messagingGateway; #foodLogStore; #conversationStateStore; #scaleConfig; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#scaleConfig = deps.scaleConfig;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #getMessaging(responseContext, conversationId) {
    if (responseContext) return responseContext;
    return { updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates) };
  }

  async execute(input) {
    const { userId, conversationId, logUuid, level, messageId, responseContext } = input;
    const messaging = this.#getMessaging(responseContext, conversationId);

    const lvl = densityForLevel(this.#scaleConfig, level);
    if (!lvl) return { success: false, error: 'unknown level' };

    const nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!nutriLog || !nutriLog.items?.length) return { success: false, error: 'log not found' };
    if (nutriLog.status !== 'pending') return { success: false, error: 'already processed' };

    const item0 = typeof nutriLog.items[0].toJSON === 'function' ? nutriLog.items[0].toJSON() : { ...nutriLog.items[0] };
    const grams = Math.round(Number(item0.grams));
    const calories = Math.round(grams * lvl.kcal_per_g);

    const updatedItem = { ...item0, label: lvl.label, calories };
    const updatedLog = nutriLog.with({
      items: [updatedItem],
      metadata: { ...nutriLog.metadata, densityLevel: lvl.level },
    }, new Date());
    await this.#foodLogStore.save(updatedLog);

    if (this.#conversationStateStore) {
      try { await this.#conversationStateStore.clear(conversationId); } catch (e) { this.#logger.debug?.('selectDensity.clearFailed', { error: e.message }); }
    }

    const text = `⚖️ ${grams} g · ${lvl.emoji} ${lvl.label}\n🔥 ~${calories} kcal`;
    const choices = buildConfirmButtons(this.#encodeCallback, logUuid);
    if (messageId) {
      try { await messaging.updateMessage(messageId, { text, choices, inline: true }); }
      catch (e) { this.#logger.warn?.('selectDensity.updateFailed', { error: e.message }); }
    }

    this.#logger.info?.('selectDensity.done', { logUuid, grams, level: lvl.level, calories });
    return { success: true, calories };
  }
}

export default SelectScaleDensity;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/nutribot/SelectScaleDensity.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/SelectScaleDensity.mjs tests/unit/suite/applications/nutribot/SelectScaleDensity.test.mjs
git commit -m "feat(nutribot): SelectScaleDensity use case (grams × kcal/g)"
```

---

## Task 5: `LogScaleFoodFromText` use case (describe path)

**Files:**
- Create: `backend/src/3_applications/nutribot/usecases/LogScaleFoodFromText.mjs`
- Test: `tests/unit/suite/applications/nutribot/LogScaleFoodFromText.test.mjs`

**Interfaces:**
- Consumes: `scaleNutribotConfig.mjs` (Task 1: `buildConfirmButtons`); an `aiGateway` with `chat(messages, opts) → string`.
- Produces: `new LogScaleFoodFromText({ messagingGateway, aiGateway, foodLogStore, conversationStateStore, logger })` with `execute({ userId, conversationId, logUuid, text, messageId, responseContext }) → { success, calories }`. Asks the AI for blended `density_kcal_per_g` + macro-per-gram of the described dish (grams are exact), computes `calories = round(grams × density)`, updates the item, clears state, shows Accept/Revise/Discard.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/nutribot/LogScaleFoodFromText.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LogScaleFoodFromText } from '#apps/nutribot/usecases/LogScaleFoodFromText.mjs';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeLog(grams) {
  return { id: 'log1', userId: 'kckern', status: 'pending',
    items: [{ label: 'Unknown', grams, calories: 0, unit: 'g' }],
    metadata: { source: 'scale' },
    with(updates) { return { ...this, ...updates, with: this.with }; } };
}

describe('LogScaleFoodFromText', () => {
  let messaging, aiGateway, foodLogStore, stateStore, useCase, savedLog;
  beforeEach(() => {
    messaging = { updateMessage: jest.fn().mockResolvedValue({}) };
    aiGateway = { chat: jest.fn().mockResolvedValue('{"label":"Lasagna","density_kcal_per_g":1.7,"protein_per_g":0.08,"carbs_per_g":0.14,"fat_per_g":0.08}') };
    savedLog = null;
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue(makeLog(350)),
      save: jest.fn().mockImplementation((l) => { savedLog = l; return Promise.resolve(); }),
    };
    stateStore = { clear: jest.fn().mockResolvedValue({}) };
    useCase = new LogScaleFoodFromText({ messagingGateway: messaging, aiGateway, foodLogStore, conversationStateStore: stateStore, logger });
  });

  it('estimates blended density and multiplies by the exact grams', async () => {
    const res = await useCase.execute({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'log1',
      text: 'leftover lasagna', messageId: '900', responseContext: messaging,
    });
    expect(res.calories).toBe(595); // 350 × 1.7
    expect(savedLog.items[0].label).toBe('Lasagna');
    expect(savedLog.items[0].calories).toBe(595);
    // the prompt tells the AI the grams are exact
    const userMsg = aiGateway.chat.mock.calls[0][0].map((m) => m.content).join(' ');
    expect(userMsg).toContain('350');
    expect(stateStore.clear).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/nutribot/LogScaleFoodFromText.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/nutribot/usecases/LogScaleFoodFromText.mjs
//
// Describe path for a pending scale entry. The grams are EXACT (from a scale), so the
// AI's only job is to estimate the dish's blended caloric density (kcal/g) + macros/g.
// No portion guessing, no portionBoost — that is the whole point of the scale.

import { buildConfirmButtons } from '../lib/scaleNutribotConfig.mjs';

export class LogScaleFoodFromText {
  #messagingGateway; #aiGateway; #foodLogStore; #conversationStateStore; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #getMessaging(responseContext, conversationId) {
    if (responseContext) return responseContext;
    return { updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates) };
  }

  #buildPrompt(grams, text) {
    return [
      {
        role: 'system',
        content: `You estimate caloric density. The user weighed food on a kitchen scale, so the gram weight is EXACT — do NOT estimate quantity. Given a description, estimate the whole dish as ONE item and return its BLENDED caloric density (kcal per gram) plus macro grams-per-gram. Density must be between 0.1 and 9.0 (pure fat ≈ 9). Respond ONLY as JSON:
{"label": "<short name>", "density_kcal_per_g": <number>, "protein_per_g": <number>, "carbs_per_g": <number>, "fat_per_g": <number>}`,
      },
      { role: 'user', content: `${grams} g of: ${text}` },
    ];
  }

  #parse(response) {
    const match = response && response.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const p = JSON.parse(match[0]);
      const density = Number(p.density_kcal_per_g);
      if (!Number.isFinite(density)) return null;
      return {
        label: p.label || 'Food',
        density: Math.min(9, Math.max(0.1, density)),
        proteinPerG: Number(p.protein_per_g) || 0,
        carbsPerG: Number(p.carbs_per_g) || 0,
        fatPerG: Number(p.fat_per_g) || 0,
      };
    } catch { return null; }
  }

  async execute(input) {
    const { userId, conversationId, logUuid, text, messageId, responseContext } = input;
    const messaging = this.#getMessaging(responseContext, conversationId);

    const nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!nutriLog || !nutriLog.items?.length) return { success: false, error: 'log not found' };
    if (nutriLog.status !== 'pending') return { success: false, error: 'already processed' };

    const item0 = typeof nutriLog.items[0].toJSON === 'function' ? nutriLog.items[0].toJSON() : { ...nutriLog.items[0] };
    const grams = Math.round(Number(item0.grams));

    const response = await this.#aiGateway.chat(this.#buildPrompt(grams, text), { maxTokens: 300 });
    const est = this.#parse(response);
    if (!est) {
      this.#logger.warn?.('logScaleText.parseFailed', { logUuid, response: response?.slice?.(0, 200) });
      return { success: false, error: 'could not estimate' };
    }

    const round1 = (n) => Math.round(n * 10) / 10;
    const calories = Math.round(grams * est.density);
    const updatedItem = {
      ...item0, label: est.label, calories,
      protein: round1(grams * est.proteinPerG),
      carbs: round1(grams * est.carbsPerG),
      fat: round1(grams * est.fatPerG),
    };
    const updatedLog = nutriLog.with({
      items: [updatedItem],
      metadata: { ...nutriLog.metadata, densityEstimated: est.density, describedAs: text },
    }, new Date());
    await this.#foodLogStore.save(updatedLog);

    if (this.#conversationStateStore) {
      try { await this.#conversationStateStore.clear(conversationId); } catch (e) { this.#logger.debug?.('logScaleText.clearFailed', { error: e.message }); }
    }

    const t = `⚖️ ${grams} g · ${est.label}\n🔥 ~${calories} kcal · P${updatedItem.protein} C${updatedItem.carbs} F${updatedItem.fat}`;
    const choices = buildConfirmButtons(this.#encodeCallback, logUuid);
    if (messageId) {
      try { await messaging.updateMessage(messageId, { text: t, choices, inline: true }); }
      catch (e) { this.#logger.warn?.('logScaleText.updateFailed', { error: e.message }); }
    }

    this.#logger.info?.('logScaleText.done', { logUuid, grams, density: est.density, calories });
    return { success: true, calories };
  }
}

export default LogScaleFoodFromText;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/nutribot/LogScaleFoodFromText.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogScaleFoodFromText.mjs tests/unit/suite/applications/nutribot/LogScaleFoodFromText.test.mjs
git commit -m "feat(nutribot): LogScaleFoodFromText describe path (AI blended density × exact grams)"
```

---

## Task 6: Register use cases in `NutribotContainer`

**Files:**
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs`
- Test: `tests/unit/suite/applications/nutribot/NutribotContainerScale.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–5 use cases.
- Produces: container getters `getLogFoodFromScale()`, `getSelectScaleContainer()`, `getSelectScaleDensity()`, `getLogScaleFoodFromText()`. Constructor `options.scaleConfig` (already-normalized object) stored on `this.#scaleConfig`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/nutribot/NutribotContainerScale.test.mjs
import { describe, it, expect } from '@jest/globals';
import { NutribotContainer } from '#apps/nutribot/NutribotContainer.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

describe('NutribotContainer scale use cases', () => {
  const container = new NutribotContainer(
    { getUserTimezone: () => 'America/Los_Angeles' },
    {
      messagingGateway: { sendMessage: async () => ({ messageId: '1' }), updateMessage: async () => ({}) },
      aiGateway: { chat: async () => '{}' },
      foodLogStore: { save: async () => {}, findByUuid: async () => null },
      conversationStateStore: { set: async () => {}, get: async () => null, clear: async () => {} },
      scaleConfig: normalizeScaleNutribotConfig({}),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    }
  );

  it('exposes the four scale use cases', () => {
    expect(container.getLogFoodFromScale()).toBeTruthy();
    expect(container.getSelectScaleContainer()).toBeTruthy();
    expect(container.getSelectScaleDensity()).toBeTruthy();
    expect(container.getLogScaleFoodFromText()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/nutribot/NutribotContainerScale.test.mjs`
Expected: FAIL — `container.getLogFoodFromScale is not a function`.

- [ ] **Step 3: Add imports, private fields, `scaleConfig`, and getters**

At the top of `NutribotContainer.mjs`, alongside the other `usecases/...` imports, add:

```javascript
import { LogFoodFromScale } from './usecases/LogFoodFromScale.mjs';
import { SelectScaleContainer } from './usecases/SelectScaleContainer.mjs';
import { SelectScaleDensity } from './usecases/SelectScaleDensity.mjs';
import { LogScaleFoodFromText } from './usecases/LogScaleFoodFromText.mjs';
```

In the class private-field block (near the other `#logFoodFrom...` fields), add:

```javascript
  #scaleConfig;
  #logFoodFromScale;
  #selectScaleContainer;
  #selectScaleDensity;
  #logScaleFoodFromText;
```

In the constructor, where `options` are captured (near `this.#catalogService = options.catalogService`), add:

```javascript
    this.#scaleConfig = options.scaleConfig || null;
```

After `getLogFoodFromUPC()` (around line 253), add the getters:

```javascript
  // ==================== Scale (food-scale relay) Use Cases ====================

  getLogFoodFromScale() {
    if (!this.#logFoodFromScale) {
      this.#logFoodFromScale = new LogFoodFromScale({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        scaleConfig: this.#scaleConfig,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#logFoodFromScale;
  }

  getSelectScaleContainer() {
    if (!this.#selectScaleContainer) {
      this.#selectScaleContainer = new SelectScaleContainer({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        scaleConfig: this.#scaleConfig,
        logger: this.#logger,
      });
    }
    return this.#selectScaleContainer;
  }

  getSelectScaleDensity() {
    if (!this.#selectScaleDensity) {
      this.#selectScaleDensity = new SelectScaleDensity({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        scaleConfig: this.#scaleConfig,
        logger: this.#logger,
      });
    }
    return this.#selectScaleDensity;
  }

  getLogScaleFoodFromText() {
    if (!this.#logScaleFoodFromText) {
      this.#logScaleFoodFromText = new LogScaleFoodFromText({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#logScaleFoodFromText;
  }
```

> Note: confirm `getMessagingGateway()` and `getAIGateway()` exist on the container (they are used by `getLogFoodFromUPC`/`getLogFoodFromText`). Reuse the same accessors.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/nutribot/NutribotContainerScale.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/NutribotContainer.mjs tests/unit/suite/applications/nutribot/NutribotContainerScale.test.mjs
git commit -m "feat(nutribot): register scale use cases in container"
```

---

## Task 7: Router touchpoints (`'st'`, `'sd'`, `scale_describe`)

**Files:**
- Modify: `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs`
- Test: `tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs`

**Interfaces:**
- Consumes: container getters from Task 6.
- Produces: `handleCallback` routes `'st'`→`getSelectScaleContainer()`, `'sd'`→`getSelectScaleDensity()`; `handleText` routes `activeFlow === 'scale_describe'` → `getLogScaleFoodFromText()`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NutribotInputRouter } from '#adapters/nutribot/NutribotInputRouter.mjs';

function makeContainer(spies) {
  return {
    getConversationStateStore: () => spies.stateStore,
    getSelectScaleContainer: () => ({ execute: spies.container }),
    getSelectScaleDensity: () => ({ execute: spies.density }),
    getLogScaleFoodFromText: () => ({ execute: spies.describe }),
    getLogFoodFromText: () => ({ execute: spies.logText }),
    getProcessRevisionInput: () => ({ execute: spies.revision }),
  };
}

describe('NutribotInputRouter scale routing', () => {
  let spies, router;
  beforeEach(() => {
    spies = {
      stateStore: { get: jest.fn().mockResolvedValue(null) },
      container: jest.fn().mockResolvedValue({ ok: true }),
      density: jest.fn().mockResolvedValue({ ok: true }),
      describe: jest.fn().mockResolvedValue({ ok: true }),
      logText: jest.fn().mockResolvedValue({ ok: true }),
      revision: jest.fn().mockResolvedValue({ ok: true }),
    };
    router = new NutribotInputRouter(makeContainer(spies), {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  const evt = (extra) => ({ conversationId: 'telegram:b1_c2', messageId: '900', userId: 'kckern', ...extra });

  it("routes 'st' callbacks to SelectScaleContainer", async () => {
    await router.handleCallback(evt({ payload: { callbackData: JSON.stringify({ cmd: 'st', id: 'log1', c: 'dinner-plate' }) } }), {});
    expect(spies.container).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', containerId: 'dinner-plate' }));
  });

  it("routes 'sd' callbacks to SelectScaleDensity", async () => {
    await router.handleCallback(evt({ payload: { callbackData: JSON.stringify({ cmd: 'sd', id: 'log1', l: 4 }) } }), {});
    expect(spies.density).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', level: 4 }));
  });

  it('routes scale_describe text to LogScaleFoodFromText', async () => {
    spies.stateStore.get = jest.fn().mockResolvedValue({ activeFlow: 'scale_describe', flowState: { pendingLogUuid: 'log1' } });
    await router.handleText(evt({ payload: { text: 'leftover lasagna' } }), {});
    expect(spies.describe).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', text: 'leftover lasagna' }));
    expect(spies.logText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs`
Expected: FAIL — `'st'`/`'sd'` fall to the `default` (handled:false); the describe assertion fails because text falls through to `getLogFoodFromText`.

- [ ] **Step 3a: Add the callback cases**

In `handleCallback`'s `switch (action)` block, add these cases before `default:` (place near the UPC `case 'p'`):

```javascript
      case 'st': {
        // Scale tare — decoded.c absent = show the container picker; present = subtract it
        const useCase = this.container.getSelectScaleContainer();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          containerId: decoded.c,
          messageId: event.messageId,
          responseContext,
        });
      }
      case 'sd': {
        // Scale density — resolve calories from tapped level
        const useCase = this.container.getSelectScaleDensity();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          level: decoded.l,
          messageId: event.messageId,
          responseContext,
        });
      }
```

- [ ] **Step 3b: Add the text branch**

In `handleText`, inside the `if (conversationStateStore) { try {` block, alongside the existing `if (state?.activeFlow === 'revision' && pendingLogUuid) { ... }`, add (immediately after that block, still inside the `try`):

```javascript
        if (state?.activeFlow === 'scale_describe' && pendingLogUuid) {
          this.logger.info?.('nutribot.handleText.scaleDescribeRouted', {
            conversationId: event.conversationId,
            pendingLogUuid,
          });
          const useCase = this.container.getLogScaleFoodFromText();
          const result = await useCase.execute({
            userId: this.#resolveUserId(event),
            conversationId: event.conversationId,
            logUuid: pendingLogUuid,
            text: event.payload.text,
            messageId: event.messageId,
            responseContext,
          });
          return { ok: true, result };
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/nutribot/NutribotInputRouter.mjs tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs
git commit -m "feat(nutribot): route scale tare/density callbacks + scale_describe text"
```

---

## Task 8: `ScaleNutribotBridge`

**Files:**
- Create: `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`
- Test: `tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs`

**Interfaces:**
- Consumes: an `eventBus` with `subscribe(topic, cb) → unsub`; a `nutribotContainer` with `getLogFoodFromScale()`.
- Produces: `createScaleNutribotBridge({ eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics, logger }) → { dispose }`. Subscribes each topic (default `['food-scale']`); on a **settled** payload (`payload.stable === true`) with `grams ≥ scaleConfig.minGrams`, latches once per settle cycle (re-arms when the reading goes unstable or below the floor — mirrors `foodScaleRelay`), and invokes `getLogFoodFromScale().execute({ userId, conversationId, grams, unit, scaleId })`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

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
    execute = jest.fn().mockResolvedValue({ success: true });
    container = { getLogFoodFromScale: () => ({ execute }) };
    createScaleNutribotBridge({
      eventBus: bus, nutribotContainer: container,
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('fires once per settle cycle for a settled reading', () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' }); // repeat frame, latched
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ grams: 240, userId: 'kckern', conversationId: 'telegram:b1_c2', scaleId: 'kitchen' }));
  });

  it('re-arms after going unstable, then fires again', () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    bus.emit('food-scale', { id: 'kitchen', grams: 130, stable: false, unit: 'g' }); // changing → re-arm
    bus.emit('food-scale', { id: 'kitchen', grams: 300, stable: true, unit: 'g' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('ignores readings below min_grams', () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 2, stable: true, unit: 'g' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('ignores non-settled frames', () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: false, unit: 'g' });
    expect(execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/hardware/ScaleNutribotBridge.mjs
//
// Bridges the food-scale event-bus topic into nutribot. The relay re-broadcasts the
// FULL ~4 Hz stream (each frame carries a `stable` flag), so we latch to fire exactly
// once per settle cycle — the same policy foodScaleRelay uses for persistence.
//
// Target chat + user are resolved at wiring time (household head) and passed in; the
// bridge itself is device-agnostic.

const DEFAULT_TOPICS = ['food-scale'];

export function createScaleNutribotBridge({ eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics, logger = console }) {
  if (!eventBus?.subscribe) throw new Error('createScaleNutribotBridge: eventBus with subscribe required');
  if (!nutribotContainer?.getLogFoodFromScale) throw new Error('createScaleNutribotBridge: nutribotContainer required');

  const minGrams = scaleConfig?.minGrams ?? 5;
  const latched = new Map(); // scaleId -> boolean

  const onPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';
    const grams = Math.round(Number(payload.grams));
    const settled = payload.stable === true && Number.isFinite(grams) && grams >= minGrams;

    if (!settled) { latched.set(id, false); return; } // re-arm on change / near-zero
    if (latched.get(id)) return;                       // already fired this settle
    latched.set(id, true);

    Promise.resolve(
      nutribotContainer.getLogFoodFromScale().execute({
        userId, conversationId, grams, unit: payload.unit || 'g', scaleId: id,
      })
    ).catch((err) => logger.warn?.('scaleNutribot.dispatch.failed', { id, error: err.message }));
  };

  const unsubs = (topics && topics.length ? topics : DEFAULT_TOPICS).map((t) => eventBus.subscribe(t, onPayload));
  logger.info?.('scaleNutribot.bridge.ready', { conversationId, userId, minGrams, topics: topics || DEFAULT_TOPICS });

  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createScaleNutribotBridge;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/hardware/ScaleNutribotBridge.mjs tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs
git commit -m "feat(hardware): ScaleNutribotBridge — settled reading → LogFoodFromScale"
```

---

## Task 9: Wire `scaleConfig` + bridge into composition

**Files:**
- Modify: `backend/src/5_composition/bootstrap.mjs` (`createNutribotServices`, ~lines 2105–2199)
- Modify: `backend/src/app.mjs` (nutribot wiring, ~lines 2326–2343)

**Interfaces:**
- Consumes: `normalizeScaleNutribotConfig` (Task 1), `createScaleNutribotBridge` (Task 8), container getters (Task 6). In scope at the app.mjs wiring site: `eventBus`, `configService`, `userIdentityService`, `systemBots`, `householdId`, `rootLogger`, `nutribotServices`.
- Produces: `createNutribotServices` accepts `scaleRawConfig`, builds `scaleConfig = normalizeScaleNutribotConfig(scaleRawConfig)`, passes it to `NutribotContainer`, and returns it in the services object. `app.mjs` constructs the bridge targeting the household head.

> This is composition wiring; verification is by boot log, not a unit test.

- [ ] **Step 1: `bootstrap.mjs` — import + normalize + pass + return**

Add near the top imports of `bootstrap.mjs` (with the other `#apps/nutribot` imports):

```javascript
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
```

In `createNutribotServices`, add `scaleRawConfig` to the destructured `config` (alongside `nutribotConfig: rawNutribotConfig = {}`):

```javascript
    scaleRawConfig = {},
```

Immediately before `const nutribotContainer = new NutribotContainer(...)`, add:

```javascript
  const scaleConfig = normalizeScaleNutribotConfig(scaleRawConfig);
```

Add `scaleConfig` to the `NutribotContainer` options object (alongside `catalogService`):

```javascript
    scaleConfig,
```

Add `scaleConfig` to the returned object:

```javascript
  return {
    foodLogStore,
    nutriListStore,
    nutribotContainer,
    scaleConfig,
  };
```

- [ ] **Step 2: `app.mjs` — pass the raw scales config into `createNutribotServices`**

In the `createNutribotServices({ ... })` call (~line 2326), add:

```javascript
    scaleRawConfig: configService.getHouseholdAppConfig(householdId, 'scales'),
```

- [ ] **Step 3: `app.mjs` — import the bridge factory**

Alongside `import { createFoodScaleRelay } from '#apps/hardware/foodScaleRelay.mjs';` (~line 147):

```javascript
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';
```

- [ ] **Step 4: `app.mjs` — construct the bridge after `nutribotServices`**

Immediately after the `createNutribotServices(...)` call completes (after `const nutribotServices = await createNutribotServices({...});`), add:

```javascript
  // Scale → Nutribot: settled kitchen-scale weights become density-logged food entries,
  // posted to the household head. Target chat resolved from head identity.
  try {
    const scaleHeadUser = configService.getHeadOfHousehold();
    const scaleHeadPlatformId = scaleHeadUser
      ? userIdentityService.resolvePlatformId('telegram', scaleHeadUser)
      : null;
    const scaleBotId = systemBots.nutribot?.telegram?.bot_id || '';
    if (scaleHeadPlatformId && scaleBotId) {
      createScaleNutribotBridge({
        eventBus,
        nutribotContainer: nutribotServices.nutribotContainer,
        userId: scaleHeadUser,
        conversationId: `telegram:b${scaleBotId}_c${scaleHeadPlatformId}`,
        scaleConfig: nutribotServices.scaleConfig,
        logger: rootLogger.child({ module: 'scale-nutribot-bridge' }),
      });
    } else {
      rootLogger.warn?.('scaleNutribot.bridge.skipped', { hasPlatformId: !!scaleHeadPlatformId, hasBotId: !!scaleBotId });
    }
  } catch (e) {
    rootLogger.warn?.('scaleNutribot.bridge.wireFailed', { error: e.message });
  }
```

> If `systemBots` is not yet defined at this point in `app.mjs` (it is referenced later, ~line 2350), move this block to just after `systemBots` is assigned, keeping it after `nutribotServices`. Confirm ordering when editing.

- [ ] **Step 5: Verify boot + regression suite**

Run the nutribot + hardware suites and confirm no import/wiring breakage:

```bash
npx jest tests/unit/suite/applications/nutribot tests/unit/suite/applications/hardware tests/unit/suite/adapters/nutribot
```
Expected: all PASS.

Then boot the server and confirm the bridge log line:

```bash
node backend/src/app.mjs 2>&1 | grep -m1 'scaleNutribot.bridge'
```
Expected: `scaleNutribot.bridge.ready {...}` (or `.skipped` with a clear reason if head identity/bot id is absent in this environment).

- [ ] **Step 6: Commit**

```bash
git add backend/src/5_composition/bootstrap.mjs backend/src/app.mjs
git commit -m "feat(nutribot): wire ScaleNutribotBridge + scaleConfig into composition"
```

---

## Task 10: Document the `nutribot` config block

**Files:**
- Modify: `_extensions/food-scale-relay/config.example.yml`

**Interfaces:** none (documentation/config only). The real file `data/household/config/scales.yml` lives in the private data volume; the defaults in Task 1 mean the feature works before it is edited there.

- [ ] **Step 1: Append the `nutribot` block to the example**

Add to the end of `_extensions/food-scale-relay/config.example.yml`:

```yaml

# ---------------------------------------------------------------------------
# Nutribot integration: settled readings become density-logged food entries.
# Consumed by ScaleNutribotBridge / LogFoodFromScale. All keys optional — the
# backend supplies these same defaults (see
# backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs). The target
# chat is NOT configured here; it is the household head (household.yml `head`).
nutribot:
  min_grams: 5              # ignore settled readings below this (noise / near-zero)
  containers:
    threshold_g: 150        # only offer container (tare) subtraction above this gross weight
    items:
      - { id: dinner-plate, label: "Dinner plate", emoji: "🍽", grams: 340 }
      - { id: dinner-bowl,  label: "Dinner bowl",  emoji: "🥣", grams: 250 }
      - { id: small-bowl,   label: "Small bowl",   emoji: "🍚", grams: 180 }
      - { id: mug,          label: "Mug",          emoji: "☕", grams: 350 }
  density_levels:           # ordinal + non-linear; kcal_per_g is the source of truth
    - { level: 1, label: "Watery",    emoji: "🥬", kcal_per_g: 0.2 }
    - { level: 2, label: "Light",     emoji: "🥗", kcal_per_g: 0.6 }
    - { level: 3, label: "Lean",      emoji: "🍲", kcal_per_g: 1.0 }
    - { level: 4, label: "Everyday",  emoji: "🍛", kcal_per_g: 1.4 }
    - { level: 5, label: "Hearty",    emoji: "🍝", kcal_per_g: 1.9 }
    - { level: 6, label: "Filling",   emoji: "🍕", kcal_per_g: 2.6 }
    - { level: 7, label: "Rich",      emoji: "🧀", kcal_per_g: 3.8 }
    - { level: 8, label: "Very rich", emoji: "🥜", kcal_per_g: 6.0 }
    - { level: 9, label: "Pure fat",  emoji: "🫒", kcal_per_g: 8.5 }
```

- [ ] **Step 2: Commit**

```bash
git add _extensions/food-scale-relay/config.example.yml
git commit -m "docs(food-scale-relay): document nutribot density/container config block"
```

- [ ] **Step 3 (runtime, on host — after merge/deploy):** add the same `nutribot` block to the real `data/household/config/scales.yml` if you want to override defaults, using a heredoc inside `sudo docker exec daylight-station sh -c '...'` (NEVER `sed -i` on YAML — see CLAUDE.local.md). Defaults apply until then.

---

## End-to-end verification (after all tasks)

1. Full suite for the feature:
   ```bash
   npx jest tests/unit/suite/applications/nutribot tests/unit/suite/applications/hardware tests/unit/suite/adapters/nutribot
   ```
2. Live path (on host, no active fitness/Player session): place ~90 g of food on the scale → nutribot posts `⚖️ 90 g — what is it?` with the 9 density buttons. Tap **Everyday** → confirms `~126 kcal` with Accept/Revise/Discard.
3. Container path: place a full bowl (>150 g gross) → nutribot posts the container keyboard → tap **Dinner bowl −250** → density keyboard appears on the net weight.
4. Describe path: at the density prompt, type "leftover lasagna" → nutribot resolves calories from the AI's blended density × the exact grams.
5. Accept → the entry lands in the daily report exactly like any other log.

---

## Self-Review

**Spec coverage:**
- Thesis / density model → Task 1 (config + levels), Tasks 4/5 (calories = grams × kcal/g).
- Bridge / settle trigger / latch / min_grams → Task 8.
- Target = household head → Task 9.
- Pending entry appears immediately → Task 2.
- Tare / container subtraction → Tasks 1 (keyboard/config) + 3 (use case) + 7 (`'st'` route).
- Density tap (Path A) → Task 4 + Task 7 (`'sd'`).
- Describe (Path B, dedicated use case) → Task 5 + Task 7 (`scale_describe`).
- Container registration → Task 6. Composition wiring → Task 9. Config docs → Task 10.
- Callback encoding / short ids / net-before-calories / messaging pattern → Global Constraints, honoured per task.

**Placeholder scan:** No TBD/TODO. Two explicit "confirm when editing" notes (Task 6 accessor names, Task 9 `systemBots` ordering) point at real code to verify, not unresolved design.

**Type consistency:** `scaleConfig` shape (`minGrams`, `containers.thresholdG`, `containers.items[]`, `densityLevels[]`) is produced in Task 1 and consumed identically in Tasks 2–4, 8. Callback fields (`id`, `c`, `l`) match between builders (Task 1), router (Task 7), and use cases (Tasks 3–4). Getter names (`getLogFoodFromScale`, `getSelectScaleContainer`, `getSelectScaleDensity`, `getLogScaleFoodFromText`) match between Task 6 (defined) and Task 7 (consumed).
