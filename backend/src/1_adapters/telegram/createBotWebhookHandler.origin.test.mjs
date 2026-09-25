import { describe, expect, it, vi } from 'vitest';
import { createBotWebhookHandler } from './createBotWebhookHandler.mjs';
import { currentOrigin, runWithOrigin } from '#system/runtime/aiContext.mjs';

describe('createBotWebhookHandler origin', () => {
  it('routes each update under telegram:<bot>, over the HTTP origin it arrived on', async () => {
    const seen = [];
    const inputRouter = { route: vi.fn(async () => { await new Promise((r) => setTimeout(r, 1)); seen.push(currentOrigin()); }) };
    const parser = { parse: () => ({ type: 'text', text: 'hi' }) };
    const handler = createBotWebhookHandler({ botName: 'nutribot', parser, inputRouter, logger: { debug() {}, warn() {}, error() {} } });
    const res = { sendStatus: vi.fn() };

    await runWithOrigin('http:POST /api/v1/nutribot/webhook', () => handler({ body: { message: {} } }, res));

    expect(seen).toEqual(['telegram:nutribot']);
    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(currentOrigin()).toBeNull();
  });
});
