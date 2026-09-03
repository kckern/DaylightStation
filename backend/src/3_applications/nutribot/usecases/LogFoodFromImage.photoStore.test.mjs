import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromImage } from './LogFoodFromImage.mjs';

// A tiny (fake, non-decodable) base64 payload is fine here — LogFoodFromImage
// only needs to extract *bytes* from the data: URL; PhotoStore's own tests
// cover real jimp decoding. A stub photoStore is used in every test below so
// these tests stay focused on wiring: who calls save(), and where photoRef
// lands on the produced entries.
const FAKE_PHOTO_BASE64 = Buffer.from('not a real jpeg, just bytes').toString('base64');
const DATA_URL = `data:image/jpeg;base64,${FAKE_PHOTO_BASE64}`;

function messagingStub() {
  return {
    sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
    sendPhoto: vi.fn(async () => ({ messageId: 'photo1' })),
    updateMessage: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    getFileUrl: vi.fn(async () => null),
  };
}

function makeUseCase({ aiItems, photoStore = null, logger } = {}) {
  const messagingGateway = messagingStub();
  const aiGateway = {
    chatWithImage: vi.fn(async () => JSON.stringify({ items: aiItems })),
  };
  const foodLogStore = { save: vi.fn(async () => {}) };
  const imageDownloader = { download: vi.fn(async () => Buffer.from('unused-in-these-tests')) };

  const uc = new LogFoodFromImage({
    messagingGateway,
    aiGateway,
    foodLogStore,
    imageDownloader,
    photoStore,
    logger: logger || { debug() {}, info() {}, warn() {}, error() {} },
  });

  return { uc, messagingGateway, aiGateway, foodLogStore };
}

describe('LogFoodFromImage + PhotoStore wiring', () => {
  it('a grouped (multi-item dish) parse stamps photoRef on the GROUP row only, never on its members', async () => {
    const photoStore = { save: vi.fn(async () => 'ph_group123') };
    const { uc, foodLogStore } = makeUseCase({
      photoStore,
      aiItems: [
        { name: 'Bun', icon: 'bread', quantity: 1, grams: 50, calories: 120, dish: 'Burger' },
        { name: 'Patty', icon: 'chicken', quantity: 1, grams: 100, calories: 250, dish: 'Burger' },
      ],
    });

    const result = await uc.execute({
      userId: 'alice',
      conversationId: 'web:alice',
      imageData: { url: DATA_URL },
    });

    expect(result.success).toBe(true);
    expect(photoStore.save).toHaveBeenCalledTimes(1);
    expect(photoStore.save).toHaveBeenCalledWith('alice', expect.any(Buffer));

    const savedLog = foodLogStore.save.mock.calls.at(-1)[0];
    const items = savedLog.items;
    const group = items.find((i) => i.kind === 'group');
    const members = items.filter((i) => i.kind === 'item' && i.parentId === group.id);

    expect(group).toBeTruthy();
    expect(group.photoRef).toBe('ph_group123');
    expect(members).toHaveLength(2);
    for (const member of members) {
      expect(member.photoRef).toBeNull();
    }
  });

  it('a single standalone item parse stamps photoRef directly on that item', async () => {
    const photoStore = { save: vi.fn(async () => 'ph_single456') };
    const { uc, foodLogStore } = makeUseCase({
      photoStore,
      aiItems: [{ name: 'Apple', icon: 'apple', quantity: 1, grams: 150, calories: 95 }],
    });

    const result = await uc.execute({
      userId: 'alice',
      conversationId: 'web:alice',
      imageData: { url: DATA_URL },
    });

    expect(result.success).toBe(true);
    const savedLog = foodLogStore.save.mock.calls.at(-1)[0];
    expect(savedLog.items).toHaveLength(1);
    expect(savedLog.items[0].kind).toBe('item');
    expect(savedLog.items[0].parentId).toBeFalsy();
    expect(savedLog.items[0].photoRef).toBe('ph_single456');
  });

  it('FAILURE POSTURE: a throwing PhotoStore.save does not prevent the food from being logged', async () => {
    const warnCalls = [];
    const photoStore = { save: vi.fn(async () => { throw new Error('disk full'); }) };
    const { uc, foodLogStore } = makeUseCase({
      photoStore,
      logger: { debug() {}, info() {}, warn: (...a) => warnCalls.push(a), error() {} },
      aiItems: [{ name: 'Apple', icon: 'apple', quantity: 1, grams: 150, calories: 95 }],
    });

    const result = await uc.execute({
      userId: 'alice',
      conversationId: 'web:alice',
      imageData: { url: DATA_URL },
    });

    expect(result.success).toBe(true);
    expect(foodLogStore.save).toHaveBeenCalled();
    const savedLog = foodLogStore.save.mock.calls.at(-1)[0];
    expect(savedLog.items[0].photoRef).toBeNull();
    expect(warnCalls.some(([event]) => event === 'logImage.photoStore.save.failed')).toBe(true);
  });

  it('TWO-PLATE case: one photo producing two sibling groups + a standalone item all get the SAME ref, and save() is called exactly once', async () => {
    const photoStore = { save: vi.fn(async () => 'ph_twoplate789') };
    const { uc, foodLogStore } = makeUseCase({
      photoStore,
      aiItems: [
        { name: 'Bun', icon: 'bread', quantity: 1, grams: 50, calories: 120, dish: 'Burger' },
        { name: 'Patty', icon: 'chicken', quantity: 1, grams: 100, calories: 250, dish: 'Burger' },
        { name: 'Rice', icon: 'default', quantity: 1, grams: 150, calories: 200, dish: 'Side Bowl' },
        { name: 'Beans', icon: 'default', quantity: 1, grams: 100, calories: 130, dish: 'Side Bowl' },
        { name: 'Apple', icon: 'apple', quantity: 1, grams: 150, calories: 95 }, // standalone, no dish
      ],
    });

    const result = await uc.execute({
      userId: 'alice',
      conversationId: 'web:alice',
      imageData: { url: DATA_URL },
    });

    expect(result.success).toBe(true);
    expect(photoStore.save).toHaveBeenCalledTimes(1); // one photo, one save — not once per dish

    const savedLog = foodLogStore.save.mock.calls.at(-1)[0];
    const items = savedLog.items;
    expect(items).toHaveLength(7); // 2 groups + 4 members + 1 standalone item

    const groups = items.filter((i) => i.kind === 'group');
    const standalone = items.find((i) => i.kind === 'item' && !i.parentId);
    const members = items.filter((i) => i.kind === 'item' && i.parentId);

    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.photoRef).toBe('ph_twoplate789');
    }
    expect(standalone).toBeTruthy();
    expect(standalone.photoRef).toBe('ph_twoplate789');
    expect(members).toHaveLength(4);
    for (const member of members) {
      expect(member.photoRef).toBeNull();
    }
  });

  it('no photoStore configured at all: logging still succeeds, with no photoRef stamped', async () => {
    const { uc, foodLogStore } = makeUseCase({
      photoStore: null,
      aiItems: [{ name: 'Apple', icon: 'apple', quantity: 1, grams: 150, calories: 95 }],
    });

    const result = await uc.execute({
      userId: 'alice',
      conversationId: 'web:alice',
      imageData: { url: DATA_URL },
    });

    expect(result.success).toBe(true);
    const savedLog = foodLogStore.save.mock.calls.at(-1)[0];
    expect(savedLog.items[0].photoRef).toBeNull();
  });
});
