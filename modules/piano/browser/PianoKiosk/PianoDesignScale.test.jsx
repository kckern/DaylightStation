import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import PianoDesignScale from './PianoDesignScale.jsx';

describe('PianoDesignScale', () => {
  it('passes children through untouched when no design size is set', () => {
    const { container } = render(
      <PianoDesignScale width={null} height={null}><p>hello</p></PianoDesignScale>,
    );
    expect(container.querySelector('.piano-design-viewport')).toBeNull();
    expect(container.textContent).toBe('hello');
  });

  it('wraps children in a design canvas scaled to fit the viewport', () => {
    window.innerWidth = 640;
    window.innerHeight = 480;
    const { container } = render(
      <PianoDesignScale width={1280} height={800}><p>hello</p></PianoDesignScale>,
    );
    const canvas = container.querySelector('.piano-design-canvas');
    expect(canvas).toBeTruthy();
    expect(canvas.style.width).toBe('1280px');
    expect(canvas.style.height).toBe('800px');
    expect(canvas.style.transform).toBe('scale(0.5)'); // min(640/1280, 480/800)
  });

  it('rescales on viewport resize', () => {
    window.innerWidth = 1280;
    window.innerHeight = 800;
    const { container } = render(
      <PianoDesignScale width={1280} height={800}><p>hello</p></PianoDesignScale>,
    );
    expect(container.querySelector('.piano-design-canvas').style.transform).toBe('scale(1)');
    act(() => {
      window.innerWidth = 320;
      window.innerHeight = 800;
      window.dispatchEvent(new Event('resize'));
    });
    expect(container.querySelector('.piano-design-canvas').style.transform).toBe('scale(0.25)');
  });
});
