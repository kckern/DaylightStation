import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromUPC } from './LogFoodFromUPC.mjs';

const messaging = () => ({ sendMessage: vi.fn(async () => ({ messageId: 'm1' })), sendPhoto: vi.fn(async () => ({ messageId: 'm2' })),
  updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}) });
const product = (nutrition) => ({ upc: '037000338369', name: 'Magazine', serving: { size: 1, unit: 'serving' }, nutrition,
  nutritionLookup: { source: 'openfoodfacts', warnings: ['Nutrition unavailable'] } });
const make = (gatewayHit, { ai, icons } = {}) => {
  const saved = [];
  const foodLogStore = { save: vi.fn(async log => { saved.push(log); }), findById: vi.fn(async () => saved.at(-1)) };
  const reviewService = { capture: vi.fn(async () => {}) };
  const upcGateway = { lookup: vi.fn(async () => gatewayHit) };
  const logger = { debug() {}, info: vi.fn(), warn() {}, error() {} };
  const uc = new LogFoodFromUPC({ messagingGateway: messaging(), upcGateway, foodLogStore, reviewService,
    aiGateway: ai, foodIconsString: icons, logger });
  return { uc, upcGateway, foodLogStore, reviewService, saved, logger };
};

describe('LogFoodFromUPC intake gate', () => {
  // A refusal is a coded error, not a result: each entry point (relay, Telegram,
  // web, HTTP) translates NUTRIBOT_UPC_REJECTED into something its user sees.
  it('refuses a code with a bad check digit before any lookup, with a coded error', async () => {
    const { uc, upcGateway } = make(null);
    await expect(uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338368', headless: true }))
      .rejects.toMatchObject({ code: 'NUTRIBOT_UPC_REJECTED', name: 'ValidationError',
        context: { reason: 'check-digit', upc: '037000338368' }, message: "That isn't a food barcode (check digit)." });
    expect(upcGateway.lookup).not.toHaveBeenCalled();
  });

  it('refuses an ISBN', async () => {
    const { uc, upcGateway } = make(null);
    await expect(uc.execute({ userId: 'u', conversationId: 'c', upc: '9780306406157', headless: true }))
      .rejects.toMatchObject({ code: 'NUTRIBOT_UPC_REJECTED', context: { reason: 'isbn' }, message: "That's a book (ISBN), not a food." });
    expect(upcGateway.lookup).not.toHaveBeenCalled();
  });

  it('refuses under an operation id too, without saving anything', async () => {
    const { uc, foodLogStore } = make(null);
    await expect(uc.execute({ userId: 'u', conversationId: 'c', upc: '12345', operationId: 'bad', headless: true }))
      .rejects.toMatchObject({ code: 'NUTRIBOT_UPC_REJECTED', context: { reason: 'length' } });
    expect(foodLogStore.save).not.toHaveBeenCalled();
  });

  it('a product that is not found is still a plain result the web reads as unknownUpc', async () => {
    const { uc } = make(null);
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out).toEqual({ success: false, error: 'Product not found', unknownUpc: true, upc: '037000338369' });
  });

  it('looks up the collapsed code for a doubled read', async () => {
    const { uc, upcGateway } = make(product({ calories: 100 }));
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369037000338369', headless: true });
    expect(upcGateway.lookup).toHaveBeenCalledWith('037000338369');
  });

  it('a replayed doubled read with the same operation id is the same capture, not a 409', async () => {
    const { uc, upcGateway } = make(product({ calories: 100 }));
    const first = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369037000338369', operationId: 'op1', headless: true });
    const again = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369037000338369', operationId: 'op1', headless: true });
    expect(again).toMatchObject({ success: true, alreadyProcessed: true, nutrilogUuid: first.nutrilogUuid });
    expect(upcGateway.lookup).toHaveBeenCalledTimes(1);
  });
});

