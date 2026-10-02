/**
 * The use case is unchanged and must not notice the wire layer: a TOON reply
 * through the layer yields the same saved items as the equivalent JSON reply.
 */
import { describe, it, expect, vi } from 'vitest';
import { encode } from '@toon-format/toon';
import { StructuredWireLayer } from './StructuredWireLayer.mjs';
import { LogFoodFromText } from '#apps/nutribot/usecases/LogFoodFromText.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const COLUMNS = ['name', 'icon', 'noom_color', 'quantity', 'unit', 'grams', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol', 'dish'];
const payload = {
  date: '2026-09-02', time: 'evening',
  items: [
    { name: 'Rice Noodles, In Broth', icon: 'default', noom_color: 'yellow', quantity: 200, unit: 'g', grams: 200, calories: 260, protein: 5, carbs: 55, fat: 1, fiber: 2, sugar: 1, sodium: 600, cholesterol: 0, dish: 'Curry Noodle Soup' },
    { name: 'Chicken Thigh', icon: 'default', noom_color: 'yellow', quantity: 120, unit: 'g', grams: 120, calories: 250, protein: 28, carbs: 0, fat: 15, fiber: 0, sugar: 0, sodium: 110, cholesterol: 140, dish: 'Curry Noodle Soup' },
    { name: 'Iced Tea', icon: 'default', noom_color: 'green', quantity: 350, unit: 'ml', grams: 350, calories: 5, protein: 0, carbs: 1, fat: 0, fiber: 0, sugar: 0, sodium: 10, cholesterol: 0 },
  ],
};
const toonReply = encode({ ...payload, items: payload.items.map((i) => Object.fromEntries(COLUMNS.map((c) => [c, i[c] ?? '']))) }, { delimiter: '\t' });

async function savedItems(aiGateway) {
  const saved = [];
  const uc = new LogFoodFromText({
    messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
    aiGateway,
    foodLogStore: { save: vi.fn(async (log) => { saved.push(log); }) },
    logger: silent,
  });
  await uc.execute({ userId: 'alice', conversationId: 'web:alice', text: 'curry noodle soup and an iced tea', messageId: 1 });
  return saved.at(-1).items.map(({ id, parentId, ...rest }) => rest);
}

describe('LogFoodFromText over the wire layer', () => {
  it('a TOON reply saves the same items as the equivalent JSON reply', async () => {
    const viaJson = await savedItems({ chat: vi.fn(async () => JSON.stringify(payload)) });
    const innerChat = vi.fn(async () => toonReply);
    const viaToon = await savedItems(new StructuredWireLayer({ chat: innerChat }, { mode: 'full', sample: 1, random: () => 0 }));
    expect(innerChat.mock.calls[0][0][0].content).toMatch(/items\[N\t\]\{name\t/); // TOON really was requested
    expect(viaToon).toEqual(viaJson);
    expect(viaToon.length).toBeGreaterThan(3); // dish header + members + standalone
  });
});
