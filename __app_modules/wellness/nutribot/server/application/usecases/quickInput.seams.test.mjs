/**
 * The seams the quick-input intakes need from the capture use cases: an image
 * given as bytes, a code on the outcomes that mean "nothing usable", and logs
 * that never carry what was typed, said or photographed.
 */
import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromImage } from './LogFoodFromImage.mjs';
import { LogFoodFromText } from './LogFoodFromText.mjs';
import { LogFoodFromVoice } from './LogFoodFromVoice.mjs';

const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a plate of food, in bytes that are never logged '.repeat(20))]);
const NOTE = 'Oatmeal with blueberries and a black coffee, eaten at the kitchen table.';
const ITEMS = [{ name: 'Oatmeal', icon: 'oatmeal', quantity: 1, grams: 240, calories: 150 }];
const AI_ANSWER = JSON.stringify({ items: ITEMS, note: `The user wrote: ${NOTE}` });

function capturingLogger() {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  return { events, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

/** No event may carry binary data, or 13 characters in a row of any of `secrets`. */
function expectNothingCapturedIsLogged(events, secrets) {
  expect(events.length).toBeGreaterThan(0);
  const pieces = [];
  for (const secret of secrets) {
    for (let i = 0; i + 13 <= secret.length; i += 1) pieces.push(secret.slice(i, i + 13));
  }
  const walk = (value, event) => {
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) throw new Error(`${event} carries binary data`);
    if (typeof value === 'string') {
      for (const piece of pieces) {
        if (value.includes(piece)) throw new Error(`${event} repeats captured content: "${piece}"`);
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach((inner) => walk(inner, event));
  };
  for (const { event, data } of events) walk(data, event);
}

function gateway({ failPhoto = false } = {}) {
  return {
    sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
    sendPhoto: vi.fn(async () => { if (failPhoto) throw new Error('telegram is down'); return { messageId: 'photo1' }; }),
    updateMessage: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    getFileUrl: vi.fn(async () => { throw new Error('a buffer has no file id to resolve'); }),
    transcribeVoice: vi.fn(async () => NOTE),
  };
}

function imageUseCase({ answer = JSON.stringify({ items: ITEMS }), aiFails = false, logger, photoStore = null, stateStore = null } = {}) {
  const messagingGateway = gateway();
  const aiGateway = { chatWithImage: vi.fn(async () => { if (aiFails) throw new Error('vision model is down'); return answer; }) };
  const foodLogStore = { save: vi.fn(async () => {}) };
  const imageDownloader = { download: vi.fn(async () => { throw new Error('a buffer is not downloaded'); }) };
  const uc = new LogFoodFromImage({
    messagingGateway, aiGateway, foodLogStore, imageDownloader, photoStore,
    conversationStateStore: stateStore,
    logger: logger || { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { uc, messagingGateway, aiGateway, foodLogStore, imageDownloader };
}

const photoInput = (over = {}) => ({
  userId: 'user_1', conversationId: 'telegram:b1_c2',
  imageData: { buffer: PHOTO, mimeType: 'image/jpeg' }, ...over,
});

describe('LogFoodFromImage takes an image as bytes', () => {
  it('sends the bytes to the chat and to the model, with nothing downloaded or resolved', async () => {
    const photoStore = { save: vi.fn(async () => 'ph_1') };
    const { uc, messagingGateway, aiGateway, imageDownloader, foodLogStore } = imageUseCase({ photoStore });
    const result = await uc.execute(photoInput());

    expect(result.success).toBe(true);
    expect(messagingGateway.sendPhoto).toHaveBeenCalledTimes(1);
    expect(messagingGateway.sendPhoto.mock.calls[0][1]).toBe(PHOTO);
    expect(aiGateway.chatWithImage.mock.calls[0][1]).toBe(PHOTO);
    expect(imageDownloader.download).not.toHaveBeenCalled();
    expect(messagingGateway.getFileUrl).not.toHaveBeenCalled();
    expect(photoStore.save).toHaveBeenCalledWith('user_1', PHOTO);
    // No URL to keep: the log does not store megabytes of image as text.
    const saved = foodLogStore.save.mock.calls[0][0];
    expect(saved.metadata.imageUrl).toBeUndefined();
  });

  it('is filed on the day it is given', async () => {
    const { uc, foodLogStore } = imageUseCase();
    await uc.execute(photoInput({ date: '2026-11-16' }));
    expect(foodLogStore.save.mock.calls[0][0].meal.date).toBe('2026-11-16');
  });

  it('offers no Retry button when the model fails: there is nothing to fetch the image from again', async () => {
    const stateStore = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    const { uc, messagingGateway } = imageUseCase({ aiFails: true, stateStore });
    await expect(uc.execute(photoInput())).rejects.toThrow('vision model is down');
    expect(stateStore.set).not.toHaveBeenCalled();
    const [, update] = messagingGateway.updateMessage.mock.calls.at(-1);
    expect(update.choices).toBeUndefined();
  });

  it('still offers Retry for a Telegram photo', async () => {
    const stateStore = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    const { uc, messagingGateway } = imageUseCase({ aiFails: true, stateStore });
    messagingGateway.getFileUrl = vi.fn(async () => null);
    await expect(uc.execute(photoInput({ imageData: { fileId: 'AgACAgEAAxkBAAIB' } }))).rejects.toThrow('vision model is down');
    expect(stateStore.set).toHaveBeenCalledTimes(1);
  });
});

describe('the outcomes that mean nothing usable carry a code', () => {
  it('an image with no food in it', async () => {
    const { uc } = imageUseCase({ answer: JSON.stringify({ items: [] }) });
    expect(await uc.execute(photoInput())).toMatchObject({ success: false, code: 'NO_FOOD' });
  });

  it('text with no food in it', async () => {
    const uc = new LogFoodFromText({
      messagingGateway: gateway(), aiGateway: { chat: vi.fn(async () => JSON.stringify({ items: [] })) },
      foodLogStore: { save: vi.fn(async () => {}) }, logger: {},
    });
    expect(await uc.execute({ userId: 'user_1', conversationId: 'telegram:b1_c2', text: NOTE }))
      .toMatchObject({ success: false, code: 'NO_FOOD' });
  });

  it('a recording with no words in it', async () => {
    const messagingGateway = gateway();
    messagingGateway.transcribeVoice = vi.fn(async () => '   ');
    const uc = new LogFoodFromVoice({ messagingGateway, logFoodFromText: { execute: vi.fn() }, logger: {} });
    expect(await uc.execute({ userId: 'user_1', conversationId: 'telegram:b1_c2', voiceData: { fileId: { buffer: Buffer.from('x'), mimeType: 'audio/ogg' } } }))
      .toMatchObject({ success: false, code: 'EMPTY_TRANSCRIPTION' });
  });
});

describe('the capture use cases log nothing that was typed, said or photographed', () => {
  const textUseCase = (logger, answer = AI_ANSWER) => new LogFoodFromText({
    messagingGateway: gateway(), aiGateway: { chat: vi.fn(async () => answer) },
    foodLogStore: { save: vi.fn(async () => {}) }, logger,
  });

  it('a typed meal that is logged', async () => {
    const logger = capturingLogger();
    const result = await textUseCase(logger).execute({ userId: 'user_1', conversationId: 'telegram:b1_c2', text: NOTE });
    expect(result.success).toBe(true);
    expectNothingCapturedIsLogged(logger.events, [NOTE, AI_ANSWER]);
    expect(logger.events.find((e) => e.event === 'logText.start').data.textLength).toBe(NOTE.length);
  });

  it('a typed note with no food in it', async () => {
    const logger = capturingLogger();
    const answer = JSON.stringify({ items: [], note: `Nothing to log in: ${NOTE}` });
    await textUseCase(logger, answer).execute({ userId: 'user_1', conversationId: 'telegram:b1_c2', text: NOTE });
    expectNothingCapturedIsLogged(logger.events, [NOTE, answer]);
  });

  it('a spoken meal', async () => {
    const logger = capturingLogger();
    const messagingGateway = gateway();
    const uc = new LogFoodFromVoice({ messagingGateway, logFoodFromText: textUseCase(logger), logger });
    const result = await uc.execute({
      userId: 'user_1', conversationId: 'telegram:b1_c2',
      voiceData: { fileId: { buffer: Buffer.from('opus bytes that are never logged, not one of them'), mimeType: 'audio/ogg' } },
    });
    expect(result.success).toBe(true);
    expectNothingCapturedIsLogged(logger.events, [NOTE, AI_ANSWER, 'opus bytes that are never logged, not one of them']);
  });

  it('a photographed meal, logged or not, and when the model fails', async () => {
    const answers = [JSON.stringify({ items: ITEMS, note: 'I can see a bowl of oatmeal on a kitchen table' }),
      JSON.stringify({ items: [], note: 'I can only see an empty kitchen table in this picture' })];
    for (const answer of answers) {
      const logger = capturingLogger();
      await imageUseCase({ logger, answer }).uc.execute(photoInput());
      expectNothingCapturedIsLogged(logger.events, [PHOTO.toString('latin1'), PHOTO.toString('base64'), answer]);
    }
    const logger = capturingLogger();
    await expect(imageUseCase({ logger, aiFails: true }).uc.execute(photoInput())).rejects.toThrow();
    expectNothingCapturedIsLogged(logger.events, [PHOTO.toString('latin1'), PHOTO.toString('base64')]);
  });
});
