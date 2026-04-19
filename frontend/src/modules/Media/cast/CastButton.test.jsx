import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let castTargetCtx = { mode: 'transfer', targetIds: ['lr'], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
vi.mock('./useCastTarget.js', () => ({
  useCastTarget: vi.fn(() => castTargetCtx),
}));

const dispatchMock = vi.fn(() => Promise.resolve(['d1']));
vi.mock('./useDispatch.js', () => ({
  useDispatch: vi.fn(() => ({ dispatches: new Map(), dispatchToTarget: dispatchMock, retryLast: vi.fn() })),
}));

import { CastButton } from './CastButton.jsx';

beforeEach(() => {
  dispatchMock.mockClear();
  castTargetCtx = { mode: 'transfer', targetIds: ['lr'], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
});

describe('CastButton', () => {
  it('renders "Cast" text', () => {
    render(<CastButton contentId="plex:1" />);
    expect(screen.getByTestId('cast-button-plex:1')).toHaveTextContent(/cast/i);
  });

  it('click fires dispatchToTarget with targetIds + mode + play', () => {
    render(<CastButton contentId="plex:1" />);
    fireEvent.click(screen.getByTestId('cast-button-plex:1'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      targetIds: ['lr'],
      mode: 'transfer',
      play: 'plex:1',
    }));
  });

  it('is disabled when no targets selected', () => {
    castTargetCtx = { mode: 'transfer', targetIds: [], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
    render(<CastButton contentId="plex:1" />);
    expect(screen.getByTestId('cast-button-plex:1')).toBeDisabled();
  });

  it('accepts a queue prop (container dispatch)', () => {
    render(<CastButton queue="plex:album-1" />);
    fireEvent.click(screen.getByTestId('cast-button-plex:album-1'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ queue: 'plex:album-1' }));
  });
});
