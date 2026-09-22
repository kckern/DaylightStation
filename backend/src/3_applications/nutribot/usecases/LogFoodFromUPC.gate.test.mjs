import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromUPC } from './LogFoodFromUPC.mjs';

const messaging = () => ({ sendMessage: vi.fn(async () => ({ messageId: 'm1' })), sendPhoto: vi.fn(async () => ({ messageId: 'm2' })),
  updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}) });
const product = (nutrition) => ({ upc: '037000338369', name: 'Magazine', serving: { size: 1, unit: 'serving' }, nutrition,
  nutritionLookup: { source: 'openfoodfacts', warnings: ['Nutrition unavailable'] } });
const make = (gatewayHit) => {
  const saved = [];
  const foodLogStore = { save: vi.fn(async log => { saved.push(log); }), findById: vi.fn(async () => saved.at(-1)) };
  const reviewService = { capture: vi.fn(async () => {}) };
  const upcGateway = { lookup: vi.fn(async () => gatewayHit) };
  const uc = new LogFoodFromUPC({ messagingGateway: messaging(), upcGateway, foodLogStore, reviewService,
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
  it('a product with no nutrition at all stays pending and is never accepted into the ledger', async () => {
    const { uc, reviewService, foodLogStore } = make(product({ calories: null, protein: null, carbs: null, fat: null }));
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out).toMatchObject({ success: true, quarantined: true, committed: false });
    expect(foodLogStore.save).toHaveBeenCalled();
    expect(reviewService.capture).not.toHaveBeenCalled();
  });

  it('a replay of a quarantined capture does not accept it into the ledger either', async () => {
    const { uc, reviewService } = make(product({ calories: null, protein: null, carbs: null, fat: null }));
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', operationId: 'op2', headless: true });
    const again = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', operationId: 'op2', headless: true });
    expect(again).toMatchObject({ success: true, alreadyProcessed: true, quarantined: true, committed: false });
    expect(reviewService.capture).not.toHaveBeenCalled();
  });

  it('a product with a known zero is not quarantined', async () => {
    const { uc, reviewService } = make(product({ calories: 0, protein: 0, carbs: 0, fat: 0 }));
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out.quarantined).toBeFalsy();
    expect(reviewService.capture).toHaveBeenCalled();
  });
});
