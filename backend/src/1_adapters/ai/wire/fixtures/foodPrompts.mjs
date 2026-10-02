/**
 * The four food-logging prompts exactly as production builds them — captured
 * by running each use case against fakes — so wire-layer tests can never drift
 * from the real templates.
 */
import { vi } from 'vitest';
import { LogFoodFromText } from '#apps/nutribot/usecases/LogFoodFromText.mjs';
import { LogFoodFromImage } from '#apps/nutribot/usecases/LogFoodFromImage.mjs';
import { ProcessRevisionInput } from '#apps/nutribot/usecases/ProcessRevisionInput.mjs';
import { ReviseEntryService } from '#apps/health/ReviseEntryService.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const empty = JSON.stringify({ items: [] });

export async function captureTextPrompt() {
  const chat = vi.fn(async () => empty);
  const uc = new LogFoodFromText({
    messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
    aiGateway: { chat },
    foodLogStore: { save: vi.fn(async () => {}) },
    logger: silent,
  });
  await uc.execute({ userId: 'alice', conversationId: 'web:alice', text: 'two eggs and toast', messageId: 1 });
  return chat.mock.calls[0][0];
}

export async function captureImagePrompt() {
  const chatWithImage = vi.fn(async () => empty);
  const uc = new LogFoodFromImage({
    messagingGateway: {
      sendMessage: vi.fn(async () => ({ messageId: 'm1' })), sendPhoto: vi.fn(async () => ({ messageId: 'p1' })),
      updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}), getFileUrl: vi.fn(async () => null),
    },
    aiGateway: { chatWithImage },
    foodLogStore: { save: vi.fn(async () => {}) },
    imageDownloader: { download: vi.fn(async () => Buffer.from('unused')) },
    logger: silent,
  });
  const url = `data:image/jpeg;base64,${Buffer.from('not a real jpeg').toString('base64')}`;
  await uc.execute({ userId: 'alice', conversationId: 'web:alice', imageData: { url } });
  return chatWithImage.mock.calls[0][0];
}

export async function captureRevisionPrompt() {
  const chat = vi.fn(async () => empty);
  const items = [
    { id: 'toast00001', label: 'Toast', grams: 40, unit: 'slice', amount: 1, color: 'yellow', calories: 120 },
    { id: 'eggs000001', label: 'Fried Egg', grams: 100, unit: 'g', amount: 2, color: 'yellow', calories: 180 },
  ];
  const uc = new ProcessRevisionInput({
    receipts: () => ({ interaction: vi.fn(async () => {}) }),
    messagingGateway: { sendMessage: vi.fn(), updateMessage: vi.fn(), deleteMessage: vi.fn() },
    aiGateway: { chat },
    foodLogStore: {
      findByUuid: vi.fn(async () => ({ id: 'log-1', userId: 'kc', status: 'pending', meal: { date: '2026-09-02', time: 'morning' }, items, metadata: { source: 'text' } })),
      updateItems: vi.fn(async () => ({ id: 'log-1', items })),
      save: vi.fn(async () => {}),
    },
    nutriListStore: { syncFromLog: vi.fn(async () => {}) },
    conversationStateStore: {
      get: vi.fn(async () => ({ activeFlow: 'revision', flowState: { pendingLogUuid: 'log-1', originalMessageId: 'bot-1' } })),
      set: vi.fn(async () => {}), clear: vi.fn(async () => {}),
    },
    logger: silent,
  });
  const responseContext = { sendMessage: vi.fn(async () => ({ messageId: 'm' })), updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}) };
  await uc.execute({ userId: 'kc', conversationId: 'web:kc', text: 'make it 2 slices', messageId: 'user-1', responseContext }).catch(() => {});
  return chat.mock.calls[0][0];
}

export async function captureReviseEntryPrompt() {
  const chat = vi.fn(async () => JSON.stringify({ name: 'Cauliflower Rice', grams: 57 }));
  const row = { uuid: 'r1', name: 'Rice', grams: 158, amount: 158, unit: 'g', calories: 205, protein: 4.3, carbs: 45, fat: 0.4 };
  const service = new ReviseEntryService({ nutritionItems: { findByUuid: vi.fn(async () => row) }, aiGateway: { chat } });
  await service.propose('alice', { entryUuid: 'r1', instruction: 'cauliflower rice' }).catch(() => {});
  return chat.mock.calls[0][0];
}
