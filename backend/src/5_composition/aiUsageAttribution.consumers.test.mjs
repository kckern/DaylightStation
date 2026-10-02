/**
 * Ledger attribution for the consumers that used to write `app` without a
 * `feature` (finance categorization, homebot gratitude, journalist use cases,
 * piano-games opponent dialogue), and the guard on anything still untagged.
 *
 * Each test drives a REAL call: a real OpenAIAdapter (fake HTTP) writing to a
 * real AiUsageLedger in a temp dir, through the gateway exactly as the
 * composition hands it to the consumer. The ledger row on disk is the
 * assertion, not a spy on usageTags.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OpenAIAdapter } from '#adapters/ai/OpenAIAdapter.mjs';
import { createAiUsageLedger } from '#adapters/ai/AiUsageLedger.mjs';

// Constructor arguments captured from the classes composition builds, so the
// test can call through the exact gateway a consumer was given.
const captured = vi.hoisted(() => ({}));

vi.mock('#apps/finance/TransactionCategorizationService.mjs', () => ({
  TransactionCategorizationService: class { constructor(deps) { captured.categorization = deps; } },
}));
vi.mock('#adapters/persistence/yaml/YamlFinanceDatastore.mjs', () => ({
  YamlFinanceDatastore: class { getCategorizationConfig() { return { validTags: ['Groceries'] }; } },
}));
vi.mock('#apps/homebot/usecases/ProcessGratitudeInput.mjs', () => ({
  ProcessGratitudeInput: class { constructor(deps) { captured.gratitude = deps; } },
}));
vi.mock('#adapters/ai/OpponentDialogueGenerator.mjs', () => ({
  OpponentDialogueGenerator: class { constructor(deps) { captured.dialogue = deps; } },
}));

const quietLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child() { return this; } });

async function harness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-attrib-'));
  const ledgerLogger = quietLogger();
  const ledger = createAiUsageLedger({ dir, logger: ledgerLogger });
  const post = vi.fn(async () => ({
    status: 200,
    headers: {},
    data: {
      model: 'gpt-4.1-2025-04-14',
      choices: [{ message: { content: '{"items":[{"text":"Family"}],"category":"gratitude"}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    },
  }));
  const adapter = new OpenAIAdapter({ apiKey: 'test-key' }, { httpClient: { post }, logger: quietLogger(), aiUsageLedger: ledger });
  const rows = async () => {
    const files = await fs.readdir(dir);
    const text = (await Promise.all(files.map(f => fs.readFile(path.join(dir, f), 'utf8')))).join('');
    return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  };
  return { adapter, rows, ledgerLogger };
}

const MESSAGES = [{ role: 'user', content: 'hi' }];

describe('AI usage attribution — previously feature-less consumers', () => {
  beforeEach(() => { for (const key of Object.keys(captured)) delete captured[key]; });

  it('finance categorization (hourly budget job) writes finance/categorization', async () => {
    const { adapter, rows } = await harness();
    const { createFinanceServices } = await import('./bootstrap.mjs');
    createFinanceServices({
      configService: {},
      buxferAdapter: {},
      // as app.mjs hands it over
      aiGateway: adapter.scoped({ app: 'finance' }),
      decisionGateway: null,
      defaultHouseholdId: 'default',
      logger: quietLogger(),
    });
    await captured.categorization.aiGateway.chatWithJson(MESSAGES);
    expect(await rows()).toEqual([expect.objectContaining({ app: 'finance', feature: 'categorization' })]);
  });

  it('homebot gratitude extraction writes homebot/gratitude', async () => {
    const { adapter, rows } = await harness();
    const { createHomebotServices } = await import('./bootstrap.mjs');
    const { homebotContainer } = createHomebotServices({
      telegramAdapter: {},
      aiGateway: adapter.scoped({ app: 'homebot' }),
      gratitudeService: {},
      configService: {},
      logger: quietLogger(),
    });
    await homebotContainer.getProcessGratitudeInput();
    await captured.gratitude.aiGateway.chatWithJson(MESSAGES);
    expect(await rows()).toEqual([expect.objectContaining({ app: 'homebot', feature: 'gratitude' })]);
  });

  it('piano-games opponent dialogue writes piano-games/opponent-dialogue', async () => {
    const { adapter, rows } = await harness();
    const { createPianoGamesModule } = await import('./modules/pianoGames.mjs');
    const module = createPianoGamesModule({
      dataService: { user: { read: () => null, write: () => true }, household: { write: () => true } },
      configService: { getHouseholdAppConfig: () => ({}) },
      logger: null,
      aiGateway: adapter.scoped({ app: 'piano-games' }),
    });
    try {
      await captured.dialogue.aiGateway.chat(MESSAGES, { model: 'gpt-5.6-luna' });
    } finally {
      module.container.dispose();
    }
    expect(await rows()).toEqual([expect.objectContaining({ app: 'piano-games', feature: 'opponent-dialogue' })]);
  });

  it('journalist use cases each write journalist/<feature>, through the logging wrapper', async () => {
    const { adapter, rows } = await harness();
    const { JournalistContainer } = await import('#apps/journalist/JournalistContainer.mjs');
    const { LoggingAIGateway } = await import('#adapters/journalist/LoggingAIGateway.mjs');
    const container = new JournalistContainer({ username: 'tester' }, {
      messagingGateway: { sendMessage: vi.fn(async () => ({ messageId: 'm1' })) },
      aiGateway: adapter.scoped({ app: 'journalist' }),
      // the real wrapper composition uses — it has no scoped(), which is why
      // the container narrows BEFORE wrapping
      loggingAIGatewayFactory: deps => new LoggingAIGateway(deps),
      logger: quietLogger(),
    });
    await container.getGenerateMultipleChoices().execute({ chatId: 'c1', question: 'How was today?' });
    const written = await rows();
    expect(written.length).toBeGreaterThan(0);
    for (const row of written) expect(row).toMatchObject({ app: 'journalist', feature: 'multiple-choice' });
  });
});

describe('AI usage ledger guard — unscoped calls name their caller', () => {
  it('an unscoped call is written app:null with the calling file, and warns once per caller', async () => {
    const { adapter, rows, ledgerLogger } = await harness();

    async function unscopedConsumer() {
      await adapter.chat(MESSAGES);
    }
    await unscopedConsumer();
    await unscopedConsumer();

    const written = await rows();
    expect(written).toHaveLength(2);
    for (const row of written) {
      expect(row.app).toBeNull();
      expect(row.caller).toMatch(/^5_composition\/aiUsageAttribution\.consumers\.test\.mjs:\d+ \(unscopedConsumer\)$/);
    }
    const warns = ledgerLogger.warn.mock.calls.filter(([event]) => event === 'ai.usage.unattributed');
    expect(warns).toHaveLength(1);
    expect(warns[0][1]).toMatchObject({ provider: 'openai', endpoint: '/chat/completions', caller: written[0].caller });
  });

  it('a scoped call carries no caller and does not warn', async () => {
    const { adapter, rows, ledgerLogger } = await harness();
    await adapter.scoped({ app: 'finance', feature: 'categorization' }).chat(MESSAGES);
    const [row] = await rows();
    expect(row).toMatchObject({ app: 'finance', feature: 'categorization' });
    expect(row).not.toHaveProperty('caller');
    expect(ledgerLogger.warn).not.toHaveBeenCalledWith('ai.usage.unattributed', expect.anything());
  });
});
