import { describe, it, expect, vi } from 'vitest';
import { StructuredWireLayer } from './StructuredWireLayer.mjs';
import { IAIGateway } from '#apps/common/ports/IAIGateway.mjs';

const TEMPLATE_PROMPT = [
  { role: 'system', content: 'Analyze food.\nRespond in JSON format:\n{\n  "time": "evening",\n  "items": [{ "name": "Food", "grams": 100, "dish": "Bowl" }]\n}\nBegin response with \'{\' character - output only valid JSON, no markdown.' },
  { role: 'user', content: 'eggs' },
];
const TOON_REPLY = 'time: morning\nitems[1\t]{name\tgrams\tdish}:\n  Fried Egg\t100\t\nEND';

function fakeInner({ chat = async () => TOON_REPLY, chatStructured = async () => ({ from: 'json-path' }) } = {}) {
  const inner = {
    chat: vi.fn(chat),
    chatWithImage: vi.fn(async () => TOON_REPLY),
    chatStructured: vi.fn(chatStructured),
    transcribe: vi.fn(async () => 'words'),
    embed: vi.fn(async () => [1, 2]),
    isConfigured: () => true,
    model: 'gpt-4.1',
    scoped: vi.fn((tags) => ({ ...inner, scopedWith: tags })),
  };
  return inner;
}
const layer = (inner, opts = {}) => new StructuredWireLayer(inner, { mode: 'full', sample: 1, random: () => 0, ...opts });

