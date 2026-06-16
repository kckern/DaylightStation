import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, cleanup } from '@testing-library/react';

import MusicPlaque from '../../../frontend/src/screen-framework/widgets/MusicPlaque.jsx';

const plaque = (c) => c.querySelector('[data-testid="artmode-music-plaque"]');
const textOf = (c) => plaque(c)?.textContent ?? '';
const isHidden = (c) => !!c.querySelector('.artmode__plaque-text--hidden');

const props = { fadeMs: 280, resizeMs: 420 };

describe('MusicPlaque', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('renders nothing without a track, and shows the track text once present', () => {
    const { container, rerender } = render(<MusicPlaque {...props} track={null} />);
    expect(plaque(container)).toBeNull();

    // First real track appears instantly (no fade-from-nothing).
    rerender(<MusicPlaque {...props} track={{ title: 'Gymnopédie', artist: 'Satie' }} />);
    expect(textOf(container)).toContain('Gymnopédie');
    expect(textOf(container)).toContain('Satie');
    expect(isHidden(container)).toBe(false);
  });

  it('fades the old text out, swaps behind the fade, then fades the new text in', async () => {
    const { container, rerender } = render(<MusicPlaque {...props} track={{ title: 'A' }} />);
    expect(textOf(container)).toContain('A');
    expect(isHidden(container)).toBe(false);

    // Song change → old text begins fading out, still showing the old title.
    rerender(<MusicPlaque {...props} track={{ title: 'B' }} />);
    expect(isHidden(container)).toBe(true);
    expect(textOf(container)).toContain('A');

    // After the fade-out the text swaps — but stays hidden while the plate resizes.
    await act(async () => { vi.advanceTimersByTime(280); });
    expect(textOf(container)).toContain('B');
    expect(isHidden(container)).toBe(true);

    // Once the resize window elapses, the new text fades back in.
    await act(async () => { vi.advanceTimersByTime(420); });
    expect(isHidden(container)).toBe(false);
  });

  it('swaps instantly without a fade when animation is off (track mode, behind the curtain)', () => {
    const { container, rerender } = render(<MusicPlaque {...props} animate={false} track={{ title: 'A' }} />);
    rerender(<MusicPlaque {...props} animate={false} track={{ title: 'B' }} />);
    expect(textOf(container)).toContain('B');
    expect(isHidden(container)).toBe(false);
  });

  it('restarts cleanly when a new song arrives mid-transition', async () => {
    const { container, rerender } = render(<MusicPlaque {...props} track={{ title: 'A' }} />);
    rerender(<MusicPlaque {...props} track={{ title: 'B' }} />);

    // Part-way through B's fade-out, C arrives.
    await act(async () => { vi.advanceTimersByTime(100); });
    rerender(<MusicPlaque {...props} track={{ title: 'C' }} />);
    expect(isHidden(container)).toBe(true);

    // The pending B swap must be cancelled — only C should surface.
    await act(async () => { vi.advanceTimersByTime(280); });
    expect(textOf(container)).toContain('C');
    expect(textOf(container)).not.toContain('B');

    await act(async () => { vi.advanceTimersByTime(420); });
    expect(isHidden(container)).toBe(false);
  });
});
