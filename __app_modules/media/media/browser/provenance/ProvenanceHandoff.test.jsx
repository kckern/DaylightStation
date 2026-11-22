import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProvenanceHandoff } from './ProvenanceHandoff.jsx';

const P = { provider: 'tubi', logoUrl: '/logo/tubi' };
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe('ProvenanceHandoff link motion', () => {
  afterEach(() => vi.useRealTimers());

  it('gives each line its own per-play animation while linking, and drops it once linked', () => {
    const { container, rerender } = render(<ProvenanceHandoff phase="linking" provenance={P} linkMs={6000} random={seeded(3)} />);
    const css = container.querySelector('style').textContent;
    const [left, right] = container.querySelectorAll('.provenance-handoff__line');
    expect(left.style.animationName).toMatch(/^ph-reach-l-/);
    expect(right.style.animationName).toMatch(/^ph-reach-r-/);
    expect(css).toContain(`@keyframes ${left.style.animationName}{`);
    expect(css).toContain(`@keyframes ${right.style.animationName}{`);
    rerender(<ProvenanceHandoff phase="linked" provenance={P} linkMs={6000} random={seeded(3)} />);
    expect(left.style.animationName).toBe('');
  });

  it('slows and dims the dots through a shared stop, then picks them up', async () => {
    vi.useFakeTimers();
    const { makeLinkPlan } = await import('./linkCurve.js');
    const [a, b] = makeLinkPlan(6000, seeded(5)).stalls[0];
    const { container } = render(<ProvenanceHandoff phase="linking" provenance={P} linkMs={6000} random={seeded(5)} />);
    const root = container.firstChild;
    expect(root.className).not.toMatch(/--stalled/);
    act(() => { vi.advanceTimersByTime(150 + a + 1); });
    expect(root.className).toMatch(/provenance-handoff--stalled/);
    act(() => { vi.advanceTimersByTime(b - a); });
    expect(root.className).toMatch(/provenance-handoff--resumed/);
    act(() => { vi.advanceTimersByTime(450); });
    expect(root.className).not.toMatch(/--resumed|--stalled/);
  });
});

describe('ProvenanceHandoff secondary logo', () => {
  it('draws the secondary logos in order, and nothing when there are none', () => {
    const { container, rerender } = render(<ProvenanceHandoff phase="linking" provenance={P} linkMs={6000} random={seeded(1)} />);
    expect(container.querySelector('.provenance-handoff__secondary')).toBeNull();
    rerender(<ProvenanceHandoff phase="linking" provenance={{ ...P, secondaryUrls: ['/logo/isp', '/logo/pass-a'] }} linkMs={6000} random={seeded(1)} />);
    const srcs = [...container.querySelectorAll('.provenance-handoff__secondary img')].map((i) => i.getAttribute('src'));
    expect(srcs).toEqual(['/logo/isp', '/logo/pass-a']);
  });
});
