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
  const uc = new LogFoodFromUPC({ messagingGateway: messaging(), upcGateway, foodLogStore, reviewService,
    aiGateway: ai, foodIconsString: icons,
    logger: { debug() {}, info: vi.fn(), warn() {}, error() {} } });
  return { uc, upcGateway, foodLogStore, reviewService, saved };
};

describe('LogFoodFromUPC intake gate', () => {
  it('refuses a code with a bad check digit before any lookup', async () => {
    const { uc, upcGateway } = make(null);
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338368', headless: true });
    expect(out).toMatchObject({ success: false, rejected: 'check-digit' });
    expect(upcGateway.lookup).not.toHaveBeenCalled();
  });

  it('refuses an ISBN', async () => {
    const { uc, upcGateway } = make(null);
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '9780306406157', headless: true });
    expect(out).toMatchObject({ success: false, rejected: 'isbn' });
    expect(upcGateway.lookup).not.toHaveBeenCalled();
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
