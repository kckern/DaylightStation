import { describe, it, expect } from 'vitest';
import { buildScalePromptText } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';

describe('buildScalePromptText', () => {
  it('shows gross only when nothing is tared', () => {
    const text = buildScalePromptText({ gross: 420, composition: { container: null } }, { items: [] });
    expect(text).toContain('420');
    expect(text).not.toMatch(/net/i);
  });

  it('matches the legacy slim prompt exactly when there is no composition at all', () => {
    // The pre-existing prompt body was `⚖️ ${grams} g` and the Jest suite pins it.
    expect(buildScalePromptText({ gross: 340 })).toBe('⚖️ 340 g');
  });

  it('names the container and shows the net once a tare is scanned', () => {
    const text = buildScalePromptText(
      { gross: 420, composition: { container: 'mug' } },
      { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
    );
    expect(text).toContain('☕ Mug');
    expect(text).toContain('350');
    expect(text).toMatch(/70\s*g/); // 420 gross - 350 tare
  });

  it('refuses the tare (rather than reporting 0 or a negative) when it outweighs the gross', () => {
    const text = buildScalePromptText(
      { gross: 100, composition: { container: 'mug' } },
      { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
    );
    // A 0 g net is unstorable (FoodItem requires grams > 0) and would read as a
    // silent 0 kcal entry, so the tare is refused and said so out loud.
    expect(text).not.toMatch(/-\d/);
    expect(text).not.toContain('= 0 g net');
    expect(text).toMatch(/not tared/);
  });

  it('flags a container that is no longer in config rather than dropping it', () => {
    const text = buildScalePromptText(
      { gross: 420, composition: { container: 'teapot' } },
      { items: [] },
    );
    expect(text).toMatch(/unknown container/i);
    expect(text).toContain('teapot');
  });

  it('falls back to the container id when it carries no label', () => {
    const text = buildScalePromptText(
      { gross: 420, composition: { container: 'jar' } },
      { items: [{ id: 'jar', grams: 200 }] },
    );
    expect(text).toContain('jar');
    expect(text).toContain('= 220 g net');
  });
});

// ---------------------------------------------------------------------------
// PERSISTED-LOG assertions. The prompt rendering above was already covered; what
// was NOT covered — and what let a 6x calorie overcount ship — is what actually
// lands in the food log. `SelectScaleDensity` multiplies `items[0].grams` by
// kcal_per_g, so if that field holds GROSS while the prompt says NET, the log
// silently contradicts the message the user approved.
// ---------------------------------------------------------------------------

import { LogFoodFromScale } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';
import { SelectScaleContainer } from '#apps/nutribot/usecases/SelectScaleContainer.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const MUG = { id: 'mug', label: 'Mug', emoji: '☕', grams: 350 };

function harness(containers = [MUG]) {
  const saved = [];
  const messaging = {
    sendMessage: async () => ({ messageId: '900' }),
    updateMessage: async () => ({}),
  };
  const foodLogStore = { save: async (log) => { saved.push(log); } };
  const scaleConfig = normalizeScaleNutribotConfig({ containers: { items: containers } });
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const useCase = new LogFoodFromScale({
    messagingGateway: messaging,
    foodLogStore,
    conversationStateStore: { set: async () => {} },
    scaleConfig,
    config: { getUserTimezone: () => 'America/Los_Angeles' },
    logger,
  });
  return { useCase, saved, scaleConfig, logger, messaging };
}

function itemsOf(log) {
  return typeof log.toJSON === 'function' ? log.toJSON().items : log.items;
}

describe('LogFoodFromScale.execute — persisted grams', () => {
  it('persists NET, not gross, when a container was scanned', async () => {
    const { useCase, saved } = harness();
    await useCase.execute({
      userId: 'kckern', conversationId: 'c', grams: 420, unit: 'g', scaleId: 'kitchen',
      composition: { container: 'mug' },
    });
    // 420 g gross - 350 g mug = 70 g net. Persisting 420 here yields 588 kcal at
    // 1.4 kcal/g ("Mixed") instead of 98 — a 6x overcount.
    expect(itemsOf(saved[0])[0].grams).toBe(70);
    expect(saved[0].toJSON().metadata.grossGrams).toBe(420);
  });

  it('prompt text and persisted grams cannot disagree', async () => {
    const { useCase, saved, messaging } = harness();
    let text = null;
    messaging.sendMessage = async (_c, t) => { text = t; return { messageId: '900' }; };
    await useCase.execute({
      userId: 'kckern', conversationId: 'c', grams: 420, unit: 'g', scaleId: 'kitchen',
      composition: { container: 'mug' },
    });
    const persisted = itemsOf(saved[0])[0].grams;
    expect(text).toContain(`= ${persisted} g net`);
    expect(persisted).toBe(70);
  });

  it('untared composition still persists gross and renders the byte-identical legacy prompt', async () => {
    const { useCase, saved, messaging } = harness();
    let text = null;
    messaging.sendMessage = async (_c, t) => { text = t; return { messageId: '900' }; };
    await useCase.execute({ userId: 'kckern', conversationId: 'c', grams: 340, unit: 'g', scaleId: 'kitchen' });
    expect(text).toBe('⚖️ 340 g');
    expect(itemsOf(saved[0])[0].grams).toBe(340);
  });

  it('never persists a negative or zero net when the tare outweighs the gross', async () => {
    const { useCase, saved, messaging } = harness();
    let text = null;
    messaging.sendMessage = async (_c, t) => { text = t; return { messageId: '900' }; };
    await useCase.execute({
      userId: 'kckern', conversationId: 'c', grams: 100, unit: 'g', scaleId: 'kitchen',
      composition: { container: 'mug' },
    });
    // computeNet would clamp to 0, but FoodItem requires grams > 0 and a 0 g row
    // is the silent-0-kcal entry the domain exists to prevent. So the tare is
    // refused, the gross stays on the record, and the prompt says it was not tared.
    const persisted = itemsOf(saved[0])[0].grams;
    expect(persisted).toBe(100);
    expect(persisted).toBeGreaterThan(0);
    expect(text).toMatch(/not tared/);
  });

  it('edit-in-place path also persists net', async () => {
    const { useCase, saved } = harness();
    const existing = {
      id: 'log1', status: 'pending',
      items: [{ label: 'Unknown', grams: 210, calories: 0, unit: 'g' }],
      metadata: { source: 'scale', grossGrams: 210, containerId: null, densityLevel: null, messageId: '900' },
      with(patch) { return { ...this, ...patch, with: this.with }; },
    };
    const store = { findByUuid: async () => existing, save: async (l) => { saved.push(l); } };
    const useCase2 = new LogFoodFromScale({
      messagingGateway: { sendMessage: async () => ({}), updateMessage: async () => ({}) },
      foodLogStore: store,
      conversationStateStore: { set: async () => {} },
      scaleConfig: normalizeScaleNutribotConfig({ containers: { items: [MUG] } }),
      config: { getUserTimezone: () => 'America/Los_Angeles' },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    await useCase2.execute({
      userId: 'kckern', conversationId: 'c', grams: 420, existingLogUuid: 'log1', messageId: '900',
      composition: { container: 'mug' },
    });
    expect(saved[saved.length - 1].items[0].grams).toBe(70);
    expect(saved[saved.length - 1].metadata.grossGrams).toBe(420);
  });
});

describe('net is computed identically on both paths', () => {
  it('SelectScaleContainer and the scan path agree for the same gross + container', async () => {
    const { useCase, saved } = harness();
    await useCase.execute({
      userId: 'kckern', conversationId: 'c', grams: 420, unit: 'g', scaleId: 'kitchen',
      composition: { container: 'mug' },
    });
    const scanNet = itemsOf(saved[0])[0].grams;

    const buttonSaved = [];
    const existing = {
      id: 'log1', status: 'pending',
      items: [{ label: 'Unknown', grams: 420, calories: 0, unit: 'g' }],
      metadata: { source: 'scale', grossGrams: 420 },
      with(patch) { return { ...this, ...patch, with: this.with }; },
    };
    const btn = new SelectScaleContainer({
      messagingGateway: { updateMessage: async () => ({}) },
      foodLogStore: { findByUuid: async () => existing, save: async (l) => { buttonSaved.push(l); } },
      conversationStateStore: { set: async () => {} },
      scaleConfig: normalizeScaleNutribotConfig({ containers: { items: [MUG] } }),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const res = await btn.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'log1', containerId: 'mug', messageId: '900' });

    expect(res.net).toBe(scanNet);
    expect(buttonSaved[0].items[0].grams).toBe(scanNet);
  });

  it('SelectScaleContainer still refuses a tare heavier than the gross (tooHeavy)', async () => {
    const warns = [];
    const buttonSaved = [];
    const existing = {
      id: 'log1', status: 'pending',
      items: [{ label: 'Unknown', grams: 100, calories: 0, unit: 'g' }],
      metadata: { source: 'scale', grossGrams: 100 },
      with(patch) { return { ...this, ...patch, with: this.with }; },
    };
    const btn = new SelectScaleContainer({
      messagingGateway: { updateMessage: async () => ({}) },
      foodLogStore: { findByUuid: async () => existing, save: async (l) => { buttonSaved.push(l); } },
      conversationStateStore: { set: async () => {} },
      scaleConfig: normalizeScaleNutribotConfig({ containers: { items: [MUG] } }),
      logger: { debug() {}, info() {}, warn: (e, d) => warns.push([e, d]), error() {} },
    });
    const res = await btn.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'log1', containerId: 'mug', messageId: '900' });
    // unchanged user-visible outcome: no tare applied, container not recorded
    expect(res.net).toBe(100);
    expect(buttonSaved[0].items[0].grams).toBe(100);
    expect(buttonSaved[0].metadata.containerId).toBe(null);
    expect(warns.map((w) => w[0])).toContain('selectContainer.tooHeavy');
  });
});
