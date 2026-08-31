import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  resolveToken: vi.fn(),
  act: vi.fn(),
}));

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    selfServiceResolve: (...args) => h.resolve(...args),
    selfServiceResolveToken: (...args) => h.resolveToken(...args),
    selfServiceAct: (...args) => h.act(...args),
  },
}));

vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService: vi.fn(), selfServiceError: vi.fn(), scan: vi.fn() },
}));

import { useSelfService } from './useSelfService.js';

const TOKEN = 'sch:ABCDEFGHJKLMNPQR';
const CARD = {
  ok: true,
  learner: 'kid1',
  subject: 'math',
  title: 'Fractions',
  actions: [{ kind: 'play', label: 'Watch it' }, { kind: 'exit', label: 'Done' }],
};
const ok = (data) => ({ ok: true, status: 200, data });

describe('useSelfService browser QR credentials', () => {
  beforeEach(() => {
    h.resolve.mockReset();
    h.resolveToken.mockReset();
    h.act.mockReset();
  });

  it('opens the existing launch card, then sends the same token only after its button is tapped', async () => {
    h.resolveToken.mockResolvedValue(ok(CARD));
    h.act.mockResolvedValue(ok({
      outcome: 'done', sentence: 'Starting your video.', transition: 'message', effect: null,
    }));
    const { result } = renderHook(() => useSelfService({ idleTimeoutSeconds: 0 }));

    await act(async () => { await result.current.scan(TOKEN); });

    expect(h.resolveToken).toHaveBeenCalledWith(TOKEN);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(result.current.view).toBe('card');
    expect(result.current.card).toEqual(CARD);
    expect(h.act).not.toHaveBeenCalled();

    await act(async () => { await result.current.runAction(CARD.actions[0]); });

    expect(h.act).toHaveBeenCalledWith({ token: TOKEN, action: 'play' });
    expect(result.current.view).toBe('sentence');
  });

  it('retries a transport failure with the captured token, not the digit endpoint', async () => {
    h.resolveToken
      .mockResolvedValueOnce({ ok: false, status: 503, data: null })
      .mockResolvedValueOnce(ok(CARD));
    const { result } = renderHook(() => useSelfService({ idleTimeoutSeconds: 0 }));

    await act(async () => { await result.current.scan(TOKEN); });
    expect(result.current.degraded).toBe(true);

    await act(async () => { await result.current.retry(); });

    expect(h.resolveToken).toHaveBeenCalledTimes(2);
    expect(h.resolveToken).toHaveBeenNthCalledWith(2, TOKEN);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(result.current.view).toBe('card');
  });

  it('treats unknown_qr as a retryable capture refusal, not a backend outage', async () => {
    h.resolveToken.mockResolvedValue(ok({
      ok: false,
      reason: 'unknown_qr',
      sentence: 'That QR code did not work. Try another one.',
      actions: [],
    }));
    const { result } = renderHook(() => useSelfService({ idleTimeoutSeconds: 0 }));

    let verdict;
    await act(async () => { verdict = await result.current.scan(TOKEN); });

    expect(verdict).toMatchObject({ resolved: false, degraded: false, reason: 'unknown_qr' });
    expect(result.current.view).toBe('keypad');
    expect(result.current.degraded).toBe(false);
  });
});
