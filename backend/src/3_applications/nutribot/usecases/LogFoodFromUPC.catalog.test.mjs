import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromUPC } from './LogFoodFromUPC.mjs';

const messagingStub = () => ({
  sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
  sendPhoto: vi.fn(async () => ({ messageId: 'm2' })),
  updateMessage: vi.fn(async () => {}),
  deleteMessage: vi.fn(async () => {}),
});

const makeUseCase = ({ catalogHit = null, gatewayHit = null } = {}) => {
  const upcGateway = { lookup: vi.fn(async () => gatewayHit) };
  const foodLogStore = { save: vi.fn(async () => {}) };
  const catalogService = {
    getByUpc: vi.fn(async () => catalogHit),
    recordUsage: vi.fn(async () => {}),
  };
  const uc = new LogFoodFromUPC({
    messagingGateway: messagingStub(),
    upcGateway,
    foodLogStore,
    catalogService,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { uc, upcGateway, foodLogStore, catalogService };
};

describe('LogFoodFromUPC catalog-first', () => {
  it('a catalog UPC hit short-circuits the external gateway', async () => {
    const { uc, upcGateway, foodLogStore } = makeUseCase({
      catalogHit: {
        name: 'Local Granola',
        nutrients: { calories: 210, protein: 5, carbs: 30, fat: 8 },
      },
    });
    const result = await uc.execute({ userId: 'u', conversationId: 'c', upc: '012345678905' });
    expect(result.success).toBe(true);
    expect(result.product.name).toBe('Local Granola');
    expect(upcGateway.lookup).not.toHaveBeenCalled();
    expect(foodLogStore.save).toHaveBeenCalled();
  });

  it('records the scan as a UPC observation, with the barcode it has had in scope all along', async () => {
    // Every one of the 683 catalog entries claimed `source: 'nutritionix'` and
    // not one carried a UPC, across 224 UPC logs, because this use case
    // hard-coded the literal and dropped the `upc` argument. Writing it is what
    // revives getByUpc and the UPC index, and what lets the derivation weight a
    // manufacturer's own panel above a model's guess.
    const { uc, catalogService } = makeUseCase({
      catalogHit: {
        name: 'Local Granola',
        nutrients: { calories: 210, protein: 5, carbs: 30, fat: 8 },
      },
    });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '012345678905' });
    expect(catalogService.recordUsage).toHaveBeenCalledTimes(1);
    const [donated, userId] = catalogService.recordUsage.mock.calls[0];
    expect(userId).toBe('u');
    expect(donated).toMatchObject({
      name: 'Local Granola',
      source: 'upc',
      barcodeUpc: '012345678905',
      calories: 210,
    });
    // The serving the panel describes — without a mass this is a total with
    // nothing to divide by, and the catalog cannot hold it as an observation.
    expect(donated.grams).toBeGreaterThan(0);
  });

  it('a double miss reports unknownUpc with the code', async () => {
    const { uc } = makeUseCase({});
    const result = await uc.execute({ userId: 'u', conversationId: 'c', upc: '000000000000' });
    expect(result.success).toBe(false);
    expect(result.unknownUpc).toBe(true);
    expect(result.upc).toBe('000000000000');
  });
});
