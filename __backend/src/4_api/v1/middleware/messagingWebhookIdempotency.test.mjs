import { describe, it, expect, vi } from 'vitest';
import { idempotencyMiddleware } from './messagingWebhookIdempotency.mjs';

function response() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('messaging webhook idempotency HTTP contract', () => {
  it('passes the first update and projects its stable identity to the store', () => {
    const store = { checkAndRemember: vi.fn(() => ({ duplicate: false, key: 'hash', ageMs: null })) };
    const next = vi.fn();
    const req = {
      baseUrl: '/api/v1/nutribot',
      traceId: 'trace-1',
      body: { update_id: 7, message: { message_id: 9 } },
    };

    idempotencyMiddleware({ ttlMs: 300000, store })(req, response(), next);

    expect(store.checkAndRemember).toHaveBeenCalledWith(
      ['/api/v1/nutribot', 'upd:7', 'msg:9'],
      { ttlMs: 300000, traceId: 'trace-1' },
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('preserves the legacy duplicate response envelope', () => {
    const store = { checkAndRemember: vi.fn(() => ({ duplicate: true, key: 'abcdef1234567890', ageMs: 12 })) };
    const res = response();
    const next = vi.fn();

    idempotencyMiddleware({ store })({
      path: '/hook',
      body: { callback_query: { id: 'cb-1', data: 'yes', message: { message_id: 3 } } },
    }, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, skipped: true, reason: 'duplicate' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows bodies without a stable update identity through unchanged', () => {
    const store = { checkAndRemember: vi.fn() };
    const next = vi.fn();
    idempotencyMiddleware({ store })({ baseUrl: '/hook', body: {} }, response(), next);
    expect(store.checkAndRemember).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
