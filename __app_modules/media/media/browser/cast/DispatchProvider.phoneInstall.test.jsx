// A play from one install's row (`phone#<installId>`) goes to the phone's own device id
// with that installId on the load URL, and Retry keeps the install.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { DispatchProvider } from './DispatchProvider.jsx';
import { useDispatch } from './useDispatch.js';
import { PlaybackQualityProvider } from '../quality/PlaybackQualityProvider.jsx';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({ ok: false, error: 'Not picked up' })) }));
vi.mock('../net/ws.js', () => ({ subscribeTopicKind: () => () => {}, parseDeviceTopic: () => null }));
const wrapper = ({ children }) => <PlaybackQualityProvider><DispatchProvider>{children}</DispatchProvider></PlaybackQualityProvider>;
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });
afterEach(cleanup);

const B = 'install-bbbb-2222';
const url = (call) => new URL(String(call[0]), 'http://localhost');

describe('dispatch to one install of a phone', () => {
  it('loads on the phone with installId, and Retry keeps it', async () => {
    const { result } = renderHook(() => useDispatch(), { wrapper });
    let ids;
    await act(async () => { ids = await result.current.dispatchToTarget({ targetIds: [`phone#${B}`], mode: 'fork', play: 'plex:1', title: 'A song' }); });
    const first = url(DaylightAPI.mock.calls[0]);
    expect(first.pathname).toBe('/api/v1/device/phone/load');
    expect(first.searchParams.get('installId')).toBe(B);
    await act(async () => { await result.current.retry(ids[0]); });
    const again = url(DaylightAPI.mock.calls.at(-1));
    expect(again.pathname).toBe('/api/v1/device/phone/load');
    expect(again.searchParams.get('installId')).toBe(B);
  });

  it('a plain phone target names no install', async () => {
    const { result } = renderHook(() => useDispatch(), { wrapper });
    await act(async () => { await result.current.dispatchToTarget({ targetIds: ['phone'], mode: 'fork', play: 'plex:1' }); });
    expect(url(DaylightAPI.mock.calls[0]).searchParams.get('installId')).toBeNull();
  });
});
