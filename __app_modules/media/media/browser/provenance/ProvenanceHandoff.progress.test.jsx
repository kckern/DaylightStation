import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProvenanceHandoff, PROGRESS_STALL_MS } from './ProvenanceHandoff.jsx';
import { REACH_PERCENT } from './linkCurve.js';

const P = { provider: 'example', logoUrl: '/logo/example' };
const lines = (c) => [...c.querySelectorAll('.provenance-handoff__line')];

describe('ProvenanceHandoff under real progress', () => {
  afterEach(() => vi.useRealTimers());

  it('draws the lines as long as the progress, with no per-play motion', () => {
    const { container, rerender } = render(<ProvenanceHandoff phase="linking" provenance={P} progress={0.25} />);
    expect(container.querySelector('style')).toBeNull();
    for (const line of lines(container)) {
      expect(line.style.animation).toContain('none');
      expect(line.style.width).toBe(`${0.25 * REACH_PERCENT}%`);
    }
    rerender(<ProvenanceHandoff phase="linking" provenance={P} progress={0.5} />);
    expect(lines(container)[0].style.width).toBe(`${0.5 * REACH_PERCENT}%`);
  });

  it('slows the dots when no progress has come for a while, and picks up when it moves', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ProvenanceHandoff phase="linking" provenance={P} progress={0.3} />);
    const root = () => container.querySelector('.provenance-handoff');
    expect(root().className).not.toContain('--stalled');
    act(() => { vi.advanceTimersByTime(PROGRESS_STALL_MS + 10); });
    expect(root().className).toContain('provenance-handoff--stalled');
    rerender(<ProvenanceHandoff phase="linking" provenance={P} progress={0.4} />);
    expect(root().className).toContain('provenance-handoff--resumed');
  });

  it('pulls the lines back and marks the scene failed', () => {
    const { container } = render(<ProvenanceHandoff phase="linking" provenance={P} progress={0.6} failed />);
    expect(container.querySelector('.provenance-handoff').className).toContain('provenance-handoff--failed');
    expect(lines(container)[0].style.width).toBe('0px');
  });

  it('lets the lines meet once linked, as for any title', () => {
    const { container } = render(<ProvenanceHandoff phase="linked" provenance={P} progress={1} />);
    expect(lines(container)[0].style.width).toBe('');
  });
});
