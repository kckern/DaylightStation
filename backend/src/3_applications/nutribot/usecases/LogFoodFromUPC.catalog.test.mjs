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
  const uc = new LogFoodFromUPC({
    messagingGateway: messagingStub(),
    upcGateway,
    foodLogStore,
    catalogService: {
      getByUpc: vi.fn(async () => catalogHit),
      recordUsage: vi.fn(async () => {}),
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { uc, upcGateway, foodLogStore };
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

  it('a double miss reports unknownUpc with the code', async () => {
    const { uc } = makeUseCase({});
    const result = await uc.execute({ userId: 'u', conversationId: 'c', upc: '000000000000' });
    expect(result.success).toBe(false);
    expect(result.unknownUpc).toBe(true);
    expect(result.upc).toBe('000000000000');
  });
});
