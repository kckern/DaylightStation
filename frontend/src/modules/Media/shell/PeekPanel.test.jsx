import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const pauseFn = vi.fn();
const playFn = vi.fn();
const volumeFn = vi.fn();
let ctl = {
  snapshot: {
    state: 'playing',
    currentItem: { contentId: 'plex:1', title: 'Remote Song' },
    position: 0,
    config: { volume: 50 },
  },
  transport: { play: playFn, pause: pauseFn, stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
  config: { setVolume: volumeFn, setShuffle: vi.fn(), setRepeat: vi.fn(), setShader: vi.fn() },
  queue: {}, lifecycle: {}, portability: {},
};
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => ctl),
}));

const enterPeek = vi.fn();
const exitPeek = vi.fn();
vi.mock('../peek/usePeek.js', () => ({
  usePeek: vi.fn(() => ({ activePeeks: new Map([['lr', { controller: ctl }]]), enterPeek, exitPeek, getAdapter: vi.fn() })),
}));

import { PeekPanel } from './PeekPanel.jsx';

beforeEach(() => {
  pauseFn.mockClear();
  playFn.mockClear();
  volumeFn.mockClear();
  enterPeek.mockClear();
  exitPeek.mockClear();
});

describe('PeekPanel', () => {
  it('renders current item title and state', () => {
    render(<PeekPanel deviceId="lr" />);
    expect(screen.getByTestId('peek-panel')).toHaveTextContent('Remote Song');
    expect(screen.getByTestId('peek-panel')).toHaveTextContent('playing');
  });

  it('calls enterPeek on mount', () => {
    render(<PeekPanel deviceId="lr" />);
    expect(enterPeek).toHaveBeenCalledWith('lr');
  });

  it('Pause button calls controller.transport.pause', () => {
    render(<PeekPanel deviceId="lr" />);
    fireEvent.click(screen.getByTestId('peek-pause'));
    expect(pauseFn).toHaveBeenCalled();
  });

  it('Play button calls controller.transport.play', () => {
    render(<PeekPanel deviceId="lr" />);
    fireEvent.click(screen.getByTestId('peek-play'));
    expect(playFn).toHaveBeenCalled();
  });

  it('Volume input calls config.setVolume with a number', () => {
    render(<PeekPanel deviceId="lr" />);
    fireEvent.change(screen.getByTestId('peek-volume'), { target: { value: '80' } });
    expect(volumeFn).toHaveBeenCalledWith(80);
  });
});
