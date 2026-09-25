import { describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from './OpenAIAdapter.mjs';
import { AnthropicAdapter } from './AnthropicAdapter.mjs';
import { JevAdapter } from './JevAdapter.mjs';
import { VoiceTranscriptionService } from './VoiceTranscriptionService.mjs';
import { isAIGateway, IAIGateway } from '#apps/common/ports/IAIGateway.mjs';
import { isDecisionGateway, yesNo } from '#apps/common/ports/IDecisionGateway.mjs';
import { runWithOrigin } from '#system/runtime/aiContext.mjs';

const quietLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const chatReply = (content = 'Hi.') => ({
  status: 200,
  headers: {},
  data: { model: 'gpt-4.1', choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
});

function openai(post = vi.fn(async () => chatReply())) {
  const ledger = { record: vi.fn() };
  const adapter = new OpenAIAdapter({ apiKey: 'k' }, { httpClient: { post }, logger: quietLogger(), aiUsageLedger: ledger });
  return { adapter, ledger, post };
}

const rows = (ledger) => ledger.record.mock.calls.map(([row]) => row);

describe('OpenAIAdapter.scoped', () => {
  it('writes null app/feature/origin on an unscoped call', async () => {
    const { adapter, ledger } = openai();
    await adapter.chat([{ role: 'user', content: 'x' }]);
    expect(rows(ledger)[0]).toMatchObject({ app: null, feature: null, origin: null });
  });

  it('tags chat, chatWithJson, chatWithImage and embed through a view', async () => {
    const post = vi.fn(async (url) => (url.endsWith('/embeddings')
      ? { status: 200, headers: {}, data: { model: 'text-embedding-3-small', data: [{ embedding: [1, 2] }], usage: { total_tokens: 3 } } }
      : chatReply('{"ok":true}')));
    const { adapter, ledger } = openai(post);
    const health = adapter.scoped({ app: 'health' }).scoped({ feature: 'photo-log' });

    await health.chat([{ role: 'user', content: 'x' }]);
    await health.chatWithJson([{ role: 'user', content: 'x' }]);
    await health.chatWithImage([{ role: 'user', content: 'x' }], 'data:image/png;base64,AA==');
    await expect(health.embed('x')).resolves.toEqual([1, 2]);

    expect(rows(ledger)).toHaveLength(4);
    for (const row of rows(ledger)) expect(row).toMatchObject({ app: 'health', feature: 'photo-log' });
    // tags never reach the provider request body
    for (const [, body] of post.mock.calls) expect(JSON.stringify(body)).not.toContain('usageTags');
  });

  it('merges nested scopes with later tags winning per key, and a call\'s own tags winning over both', async () => {
    const { adapter, ledger } = openai();
    const base = adapter.scoped({ app: 'health', feature: 'text-log' });
    await base.scoped({ feature: 'revision' }).chat([{ role: 'user', content: 'x' }]);
    await base.scoped({ feature: undefined }).chat([{ role: 'user', content: 'x' }]);
    await base.chat([{ role: 'user', content: 'x' }], { usageTags: { feature: 'icon-pick' } });
    expect(rows(ledger).map(r => [r.app, r.feature])).toEqual([
      ['health', 'revision'], ['health', 'text-log'], ['health', 'icon-pick'],
    ]);
    expect(base.usageTags).toEqual({ app: 'health', feature: 'text-log' });
  });

  it('keeps two interleaved calls from different views on their own tags', async () => {
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    const post = vi.fn()
      .mockImplementationOnce(async () => { await firstGate; return chatReply('a'); })
      .mockImplementationOnce(async () => chatReply('b'));
    const { adapter, ledger } = openai(post);
    const a = adapter.scoped({ app: 'health', feature: 'photo-log' });
    const b = adapter.scoped({ app: 'journalist' });

    const first = runWithOrigin('telegram:nutribot', () => a.chat([{ role: 'user', content: 'a' }]));
    const second = runWithOrigin('http:POST /api/v1/journalist', () => b.chat([{ role: 'user', content: 'b' }]));
    await second; // b finishes while a is still in flight
    releaseFirst();
    await first;

    const [bRow, aRow] = rows(ledger);
    expect(bRow).toMatchObject({ app: 'journalist', feature: null, origin: 'http:POST /api/v1/journalist' });
    expect(aRow).toMatchObject({ app: 'health', feature: 'photo-log', origin: 'telegram:nutribot' });
  });

  it('tags error rows too', async () => {
    const post = vi.fn(async () => ({ status: 400, headers: {}, data: { error: { message: 'bad' } } }));
    const { adapter, ledger } = openai(post);
    await expect(adapter.scoped({ app: 'finance' }).chat([{ role: 'user', content: 'x' }])).rejects.toThrow('bad');
    expect(rows(ledger)[0]).toMatchObject({ status: 'error', app: 'finance', feature: null });
  });

  it('tags Whisper transcription rows, success and failure', async () => {
    const { adapter, ledger } = openai();
    adapter.httpClient.postForm = vi.fn(async () => ({ data: { text: 'hello' } }));
    const view = adapter.scoped({ app: 'health', feature: 'voice-log' });
    await expect(runWithOrigin('telegram:nutribot', () => view.transcribe(Buffer.from('x')))).resolves.toBe('hello');

    adapter.httpClient.postForm = vi.fn(async () => { throw Object.assign(new Error('nope'), { status: 400 }); });
    await expect(view.transcribe(Buffer.from('x'))).rejects.toThrow('nope');

    expect(rows(ledger)).toEqual([
      expect.objectContaining({ endpoint: '/audio/transcriptions', status: 'ok', app: 'health', feature: 'voice-log', origin: 'telegram:nutribot' }),
      expect.objectContaining({ endpoint: '/audio/transcriptions', status: 'error', app: 'health', feature: 'voice-log', origin: null }),
    ]);
  });

  it('still satisfies the port, instanceof, and reads through to the adapter', () => {
    const { adapter } = openai();
    const view = adapter.scoped({ app: 'health' });
    expect(isAIGateway(view)).toBe(true);
    expect(view).toBeInstanceOf(OpenAIAdapter);
    expect(view).toBeInstanceOf(IAIGateway);
    expect(view.isConfigured()).toBe(true);
    expect(view.miniModel).toBe(adapter.miniModel);
    expect(view.getMetrics().totals.requests).toBe(0);
    expect(view.chat).toBe(view.chat); // stable identity
    // scoping never mutates the shared adapter
    expect(adapter.usageTags).toBeUndefined();
  });

  it('uses a method stubbed on the adapter after the view was made', async () => {
    const { adapter } = openai();
    const view = adapter.scoped({ app: 'health' });
    adapter.getMetrics = () => 'stubbed';
    expect(view.getMetrics()).toBe('stubbed');
  });
});

describe('AnthropicAdapter.scoped', () => {
  it('tags chat and chatWithJson rows and passes the port check', async () => {
    const post = vi.fn(async () => ({
      status: 200, headers: {},
      data: { model: 'claude-sonnet-4', content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 5, output_tokens: 2 } },
    }));
    const ledger = { record: vi.fn() };
    const adapter = new AnthropicAdapter({ apiKey: 'k' }, { httpClient: { post }, logger: quietLogger(), aiUsageLedger: ledger });
    const view = adapter.scoped({ app: 'school' }).scoped({ feature: 'card-ladder' });
    expect(isAIGateway(view)).toBe(true);
    expect(view).toBeInstanceOf(AnthropicAdapter);

    await view.chat([{ role: 'user', content: 'x' }]);
    await view.chatWithJson([{ role: 'user', content: 'x' }]);
    await adapter.chat([{ role: 'user', content: 'x' }]);

    expect(rows(ledger).map(r => [r.app, r.feature])).toEqual([
      ['school', 'card-ladder'], ['school', 'card-ladder'], [null, null],
    ]);
  });
});

describe('JevAdapter.scoped', () => {
  it('tags evaluate rows and passes the decision-port check', async () => {
    const post = vi.fn(async () => ({ status: 200, headers: {}, data: { model: 'jev-1', answers: { q: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 4, output_tokens: 1 } } }));
    const ledger = { record: vi.fn() };
    const adapter = new JevAdapter({ apiKey: 'k' }, { httpClient: { post }, logger: quietLogger(), aiUsageLedger: ledger });
    const view = adapter.scoped({ app: 'finance', feature: 'categorize' });
    expect(isDecisionGateway(view)).toBe(true);

    await runWithOrigin('job:finance-categorize', () => view.evaluate('state', { q: yesNo('Is it?', { yes: 'y', no: 'n' }) }));
    expect(rows(ledger)[0]).toMatchObject({ provider: 'jev', app: 'finance', feature: 'categorize', origin: 'job:finance-categorize' });
    expect(JSON.stringify(post.mock.calls[0][1])).not.toContain('usageTags');
  });
});

describe('VoiceTranscriptionService.scoped', () => {
  const profile = { slug: 'voice-memo', whisperPrompt: () => 'p', cleanupPrompt: 'clean', cleanupOptions: { model: 'gpt-4.1-mini' } };

  it('passes its tags to both the Whisper call and the cleanup chat', async () => {
    const openaiAdapter = { transcribe: vi.fn(async () => 'raw'), chat: vi.fn(async () => 'clean'), isConfigured: () => true };
    const base = new VoiceTranscriptionService({ openaiAdapter, profile, logger: quietLogger() });
    const svc = base.scoped({ app: 'fitness' }).scoped({ feature: 'voice-memo' });

    await svc.transcribe({ audioBuffer: Buffer.from('x') });
    expect(openaiAdapter.transcribe.mock.calls[0][1].usageTags).toEqual({ app: 'fitness', feature: 'voice-memo' });
    expect(openaiAdapter.chat.mock.calls[0][1]).toEqual({ model: 'gpt-4.1-mini', usageTags: { app: 'fitness', feature: 'voice-memo' } });
    expect(svc.profileName).toBe('voice-memo');

    // the unscoped instance sends no tags and does not share the scoped one's
    await base.transcribe({ audioBuffer: Buffer.from('x') });
    expect(openaiAdapter.transcribe.mock.calls[1][1].usageTags).toBeUndefined();
    expect(profile.cleanupOptions).toEqual({ model: 'gpt-4.1-mini' });
  });

  it('merges with an app-scoped adapter view down to the ledger', async () => {
    const { adapter, ledger } = openai();
    adapter.httpClient.postForm = vi.fn(async () => ({ data: { text: 'raw' } }));
    const svc = new VoiceTranscriptionService({ openaiAdapter: adapter.scoped({ app: 'health' }), profile, logger: quietLogger() })
      .scoped({ feature: 'voice-log' });
    await svc.transcribe({ audioBuffer: Buffer.from('x') });
    expect(rows(ledger).map(r => [r.endpoint, r.app, r.feature])).toEqual([
      ['/audio/transcriptions', 'health', 'voice-log'], ['/chat/completions', 'health', 'voice-log'],
    ]);
  });
});