describe('LogFoodFromUPC quarantine', () => {
  const noCalories = { calories: null, protein: 3, carbs: null, fat: null };

  it('a product with no calories stays pending, marked, and is never accepted into the ledger', async () => {
    const { uc, reviewService, foodLogStore } = make(product(noCalories));
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out).toMatchObject({ success: true, quarantined: true, committed: false });
    expect(reviewService.capture).not.toHaveBeenCalled();
    const log = foodLogStore.save.mock.calls[0][0];
    expect(log.status).toBe('pending');
    expect(log.metadata).toMatchObject({ quarantined: true, quarantineReason: 'no-calories' });
    // Needs Review reads `missing` to ask for the label calories and to demand them on confirm.
    expect(log.metadata.nutritionLookup.missing).toContain('calories');
  });

  it('an empty-string calorie value is unknown, not zero', async () => {
    const { uc, reviewService } = make(product({ calories: '', protein: 1, carbs: 1, fat: 1 }));
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out.quarantined).toBe(true);
    expect(reviewService.capture).not.toHaveBeenCalled();
  });

  it('a known 0 kcal is not quarantined, even with other nutrients unknown', async () => {
    const { uc, reviewService, foodLogStore } = make(product({ calories: 0, protein: null, carbs: null, fat: null }));
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out.quarantined).toBe(false);
    expect(reviewService.capture).toHaveBeenCalled();
    expect(foodLogStore.save.mock.calls[0][0].metadata.quarantined).toBeUndefined();
  });

  it('a replay of a quarantined capture reads the stored marker and does not accept it', async () => {
    const { uc, reviewService } = make(product(noCalories));
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', operationId: 'op2', headless: true });
    const again = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', operationId: 'op2', headless: true });
    expect(again).toMatchObject({ success: true, alreadyProcessed: true, quarantined: true, committed: false });
    expect(reviewService.capture).not.toHaveBeenCalled();
  });

  it('a replay of a pending capture that is NOT quarantined is captured', async () => {
    const { uc, reviewService, saved } = make(product({ calories: 100 }));
    reviewService.capture.mockRejectedValueOnce(new Error('ledger busy'));
    await expect(uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', operationId: 'op3', headless: true })).rejects.toThrow('ledger busy');
    expect(saved.at(-1).status).toBe('pending');
    const again = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', operationId: 'op3', headless: true });
    expect(again).toMatchObject({ success: true, alreadyProcessed: true, committed: true, quarantined: false });
    expect(reviewService.capture).toHaveBeenCalledTimes(2);
  });

  it('a different barcode under the same operation id is a 409', async () => {
    const { uc } = make(product({ calories: 100 }));
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', operationId: 'op4', headless: true });
    await expect(uc.execute({ userId: 'u', conversationId: 'c', upc: '012345678905', operationId: 'op4', headless: true }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('concurrent raw and doubled reads of one code under one operation id share the capture', async () => {
    const { uc, upcGateway } = make(product({ calories: 100 }));
    const [a, b] = await Promise.all([
      uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', operationId: 'op5', headless: true }),
      uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369037000338369', operationId: 'op5', headless: true }),
    ]);
    expect(a.nutrilogUuid).toBe(b.nutrilogUuid);
    expect(upcGateway.lookup).toHaveBeenCalledTimes(1);
  });

  it('a failure after a quarantined capture is saved does not turn it into an error', async () => {
    const saved = [];
    const foodLogStore = { save: vi.fn(async log => { saved.push(log); }), findById: vi.fn(async () => saved.at(-1)) };
    const uc = new LogFoodFromUPC({ messagingGateway: messaging(), upcGateway: { lookup: vi.fn(async () => product(noCalories)) },
      foodLogStore, reviewService: { capture: vi.fn() }, receipts: () => ({ bind: async () => { throw new Error('receipt store down'); } }),
      logger: { debug() {}, info() {}, warn: vi.fn(), error() {} } });
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out).toMatchObject({ success: true, quarantined: true, committed: false, deliveryFailed: true });
  });
});

describe('LogFoodFromUPC icon and serving', () => {
  const pb = { upc: '037600225250', name: 'Peanut Butter Spread', icon: '🍽️', serving: { size: 100, unit: 'g' },
    nutrition: { calories: 656.25, protein: 25, carbs: 20, fat: 50 },
    nutritionLookup: { source: 'openfoodfacts', servingFallback: 'per100', servingText: '2 tbsp', warnings: ['x'] } };
  const ai = { chat: vi.fn(async () => '{"icon":"peanut-butter","noomColor":"orange","servingGrams":32}') };

  it('uses the classifier icon, not the gateway placeholder', async () => {
    const { uc, foodLogStore } = make(pb, { ai, icons: 'peanut-butter carrot' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    expect(foodLogStore.save.mock.calls[0][0].items[0].icon).toBe('peanut-butter');
  });

  it('scales a per-100 fallback to the classifier\'s gram estimate of the label serving', async () => {
    const { uc, foodLogStore } = make(pb, { ai, icons: 'peanut-butter' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    const item = foodLogStore.save.mock.calls[0][0].items[0];
    expect(item.grams).toBe(32);
    expect(item.calories).toBeCloseTo(210, 0);
  });

  const withEstimate = servingGrams => ({ chat: vi.fn(async () => JSON.stringify({ icon: 'peanut-butter', noomColor: 'orange', servingGrams })) });

  it('accepts a numeric string estimate', async () => {
    const { uc, foodLogStore } = make(pb, { ai: withEstimate('32'), icons: 'peanut-butter' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    const item = foodLogStore.save.mock.calls[0][0].items[0];
    expect(item.grams).toBe(32);
    expect(item.captureEvidence.assumption).toBe('ai-serving-estimate');
  });

  it.each([[1500], [0], [-5], ['abc'], [null]])('rejects an estimate of %j and keeps the per-100 serving', async servingGrams => {
    const { uc, foodLogStore, logger } = make(pb, { ai: withEstimate(servingGrams), icons: 'peanut-butter' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    const item = foodLogStore.save.mock.calls[0][0].items[0];
    expect(item.grams).toBe(100);
    expect(item.calories).toBeCloseTo(656.25, 2);
    expect(item.captureEvidence.assumption).toBe('per100');
    if (servingGrams !== null) expect(logger.info).toHaveBeenCalledWith('upc.serving.estimateRejected', expect.objectContaining({ upc: '037600225250' }));
  });

  it('rejects an estimate larger than the whole package', async () => {
    const small = { ...pb, nutritionLookup: { ...pb.nutritionLookup, packageGrams: 25 } };
    const { uc, foodLogStore, logger } = make(small, { ai: withEstimate(32), icons: 'peanut-butter' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    expect(foodLogStore.save.mock.calls[0][0].items[0].grams).toBe(100);
    expect(logger.info).toHaveBeenCalledWith('upc.serving.estimateRejected', expect.objectContaining({ grams: 32, maxGrams: 25 }));
  });

  it('the estimate prompt names the per-100 g basis and shows servingGrams in the example', async () => {
    const chat = vi.fn(async () => '{"icon":"peanut-butter","noomColor":"orange","servingGrams":32}');
    const { uc } = make(pb, { ai: { chat }, icons: 'peanut-butter' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    const [system, user] = chat.mock.calls[0][0].map(m => m.content);
    expect(system).toContain('"servingGrams"');
    expect(user).toContain('Calories per 100 g: 656.25');
    expect(user).toContain('Label serving: 2 tbsp');
  });

  it('a millilitre fallback never asks for servingGrams', async () => {
    const chat = vi.fn(async () => '{"icon":"peanut-butter","noomColor":"orange"}');
    const coke = { ...pb, serving: { size: 100, unit: 'ml' } };
    const { uc } = make(coke, { ai: { chat }, icons: 'peanut-butter' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    expect(chat.mock.calls[0][0].map(m => m.content).join('\n')).not.toContain('servingGrams');
  });

  it('a per-100 fallback with unknown calories (only sodium known) is quarantined, not committed', async () => {
    const sodiumOnly = { ...pb, nutrition: { calories: null, protein: null, carbs: null, fat: null, sodium: 120 } };
    const { uc, reviewService, foodLogStore } = make(sodiumOnly, { ai: withEstimate(32), icons: 'peanut-butter' });
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    expect(out).toMatchObject({ success: true, quarantined: true, committed: false });
    expect(reviewService.capture).not.toHaveBeenCalled();
    expect(foodLogStore.save.mock.calls[0][0].metadata.quarantined).toBe(true);
  });

  it('asks for servingGrams only when the serving is a per-100 fallback', async () => {
    const chat = vi.fn(async () => '{"icon":"peanut-butter","noomColor":"orange"}');
    const { uc } = make({ ...pb, nutritionLookup: { source: 'openfoodfacts', warnings: [] } }, { ai: { chat }, icons: 'peanut-butter' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    expect(chat.mock.calls[0][0].map(m => m.content).join('\n')).not.toContain('servingGrams');
  });

  it('never turns a millilitre fallback into grams', async () => {
    const coke = { ...pb, name: 'Diet Coke', serving: { size: 100, unit: 'ml' }, nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      nutritionLookup: { ...pb.nutritionLookup, servingText: null } };
    const { uc, foodLogStore } = make(coke, { ai, icons: 'peanut-butter' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    const item = foodLogStore.save.mock.calls[0][0].items[0];
    expect(item.grams).toBeNull();
    expect(item.unit).toBe('ml');
    expect(item.amount).toBe(100);
  });
});

describe('LogFoodFromUPC — no calories: estimate instead of quarantine', () => {
  const bare = (over = {}) => ({ upc: '037000338369', name: 'Mystery Snack', serving: { size: 1, unit: 'serving' },
    nutrition: { calories: null, protein: null, carbs: null, fat: null },
    nutritionLookup: { source: 'openfoodfacts', warnings: ['Nutrition unavailable'] }, ...over });
  const answer = body => ({ chat: vi.fn(async () => JSON.stringify({ icon: 'granola-bar', noomColor: 'orange', ...body })) });

  it('a magazine-like product the classifier says is not food stays quarantined', async () => {
    const ai = answer({ isFood: false, estimate: { servingGrams: 50, calories: 200 } });
    const { uc, reviewService, foodLogStore } = make(bare({ name: 'People Magazine' }), { ai, icons: 'granola-bar' });
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out).toMatchObject({ success: true, quarantined: true, committed: false });
    expect(out.aiEstimate).toBeUndefined();
    expect(reviewService.capture).not.toHaveBeenCalled();
    expect(foodLogStore.save.mock.calls[0][0].metadata).toMatchObject({ quarantined: true, quarantineReason: 'no-calories' });
    const [system] = ai.chat.mock.calls[0][0].map(m => m.content);
    expect(system).toContain('"isFood"');
    expect(system).toContain('"estimate"');
  });

  it('food with no nutrition is logged with the AI numbers, unconfirmed and committed', async () => {
    const ai = answer({ isFood: true, estimate: { servingGrams: 40, calories: 190, protein: 4, carbs: 26, fat: 8 } });
    const { uc, reviewService, foodLogStore } = make(bare(), { ai, icons: 'granola-bar' });
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out).toMatchObject({ success: true, quarantined: false, aiEstimate: true });
    expect(reviewService.capture).toHaveBeenCalled();
    const log = foodLogStore.save.mock.calls[0][0];
    expect(log.metadata.quarantined).toBeUndefined();
    expect(log.metadata.nutritionLookup).toMatchObject({ aiEstimate: true, servingEstimate: { source: 'ai', grams: 40 } });
    expect(log.metadata.nutritionLookup.missing).not.toContain('calories');
    const item = log.items[0];
    expect([item.grams, item.calories, item.protein, item.carbs, item.fat]).toEqual([40, 190, 4, 26, 8]);
    expect(item.nutrientProvenance).toMatchObject({ calories: { source: 'ai', grams: 40 }, fat: { source: 'ai', grams: 40 } });
    expect(item.captureEvidence.assumption).toBe('ai-nutrition-estimate');
  });

  it.each([
    ['no isFood', { estimate: { calories: 190 } }],
    ['calories out of range', { isFood: true, estimate: { servingGrams: 40, calories: 5000 } }],
    ['calories not a number', { isFood: true, estimate: { servingGrams: 40, calories: 'lots' } }],
    ['no estimate', { isFood: true }],
  ])('an unusable answer (%s) keeps the quarantine', async (_label, body) => {
    const { uc, reviewService } = make(bare(), { ai: answer(body), icons: 'granola-bar' });
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out.quarantined).toBe(true);
    expect(reviewService.capture).not.toHaveBeenCalled();
  });

  it('an out-of-bounds serving mass keeps the calories but not the grams', async () => {
    const ai = answer({ isFood: true, estimate: { servingGrams: 900, calories: 300 } });
    const { uc, foodLogStore } = make(bare(), { ai, icons: 'granola-bar' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    const item = foodLogStore.save.mock.calls[0][0].items[0];
    expect(item.calories).toBe(300);
    expect(item.grams).toBeNull();
    expect(item.unit).toBe('serving');
  });

  it('a per-100 product with no serving text is scaled to the AI\'s typical serving', async () => {
    const cheese = { upc: '037000338369', name: 'Shredded Cheddar', serving: { size: 100, unit: 'g' },
      nutrition: { calories: 393, protein: 24, carbs: 3, fat: 32 },
      nutritionLookup: { source: 'openfoodfacts', servingFallback: 'per100', servingText: null, packageGrams: 226, warnings: ['x'] } };
    const chat = vi.fn(async () => '{"icon":"cheddar-wedge","noomColor":"orange","servingGrams":28}');
    const { uc, foodLogStore } = make(cheese, { ai: { chat }, icons: 'cheddar-wedge' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    const [system] = chat.mock.calls[0][0].map(m => m.content);
    expect(system).toContain('ONE TYPICAL SERVING');
    const item = foodLogStore.save.mock.calls[0][0].items[0];
    expect(item.grams).toBe(28);
    expect(item.calories).toBeCloseTo(110, 0);
    expect(item.captureEvidence.assumption).toBe('ai-serving-estimate');
  });
});
