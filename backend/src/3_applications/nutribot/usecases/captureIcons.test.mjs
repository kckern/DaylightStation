import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromText } from './LogFoodFromText.mjs';
import { LogFoodFromImage } from './LogFoodFromImage.mjs';

// PRD F5.2: the capture agent assigns an icon id per item, "choosing from the
// manifest list (never inventing names)". The prompt asks it to; nothing made
// it. A hallucinated slug used to sail straight through onto the stored row,
// where it 404s forever and the row shows the fallback glyph with nothing
// logged — the same shape of silent failure as an emptied media folder.
//
// The vocabulary here is the SAME string the composition root builds from the
// manifest and injects as `foodIconsString`, so these tests exercise the real
// contract rather than a parallel one.

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const VOCABULARY = 'fried-eggs avocado-toast carrot';

function textUseCase(aiPayload) {
  const saved = [];
  const uc = new LogFoodFromText({
    messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })), updateMessage: vi.fn(), deleteMessage: vi.fn() },
    aiGateway: { chat: vi.fn(async () => JSON.stringify(aiPayload)) },
    foodLogStore: { save: vi.fn(async (log) => { saved.push(log); }) },
    foodIconsString: VOCABULARY,
    logger: silent,
  });
  return { uc, saved };
}

const runText = (uc) => uc.execute({ userId: 'alice', conversationId: 'web:alice', text: 'whatever', messageId: 1 });

describe('capture icon assignment is confined to the manifest vocabulary', () => {
  it('keeps an icon the model chose FROM the vocabulary', async () => {
    const { uc, saved } = textUseCase({
      items: [{ name: 'Eggs', grams: 100, calories: 140, icon: 'fried-eggs' }],
      date: '2026-09-03', time: 'morning',
    });
    await runText(uc);
    expect(saved.at(-1).items[0].icon).toBe('fried-eggs');
  });

  it('replaces an INVENTED slug with the neutral sentinel rather than storing a name that 404s', async () => {
    const { uc, saved } = textUseCase({
      items: [{ name: 'Eggs', grams: 100, calories: 140, icon: 'scrambled-eggs-benedict-supreme' }],
      date: '2026-09-03', time: 'morning',
    });
    await runText(uc);
    expect(saved.at(-1).items[0].icon).toBe('default');
  });

  it('an omitted icon is the neutral sentinel, exactly as before', async () => {
    const { uc, saved } = textUseCase({
      items: [{ name: 'Eggs', grams: 100, calories: 140 }],
      date: '2026-09-03', time: 'morning',
    });
    await runText(uc);
    expect(saved.at(-1).items[0].icon).toBe('default');
  });

  it('a non-string icon cannot reach the row', async () => {
    const { uc, saved } = textUseCase({
      items: [{ name: 'Eggs', grams: 100, calories: 140, icon: { path: '../../etc/passwd' } }],
      date: '2026-09-03', time: 'morning',
    });
    await runText(uc);
    expect(saved.at(-1).items[0].icon).toBe('default');
  });

  it('the image path applies the same confinement', async () => {
    const DATA_URL = `data:image/jpeg;base64,${Buffer.from('not a real jpeg').toString('base64')}`;
    const saved = [];
    const uc = new LogFoodFromImage({
      messagingGateway: {
        sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
        sendPhoto: vi.fn(async () => ({ messageId: 'p1' })),
        updateMessage: vi.fn(async () => {}),
        deleteMessage: vi.fn(async () => {}),
        getFileUrl: vi.fn(async () => null),
      },
      aiGateway: {
        chatWithImage: vi.fn(async () => JSON.stringify({
          items: [
            { name: 'Toast', grams: 60, calories: 180, icon: 'avocado-toast' },
            { name: 'Mystery', grams: 60, calories: 90, icon: 'not-in-the-manifest' },
          ],
        })),
      },
      foodLogStore: { save: vi.fn(async (log) => { saved.push(log); }) },
      imageDownloader: { download: vi.fn(async () => Buffer.from('unused')) },
      foodIconsString: VOCABULARY,
      logger: silent,
    });
    await uc.execute({ userId: 'alice', conversationId: 'web:alice', imageData: { url: DATA_URL } });
    const items = saved.at(-1).items;
    expect(items.find((i) => i.label === 'Toast').icon).toBe('avocado-toast');
    expect(items.find((i) => i.label === 'Mystery').icon).toBe('default');
  });
});
