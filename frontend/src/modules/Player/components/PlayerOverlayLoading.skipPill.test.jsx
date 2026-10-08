import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';

const base = { shouldRender: true, isVisible: true, pauseOverlayActive: false, seconds: 10, status: 'recovering' };

describe('PlayerOverlayLoading Skip pill', () => {
  it('shows while waiting on a refused source', () => {
    const { queryByTestId } = render(<PlayerOverlayLoading {...base} sourceNotice="Fixing this video… · 0:05" onSkipSource={vi.fn()} />);
    expect(queryByTestId('player-source-skip')).not.toBeNull();
  });
  it('shows in the post-cap HELD state (exhausted, no notice) so the keys have a visible pill', () => {
    const { queryByTestId } = render(<PlayerOverlayLoading {...base} isExhausted onSkipSource={vi.fn()} />);
    expect(queryByTestId('player-source-skip')).not.toBeNull();
  });
  it('is absent without an owner skip callback', () => {
    const { queryByTestId } = render(<PlayerOverlayLoading {...base} isExhausted sourceNotice="x" onSkipSource={null} />);
    expect(queryByTestId('player-source-skip')).toBeNull();
  });
});
