// RELY.7a/AC4 — a lasting network loss shows a quiet reconnecting note,
// never a reload; a blip shorter than the grace period shows nothing.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

let statusCallback = null;
vi.mock('../net/ws.js', () => ({ onStatus: (cb) => { statusCallback = cb; return () => {}; } }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
import { ReconnectingNote, RECONNECTING_GRACE_MS } from './ReconnectingNote.jsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ReconnectingNote', () => {
  it('stays silent for a brief blip and appears quietly when the loss lasts', () => {
    render(<ReconnectingNote />);
    act(() => statusCallback({ connected: false }));
    act(() => { vi.advanceTimersByTime(RECONNECTING_GRACE_MS - 100); });
    expect(screen.queryByTestId('media-reconnecting')).toBeNull();
    act(() => statusCallback({ connected: true }));
    act(() => { vi.advanceTimersByTime(RECONNECTING_GRACE_MS * 2); });
    expect(screen.queryByTestId('media-reconnecting')).toBeNull();

    act(() => statusCallback({ connected: false }));
    act(() => { vi.advanceTimersByTime(RECONNECTING_GRACE_MS + 10); });
    const note = screen.getByTestId('media-reconnecting');
    expect(note).toHaveTextContent('Reconnecting');
    expect(note).toHaveAttribute('role', 'status');
    act(() => statusCallback({ connected: true }));
    expect(screen.queryByTestId('media-reconnecting')).toBeNull();
  });
});
