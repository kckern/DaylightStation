import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromText } from './LogFoodFromText.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

const makeUseCase = ({ aiPayload, findings = [], catalog = true } = {}) => {
  const sent = [];
  const messagingGateway = {
    sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
    // The gateway signature is (conversationId, msgId, updates) — the use case
    // wraps it. Reading `opts.text` off the wrong argument would make every
    // assertion below vacuous.
    updateMessage: vi.fn(async (_conversationId, _msgId, updates) => { sent.push(updates.text); }),
    deleteMessage: vi.fn(async () => {}),
  };
  const recorded = [];
  const catalogService = {
    assessDensity: vi.fn(async () => findings),
    recordUsage: vi.fn(async (item) => { recorded.push(item); }),
  };
  const uc = new LogFoodFromText({
    messagingGateway,
    aiGateway: { chat: vi.fn(async () => JSON.stringify(aiPayload)) },
    foodLogStore: { save: vi.fn(async () => {}) },
    catalogService: catalog ? catalogService : null,
    logger: silent,
  });
  return { uc, sent, catalogService, recorded };
};

const SHAKE = {
  items: [{ name: 'Premier Protein Shake', grams: 385, calories: 610, protein: 66, carbs: 10, fat: 6 }],
  date: '2026-09-02', time: 'morning',
};

const run = (uc) => uc.execute({ userId: 'alice', conversationId: 'web:alice', text: 'one bottle of Premier Protein', messageId: 1 });

describe('LogFoodFromText — the density guard', () => {
  it('annotates the confirmation with what history expected, and logs the parsed number anyway', async () => {
    const { uc, sent } = makeUseCase({
      aiPayload: SHAKE,
      findings: [{ name: 'Premier Protein Shake', calories: 610, grams: 385, ratio: 3.27, expectedCalories: 187, sampleCount: 57 }],
    });
    const result = await run(uc);
    expect(result.success).toBe(true);
    const message = sent.at(-1);
    expect(message).toContain('610 kcal for 385 g');
    expect(message).toContain('~187 kcal expected');
    // The parsed number is still what got logged. The guard states, it does
    // not correct.
    expect(message).toContain('Premier Protein Shake');
  });

  it('leaves the message byte-identical when nothing is flagged', async () => {
    const flagged = makeUseCase({
      aiPayload: SHAKE,
      findings: [{ name: 'Premier Protein Shake', calories: 610, grams: 385, ratio: 3.27, expectedCalories: 187, sampleCount: 57 }],
    });
    await run(flagged.uc);
    const quiet = makeUseCase({ aiPayload: SHAKE, findings: [] });
    await run(quiet.uc);
    expect(quiet.sent.at(-1)).not.toContain('⚠️');
    expect(flagged.sent.at(-1)).toBe(`${quiet.sent.at(-1)}\n\n${'⚠️ Premier Protein Shake: 610 kcal for 385 g is 3.3× your usual for this food (~187 kcal expected, from 57 past logs).\nTap Revise if the portion is wrong.'}`);
  });

  it('asks the catalog BEFORE donating the row — a row must not move the median it is judged against', async () => {
    const order = [];
    const { uc, catalogService } = makeUseCase({ aiPayload: SHAKE });
    catalogService.assessDensity.mockImplementation(async () => { order.push('assess'); return []; });
    catalogService.recordUsage.mockImplementation(async () => { order.push('record'); });
    await run(uc);
    expect(order).toEqual(['assess', 'record']);
  });

  it('donates the MASS and the row id, so the catalog can hold an observation at all', async () => {
    const { uc, recorded } = makeUseCase({ aiPayload: SHAKE });
    await run(uc);
    expect(recorded[0]).toMatchObject({ name: 'Premier Protein Shake', calories: 610, grams: 385, unit: 'g' });
    expect(typeof recorded[0].logId).toBe('string');
    expect(recorded[0].logId.length).toBeGreaterThan(0);
  });

  it('a guard that throws does not take the capture down', async () => {
    const { uc, catalogService, sent } = makeUseCase({ aiPayload: SHAKE });
    catalogService.assessDensity.mockRejectedValue(new Error('catalog unreadable'));
    const result = await run(uc);
    expect(result.success).toBe(true);
    expect(sent.at(-1)).not.toContain('⚠️');
  });

  it('runs at all only when the catalog is wired', async () => {
    const { uc } = makeUseCase({ aiPayload: SHAKE, catalog: false });
    expect((await run(uc)).success).toBe(true);
  });
});

describe('LogFoodFromText — the parse prompt', () => {
  const promptText = async () => {
    const chat = vi.fn(async () => JSON.stringify(SHAKE));
    const uc = new LogFoodFromText({
      messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
      aiGateway: { chat },
      foodLogStore: { save: vi.fn(async () => {}) },
      logger: silent,
    });
    await run(uc);
    return chat.mock.calls[0][0].map((m) => m.content).join('\n');
  };

  it('tells the model the label is the food and the portion goes in grams', async () => {
    // 15 "Premier Protein …(Bottle)/(335ml)/(Handful)" variants exist because
    // nothing ever said this. Each variant is its own catalog entry with its
    // own history, which is how a food ends up with no history at all.
    const prompt = await promptText();
    expect(prompt).toContain('The "name" is the FOOD, and only the food');
    expect(prompt).toContain('must never appear in the name');
    expect(prompt).toContain('(Bottle)');
    expect(prompt).toContain('the SAME name');
  });
});
