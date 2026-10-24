import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { DispatchProvider } from './DispatchProvider.jsx';
import { useDispatch } from './useDispatch.js';
import { PlaybackQualityProvider, usePlaybackQuality } from '../quality/PlaybackQualityProvider.jsx';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({ ok: true })) }));
vi.mock('../net/ws.js', () => ({ subscribeTopicKind: () => () => {}, parseDeviceTopic: () => null }));
const wrapper = ({ children }) => <PlaybackQualityProvider><DispatchProvider>{children}</DispatchProvider></PlaybackQualityProvider>;
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });
afterEach(cleanup);

function command(url) { return JSON.parse(new URL(String(url), 'http://localhost').searchParams.get('itemAction')); }

describe('selected quality at the Cast dispatch boundary', () => {
  it('applies saved item overrides to standalone Cast and freezes them for Retry', async () => {
    sessionStorage.setItem('media-app.quality-overrides.v1', JSON.stringify({ 'plex:42': { maxResolution: '720', adaptive: false } }));
    const { result } = renderHook(() => ({ dispatch: useDispatch(), quality: usePlaybackQuality() }), { wrapper });
    let ids;
    await act(async () => { ids = await result.current.dispatch.dispatchToTarget({ targetIds: ['screen'], mode: 'fork', play: 'plex:42',
      itemAction: { kind: 'playNow', item: { contentId: 'plex:42', title: 'Movie' } } }); });
    expect(command(DaylightAPI.mock.calls[0][0]).item).toMatchObject({ maxResolution: '720', adaptive: false });
    act(() => result.current.quality.openForItem({ contentId: 'plex:42' }));
    await act(async () => { await result.current.quality.apply({ maxResolution: '480' }); });
    await act(async () => { await result.current.dispatch.retry(ids[0]); });
    expect(command(DaylightAPI.mock.calls[1][0]).item).toMatchObject({ maxResolution: '720', adaptive: false });
  });
});
