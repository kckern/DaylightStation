// @vitest-environment node
/**
 * Health's AI spend is attributed per feature. Each Health use case is driven
 * through the wiring production uses (NutribotContainer, the nutribot API
 * module's services, the nutrition cleanup's artwork queue) with a REAL
 * scoped view over a real OpenAIAdapter whose HTTP client refuses every call.
 * The refusal ends the use case early; the ledger row the adapter writes for
 * it carries the attribution, which is all this test reads.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAIAdapter } from '#adapters/ai/OpenAIAdapter.mjs';
import { NutribotContainer } from '#apps/nutribot/NutribotContainer.mjs';
import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';
import { scopedGateway } from '#apps/common/ports/IAIGateway.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };

/** A dependency that answers every method with `undefined` unless overridden. */
function anything(overrides = {}) {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return vi.fn(async () => undefined);
    },
  });
}

function harness() {
  const ledger = { record: vi.fn() };
  const post = vi.fn(async () => ({ status: 400, headers: {}, data: { error: { message: 'refused by test' } } }));
  const postForm = vi.fn(async () => { throw Object.assign(new Error('refused by test'), { status: 400 }); });
  const adapter = new OpenAIAdapter({ apiKey: 'test' }, { httpClient: { post, postForm }, logger: silent, aiUsageLedger: ledger });
  const health = adapter.scoped({ app: 'health' });
  const features = () => ledger.record.mock.calls.map(([row]) => `${row.app}/${row.feature}`);
  return { adapter, health, ledger, features };
}

const pendingLog = () => NutriLog.create({
  id: 'aB3dE5gH7j', userId: 'alice', conversationId: 'c1', timestamp: new Date('2026-09-25T08:00:00Z'),
  items: [{ id: 'kL9mN1pQ3r', uuid: '00000000-0000-4000-a000-000000000001', color: 'green', label: 'Oats',
    calories: 300, grams: 80, unit: 'g', amount: 80 }],
});

function container(health, overrides = {}) {
  const log = pendingLog();
  return new NutribotContainer(
    // Config is read synchronously: every method answers undefined.
    new Proxy({ getUserTimezone: () => 'America/Los_Angeles' }, {
      get: (target, prop) => (prop in target ? target[prop] : prop === 'then' ? undefined : () => undefined),
    }),
    {
      messagingGateway: anything({
        sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
        updateMessage: vi.fn(async () => ({})),
        deleteMessage: vi.fn(async () => ({})),
        transcribeVoice: vi.fn(async () => 'two eggs and toast'),
      }),
      aiGateway: health,
      foodLogStore: anything({ findByUuid: vi.fn(async () => log) }),
      nutriListStore: anything(),
      conversationStateStore: anything({
        get: vi.fn(async () => ({ activeFlow: 'revision', flowState: { pendingLogUuid: log.uuid } })),
      }),
      upcGateway: anything({
        lookup: vi.fn(async () => ({
          name: 'Granola Bar', brand: 'Acme', serving: { size: 40, unit: 'g' }, icon: 'default',
          nutrition: { calories: 190, protein: 4, carbs: 29, fat: 7 },
          nutritionLookup: { source: 'upc', basis: 'serving', missing: [], warnings: [] },
        })),
      }),
      imageDownloader: anything({ download: vi.fn(async () => Buffer.from('img')) }),
      logger: silent,
      ...overrides,
    },
  );
}

const attempt = async (fn) => { try { await fn(); } catch { /* the refusal ends it */ } };

