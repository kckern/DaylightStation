import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TouchChrome } from './TouchChrome.jsx';
import { getActionBus } from '../input/ActionBus.js';

vi.mock('../input/ActionBus.js', () => {
  const emit = vi.fn();
  return { getActionBus: () => ({ emit }) };
});

describe('TouchChrome', () => {
  beforeEach(() => {
    getActionBus().emit.mockClear();
  });

  it('renders only Back in back mode', () => {
    render(<TouchChrome mode="back" />);
    expect(screen.getByTestId('touch-chrome-back')).toBeInTheDocument();
    expect(screen.queryByTestId('touch-chrome-playpause')).toBeNull();
    expect(screen.queryByTestId('touch-chrome-vol-up')).toBeNull();
  });

  it('renders transport and volume in media mode', () => {
    render(<TouchChrome mode="media" />);
    ['back', 'prev', 'playpause', 'next', 'rew', 'fwd', 'vol-down', 'vol-up'].forEach((id) => {
      expect(screen.getByTestId(`touch-chrome-${id}`)).toBeInTheDocument();
    });
  });

  it('Back emits escape so the interceptor chain still runs', () => {
    render(<TouchChrome mode="media" />);
    fireEvent.click(screen.getByTestId('touch-chrome-back'));
    expect(getActionBus().emit).toHaveBeenCalledWith('escape', {});
  });

  it.each([
    ['playpause', 'media:playback', { command: 'toggle' }],
    ['prev', 'media:playback', { command: 'prev' }],
    ['next', 'media:playback', { command: 'next' }],
    ['rew', 'media:playback', { command: 'rew' }],
    ['fwd', 'media:playback', { command: 'fwd' }],
    ['vol-down', 'display:volume', { command: '-1' }],
    ['vol-up', 'display:volume', { command: '+1' }],
  ])('%s emits %s', (testId, action, payload) => {
    render(<TouchChrome mode="media" />);
    fireEvent.click(screen.getByTestId(`touch-chrome-${testId}`));
    expect(getActionBus().emit).toHaveBeenCalledWith(action, payload);
  });
});
