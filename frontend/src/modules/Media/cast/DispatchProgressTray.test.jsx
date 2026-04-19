import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let dispatchCtx = { dispatches: new Map(), dispatchToTarget: vi.fn(), retryLast: vi.fn() };
vi.mock('./useDispatch.js', () => ({
  useDispatch: vi.fn(() => dispatchCtx),
}));

import { DispatchProgressTray } from './DispatchProgressTray.jsx';

beforeEach(() => {
  dispatchCtx = { dispatches: new Map(), dispatchToTarget: vi.fn(), retryLast: vi.fn() };
});

describe('DispatchProgressTray', () => {
  it('renders nothing when no dispatches are in flight or recent', () => {
    render(<DispatchProgressTray />);
    expect(screen.queryByTestId('dispatch-tray')).not.toBeInTheDocument();
  });

  it('renders a row per active dispatch with deviceId and status', () => {
    dispatchCtx = {
      dispatches: new Map([
        ['d1', { dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', status: 'running', steps: [] }],
        ['d2', { dispatchId: 'd2', deviceId: 'ot', contentId: 'plex:2', status: 'success', steps: [], totalElapsedMs: 1234 }],
      ]),
      dispatchToTarget: vi.fn(), retryLast: vi.fn(),
    };
    render(<DispatchProgressTray />);
    expect(screen.getByTestId('dispatch-tray')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-row-d1')).toHaveTextContent(/lr/);
    expect(screen.getByTestId('dispatch-row-d1')).toHaveTextContent(/running/);
    expect(screen.getByTestId('dispatch-row-d2')).toHaveTextContent(/success/);
  });

  it('failed rows show a retry button that calls retryLast', () => {
    const retryLast = vi.fn();
    dispatchCtx = {
      dispatches: new Map([['d1', { dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', status: 'failed', error: 'boom', steps: [] }]]),
      dispatchToTarget: vi.fn(),
      retryLast,
    };
    render(<DispatchProgressTray />);
    fireEvent.click(screen.getByTestId('dispatch-retry-d1'));
    expect(retryLast).toHaveBeenCalled();
  });
});