describe('StructuredWireLayer', () => {
  it('is an IAIGateway and forwards unknown properties to the inner adapter', () => {
    const l = layer(fakeInner());
    expect(l).toBeInstanceOf(IAIGateway);
    expect(l.model).toBe('gpt-4.1');
  });

  it('mode off: passes the exact messages array and options object through', async () => {
    const inner = fakeInner({ chat: async () => 'raw' });
    const options = { maxTokens: 10 };
    expect(await layer(inner, { mode: 'off' }).chat(TEMPLATE_PROMPT, options)).toBe('raw');
    expect(inner.chat.mock.calls[0][0]).toBe(TEMPLATE_PROMPT);
    expect(inner.chat.mock.calls[0][1]).toBe(options);
  });

  it('chat on the TOON path: rewritten prompt out, JSON string back, wire tag set, jsonMode never sent', async () => {
    const inner = fakeInner();
    const out = await layer(inner).chat(TEMPLATE_PROMPT, { maxTokens: 4096, jsonMode: true });
    expect(JSON.parse(out)).toEqual({ time: 'morning', items: [{ name: 'Fried Egg', grams: 100 }] });
    const [sent, opts] = inner.chat.mock.calls[0];
    expect(sent[0].content).toMatch(/items\[N\t\]\{name\tgrams\tdish\}:/);
    expect(opts).toMatchObject({ maxTokens: 4096, usageTags: { wire: 'toon' } });
    expect(Object.hasOwn(opts, 'jsonMode')).toBe(false);
  });

  it('chat: an undecodable reply re-asks once with the ORIGINAL messages and options, tagged json', async () => {
    const replies = ['I could not do that', '{"time":"x","items":[]}'];
    const inner = fakeInner({ chat: async () => replies.shift() });
    const options = { maxTokens: 50, jsonMode: true, usageTags: { feature: 'log' } };
    expect(await layer(inner).chat(TEMPLATE_PROMPT, options)).toBe('{"time":"x","items":[]}');
    expect(inner.chat).toHaveBeenCalledTimes(2);
    const [sent, opts] = inner.chat.mock.calls[1];
    expect(sent).toBe(TEMPLATE_PROMPT);
    expect(opts).toEqual({ maxTokens: 50, jsonMode: true, usageTags: { feature: 'log', wire: 'json' } });
  });

  it('chat: re-ask keeps jsonMode absent when the caller did not pass it', async () => {
    const replies = ['nope', '{}'];
    const inner = fakeInner({ chat: async () => replies.shift() });
    await layer(inner).chat(TEMPLATE_PROMPT);
    expect(Object.hasOwn(inner.chat.mock.calls[1][1], 'jsonMode')).toBe(false);
  });

  it('chatWithImage: an undecodable reply re-asks once with the original messages AND the image', async () => {
    const replies = ['garbage: [', '{"items":[]}'];
    const inner = fakeInner();
    inner.chatWithImage.mockImplementation(async () => replies.shift());
    const out = await layer(inner).chatWithImage(TEMPLATE_PROMPT, 'data:image/png;base64,AA', { jsonMode: false });
    expect(out).toBe('{"items":[]}');
    expect(inner.chatWithImage).toHaveBeenCalledTimes(2);
    const [sent, image, opts] = inner.chatWithImage.mock.calls[1];
    expect(sent).toBe(TEMPLATE_PROMPT);
    expect(image).toBe('data:image/png;base64,AA');
    expect(opts).toEqual({ jsonMode: false, usageTags: { wire: 'json' } });
  });

  // Review Focus 3
  it('JSON reply on the TOON path: chat returns it raw; chatStructured parses it without a second call', async () => {
    const json = '{"time":"x","items":[]}';
    const inner = fakeInner({ chat: async () => json });
    expect(await layer(inner).chat(TEMPLATE_PROMPT)).toBe(json);
    expect(inner.chat).toHaveBeenCalledTimes(1); // no re-ask for a JSON reply
    expect(await layer(inner).chatStructured(TEMPLATE_PROMPT)).toEqual({ time: 'x', items: [] });
    expect(inner.chatStructured).not.toHaveBeenCalled();
  });

  it('chatStructured on the TOON path returns the decoded object via inner.chat', async () => {
    const inner = fakeInner();
    expect(await layer(inner).chatStructured(TEMPLATE_PROMPT)).toEqual({ time: 'morning', items: [{ name: 'Fried Egg', grams: 100 }] });
    expect(inner.chatStructured).not.toHaveBeenCalled();
  });

  it('chatStructured: TOON garbage re-asks through inner.chatStructured with the ORIGINAL messages', async () => {
    const inner = fakeInner({ chat: async () => 'nonsense: [' });
    expect(await layer(inner).chatStructured(TEMPLATE_PROMPT)).toEqual({ from: 'json-path' });
    expect(inner.chatStructured.mock.calls[0][0]).toBe(TEMPLATE_PROMPT);
    expect(inner.chatStructured.mock.calls[0][1].usageTags.wire).toBe('json');
  });

  it('not sampled: template untouched, tagged json (A/B control group)', async () => {
    const inner = fakeInner({ chat: async () => 'raw' });
    await layer(inner, { sample: 0.5, random: () => 0.9 }).chat(TEMPLATE_PROMPT);
    const [sent, opts] = inner.chat.mock.calls[0];
    expect(sent).toBe(TEMPLATE_PROMPT);
    expect(opts.usageTags.wire).toBe('json');
  });

  it('mode input: never rewrites the reply format', async () => {
    const inner = fakeInner({ chat: async () => 'raw' });
    await layer(inner, { mode: 'input' }).chat(TEMPLATE_PROMPT);
    expect(inner.chat.mock.calls[0][0][0].content).toMatch(/Respond in JSON format:/);
  });

  it('a call with no structure is tagged passthrough', async () => {
    const inner = fakeInner({ chat: async () => 'hi' });
    await layer(inner).chat([{ role: 'user', content: 'hello' }]);
    expect(inner.chat.mock.calls[0][1].usageTags.wire).toBe('passthrough');
  });

  it('chatWithImage keeps the image argument and decodes', async () => {
    const inner = fakeInner();
    const out = await layer(inner).chatWithImage(TEMPLATE_PROMPT, 'data:image/png;base64,AA', {});
    expect(inner.chatWithImage.mock.calls[0][1]).toBe('data:image/png;base64,AA');
    expect(JSON.parse(out).items[0].name).toBe('Fried Egg');
  });

  it('scoped() wraps inner.scoped() in a new layer with the same config', async () => {
    const inner = fakeInner();
    const view = layer(inner).scoped({ app: 'health' });
    expect(view).toBeInstanceOf(StructuredWireLayer);
    expect(inner.scoped).toHaveBeenCalledWith({ app: 'health' });
    expect(JSON.parse(await view.chat(TEMPLATE_PROMPT)).items).toHaveLength(1);
  });

  it('transcribe, embed and isConfigured pass straight through', async () => {
    const inner = fakeInner();
    const l = layer(inner);
    expect(await l.transcribe(Buffer.from('a'), { language: 'en' })).toBe('words');
    expect(inner.transcribe).toHaveBeenCalledWith(Buffer.from('a'), { language: 'en' });
    expect(await l.embed('t')).toEqual([1, 2]);
    expect(l.isConfigured()).toBe(true);
  });

  // Review Focus 5
  it('caller options are not mutated', async () => {
    const options = { maxTokens: 5, jsonMode: true, usageTags: { feature: 'x' } };
    const snapshot = structuredClone(options);
    await layer(fakeInner()).chat(TEMPLATE_PROMPT, options);
    await layer(fakeInner()).chatStructured(TEMPLATE_PROMPT, options);
    expect(options).toEqual(snapshot);
  });

  it('logs a warn on decode fallback with the reason', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    await layer(fakeInner({ chat: async () => 'nope' }), { logger }).chat(TEMPLATE_PROMPT);
    expect(logger.warn).toHaveBeenCalledWith('ai.wire.decode.fallback', expect.objectContaining({ reason: expect.any(String), sample: 'nope' }));
  });

  it('mode off: chatStructured passes the exact arguments through', async () => {
    const inner = fakeInner();
    const options = { maxTokens: 10 };
    await layer(inner, { mode: 'off' }).chatStructured(TEMPLATE_PROMPT, options);
    expect(inner.chatStructured.mock.calls[0][0]).toBe(TEMPLATE_PROMPT);
    expect(inner.chatStructured.mock.calls[0][1]).toBe(options);
  });

  it('a TOON reply cut before its END line re-asks on the JSON path', async () => {
    const replies = [TOON_REPLY.replace(/\nEND$/, ''), '{"time":"x","items":[]}'];
    const inner = fakeInner({ chat: async () => replies.shift() });
    expect(await layer(inner).chat(TEMPLATE_PROMPT)).toBe('{"time":"x","items":[]}');
    expect(inner.chat).toHaveBeenCalledTimes(2);
  });
});
