/**
 * One waitKey, one meaning — Task 4.3, at the call site that broke it.
 *
 * `useMediaResilience` logged an FNV-1a hash under the field name `waitKey`,
 * while `Player.jsx` logged the key raw under the same name. Two encodings, one
 * field: a hashed line could not be mapped back to an item, and the `:N` nonce
 * ordinal — the single field that would have made the 2026-08-16 nonce climb
 * self-evident — never reached the log at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../lib/playbackLogger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, playbackLog: vi.fn() };
});

import { useMediaResilience } from './useMediaResilience.js';
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';

const RAW_KEY = 'IIni70e01E:7';

const args = () => ({
  onReload: vi.fn(),
  meta: { src: 'https://example.test/stream/1', mediaKey: 'plex:1' },
  waitKey: RAW_KEY,
  playbackSessionKey: `session-${Math.random()}`,
  disabled: false,
  getMediaEl: () => null
});

const lineFor = (event) => playbackLog.mock.calls.find(([name]) => name === event)?.[1];

beforeEach(() => { playbackLog.mockClear(); });

describe('useMediaResilience — waitKey encoding', () => {
  it('logs the raw key and its hash as two distinct fields', () => {
    const a = args();
    const { result } = renderHook(() => useMediaResilience(a));
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));

    const line = lineFor('resilience-recovery');
    expect(line).toBeDefined();
    expect(line.waitKey).toBe(RAW_KEY);
    expect(line.waitKeyHash).toBe(getLogWaitKey(RAW_KEY));
    // The nonce ordinal survives the trip into the log. Without it a nonce climb
    // is invisible, which is exactly what happened on 2026-08-16.
    expect(line.waitKey.endsWith(':7')).toBe(true);
  });

  it('hands the overlay both encodings too, so its lines join to these ones', () => {
    const a = args();
    const { result } = renderHook(() => useMediaResilience(a));
    expect(result.current.overlayProps.waitKey).toBe(RAW_KEY);
    expect(result.current.overlayProps.waitKeyHash).toBe(getLogWaitKey(RAW_KEY));
  });

  it('names an absent key rather than reporting a hash of nothing', () => {
    const a = { ...args(), waitKey: undefined };
    const { result } = renderHook(() => useMediaResilience(a));
    // Not a run of zeros, and distinguishable from a real key: an absent key is
    // reported as absent in both fields.
    expect(result.current.overlayProps.waitKey).toBe('(absent)');
    expect(result.current.overlayProps.waitKeyHash).toBe('(absent)');
  });
});
