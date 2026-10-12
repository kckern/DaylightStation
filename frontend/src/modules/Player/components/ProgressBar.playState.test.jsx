import { render, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { ProgressBar } from './ProgressBar.jsx';

const fill = (c) => c.querySelector('.progress');
let created;
let visible;

function fakeAnimation(keyframes, timing) {
  return { keyframes, timing, pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
}

beforeEach(() => {
  created = [];
  visible = null;
  Element.prototype.animate = vi.fn(function animate(keyframes, timing) {
    const a = fakeAnimation(keyframes, timing);
    created.push(a);
    return a;
  });
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ transform: visible ?? 'none' }));
});
afterEach(() => {
  cleanup();
  delete Element.prototype.animate;
  vi.restoreAllMocks();
});

const bar = (props) => <ProgressBar percent={0} durationSeconds={100} offsetSeconds={10} paused={false} {...props} />;

describe('ProgressBar — Web Animations', () => {
  it('starts a linear run at the current spot, without a glide', () => {
    render(bar());
    expect(created).toHaveLength(1);
    expect(created[0].keyframes).toEqual([{ transform: 'scaleX(0.1)' }, { transform: 'scaleX(1)' }]);
  });

  it('ignores steady ticks', () => {
    const { rerender } = render(bar());
    rerender(bar({ offsetSeconds: 10.4 }));
    rerender(bar({ offsetSeconds: 10.8 }));
    expect(created).toHaveLength(1);
  });

  it('glides from the visible fraction on a seek', () => {
    const { rerender } = render(bar());
    visible = 'matrix(0.12, 0, 0, 1, 0, 0)';
    rerender(bar({ offsetSeconds: 60 }));
    expect(created).toHaveLength(2);
    expect(created[0].cancel).toHaveBeenCalled();
    expect(created[1].keyframes[0]).toEqual({ transform: 'scaleX(0.12)', offset: 0, easing: 'ease-out' });
    expect(created[1].keyframes.at(-1)).toEqual({ transform: 'scaleX(1)', offset: 1 });
  });

  it('pauses and resumes the same animation in place (stall flapping never rebuilds)', () => {
    const { rerender } = render(bar());
    visible = 'scaleX(0.1)';
    for (let i = 0; i < 3; i++) {
      rerender(bar({ paused: true }));
      rerender(bar({ paused: false }));
    }
    expect(created).toHaveLength(1);
    expect(created[0].pause).toHaveBeenCalledTimes(3);
    expect(created[0].play).toHaveBeenCalledTimes(3);
  });

  it('a seek while paused glides to the new spot and holds there', () => {
    const { rerender } = render(bar({ paused: true }));
    visible = 'scaleX(0.1)';
    rerender(bar({ paused: true, offsetSeconds: 70 }));
    const last = created.at(-1);
    expect(last.keyframes).toEqual([{ transform: 'scaleX(0.1)' }, { transform: 'scaleX(0.7)' }]);
    expect(last.timing.easing).toBe('ease-out');
  });

  it('resuming after a held seek rebuilds a running animation', () => {
    const { rerender } = render(bar({ paused: true }));
    visible = 'scaleX(0.1)';
    rerender(bar({ paused: true, offsetSeconds: 70 }));
    visible = 'scaleX(0.7)';
    rerender(bar({ paused: false, offsetSeconds: 70 }));
    expect(created.at(-1).keyframes).toEqual([{ transform: 'scaleX(0.7)' }, { transform: 'scaleX(1)' }]);
  });

  it('starts at the right spot when the duration arrives late', () => {
    const { rerender } = render(bar({ durationSeconds: 0, offsetSeconds: 0 }));
    expect(created).toHaveLength(0);
    rerender(bar({ durationSeconds: 200, offsetSeconds: 50 }));
    expect(created).toHaveLength(1);
    expect(created[0].keyframes[0]).toEqual({ transform: 'scaleX(0.25)' });
  });

  it('cancels the animation on unmount', () => {
    const { unmount } = render(bar());
    unmount();
    expect(created[0].cancel).toHaveBeenCalled();
  });
});

describe('ProgressBar — fallback', () => {
  it('uses a transitioned scaleX when there is no timing data', () => {
    const { container } = render(<ProgressBar percent={40} />);
    expect(fill(container).style.transform).toBe('scaleX(0.4)');
    expect(fill(container).className).toContain('progress--stepped');
    expect(created).toHaveLength(0);
  });

  it('shows an empty bar for unusable data', () => {
    const { container } = render(<ProgressBar percent="NaN" durationSeconds={Infinity} offsetSeconds={3} />);
    expect(fill(container).style.transform).toBe('scaleX(0)');
  });

  it('uses the stepped fill when element.animate is unavailable', () => {
    delete Element.prototype.animate;
    const { container } = render(bar({ offsetSeconds: 25 }));
    expect(fill(container).style.transform).toBe('scaleX(0.25)');
    expect(fill(container).className).toContain('progress--stepped');
  });
});