describe('Health AI spend is attributed health/<feature>', () => {
  it('photo-log: LogFoodFromImage', async () => {
    const { health, features } = harness();
    await attempt(() => container(health).getLogFoodFromImage().execute({
      userId: 'alice', conversationId: 'c1', imageData: { url: 'data:image/png;base64,AAAA' }, messageId: 1 }));
    expect(features()).toContain('health/photo-log');
    expect(new Set(features())).toEqual(new Set(['health/photo-log']));
  });

  it('text-log: LogFoodFromText', async () => {
    const { health, features } = harness();
    await attempt(() => container(health).getLogFoodFromText().execute({
      userId: 'alice', conversationId: 'c1', text: 'two eggs', messageId: 1 }));
    expect(new Set(features())).toEqual(new Set(['health/text-log']));
  });

  it('voice-log: LogFoodFromVoice parses its transcript as voice-log, not text-log', async () => {
    const { health, features } = harness();
    const c = container(health);
    await attempt(() => c.getLogFoodFromVoice().execute({
      userId: 'alice', conversationId: 'c1', voiceData: { fileId: 'f1' }, messageId: 1 }));
    expect(new Set(features())).toEqual(new Set(['health/voice-log']));
    // typed text through the same container still bills text-log
    await attempt(() => c.getLogFoodFromText().execute({ userId: 'alice', conversationId: 'c1', text: 'toast', messageId: 2 }));
    expect(features().at(-1)).toBe('health/text-log');
  });

  it('voice-log: the Whisper call of a nutribot voice memo', async () => {
    const { adapter, features } = harness();
    const { TelegramVoiceTranscriptionService } = await import('#adapters/messaging/TelegramVoiceTranscriptionService.mjs');
    const { botUsageTags } = await import('#composition/integrations/SystemBotLoader.mjs');
    const base = new TelegramVoiceTranscriptionService({ openaiAdapter: adapter.scoped({ app: 'messaging' }) }, { httpClient: anything(), logger: silent });
    await attempt(() => scopedGateway(base, botUsageTags('nutribot')).transcribe(Buffer.from('x')));
    await attempt(() => scopedGateway(base, botUsageTags('journalist')).transcribe(Buffer.from('x')));
    expect(features()).toEqual(['health/voice-log', 'journalist/null']);
  });

  it('upc-log: LogFoodFromUPC', async () => {
    const { health, features } = harness();
    await attempt(() => container(health).getLogFoodFromUPC().execute({
      userId: 'alice', conversationId: 'c1', upc: '012345678905', messageId: 1 }));
    // classification bills upc-log; the LLM icon fallback it falls to bills icon-pick
    expect(new Set(features())).toEqual(new Set(['health/upc-log', 'health/icon-pick']));
  });

  it('scale-log: LogScaleFoodFromText', async () => {
    const { health, features } = harness();
    const c = container(health);
    await attempt(() => c.getLogScaleFoodFromText().execute({
      userId: 'alice', conversationId: 'c1', logUuid: 'any', text: 'granola', messageId: 1 }));
    expect(new Set(features())).toEqual(new Set(['health/scale-log']));
  });

  it('revision: ProcessRevisionInput', async () => {
    const { health, features } = harness();
    await attempt(() => container(health).getProcessRevisionInput().execute({
      userId: 'alice', conversationId: 'c1', text: 'make it 100g', messageId: 1 }));
    expect(new Set(features())).toEqual(new Set(['health/revision']));
  });

  it('meal-instruction and revision: the web services the nutribot API module builds', async () => {
    const { health, features } = harness();
    const { createNutribotApiRouter } = await import('#composition/modules/nutribotApi.mjs');
    const nutriListStore = anything({
      findByDate: vi.fn(async () => [{ id: 'r1', uuid: 'r1', label: 'Oats', grams: 80, calories: 300, meal: { time: 'morning' }, bucket: 'breakfast' }]),
      findByUuid: vi.fn(async () => ({ id: 'r1', uuid: 'r1', label: 'Oats', grams: 80, calories: 300, unit: 'g', amount: 80 })),
    });
    const { webNutribotAdapter } = createNutribotApiRouter({
      nutribotServices: { nutribotContainer: container(health), nutriListStore, foodLogStore: anything() },
      logger: silent,
    });
    await attempt(() => webNutribotAdapter.suggestMealGroups({ userId: 'alice', date: '2026-09-25', bucket: 'breakfast' }));
    expect(features()).toEqual(['health/meal-instruction']);
    await attempt(() => webNutribotAdapter.reviseEntry({ userId: 'alice', entryUuid: 'r1', instruction: 'it was cauliflower rice' }));
    expect(features()).toEqual(['health/meal-instruction', 'health/revision']);
  });

  it('icon-pick: the nearest-icon chooser bills its decision model to icon-pick', async () => {
    const { JevAdapter } = await import('#adapters/ai/JevAdapter.mjs');
    const ledger = { record: vi.fn() };
    const post = vi.fn(async () => ({ status: 400, data: { error: { message: 'refused by test' } } }));
    const jev = new JevAdapter({ apiKey: 'test' }, { httpClient: { post }, logger: silent, aiUsageLedger: ledger });
    const { health } = harness();
    const c = container(health, { decisionGateway: jev.scoped({ app: 'health' }) });
    await attempt(() => c.getIconChooser().choose({ name: 'granola', vocabulary: ['granola', 'oats'] }));
    expect(ledger.record.mock.calls.map(([row]) => `${row.app}/${row.feature}`)).toEqual(['health/icon-pick']);
  });

  it('icon-pick and auditor-triage: the nutrition cleanup narrows the artwork gateway and the triage model', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createNutritionCleanup } = await import('#composition/modules/nutritionCleanup.mjs');
    const scopedWith = [];
    const recording = (tags = {}) => ({ chat: async () => '', evaluate: async () => ({}), isConfigured: () => true,
      scoped(more) { scopedWith.push({ ...tags, ...more }); return recording({ ...tags, ...more }); } });
    const root = await mkdtemp(join(tmpdir(), 'cleanup-ai-'));
    try {
      const cleanup = createNutritionCleanup({
        dataService: { user: { resolveDir: (relative, userId) => join(root, userId, relative) }, household: { read: () => null } },
        configService: { getMediaDir: () => root, getDataDir: () => root, getHeadOfHousehold: () => 'alice' },
        nutribotServices: {
          nutribotContainer: { getFoodLogReview: () => ({ recover: async () => {}, runExclusive: async (_u, action) => action() }),
            getMessagingGateway: () => ({ available: false }), getAIGateway: () => recording({ app: 'health' }) },
          nutriListStore: { findByDateRange: async () => [] }, foodLogStore: {},
        },
        decisionGateway: recording({ app: 'health' }),
        agentOrchestrator: { register: vi.fn() }, logger: silent,
      });
      cleanup.stop();
      expect(scopedWith).toContainEqual({ app: 'health', feature: 'icon-pick' });
      expect(scopedWith).toContainEqual({ app: 'health', feature: 'auditor-triage' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
