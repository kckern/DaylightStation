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

describe('PianoDesignScale — on-screen keyboard', () => {
  function setup() {
    window.innerWidth = 1280;
    window.innerHeight = 800;
    const utils = render(
      <PianoDesignScale width={1280} height={800}><input aria-label="title" /></PianoDesignScale>,
    );
    const canvas = () => utils.container.querySelector('.piano-design-canvas');
    const viewport = () => utils.container.querySelector('.piano-design-viewport');
    const resize = (w, h) => act(() => {
      window.innerWidth = w;
      window.innerHeight = h;
      window.dispatchEvent(new Event('resize'));
    });
    return { ...utils, canvas, viewport, resize, input: utils.container.querySelector('input') };
  }

  it('holds the scale when the keyboard halves the height under a focused field', () => {
    const { canvas, viewport, resize, input } = setup();
    input.focus();
    resize(1280, 400);
    expect(canvas().style.transform).toBe('translateY(0px) scale(1)');
    expect(viewport().classList.contains('is-keyboard-open')).toBe(true);
  });

  it('lifts the canvas so a field below the keyboard line stays visible', () => {
    const { canvas, resize, input } = setup();
    input.getBoundingClientRect = () => ({ top: 500, bottom: 540, left: 0, right: 100 });
    input.focus();
    resize(1280, 400);
    expect(canvas().style.transform).toBe('translateY(-156px) scale(1)'); // 540 - (400 - 16)
  });

  it('releases when the keyboard closes', () => {
    const { canvas, viewport, resize, input } = setup();
    input.focus();
    resize(1280, 400);
    resize(1280, 800);
    expect(canvas().style.transform).toBe('scale(1)');
    expect(viewport().classList.contains('is-keyboard-open')).toBe(false);
  });

  it('still rescales a height-only shrink with nothing focused', () => {
    const { canvas, resize } = setup();
    resize(1280, 400);
    expect(canvas().style.transform).toBe('scale(0.5)');
  });
});
