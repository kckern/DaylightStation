import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const answers = [];
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({
  daylightApiResponse: vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift() : answers[0];
    return { ok: next.status === 200, status: next.status, json: async () => next.body };
  }),
}));

class FakeImage { set src(v) { this._src = v; setTimeout(() => this.onload?.(), 0); } get src() { return this._src; } }

const { useShareIntro, shareJobIdOf, SHARE_FAILED_SHOW_MS } = await import('./useShareIntro.jsx');
const job = (state, progress) => ({ status: 200, body: { id: 's000000000001', state, progress, provenance: { provider: 'example', logo: '/api/v1/provenance/logo/example', accent: null } } });

describe('useShareIntro', () => {
  beforeEach(() => { answers.length = 0; vi.stubGlobal('Image', FakeImage); });
  afterEach(() => vi.unstubAllGlobals());

  it('answers only for share ids', () => {
    expect(shareJobIdOf('share:s000000000001')).toBe('s000000000001');
    expect(shareJobIdOf('plex:123')).toBeNull();
    const { result } = renderHook(() => useShareIntro({ media: { assetId: 'plex:123' } }));
    expect(result.current).toBeNull();
  });

  it('holds the play request from the first render, until the job is ready', async () => {
    answers.push(job('downloading', 0.4), job('ready', 1));
    const { result } = renderHook(() => useShareIntro({ media: { assetId: 'share:s000000000001' } }));
    expect(result.current).toMatchObject({ holdRequest: true, startSec: 0 });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(result.current.holdRequest).toBe(false), { timeout: 3000 });
  });

  it('stays held on a failed job (the backend stops the screen)', async () => {
    answers.push(job('failed', 0.2));
    const { result } = renderHook(() => useShareIntro({ media: { assetId: 'share:s000000000001' } }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.holdRequest).toBe(true);
  });

  it('lets go for a streaming share (the last fallback)', async () => {
    answers.push(job('streaming', 1));
    const { result } = renderHook(() => useShareIntro({ media: { assetId: 'share:s000000000001' } }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.holdRequest).toBe(false);
  });

  it('abandons the play after showing a failed share', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      answers.push(job('failed', 0.2));
      const { result } = renderHook(() => useShareIntro({ media: { assetId: 'share:s000000000001' } }));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.abandon).toBe(false);
      await vi.advanceTimersByTimeAsync(SHARE_FAILED_SHOW_MS + 50);
      await waitFor(() => expect(result.current.abandon).toBe(true));
    } finally { vi.useRealTimers(); }
  });
});
