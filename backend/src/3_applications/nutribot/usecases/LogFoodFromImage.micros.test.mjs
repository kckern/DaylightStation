import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromImage } from './LogFoodFromImage.mjs';

// Task 6.2 — the photo path carries the same provenance contract as the text
// path (LogFoodFromText.micros.test.mjs). Two capture surfaces, one rule.

const DATA_URL = `data:image/jpeg;base64,${Buffer.from('not a real jpeg').toString('base64')}`;
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function makeUseCase(aiItems, { catalogService = null } = {}) {
  const saved = [];
  const uc = new LogFoodFromImage({
    messagingGateway: {
      sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
      sendPhoto: vi.fn(async () => ({ messageId: 'p1' })),
      updateMessage: vi.fn(async () => {}),
      deleteMessage: vi.fn(async () => {}),
      getFileUrl: vi.fn(async () => null),
    },
    aiGateway: { chatWithImage: vi.fn(async () => JSON.stringify({ items: aiItems })) },
    foodLogStore: { save: vi.fn(async (log) => { saved.push(log); }) },
    imageDownloader: { download: vi.fn(async () => Buffer.from('unused')) },
    catalogService,
    logger: silent,
  });
  return { uc, saved };
}

const run = (uc) => uc.execute({ userId: 'alice', conversationId: 'web:alice', imageData: { url: DATA_URL } });

describe('LogFoodFromImage — micro provenance', () => {
  it("stamps 'ai' when the model returned micros and null when it did not, in the same parse", async () => {
    const { uc, saved } = makeUseCase([
      { name: 'Salmon', grams: 150, calories: 300, fiber: 0, sugar: 0, sodium: 90, cholesterol: 80 },
      { name: 'Rice', grams: 150, calories: 200 },
    ]);
    await run(uc);
    const items = saved.at(-1).items;
    expect(items.find((i) => i.label === 'Salmon').microsSource).toBe('ai');
    const rice = items.find((i) => i.label === 'Rice');
    expect(rice.sodium).toBe(0);          // the schema's structural zero
    expect(rice.microsSource).toBeNull(); // ...unclaimed
  });

  it('a dish header synthesized from a photo carries no provenance', async () => {
    const { uc, saved } = makeUseCase([
      { name: 'Bun', grams: 50, calories: 120, sodium: 200, fiber: 1, sugar: 3, cholesterol: 0, dish: 'Burger' },
      { name: 'Patty', grams: 100, calories: 250, sodium: 400, fiber: 0, sugar: 0, cholesterol: 70, dish: 'Burger' },
    ]);
    await run(uc);
    const items = saved.at(-1).items;
    expect(items.find((i) => i.kind === 'group').microsSource).toBeNull();
    expect(items.filter((i) => i.kind === 'item').every((i) => i.microsSource === 'ai')).toBe(true);
  });

  it('donates only the micro the model answered, never the row\'s structural zeros (C2)', async () => {
    const recordUsage = vi.fn(async () => {});
    const { uc, saved } = makeUseCase(
      [{ name: 'Ramen', grams: 400, calories: 400, sodium: 1900 }],
      { catalogService: { recordUsage } },
    );
    await run(uc);
    expect(saved.at(-1).items[0].fiber).toBe(0); // stored shape unchanged
    const donated = recordUsage.mock.calls[0][0];
    expect(donated.sodium).toBe(1900);
    expect(Object.prototype.hasOwnProperty.call(donated, 'fiber')).toBe(false);
  });

  it('forwards micros and provenance to the catalog', async () => {
    const recordUsage = vi.fn(async () => {});
    const { uc } = makeUseCase(
      [{ name: 'Salmon', grams: 150, calories: 300, fiber: 0, sugar: 0, sodium: 90, cholesterol: 80 }],
      { catalogService: { recordUsage } },
    );
    await run(uc);
    expect(recordUsage.mock.calls[0][0]).toMatchObject({ name: 'Salmon', sodium: 90, microsSource: 'ai' });
  });
});
