import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';
import { PlaybackSurfaceProvider } from '../PlaybackSurfaceContext.js';

const base = { shouldRender: true, isVisible: true, pauseOverlayActive: false, seconds: 10, status: 'recovering' };
const skipButton = (view) => view.queryByRole('button', { name: /^Skip to/ });

describe('PlayerOverlayLoading held card — Skip', () => {
  it('waiting on a refused source: says so, and offers Skip when something is next', () => {
    const view = render(<PlayerOverlayLoading {...base} sourceNotice="Fixing this video… · 0:05" onSkipSource={vi.fn()} next={{ title: 'Episode 2' }} />);
    expect(view.getByText('Waiting for the video')).toBeInTheDocument();
    expect(view.getByText('Fixing this video… · 0:05')).toBeInTheDocument();
    expect(skipButton(view)).toHaveTextContent('Skip to Episode 2');
  });
  it('on the last item there is no Skip: it would only be an exit, which the host owns', () => {
    const view = render(<PlayerOverlayLoading {...base} isExhausted onSkipSource={vi.fn()} next={null} />);
    expect(skipButton(view)).toBeNull();
  });
  it('is absent without an owner skip callback, even with a next item', () => {
    const view = render(<PlayerOverlayLoading {...base} isExhausted sourceNotice="x" onSkipSource={null} next={{ title: 'B' }} />);
    expect(skipButton(view)).toBeNull();
  });
  it('a touch surface gets no key hints', () => {
    const view = render(
      <PlaybackSurfaceProvider input="touch">
        <PlayerOverlayLoading {...base} isExhausted onSkipSource={vi.fn()} next={{ title: 'B' }} />
      </PlaybackSurfaceProvider>,
    );
    expect(view.queryByTestId('player-held-keys')).toBeNull();
    expect(skipButton(view)).not.toBeNull();
  });
  it('keeps the `loading` class while held: the fitness player exits fullscreen on a tap inside .loading-overlay.loading', () => {
    const view = render(<PlayerOverlayLoading {...base} isExhausted onSkipSource={vi.fn()} />);
    expect(view.container.querySelector('.loading-overlay.loading.loading-overlay--held')).not.toBeNull();
  });
});
