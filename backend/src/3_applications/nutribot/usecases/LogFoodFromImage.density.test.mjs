import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromImage } from './LogFoodFromImage.mjs';

const DATA_URL = `data:image/jpeg;base64,${Buffer.from('not a real jpeg').toString('base64')}`;
const silent = { debug() {}, info() {}, warn() {}, error() {} };

const ITEMS = [{ name: 'Premier Protein Shake', grams: 385, calories: 610, protein: 66, carbs: 10, fat: 6 }];

const makeUseCase = ({ findings = [], catalog = true } = {}) => {
  const captions = [];
  const recorded = [];
  const catalogService = {
    assessDensity: vi.fn(async () => findings),
    recordUsage: vi.fn(async (item) => { recorded.push(item); }),
  };
  const chatWithImage = vi.fn(async () => JSON.stringify({ items: ITEMS }));
  const uc = new LogFoodFromImage({
    messagingGateway: {
      sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
      sendPhoto: vi.fn(async () => ({ messageId: 'p1' })),
      updateMessage: vi.fn(async (_conversationId, _msgId, updates) => { captions.push(updates.caption); }),
      deleteMessage: vi.fn(async () => {}),
      getFileUrl: vi.fn(async () => null),
    },
    aiGateway: { chatWithImage },
    foodLogStore: { save: vi.fn(async () => {}) },
    imageDownloader: { download: vi.fn(async () => Buffer.from('unused')) },
    catalogService: catalog ? catalogService : null,
    logger: silent,
  });
  return { uc, captions, catalogService, recorded, chatWithImage };
};

const run = (uc) => uc.execute({ userId: 'alice', conversationId: 'web:alice', imageData: { url: DATA_URL } });

describe('LogFoodFromImage — the density guard', () => {
  it('annotates the photo caption with what history expected', async () => {
    const { uc, captions } = makeUseCase({
      findings: [{ name: 'Premier Protein Shake', calories: 610, grams: 385, ratio: 3.27, expectedCalories: 187, sampleCount: 57 }],
    });
    expect((await run(uc)).success).toBe(true);
    expect(captions.at(-1)).toContain('610 kcal for 385 g');
    expect(captions.at(-1)).toContain('~187 kcal expected');
  });

  it('leaves the caption exactly as it was when nothing is flagged', async () => {
    const { uc, captions } = makeUseCase({ findings: [] });
    await run(uc);
    expect(captions.at(-1)).not.toContain('⚠️');
  });

  it('asks the catalog BEFORE donating the row', async () => {
    const order = [];
    const { uc, catalogService } = makeUseCase({});
    catalogService.assessDensity.mockImplementation(async () => { order.push('assess'); return []; });
    catalogService.recordUsage.mockImplementation(async () => { order.push('record'); });
    await run(uc);
    expect(order).toEqual(['assess', 'record']);
  });

  it('donates the mass and the row id', async () => {
    const { uc, recorded } = makeUseCase({});
    await run(uc);
    expect(recorded[0]).toMatchObject({ name: 'Premier Protein Shake', calories: 610, grams: 385 });
    expect(typeof recorded[0].logId).toBe('string');
  });

  it('a guard that throws does not take the capture down', async () => {
    const { uc, catalogService, captions } = makeUseCase({});
    catalogService.assessDensity.mockRejectedValue(new Error('catalog unreadable'));
    expect((await run(uc)).success).toBe(true);
    expect(captions.at(-1)).not.toContain('⚠️');
  });

  it('runs at all only when the catalog is wired', async () => {
    const { uc } = makeUseCase({ catalog: false });
    expect((await run(uc)).success).toBe(true);
  });

  it('tells the model the label is the food and the portion goes in grams', async () => {
    const { uc, chatWithImage } = makeUseCase({});
    await run(uc);
    const prompt = chatWithImage.mock.calls[0][0].map((m) => m.content).join('\n');
    expect(prompt).toContain('The "name" is the FOOD, and only the food');
    expect(prompt).toContain('must never appear in the name');
    expect(prompt).toContain('the SAME name');
  });
});
