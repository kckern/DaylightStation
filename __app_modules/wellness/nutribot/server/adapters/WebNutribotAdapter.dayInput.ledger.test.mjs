/**
 * Day input through the real capture path: NutribotContainer, NutribotInputRouter,
 * FoodLogReview, composition and the YAML stores. Only the gateways are fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256Text } from '#system/utils/sha256.mjs';
import { WebNutribotAdapter } from './WebNutribotAdapter.mjs';
import { NutribotContainer } from '../application/NutribotContainer.mjs';
import { NutribotInputRouter } from '../application/services/NutribotInputRouter.mjs';
import { YamlFoodLogDatastore } from '../../../health/server/adapters/persistence/yaml/YamlFoodLogDatastore.mjs';
import { YamlNutriListDatastore } from '../../../health/server/adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { createNutritionWebDependencies } from '../../../health/server/composition/web-capture.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };
const date = '2026-11-18';
const AUDIO = `data:audio/webm;base64,${Buffer.from('spoken').toString('base64')}`;
// The words are read as new food, and no meal is named for it.
const READING = { intent: 'add', target: 'latest', fromMeal: 'none', toMeal: 'same', toDay: 'same' };
const readAsNewFood = async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(id => [id,
  id === 'compound' ? { type: 'yesNo', probability: 0 } : { type: 'choice', choice: READING[id] ?? 'unsaid' }])) });
const PARSED = JSON.stringify({ date, items: [{ name: 'Eggs', grams: 100, calories: 140, protein: 12, carbs: 1, fat: 10, noom_color: 'yellow', icon: 'default' }] });

describe('day input on the real capture path', () => {
  let root, items, chat, transcribeVoice, adapter, container, evaluate;
  const audioFiles = () => { const dir = path.join(root, 'u', 'lifelog/nutrition/audio'); return fs.existsSync(dir) ? fs.readdirSync(dir) : []; };
  const send = extra => adapter.processDayInput({ userId: 'u', type: 'text', content: 'eggs', date, today: date, operationId: 'op', resolved: {}, ...extra });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-input-ledger-'));
    const dataService = { user: { resolveDir: (relative, userId) => path.join(root, userId, relative) } };
    items = new YamlNutriListDatastore({ dataService, logger: silent });
    const foodLogStore = new YamlFoodLogDatastore({ configService: { getUserDir: id => path.join(root, id) }, logger: silent });
    chat = vi.fn(async () => PARSED);
    transcribeVoice = vi.fn(async () => 'eggs');
    const messagingGateway = { sendMessage: vi.fn(async () => ({ messageId: 'm' })), updateMessage: vi.fn(async () => ({})), deleteMessage: vi.fn(async () => ({})), transcribeVoice };
    const config = new Proxy({ getUserTimezone: () => 'UTC' }, { get: (target, key) => (key in target ? target[key] : key === 'then' ? undefined : () => undefined) });
    evaluate = vi.fn(readAsNewFood);
    container = new NutribotContainer(config, { messagingGateway, aiGateway: { chat }, foodLogStore, nutriListStore: items, logger: silent,
      decisionGateway: { evaluate } });
    adapter = new WebNutribotAdapter(createNutritionWebDependencies({
      applicationInputRouter: new NutribotInputRouter(container, { logger: silent }), aiGatewayAvailable: true, logger: silent, dataService,
      nutribotServices: { nutribotContainer: container, nutriListStore: items, foodLogStore },
    }));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reports food the ledger holds after the commit failed, and a resend adds nothing', async () => {
    container.setReceiptPublisher({ bind: async () => {}, refresh: async () => { throw new Error('receipt failed'); } });
    const reply = await send();
    expect(reply).toMatchObject({ committed: true, outcome: 'committed', kind: 'added', message: 'Logged Eggs' });
    expect(reply.undoToken).toMatch(/^meal-/);
    expect(items.readOperationResult('u', sha256Text('op:day:capture'))).toMatchObject({ committed: true, outcome: 'committed', instructionText: 'eggs' });
    const readings = evaluate.mock.calls.length;
    expect(await send()).toMatchObject({ committed: true, kind: 'added', undoToken: reply.undoToken });
    expect(evaluate).toHaveBeenCalledTimes(readings);
    expect(chat).toHaveBeenCalledTimes(1);
    expect((await items.findByDate('u', date)).map(row => row.name || row.label)).toEqual(['Eggs']);
  });

  it('answers a voice retry from finished work without transcribing again', async () => {
    const first = await send({ type: 'voice', content: AUDIO });
    expect(first).toMatchObject({ committed: true, instructionText: 'eggs' });
    expect(await send({ type: 'voice', content: AUDIO })).toMatchObject({ committed: true, kind: 'added', undoToken: first.undoToken, instructionText: 'eggs' });
    expect(transcribeVoice).toHaveBeenCalledTimes(1);
    expect(audioFiles()).toHaveLength(1);
    expect(await items.findByDate('u', date)).toHaveLength(1);
  });

  it('retries a failed transcription from the saved recording', async () => {
    transcribeVoice.mockRejectedValueOnce(Object.assign(new Error('upstream'), { status: 500 }));
    const failure = await send({ type: 'voice', content: AUDIO }).catch(error => error);
    expect(failure).toMatchObject({ status: 502, code: 'TRANSCRIBE_FAILED' });
    expect(await send({ type: 'voice', content: undefined, audioRef: failure.audioRef })).toMatchObject({ committed: true, kind: 'added' });
    expect(audioFiles()).toHaveLength(1);
    await expect(send({ type: 'voice', content: undefined, audioRef: 'va_missing', operationId: 'other' })).rejects.toMatchObject({ code: 'AUDIO_NOT_FOUND' });
  });

  it('lets the HTTP retry name the saved recording under the same operation ID', async () => {
    const { default: express } = await import('express');
    const { default: request } = await import('supertest');
    const { createHealthRouter } = await import('../../../health/server/api/routers/health.mjs');
    const { HealthOperations } = await import('../../../health/server/application/health/HealthOperations.mjs');
    const healthOperations = new HealthOperations({ healthData: {}, nutritionItems: items, nutritionInput: adapter, today: () => date });
    healthOperations.defaultUsername = () => 'u';
    const app = express().use(express.json()).use(createHealthRouter({ healthOperations, logger: silent }));
    const post = body => request(app).post('/nutrition/day-input').send({ type: 'voice', date, operationId: 'http-op', ...body });
    transcribeVoice.mockRejectedValueOnce(new Error('upstream'));
    const failed = await post({ content: AUDIO });
    expect(failed.status).toBe(502);
    const retried = await post({ audioRef: failed.body.audioRef });
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ committed: true, kind: 'added' });
    expect((await post({ audioRef: failed.body.audioRef })).body).toEqual(retried.body);
    expect(transcribeVoice).toHaveBeenCalledTimes(2);
    expect(await items.findByDate('u', date)).toHaveLength(1);
  });

  const httpApp = async () => {
    const { default: express } = await import('express');
    const { default: request } = await import('supertest');
    const { createHealthRouter } = await import('../../../health/server/api/routers/health.mjs');
    const { HealthOperations } = await import('../../../health/server/application/health/HealthOperations.mjs');
    const healthOperations = new HealthOperations({ healthData: {}, nutritionItems: items, nutritionInput: adapter, today: () => date });
    healthOperations.defaultUsername = () => 'u';
    const app = express().use(express.json()).use(createHealthRouter({ healthOperations, logger: silent }));
    return body => request(app).post('/nutrition/day-input').send({ type: 'voice', date, operationId: 'http-op', ...body });
  };

  it('lets a person record again under the same ID after a saved recording is gone', async () => {
    const post = await httpApp();
    expect((await post({ audioRef: 'va_missing' })).status).toBe(404);
    const recorded = await post({ content: AUDIO });
    expect(recorded.status).toBe(200);
    expect(recorded.body).toMatchObject({ committed: true, kind: 'added' });
  });

  it('retries from the same recording when the parser fails after transcription', async () => {
    const post = await httpApp();
    chat.mockRejectedValueOnce(Object.assign(new Error('Provider said 429'), { status: 429 }));
    const failed = await post({ content: AUDIO });
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({ code: 'DAY_INPUT_UNAVAILABLE' });
    expect(failed.body.audioRef).toMatch(/^va_/);
    const retried = await post({ audioRef: failed.body.audioRef });
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ committed: true, kind: 'added' });
    expect(audioFiles()).toHaveLength(1);
    expect(await items.findByDate('u', date)).toHaveLength(1);
  });

  it('does not pay the parser for a transcript too long to log', async () => {
    transcribeVoice.mockResolvedValue('a'.repeat(2001));
    const failure = await send({ type: 'voice', content: AUDIO }).catch(error => error);
    expect(failure).toMatchObject({ status: 422, code: 'DAY_INPUT_TOO_LONG' });
    expect(failure.audioRef).toMatch(/^va_/);
    expect(chat).not.toHaveBeenCalled();
    expect(await items.findByDate('u', date)).toHaveLength(0);
  });
});
