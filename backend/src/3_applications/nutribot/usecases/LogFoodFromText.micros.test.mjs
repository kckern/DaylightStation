import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromText } from './LogFoodFromText.mjs';

// Task 6.2 — micronutrient PROVENANCE through the text-capture pipeline.
//
// The stored shape defaults every micro `?? 0` (validateFoodItem), so the
// numbers alone cannot say whether anyone measured them. `microsSource` is the
// only field that can, and BudgetService.microCoverage reads it to decide
// whether a sodium bar is honest. These tests pin that it is set where — and
// ONLY where — the model actually answered with micros.

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function makeUseCase(aiPayload) {
  const saved = [];
  const foodLogStore = { save: vi.fn(async (log) => { saved.push(log); }) };
  const uc = new LogFoodFromText({
    messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
    aiGateway: { chat: vi.fn(async () => JSON.stringify(aiPayload)) },
    foodLogStore,
    logger: silent,
  });
  return { uc, saved };
}

const run = async (uc) => uc.execute({ userId: 'alice', conversationId: 'web:alice', text: 'whatever', messageId: 1 });

describe('LogFoodFromText — micro provenance', () => {
  it("stamps microsSource:'ai' on an item the model answered with micros for", async () => {
    const { uc, saved } = makeUseCase({
      items: [{ name: 'Chili', grams: 300, calories: 400, protein: 25, carbs: 30, fat: 15, fiber: 9, sugar: 6, sodium: 980, cholesterol: 55 }],
      date: '2026-09-02', time: 'evening',
    });
    await run(uc);
    const item = saved.at(-1).items[0];
    expect(item.microsSource).toBe('ai');
    expect(item.sodium).toBe(980);
    expect(item.fiber).toBe(9);
  });

  it('leaves microsSource NULL when the model returned macros only — the structural zeros are not a measurement', async () => {
    const { uc, saved } = makeUseCase({
      items: [{ name: 'Apple', grams: 180, calories: 95, protein: 0.5, carbs: 25, fat: 0.3 }],
      date: '2026-09-02', time: 'morning',
    });
    await run(uc);
    const item = saved.at(-1).items[0];
    // The row still stores 0s — that is the schema — but nothing claims them.
    expect(item.sodium).toBe(0);
    expect(item.microsSource).toBeNull();
  });

  it('a MEASURED zero counts as data — a model that says sodium is 0 is answering', async () => {
    const { uc, saved } = makeUseCase({
      items: [{ name: 'Water', grams: 250, calories: 0, fiber: 0, sugar: 0, sodium: 0, cholesterol: 0 }],
      date: '2026-09-02', time: 'morning',
    });
    await run(uc);
    expect(saved.at(-1).items[0].microsSource).toBe('ai');
  });

  it('a synthesized dish header never claims provenance, while its members keep theirs', async () => {
    const { uc, saved } = makeUseCase({
      items: [
        { name: 'Noodles', grams: 200, calories: 260, fiber: 3, sugar: 2, sodium: 12, cholesterol: 0, dish: 'Spaghetti' },
        { name: 'Sauce', grams: 120, calories: 90, fiber: 2, sugar: 8, sodium: 480, cholesterol: 0, dish: 'Spaghetti' },
      ],
      date: '2026-09-02', time: 'evening',
    });
    await run(uc);
    const items = saved.at(-1).items;
    const group = items.find((i) => i.kind === 'group');
    const members = items.filter((i) => i.kind === 'item');
    expect(group.microsSource).toBeNull();
    expect(members).toHaveLength(2);
    expect(members.every((m) => m.microsSource === 'ai')).toBe(true);
  });

  it('the prompt asks for all four micros by name', async () => {
    const { uc } = makeUseCase({ items: [], date: '2026-09-02' });
    const chat = vi.fn(async () => JSON.stringify({ items: [], date: '2026-09-02' }));
    const uc2 = new LogFoodFromText({
      messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
      aiGateway: { chat },
      foodLogStore: { save: vi.fn() },
      logger: silent,
    });
    await run(uc2);
    const system = chat.mock.calls[0][0].find((m) => m.role === 'system').content;
    for (const key of ['fiber', 'sugar', 'sodium', 'cholesterol']) {
      expect(system).toContain(key);
    }
    expect(uc).toBeTruthy();
  });
});

describe('LogFoodFromText — partial micro answers (C2)', () => {
  it('the stored row still gets its structural zeros — that is the schema', async () => {
    const { uc, saved } = makeUseCase({
      items: [{ name: 'Ramen', grams: 400, calories: 400, sodium: 1900 }],
      date: '2026-09-02', time: 'evening',
    });
    await run(uc);
    const item = saved.at(-1).items[0];
    expect(item.sodium).toBe(1900);
    expect(item.fiber).toBe(0);
    expect(item.microsSource).toBe('ai');
  });

  it('but the CATALOG is offered only the micro the model answered — the zeros never leave the row', async () => {
    const recordUsage = vi.fn(async () => {});
    const uc = new LogFoodFromText({
      messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
      aiGateway: { chat: vi.fn(async () => JSON.stringify({
        items: [{ name: 'Ramen', grams: 400, calories: 400, sodium: 1900 }],
        date: '2026-09-02', time: 'evening',
      })) },
      foodLogStore: { save: vi.fn(async () => {}) },
      catalogService: { recordUsage },
      logger: silent,
    });
    await run(uc);
    const donated = recordUsage.mock.calls[0][0];
    expect(donated.sodium).toBe(1900);
    expect(donated.microsSource).toBe('ai');
    // The bug: `fiber: 0` reaching the catalog here becomes a permanent,
    // self-propagating 'catalog' reading on every future quick-add.
    for (const key of ['fiber', 'sugar', 'cholesterol']) {
      expect(Object.prototype.hasOwnProperty.call(donated, key)).toBe(false);
    }
  });
});

describe('LogFoodFromText — catalog donation', () => {
  it('forwards micros AND provenance to the catalog, so a later quick-add can inherit them', async () => {
    const recordUsage = vi.fn(async () => {});
    const uc = new LogFoodFromText({
      messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
      aiGateway: { chat: vi.fn(async () => JSON.stringify({
        items: [{ name: 'Chili', grams: 300, calories: 400, protein: 25, carbs: 30, fat: 15, fiber: 9, sugar: 6, sodium: 980, cholesterol: 55 }],
        date: '2026-09-02', time: 'evening',
      })) },
      foodLogStore: { save: vi.fn(async () => {}) },
      catalogService: { recordUsage },
      logger: silent,
    });
    await run(uc);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).toMatchObject({
      name: 'Chili', sodium: 980, fiber: 9, sugar: 6, cholesterol: 55, microsSource: 'ai',
    });
  });
});
