// frontend/src/lib/ui/Button.test.jsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { Button } from './Button.jsx';

// jsdom has no PointerEvent; a MouseEvent carries `button`, and isPrimary is added here.
beforeAll(() => {
  if (typeof window.PointerEvent === 'function') return;
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) { super(type, init); this.isPrimary = init.isPrimary ?? true; }
  };
});

describe('Button', () => {
  it('is a native type="button" by default and wraps the label in the label span', () => {
    render(<Button>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b.getAttribute('type')).toBe('button');
    expect(b.querySelector('.ds-touch__label').textContent).toBe('Save');
    expect(b.className).toContain('ds-touch--primary');
    expect(b.getAttribute('data-density')).toBe('touch');
  });

  it('wrapLabel={false} leaves the children bare; keyHint is hidden from assistive tech', () => {
    render(<Button wrapLabel={false} keyHint="3">Go</Button>);
    const b = screen.getByRole('button', { name: 'Go' });
    expect(b.querySelector('.ds-touch__label')).toBeNull();
    expect(b.querySelector('kbd').getAttribute('aria-hidden')).toBe('true');
  });

  it('forwards the ref and native attributes', () => {
    const ref = createRef();
    render(<Button ref={ref} type="submit" aria-label="Send" data-x="1">S</Button>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Send' }));
    expect(ref.current.getAttribute('type')).toBe('submit');
    expect(ref.current.getAttribute('data-x')).toBe('1');
  });

  it('click fires onClick; disabled and busy buttons do not', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} disabled>Go</Button>);
    fireEvent.click(screen.getByRole('button'));
    rerender(<Button onClick={onClick} busy>Go</Button>);
    const busy = screen.getByRole('button');
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('activation="release" does nothing on pointer down', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, isPrimary: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('activation="press" clicks on pointer down and swallows the pointer-generated click', () => {
    const onClick = vi.fn();
    render(<Button activation="press" onClick={onClick}>Go</Button>);
    const b = screen.getByRole('button');
    fireEvent.pointerDown(b, { button: 0, isPrimary: true });
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(b, { detail: 1 }); // the click that follows the release
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('activation="press" keeps keyboard clicks (detail 0) live, also after a press', () => {
    const onClick = vi.fn();
    render(<Button activation="press" onClick={onClick}>Go</Button>);
    const b = screen.getByRole('button');
    fireEvent.click(b, { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(b, { button: 0, isPrimary: true });
    fireEvent.click(b, { detail: 1 });
    fireEvent.click(b, { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('a cancelled press does not suppress the next click', () => {
    const onClick = vi.fn();
    render(<Button activation="press" onClick={onClick}>Go</Button>);
    const b = screen.getByRole('button');
    fireEvent.pointerDown(b, { button: 0, isPrimary: true });
    fireEvent.pointerCancel(b);
    fireEvent.click(b, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('press ignores secondary buttons and non-primary pointers, and a prevented pointerdown', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button activation="press" onClick={onClick}>Go</Button>);
    const b = screen.getByRole('button');
    fireEvent.pointerDown(b, { button: 2, isPrimary: true });
    fireEvent.pointerDown(b, { button: 0, isPrimary: false });
    expect(onClick).not.toHaveBeenCalled();
    rerender(<Button activation="press" onClick={onClick} onPointerDown={e => e.preventDefault()}>Go</Button>);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, isPrimary: true, cancelable: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('press does not fire while busy', () => {
    const onClick = vi.fn();
    render(<Button activation="press" busy onClick={onClick}>Go</Button>);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, isPrimary: true });
    expect(onClick).not.toHaveBeenCalled();
  });
});
