import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  FULLSCREEN_STORAGE_KEY,
  PianoFullscreenProvider,
  readFullscreen,
  usePianoFullscreen,
  useHostedFullscreenToggle,
  writeFullscreen,
} from './PianoFullscreenContext.jsx';
import PianoFullscreenToggle from './PianoFullscreenToggle.jsx';

const memoryStore = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
  };
};

const throwingStore = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

const withProvider = (store) => ({ children }) => (
  <PianoFullscreenProvider storage={store}>{children}</PianoFullscreenProvider>
);

describe('fullscreen storage', () => {
  it('round-trips through the store and clears rather than storing false', () => {
    const store = memoryStore();
    expect(readFullscreen(store)).toBe(false);
    writeFullscreen(true, store);
    expect(store.data[FULLSCREEN_STORAGE_KEY]).toBe('true');
    expect(readFullscreen(store)).toBe(true);
    writeFullscreen(false, store);
    expect(FULLSCREEN_STORAGE_KEY in store.data).toBe(false);
  });

  it('never throws on a blocked store', () => {
    expect(readFullscreen(throwingStore)).toBe(false);
    expect(() => writeFullscreen(true, throwingStore)).not.toThrow();
  });
});

describe('PianoFullscreenProvider', () => {
  it('is unavailable outside the kiosk, and the toggle draws nothing there', () => {
    const { result } = renderHook(() => usePianoFullscreen());
    expect(result.current.available).toBe(false);
    expect(result.current.fullscreen).toBe(false);
    const { container } = render(<PianoFullscreenToggle />);
    expect(container.innerHTML).toBe('');
  });

  it('restores the remembered state and remembers each change', () => {
    const store = memoryStore({ [FULLSCREEN_STORAGE_KEY]: 'true' });
    const { result } = renderHook(() => usePianoFullscreen(), { wrapper: withProvider(store) });
    expect(result.current.fullscreen).toBe(true);
    act(() => result.current.toggle('test'));
    expect(result.current.fullscreen).toBe(false);
    expect(readFullscreen(store)).toBe(false);
    act(() => result.current.setFullscreen(true, 'test'));
    expect(readFullscreen(store)).toBe(true);
  });

  it('keeps one accessible name and reports the state as pressed', () => {
    render(<PianoFullscreenToggle />, { wrapper: withProvider(memoryStore()) });
    const button = screen.getByRole('button', { name: 'Full screen' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Full screen' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('counts surfaces hosting the toggle for exactly as long as they host it', () => {
    const store = memoryStore();
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => ({ drawn: useHostedFullscreenToggle(enabled), ctx: usePianoFullscreen() }),
      { wrapper: withProvider(store), initialProps: { enabled: true } },
    );
    expect(result.current.drawn).toBe(true);
    expect(result.current.ctx.hosted).toBe(true);
    rerender({ enabled: false });
    expect(result.current.drawn).toBe(false);
    expect(result.current.ctx.hosted).toBe(false);
    unmount();
  });

  it('never claims to host outside the kiosk', () => {
    const { result } = renderHook(() => useHostedFullscreenToggle(true));
    expect(result.current).toBe(false);
  });
});
