import { describe, expect, it } from 'vitest';
import { createHomeAutomationRouter } from './homeAutomation.mjs';

function route(router, routePath) {
  return router.stack.find((layer) => layer.route?.path === routePath).route.stack.at(-1).handle;
}
function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('home automation API semantic facade', () => {
  it('preserves the volume response envelope', async () => {
    const router = createHomeAutomationRouter({ homeAutomationService: {
      controlVolume: async () => ({ kind: 'completed', value: {
        result: { ok: true }, beforeState: { volume: 50, muted: false }, afterState: { volume: 62, muted: false },
      } }),
    } });
    const res = response();
    await route(router, '/vol/:level')({ params: { level: '+' } }, res, (error) => { if (error) throw error; });
    expect(res.body).toEqual({
      result: { ok: true }, beforeState: { volume: 50, muted: false }, afterState: { volume: 62, muted: false },
    });
  });

  it('preserves the keyboard unavailable response', async () => {
    const router = createHomeAutomationRouter({ homeAutomationService: {
      getKeyboard: () => ({ kind: 'unavailable' }),
    } });
    const res = response();
    await route(router, '/keyboard{/:keyboard_id}')({ params: { keyboard_id: 'main' } }, res, (error) => { if (error) throw error; });
    expect(res).toMatchObject({ statusCode: 503, body: { error: 'State file loading not configured' } });
  });
});
