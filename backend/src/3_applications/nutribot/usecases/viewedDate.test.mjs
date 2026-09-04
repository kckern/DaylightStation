/**
 * The viewed day inside the three capture use cases.
 *
 * Text/voice: the viewed day becomes the prompt's "today", so a relative
 * phrase resolves against the day the person is LOOKING AT. It is an anchor,
 * not an override — a date the model computes from that anchor still wins.
 *
 * Image/barcode: no words to date anything from, so the viewed day simply IS
 * the row's date. Absent, both fall back to the wall clock exactly as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromText } from './LogFoodFromText.mjs';
import { LogFoodFromUPC } from './LogFoodFromUPC.mjs';
import { LogFoodFromImage } from './LogFoodFromImage.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const VIEWED = '2026-09-03';

function makeText({ aiJson }) {
  const prompts = [];
  const saved = [];
  const useCase = new LogFoodFromText({
    messagingGateway: { sendMessage: async () => ({ messageId: 'm' }), updateMessage: async () => {}, deleteMessage: async () => {} },
    aiGateway: { chat: async (prompt) => { prompts.push(prompt); return JSON.stringify(aiJson); } },
    foodLogStore: { save: async (log) => { saved.push(log); return log; }, findByUuid: async () => null },
    conversationStateStore: null,
    config: { getDefaultTimezone: () => 'America/Los_Angeles', getUserTimezone: () => 'America/Los_Angeles' },
    logger: silent,
  });
  return { useCase, prompts, saved };
}

const ITEM = { name: 'Burger', icon: 'default', noom_color: 'orange', grams: 200, unit: 'g', quantity: 1, calories: 500, protein: 25, carbs: 40, fat: 25 };

describe('LogFoodFromText — the viewed day anchors the parse', () => {
  it('pins the prompt\'s "today" to the viewed day', async () => {
    const { useCase, prompts } = makeText({ aiJson: { date: VIEWED, time: 'evening', items: [ITEM] } });
    await useCase.execute({ userId: 'kc', conversationId: 'web:kc', text: 'a burger', asOfDate: VIEWED });
    const system = prompts[0][0].content;
    expect(system).toContain(`today is Thursday, ${VIEWED}`);
  });

  it('with no viewed day the prompt still reads the wall clock', async () => {
    const { useCase, prompts } = makeText({ aiJson: { items: [ITEM] } });
    await useCase.execute({ userId: 'kc', conversationId: 'web:kc', text: 'a burger' });
    const system = prompts[0][0].content;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    expect(system).toContain(`, ${today} at `);
    expect(system).not.toContain(VIEWED);
  });

  it('a model that names no date falls back to the VIEWED day, not the server clock', async () => {
    const { useCase, saved } = makeText({ aiJson: { time: 'evening', items: [ITEM] } });
    await useCase.execute({ userId: 'kc', conversationId: 'web:kc', text: 'a burger', asOfDate: VIEWED });
    expect(saved[0].meal.date).toBe(VIEWED);
  });

  it('a date the model computed FROM the anchor still wins — the anchor is not an override', async () => {
    const { useCase, saved } = makeText({ aiJson: { date: '2026-09-02', time: 'evening', items: [ITEM] } });
    await useCase.execute({ userId: 'kc', conversationId: 'web:kc', text: 'a burger yesterday', asOfDate: VIEWED });
    expect(saved[0].meal.date).toBe('2026-09-02');
  });
});

describe('LogFoodFromUPC — the viewed day dates the row', () => {
  const product = { name: 'Cereal', brand: 'X', servingSize: '30g', nutrition: { calories: 120, protein: 3, carbs: 25, fat: 1 } };

  function makeUpc() {
    const saved = [];
    const useCase = new LogFoodFromUPC({
      messagingGateway: { sendMessage: async () => ({ messageId: 'm' }), updateMessage: async () => {}, deleteMessage: async () => {} },
      upcGateway: { lookup: async () => product },
      foodLogStore: { save: async (log) => { saved.push(log); return log; } },
      config: { getUserTimezone: () => 'America/Los_Angeles' },
      logger: silent,
    });
    return { useCase, saved };
  }

  it('writes the row on the viewed day', async () => {
    const { useCase, saved } = makeUpc();
    await useCase.execute({ userId: 'kc', conversationId: 'web:kc', upc: '012345678905', date: VIEWED });
    // The flow saves twice (create, then the portion step re-saves); every
    // save must carry the same day.
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.every((l) => l.meal.date === VIEWED)).toBe(true);
    // A day that has already ended has no current hour (decision 2.24).
    expect(saved[0].meal.time).toBe('morning');
  });

  it('with no viewed day, the wall clock still decides — byte-identical for Telegram/scale', async () => {
    const { useCase, saved } = makeUpc();
    await useCase.execute({ userId: 'kc', conversationId: 'web:kc', upc: '012345678905' });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    expect(saved[0].meal.date).toBe(today);
  });
});

describe('LogFoodFromImage — the viewed day dates the row', () => {
  function makeImage() {
    const saved = [];
    const useCase = new LogFoodFromImage({
      messagingGateway: { sendMessage: async () => ({ messageId: 'm' }), sendPhoto: async () => ({ messageId: 'p' }), updateMessage: async () => {}, deleteMessage: async () => {} },
      aiGateway: { chatWithImage: async () => JSON.stringify({ items: [ITEM] }) },
      imageDownloader: { download: async (u) => u },
      foodLogStore: { save: async (log) => { saved.push(log); return log; } },
      config: { getDefaultTimezone: () => 'America/Los_Angeles', getUserTimezone: () => 'America/Los_Angeles' },
      logger: silent,
    });
    return { useCase, saved };
  }
  const rc = { sendMessage: async () => ({ messageId: 'm' }), sendPhoto: async () => ({ messageId: 'p' }), updateMessage: async () => {}, deleteMessage: async () => {} };

  it('writes the row on the viewed day, in that day\'s first meal', async () => {
    const { useCase, saved } = makeImage();
    await useCase.execute({
      userId: 'kc', conversationId: 'web:kc',
      imageData: { url: 'data:image/jpeg;base64,AA' }, date: VIEWED, responseContext: rc,
    });
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.every((l) => l.meal.date === VIEWED)).toBe(true);
    expect(saved.every((l) => l.meal.time === 'morning')).toBe(true);
  });

  it('with no viewed day the wall clock still decides', async () => {
    const { useCase, saved } = makeImage();
    await useCase.execute({
      userId: 'kc', conversationId: 'web:kc',
      imageData: { url: 'data:image/jpeg;base64,AA' }, responseContext: rc,
    });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    expect(saved[0].meal.date).toBe(today);
  });
});
