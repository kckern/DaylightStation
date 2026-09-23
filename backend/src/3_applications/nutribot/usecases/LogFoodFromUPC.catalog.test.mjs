import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromUPC } from './LogFoodFromUPC.mjs';

const messagingStub = () => ({
  sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
  sendPhoto: vi.fn(async () => ({ messageId: 'm2' })),
  updateMessage: vi.fn(async () => {}),
  deleteMessage: vi.fn(async () => {}),
});

const makeUseCase = ({ catalogHit = null, gatewayHit = null, photoStore = null, foodIconsString, image = null } = {}) => {
  const upcGateway = { lookup: vi.fn(async () => gatewayHit), fetchImage: vi.fn(async () => image) };
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
    photoStore,
    ...(foodIconsString ? { foodIconsString } : {}),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { uc, upcGateway, foodLogStore, catalogService };
};

describe('LogFoodFromUPC catalog-first', () => {
  it('an incomplete catalog hit attempts refresh and retains its estimate if unavailable', async () => {
    const { uc, upcGateway, foodLogStore } = makeUseCase({
      catalogHit: {
        name: 'Local Granola',
        nutrients: { calories: 210, protein: 5, carbs: 30, fat: 8 },
      },
    });
    const result = await uc.execute({ userId: 'u', conversationId: 'c', upc: '012345678905' });
    expect(result.success).toBe(true);
    expect(result.product.name).toBe('Local Granola');
    expect(upcGateway.lookup).toHaveBeenCalledWith('012345678905');
    expect(result.product.serving).toEqual({ size: 1, unit: 'serving' });
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
        canonicalGrams: 45,
        nutrients: { calories: 210, protein: 5, carbs: 30, fat: 8, fiber: 4, sugar: 2, sodium: 10, cholesterol: 0 },
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
    expect(donated.grams).toBe(45);
    expect(donated.amount).toBe(45);
    expect(donated.fiber).toBe(4);
  });

  it('a double miss reports unknownUpc with the code', async () => {
    const { uc } = makeUseCase({});
    const result = await uc.execute({ userId: 'u', conversationId: 'c', upc: '000000000000' });
    expect(result.success).toBe(false);
    expect(result.unknownUpc).toBe(true);
    expect(result.upc).toBe('000000000000');
  });

  it('hands the catalog the serving, the product photo, the icon, the meal and the capture id', async () => {
    // The 2026-09-22 milkshake: a 325 ml label serving with no grams. The
    // catalog record used to drop all of this, so the entry had no serving, no
    // photo and no icon, and every quick-add of it logged "—" with the dot.
    const { uc, catalogService } = makeUseCase({
      gatewayHit: { name: 'Strawberry Milkshake', brand: null, imageUrl: 'https://img/shake.jpg', icon: 'milkshake',
        serving: { size: 325, unit: 'ml' }, nutrition: { calories: 140, protein: 30, carbs: 5, fat: 1, fiber: 4, sugar: 0.5, sodium: 250, cholesterol: 25 },
        nutritionLookup: { source: 'off', basis: 'serving', missing: [], warnings: [] } },
      photoStore: { save: vi.fn(async () => 'ph_2DyAMj3lb6osrZzr') },
      image: Buffer.from('jpeg'),
      foodIconsString: 'default milkshake apple',
    });
    const result = await uc.execute({ userId: 'u', conversationId: 'c', upc: '749826002033', bucket: 'afternoon' });
    expect(result.success).toBe(true);
    const [donated] = catalogService.recordUsage.mock.calls[0];
    expect(donated).toMatchObject({
      name: 'Strawberry Milkshake', unit: 'ml', amount: 325, grams: null,
      icon: 'milkshake', photoRef: 'ph_2DyAMj3lb6osrZzr',
      serving: { amount: 325, unit: 'ml', grams: null },
      mealTime: 'afternoon', logId: result.nutrilogUuid,
    });
  });

  it("never hands the catalog the neutral 'default' as an icon", async () => {
    const { uc, catalogService } = makeUseCase({
      gatewayHit: { name: 'Mystery Snack', serving: { size: 30, unit: 'g' }, nutrition: { calories: 120, protein: 1, carbs: 20, fat: 4 },
        nutritionLookup: { source: 'off', basis: 'serving', missing: [], warnings: [] } },
    });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '012345678905' });
    const [donated] = catalogService.recordUsage.mock.calls[0];
    expect(donated.icon).toBeNull();
    expect(donated.serving).toEqual({ amount: 30, unit: 'g', grams: 30 });
  });

  it('a catalog hit with a known label serving and photo reuses both instead of re-fetching', async () => {
    const photoStore = { save: vi.fn(async () => 'ph_new') };
    const { uc, upcGateway, catalogService } = makeUseCase({
      catalogHit: { id: 'shake', name: 'Strawberry Milkshake', canonicalGrams: null, icon: 'milkshake', photoRef: 'ph_old',
        serving: { amount: 325, unit: 'ml', grams: null },
        nutrients: { calories: 140, protein: 30, carbs: 5, fat: 1, fiber: 4, sugar: 0.5, sodium: 250, cholesterol: 25 } },
      photoStore, foodIconsString: 'default milkshake',
    });
    const result = await uc.execute({ userId: 'u', conversationId: 'c', upc: '749826002033' });
    expect(result.product.serving).toEqual({ size: 325, unit: 'ml' });
    expect(upcGateway.lookup).not.toHaveBeenCalled();
    expect(photoStore.save).not.toHaveBeenCalled();
    const [donated] = catalogService.recordUsage.mock.calls[0];
    expect(donated).toMatchObject({ amount: 325, unit: 'ml', photoRef: 'ph_old' });
  });
});
